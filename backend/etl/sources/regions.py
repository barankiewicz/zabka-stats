"""Wzbogacenie: wojewodztwo + powiat przez point-in-polygon (offline)."""

from backend.etl.base import Enricher
from backend.etl.geo import build_polygon_index, assign_region, nearest_region
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

        fb_w = fb_p = 0
        for r in rows:
            lon, lat = r["longitude"], r["latitude"]
            w = assign_region(lon, lat, woj_idx)
            p = assign_region(lon, lat, pow_idx)
            if not w:
                w = nearest_region(lon, lat, woj_idx)
                fb_w += 1
            if not p:
                p = nearest_region(lon, lat, pow_idx)
                fb_p += 1
            r["voivodeship"] = w
            r["powiat"] = p
        print(f"[regions] przypisano (fallback granicy: {fb_w} woj, {fb_p} pow)")
