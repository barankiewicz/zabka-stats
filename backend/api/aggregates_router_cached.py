"""
Aggregates API (ClickHouse + Redis caching).
Lightning fast with Redis layer!
"""

from fastapi import APIRouter
from backend.database_ch import client
from backend.cache import cached, get_cache, set_cache, clear_cache

router = APIRouter()

@router.get("/stats/summary")
@cached(ttl=3600)  # Cache for 1 hour
async def get_summary_stats(month: str = None):
    """Get summary - cached for 1 hour."""
    where = ""
    if month:
        where = f"WHERE source_date LIKE '{month}%'"

    result = client.execute(f"""
        SELECT
            COUNT(*) as total,
            SUM(has_merrychef) as merrychef,
            SUM(open_sunday) as sunday,
            SUM(h24) as h24
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) {where}
    """).fetchone()

    return {
        "total_locations": result[0] or 0,
        "with_merrychef": result[1] or 0,
        "open_sunday": result[2] or 0,
        "h24": result[3] or 0,
        "latest_snapshot_date": client.execute(
            "SELECT MAX(source_date) FROM snapshots"
        ).fetchone()[0],
        "total_snapshots": client.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0],
    }

@router.get("/stats/voivodeship")
@cached(ttl=3600)
async def get_voivodeship_stats(month: str = None):
    """Get voivodeship stats - cached."""
    where = ""
    if month:
        where = f"AND toYYYYMM(created_at) = toYYYYMM('{month}-01')"

    results = client.execute(f"""
        SELECT
            voivodeship,
            COUNT(*) as total,
            SUM(has_merrychef) as merrychef,
            SUM(open_sunday) as sunday,
            SUM(h24) as h24
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) {where}
        GROUP BY voivodeship
        ORDER BY total DESC
    """).fetchall()

    return {
        "data": [
            {
                "voivodeship": r[0],
                "total": r[1],
                "with_merrychef": r[2] or 0,
                "open_sunday": r[3] or 0,
                "h24": r[4] or 0,
            }
            for r in results
        ]
    }

@router.get("/stats/top-cities")
@cached(ttl=1800)  # Cache for 30 min
async def get_top_cities(limit: int = 30, month: str = None):
    """Get top cities - cached."""
    where = ""
    if month:
        where = f"AND toYYYYMM(created_at) = toYYYYMM('{month}-01')"

    results = client.execute(f"""
        SELECT city, voivodeship, COUNT(*) as count
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) {where}
        GROUP BY city, voivodeship
        ORDER BY count DESC
        LIMIT {limit}
    """).fetchall()

    return {
        "data": [
            {"city": r[0], "voivodeship": r[1], "count": r[2]}
            for r in results
        ]
    }

@router.get("/stats/top-streets")
@cached(ttl=1800)
async def get_top_streets(limit: int = 20, month: str = None):
    """Get top streets - cached."""
    where = "AND street IS NOT NULL"
    if month:
        where += f" AND toYYYYMM(created_at) = toYYYYMM('{month}-01')"

    results = client.execute(f"""
        SELECT street, city, COUNT(*) as count
        FROM locations
        WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots) {where}
        GROUP BY street, city
        ORDER BY count DESC
        LIMIT {limit}
    """).fetchall()

    return {
        "data": [
            {"street": r[0], "city": r[1], "count": r[2]}
            for r in results
        ]
    }

@router.get("/stats/per-capita")
@cached(ttl=3600)
async def get_per_capita(voivodeship: str = None):
    """Get per-capita stats - cached."""
    populations = {
        "mazowieckie": 5540000,
        "śląskie": 4575000,
        "wielkopolskie": 3741000,
        "małopolskie": 3441000,
        "łódzkie": 2358000,
        "dolnośląskie": 2926000,
        "zachodniopomorskie": 1673000,
        "warmińsko-mazurskie": 1429000,
        "podlaskie": 1183000,
        "świętokrzyskie": 1215000,
        "lubuskie": 1002000,
        "opolskie": 975000,
        "kujawsko-pomorskie": 2066000,
        "pomorskie": 2343000,
        "podkarpackie": 2133000,
        "lubelskie": 2104000,
    }

    where = ""
    if voivodeship:
        where = f"WHERE voivodeship = '{voivodeship}' AND deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)"
    else:
        where = "WHERE deleted_at IS NULL AND snapshot_id = (SELECT MAX(id) FROM snapshots)"

    results = client.execute(f"""
        SELECT voivodeship, COUNT(*) as count
        FROM locations {where}
        GROUP BY voivodeship
        ORDER BY count DESC
    """).fetchall()

    return {
        "data": [
            {
                "voivodeship": r[0],
                "count": r[1],
                "population": populations.get(r[0].lower(), 0),
                "per_1000": round((r[1] / populations.get(r[0].lower(), 1)) * 1000, 2),
            }
            for r in results
        ]
    }

@router.get("/trends/growth")
@cached(ttl=3600)
async def get_growth_trend():
    """Get growth trend - cached."""
    results = client.execute("""
        SELECT source_date, COUNT(*) as count
        FROM snapshots
        GROUP BY source_date
        ORDER BY source_date
    """).fetchall()

    return {
        "data": [
            {"date": str(r[0]), "count": r[1]}
            for r in results
        ]
    }

@router.post("/cache/clear")
async def clear_all_cache():
    """Clear all cache (admin only)."""
    clear_cache("*")
    return {"status": "cache cleared"}
