"""Dashboard data aggregation endpoint (returns all data for frontend)."""

from fastapi import APIRouter
from backend.database_ch import client
import json

router = APIRouter()

@router.get("/dashboard-data")
async def get_dashboard_data():
    """Get all aggregated data for dashboard in one call."""

    # Summary
    summary = client.execute("""
        SELECT COUNT(*) as total, SUM(has_merrychef) as czy_ma_piec,
               SUM(open_sunday) as open_sunday, SUM(h24) as h24
        FROM locations WHERE deleted_at IS NULL
    """).fetchone()

    # Top 30 cities
    cities = client.execute("""
        SELECT city, voivodeship, COUNT(*) as count
        FROM locations WHERE deleted_at IS NULL
        GROUP BY city, voivodeship ORDER BY count DESC LIMIT 30
    """).fetchall()

    # Voivodeships with stats
    voivodeships = client.execute("""
        SELECT LOWER(voivodeship) as name, COUNT(*) as count
        FROM locations WHERE deleted_at IS NULL
        GROUP BY voivodeship ORDER BY count DESC
    """).fetchall()

    # Streets (simplified - top 25 streets with city)
    streets = client.execute("""
        SELECT street, city as town, COUNT(*) as count
        FROM locations WHERE deleted_at IS NULL AND street IS NOT NULL
        GROUP BY street, city ORDER BY count DESC LIMIT 25
    """).fetchall()

    latest_date = client.execute("SELECT MAX(CAST(created_at AS DATE)) FROM locations").fetchone()
    source_date = str(latest_date[0]) if latest_date and latest_date[0] else "2026-06-25"

    return {
        "meta": {
            "total": int(summary[0] or 0),
            "visible": int(summary[0] or 0),
            "towns": 0,  # Would need separate calculation
            "czy_ma_piec": int(summary[1] or 0),
            "open_sunday": int(summary[2] or 0),
            "h24": int(summary[3] or 0),
            "source_date": source_date
        },
        "cities": [
            {"name": c[0], "count": c[2]}  # Skip voivodeship in format
            for c in cities
        ],
        "voivodeships": [
            {"name": v[0], "count": v[1]}
            for v in voivodeships
        ],
        "streets": [
            {"street": s[0], "town": s[1], "count": s[2]}
            for s in streets
        ],
        "street_names": [],  # Placeholder
        "timeline": [],  # Placeholder
        "timeline_monthly": [],  # Placeholder
        "closing_hours": [],  # Placeholder
        "merrychef": {
            "yes": int(summary[1] or 0),
            "no": int((summary[0] or 0) - (summary[1] or 0))
        },
        "nn": {"median_m": 0, "mean_m": 0, "min_m": 0, "closest_pair_m": 0},
        "nn_cities": [],
        "points": [],  # Would need full location data
        "woj_geo": {}  # GeoJSON - needs separate file
    }
