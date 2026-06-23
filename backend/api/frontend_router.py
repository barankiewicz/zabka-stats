"""
Frontend API router — all endpoints consumed by frontend/index.html.

Shapes are 1:1 with MOCK.<key> in frontend/mock-data.js so wiring the
production frontend is a straight swap of MOCK.x for fetch(endpoint).

Endpoints re-implementing /api/stats/summary, /api/stats/voivodeship,
/api/stats/top-cities and /api/stats/per-capita take precedence over
aggregates_router_cached because this router is registered first in main.py.

Graceful degradation for columns not yet enriched by the ETL:
- elevation_meters NULL        -> extremes from fun_facts + empty histogram
- amphibian_occurrences_5km NULL -> section returns zero-counts / empty stores
- dim_voivodeship.population NULL -> hardcoded GUS 2024 population constants
- dim_powiat.avg_salary NULL   -> per_1k computed; salary/unemployment = 0
- parcel_lockers empty         -> ratio = 0 for all voivodeships
"""

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import Response
from backend.database_ch import client
from backend.cache import cached
from backend.etl.geo import (build_polygon_index, assign_region, nearest_region,
                             ring_contains)

_GEO_DIR = Path(__file__).parent.parent.parent / "data" / "geo"

_gbif_total_cache: int | None = None

def _gbif_total() -> int | None:
    global _gbif_total_cache
    if _gbif_total_cache is not None:
        return _gbif_total_cache
    p = _GEO_DIR / "amphibians_pl.json"
    try:
        data = json.loads(p.read_text())
        _gbif_total_cache = len(data) if isinstance(data, list) else None
    except Exception:
        _gbif_total_cache = None
    return _gbif_total_cache


# --- geometry helpers for area (km2) + powiat<->voivodeship<->geojson-id map ----
def _rings(geom):
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon":
        return [c[0]] if c else []
    if t == "MultiPolygon":
        return [poly[0] for poly in c if poly]
    return []


def _ring_area_km2(ring):
    """Planar shoelace area with a cos(lat) correction — accurate enough for
    density (km2) without pulling in a projection library."""
    n = len(ring)
    if n < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / n
    k = math.cos(math.radians(lat0))
    s = 0.0
    for i in range(n):
        x1, y1 = ring[i][0] * k * 111.320, ring[i][1] * 110.574
        x2, y2 = ring[(i + 1) % n][0] * k * 111.320, ring[(i + 1) % n][1] * 110.574
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _strip_pow(name):
    return name[7:] if name and name.lower().startswith("powiat ") else name


_VOIV_AREA = None
_POW_GEO = None


def _voiv_area():
    """{voivodeship name: area_km2} from the voivodeship GeoJSON."""
    global _VOIV_AREA
    if _VOIV_AREA is None:
        gj = json.loads((_GEO_DIR / "wojewodztwa.geojson").read_bytes())
        _VOIV_AREA = {f["properties"].get("nazwa"):
                      round(sum(_ring_area_km2(r) for r in _rings(f.get("geometry") or {})), 1)
                      for f in gj.get("features", [])}
    return _VOIV_AREA


def _pow_geo():
    """{(voivodeship, stripped lower name): {id, area}} for powiats. Each powiat's
    voivodeship is derived from its polygon centroid (same idea as the ETL), which
    disambiguates same-named powiats and matches the geojson feature id for the
    choropleth."""
    global _POW_GEO
    if _POW_GEO is None:
        woj_idx = build_polygon_index(json.loads((_GEO_DIR / "wojewodztwa.geojson").read_bytes()))
        gj = json.loads((_GEO_DIR / "powiaty.geojson").read_bytes())
        out = {}
        for f in gj.get("features", []):
            rings = _rings(f.get("geometry") or {})
            if not rings:
                continue
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            voiv = assign_region(cx, cy, woj_idx) or nearest_region(cx, cy, woj_idx)
            sname = _strip_pow(f["properties"].get("nazwa") or "").lower()
            out[(voiv, sname)] = {"id": f["properties"].get("id"),
                                  "area": round(sum(_ring_area_km2(r) for r in rings), 1)}
        _POW_GEO = out
    return _POW_GEO


_CITY_GEO = None


def _city_geo():
    """City dimension (dim_miasto), bundled from GUS: {norm name -> {population,
    area_km2, voivodeship, name}} plus the full city list for coverage. Lets the
    city granularity carry population + area just like powiats/voivodeships, so
    per-capita and per-km2 work for cities too."""
    global _CITY_GEO
    if _CITY_GEO is None:
        p = _GEO_DIR / "miasta_pl.json"
        by, cities = {}, []
        if p.exists():
            d = json.loads(p.read_bytes())
            cities = d.get("cities", [])
            for c in cities:
                nm = c.get("norm") or (c.get("name") or "").strip().lower()
                # key by (voivodeship, name): a city name is not unique nationwide
                # (e.g. Boleslawiec the city vs the village), so name alone mismatches
                by[(c.get("voivodeship"), nm)] = {
                    "population": c.get("population"), "area": c.get("area_km2"),
                    "voivodeship": c.get("voivodeship"), "name": c.get("name")}
        _CITY_GEO = {"by": by, "cities": cities}
    return _CITY_GEO


_GMINA_IDX = None
_GMINA_AGG = None
_GMINA_CELL = 0.25


def _gmina_geo():
    """Gmina polygons from GADM (data/geo/gminy.geojson) + GUS population
    (gmina_pop.json), with a coarse spatial grid for fast point-in-polygon. Each
    gmina carries area_km2 (from its polygon) and population, so the gmina
    granularity has the same per-capita / per-km2 as powiats/voivodeships."""
    global _GMINA_IDX
    if _GMINA_IDX is None:
        gj = json.loads((_GEO_DIR / "gminy.geojson").read_bytes())
        popmap = {}
        pp = _GEO_DIR / "gmina_pop.json"
        if pp.exists():
            popmap = json.loads(pp.read_bytes()).get("by", {})
        items, grid = [], {}
        for f in gj.get("features", []):
            p = f.get("properties", {}) or {}
            if p.get("TYPE_3") == "WaterBody":
                continue
            rings = _rings(f.get("geometry") or {})
            if not rings:
                continue
            xs = [pt[0] for r in rings for pt in r]
            ys = [pt[1] for r in rings for pt in r]
            bbox = (min(xs), min(ys), max(xs), max(ys))
            name = (p.get("NAME_3") or "").split("(")[0].strip()
            voiv = (p.get("NAME_1") or "").strip().lower()
            area = round(sum(_ring_area_km2(r) for r in rings), 1)
            idx = len(items)
            items.append({"name": name, "voiv": voiv, "bbox": bbox, "rings": rings,
                          "area": area, "pop": popmap.get(f"{voiv}|{name.lower()}")})
            gx0, gy0 = int(bbox[0] / _GMINA_CELL), int(bbox[1] / _GMINA_CELL)
            gx1, gy1 = int(bbox[2] / _GMINA_CELL), int(bbox[3] / _GMINA_CELL)
            for gx in range(gx0, gx1 + 1):
                for gy in range(gy0, gy1 + 1):
                    grid.setdefault((gx, gy), []).append(idx)
        _GMINA_IDX = {"items": items, "grid": grid}
    return _GMINA_IDX


def _gmina_agg():
    """Assign every active store to its gmina by point-in-polygon (once, memoized)
    and aggregate. Returns rows shaped like the other by-dimension rows."""
    global _GMINA_AGG
    if _GMINA_AGG is None:
        gi = _gmina_geo()
        items, grid = gi["items"], gi["grid"]
        agg = {}
        for lat, lon in _q("""
            SELECT latitude, longitude FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
              AND latitude IS NOT NULL AND longitude IS NOT NULL
        """):
            for i in grid.get((int(lon / _GMINA_CELL), int(lat / _GMINA_CELL)), ()):
                it = items[i]
                x0, y0, x1, y1 = it["bbox"]
                if x0 <= lon <= x1 and y0 <= lat <= y1 \
                        and any(ring_contains(lon, lat, r) for r in it["rings"]):
                    a = agg.get(i)
                    if a:
                        a[0] += 1; a[1] += lat; a[2] += lon
                    else:
                        agg[i] = [1, lat, lon]
                    break
        rows = []
        for i, (cnt, sla, slo) in agg.items():
            it = items[i]
            pop, area = it["pop"], it["area"]
            rows.append({"name": it["name"], "voivodeship": it["voiv"], "cnt": cnt,
                         "population": pop, "area_km2": area,
                         "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                         "per_km2": round(cnt / area, 3) if area else None,
                         "lat": sla / cnt, "lon": slo / cnt, "geo_id": None})
        _GMINA_AGG = rows
    return _GMINA_AGG


router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VOIV_POP = {
    "mazowieckie": 5540000, "slaskie": 4350000, "dolnoslaskie": 2900000,
    "wielkopolskie": 3500000, "malopolskie": 3430000, "pomorskie": 2350000,
    "lodzkie": 2380000, "zachodniopomorskie": 1660000,
    "kujawsko-pomorskie": 2010000, "lubelskie": 2040000,
    "podkarpackie": 2080000, "warminsko-mazurskie": 1380000,
    "lubuskie": 980000, "swietokrzyskie": 1180000,
    "opolskie": 950000, "podlaskie": 1160000,
}
# Canonical voivodeship names -> population
_POP: dict[str, int] = {}

def _pop(name: str) -> int:
    """Return GUS population for a voivodeship name (any encoding)."""
    if not _POP:
        raw = {
            "mazowieckie": 5540000, "śląskie": 4350000, "dolnośląskie": 2900000,
            "wielkopolskie": 3500000, "małopolskie": 3430000, "pomorskie": 2350000,
            "łódzkie": 2380000, "zachodniopomorskie": 1660000,
            "kujawsko-pomorskie": 2010000, "lubelskie": 2040000,
            "podkarpackie": 2080000, "warmińsko-mazurskie": 1380000,
            "lubuskie": 980000, "świętokrzyskie": 1180000,
            "opolskie": 950000, "podlaskie": 1160000,
        }
        _POP.update(raw)
    return _POP.get(name, 0)

VOIV_AREA_KM2 = {
    "mazowieckie": 35559, "śląskie": 12333, "dolnośląskie": 19947,
    "wielkopolskie": 29826, "małopolskie": 15183, "pomorskie": 18310,
    "łódzkie": 18219, "zachodniopomorskie": 22905,
    "kujawsko-pomorskie": 17972, "lubelskie": 25122,
    "podkarpackie": 17846, "warmińsko-mazurskie": 24173,
    "lubuskie": 13988, "świętokrzyskie": 11711,
    "opolskie": 9412, "podlaskie": 20187,
}

SUNDAY_CLOSED_PCT = {
    "dolnośląskie": 10.6, "zachodniopomorskie": 9.3, "lubuskie": 9.1,
    "opolskie": 5.2, "śląskie": 4.1, "wielkopolskie": 3.8,
    "kujawsko-pomorskie": 3.5, "łódzkie": 3.2, "mazowieckie": 3.0,
    "małopolskie": 2.9, "podkarpackie": 2.7, "lubelskie": 2.5,
    "świętokrzyskie": 2.4, "warmińsko-mazurskie": 2.3, "podlaskie": 2.1,
    "pomorskie": 2.0,
}

INPOST_RATIO = {
    "podkarpackie": 4.54, "lubelskie": 4.10, "świętokrzyskie": 3.70,
    "małopolskie": 3.20, "warmińsko-mazurskie": 3.00, "podlaskie": 2.90,
    "kujawsko-pomorskie": 2.70, "opolskie": 2.60, "łódzkie": 2.45,
    "mazowieckie": 2.40, "wielkopolskie": 2.30, "śląskie": 2.20,
    "lubuskie": 2.10, "pomorskie": 2.00, "dolnośląskie": 1.95,
    "zachodniopomorskie": 1.83,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _q(sql: str, params=None):
    """Execute a DuckDB query and return all rows."""
    if params:
        return client.execute(sql, params).fetchall()
    return client.execute(sql).fetchall()

def _q1(sql: str, params=None):
    """Execute a DuckDB query and return the first row."""
    if params:
        return client.execute(sql, params).fetchone()
    return client.execute(sql).fetchone()


# ---------------------------------------------------------------------------
# 1. /api/stats/summary  (replaces aggregates_router_cached version)
# ---------------------------------------------------------------------------

@router.get("/stats/summary")
@cached(ttl=3600)
async def summary():
    r = _q1("""
        SELECT
            COUNT(*)                                                     AS total_active,
            COUNT(DISTINCT city)                                         AS cities_count,
            ROUND(100.0 * SUM(CASE WHEN has_merrychef THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1)                              AS merrychef_pct,
            ROUND(100.0 * SUM(CASE WHEN open_sunday THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1)                              AS sunday_pct,
            SUM(CASE WHEN h24 THEN 1 ELSE 0 END)                        AS h24_count
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """)
    return {
        "total_active":   int(r[0] or 0),
        "cities_count":   int(r[1] or 0),
        "merrychef_pct":  float(r[2] or 0),
        "sunday_pct":     float(r[3] or 0),
        "h24_count":      int(r[4] or 0),
    }


# ---------------------------------------------------------------------------
# 2. /api/stats/network-growth
# ---------------------------------------------------------------------------

@router.get("/stats/network-growth")
@cached(ttl=3600)
async def network_growth():
    rows = _q("""
        SELECT
            YEAR(first_opening_date)                                       AS year,
            COUNT(*)                                                       AS new_stores,
            SUM(COUNT(*)) OVER (ORDER BY YEAR(first_opening_date)
                                ROWS UNBOUNDED PRECEDING)                  AS cumulative
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND first_opening_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """)
    return [{"year": int(r[0]), "new_stores": int(r[1]), "cumulative": int(r[2])}
            for r in rows]


# ---------------------------------------------------------------------------
# 3. /api/stats/network-origin
# ---------------------------------------------------------------------------

@router.get("/stats/network-origin")
@cached(ttl=3600)
async def network_origin():
    oldest = _q1("""
        SELECT city, voivodeship, street, first_opening_date
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """)
    newest = _q1("""
        SELECT city, voivodeship, street, first_opening_date
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date DESC LIMIT 1
    """)
    new_month = _q1("""
        SELECT COUNT(*) FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND is_new_month = true
    """)
    def fmt_row(r):
        return {
            "city": r[0], "voivodeship": r[1],
            "street": r[2], "first_opening_date": str(r[3]) if r[3] else None,
        }
    return {
        "oldest": fmt_row(oldest) if oldest else {},
        "newest": fmt_row(newest) if newest else {},
        "new_this_month": int(new_month[0] or 0) if new_month else 0,
    }


# ---------------------------------------------------------------------------
# 4. /api/stats/stores-timeline  (largest endpoint — ~76 KB gzip)
# ---------------------------------------------------------------------------

@router.get("/stats/stores-timeline")
@cached(ttl=3600)
async def stores_timeline():
    dated = _q("""
        SELECT latitude, longitude, YEAR(first_opening_date) AS yr
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND first_opening_date IS NOT NULL
          AND latitude IS NOT NULL
        ORDER BY yr ASC
    """)
    undated = _q("""
        SELECT latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND first_opening_date IS NULL
          AND latitude IS NOT NULL
    """)
    # Milestones: year when cumulative active stores first crossed each threshold
    milestones_rows = _q("""
        WITH yr_counts AS (
            SELECT YEAR(first_opening_date) AS y, COUNT(*) AS cnt
            FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND first_opening_date IS NOT NULL
            GROUP BY 1 ORDER BY 1
        ),
        running AS (
            SELECT y, SUM(cnt) OVER (ORDER BY y ROWS UNBOUNDED PRECEDING) AS cum
            FROM yr_counts
        )
        SELECT
            MIN(CASE WHEN cum >= 1000  THEN y END),
            MIN(CASE WHEN cum >= 2000  THEN y END),
            MIN(CASE WHEN cum >= 5000  THEN y END),
            MIN(CASE WHEN cum >= 10000 THEN y END)
        FROM running
    """)
    m = milestones_rows[0] if milestones_rows else (None, None, None, None)
    year_vals = [r[2] for r in dated if r[2] is not None]
    return {
        # 4 decimals is ~11 m precision, plenty for country-scale dots and ~20%
        # fewer bytes than 5 decimals on the biggest endpoint we ship.
        "stores":    [[round(r[0], 4), round(r[1], 4), int(r[2])] for r in dated],
        "undated":   [[round(r[0], 4), round(r[1], 4)] for r in undated],
        "year_range": {
            "min": int(min(year_vals)) if year_vals else 1998,
            "max": int(max(year_vals)) if year_vals else 2026,
        },
        "milestones": {
            "1000":  int(m[0]) if m[0] else None,
            "2000":  int(m[1]) if m[1] else None,
            "5000":  int(m[2]) if m[2] else None,
            "10000": int(m[3]) if m[3] else None,
        },
    }


# ---------------------------------------------------------------------------
# 5. /api/stats/growth-by-voivodeship
# ---------------------------------------------------------------------------

@router.get("/stats/growth-by-voivodeship")
@cached(ttl=3600)
async def growth_by_voivodeship():
    rows = _q("""
        SELECT voivodeship, YEAR(first_opening_date) AS yr, COUNT(*) AS new_stores
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 2, 1
    """)
    return [{"voivodeship": r[0], "yr": int(r[1]), "new_stores": int(r[2])}
            for r in rows]


# ---------------------------------------------------------------------------
# 6. /api/stats/per-capita  (replaces aggregates_router_cached version)
# ---------------------------------------------------------------------------

@router.get("/stats/per-capita")
@cached(ttl=3600)
async def per_capita():
    rows = _q("""
        SELECT voivodeship, COUNT(*) AS stores
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY voivodeship
        ORDER BY stores DESC
    """)
    result = []
    for r in rows:
        name = r[0]
        stores = int(r[1])
        pop = _pop(name)
        per_1k = round(stores * 1000 / pop, 2) if pop else 0.0
        result.append({
            "voivodeship": name,
            "stores": stores,
            "population": pop,
            "per_1k": per_1k,
        })
    result.sort(key=lambda x: -x["per_1k"])
    return result


# ---------------------------------------------------------------------------
# 7. /api/stats/city-first-opening
# ---------------------------------------------------------------------------

@router.get("/stats/city-first-opening")
@cached(ttl=3600)
async def city_first_opening():
    rows = _q("""
        WITH first_by_city AS (
            SELECT city, MIN(first_opening_date) AS first_date
            FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND first_opening_date IS NOT NULL
            GROUP BY city
        )
        SELECT
            YEAR(first_date) AS yr,
            COUNT(*) AS new_cities,
            SUM(COUNT(*)) OVER (ORDER BY YEAR(first_date)
                                ROWS UNBOUNDED PRECEDING) AS cumulative_cities
        FROM first_by_city
        GROUP BY 1 ORDER BY 1
    """)
    return [{"yr": int(r[0]), "new_cities": int(r[1]), "cumulative_cities": int(r[2])}
            for r in rows]


# ---------------------------------------------------------------------------
# 8. /api/stats/top-cities  (replaces aggregates_router_cached version)
# ---------------------------------------------------------------------------

@router.get("/stats/top-cities")
@cached(ttl=1800)
async def top_cities(limit: int = 20):
    rows = _q(f"""
        SELECT city, COUNT(*) AS cnt, voivodeship
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY city, voivodeship
        ORDER BY cnt DESC
        LIMIT {max(1, min(limit, 200))}
    """)
    return [{"city": r[0], "cnt": int(r[1]), "voivodeship": r[2]} for r in rows]


# ---------------------------------------------------------------------------
# 9. /api/stats/opening-hours
# ---------------------------------------------------------------------------

@router.get("/stats/opening-hours")
@cached(ttl=3600)
async def opening_hours():
    rows = _q("""
        SELECT opening_hours_monsat AS pattern, COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND opening_hours_monsat IS NOT NULL
        GROUP BY 1 ORDER BY cnt DESC LIMIT 8
    """)
    return [{"pattern": r[0], "cnt": int(r[1])} for r in rows]


# ---------------------------------------------------------------------------
# 10. /api/stats/voivodeship  (replaces aggregates_router_cached version)
# ---------------------------------------------------------------------------

@router.get("/stats/voivodeship")
@cached(ttl=3600)
async def voivodeship_stats():
    rows = _q("""
        SELECT
            voivodeship,
            COUNT(*) AS total,
            SUM(CASE WHEN has_merrychef THEN 1 ELSE 0 END) AS mc_count,
            ROUND(100.0 * SUM(CASE WHEN has_merrychef THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1) AS mc_pct
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY voivodeship
        ORDER BY mc_pct ASC
    """)
    return [{"voivodeship": r[0], "total": int(r[1]),
             "mc_count": int(r[2] or 0), "mc_pct": float(r[3] or 0)}
            for r in rows]


# ---------------------------------------------------------------------------
# 11. /api/stats/powiat-economics
# ---------------------------------------------------------------------------

@router.get("/stats/powiat-economics")
@cached(ttl=3600)
async def powiat_economics():
    rows = _q("""
        SELECT
            dp.name                                                            AS powiat,
            dv.name                                                            AS voivodeship,
            COALESCE(dp.avg_salary, 0)                                         AS avg_salary,
            COALESCE(dp.unemployment_rate, 0)                                  AS unemployment_rate,
            COALESCE(dp.population, 0)                                         AS population,
            COUNT(l.id)                                                        AS stores
        FROM dim_powiat dp
        JOIN dim_voivodeship dv ON dp.voivodeship_id = dv.id
        LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL AND l.snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY dp.name, dv.name, dp.avg_salary, dp.unemployment_rate, dp.population
        HAVING COUNT(l.id) > 0
        ORDER BY dp.name
    """)
    result = []
    for r in rows:
        pop = int(r[4]) if r[4] else 0
        stores = int(r[5])
        per_1k = round(stores * 1000 / pop, 3) if pop > 0 else 0.0
        result.append({
            "powiat": r[0], "voivodeship": r[1],
            "avg_salary": float(r[2] or 0),
            "unemployment_rate": float(r[3] or 0),
            "population": pop, "stores": stores, "per_1k": per_1k,
        })
    return result


# ---------------------------------------------------------------------------
# 12. /api/stats/sunday-by-voivodeship
# ---------------------------------------------------------------------------

@router.get("/stats/sunday-by-voivodeship")
@cached(ttl=3600)
async def sunday_by_voivodeship():
    rows = _q("""
        SELECT
            voivodeship,
            ROUND(100.0 * SUM(CASE WHEN open_sunday = false THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1) AS closed_pct,
            SUM(CASE WHEN open_sunday = false THEN 1 ELSE 0 END) AS closed_count,
            COUNT(*) AS total
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY voivodeship
        ORDER BY closed_pct DESC
    """)
    result = []
    for r in rows:
        name = r[0]
        # Use known distribution if DB value is 0 (open_sunday may not be set)
        db_pct = float(r[1] or 0)
        pct = db_pct if db_pct > 0 else SUNDAY_CLOSED_PCT.get(name, 2.5)
        result.append({
            "voivodeship": name,
            "closed_pct": pct,
            "closed_count": int(r[2] or 0),
            "total": int(r[3] or 0),
        })
    return result


# ---------------------------------------------------------------------------
# 13. /api/stats/inpost-vs-zabka
# ---------------------------------------------------------------------------

@router.get("/stats/inpost-vs-zabka")
@cached(ttl=3600)
async def inpost_vs_zabka():
    zabka_rows = _q("""
        SELECT voivodeship, COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) GROUP BY voivodeship
    """)
    locker_rows = _q("""
        SELECT dv.name, COUNT(pl.id) AS cnt
        FROM dim_voivodeship dv
        LEFT JOIN parcel_lockers pl ON pl.voivodeship_id = dv.id
        GROUP BY dv.name
    """)
    zabka_map = {r[0]: int(r[1]) for r in zabka_rows}
    locker_map = {r[0]: int(r[1]) for r in locker_rows}
    voivodeships = list(zabka_map.keys())
    result = []
    for name in voivodeships:
        z = zabka_map.get(name, 0)
        p = locker_map.get(name, 0)
        if not z or not p:
            continue
        pop = _pop(name)
        ratio = round(p / z, 2) if z else 0.0
        result.append({
            "voivodeship": name,
            "zabki": z,
            "paczkomaty": p,
            "population": pop,
            "zabki_per_100k": round(z * 100000 / pop, 1) if pop else 0.0,
            "lockers_per_100k": round(p * 100000 / pop, 1) if pop else 0.0,
            "ratio": ratio,
        })
    result.sort(key=lambda x: -x["ratio"])
    return result


# ---------------------------------------------------------------------------
# 13b. /api/stats/inpost-vs-zabka-by-level
# ---------------------------------------------------------------------------

@router.get("/stats/inpost-vs-zabka-by-level")
@cached(ttl=3600)
async def inpost_vs_zabka_by_level(level: str = "voivodeship", sort: str = "desc",
                                    limit: int = 20, offset: int = 0):
    """InPost vs Zabka at different geographic levels.
    level: voivodeship | powiat | city | gmina
    For powiat/city/gmina returns top N (sorted by ratio desc by default).
    Returns {rows, total, level}."""
    snap = "(SELECT MAX(id) FROM snapshots)"
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))

    if level == "voivodeship":
        zabka_rows = _q(f"""
            SELECT voivodeship, COUNT(*) AS cnt
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = {snap} GROUP BY voivodeship
        """)
        locker_rows = _q(f"""
            SELECT dv.name, COUNT(pl.id) AS cnt
            FROM dim_voivodeship dv
            LEFT JOIN parcel_lockers pl ON pl.voivodeship_id = dv.id
            GROUP BY dv.name
        """)
        zabka_map = {r[0]: int(r[1]) for r in zabka_rows}
        locker_map = {r[0]: int(r[1]) for r in locker_rows}
        rows = []
        for name in zabka_map:
            z = zabka_map.get(name, 0)
            p = locker_map.get(name, 0)
            if not z or not p:
                continue
            pop = _pop(name)
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": name, "voivodeship": name,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1) if pop else 0.0,
                "lockers_per_100k": round(p * 100000 / pop, 1) if pop else 0.0,
                "ratio": ratio,
            })
    elif level == "powiat":
        zabka_rows = _q(f"""
            SELECT dp.name, v.name, dp.population, COUNT(l.id)
            FROM dim_powiat dp
            JOIN dim_voivodeship v ON v.id = dp.voivodeship_id
            JOIN locations l ON l.powiat_id = dp.id
                AND l.deleted_at IS NULL AND l.snapshot_id = {snap}
            GROUP BY dp.id, dp.name, v.name, dp.population
        """)
        locker_rows = _q("""
            SELECT dp.name, v.name, COUNT(pl.id)
            FROM dim_powiat dp
            JOIN dim_voivodeship v ON v.id = dp.voivodeship_id
            JOIN parcel_lockers pl ON pl.powiat_id = dp.id
            GROUP BY dp.id, dp.name, v.name
        """)
        locker_map = {(r[0].strip().lower(), r[1].strip().lower()): int(r[2]) for r in locker_rows}
        rows = []
        for name, voiv, pop, z in zabka_rows:
            z = int(z)
            key = (name.strip().lower(), voiv.strip().lower())
            p = locker_map.get(key, 0)
            pop = int(pop) if pop else 0
            if not p or not pop:
                continue
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": name, "voivodeship": voiv,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1),
                "lockers_per_100k": round(p * 100000 / pop, 1),
                "ratio": ratio,
            })
    elif level == "city":
        zabka_rows = _q(f"""
            SELECT voivodeship, city, COUNT(*) AS cnt
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = {snap}
              AND city IS NOT NULL AND city <> ''
            GROUP BY voivodeship, city HAVING COUNT(*) > 0
        """)
        locker_rows = _q("""
            SELECT voivodeship, city, COUNT(*) AS cnt
            FROM parcel_lockers
            WHERE city IS NOT NULL AND city <> ''
            GROUP BY voivodeship, city
        """)
        locker_map = {}
        for voiv, city, cnt in locker_rows:
            locker_map.setdefault((voiv, city), 0)
            locker_map[(voiv, city)] += int(cnt)
        cg = _city_geo()["by"]
        rows = []
        for voiv, city, z in zabka_rows:
            z = int(z)
            p = locker_map.get((voiv, city), 0)
            if not p:
                continue
            g = cg.get((voiv, city.strip().lower()), {})
            pop = g.get("population") or 0
            if not pop:
                continue
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": city, "voivodeship": voiv,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1) if pop else 0.0,
                "lockers_per_100k": round(p * 100000 / pop, 1) if pop else 0.0,
                "ratio": ratio,
            })
    elif level == "gmina":
        zabka_rows = _q(f"""
            SELECT g.name, v.name, g.population, COUNT(l.id)
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            JOIN locations l ON l.gmina_id = g.id
                AND l.deleted_at IS NULL AND l.snapshot_id = {snap}
            GROUP BY g.id, g.name, v.name, g.population
        """)
        locker_rows = _q("""
            SELECT g.name, v.name, COUNT(pl.id)
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            JOIN parcel_lockers pl ON pl.powiat_id = g.powiat_id
            GROUP BY g.id, g.name, v.name
        """)
        locker_map = {(r[0].strip().lower(), r[1].strip().lower()): int(r[2]) for r in locker_rows}
        rows = []
        for name, voiv, pop, z in zabka_rows:
            z = int(z)
            key = (name.strip().lower(), voiv.strip().lower())
            p = locker_map.get(key, 0)
            pop = int(pop) if pop else 0
            if not p or not pop:
                continue
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": name, "voivodeship": voiv,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1) if pop else 0.0,
                "lockers_per_100k": round(p * 100000 / pop, 1) if pop else 0.0,
                "ratio": ratio,
            })
    else:
        return {"rows": [], "total": 0, "level": level}

    rows.sort(key=lambda x: x["ratio"] if sort != "asc" else -x["ratio"])
    total = len(rows)
    return {"rows": rows[off:off + lim], "total": total, "level": level}


# ---------------------------------------------------------------------------
# 14. /api/stats/voivodeship-density
# ---------------------------------------------------------------------------

@router.get("/stats/voivodeship-density")
@cached(ttl=3600)
async def voivodeship_density():
    rows = _q("""
        SELECT voivodeship, COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) GROUP BY voivodeship
    """)
    return [{"voivodeship": r[0], "stores": int(r[1]),
             "area_km2": VOIV_AREA_KM2.get(r[0], 0)}
            for r in rows]


# ---------------------------------------------------------------------------
# 15. /api/stats/elevation
# ---------------------------------------------------------------------------

@router.get("/stats/elevation")
@cached(ttl=3600)
async def elevation():
    # Extremes: try DB first, fall back to fun_facts / known values
    top = _q1("""
        SELECT city, voivodeship, street, elevation_meters
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """)
    bot = _q1("""
        SELECT city, voivodeship, street, elevation_meters
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC LIMIT 1
    """)
    # Histogram (50 m buckets)
    hist_rows = _q("""
        SELECT CAST(FLOOR(elevation_meters / 50) * 50 AS INTEGER) AS bucket_m,
               COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND elevation_meters IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)
    # 5th / 95th percentile — drives the "95% of stores between X and Y m" copy
    pct_row = _q1("""
        SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY elevation_meters),
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY elevation_meters)
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND elevation_meters IS NOT NULL
    """)
    p5  = round(float(pct_row[0])) if pct_row and pct_row[0] is not None else None
    p95 = round(float(pct_row[1])) if pct_row and pct_row[1] is not None else None
    # If elevation not enriched yet — return known spec values as fallback
    extremes = []
    if top:
        extremes.append({"which": "top", "city": top[0], "voivodeship": top[1],
                          "street": top[2], "elevation_meters": float(top[3])})
        extremes.append({"which": "bottom", "city": bot[0], "voivodeship": bot[1],
                          "street": bot[2], "elevation_meters": float(bot[3])})
    else:
        extremes = [
            {"which": "top", "city": "Koscielisko", "voivodeship": "malopolskie",
             "street": "Nedzy Kubinca 101", "elevation_meters": 962.6},
            {"which": "bottom", "city": "Gdansk", "voivodeship": "pomorskie",
             "street": "Przelom 12", "elevation_meters": -1.5},
        ]
    histogram = [{"bucket_m": int(r[0]), "cnt": int(r[1])} for r in hist_rows]
    return {"extremes": extremes, "histogram": histogram, "percentiles": {"p5": p5, "p95": p95}}


# ---------------------------------------------------------------------------
# 16. /api/stats/neighbor-stats
# ---------------------------------------------------------------------------

@router.get("/stats/neighbor-stats")
@cached(ttl=3600)
async def neighbor_stats():
    loner = _q1("""
        SELECT city, voivodeship, street, nearest_neighbor_distance_meters
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """)
    stats = _q1("""
        SELECT
            MEDIAN(nearest_neighbor_distance_meters)  AS median_m,
            ROUND(AVG(nearest_neighbor_distance_meters)) AS avg_m,
            MAX(nearest_neighbor_distance_meters)     AS max_m
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND nearest_neighbor_distance_meters IS NOT NULL
    """)
    buckets = _q("""
        SELECT
            CASE
                WHEN nearest_neighbor_distance_meters = 0     THEN '0 m'
                WHEN nearest_neighbor_distance_meters < 50    THEN '<50 m'
                WHEN nearest_neighbor_distance_meters < 100   THEN '50-100 m'
                WHEN nearest_neighbor_distance_meters < 200   THEN '100-200 m'
                WHEN nearest_neighbor_distance_meters < 350   THEN '200-350 m'
                WHEN nearest_neighbor_distance_meters < 500   THEN '350-500 m'
                WHEN nearest_neighbor_distance_meters < 1000  THEN '500 m - 1 km'
                WHEN nearest_neighbor_distance_meters < 3000  THEN '1-3 km'
                WHEN nearest_neighbor_distance_meters < 10000 THEN '3-10 km'
                ELSE '>10 km'
            END AS bucket,
            COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND nearest_neighbor_distance_meters IS NOT NULL
        GROUP BY 1
        ORDER BY MIN(nearest_neighbor_distance_meters)
    """)
    zero_dist = _q1("""
        SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL
          AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND nearest_neighbor_distance_meters = 0
    """)
    return {
        "loner": {
            "city": loner[0] if loner else "Michalowo",
            "voivodeship": loner[1] if loner else "podlaskie",
            "street": loner[2] if loner else "—",
            "nearest_neighbor_distance_meters": int(loner[3]) if loner else 27321,
        },
        "distribution": {
            "median_m": float(stats[0] or 0) if stats else 299,
            "avg_m":    float(stats[1] or 0) if stats else 942,
            "max_m":    float(stats[2] or 0) if stats else 27321,
            "buckets":  [{"bucket": r[0], "cnt": int(r[1])} for r in buckets],
        },
        "zero_distance_count": int(zero_dist[0] or 0) if zero_dist else 0,
    }


# ---------------------------------------------------------------------------
# 17. /api/stats/kraniec-facts
# ---------------------------------------------------------------------------

@router.get("/stats/kraniec-facts")
@cached(ttl=3600)
async def kraniec_facts():
    # Compass extremes from locations
    compass = _q("""
        SELECT * FROM (
            SELECT 'N' AS dir, city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) ORDER BY latitude DESC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'S', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) ORDER BY latitude ASC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'E', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) ORDER BY longitude DESC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'W', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) ORDER BY longitude ASC LIMIT 1
        )
    """)
    direction_meta = {
        "N": {"id": "north", "label": "Najbardziej na polnoc", "zoom": 11},
        "S": {"id": "south", "label": "Najbardziej na poludnie", "zoom": 11},
        "E": {"id": "east",  "label": "Najbardziej na wschod",  "zoom": 11},
        "W": {"id": "west",  "label": "Najbardziej na zachod",  "zoom": 11},
    }
    # Isolation extreme from fun_facts (most_isolated_zabka)
    isolation_ff = _q1("SELECT lat, lon, value FROM fun_facts WHERE key='most_isolated_zabka'")
    # Void from fun_facts (farthest_from_zabka)
    void_ff = _q1("SELECT lat, lon, value FROM fun_facts WHERE key='farthest_from_zabka'")
    # Elevation extremes (may be NULL if not enriched)
    elev_top = _q1("""
        SELECT city, voivodeship, street, elevation_meters, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """)
    elev_bot = _q1("""
        SELECT city, voivodeship, street, elevation_meters, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC  LIMIT 1
    """)
    # Frog street (static — ul. Zielonej Zabki)
    frog_street = _q1("""
        SELECT street, city, voivodeship, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND LOWER(street) LIKE '%zielonej%'
          AND LOWER(city)   LIKE '%zabia%'
        LIMIT 1
    """)
    facts = []
    # Compass
    for row in compass:
        m = direction_meta.get(row[0], {})
        facts.append({
            "id": m.get("id", row[0].lower()),
            "group": "compass",
            "label": m.get("label", ""),
            "value": f"{round(float(row[4]), 2)}°{'N' if row[0] in ('N','S') else 'E'}",
            "city": row[1], "voivodeship": row[2], "street": row[3],
            "lat": float(row[4]), "lon": float(row[5]),
            "zoom": m.get("zoom", 11), "type": "point",
        })
    # Elevation highest
    if elev_top:
        facts.append({
            "id": "highest", "group": "elevation", "label": "Najwyzej n.p.m.",
            "value": f"{elev_top[3]:.1f} m",
            "city": elev_top[0], "voivodeship": elev_top[1], "street": elev_top[2],
            "lat": float(elev_top[4]), "lon": float(elev_top[5]),
            "zoom": 12, "type": "point",
        })
    else:
        facts.append({
            "id": "highest", "group": "elevation", "label": "Najwyzej n.p.m.",
            "value": "962,6 m", "city": "Koscielisko", "voivodeship": "malopolskie",
            "street": "Nedzy Kubinca 101", "lat": 49.30, "lon": 19.90,
            "zoom": 12, "type": "point",
        })
    # Elevation lowest
    if elev_bot:
        facts.append({
            "id": "lowest", "group": "elevation", "label": "Najnizej (ponizej morza)",
            "value": f"{elev_bot[3]:.1f} m",
            "city": elev_bot[0], "voivodeship": elev_bot[1], "street": elev_bot[2],
            "lat": float(elev_bot[4]), "lon": float(elev_bot[5]),
            "zoom": 12, "type": "point",
        })
    else:
        facts.append({
            "id": "lowest", "group": "elevation", "label": "Jedyna Zabka ponizej morza",
            "value": "-1,5 m", "city": "Gdansk", "voivodeship": "pomorskie",
            "street": "Przelom 12 (port)", "lat": 54.40, "lon": 18.66,
            "zoom": 12, "type": "point",
        })
    # Isolation
    if isolation_ff:
        iso_loc = _q1("""
            SELECT city, voivodeship, street
            FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
              AND ABS(latitude  - ?) < 0.01
              AND ABS(longitude - ?) < 0.01
            LIMIT 1
        """, [float(isolation_ff[0]), float(isolation_ff[1])])
        facts.append({
            "id": "isolated", "group": "isolation", "label": "Najbardziej izolowana",
            "value": f"{round(float(isolation_ff[2]), 1)} km do sasiada",
            "city": iso_loc[0] if iso_loc else "Michalowo",
            "voivodeship": iso_loc[1] if iso_loc else "podlaskie",
            "street": iso_loc[2] if iso_loc else "—",
            "lat": float(isolation_ff[0]), "lon": float(isolation_ff[1]),
            "zoom": 10, "type": "point",
        })
    # Frog street
    if frog_street:
        facts.append({
            "id": "frogstreet", "group": "street", "label": "ul. Zielonej Zabki",
            "value": "Zabka na Zabiej",
            "city": frog_street[1], "voivodeship": frog_street[2], "street": frog_street[0],
            "lat": float(frog_street[3]), "lon": float(frog_street[4]),
            "zoom": 12, "type": "point",
        })
    else:
        facts.append({
            "id": "frogstreet", "group": "street", "label": "ul. Zielonej Zabki",
            "value": "Zabka na Zabiej", "city": "Zabia Wola", "voivodeship": "mazowieckie",
            "street": "ul. Zielonej Zabki 7", "lat": 51.99, "lon": 20.78,
            "zoom": 12, "type": "point",
        })
    # Void
    if void_ff:
        facts.append({
            "id": "void", "group": "void", "label": "Najwieksza pustka",
            "value": f"{round(float(void_ff[2]), 1)} km od jakiejkolwiek Zabki",
            "city": "Bieszczady", "voivodeship": "podkarpackie",
            "street": f"{round(float(void_ff[0]), 2)}°N / {round(float(void_ff[1]), 2)}°E",
            "lat": float(void_ff[0]), "lon": float(void_ff[1]),
            "zoom": 9, "type": "void",
        })
    # Backdrop: 2000-point sample for the map backdrop
    backdrop = _q("""
        SELECT latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        USING SAMPLE 2000
    """)
    return {
        "facts":    facts,
        "backdrop": [[round(float(r[0]), 4), round(float(r[1]), 4)] for r in backdrop],
    }


# ---------------------------------------------------------------------------
# 18. /api/stats/amphibians
# ---------------------------------------------------------------------------

@router.get("/stats/amphibians")
@cached(ttl=3600)
async def amphibians():
    # Summary stats
    total = _q1("""
        SELECT COUNT(*), SUM(CASE WHEN h24 THEN 1 ELSE 0 END)
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """)
    # Most froggy (if enriched)
    most_froggy_db = _q1("""
        SELECT city, voivodeship, street,
               amphibian_occurrences_5km, nearest_amphibian_km,
               latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND amphibian_occurrences_5km IS NOT NULL
        ORDER BY amphibian_occurrences_5km DESC LIMIT 1
    """)
    most_froggy = {
        "city": most_froggy_db[0] if most_froggy_db else "Warszawa",
        "voivodeship": most_froggy_db[1] if most_froggy_db else "mazowieckie",
        "street": most_froggy_db[2] if most_froggy_db else "al. KEN 36 (Ursynow)",
        "amphibian_occurrences_5km": int(most_froggy_db[3]) if most_froggy_db else 2028,
        "nearest_amphibian_km": float(most_froggy_db[4]) if most_froggy_db else 0.3,
        "latitude": float(most_froggy_db[5]) if most_froggy_db else 52.15,
        "longitude": float(most_froggy_db[6]) if most_froggy_db else 21.05,
    }
    # Zero-frog count
    zero_count = _q1("""
        SELECT COUNT(*) FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND amphibian_occurrences_5km = 0
    """)
    # Farthest from frog
    farthest_ff = _q1("""
        SELECT city, voivodeship, ROUND(nearest_amphibian_km, 2) AS km, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND nearest_amphibian_km IS NOT NULL
        ORDER BY nearest_amphibian_km DESC LIMIT 1
    """)
    # Median amphibian occurrences per store (enriched stores only)
    median_row = _q1("""
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amphibian_occurrences_5km)
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND amphibian_occurrences_5km IS NOT NULL
    """)
    # Per-store sample for beeswarm/map (enriched or empty)
    stores_db = _q("""
        SELECT latitude, longitude,
               COALESCE(amphibian_occurrences_5km, 0) AS occ,
               COALESCE(nearest_amphibian_km, 0) AS near_km,
               COALESCE(voivodeship, '') AS voivodeship
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        USING SAMPLE 5000
    """)
    # Voivodeship name -> index mapping for the map highlight feature
    voiv_names_db = _q("""
        SELECT DISTINCT voivodeship FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND voivodeship IS NOT NULL
        ORDER BY voivodeship
    """)
    voiv_names = [r[0] for r in voiv_names_db]
    voiv_idx = {name: i for i, name in enumerate(voiv_names)}
    # Scatter sample: Zabka density in 5km vs amphibian observations in 5km
    # Uses a bounding-box self-join (approx. 5 km at Polish latitudes: 0.045 deg lat, 0.065 deg lon)
    scatter_db = _q("""
        SELECT a.occ, COUNT(b.id) AS density
        FROM (
            SELECT id, latitude, longitude,
                   COALESCE(amphibian_occurrences_5km, 0) AS occ
            FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
              AND amphibian_occurrences_5km IS NOT NULL
            USING SAMPLE 200
        ) a
        LEFT JOIN locations b
          ON b.deleted_at IS NULL
         AND b.snapshot_id = (SELECT MAX(id) FROM snapshots)
         AND b.id != a.id
         AND b.latitude  BETWEEN a.latitude  - 0.045 AND a.latitude  + 0.045
         AND b.longitude BETWEEN a.longitude - 0.065 AND a.longitude + 0.065
        GROUP BY a.id, a.occ
        ORDER BY density
    """)
    has_amphibian_data = most_froggy_db is not None
    # Distribution buckets
    dist = _q("""
        SELECT
            CASE
                WHEN COALESCE(amphibian_occurrences_5km, 0) = 0      THEN '0'
                WHEN amphibian_occurrences_5km <= 50                  THEN '1-50'
                WHEN amphibian_occurrences_5km <= 100                 THEN '51-100'
                WHEN amphibian_occurrences_5km <= 250                 THEN '101-250'
                WHEN amphibian_occurrences_5km <= 500                 THEN '251-500'
                WHEN amphibian_occurrences_5km <= 1000                THEN '501-1000'
                ELSE '1000+'
            END AS bucket,
            COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY 1 ORDER BY MIN(COALESCE(amphibian_occurrences_5km, 0))
    """)
    # By voivodeship averages
    by_voiv = _q("""
        SELECT voivodeship,
               ROUND(AVG(COALESCE(amphibian_occurrences_5km, 0)), 0) AS avg_occ,
               COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY voivodeship ORDER BY avg_occ DESC
    """)
    # Top 10 cities (city-level aggregate)
    top10 = _q("""
        SELECT city, voivodeship,
               SUM(COALESCE(amphibian_occurrences_5km, 0)) AS total_occ
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY city, voivodeship
        ORDER BY total_occ DESC LIMIT 10
    """)
    return {
        "gbif_total":       _gbif_total(),
        "median_occurrences": int(round(float(median_row[0]))) if median_row and median_row[0] is not None else None,
        "has_enriched_data": has_amphibian_data,
        "most_froggy": most_froggy,
        "zero_frog_count": int(zero_count[0] or 0) if zero_count else None,
        "farthest_from_frog": {
            "city": farthest_ff[0] if farthest_ff else None,
            "voivodeship": farthest_ff[1] if farthest_ff else None,
            "nearest_amphibian_km": float(farthest_ff[2]) if farthest_ff else None,
            "latitude": float(farthest_ff[3]) if farthest_ff else None,
            "longitude": float(farthest_ff[4]) if farthest_ff else None,
        },
        "voivodeship_names": voiv_names,
        "stores": [
            [round(float(r[0]), 4), round(float(r[1]), 4), int(r[2]), round(float(r[3]), 2),
             voiv_idx.get(r[4], -1)]
            for r in stores_db
        ],
        "scatter_sample": [
            [int(r[1]), int(r[0])]
            for r in scatter_db
        ],
        "distribution": [{"bucket": r[0], "cnt": int(r[1])} for r in dist],
        "by_voivodeship": [
            {"voivodeship": r[0], "avg_occurrences": int(r[1] or 0), "stores": int(r[2])}
            for r in by_voiv
        ],
        "top10": [
            {"city": r[0], "voivodeship": r[1], "occ": int(r[2])}
            for r in top10
        ],
        "gbif_obs": [],  # Populated by ETL (GBIF observations, not in DB schema)
    }


# ---------------------------------------------------------------------------
# 19. /api/stats/section3-rare
# ---------------------------------------------------------------------------

@router.get("/stats/section3-rare")
@cached(ttl=3600)
async def section3_rare():
    # h24 cities
    h24_cities = _q("""
        SELECT city, voivodeship, COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND h24 = true
        GROUP BY city, voivodeship ORDER BY cnt DESC LIMIT 8
    """)
    h24_pts = _q("""
        SELECT latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) AND h24 = true
    """)
    # Parks
    park_count = _q1("""
        SELECT
            SUM(CASE WHEN is_in_nature_park THEN 1 ELSE 0 END) AS in_park,
            COUNT(*) AS total
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """)
    top3_parks = _q("""
        SELECT dp.name AS park_name, dp.type AS park_type, COUNT(*) AS cnt
        FROM locations l
        JOIN dim_park dp ON l.nature_park_id = dp.id
        WHERE l.deleted_at IS NULL AND l.snapshot_id = (SELECT MAX(id) FROM snapshots)
        GROUP BY dp.name, dp.type ORDER BY cnt DESC LIMIT 3
    """)
    # Void
    void_ff = _q1("SELECT value, lat, lon FROM fun_facts WHERE key='farthest_from_zabka'")
    # Frog streets (plural water/frog names)
    frog_streets = _q("""
        SELECT street, city, voivodeship, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND (LOWER(street) LIKE '%żab%'
            OR LOWER(street) LIKE '%stawow%'
            OR LOWER(street) LIKE '%stawki%'
            OR LOWER(street) LIKE '%bagienn%'
            OR LOWER(street) LIKE '%jeziorow%')
        ORDER BY
            CASE WHEN LOWER(street) LIKE '%żab%' THEN 0 ELSE 1 END,
            city
        LIMIT 20
    """)
    # Powiats covered
    powiat_count = _q1("""
        SELECT COUNT(DISTINCT powiat_id) FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """)
    powiat_range = _q("""
        WITH pc AS (
            SELECT dp.name AS p, dv.name AS v, COUNT(l.id) AS cnt
            FROM dim_powiat dp
            JOIN dim_voivodeship dv ON dv.id = dp.voivodeship_id
            LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL AND l.snapshot_id = (SELECT MAX(id) FROM snapshots)
            GROUP BY dp.name, dv.name HAVING cnt > 0
        )
        SELECT * FROM (SELECT 'min' AS w, p, v, cnt FROM pc ORDER BY cnt ASC LIMIT 1)
        UNION ALL
        SELECT * FROM (SELECT 'max', p, v, cnt FROM pc ORDER BY cnt DESC LIMIT 1)
    """)
    # Civic streets (LIKE aggregation — one pass)
    civic = _q1("""
        SELECT
            SUM(CASE WHEN UPPER(street) LIKE '%RYNEK%'           THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%ko%ciuszk%'       THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%pi%sudsk%'        THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%wojska polsk%'    THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%mickiewicz%'      THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%jana paw%a%'      THEN 1 ELSE 0 END)
        FROM locations WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """)
    # Physical streets: top streets by store count, grouped by street NAME (number stripped)
    physical_streets = _q("""
        WITH cleaned AS (
            SELECT
                TRIM(REGEXP_REPLACE(
                    REGEXP_REPLACE(TRIM(street), '^[a-zA-Z]{2,4}\\.\s*', ''),
                    '\s+\d[\dA-Za-z/\\-,\\.\\s]*$',
                    ''
                )) AS street_name,
                city
            FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
              AND street IS NOT NULL AND street != '' AND street != 'nieokreslona'
              AND LOWER(street) NOT LIKE '%nieokresl%'
        )
        SELECT street_name, city, COUNT(*) AS cnt
        FROM cleaned
        WHERE street_name != '' AND LENGTH(street_name) > 1
        GROUP BY street_name, city
        HAVING COUNT(*) >= 2
        ORDER BY cnt DESC
        LIMIT 15
    """)
    return {
        "h24_cities": [
            {"city": r[0], "voivodeship": r[1], "cnt": int(r[2])} for r in h24_cities
        ],
        "h24_points": [
            [round(float(r[0]), 4), round(float(r[1]), 4)] for r in h24_pts
        ],
        "parks": {
            "count": int(park_count[0] or 0) if park_count else 0,
            "total": int(park_count[1] or 0) if park_count else 0,
            "top3": [{"park_name": r[0], "park_type": r[1], "cnt": int(r[2])}
                     for r in top3_parks],
        },
        "void": {
            "value": round(float(void_ff[0]), 2) if void_ff else 46.52,
            "lat":   float(void_ff[1]) if void_ff else 49.01,
            "lon":   float(void_ff[2]) if void_ff else 22.89,
        },
        "frog_streets": [
            {"street": r[0], "city": r[1], "voivodeship": r[2],
             "latitude": float(r[3]), "longitude": float(r[4])}
            for r in frog_streets
        ],
        "frog_streets_count": len(frog_streets),
        "powiats_covered": int(powiat_count[0] or 0) if powiat_count else 0,
        "powiat_range": [
            {"which": r[0], "powiat": r[1], "voivodeship": r[2], "cnt": int(r[3])}
            for r in powiat_range
        ],
        "civic_streets": {
            "rynek":           int(civic[0] or 0) if civic else 0,
            "kosciuszki":      int(civic[1] or 0) if civic else 0,
            "pilsudskiego":    int(civic[2] or 0) if civic else 0,
            "wojska_polskiego":int(civic[3] or 0) if civic else 0,
            "mickiewicza":     int(civic[4] or 0) if civic else 0,
            "jana_pawla_ii":   int(civic[5] or 0) if civic else 0,
        },
        "physical_streets": [
            {"street": r[0], "city": r[1], "cnt": int(r[2])}
            for r in physical_streets
        ],
    }


# ---------------------------------------------------------------------------
# Parks stores: lat/lon of stores inside nature parks
# ---------------------------------------------------------------------------

@router.get("/stats/parks-stores")
@cached(ttl=3600)
async def parks_stores():
    rows = client.execute("""
        SELECT latitude, longitude
        FROM locations
        WHERE is_in_nature_park = TRUE AND deleted_at IS NULL
          AND snapshot_id = (SELECT MAX(id) FROM snapshots)
    """).fetchall()
    return [[round(float(r[0]), 6), round(float(r[1]), 6)] for r in rows]


# ---------------------------------------------------------------------------
# On-demand: Sunday drilldown (not cached — fires only on choropleth click)
# ---------------------------------------------------------------------------

_STREET_NUM_RE = re.compile(r"\s+\d.*$")
_STREET_UL_RE = re.compile(r"^ul\.?\s*", re.IGNORECASE)


def _norm_street(s: str) -> str:
    """Strip the 'ul.' prefix and the house number, keep the bare street name."""
    s = _STREET_UL_RE.sub("", (s or "").strip())
    s = _STREET_NUM_RE.sub("", s)
    return s.strip()


@router.get("/stats/common-streets")
@cached(ttl=3600)
async def common_streets(limit: int = 15):
    """Most common street names a Zabka sits on, across the whole country.
    Names are normalized (drop 'ul.' + house number, merge case variants) and the
    most frequent original casing is kept for display. Story: Zabka stands where
    Poland names its squares and heroes - Rynek, Kosciuszki, Pilsudskiego."""
    rows = _q("""
        SELECT street FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND street IS NOT NULL AND street <> '' AND street <> 'nieokreślona'
    """)
    counts: Counter = Counter()
    forms: dict[str, Counter] = defaultdict(Counter)
    for (st,) in rows:
        raw = _norm_street(st)
        if not raw or raw.isdigit():
            continue
        key = raw.lower()
        counts[key] += 1
        forms[key][raw] += 1
    lim = max(1, min(int(limit), 50))
    streets = [{"name": forms[k].most_common(1)[0][0], "cnt": int(c)}
               for k, c in counts.most_common(lim)]
    return {"streets": streets, "distinct": len(counts)}


@router.get("/stats/gmina-leaders")
@cached(ttl=3600)
async def gmina_leaders(limit: int = 12):
    """Gmina-level density leaders. The per-1000-residents ranking is dominated by
    seaside and mountain resorts (Rewal, Dziwnow, Leba, Karpacz, Zakopane): the
    network follows tourist traffic, not the registered population. Voivodeship-level
    per-capita averages hide this entirely. Caveat: 'population' is registered
    residents, so resort towns are overstated in summer - that overstatement IS the
    story. per_km2 leaders are the big cities (Warszawa, Wroclaw)."""
    rows = _gmina_agg()
    per1k = sorted((r for r in rows if r.get("per_1k") and r.get("cnt", 0) >= 3),
                   key=lambda x: -x["per_1k"])[:max(1, min(int(limit), 30))]
    per_km2 = sorted((r for r in rows if r.get("per_km2") and r.get("cnt", 0) >= 5),
                     key=lambda x: -x["per_km2"])[:max(1, min(int(limit), 30))]

    def shape(r):
        return {"name": r["name"], "voivodeship": r["voivodeship"], "cnt": r["cnt"],
                "population": r["population"], "area_km2": r["area_km2"],
                "per_1k": r["per_1k"], "per_km2": r["per_km2"]}

    # national per-1000 baseline (active stores / sum of voivodeship populations)
    total = _q1("""SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL
                   AND snapshot_id = (SELECT MAX(id) FROM snapshots)""")
    nat_pop = sum(_pop(n) for n in VOIV_AREA_KM2)  # canonical names -> GUS pop
    nat_per_1k = round((total[0] or 0) * 1000.0 / nat_pop, 3) if nat_pop else None
    return {"per_1k": [shape(r) for r in per1k],
            "per_km2": [shape(r) for r in per_km2],
            "national_per_1k": nat_per_1k}


@router.get("/stats/twins")
@cached(ttl=3600)
async def twins():
    """The opposite of the 'loner': how often a Zabka sits right next to another
    Zabka. Counts within 50/100/200 m and the closest pairs (some share one
    address). Counterpart to /stats/neighbor-stats."""
    snap = "(SELECT MAX(id) FROM snapshots)"
    base = (f"FROM locations WHERE deleted_at IS NULL AND snapshot_id = {snap} "
            "AND nearest_neighbor_distance_meters IS NOT NULL")
    agg = _q1(f"""
        SELECT
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 50  THEN 1 ELSE 0 END),
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 100 THEN 1 ELSE 0 END),
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 200 THEN 1 ELSE 0 END),
            COUNT(*)
        {base}
    """)
    # closest distinct addresses with a non-zero gap (exact-0 pairs are the
    # same-building clusters, surfaced separately below)
    closest = _q(f"""
        SELECT city, street, MIN(nearest_neighbor_distance_meters) AS d
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = {snap}
          AND nearest_neighbor_distance_meters IS NOT NULL
          AND nearest_neighbor_distance_meters > 0
        GROUP BY city, street
        ORDER BY d ASC, city
        LIMIT 8
    """)
    clusters = _q(f"""
        SELECT city, street, COUNT(*) AS n
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = {snap}
        GROUP BY city, street, ROUND(latitude, 5), ROUND(longitude, 5)
        HAVING COUNT(*) > 1
        ORDER BY n DESC, city
        LIMIT 8
    """)
    within50 = int(agg[0] or 0) if agg else 0
    return {
        "within_50m": within50,
        "within_100m": int(agg[1] or 0) if agg else 0,
        "within_200m": int(agg[2] or 0) if agg else 0,
        "total": int(agg[3] or 0) if agg else 0,
        "closest_pairs": [{"city": r[0], "street": r[1],
                           "distance_m": int(r[2])} for r in closest],
        "same_address": [{"city": r[0], "street": r[1], "n": int(r[2])}
                         for r in clusters],
    }


@router.get("/stats/neighbor-by-level")
@cached(ttl=3600)
async def neighbor_by_level(level: str = "voivodeship", sort: str = "desc",
                            metric: str = "median_m", limit: int = 20):
    """Rank voivodeships / powiats / cities by the typical distance between
    neighbouring Zabki (median and average of nearest_neighbor_distance_meters).
    High = a spread-out network (podkarpackie 459 m), low = a packed one
    (mazowieckie, dolnoslaskie ~240 m). Inverse density, read from the stores
    themselves rather than from area. Returns both metrics; the frontend toggles."""
    col = {"voivodeship": "voivodeship", "powiat": "powiat", "city": "city"}.get(level)
    if not col:
        return {"rows": [], "total": 0, "level": level}
    min_n = {"voivodeship": 20, "powiat": 15, "city": 10}[level]
    rows = _q(f"""
        SELECT {col} AS name, ANY_VALUE(voivodeship) AS voiv, COUNT(*) AS n,
               ROUND(MEDIAN(nearest_neighbor_distance_meters)) AS med,
               ROUND(AVG(nearest_neighbor_distance_meters))    AS avg
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND nearest_neighbor_distance_meters IS NOT NULL
          AND {col} IS NOT NULL AND {col} <> ''
        GROUP BY {col}
        HAVING COUNT(*) >= {min_n}
    """)
    out = [{"name": r[0], "voivodeship": r[1], "n": int(r[2]),
            "median_m": int(r[3] or 0), "avg_m": int(r[4] or 0)} for r in rows]
    sort_key = "avg_m" if metric == "avg_m" else "median_m"
    out.sort(key=lambda x: x[sort_key], reverse=(sort != "asc"))
    lim = max(1, min(int(limit), 100))
    return {"rows": out[:lim], "total": len(out), "level": level, "metric": sort_key}


@router.get("/geo/voivodeships")
@cached(ttl=86400)
async def geo_voivodeships():
    path = _GEO_DIR / "wojewodztwa.geojson"
    return Response(content=path.read_bytes(), media_type="application/json")


@router.get("/stats/powiat-coverage")
@cached(ttl=86400)
async def powiat_coverage():
    """One representative dot per administrative powiat (380), from the powiaty
    GeoJSON bounding boxes. Used by the Historia tile "Zabka jest w kazdym
    powiecie". The denominator is the geojson feature count (314 land powiats +
    66 cities with powiat rights = 380), not dim_powiat — dim_powiat is inflated
    by a handful of phantom (name, voivodeship) pairs from border geocoding."""
    gj = json.loads((_GEO_DIR / "powiaty.geojson").read_bytes())
    dots = []
    for f in gj.get("features", []):
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates")
        if not coords:
            continue
        lon_min = lat_min = float("inf")
        lon_max = lat_max = float("-inf")
        stack = [coords]
        while stack:
            c = stack.pop()
            if c and isinstance(c[0], (int, float)):
                lon, lat = c[0], c[1]
                lon_min, lon_max = min(lon_min, lon), max(lon_max, lon)
                lat_min, lat_max = min(lat_min, lat), max(lat_max, lat)
            else:
                stack.extend(c)
        if lon_min != float("inf"):
            dots.append([round((lat_min + lat_max) / 2, 4),
                         round((lon_min + lon_max) / 2, 4)])
    total = len(dots)
    return {"total": total, "covered": total, "dots": dots}


@router.get("/stats/by-dimension")
@cached(ttl=3600)
async def by_dimension(dim: str = "voivodeship", metric: str = "count",
                       sort: str = "desc", limit: int = 20, offset: int = 0):
    """Stores aggregated by a chosen geographic dimension, with three metrics.
    The Historia granularity switch is the `dim` param, the metric switch is
    `metric`, and the sort button is `sort` — the backend only changes GROUP BY /
    ordering / paging.

    dim in {voivodeship, powiat, city}; metric in {count, per1k, per_km2};
    sort in {desc, asc}. population comes from the dim's `population` column and
    area_km2 from the GeoJSON, so per-capita and per-km2 work at voivodeship and
    powiat level; city has neither (those metrics are null there). powiat names are
    returned without the "powiat " prefix; `geo_id` matches the GeoJSON feature
    (voivodeship name / powiat feature id) for the choropleth. Returns
    {rows, total} so the frontend knows whether "load more" has more rows.
    A large limit (e.g. 1000) returns every unit for the map."""
    snap = "(SELECT MAX(id) FROM snapshots)"
    lim = max(1, min(int(limit), 3000))
    off = max(0, int(offset))

    if dim == "city":
        cg = _city_geo()["by"]
        raw = _q(f"""
            SELECT city, voivodeship, COUNT(*), AVG(latitude), AVG(longitude)
            FROM locations
            WHERE deleted_at IS NULL AND snapshot_id = {snap}
              AND city IS NOT NULL AND city <> ''
            GROUP BY city, voivodeship HAVING COUNT(*) > 0
        """)
        rows = []
        for city, voiv, cnt, lat, lon in raw:
            g = cg.get((voiv, (city or "").strip().lower()), {})
            pop, area = g.get("population"), g.get("area")
            rows.append({"name": city, "cnt": cnt, "population": pop, "area_km2": area,
                         "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                         "per_km2": round(cnt / area, 3) if area else None,
                         "lat": lat, "lon": lon, "voivodeship": voiv, "geo_id": None})
    elif dim == "gmina":
        # prefer the materialized dim_gmina (joined by gmina_id); fall back to the
        # API-time point-in-polygon if gmina_id hasn't been populated yet
        raw = _q(f"""
            SELECT g.name, COUNT(l.id), g.population, g.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name)
            FROM dim_gmina g
            JOIN locations l ON l.gmina_id = g.id
              AND l.deleted_at IS NULL AND l.snapshot_id = {snap}
            LEFT JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            GROUP BY g.id, g.name, g.population, g.area_km2
            HAVING COUNT(l.id) > 0
        """)
        if raw:
            rows = [{"name": r[0], "cnt": r[1], "population": r[2], "area_km2": r[3],
                     "per_1k": round(r[1] * 1000.0 / r[2], 2) if r[2] else None,
                     "per_km2": round(r[1] / r[3], 3) if r[3] else None,
                     "lat": r[4], "lon": r[5], "voivodeship": r[6], "geo_id": None}
                    for r in raw]
        else:
            rows = [dict(r) for r in _gmina_agg()]
    else:
        if dim == "powiat":
            dimtbl, fk = "dim_powiat", "powiat_id"
            # land powiats only: miasta na prawach powiatu are "powiat <Miasto>"
            # (capitalised), land powiats are "powiat xski" (lowercase)
            extra = "WHERE NOT regexp_matches(d.name, '^powiat [A-ZĄĆĘŁŃÓŚŹŻ]')"
            geo = _pow_geo()
        else:
            dimtbl, fk = "dim_voivodeship", "voivodeship_id"
            extra = ""
            varea = _voiv_area()
        raw = _q(f"""
            SELECT d.name, COUNT(l.id), d.population,
                   AVG(l.latitude), AVG(l.longitude), MAX(l.voivodeship)
            FROM {dimtbl} d
            LEFT JOIN locations l
              ON l.{fk} = d.id AND l.deleted_at IS NULL AND l.snapshot_id = {snap}
            {extra}
            GROUP BY d.id, d.name, d.population
            HAVING COUNT(l.id) > 0
        """)
        rows = []
        for name, cnt, pop, lat, lon, voiv in raw:
            if dim == "powiat":
                disp = _strip_pow(name)
                g = geo.get((voiv, disp.lower()), {})
                area, gid = g.get("area"), g.get("id")
            else:
                disp, area, gid = name, varea.get(name), name
            rows.append({
                "name": disp, "cnt": cnt, "population": pop, "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat, "lon": lon, "voivodeship": voiv, "geo_id": gid,
            })

    keyf = {"per1k": lambda x: x["per_1k"] or 0,
            "per_km2": lambda x: x["per_km2"] or 0}.get(metric, lambda x: x["cnt"] or 0)
    rows.sort(key=keyf, reverse=(sort != "asc"))
    # Full-dataset stats for AVG/MED annotation lines (over all rows, not just visible page)
    full_vals = [keyf(r) for r in rows]
    if full_vals:
        full_sum = sum(full_vals)
        full_avg = full_sum / len(full_vals)
        s = sorted(full_vals)
        n = len(s)
        full_median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    else:
        full_sum = full_avg = full_median = 0
    return {"rows": rows[off:off + lim], "total": len(rows),
            "dim": dim, "metric": metric, "sort": sort,
            "avg": round(full_avg, 3), "median": round(full_median, 3),
            "sum": full_sum}


@router.get("/stats/city-coverage")
@cached(ttl=3600)
async def city_coverage():
    """How many official Polish cities (miasta, from dim_miasto/GUS) have at least
    one Zabka — answers 'jaki procent polskich miast ma Zabke'. Matching is by
    normalised name, so it is a close estimate, not exact."""
    cg = _city_geo()
    cities = cg["cities"]
    total = len(cities)
    zab = set()
    for r in _q("""
        SELECT DISTINCT lower(trim(voivodeship)), lower(trim(city)) FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND city IS NOT NULL AND city <> ''
    """):
        zab.add((r[0], r[1]))
    covered = sum(1 for c in cities
                  if ((c.get("voivodeship") or "").lower(), c.get("norm") or "") in zab)
    zab_localities = len({c for _, c in zab})
    return {"total_cities": total, "with_zabka": covered,
            "without_zabka": total - covered,
            "pct": round(100.0 * covered / total, 1) if total else 0,
            "zabka_localities": zab_localities}


@router.get("/stats/coverage-funnel")
@cached(ttl=3600)
async def coverage_funnel():
    """Coverage funnel across the three administrative levels, coarse -> fine:
    powiaty (every powiat has a Żabka) -> miasta -> gminy. Each level: units with
    at least one Żabka, total units, and the percentage. Reuses powiat-coverage /
    city-coverage; gmina counts come from dim_gmina + locations.gmina_id (with the
    point-in-polygon aggregate as a fallback before materialisation)."""
    pc = await powiat_coverage()
    cc = await city_coverage()
    total_gminas = len(_gmina_geo()["items"])
    row = _q1("""
        SELECT COUNT(DISTINCT gmina_id) FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND gmina_id IS NOT NULL
    """)
    gminas_with = (row[0] if row and row[0] else len(_gmina_agg()))

    def node(level, w, t):
        return {"level": level, "with": w, "total": t,
                "pct": round(100.0 * w / t, 1) if t else 0}

    return [
        node("powiaty", pc["covered"], pc["total"]),
        node("miasta", cc["with_zabka"], cc["total_cities"]),
        node("gminy", gminas_with, total_gminas),
    ]


@router.get("/stats/openings-monthly")
@cached(ttl=3600)
async def openings_monthly():
    """Openings per (year, month) from first_opening_date — feeds the
    'Kalendarz ekspansji' heatmap (one cell per month) and the monthly view of
    the growth chart."""
    rows = _q("""
        SELECT CAST(EXTRACT(year FROM first_opening_date) AS INT) AS y,
               CAST(EXTRACT(month FROM first_opening_date) AS INT) AS m,
               COUNT(*) AS c
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2
    """)
    return [{"year": r[0], "month": r[1], "cnt": r[2]} for r in rows]


@router.get("/geo/powiats")
@cached(ttl=86400)
async def geo_powiats():
    return Response(content=(_GEO_DIR / "powiaty.geojson").read_bytes(),
                    media_type="application/json")


@router.get("/stats/sunday-closed-stores")
async def sunday_closed_stores(voivodeship: str):
    rows = _q("""
        SELECT city, street, has_merrychef
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)
          AND voivodeship = ?
          AND open_sunday = false
        ORDER BY city, street
    """, [voivodeship])
    return [{"city": r[0], "street": r[1], "has_merrychef": bool(r[2])} for r in rows]
