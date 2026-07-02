import re
from collections import Counter, defaultdict

from litestar import Response, Router, get, post
from litestar.params import FromQuery
from litestar.serialization import encode_json

from backend.api.demographics import get_voiv_population
from backend.cache import cached, clear_cache, get_cached_blob, set_cached_blob
from backend.database_ch import client
from backend.schemas.api_models import (
    CityFirstOpeningItem,
    CommonStreetItem,
    CommonStreetsResponse,
    GrowthByVoivodeshipResponseItem,
    GrowthTrendItem,
    GrowthTrendResponse,
    InPostVsZabkaByLevelResponse,
    InPostVsZabkaByLevelResponseItem,
    InPostVsZabkaResponseItem,
    NetworkGrowthItem,
    NetworkOriginResponse,
    OpeningHoursPatternItem,
    OpeningSeasonalityResponseItem,
    OpeningsMonthlyItem,
    PerCapitaResponseItem,
    PowiatEconomicsItem,
    StoreTimelineMilestones,
    StoreTimelineRange,
    StoreTimelineResponse,
    SummaryResponse,
    SundayByVoivodeshipResponseItem,
    SundayClosedStoreItem,
    TopCityItem,
    TopStreetItem,
    TopStreetsResponse,
    VoivodeshipStatsResponseItem,
)

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

@get("/stats/summary", sync_to_thread=True)
@cached(ttl=3600)
def summary() -> SummaryResponse:
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
    return SummaryResponse(
        total_active=int(r[0] or 0),
        cities_count=int(r[1] or 0),
        merrychef_pct=float(r[2] or 0),
        sunday_pct=float(r[3] or 0),
        h24_count=int(r[4] or 0)
    )

@get("/stats/network-growth", sync_to_thread=True)
@cached(ttl=3600)
def network_growth() -> list[NetworkGrowthItem]:
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
    return [NetworkGrowthItem(year=int(r[0]), new_stores=int(r[1]), cumulative=int(r[2]))
            for r in rows]

@get("/stats/network-origin", sync_to_thread=True)
@cached(ttl=3600)
def network_origin() -> NetworkOriginResponse:
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
    return NetworkOriginResponse(
        oldest=fmt_row(oldest) if oldest else {},
        newest=fmt_row(newest) if newest else {},
        new_this_month=int(new_month[0] or 0) if new_month else 0
    )

@get("/stats/stores-timeline", sync_to_thread=True)
def stores_timeline() -> Response:
    # ~13k [lat,lon,year] triples + milestones (~300 KB). Cache the serialized
    # string and serve it pre-encoded, so warm hits skip the DB scans, the 13k
    # Python build, and the dict-cache re-parse/re-encode. Bytes are unchanged.
    cached_blob = get_cached_blob("stores_timeline")
    if cached_blob is not None:
        return Response(cached_blob, media_type="application/json")

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
    # `dated` is ordered by year asc, so the range is just the first/last row -
    # no need to build and scan a 13k-element list for min/max.
    year_min = int(dated[0][2]) if dated else 1998
    year_max = int(dated[-1][2]) if dated else 2026

    payload = {
        "stores": [[round(r[0], 4), round(r[1], 4), int(r[2])] for r in dated],
        "undated": [[round(r[0], 4), round(r[1], 4)] for r in undated],
        "year_range": {"min": year_min, "max": year_max},
        "milestones": {
            "m1000": int(m[0]) if m[0] else None,
            "m2000": int(m[1]) if m[1] else None,
            "m5000": int(m[2]) if m[2] else None,
            "m10000": int(m[3]) if m[3] else None,
        },
    }
    blob = encode_json(payload)
    set_cached_blob("stores_timeline", blob, ttl=3600)
    return Response(blob, media_type="application/json")

@get("/stats/growth-by-voivodeship", sync_to_thread=True)
@cached(ttl=3600)
def growth_by_voivodeship() -> list[GrowthByVoivodeshipResponseItem]:
    rows = client.execute("""
        SELECT voivodeship, YEAR(first_opening_date) AS yr, COUNT(*) AS new_stores
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 2, 1
    """).fetchall()
    return [GrowthByVoivodeshipResponseItem(voivodeship=r[0] or "", yr=int(r[1]), new_stores=int(r[2]))
            for r in rows if r[0]]

@get("/stats/per-capita", sync_to_thread=True)
@cached(ttl=3600)
def per_capita() -> list[PerCapitaResponseItem]:
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
        result.append(
            PerCapitaResponseItem(
                voivodeship=name,
                stores=stores,
                population=pop,
                per_1k=per_1k
            )
        )
    result.sort(key=lambda x: -x.per_1k)
    return result

@get("/stats/city-first-opening", sync_to_thread=True)
@cached(ttl=3600)
def city_first_opening() -> list[CityFirstOpeningItem]:
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
    return [CityFirstOpeningItem(yr=int(r[0]), new_cities=int(r[1]), cumulative_cities=int(r[2]))
            for r in rows]

@get("/stats/top-cities", sync_to_thread=True)
@cached(ttl=1800)
def top_cities(limit: FromQuery[int] = 20) -> list[TopCityItem]:
    rows = client.execute("""
        SELECT city, COUNT(*) AS cnt, voivodeship
        FROM locations
        WHERE deleted_at IS NULL 
        GROUP BY city, voivodeship
        ORDER BY cnt DESC
        LIMIT ?
    """, [max(1, min(limit, 200))]).fetchall()
    return [TopCityItem(city=r[0], cnt=int(r[1]), voivodeship=r[2] or "") for r in rows]

@get("/stats/opening-seasonality", sync_to_thread=True)
@cached(ttl=3600)
def opening_seasonality() -> list[OpeningSeasonalityResponseItem]:
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
    return [OpeningSeasonalityResponseItem(month=int(r[0]), label=months_pl[int(r[0]) - 1], cnt=int(r[1])) for r in rows]

@get("/stats/opening-hours", sync_to_thread=True)
@cached(ttl=3600)
def opening_hours() -> list[OpeningHoursPatternItem]:
    rows = client.execute("""
        SELECT opening_hours_monsat AS pattern, COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND opening_hours_monsat IS NOT NULL
        GROUP BY 1 ORDER BY cnt DESC LIMIT 8
    """).fetchall()
    return [OpeningHoursPatternItem(pattern=r[0], cnt=int(r[1])) for r in rows]

@get("/stats/voivodeship", sync_to_thread=True)
@cached(ttl=3600)
def voivodeship_stats() -> list[VoivodeshipStatsResponseItem]:
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
    return [VoivodeshipStatsResponseItem(voivodeship=r[0] or "", total=int(r[1]),
                                         mc_count=int(r[2] or 0), mc_pct=float(r[3] or 0))
            for r in rows if r[0]]

@get("/stats/powiat-economics", sync_to_thread=True)
@cached(ttl=3600)
def powiat_economics() -> list[PowiatEconomicsItem]:
    # Cities with powiat rights (TERYT kind >= 61) are merged into a host land
    # powiat but dp.population excludes them, so their stores would inflate
    # per_1k against a too-small denominator. Add the hosted city population.
    rows = client.execute("""
        WITH crights_pop AS (
            SELECT dc.powiat_id AS pid, SUM(dc.population) AS addpop
            FROM dim_city dc
            JOIN administrative_division ad
              ON ad.id = dc.id AND ad.level = 4 AND SUBSTR(ad.gus_id, 8, 2) >= '61'
            GROUP BY dc.powiat_id
        )
        SELECT
            dp.id AS powiat_id,
            dp.name AS powiat,
            dv.name AS voivodeship,
            COALESCE(dp.avg_salary, 0) AS avg_salary,
            COALESCE(dp.unemployment_rate, 0) AS unemployment_rate,
            COALESCE(dp.population, 0) + COALESCE(cr.addpop, 0) AS population,
            COUNT(l.store_id) AS stores,
            dp.centroid_lon, dp.centroid_lat
        FROM dim_powiat dp
        JOIN dim_voivodeship dv ON dp.voivodeship_id = dv.id
        LEFT JOIN crights_pop cr ON cr.pid = dp.id
        LEFT JOIN locations l ON l.powiat_id = dp.id AND l.deleted_at IS NULL
        GROUP BY dp.id, dp.name, dv.name, dp.avg_salary, dp.unemployment_rate, dp.population,
                 cr.addpop, dp.centroid_lon, dp.centroid_lat
        HAVING COUNT(l.store_id) > 0
        ORDER BY dp.name
    """).fetchall()
    result = []
    for r in rows:
        pop = int(r[5]) if r[5] else 0
        stores = int(r[6])
        per_1k = round(stores * 1000 / pop, 3) if pop > 0 else 0.0
        result.append(
            PowiatEconomicsItem(
                powiat_id=int(r[0]), powiat=r[1], voivodeship=r[2],
                avg_salary=float(r[3] or 0),
                unemployment_rate=float(r[4] or 0),
                population=pop, stores=stores, per_1k=per_1k,
                lon=float(r[7]) if r[7] is not None else None,
                lat=float(r[8]) if r[8] is not None else None,
            )
        )
    return result

@get("/stats/sunday-by-voivodeship", sync_to_thread=True)
@cached(ttl=3600)
def sunday_by_voivodeship() -> list[SundayByVoivodeshipResponseItem]:
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
        result.append(
            SundayByVoivodeshipResponseItem(
                voivodeship=name,
                closed_pct=pct,
                closed_count=int(r[2] or 0),
                total=int(r[3] or 0)
            )
        )
    return result

@get("/stats/inpost-vs-zabka", sync_to_thread=True)
@cached(ttl=3600)
def inpost_vs_zabka() -> list[InPostVsZabkaResponseItem]:
    zabka_rows = client.execute("""
        SELECT voivodeship, COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
    """).fetchall()
    locker_rows = client.execute("""
        SELECT dv.name, COUNT(pl.external_id) AS cnt
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
        result.append(
            InPostVsZabkaResponseItem(
                voivodeship=name,
                zabki=z,
                paczkomaty=p,
                population=pop,
                zabki_per_100k=round(z * 100000 / pop, 1) if pop else 0.0,
                lockers_per_100k=round(p * 100000 / pop, 1) if pop else 0.0,
                ratio=ratio
            )
        )
    result.sort(key=lambda x: -x.ratio)
    return result

@get("/stats/inpost-vs-zabka-by-level", sync_to_thread=True)
@cached(ttl=3600)
def inpost_vs_zabka_by_level(
    level: FromQuery[str] = "voivodeship",
    sort: FromQuery[str] = "desc",
    limit: FromQuery[int] = 20,
    offset: FromQuery[int] = 0
) -> InPostVsZabkaByLevelResponse:
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))

    if level == "voivodeship":
        zabka_rows = client.execute("""
            SELECT voivodeship, COUNT(*) AS cnt
            FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
        """).fetchall()
        locker_rows = client.execute("""
            SELECT dv.name, COUNT(pl.external_id) AS cnt
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
        # Add hosted cities-with-powiat-rights population so per-100k is not
        # inflated by their stores landing on a small land-powiat denominator.
        zabka_rows = client.execute("""
            WITH crights_pop AS (
                SELECT dc.powiat_id AS pid, SUM(dc.population) AS addpop
                FROM dim_city dc
                JOIN administrative_division ad
                  ON ad.id = dc.id AND ad.level = 4 AND SUBSTR(ad.gus_id, 8, 2) >= '61'
                GROUP BY dc.powiat_id
            )
            SELECT dp.name, v.name,
                   dp.population + COALESCE(cr.addpop, 0), COUNT(l.store_id)
            FROM dim_powiat dp
            JOIN dim_voivodeship v ON v.id = dp.voivodeship_id
            LEFT JOIN crights_pop cr ON cr.pid = dp.id
            JOIN locations l ON l.powiat_id = dp.id
                AND l.deleted_at IS NULL
            GROUP BY dp.id, dp.name, v.name, dp.population, cr.addpop
        """).fetchall()
        locker_rows = client.execute("""
            SELECT dp.name, v.name, COUNT(pl.external_id)
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
        # Join via miasto_id to avoid city-name mismatches (e.g. "M.st.Warszawa od 2002"
        # in dim_city vs "Warszawa" in locations).
        city_rows = client.execute("""
            SELECT
                c.name AS city_name,
                v.name AS voivodeship,
                c.population,
                COALESCE(z.cnt, 0) AS z_cnt,
                COALESCE(pl.cnt, 0) AS p_cnt
            FROM dim_city c
            JOIN dim_voivodeship v ON v.id = c.voivodeship_id
            LEFT JOIN (
                SELECT miasto_id, COUNT(*) AS cnt
                FROM locations
                WHERE deleted_at IS NULL AND miasto_id IS NOT NULL
                GROUP BY miasto_id
            ) z ON z.miasto_id = c.id
            LEFT JOIN (
                SELECT miasto_id, COUNT(*) AS cnt
                FROM parcel_lockers
                WHERE deleted_at IS NULL AND miasto_id IS NOT NULL
                GROUP BY miasto_id
            ) pl ON pl.miasto_id = c.id
            WHERE COALESCE(z.cnt, 0) > 0
              AND COALESCE(pl.cnt, 0) > 0
              AND c.population > 0
        """).fetchall()
        rows = []
        for city_name, voiv, pop, z, p in city_rows:
            z, p, pop = int(z), int(p), int(pop)
            # Strip GUS naming artefacts so Warsaw shows as "Warszawa"
            display = re.sub(r'^\s*M\.st\.\s*', '', str(city_name or ''))
            display = re.sub(r'\s+od\s+\d{4}\s*$', '', display).strip()
            ratio = round(p / z, 2) if z else 0.0
            rows.append({
                "name": display, "voivodeship": voiv,
                "zabki": z, "paczkomaty": p, "population": pop,
                "zabki_per_100k": round(z * 100000 / pop, 1),
                "lockers_per_100k": round(p * 100000 / pop, 1),
                "ratio": ratio,
            })
    elif level == "gmina":
        zabka_rows = client.execute("""
            SELECT g.name, v.name, g.population, COUNT(l.store_id)
            FROM dim_gmina g
            JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            JOIN locations l ON l.gmina_id = g.id
                AND l.deleted_at IS NULL 
            GROUP BY g.id, g.name, v.name, g.population
        """).fetchall()
        locker_rows = client.execute("""
            SELECT g.name, v.name, COUNT(pl.external_id)
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
        return InPostVsZabkaByLevelResponse(rows=[], total=0, level=level)

    rows.sort(key=lambda x: (x["name"] or "", x["voivodeship"] or ""))   # stable tiebreak
    rows.sort(key=lambda x: x["ratio"] if sort != "asc" else -x["ratio"])
    total = len(rows)
    return InPostVsZabkaByLevelResponse(
        rows=[InPostVsZabkaByLevelResponseItem(**r) for r in rows[off:off + lim]],
        total=total,
        level=level
    )

@get("/stats/common-streets", sync_to_thread=True)
@cached(ttl=3600)
def common_streets(limit: FromQuery[int] = 15) -> CommonStreetsResponse:
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
    streets = [CommonStreetItem(name=forms[k].most_common(1)[0][0], cnt=int(c))
               for k, c in counts.most_common(lim)]
    return CommonStreetsResponse(streets=streets, distinct=len(counts))

@get("/stats/openings-monthly", sync_to_thread=True)
@cached(ttl=3600)
def openings_monthly() -> list[OpeningsMonthlyItem]:
    rows = client.execute("""
        SELECT CAST(EXTRACT(year FROM first_opening_date) AS INT) AS y,
               CAST(EXTRACT(month FROM first_opening_date) AS INT) AS m,
               COUNT(*) AS c
        FROM locations
        WHERE deleted_at IS NULL 
          AND first_opening_date IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()
    return [OpeningsMonthlyItem(year=r[0], month=r[1], cnt=r[2]) for r in rows]

@get("/stats/sunday-closed-stores", sync_to_thread=True)
def sunday_closed_stores(voivodeship: FromQuery[str]) -> list[SundayClosedStoreItem]:
    rows = client.execute("""
        SELECT city, street, has_merrychef
        FROM locations
        WHERE deleted_at IS NULL
          AND voivodeship = ?
          AND open_sunday = false
        ORDER BY city, street
        LIMIT 1000
    """, [voivodeship]).fetchall()
    return [SundayClosedStoreItem(city=r[0], street=r[1] or "", has_merrychef=bool(r[2])) for r in rows]

@get("/stats/top-streets", sync_to_thread=True)
@cached(ttl=1800)
def get_top_streets(limit: FromQuery[int] = 20, month: FromQuery[str | None] = None) -> TopStreetsResponse:
    limit = max(1, min(limit, 500))
    params = []
    if month:
        where = "street IS NOT NULL AND strftime(created_at, '%Y-%m') <= ? AND (deleted_at IS NULL OR strftime(deleted_at, '%Y-%m') >= ?)"
        params.extend([month, month])
    else:
        where = "deleted_at IS NULL AND street IS NOT NULL"

    params.append(limit)
    results = client.execute(f"""
        SELECT street, city, COUNT(*) as count
        FROM locations
        WHERE {where}
        GROUP BY street, city
        ORDER BY count DESC
        LIMIT ?
    """, params).fetchall()

    return TopStreetsResponse(
        data=[
            TopStreetItem(street=r[0] or "", city=r[1], count=r[2])
            for r in results
        ]
    )

@get("/trends/growth", sync_to_thread=True)
@cached(ttl=3600)
def get_growth_trend() -> GrowthTrendResponse:
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

    return GrowthTrendResponse(
        data=[
            GrowthTrendItem(date=str(r[0]), count=r[1])
            for r in results
        ]
    )

@post("/cache/clear", sync_to_thread=True)
def clear_all_cache() -> dict:
    clear_cache("*")
    return {"status": "cache cleared"}

router = Router(
    path="",
    route_handlers=[
        summary,
        network_growth,
        network_origin,
        stores_timeline,
        growth_by_voivodeship,
        per_capita,
        city_first_opening,
        top_cities,
        opening_seasonality,
        opening_hours,
        voivodeship_stats,
        powiat_economics,
        sunday_by_voivodeship,
        inpost_vs_zabka,
        inpost_vs_zabka_by_level,
        common_streets,
        openings_monthly,
        sunday_closed_stores,
        get_top_streets,
        get_growth_trend,
        clear_all_cache,
    ]
)
