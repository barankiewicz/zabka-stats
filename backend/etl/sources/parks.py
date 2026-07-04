"""Wzbogacenie: parki narodowe/krajobrazowe + otuliny GDOŚ (point-in-polygon).

Parki sa wymiarem (dim_park): kazdy obiekt dostaje numeryczny id, a locations
wskazuje na niego przez nature_park_id (FK). Nazwa/typ parku zyja w wymiarze.
"""

import os

from backend.etl.base import Enricher
from backend.etl.geo import ring_contains
from backend.etl.io import load_static_geojson

# --- parki narodowe i krajobrazowe + otuliny (GDOŚ) ---
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PARKS_FILE = os.getenv("PARKS_GEOJSON_FILE")
if PARKS_FILE:
    PARKS_FILE = os.path.abspath(PARKS_FILE)
else:
    PARKS_FILE = os.path.join(_PROJECT_ROOT, "data", "input", "parki_gdos.geojson")
PARKS_URL = os.getenv("PARKS_GEOJSON_URL", "")
_NAME_KEYS = ("nazwa", "name", "NAZWA", "Name", "nazwa_pl", "nazwaParku", "NAZWAPARKU")
_TYPE_KEYS = ("typ", "type", "TYP", "rodzaj")


class ParksEnricher(Enricher):
    """Point-in-polygon wobec granic parkow/otulin GDOŚ. Ustawia is_in_nature_park
    oraz nature_park_id (FK do dim_park). Wystawia parki() do zaladowania wymiaru."""

    tag = "parks"
    columns = ("is_in_nature_park", "nature_park_id")

    def __init__(self):
        self._parks = []   # [(id, name, type)] do dim_park

    def enrich(self, rows: list) -> None:
        for r in rows:
            r["is_in_nature_park"] = False
            r["nature_park_id"] = None
        gj = load_static_geojson(PARKS_FILE, PARKS_URL, "parks")
        if not gj:
            print(f"[parks] brak danych GDOŚ (ustaw PARKS_GEOJSON_URL lub {PARKS_FILE}) - pomijam")
            return
        index = []   # (id, bbox, rings)
        for i, feat in enumerate(gj.get("features", []), start=1):
            props = feat.get("properties", {}) or {}
            name = next((props[k] for k in _NAME_KEYS if props.get(k)), None) or "park"
            ptype = next((props[k] for k in _TYPE_KEYS if props.get(k)), None)
            geom = feat.get("geometry") or {}
            gtype, coords = geom.get("type"), geom.get("coordinates", [])
            rings = []
            if gtype == "Polygon":
                rings = [coords[0]]
            elif gtype == "MultiPolygon":
                rings = [poly[0] for poly in coords]
            if not rings:
                continue
            xs = [pt[0] for rg in rings for pt in rg]
            ys = [pt[1] for rg in rings for pt in rg]
            index.append((i, (min(xs), min(ys), max(xs), max(ys)), rings))
            self._parks.append((i, name, ptype))
        if not index:
            print("[parks] zbior GDOŚ bez poligonow - pomijam")
            return
        hit = 0
        for r in rows:
            lon, lat = r["longitude"], r["latitude"]
            for pid, (x0, y0, x1, y1), rings in index:
                if x0 <= lon <= x1 and y0 <= lat <= y1 and \
                   any(ring_contains(lon, lat, rg) for rg in rings):
                    r["is_in_nature_park"] = True
                    r["nature_park_id"] = pid
                    hit += 1
                    break
        print(f"[parks] {len(index):,} poligonow GDOŚ; {hit:,} sklepow w parku/otulinie")

    def parks(self):
        """Lista (id, name, type) do zaladowania dim_park."""
        return self._parks
