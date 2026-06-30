from litestar import Router, get
from litestar.params import FromQuery

from backend.cache import cached
from backend.database_ch import client
from backend.schemas.api_models import (
    ElevationResponse,
    KraniecFactsResponse,
    NeighborByLevelResponse,
    NeighborStatsResponse,
    TwinsResponse,
)


@get("/stats/elevation")
@cached(ttl=3600)
async def elevation() -> ElevationResponse:
    # Extremes
    top = client.execute("""
        SELECT city, voivodeship, street, elevation_meters
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """).fetchone()
    bot = client.execute("""
        SELECT city, voivodeship, street, elevation_meters
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC LIMIT 1
    """).fetchone()
    
    # Histogram (50 m buckets)
    hist_rows = client.execute("""
        SELECT CAST(FLOOR(elevation_meters / 50) * 50 AS INTEGER) AS bucket_m,
               COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """).fetchall()
    
    # 5th / 95th percentile
    pct_row = client.execute("""
        SELECT PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY elevation_meters),
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY elevation_meters)
        FROM locations
        WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
    """).fetchone()
    p5 = round(float(pct_row[0])) if pct_row and pct_row[0] is not None else None
    p95 = round(float(pct_row[1])) if pct_row and pct_row[1] is not None else None
    
    extremes = []
    if top:
        extremes.append({"which": "top", "city": top[0], "voivodeship": top[1] or "",
                          "street": top[2] or "", "elevation_meters": float(top[3])})
        extremes.append({"which": "bottom", "city": bot[0], "voivodeship": bot[1] or "",
                          "street": bot[2] or "", "elevation_meters": float(bot[3])})
    else:
        extremes = [
            {"which": "top", "city": "Koscielisko", "voivodeship": "malopolskie",
             "street": "Nedzy Kubinca 101", "elevation_meters": 962.6},
            {"which": "bottom", "city": "Gdansk", "voivodeship": "pomorskie",
             "street": "Przelom 12", "elevation_meters": -1.5},
        ]
        
    histogram = [{"bucket_m": int(r[0]), "cnt": int(r[1])} for r in hist_rows]
    return ElevationResponse(
        extremes=extremes,
        histogram=histogram,
        percentiles={"p5": p5, "p95": p95}
    )

@get("/stats/neighbor-stats")
@cached(ttl=3600)
async def neighbor_stats() -> NeighborStatsResponse:
    loner = client.execute("""
        SELECT city, voivodeship, street, nearest_neighbor_distance_meters
        FROM locations WHERE deleted_at IS NULL 
          AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """).fetchone()
    stats = client.execute("""
        SELECT
            MEDIAN(nearest_neighbor_distance_meters) AS median_m,
            ROUND(AVG(nearest_neighbor_distance_meters)) AS avg_m,
            MAX(nearest_neighbor_distance_meters) AS max_m
        FROM locations WHERE deleted_at IS NULL 
          AND nearest_neighbor_distance_meters IS NOT NULL
    """).fetchone()
    buckets = client.execute("""
        SELECT
            CASE
                WHEN nearest_neighbor_distance_meters = 0 THEN '0 m'
                WHEN nearest_neighbor_distance_meters < 50 THEN '<50 m'
                WHEN nearest_neighbor_distance_meters < 100 THEN '50-100 m'
                WHEN nearest_neighbor_distance_meters < 200 THEN '100-200 m'
                WHEN nearest_neighbor_distance_meters < 350 THEN '200-350 m'
                WHEN nearest_neighbor_distance_meters < 500 THEN '350-500 m'
                WHEN nearest_neighbor_distance_meters < 1000 THEN '500 m - 1 km'
                WHEN nearest_neighbor_distance_meters < 3000 THEN '1-3 km'
                WHEN nearest_neighbor_distance_meters < 10000 THEN '3-10 km'
                ELSE '>10 km'
            END AS bucket,
            COUNT(*) AS cnt
        FROM locations WHERE deleted_at IS NULL 
          AND nearest_neighbor_distance_meters IS NOT NULL
        GROUP BY 1
        ORDER BY MIN(nearest_neighbor_distance_meters)
    """).fetchall()
    zero_dist = client.execute("""
        SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters = 0
    """).fetchone()
    return NeighborStatsResponse(
        loner={
            "city": loner[0] if loner else "Michalowo",
            "voivodeship": loner[1] if loner else "podlaskie",
            "street": loner[2] if loner else "—",
            "nearest_neighbor_distance_meters": int(loner[3]) if loner else 27321,
        },
        distribution={
            "median_m": float(stats[0] or 0) if stats else 299,
            "avg_m": float(stats[1] or 0) if stats else 942,
            "max_m": float(stats[2] or 0) if stats else 27321,
            "buckets": [{"bucket": r[0], "cnt": int(r[1])} for r in buckets],
        },
        zero_distance_count=int(zero_dist[0] or 0) if zero_dist else 0,
    )

@get("/stats/kraniec-facts")
@cached(ttl=3600)
async def kraniec_facts() -> KraniecFactsResponse:
    compass = client.execute("""
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
    """).fetchall()
    
    direction_meta = {
        "N": {"id": "north", "label": "Najbardziej na polnoc", "zoom": 11},
        "S": {"id": "south", "label": "Najbardziej na poludnie", "zoom": 11},
        "E": {"id": "east", "label": "Najbardziej na wschod", "zoom": 11},
        "W": {"id": "west", "label": "Najbardziej na zachod", "zoom": 11},
    }
    
    isolation_ff = client.execute("SELECT lat, lon, value FROM fun_facts WHERE key='most_isolated_zabka'").fetchone()
    void_ff = client.execute("SELECT lat, lon, value FROM fun_facts WHERE key='farthest_from_zabka'").fetchone()
    
    elev_top = client.execute("""
        SELECT city, voivodeship, street, elevation_meters, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """).fetchone()
    elev_bot = client.execute("""
        SELECT city, voivodeship, street, elevation_meters, latitude, longitude
        FROM locations WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC LIMIT 1
    """).fetchone()
    
    frog_street = client.execute("""
        SELECT street, city, voivodeship, latitude, longitude
        FROM locations WHERE deleted_at IS NULL 
          AND LOWER(street) LIKE '%zielonej%'
          AND LOWER(city) LIKE '%zabia%'
        LIMIT 1
    """).fetchone()
    
    facts = []
    for row in compass:
        m = direction_meta.get(row[0], {})
        facts.append({
            "id": m.get("id", row[0].lower()),
            "group": "compass",
            "label": m.get("label", ""),
            "value": f"{round(float(row[4]), 2)}°{'N' if row[0] in ('N','S') else 'E'}",
            "city": row[1], "voivodeship": row[2] or "", "street": row[3] or "",
            "lat": float(row[4]), "lon": float(row[5]),
            "zoom": m.get("zoom", 11), "type": "point",
        })
        
    if elev_top:
        facts.append({
            "id": "highest", "group": "elevation", "label": "Najwyzej n.p.m.",
            "value": f"{elev_top[3]:.1f} m",
            "city": elev_top[0], "voivodeship": elev_top[1] or "", "street": elev_top[2] or "",
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
        
    if elev_bot:
        facts.append({
            "id": "lowest", "group": "elevation", "label": "Najnizej (ponizej morza)",
            "value": f"{elev_bot[3]:.1f} m",
            "city": elev_bot[0], "voivodeship": elev_bot[1] or "", "street": elev_bot[2] or "",
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
        
    if isolation_ff:
        iso_loc = client.execute("""
            SELECT city, voivodeship, street
            FROM locations WHERE deleted_at IS NULL 
              AND ABS(latitude - ?) < 0.01
              AND ABS(longitude - ?) < 0.01
            LIMIT 1
        """, [float(isolation_ff[0]), float(isolation_ff[1])]).fetchone()
        facts.append({
            "id": "isolated", "group": "isolation", "label": "Najbardziej izolowana",
            "value": f"{round(float(isolation_ff[2]), 1)} km do sasiada",
            "city": iso_loc[0] if iso_loc else "Michalowo",
            "voivodeship": iso_loc[1] if iso_loc else "podlaskie",
            "street": iso_loc[2] if iso_loc else "—",
            "lat": float(isolation_ff[0]), "lon": float(isolation_ff[1]),
            "zoom": 10, "type": "point",
        })
        
    if frog_street:
        facts.append({
            "id": "frogstreet", "group": "street", "label": "ul. Zielonej Zabki",
            "value": "Zabka na Zabiej",
            "city": frog_street[1], "voivodeship": frog_street[2] or "", "street": frog_street[0] or "",
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
        
    if void_ff:
        facts.append({
            "id": "void", "group": "void", "label": "Najwieksza pustka",
            "value": f"{round(float(void_ff[2]), 1)} km od jakiejkolwiek Zabki",
            "city": "Bieszczady", "voivodeship": "podkarpackie",
            "street": f"{round(float(void_ff[0]), 2)}°N / {round(float(void_ff[1]), 2)}°E",
            "lat": float(void_ff[0]), "lon": float(void_ff[1]),
            "zoom": 9, "type": "void",
        })
        
    # Deterministic 2000-point backdrop (hash of the PK) instead of USING SAMPLE,
    # so the same points come back every run and Redis caches a stable answer.
    backdrop = client.execute("""
        SELECT latitude, longitude
        FROM locations WHERE deleted_at IS NULL
        ORDER BY hash(store_id) LIMIT 2000
    """).fetchall()
    
    return KraniecFactsResponse(
        facts=facts,
        backdrop=[[round(float(r[0]), 4), round(float(r[1]), 4)] for r in backdrop],
    )

@get("/stats/twins")
@cached(ttl=3600)
async def twins() -> TwinsResponse:
    base = "FROM locations WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL"
    agg = client.execute(f"""
        SELECT
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 50 THEN 1 ELSE 0 END),
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 100 THEN 1 ELSE 0 END),
            SUM(CASE WHEN nearest_neighbor_distance_meters <= 200 THEN 1 ELSE 0 END),
            COUNT(*)
        {base}
    """).fetchone()
    
    closest = client.execute("""
        SELECT city, street, MIN(nearest_neighbor_distance_meters) AS d
        FROM locations
        WHERE deleted_at IS NULL 
          AND nearest_neighbor_distance_meters IS NOT NULL
          AND nearest_neighbor_distance_meters > 0
        GROUP BY city, street
        ORDER BY d ASC, city
        LIMIT 8
    """).fetchall()
    
    clusters = client.execute("""
        SELECT city, street, COUNT(*) AS n
        FROM locations
        WHERE deleted_at IS NULL 
        GROUP BY city, street, ROUND(latitude, 5), ROUND(longitude, 5)
        HAVING COUNT(*) > 1
        ORDER BY n DESC, city
        LIMIT 8
    """).fetchall()
    
    within50 = int(agg[0] or 0) if agg else 0
    within100 = int(agg[1] or 0) if agg else 0
    within200 = int(agg[2] or 0) if agg else 0
    total = int(agg[3] or 0) if agg else 0
    bucket_a = within50
    bucket_b = max(0, within100 - within50)
    bucket_c = max(0, within200 - within100)
    
    out_pts = []
    if total > 0 and (bucket_a + bucket_b + bucket_c) > 0:
        cap = 360
        wa = max(1, round(cap * bucket_a / within200)) if within200 else 0
        wb = max(1, round(cap * bucket_b / within200)) if within200 else 0
        wc = max(0, cap - wa - wb)
        if (wa + wb + wc) > cap:
            wc = max(0, cap - wa - wb)
        # Keep the first wa/wb/wc of each bucket in hash order, then emit them in
        # global hash order. The per-bucket row_number() lets DuckDB materialize
        # only the ~360 kept rows instead of sorting+shipping the full <=200m set
        # (3-4k rows) for Python to throw most away. Same rows, same order.
        sampled = client.execute("""
            SELECT latitude, longitude, d, city, street, bucket FROM (
                SELECT latitude, longitude,
                       nearest_neighbor_distance_meters AS d, city, street,
                       CASE
                         WHEN nearest_neighbor_distance_meters <= 50 THEN 'a'
                         WHEN nearest_neighbor_distance_meters <= 100 THEN 'b'
                         ELSE 'c'
                       END AS bucket,
                       row_number() OVER (
                           PARTITION BY CASE
                               WHEN nearest_neighbor_distance_meters <= 50 THEN 'a'
                               WHEN nearest_neighbor_distance_meters <= 100 THEN 'b'
                               ELSE 'c'
                           END
                           ORDER BY hash(store_id)
                       ) AS rn,
                       hash(store_id) AS h
                FROM locations
                WHERE deleted_at IS NULL
                  AND nearest_neighbor_distance_meters IS NOT NULL
                  AND nearest_neighbor_distance_meters <= 200
            )
            WHERE (bucket = 'a' AND rn <= ?)
               OR (bucket = 'b' AND rn <= ?)
               OR (bucket = 'c' AND rn <= ?)
            ORDER BY h
        """, [wa, wb, wc]).fetchall()

        out_pts = [
            {
                "lat": r[0], "lon": r[1],
                "distance_m": int(r[2]),
                "city": r[3], "street": r[4] or "",
                "bucket": r[5],
            }
            for r in sampled
        ]
            
    pts_50 = client.execute("""
        SELECT latitude, longitude, nearest_neighbor_distance_meters AS d,
               city, street
        FROM locations
        WHERE deleted_at IS NULL 
          AND nearest_neighbor_distance_meters IS NOT NULL
          AND nearest_neighbor_distance_meters <= 50
        ORDER BY hash(store_id)
        LIMIT 200
    """).fetchall()
    
    return TwinsResponse(
        within_50m=within50,
        within_100m=within100,
        within_200m=within200,
        total=total,
        closest_pairs=[{"city": r[0], "street": r[1] or "", "distance_m": int(r[2])} for r in closest],
        same_address=[{"city": r[0], "street": r[1] or "", "n": int(r[2])} for r in clusters],
        points=out_pts,
        points_50=[
            {"lat": float(r[0]), "lon": float(r[1]),
             "distance_m": int(r[2]), "city": r[3], "street": r[4] or "",
             "bucket": "a"}
            for r in pts_50
        ]
    )

@get("/stats/neighbor-by-level")
@cached(ttl=3600)
async def neighbor_by_level(
    level: FromQuery[str] = "voivodeship",
    sort: FromQuery[str] = "desc",
    metric: FromQuery[str] = "median_m",
    limit: FromQuery[int] = 20
) -> NeighborByLevelResponse:
    col = {"voivodeship": "voivodeship", "powiat": "powiat", "city": "city"}.get(level)
    if not col:
        return NeighborByLevelResponse(rows=[], total=0, level=level, metric=metric)
    min_n = {"voivodeship": 20, "powiat": 15, "city": 10}[level]
    powiat_filter = ""
    if col == "powiat":
        powiat_filter = "AND NOT regexp_matches(powiat, '^powiat [A-ZĄĆĘŁŃÓŚŹŻ]')"
    rows = client.execute(f"""
        SELECT {col} AS name, ANY_VALUE(voivodeship) AS voiv, COUNT(*) AS n,
               ROUND(MEDIAN(nearest_neighbor_distance_meters)) AS med,
               ROUND(AVG(nearest_neighbor_distance_meters)) AS avg
         FROM locations
         WHERE deleted_at IS NULL 
           AND nearest_neighbor_distance_meters IS NOT NULL
           AND {col} IS NOT NULL AND {col} <> ''
           {powiat_filter}
         GROUP BY {col}
         HAVING COUNT(*) >= {min_n}
    """).fetchall()
    out = [{"name": r[0], "voivodeship": r[1] or "", "n": int(r[2]),
            "median_m": int(r[3] or 0), "avg_m": int(r[4] or 0)} for r in rows]
    sort_key = "avg_m" if metric == "avg_m" else "median_m"
    out.sort(key=lambda x: x[sort_key], reverse=(sort != "asc"))
    lim = max(1, min(int(limit), 100))
    return NeighborByLevelResponse(
        rows=out[:lim],
        total=len(out),
        level=level,
        metric=sort_key
    )

router = Router(
    path="",
    route_handlers=[
        elevation,
        neighbor_stats,
        kraniec_facts,
        twins,
        neighbor_by_level,
    ]
)
