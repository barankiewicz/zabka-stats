"""Locations API endpoints (DuckDB)."""

from typing import Optional
from litestar import Router, get
from litestar.exceptions import HTTPException
from litestar.params import FromQuery, FromPath
from backend.database_ch import client
from backend.cache import cached

@get("/locations")
@cached(ttl=3600)
async def get_locations(
    month: FromQuery[Optional[str]] = None,
    voivodeship: FromQuery[Optional[str]] = None,
    city: FromQuery[Optional[str]] = None,
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

    where = " AND ".join(where_clauses)

    total = client.execute(f"SELECT COUNT(*) FROM locations WHERE {where}", params).fetchone()[0]

    query_params = list(params)
    query_params.extend([limit, offset])

    results = client.execute(f"""
        SELECT id, store_id, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24
        FROM locations
        WHERE {where}
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


@get("/locations/map")
@cached(ttl=3600)
async def get_locations_for_map_geojson(
    month: FromQuery[Optional[str]] = None,
) -> dict:
    """
    Get locations for map visualization (GeoJSON).
    """
    params = []
    if month:
        where = "strftime(created_at, '%Y-%m') <= ? AND (deleted_at IS NULL OR strftime(deleted_at, '%Y-%m') >= ?)"
        params.extend([month, month])
    else:
        where = "deleted_at IS NULL"

    results = client.execute(f"""
        SELECT id, store_id, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24
        FROM locations
        WHERE {where}
    """, params).fetchall()

    features = []
    for r in results:
        if r[5] and r[6]:  # latitude and longitude
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [r[6], r[5]]  # [lon, lat]
                },
                "properties": {
                    "id": r[0],
                    "name": "Żabka",
                    "store_id": r[1],
                    "city": r[2],
                    "voivodeship": r[3],
                    "street": r[4],
                    "has_merrychef": bool(r[7]),
                    "open_sunday": bool(r[8]),
                    "h24": bool(r[9]),
                }
            })

    return {
        "type": "FeatureCollection",
        "features": features
    }


@get("/locations/{location_id:int}")
@cached(ttl=3600)
async def get_location(location_id: FromPath[int]) -> dict:
    """Get a specific location by ID."""
    result = client.execute("""
        SELECT id, 'Żabka' AS name, city, voivodeship, street, latitude, longitude,
               has_merrychef, open_sunday, h24, created_at, deleted_at, powiat
        FROM locations
        WHERE id = ? AND deleted_at IS NULL
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
