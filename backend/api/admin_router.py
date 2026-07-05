"""
Administrative context API - voivodeship, powiat, city, country.
Hierarchical aggregations for Polish administrative divisions.
"""


from litestar import Router, get
from litestar.exceptions import HTTPException
from litestar.params import FromPath, FromQuery

from backend.cache import cached
from backend.database import build_where_clause, client


@get("/stats/by-powiat", sync_to_thread=True)
@cached(ttl=3600)
def get_by_powiat(voivodeship: FromQuery[str | None] = None) -> dict:
    """Get statistics aggregated by powiat (county)."""

    where_clauses = ["deleted_at IS NULL"]
    params = []
    if voivodeship:
        where_clauses.append("voivodeship = ?")
        params.append(voivodeship)
    where = build_where_clause(where_clauses)

    results = client.execute(f"""
        SELECT
            voivodeship,
            powiat,
            COUNT(*) as total,
            SUM(has_merrychef) as with_merrychef,
            SUM(open_sunday) as open_sunday,
            SUM(h24) as h24
        FROM locations
        WHERE {where}
        GROUP BY voivodeship, powiat
        ORDER BY voivodeship, total DESC
    """, params).fetchall()

    # Group by voivodeship
    by_voiv = {}
    for row in results:
        voiv = row[0]
        if voiv not in by_voiv:
            by_voiv[voiv] = []

        by_voiv[voiv].append({
            "powiat": row[1],
            "total": row[2],
            "with_merrychef": row[3] or 0,
            "open_sunday": row[4] or 0,
            "h24": row[5] or 0,
        })

    return {
        "data": by_voiv
    }

@get("/stats/by-city", sync_to_thread=True)
@cached(ttl=3600)
def get_by_city(powiat: FromQuery[str | None] = None, voivodeship: FromQuery[str | None] = None) -> dict:
    """Get statistics aggregated by city."""

    where_clauses = ["deleted_at IS NULL"]
    params = []
    if voivodeship:
        where_clauses.append("voivodeship = ?")
        params.append(voivodeship)
    if powiat:
        where_clauses.append("powiat = ?")
        params.append(powiat)
    where = build_where_clause(where_clauses)

    results = client.execute(f"""
        SELECT
            city,
            voivodeship,
            powiat,
            COUNT(*) as total,
            SUM(has_merrychef) as with_merrychef,
            SUM(open_sunday) as open_sunday,
            SUM(h24) as h24
        FROM locations
        WHERE {where}
        GROUP BY city, voivodeship, powiat
        ORDER BY total DESC
    """, params).fetchall()


    return {
        "data": [
            {
                "city": r[0],
                "voivodeship": r[1],
                "powiat": r[2],
                "total": r[3],
                "with_merrychef": r[4] or 0,
                "open_sunday": r[5] or 0,
                "h24": r[6] or 0,
            }
            for r in results
        ]
    }

@get("/hierarchy/voivodeships", sync_to_thread=True)
@cached(ttl=86400)
def get_voivodeships() -> dict:
    """Get all voivodeships with their powiats and cities.

    One GROUP BY scan instead of the old ~330-query N+1 (1 + per-voivodeship +
    per-powiat round-trips); the nested voiv -> powiat -> cities dict is
    assembled in Python. Same ordering as before (voivodeship alphabetical,
    powiats and cities by store count desc) with a name tiebreaker so equal
    counts come out in a stable order.
    """
    from collections import defaultdict

    rows = client.execute("""
        SELECT voivodeship, powiat, city, COUNT(*) AS cnt
        FROM locations
        WHERE deleted_at IS NULL
        GROUP BY voivodeship, powiat, city
    """).fetchall()

    # voivodeship -> powiat -> [(city, cnt), ...]
    tree: dict = defaultdict(lambda: defaultdict(list))
    for voiv, powiat, city, cnt in rows:
        tree[voiv][powiat].append((city, cnt))

    result = {}
    for voiv in sorted(tree):                                   # alphabetical, as before
        powiat_map = tree[voiv]
        powiat_total = {p: sum(n for _, n in cities) for p, cities in powiat_map.items()}
        powiats = {}
        for powiat in sorted(powiat_map, key=lambda p: (-powiat_total[p], p or "")):  # count desc
            cities = sorted(powiat_map[powiat], key=lambda cc: (-cc[1], cc[0] or ""))  # count desc
            powiats[powiat] = {
                "count": powiat_total[powiat],
                "cities": [{"city": c, "count": n} for c, n in cities],
            }
        result[voiv] = powiats

    return {
        "hierarchy": result
    }

@get("/context/{lat:float}/{lon:float}", sync_to_thread=True)
def get_location_context(lat: FromPath[float], lon: FromPath[float]) -> dict:
    """Get administrative context for coordinates using nearest location."""
    # Clamp coordinates to Poland bounding box: Latitude [49.0, 55.0], Longitude [14.0, 24.1]
    if not (49.0 <= lat <= 55.0) or not (14.0 <= lon <= 24.1):
        raise HTTPException(
            status_code=400,
            detail="Coordinates outside Poland bounding box"
        )
    # Round to 3 decimal places (~110m resolution) to limit Redis key space and prevent memory exhaustion
    r_lat = round(lat, 3)
    r_lon = round(lon, 3)
    return _get_cached_location_context(r_lat, r_lon)

@cached(ttl=86400)
def _get_cached_location_context(lat: float, lon: float) -> dict:
    # 1) nearest store to the point (no window functions, just the distance sort)
    nearest = client.execute("""
        SELECT l.street, l.city, l.powiat, l.voivodeship,
               l.voivodeship_id, l.powiat_id, l.gmina_id, g.name AS gmina_name
        FROM locations l
        LEFT JOIN dim_gmina g ON g.id = l.gmina_id
        WHERE l.deleted_at IS NULL
        ORDER BY
            (l.latitude - ?) * (l.latitude - ?) + (l.longitude - ?) * (l.longitude - ?)
        LIMIT 1
    """, [lat, lat, lon, lon]).fetchone()

    if not nearest:
        return {"error": "No locations found"}

    # 2) voivodeship, powiat, city details
    v_id, p_id, g_id = nearest[4], nearest[5], nearest[6]

    # count active locations in this voivodeship
    v_count = client.execute("""
        SELECT COUNT(*) FROM locations WHERE voivodeship_id = ? AND deleted_at IS NULL
    """, [v_id]).fetchone()[0]

    # count active locations in this powiat
    p_count = client.execute("""
        SELECT COUNT(*) FROM locations WHERE powiat_id = ? AND deleted_at IS NULL
    """, [p_id]).fetchone()[0]

    # count active locations in this gmina
    g_count = 0
    if g_id:
        g_count = client.execute("""
            SELECT COUNT(*) FROM locations WHERE gmina_id = ? AND deleted_at IS NULL
        """, [g_id]).fetchone()[0]

    # active locations in the city
    city_count = client.execute("""
        SELECT COUNT(*) FROM locations WHERE city = ? AND deleted_at IS NULL
    """, [nearest[1]]).fetchone()[0]

    return {
        "nearest_location": "Żabka",
        "street": nearest[0] or "",
        "city": nearest[1] or "",
        "city_count": int(city_count),
        "powiat": nearest[2] or "",
        "powiat_count": int(p_count),
        "gmina": nearest[7] or "",
        "gmina_id": int(g_id) if g_id is not None else None,
        "gmina_count": int(g_count),
        "voivodeship": nearest[3] or "",
        "voivodeship_count": int(v_count),
        "country": "Polska",
        "coordinates": {"lat": lat, "lon": lon},
    }

@get("/fun/extremes", sync_to_thread=True)
@cached(ttl=3600)
def get_extremes() -> dict:
    """Get extreme points - najfajniejsze Żabki!"""

    northernmost = client.execute("""
        SELECT store_id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude DESC
        LIMIT 1
    """).fetchone()

    southernmost = client.execute("""
        SELECT store_id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude ASC
        LIMIT 1
    """).fetchone()

    easternmost = client.execute("""
        SELECT store_id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude DESC
        LIMIT 1
    """).fetchone()

    westernmost = client.execute("""
        SELECT store_id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude ASC
        LIMIT 1
    """).fetchone()

    def format_location(row):
        if not row:
            return None
        return {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "lat": row[5],
            "lon": row[6],
        }

    return {
        "_najwyżej_północy": format_location(northernmost),
        "_najniżej_południu": format_location(southernmost),
        "_najbardziej_wschód": format_location(easternmost),
        "_najbardziej_zachód": format_location(westernmost),
    }

@get("/stats/administrative-summary", sync_to_thread=True)
@cached(ttl=3600)
def get_administrative_summary() -> dict:
    """Summary: country → voivodeships → powiats → cities."""

    return {
        "country": "Polska",
        "voivodeships": client.execute("""
            SELECT voivodeship, COUNT(*) as count
            FROM locations
            WHERE deleted_at IS NULL
            GROUP BY voivodeship
            ORDER BY count DESC
        """).fetchall(),
        "total_powiats": client.execute("""
            SELECT COUNT(DISTINCT powiat)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
        "total_cities": client.execute("""
            SELECT COUNT(DISTINCT city)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
        "total_locations": client.execute("""
            SELECT COUNT(*)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
    }


router = Router(
    path="",
    route_handlers=[
        get_by_powiat,
        get_by_city,
        get_voivodeships,
        get_location_context,
        get_extremes,
        get_administrative_summary,
    ]
)
