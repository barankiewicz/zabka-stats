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
    """Get full change history for a specific location."""
    location = client.execute(f"SELECT 'Żabka' FROM locations WHERE id = {location_id}").fetchone()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    results = client.execute(f"""
        SELECT id, change_type, field_changed, old_value, new_value, recorded_at, snapshot_id
        FROM histories
        WHERE location_id = {location_id}
        ORDER BY recorded_at DESC
        LIMIT {limit}
    """).fetchall()

    return {
        "location_id": location_id,
        "location_name": location[0],
        "history": [
            {
                "id": r[0],
                "change_type": r[1],
                "field_changed": r[2],
                "old_value": r[3],
                "new_value": r[4],
                "recorded_at": str(r[5]),
                "snapshot_id": r[6],
            }
            for r in results
        ]
    }


@router.get("/changes/monthly")
@cached(ttl=3600)
async def get_monthly_changes(
    year: Optional[int] = None,
    voivodeship: Optional[str] = None,
):
    """Get monthly change statistics."""
    where = ""
    if year:
        where = f"WHERE strftime(histories.source_date, '%Y') = '{year}'"
    if voivodeship:
        where += f" {'AND' if where else 'WHERE'} voivodeship = '{voivodeship}'"

    results = client.execute(f"""
        SELECT
            strftime(histories.source_date, '%Y-%m') as month,
            change_type,
            COUNT(*) as count
        FROM histories
        JOIN snapshots ON histories.snapshot_id = snapshots.id
        {'LEFT JOIN locations ON histories.location_id = locations.id' if voivodeship else ''}
        {where}
        GROUP BY month, change_type
        ORDER BY month
    """).fetchall()

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
    if month:
        where = f"WHERE strftime(snapshots.source_date, '%Y-%m') = '{month}'"

    results = client.execute(f"""
        SELECT
            locations.voivodeship,
            histories.change_type,
            COUNT(*) as count
        FROM histories
        JOIN locations ON histories.location_id = locations.id
        JOIN snapshots ON histories.snapshot_id = snapshots.id
        {where}
        GROUP BY locations.voivodeship, histories.change_type
    """).fetchall()

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
    results = client.execute(f"""
        SELECT
            histories.source_date,
            COUNT(*) as count
        FROM histories
        JOIN snapshots ON histories.snapshot_id = snapshots.id
        WHERE change_type = 'deleted'
        GROUP BY histories.source_date
        ORDER BY histories.source_date DESC
        LIMIT {limit_months}
    """).fetchall()

    timeline_data = []
    for date, count in reversed(results):
        timeline_data.append({
            "date": str(date),
            "deletions": count,
        })

    return {
        "timeline": timeline_data
    }
