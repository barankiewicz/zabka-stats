"""Wzbogacenie: wojewodztwo + powiat przez point-in-polygon (offline)."""

from backend.etl.base import Enricher
from backend.etl.geo import (build_polygon_index, assign_region,
                              nearest_region, ring_contains)
from backend.etl.io import load_geojson, GEOJSON_WOJ, GEOJSON_POW


class RegionsEnricher(Enricher):
    """Przypisz wojewodztwo i powiat kazdemu sklepowi - offline, point-in-polygon."""

    tag = "regions"
    columns = ("voivodeship", "powiat")

    def enrich(self, rows: list) -> None:
        for r in rows:
            r.setdefault("voivodeship", None)
            r.setdefault("powiat", None)
        woj_idx = build_polygon_index(load_geojson(GEOJSON_WOJ, "wojewodztwa.geojson"))
        pow_idx = build_polygon_index(load_geojson(GEOJSON_POW, "powiaty.geojson"))
        print(f"[regions] granice: {len(woj_idx)} wojewodztw, {len(pow_idx)} powiatow")

        # Each powiat lies in exactly one voivodeship. Precompute that voivodeship
        # per powiat polygon (from its bbox centre) and derive every store's
        # voivodeship FROM its powiat. Assigning voivodeship and powiat by two
        # independent point-in-polygon tests let border points pick a voivodeship
        # that doesn't match their powiat, minting phantom (name, voivodeship)
        # pairs in dim_powiat (e.g. "powiat brzeski" in dolnoslaskie). Deriving it
        # from the powiat keeps the pair administratively valid.
        pow_voiv = []
        for _name, (x0, y0, x1, y1), _area, _rings in pow_idx:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            pow_voiv.append(assign_region(cx, cy, woj_idx)
                            or nearest_region(cx, cy, woj_idx))

        def assign_powiat(lon, lat):
            """(name, voivodeship) of the smallest powiat polygon containing the
            point; pow_idx is area-sorted so a grodzki wins over its ziemski."""
            for k, (name, (x0, y0, x1, y1), _area, rings) in enumerate(pow_idx):
                if x0 <= lon <= x1 and y0 <= lat <= y1 \
                        and any(ring_contains(lon, lat, rr) for rr in rings):
                    return name, pow_voiv[k]
            return None, None

        def nearest_powiat(lon, lat):
            best, bestd, bi = None, 1e18, -1
            for k, (name, (x0, y0, x1, y1), _area, _rings) in enumerate(pow_idx):
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                d = (cx - lon) ** 2 + (cy - lat) ** 2
                if d < bestd:
                    best, bestd, bi = name, d, k
            return best, (pow_voiv[bi] if bi >= 0 else None)

        fb_p = 0
        for r in rows:
            lon, lat = r["longitude"], r["latitude"]
            p, v = assign_powiat(lon, lat)
            if not p:                       # just outside the simplified boundary
                p, v = nearest_powiat(lon, lat)
                fb_p += 1
            r["powiat"] = p
            r["voivodeship"] = v            # always consistent with the powiat
        print(f"[regions] przypisano (fallback granicy powiatu: {fb_p})")
