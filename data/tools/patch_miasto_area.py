"""
Patch area_km2 into data/geo/miasta_pl.json.

Pass 1 + 2: match cities to dim_gmina (DB) by norm+voivodeship,
            first exact then space-stripped (GADM concatenates words).
Pass 3:     for cities still unmatched, compute area from the raw
            gminy.geojson polygons using the same spherical excess formula
            as the ETL.

Run from the repo root:
    python -m data.tools.patch_miasto_area
or directly:
    python data/tools/patch_miasto_area.py
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIASTA = ROOT / "data" / "geo" / "miasta_pl.json"
GMINY  = ROOT / "data" / "geo" / "gminy.geojson"
DB     = ROOT / "data" / "zabka.duckdb"


# ---------------------------------------------------------------------------
# Spherical excess area (same formula as frontend_router._ring_area_km2)
# ---------------------------------------------------------------------------
R_KM = 6371.0

def _ring_area_km2(ring):
    n = len(ring)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        lon1, lat1 = ring[i]
        lon2, lat2 = ring[(i + 1) % n]
        total += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2))
        )
    return abs(total) * R_KM ** 2 / 2.0


def _geom_area(geometry):
    t = geometry.get("type", "")
    if t == "Polygon":
        rings = geometry.get("coordinates", [])
        return sum(_ring_area_km2(r) for r in rings)
    if t == "MultiPolygon":
        total = 0.0
        for poly in geometry.get("coordinates", []):
            total += sum(_ring_area_km2(r) for r in poly)
        return total
    return 0.0


# ---------------------------------------------------------------------------
# Pass 1 + 2: build lookup from dim_gmina
# ---------------------------------------------------------------------------
def _build_db_lookup():
    try:
        import duckdb
    except ImportError:
        print("duckdb not available, skipping DB passes", file=sys.stderr)
        return {}, {}

    try:
        db = duckdb.connect(str(DB), read_only=True)
        rows = db.execute("""
            SELECT g.name, v.name, g.area_km2
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            WHERE g.area_km2 IS NOT NULL
        """).fetchall()
        db.close()
    except Exception as e:
        print(f"DB error: {e}", file=sys.stderr)
        return {}, {}

    exact, stripped = {}, {}
    for name, voiv, area in rows:
        k1 = (name.strip().lower(), voiv.strip().lower())
        k2 = (name.strip().lower().replace(" ", ""), voiv.strip().lower())
        exact.setdefault(k1, area)
        stripped.setdefault(k2, area)
    return exact, stripped


# ---------------------------------------------------------------------------
# Pass 3: build lookup from raw gminy.geojson polygons
# ---------------------------------------------------------------------------
def _build_geojson_lookup():
    if not GMINY.exists():
        print(f"{GMINY} not found, skipping pass 3", file=sys.stderr)
        return {}

    g = json.loads(GMINY.read_bytes())
    lookup = {}
    for feat in g.get("features", []):
        p = feat.get("properties", {})
        raw_name = (p.get("NAME_3") or "").strip()
        voiv_raw = (p.get("NAME_1") or "").strip().lower()
        area = round(_geom_area(feat.get("geometry") or {}), 1)
        if not raw_name or not area:
            continue
        norm = raw_name.lower().replace(" ", "")
        lookup.setdefault((norm, voiv_raw), area)
    return lookup


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    data = json.loads(MIASTA.read_bytes())
    cities = data["cities"]

    exact, stripped = _build_db_lookup()
    geojson = _build_geojson_lookup()

    stats = {"db_exact": 0, "db_strip": 0, "geojson": 0, "miss": 0}
    miss = []

    for c in cities:
        if c.get("area_km2") is not None:
            continue
        norm = c.get("norm") or c["name"].strip().lower()
        voiv = c["voivodeship"].strip().lower()

        # pass 1: exact
        area = exact.get((norm, voiv))
        if area:
            c["area_km2"] = area
            stats["db_exact"] += 1
            continue

        # pass 2: space-stripped
        area = stripped.get((norm.replace(" ", ""), voiv))
        if area:
            c["area_km2"] = area
            stats["db_strip"] += 1
            continue

        # pass 3: raw geojson
        area = geojson.get((norm.replace(" ", ""), voiv))
        if area:
            c["area_km2"] = area
            stats["geojson"] += 1
            continue

        stats["miss"] += 1
        miss.append(f"{c['name']} / {voiv}")

    MIASTA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    total = len(cities)
    filled = total - stats["miss"]
    print(f"Patched {filled}/{total} cities with area_km2")
    print(f"  DB exact:   {stats['db_exact']}")
    print(f"  DB strip:   {stats['db_strip']}")
    print(f"  GeoJSON:    {stats['geojson']}")
    print(f"  Still NULL: {stats['miss']}")
    if miss:
        print("Unmatched:")
        for m in miss:
            print(f"  {m}")


if __name__ == "__main__":
    main()
