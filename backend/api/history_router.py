"""History API endpoints (DuckDB)."""

from fastapi import APIRouter, HTTPException
from typing import Optional
from backend.database_ch import client
from backend.cache import cached

router = APIRouter()


@router.get("/history/location/{location_id}")
@cached(ttl=3600)
async def get_location_history(
    location_id: int,
    limit: int = 100,
):
    """Get full change history (creation and deletion only) for a specific location."""
    location = client.execute("SELECT 'Żabka', created_at, deleted_at FROM locations WHERE id = ?", [location_id]).fetchone()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    created_at = location[1]
    deleted_at = location[2]

    history_events = []
    if created_at:
        history_events.append({
            "id": 1,
            "change_type": "created",
            "field_changed": None,
            "old_value": None,
            "new_value": None,
            "recorded_at": str(created_at),
            "snapshot_id": 1,
        })
    if deleted_at:
        history_events.append({
            "id": 2,
            "change_type": "deleted",
            "field_changed": None,
            "old_value": None,
            "new_value": None,
            "recorded_at": str(deleted_at),
            "snapshot_id": 1,
        })

    return {
        "location_id": location_id,
        "location_name": location[0],
        "history": history_events[:limit]
    }


@router.get("/changes/monthly")
@cached(ttl=3600)
async def get_monthly_changes(
    year: Optional[int] = None,
    voivodeship: Optional[str] = None,
):
    """Get monthly change statistics (created and deleted events only)."""
    where_clauses = []
    params = []
    if year:
        where_clauses.append("strftime(event_time, '%Y') = ?")
        params.append(str(year))
    if voivodeship:
        where_clauses.append("voivodeship = ?")
        params.append(voivodeship)

    where = ""
    if where_clauses:
        where = "WHERE " + " AND ".join(where_clauses)

    results = client.execute(f"""
        WITH monthly_events AS (
            SELECT
                strftime(created_at, '%Y-%m') as month,
                'created' as change_type,
                voivodeship,
                created_at as event_time
            FROM locations
            UNION ALL
            SELECT
                strftime(deleted_at, '%Y-%m') as month,
                'deleted' as change_type,
                voivodeship,
                deleted_at as event_time
            FROM locations
            WHERE deleted_at IS NOT NULL
        )
        SELECT
            month,
            change_type,
            COUNT(*) as count
        FROM monthly_events
        {where}
        GROUP BY month, change_type
        ORDER BY month
    """, params).fetchall()

    monthly_stats = {}
    for month, change_type, count in results:
        if month not in monthly_stats:
            monthly_stats[month] = {
                "month": month,
                "created": 0,
                "deleted": 0,
                "updated": 0,
            }
        monthly_stats[month][change_type] = count

    return {
        "year": year,
        "voivodeship": voivodeship,
        "data": sorted(monthly_stats.values(), key=lambda x: x['month'])
    }


@router.get("/changes/voivodeship")
@cached(ttl=3600)
async def get_voivodeship_changes(
    month: Optional[str] = None,
):
    """Get change statistics aggregated by voivodeship."""
    where = ""
    params = []
    if month:
        where = "WHERE strftime(event_time, '%Y-%m') = ?"
        params.append(month)

    results = client.execute(f"""
        WITH monthly_events AS (
            SELECT
                voivodeship,
                'created' as change_type,
                created_at as event_time
            FROM locations
            WHERE voivodeship IS NOT NULL
            UNION ALL
            SELECT
                voivodeship,
                'deleted' as change_type,
                deleted_at as event_time
            FROM locations
            WHERE deleted_at IS NOT NULL AND voivodeship IS NOT NULL
        )
        SELECT
            voivodeship,
            change_type,
            COUNT(*) as count
        FROM monthly_events
        {where}
        GROUP BY voivodeship, change_type
    """, params).fetchall()

    voivodeship_stats = {}
    for voiv, change_type, count in results:
        if voiv not in voivodeship_stats:
            voivodeship_stats[voiv] = {
                "voivodeship": voiv,
                "created": 0,
                "deleted": 0,
                "updated": 0,
                "total": 0,
            }
        voivodeship_stats[voiv][change_type] = count
        voivodeship_stats[voiv]['total'] += count

    return {
        "month": month,
        "data": sorted(voivodeship_stats.values(), key=lambda x: x['voivodeship'])
    }


@router.get("/changes/timeline")
@cached(ttl=3600)
async def get_deletion_timeline(
    limit_months: int = 12,
):
    """Get timeline of deletions over the last N months."""
    results = client.execute("""
        SELECT
            CAST(deleted_at AS DATE) as source_date,
            COUNT(*) as count
        FROM locations
        WHERE deleted_at IS NOT NULL
        GROUP BY source_date
        ORDER BY source_date DESC
        LIMIT ?
    """, [limit_months]).fetchall()

    timeline_data = []
    for date, count in reversed(results):
        timeline_data.append({
            "date": str(date),
            "deletions": count,
        })

    return {
        "timeline": timeline_data
    }
