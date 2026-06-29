import json
from pathlib import Path

from litestar import Router, get

from backend.cache import cached
from backend.database_ch import client
from backend.schemas.api_models import AmphibianExtremesResponse, Section3RareResponse

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

@get("/stats/amphibians")
@cached(ttl=3600)
async def amphibians() -> AmphibianExtremesResponse:
    # Summary stats
    total = client.execute("""
        SELECT COUNT(*), SUM(CASE WHEN h24 THEN 1 ELSE 0 END)
        FROM locations WHERE deleted_at IS NULL 
    """).fetchone()
    
    # Most froggy (if enriched)
    most_froggy_db = client.execute("""
        SELECT city, voivodeship, street,
               amphibian_occurrences_5km, nearest_amphibian_km,
               latitude, longitude
        FROM locations WHERE deleted_at IS NULL 
          AND amphibian_occurrences_5km IS NOT NULL
        ORDER BY amphibian_occurrences_5km DESC LIMIT 1
    """).fetchone()
    
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
    zero_count = client.execute("""
        SELECT COUNT(*) FROM locations
        WHERE deleted_at IS NULL AND amphibian_occurrences_5km = 0
    """).fetchone()
    
    # Farthest from frog
    farthest_ff = client.execute("""
        SELECT city, voivodeship, ROUND(nearest_amphibian_km, 2) AS km, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND nearest_amphibian_km IS NOT NULL
        ORDER BY nearest_amphibian_km DESC LIMIT 1
    """).fetchone()
    
    # Median amphibian occurrences per store
    median_row = client.execute("""
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amphibian_occurrences_5km)
        FROM locations WHERE deleted_at IS NULL 
          AND amphibian_occurrences_5km IS NOT NULL
    """).fetchone()
    
    # Per-store sample for beeswarm/map
    stores_db = client.execute("""
        SELECT latitude, longitude,
               COALESCE(amphibian_occurrences_5km, 0) AS occ,
               COALESCE(nearest_amphibian_km, 0) AS near_km,
               COALESCE(voivodeship, '') AS voivodeship
        FROM locations WHERE deleted_at IS NULL 
        USING SAMPLE 5000
    """).fetchall()
    
    # Voivodeship name -> index mapping
    voiv_names_db = client.execute("""
        SELECT DISTINCT voivodeship FROM locations
        WHERE deleted_at IS NULL 
          AND voivodeship IS NOT NULL
        ORDER BY voivodeship
    """).fetchall()
    voiv_names = [r[0] for r in voiv_names_db]
    voiv_idx = {name: i for i, name in enumerate(voiv_names)}
    
    # Scatter sample
    scatter_db = client.execute("""
        SELECT a.occ, COUNT(b.id) AS density
        FROM (
            SELECT id, latitude, longitude,
                   COALESCE(amphibian_occurrences_5km, 0) AS occ
            FROM locations
            WHERE deleted_at IS NULL 
              AND amphibian_occurrences_5km IS NOT NULL
            USING SAMPLE 200
        ) a
        LEFT JOIN locations b
          ON b.deleted_at IS NULL
         AND b.id != a.id
         AND b.latitude  BETWEEN a.latitude  - 0.045 AND a.latitude  + 0.045
         AND b.longitude BETWEEN a.longitude - 0.065 AND a.longitude + 0.065
        GROUP BY a.id, a.occ
        ORDER BY density
    """).fetchall()
    
    has_amphibian_data = most_froggy_db is not None
    
    # Distribution buckets
    dist = client.execute("""
        SELECT
            CASE
                WHEN COALESCE(amphibian_occurrences_5km, 0) = 0 THEN '0'
                WHEN amphibian_occurrences_5km <= 50 THEN '1-50'
                WHEN amphibian_occurrences_5km <= 100 THEN '51-100'
                WHEN amphibian_occurrences_5km <= 250 THEN '101-250'
                WHEN amphibian_occurrences_5km <= 500 THEN '251-500'
                WHEN amphibian_occurrences_5km <= 1000 THEN '501-1000'
                ELSE '1000+'
            END AS bucket,
            COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL 
        GROUP BY 1 ORDER BY MIN(COALESCE(amphibian_occurrences_5km, 0))
    """).fetchall()
    
    # By voivodeship averages
    by_voiv = client.execute("""
        SELECT voivodeship,
               ROUND(AVG(COALESCE(amphibian_occurrences_5km, 0)), 0) AS avg_occ,
               COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL 
        GROUP BY voivodeship ORDER BY avg_occ DESC
    """).fetchall()
    
    # Top 10 cities
    top10 = client.execute("""
        SELECT city, voivodeship,
               SUM(COALESCE(amphibian_occurrences_5km, 0)) AS total_occ
        FROM locations WHERE deleted_at IS NULL 
        GROUP BY city, voivodeship
        ORDER BY total_occ DESC LIMIT 10
    """).fetchall()
    
    return AmphibianExtremesResponse(
        gbif_total=_gbif_total(),
        median_occurrences=int(round(float(median_row[0]))) if median_row and median_row[0] is not None else None,
        has_enriched_data=has_amphibian_data,
        most_froggy=most_froggy,
        zero_frog_count=int(zero_count[0] or 0) if zero_count else None,
        farthest_from_frog={
            "city": farthest_ff[0] if farthest_ff else None,
            "voivodeship": farthest_ff[1] if farthest_ff else None,
            "nearest_amphibian_km": float(farthest_ff[2]) if farthest_ff else None,
            "latitude": float(farthest_ff[3]) if farthest_ff else None,
            "longitude": float(farthest_ff[4]) if farthest_ff else None,
        },
        voivodeship_names=voiv_names,
        stores=[
            [round(float(r[0]), 4), round(float(r[1]), 4), int(r[2]), round(float(r[3]), 2),
             voiv_idx.get(r[4], -1)]
            for r in stores_db
        ],
        scatter_sample=[
            [int(r[1]), int(r[0])]
            for r in scatter_db
        ],
        distribution=[{"bucket": r[0], "cnt": int(r[1])} for r in dist],
        by_voivodeship=[
            {"voivodeship": r[0], "avg_occurrences": int(r[1] or 0), "stores": int(r[2])}
            for r in by_voiv if r[0]
        ],
        top10=[
            {"city": r[0], "voivodeship": r[1], "occ": int(r[2])}
            for r in top10 if r[0]
        ],
        gbif_obs=[],
    )

@get("/stats/section3-rare")
@cached(ttl=3600)
async def section3_rare() -> Section3RareResponse:
    h24_cities = client.execute("""
        SELECT city, voivodeship, COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL AND h24 = true
        GROUP BY city, voivodeship ORDER BY cnt DESC LIMIT 8
    """).fetchall()
    h24_pts = client.execute("""
        SELECT latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND h24 = true
    """).fetchall()
    
    park_count = client.execute("""
        SELECT
            SUM(CASE WHEN is_in_nature_park THEN 1 ELSE 0 END) AS in_park,
            COUNT(*) AS total
        FROM locations WHERE deleted_at IS NULL 
    """).fetchone()
    top3_parks = client.execute("""
        SELECT dp.name AS park_name, dp.type AS park_type, COUNT(*) AS cnt
        FROM locations l
        JOIN dim_park dp ON l.nature_park_id = dp.id
        WHERE l.deleted_at IS NULL 
        GROUP BY dp.name, dp.type ORDER BY cnt DESC LIMIT 3
    """).fetchall()
    
    void_ff = client.execute("SELECT value, lat, lon FROM fun_facts WHERE key='farthest_from_zabka'").fetchone()
    
    frog_streets = client.execute("""
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
    """).fetchall()
    
    powiat_count = client.execute("""
        SELECT COUNT(DISTINCT powiat_id) FROM locations WHERE deleted_at IS NULL 
    """).fetchone()
    powiat_range = client.execute("""
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
    """).fetchall()
    
    west_wall = client.execute("""
        SELECT latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL 
          AND voivodeship IN ('dolnoslaskie', 'zachodniopomorskie', 'lubuskie')
        ORDER BY hash(id)
        LIMIT 240
    """).fetchall()
    
    civic = client.execute("""
        SELECT
            SUM(CASE WHEN UPPER(street) LIKE '%RYNEK%' THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%ko%ciuszk%' THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%pi%sudsk%' THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%wojska polsk%' THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%mickiewicz%' THEN 1 ELSE 0 END),
            SUM(CASE WHEN LOWER(street) LIKE '%jana paw%a%' THEN 1 ELSE 0 END)
        FROM locations WHERE deleted_at IS NULL 
    """).fetchone()
    
    physical_streets = client.execute(r"""
        WITH cleaned AS (
            SELECT
                TRIM(REGEXP_REPLACE(
                    REGEXP_REPLACE(TRIM(street), '^[a-zA-Z]{2,4}\.\s*', ''),
                    '\s+\d[\dA-Za-z/\\,\.\s-]*$',
                    ''
                )) AS street_name,
                city
            FROM locations
            WHERE deleted_at IS NULL 
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
    """).fetchall()
    
    return Section3RareResponse(
        h24_cities=[
            {"city": r[0], "voivodeship": r[1] or "", "cnt": int(r[2])} for r in h24_cities
        ],
        h24_points=[
            [round(float(r[0]), 4), round(float(r[1]), 4)] for r in h24_pts
        ],
        parks={
            "count": int(park_count[0] or 0) if park_count else 0,
            "total": int(park_count[1] or 0) if park_count else 0,
            "top3": [{"park_name": r[0], "park_type": r[1] or "", "cnt": int(r[2])}
                     for r in top3_parks],
        },
        void={
            "value": round(float(void_ff[0]), 2) if void_ff else 46.52,
            "lat": float(void_ff[1]) if void_ff else 49.01,
            "lon": float(void_ff[2]) if void_ff else 22.89,
        },
        frog_streets=[
            {"street": r[0], "city": r[1], "voivodeship": r[2] or "",
             "latitude": float(r[3]), "longitude": float(r[4])}
            for r in frog_streets
        ],
        frog_streets_count=len(frog_streets),
        west_wall_points=[
            [round(float(r[0]), 4), round(float(r[1]), 4)] for r in west_wall
        ],
        powiats_covered=int(powiat_count[0] or 0) if powiat_count else 0,
        powiat_range=[
            {"which": r[0], "powiat": r[1], "voivodeship": r[2] or "", "cnt": int(r[3])}
            for r in powiat_range
        ],
        civic_streets={
            "rynek": int(civic[0] or 0) if civic else 0,
            "kosciuszki": int(civic[1] or 0) if civic else 0,
            "pilsudskiego": int(civic[2] or 0) if civic else 0,
            "wojska_polskiego": int(civic[3] or 0) if civic else 0,
            "mickiewicza": int(civic[4] or 0) if civic else 0,
            "jana_pawla_ii": int(civic[5] or 0) if civic else 0,
        },
        physical_streets=[
            {"street": r[0], "city": r[1], "cnt": int(r[2])}
            for r in physical_streets
        ],
    )

@get("/stats/parks-stores")
@cached(ttl=3600)
async def parks_stores() -> list[list[float]]:
    rows = client.execute("""
        SELECT latitude, longitude
        FROM locations
        WHERE is_in_nature_park = TRUE AND deleted_at IS NULL
    """).fetchall()
    return [[round(float(r[0]), 6), round(float(r[1]), 6)] for r in rows]

router = Router(
    path="",
    route_handlers=[
        amphibians,
        section3_rare,
        parks_stores,
    ]
)
