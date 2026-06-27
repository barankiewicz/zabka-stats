import re
from collections import Counter, defaultdict
from typing import List, Optional, Dict, Any
from fastapi import APIRouter
from backend.database_ch import client
from backend.cache import cached, clear_cache
from backend.schemas.api_models import (
    SummaryResponse,
    NetworkGrowthItem,
    NetworkOriginResponse,
    StoreTimelineResponse,
    StoreTimelineRange,
    StoreTimelineMilestones,
    GrowthByVoivodeshipResponseItem,
    PerCapitaResponseItem,
    TopCityItem,
    OpeningSeasonalityResponseItem,
    OpeningHoursPatternItem,
    VoivodeshipStatsResponseItem,
    PowiatEconomicsItem,
    SundayByVoivodeshipResponseItem,
    InPostVsZabkaResponseItem,
    InPostVsZabkaByLevelResponse,
    InPostVsZabkaByLevelResponseItem,
    CommonStreetsResponse,
    CommonStreetItem,
    OpeningsMonthlyItem,
    SundayClosedStoreItem,
    TopStreetsResponse,
    TopStreetItem,
    GrowthTrendResponse,
    GrowthTrendItem,
    CityFirstOpeningItem
)
from backend.api.demographics import get_voiv_population

router = APIRouter()

SUNDAY_CLOSED_PCT = {
    "dolnośląskie": 10.6, "zachodniopomorskie": 9.3, "lubuskie": 9.1,
    "opolskie": 5.2, "śląskie": 4.1, "wielkopolskie": 3.8,
    "kujawsko-pomorskie": 3.5, "łódzkie": 3.2, "mazowieckie": 3.0,
    "małopolskie": 2.9, "podkarpackie": 2.7, "lubelskie": 2.5,
    "świętokrzyskie": 2.4, "warmińsko-mazurskie": 2.3, "podlaskie": 2.1,
    "pomorskie": 2.0,
}

_STREET_NUM_RE = re.compile(r"\s+\d.*$")
_STREET_UL_RE = re.compile(r"^ul\.?\s*", re.IGNORECASE)

def _norm_street(s: str) -> str:
    s = _STREET_UL_RE.sub("", (s or "").strip())
    s = _STREET_NUM_RE.sub("", s)
    return s.strip()

def _city_geo():
    cg_rows = client.execute("""
        SELECT c.name, v.name, c.population
        FROM dim_city c
        JOIN dim_voivodeship v ON v.id = c.voivodeship_id
    """).fetchall()
    by = {}
    for cname, vname, pop in cg_rows:
        if cname and vname:
            by[(vname, cname.strip().lower())] = {"population": pop}
    return {"by": by}

# --- Endpoints ---

@router.get("/stats/summary", response_model=SummaryResponse)
@cached(ttl=3600)
async def summary():
    r = client.execute("""
        SELECT
            COUNT(*) AS total_active,
            COUNT(DISTINCT city) AS cities_count,
            ROUND(100.0 * SUM(CASE WHEN has_merrychef THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1) AS merrychef_pct,
            ROUND(100.0 * SUM(CASE WHEN open_sunday THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0), 1) AS sunday_pct,
            SUM(CASE WHEN h24 THEN 1 ELSE 0 END) AS h24_count
        FROM locations
        WHERE deleted_at IS NULL 
    """).fetchone()
    return {
        "total_active": int(r[0] or 0),
        "cities_count": int(r[1] or 0),
        "merrychef_pct": float(r[2] or 0),
        "sunday_pct": float(r[3] or 0),
        "h24_count": int(r[4] or 0),
    }

@router.get("/stats/network-growth", response_model=List[NetworkGrowthItem])
@cached(ttl=3600)
async def network_growth():
    rows = client.execute("""
        SELECT
            YEAR(first_opening_date) AS year,
            COUNT(*) AS new_stores,
            SUM(COUNT(*)) OVER (ORDER BY YEAR(first_opening_date)
                                ROWS UNBOUNDED PRECEDING) AS cumulative
        FROM locations
        WHERE deleted_at IS NULL 
          AND first_opening_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """).fetchall()
    return [{"year": int(r[0]), "new_stores": int(r[1]), "cumulative": int(r[2])}
            for r in rows]

@router.get("/stats/network-origin", response_model=NetworkOriginResponse)
@cached(ttl=3600)
async def network_origin():
    oldest = client.execute("""
        SELECT city, voivodeship, street, first_opening_date, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """).fetchone()
    
    newest = client.execute("""
        SELECT city, voivodeship, street, first_opening_date, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date DESC LIMIT 1
    """).fetchone()
    
    new_month = client.execute("""
        SELECT COUNT(*) FROM locations
        WHERE deleted_at IS NULL AND is_new_month = true
    """).fetchone()
    
    def fmt_row(r):
        return {
            "city": r[0], "voivodeship": r[1] or "",
            "street": r[2] or "", "first_opening_date": str(r[3]) if r[3] else None,
            "lat": float(r[4]) if r[4] is not None else None,
            "lon": float(r[5]) if r[5] is not None else None,
        }
    return {
        "oldest": fmt_row(oldest) if oldest else {},
        "newest": fmt_row(newest) if newest else {},
        "new_this_month": int(new_month[0] or 0) if new_month else 0,
    }

@router.get("/stats/stores-timeline", response_model=StoreTimelineResponse)
@cached(ttl=3600)
async def stores_timeline():
    dated = client.execute("""
        SELECT latitude, longitude, YEAR(first_opening_date) AS yr
        FROM locations
        WHERE deleted_at IS NULL 
          AND first_opening_date IS NOT NULL
          AND latitude IS NOT NULL
        ORDER BY yr ASC
    """).fetchall()
    
    undated = client.execute("""
        SELECT latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL 
          AND first_opening_date IS NULL
          AND latitude IS NOT NULL
    """).fetchall()
    
    milestones_rows = client.execute("""
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
            MIN(CASE WHEN cum >= 1000 THEN y END),
            MIN(CASE WHEN cum >= 2000 THEN y END),
            MIN(CASE WHEN cum >= 5000 THEN y END),
            MIN(CASE WHEN cum >= 10000 THEN y END)
        FROM running
    """).fetchone()
    
    m = milestones_rows if milestones_rows else (None, None, None, None)
    year_vals = [r[2] for r in dated if r[2] is not None]
    
    return {
        "stores": [[round(r[0], 4), round(r[1], 4), int(r[2])] for r in dated],
        "undated": [[round(r[0], 4), round(r[1], 4)] for r in undated],
        "year_range": {
            "min": int(min(year_vals)) if year_vals else 1998,
            "max": int(max(year_vals)) if year_vals else 2026,
        },
        "milestones": {
            "1000": int(m[0]) if m[0] else None,
            "2000": int(m[1]) if m[1] else None,
            "5000": int(m[2]) if m[2] else None,
            "10000": int(m[3]) if m[3] else None,
        },
    }

@router.get("/stats/growth-by-voivodeship", response_model=List[GrowthByVoivodeshipResponseItem])
@cached(ttl=3600)
async def growth_by_voivodeship():
    rows = client.execute("""
        SELECT voivodeship, YEAR(first_opening_date) AS yr, COUNT(*) AS new_stores
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 2, 1
    """).fetchall()
    return [{"voivodeship": r[0] or "", "yr": int(r[1]), "new_stores": int(r[2])}
            for r in rows if r[0]]

@router.get("/stats/per-capita", response_model=List[PerCapitaResponseItem])
@cached(ttl=3600)
async def per_capita():
    rows = client.execute("""
        SELECT voivodeship, COUNT(*) AS stores
        FROM locations
        WHERE deleted_at IS NULL 
        GROUP BY voivodeship
        ORDER BY stores DESC
    """).fetchall()
    result = []
    for r in rows:
        name = r[0]
        if not name:
            continue
        stores = int(r[1])
        pop = get_voiv_population(name)
        per_1k = round(stores * 1000 / pop, 2) if pop else 0.0
        result.append({
            "voivodeship": name,
            "stores": stores,
            "population": pop,
            "per_1k": per_1k,
        })
    result.sort(key=lambda x: -x["per_1k"])
    return result

@router.get("/stats/city-first-opening", response_model=List[CityFirstOpeningItem])
@cached(ttl=3600)
async def city_first_opening():
    rows = client.execute("""
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
    """).fetchall()
    return [{"yr": int(r[0]), "new_cities": int(r[1]), "cumulative_cities": int(r[2])}
            for r in rows]

@router.get("/stats/top-cities", response_model=List[TopCityItem])
@cached(ttl=1800)
async def top_cities(limit: int = 20):
    rows = client.execute(f"""
        SELECT city, COUNT(*) AS cnt, voivodeship
        FROM locations
        WHERE deleted_at IS NULL 
        GROUP BY city, voivodeship
        ORDER BY cnt DESC
        LIMIT {max(1, min(limit, 200))}
    """).fetchall()
    return [{"city": r[0], "cnt": int(r[1]), "voivodeship": r[2] or ""} for r in rows]

@router.get("/stats/opening-seasonality", response_model=List[OpeningSeasonalityResponseItem])
@cached(ttl=3600)
async def opening_seasonality():
    rows = client.execute("""
        SELECT
            MONTH(first_opening_date) AS month,
            COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """).fetchall()
    months_pl = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paz', 'Lis', 'Gru']
    return [{"month": int(r[0]), "label": months_pl[int(r[0]) - 1], "cnt": int(r[1])} for r in rows]

@router.get("/stats/opening-hours", response_model=List[OpeningHoursPatternItem])
@cached(ttl=3600)
async def opening_hours():
    rows = client.execute("""
        SELECT opening_hours_monsat AS pattern, COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND opening_hours_monsat IS NOT NULL
        GROUP BY 1 ORDER BY cnt DESC LIMIT 8
    """).fetchall()
    return [{"pattern": r[0], "cnt": int(r[1])} for r in rows]

@router.get("/stats/voivodeship", response_model=List[VoivodeshipStatsResponseItem])
@cached(ttl=3600)
async def voivodeship_stats():
    rows = client.execute("""
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
    """).fetchall()
    return [{"voivodeship": r[0] or "", "total": int(r[1]),
             "mc_count": int(r[2] or 0), "mc_pct": float(r[3] or 0)}
            for r in rows if r[0]]

@router.get("/stats/powiat-economics", response_model=List[PowiatEconomicsItem])
@cached(ttl=3600)
async def powiat_economics():
    rows = client.execute("""
        SELECT
            dp.name AS powiat,
            dv.name AS voivodeship,
            COALESCE(dp.avg_salary, 0) AS avg_salary,
            COALESCE(dp.unemployment_rate, 0) AS unemployment_rate,
            COALESCE(dp.population, 0) AS population,
            COUNT(l.id) AS stores
        FROM dim_powiat dp
        JOIN dim_voivodeship dv ON dp.voivodeship_id = dv.id
        LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL 
        GROUP BY dp.name, dv.name, dp.avg_salary, dp.unemployment_rate, dp.population
        HAVING COUNT(l.id) > 0
        ORDER BY dp.name
    """).fetchall()
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

@router.get("/stats/sunday-by-voivodeship", response_model=List[SundayByVoivodeshipResponseItem])
@cached(ttl=3600)
async def sunday_by_voivodeship():
    rows = client.execute("""
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
    """).fetchall()
    result = []
    for r in rows:
        name = r[0]
        if not name:
            continue
        db_pct = float(r[1] or 0)
        pct = db_pct if db_pct > 0 else SUNDAY_CLOSED_PCT.get(name.lower(), 2.5)
        result.append({
            "voivodeship": name,
            "closed_pct": pct,
            "closed_count": int(r[2] or 0),
            "total": int(r[3] or 0),
        })
    return result

@router.get("/stats/inpost-vs-zabka", response_model=List[InPostVsZabkaResponseItem])
@cached(ttl=3600)
async def inpost_vs_zabka():
    zabka_rows = client.execute("""
        SELECT voivodeship, COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
    """).fetchall()
    locker_rows = client.execute("""
        SELECT dv.name, COUNT(pl.id) AS cnt
        FROM dim_voivodeship dv
        LEFT JOIN parcel_lockers pl ON pl.voivodeship_id = dv.id AND pl.deleted_at IS NULL
        GROUP BY dv.name
    """).fetchall()
    zabka_map = {r[0]: int(r[1]) for r in zabka_rows if r[0]}
    locker_map = {r[0]: int(r[1]) for r in locker_rows if r[0]}
    voivodeships = list(zabka_map.keys())
    result = []
    for name in voivodeships:
        z = zabka_map.get(name, 0)
        p = locker_map.get(name, 0)
        if not z or not p:
            continue
        pop = get_voiv_population(name)
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

@router.get("/stats/inpost-vs-zabka-by-level", response_model=InPostVsZabkaByLevelResponse)
@cached(ttl=3600)
async def inpost_vs_zabka_by_level(level: str = "voivodeship", sort: str = "desc",
                                    limit: int = 20, offset: int = 0):
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))

    if level == "voivodeship":
        zabka_rows = client.execute("""
            SELECT voivodeship, COUNT(*) AS cnt
            FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
        """).fetchall()
        locker_rows = client.execute("""
            SELECT dv.name, COUNT(pl.id) AS cnt
            FROM dim_voivodeship dv
            LEFT JOIN parcel_lockers pl ON pl.voivodeship_id = dv.id AND pl.deleted_at IS NULL
            GROUP BY dv.name
        """).fetchall()
        zabka_map = {r[0]: int(r[1]) for r in zabka_rows if r[0]}
        locker_map = {r[0]: int(r[1]) for r in locker_rows if r[0]}
        rows = []
        for name in zabka_map:
            z = zabka_map.get(name, 0)
            p = locker_map.get(name, 0)
            if not z or not p:
                continue
            pop = get_voiv_population(name)
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": name, "voivodeship": name,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1) if pop else 0.0,
                "lockers_per_100k": round(p * 100000 / pop, 1) if pop else 0.0,
                "ratio": ratio,
            })
    elif level == "powiat":
        zabka_rows = client.execute("""
            SELECT dp.name, v.name, dp.population, COUNT(l.id)
            FROM dim_powiat dp
            JOIN dim_voivodeship v ON v.id = dp.voivodeship_id
            JOIN locations l ON l.powiat_id = dp.id
                AND l.deleted_at IS NULL 
            GROUP BY dp.id, dp.name, v.name, dp.population
        """).fetchall()
        locker_rows = client.execute("""
            SELECT dp.name, v.name, COUNT(pl.id)
            FROM dim_powiat dp
            JOIN dim_voivodeship v ON v.id = dp.voivodeship_id
            JOIN parcel_lockers pl ON pl.powiat_id = dp.id AND pl.deleted_at IS NULL
            GROUP BY dp.id, dp.name, v.name
        """).fetchall()
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
        zabka_rows = client.execute("""
            SELECT voivodeship, city, COUNT(*) AS cnt
            FROM locations WHERE deleted_at IS NULL 
              AND city IS NOT NULL AND city <> ''
            GROUP BY voivodeship, city HAVING COUNT(*) > 0
        """).fetchall()
        locker_rows = client.execute("""
            SELECT voivodeship, city, COUNT(*) AS cnt
            FROM parcel_lockers
            WHERE city IS NOT NULL AND city <> '' AND deleted_at IS NULL
            GROUP BY voivodeship, city
        """).fetchall()
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
        zabka_rows = client.execute("""
            SELECT g.name, v.name, g.population, COUNT(l.id)
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            JOIN locations l ON l.gmina_id = g.id
                AND l.deleted_at IS NULL 
            GROUP BY g.id, g.name, v.name, g.population
        """).fetchall()
        locker_rows = client.execute("""
            SELECT g.name, v.name, COUNT(pl.id)
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            JOIN parcel_lockers pl ON pl.powiat_id = g.powiat_id AND pl.deleted_at IS NULL
            GROUP BY g.id, g.name, v.name
        """).fetchall()
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

@router.get("/stats/common-streets", response_model=CommonStreetsResponse)
@cached(ttl=3600)
async def common_streets(limit: int = 15):
    rows = client.execute("""
        SELECT street FROM locations
        WHERE deleted_at IS NULL 
          AND street IS NOT NULL AND street <> '' AND street <> 'nieokreślona'
    """).fetchall()
    counts = Counter()
    forms = defaultdict(Counter)
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

@router.get("/stats/openings-monthly", response_model=List[OpeningsMonthlyItem])
@cached(ttl=3600)
async def openings_monthly():
    rows = client.execute("""
        SELECT CAST(EXTRACT(year FROM first_opening_date) AS INT) AS y,
               CAST(EXTRACT(month FROM first_opening_date) AS INT) AS m,
               COUNT(*) AS c
        FROM locations
        WHERE deleted_at IS NULL 
          AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()
    return [{"year": r[0], "month": r[1], "cnt": r[2]} for r in rows]

@router.get("/stats/sunday-closed-stores", response_model=List[SundayClosedStoreItem])
async def sunday_closed_stores(voivodeship: str):
    rows = client.execute("""
        SELECT city, street, has_merrychef
        FROM locations
        WHERE deleted_at IS NULL 
          AND voivodeship = ?
          AND open_sunday = false
        ORDER BY city, street
    """, [voivodeship]).fetchall()
    return [{"city": r[0], "street": r[1] or "", "has_merrychef": bool(r[2])} for r in rows]

# --- Ported from legacy aggregates_router_cached ---

@router.get("/stats/top-streets", response_model=TopStreetsResponse)
@cached(ttl=1800)
async def get_top_streets(limit: int = 20, month: str = None):
    if month:
        where = f"street IS NOT NULL AND strftime(created_at, '%Y-%m') <= '{month}' AND (deleted_at IS NULL OR strftime(deleted_at, '%Y-%m') >= '{month}')"
    else:
        where = "deleted_at IS NULL AND street IS NOT NULL"

    results = client.execute(f"""
        SELECT street, city, COUNT(*) as count
        FROM locations
        WHERE {where}
        GROUP BY street, city
        ORDER BY count DESC
        LIMIT {limit}
    """).fetchall()

    return {
        "data": [
            {"street": r[0] or "", "city": r[1], "count": r[2]}
            for r in results
        ]
    }

@router.get("/trends/growth", response_model=GrowthTrendResponse)
@cached(ttl=3600)
async def get_growth_trend():
    results = client.execute("""
        WITH daily_changes AS (
            SELECT CAST(created_at AS DATE) as event_date, 1 as change
            FROM locations
            UNION ALL
            SELECT CAST(deleted_at AS DATE) as event_date, -1 as change
            FROM locations
            WHERE deleted_at IS NOT NULL
        ),
        aggregated_changes AS (
            SELECT event_date, SUM(change) as net_change
            FROM daily_changes
            GROUP BY event_date
        )
        SELECT event_date, SUM(net_change) OVER (ORDER BY event_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as count
        FROM aggregated_changes
        ORDER BY event_date
    """).fetchall()

    return {
        "data": [
            {"date": str(r[0]), "count": r[1]}
            for r in results
        ]
    }

@router.post("/cache/clear")
async def clear_all_cache():
    clear_cache("*")
    return {"status": "cache cleared"}
