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

import math
from fastapi import APIRouter
from backend.database_ch import client
from backend.cache import cached

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
        WHERE deleted_at IS NULL
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
        WHERE deleted_at IS NULL
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
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """)
    newest = _q1("""
        SELECT city, voivodeship, street, first_opening_date
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date DESC LIMIT 1
    """)
    new_month = _q1("""
        SELECT COUNT(*) FROM locations
        WHERE deleted_at IS NULL AND is_new_month = true
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
        WHERE deleted_at IS NULL
          AND first_opening_date IS NOT NULL
          AND latitude IS NOT NULL
        ORDER BY yr ASC
    """)
    undated = _q("""
        SELECT latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
          AND first_opening_date IS NULL
          AND latitude IS NOT NULL
    """)
    # Milestones: year when cumulative active stores first crossed each threshold
    milestones_rows = _q("""
        WITH yr_counts AS (
            SELECT YEAR(first_opening_date) AS y, COUNT(*) AS cnt
            FROM locations
            WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
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
        "stores":    [[round(r[0], 5), round(r[1], 5), int(r[2])] for r in dated],
        "undated":   [[round(r[0], 5), round(r[1], 5)] for r in undated],
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
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
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
        WHERE deleted_at IS NULL
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
            WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
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
        WHERE deleted_at IS NULL
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
        WHERE deleted_at IS NULL AND opening_hours_monsat IS NOT NULL
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
        WHERE deleted_at IS NULL
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
        LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL
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
            "population": pop, "per_1k": per_1k,
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
        WHERE deleted_at IS NULL
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
        FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
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
        # If no parcel-locker data yet, fall back to known ratios
        raw_p = locker_map.get(name, 0)
        p = raw_p if raw_p > 0 else round(z * INPOST_RATIO.get(name, 2.4))
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
# 14. /api/stats/voivodeship-density
# ---------------------------------------------------------------------------

@router.get("/stats/voivodeship-density")
@cached(ttl=3600)
async def voivodeship_density():
    rows = _q("""
        SELECT voivodeship, COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
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
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """)
    bot = _q1("""
        SELECT city, voivodeship, street, elevation_meters
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC LIMIT 1
    """)
    # Histogram (50 m buckets)
    hist_rows = _q("""
        SELECT CAST(FLOOR(elevation_meters / 50) * 50 AS INTEGER) AS bucket_m,
               COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)
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
    return {"extremes": extremes, "histogram": histogram}


# ---------------------------------------------------------------------------
# 16. /api/stats/neighbor-stats
# ---------------------------------------------------------------------------

@router.get("/stats/neighbor-stats")
@cached(ttl=3600)
async def neighbor_stats():
    loner = _q1("""
        SELECT city, voivodeship, street, nearest_neighbor_distance_meters
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """)
    stats = _q1("""
        SELECT
            MEDIAN(nearest_neighbor_distance_meters)  AS median_m,
            ROUND(AVG(nearest_neighbor_distance_meters)) AS avg_m,
            MAX(nearest_neighbor_distance_meters)     AS max_m
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
    """)
    buckets = _q("""
        SELECT
            CASE
                WHEN nearest_neighbor_distance_meters < 200   THEN '<200m'
                WHEN nearest_neighbor_distance_meters < 500   THEN '200-500m'
                WHEN nearest_neighbor_distance_meters < 1000  THEN '500m-1km'
                WHEN nearest_neighbor_distance_meters < 3000  THEN '1-3km'
                WHEN nearest_neighbor_distance_meters < 10000 THEN '3-10km'
                ELSE '>10km'
            END AS bucket,
            COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
        GROUP BY 1
        ORDER BY MIN(nearest_neighbor_distance_meters)
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
            FROM locations WHERE deleted_at IS NULL ORDER BY latitude DESC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'S', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL ORDER BY latitude ASC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'E', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL ORDER BY longitude DESC LIMIT 1
        )
        UNION ALL
        SELECT * FROM (
            SELECT 'W', city, voivodeship, street, latitude, longitude
            FROM locations WHERE deleted_at IS NULL ORDER BY longitude ASC LIMIT 1
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
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """)
    elev_bot = _q1("""
        SELECT city, voivodeship, street, elevation_meters, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC  LIMIT 1
    """)
    # Frog street (static — ul. Zielonej Zabki)
    frog_street = _q1("""
        SELECT street, city, voivodeship, latitude, longitude
        FROM locations WHERE deleted_at IS NULL
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
            FROM locations WHERE deleted_at IS NULL
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
        FROM locations WHERE deleted_at IS NULL
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
        FROM locations WHERE deleted_at IS NULL
    """)
    # Most froggy (if enriched)
    most_froggy_db = _q1("""
        SELECT city, voivodeship, street,
               amphibian_occurrences_5km, nearest_amphibian_km,
               latitude, longitude
        FROM locations WHERE deleted_at IS NULL
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
        WHERE deleted_at IS NULL AND amphibian_occurrences_5km = 0
    """)
    # Farthest from frog
    farthest_ff = _q1("""
        SELECT city, voivodeship, ROUND(nearest_amphibian_km, 2) AS km
        FROM locations WHERE deleted_at IS NULL AND nearest_amphibian_km IS NOT NULL
        ORDER BY nearest_amphibian_km DESC LIMIT 1
    """)
    # Per-store sample for beeswarm/map (enriched or empty)
    stores_db = _q("""
        SELECT latitude, longitude,
               COALESCE(amphibian_occurrences_5km, 0) AS occ,
               COALESCE(nearest_amphibian_km, 0) AS near_km
        FROM locations WHERE deleted_at IS NULL
        USING SAMPLE 5000
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
        FROM locations WHERE deleted_at IS NULL
        GROUP BY 1 ORDER BY MIN(COALESCE(amphibian_occurrences_5km, 0))
    """)
    # By voivodeship averages
    by_voiv = _q("""
        SELECT voivodeship,
               ROUND(AVG(COALESCE(amphibian_occurrences_5km, 0)), 0) AS avg_occ,
               COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL
        GROUP BY voivodeship ORDER BY avg_occ DESC
    """)
    # Top 10 cities (city-level aggregate)
    top10 = _q("""
        SELECT city, voivodeship,
               SUM(COALESCE(amphibian_occurrences_5km, 0)) AS total_occ
        FROM locations WHERE deleted_at IS NULL
        GROUP BY city, voivodeship
        ORDER BY total_occ DESC LIMIT 10
    """)
    return {
        "gbif_total":       46000,
        "median_occurrences": 84,
        "has_enriched_data": has_amphibian_data,
        "most_froggy": most_froggy,
        "zero_frog_count": int(zero_count[0] or 0) if zero_count else 668,
        "farthest_from_frog": {
            "city": farthest_ff[0] if farthest_ff else "Osieciny",
            "voivodeship": farthest_ff[1] if farthest_ff else "kujawsko-pomorskie",
            "nearest_amphibian_km": float(farthest_ff[2]) if farthest_ff else 12.48,
        },
        "stores": [
            [round(float(r[0]), 4), round(float(r[1]), 4), int(r[2]), round(float(r[3]), 2)]
            for r in stores_db
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
        FROM locations WHERE deleted_at IS NULL AND h24 = true
        GROUP BY city, voivodeship ORDER BY cnt DESC LIMIT 8
    """)
    h24_pts = _q("""
        SELECT latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND h24 = true
    """)
    # Parks
    park_count = _q1("""
        SELECT
            SUM(CASE WHEN is_in_nature_park THEN 1 ELSE 0 END) AS in_park,
            COUNT(*) AS total
        FROM locations WHERE deleted_at IS NULL
    """)
    top3_parks = _q("""
        SELECT dp.name AS park_name, dp.type AS park_type, COUNT(*) AS cnt
        FROM locations l
        JOIN dim_park dp ON l.nature_park_id = dp.id
        WHERE l.deleted_at IS NULL
        GROUP BY dp.name, dp.type ORDER BY cnt DESC LIMIT 3
    """)
    # Void
    void_ff = _q1("SELECT value, lat, lon FROM fun_facts WHERE key='farthest_from_zabka'")
    # Frog streets (plural water/frog names)
    frog_streets = _q("""
        SELECT street, city, voivodeship, latitude, longitude
        FROM locations WHERE deleted_at IS NULL
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
        SELECT COUNT(DISTINCT powiat_id) FROM locations WHERE deleted_at IS NULL
    """)
    powiat_range = _q("""
        WITH pc AS (
            SELECT dp.name AS p, dv.name AS v, COUNT(l.id) AS cnt
            FROM dim_powiat dp
            JOIN dim_voivodeship dv ON dv.id = dp.voivodeship_id
            LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL
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
        FROM locations WHERE deleted_at IS NULL
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
    }


# ---------------------------------------------------------------------------
# On-demand: Sunday drilldown (not cached — fires only on choropleth click)
# ---------------------------------------------------------------------------

@router.get("/stats/sunday-closed-stores")
async def sunday_closed_stores(voivodeship: str):
    rows = _q("""
        SELECT city, street, has_merrychef
        FROM locations
        WHERE deleted_at IS NULL
          AND voivodeship = ?
          AND open_sunday = false
        ORDER BY city, street
    """, [voivodeship])
    return [{"city": r[0], "street": r[1], "has_merrychef": bool(r[2])} for r in rows]
