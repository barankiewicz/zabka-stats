"""Locations API endpoints (DuckDB)."""


from litestar import Response, Router, get
from litestar.exceptions import HTTPException
from litestar.params import FromPath, FromQuery
from litestar.serialization import encode_json

from backend.cache import cached, get_cached_blob, set_cached_blob
from backend.database import build_where_clause, client


@get("/locations", sync_to_thread=True)
@cached(ttl=3600)
def get_locations(
    month: FromQuery[str | None] = None,
    voivodeship: FromQuery[str | None] = None,
    city: FromQuery[str | None] = None,
    limit: FromQuery[int] = 100,
    offset: FromQuery[int] = 0,
) -> dict:
    """
    Get locations with optional filters.

    Args:
        month: YYYY-MM format to filter by snapshot date
        voivodeship: Filter by voivodeship name
        city: Filter by city name
        limit: Pagination limit
        offset: Pagination offset
    """
    where_clauses = []
    params = []

    if month:
        where_clauses.append(
            "strftime(created_at, '%Y-%m') <= ? AND (deleted_at IS NULL OR strftime(deleted_at, '%Y-%m') >= ?)"
        )
        params.extend([month, month])
    else:
        where_clauses.append("deleted_at IS NULL")

    if voivodeship:
        where_clauses.append("voivodeship = ?")
        params.append(voivodeship)

    if city:
        where_clauses.append("city = ?")
        params.append(city)

    where = build_where_clause(where_clauses)

    total = client.execute(f"SELECT COUNT(*) FROM locations WHERE {where}", params).fetchone()[0]

    query_params = list(params)
    query_params.extend([limit, offset])

    results = client.execute(f"""
        SELECT store_id, store_id, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24
        FROM locations
        WHERE {where}
        ORDER BY store_id
        LIMIT ? OFFSET ?
    """, query_params).fetchall()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "data": [
            {
                "id": r[0],
                "name": "Żabka",
                "store_id": r[1],
                "city": r[2],
                "voivodeship": r[3],
                "street": r[4],
                "latitude": r[5],
                "longitude": r[6],
                "has_merrychef": bool(r[7]),
                "open_sunday": bool(r[8]),
                "h24": bool(r[9]),
            }
            for r in results
        ]
    }


@get("/locations/map", sync_to_thread=True)
def get_locations_for_map_geojson(
    month: FromQuery[str | None] = None,
) -> Response:
    """
    Get locations for map visualization (GeoJSON).

    This is the largest response in the API (~3.6 MB, all ~13k stores). We
    serialize the FeatureCollection once and cache the JSON *string*, then return
    it verbatim as a pre-serialized Response - so warm hits skip the DB query,
    the 13k-feature Python build, and the re-parse/re-encode the dict cache would
    otherwise pay on every request. Output bytes are unchanged (same fields, same
    encoder as the rest of the API).
    """
    cache_key = f"locations_map:{month or '_current'}"
    cached_blob = get_cached_blob(cache_key)
    if cached_blob is not None:
        return Response(cached_blob, media_type="application/json")

    params = []
    if month:
        where = "strftime(created_at, '%Y-%m') <= ? AND (deleted_at IS NULL OR strftime(deleted_at, '%Y-%m') >= ?)"
        params.extend([month, month])
    else:
        where = "deleted_at IS NULL"

    results = client.execute(f"""
        SELECT store_id, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24
        FROM locations
        WHERE {where}
    """, params).fetchall()

    features = []
    for r in results:
        if r[4] and r[5]:  # latitude and longitude
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [r[5], r[4]]  # [lon, lat]
                },
                "properties": {
                    "id": r[0],
                    "name": "Żabka",
                    "store_id": r[0],
                    "city": r[1],
                    "voivodeship": r[2],
                    "street": r[3],
                    "has_merrychef": bool(r[6]),
                    "open_sunday": bool(r[7]),
                    "h24": bool(r[8]),
                }
            })

    blob = encode_json({"type": "FeatureCollection", "features": features})
    set_cached_blob(cache_key, blob, ttl=3600)
    return Response(blob, media_type="application/json")


@get("/locations/{location_id:str}", sync_to_thread=True)
@cached(ttl=3600)
def get_location(location_id: FromPath[str]) -> dict:
    """Get a specific location by store_id."""
    result = client.execute("""
        SELECT store_id, 'Żabka' AS name, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24, created_at, deleted_at, powiat
        FROM locations
        WHERE store_id = ? AND deleted_at IS NULL
    """, [location_id]).fetchone()

    if not result:
        raise HTTPException(status_code=404, detail="Location not found")

    return {
        "id": result[0],
        "name": result[1],
        "city": result[2],
        "voivodeship": result[3],
        "powiat": result[12],
        "street": result[4],
        "latitude": result[5],
        "longitude": result[6],
        "has_merrychef": bool(result[7]),
        "open_sunday": bool(result[8]),
        "h24": bool(result[9]),
        "created_at": result[10],
        "deleted_at": result[11],
    }

router = Router(
    path="",
    route_handlers=[
        get_locations,
        get_locations_for_map_geojson,
        get_location,
    ]
)
