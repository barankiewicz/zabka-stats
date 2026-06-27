"""
Litestar backend for Żabka Dashboard v2.

LIVE API endpoints:
- /api/live/best-worst-weather - Real-time weather extremes
- /api/live/darkest-sky-stargazing - Best/worst stargazing spots
- /api/live/lightning-danger - Lightning strike monitoring

Cached endpoints:
- /api/stats/* - Aggregated statistics
- /api/trends/* - Trends and historical data
- /api/locations/* - Location data
- /api/history/* - Change history
"""

import os
import pathlib
import json
import subprocess
from datetime import datetime
from litestar import Litestar, get, post
from litestar.config.cors import CORSConfig
from litestar.config.compression import CompressionConfig
from litestar.static_files import create_static_files_router
from litestar.response import File
from litestar.exceptions import HTTPException
from litestar.connection import Request

from backend.database_ch import init_db, client, DB_PATH
from backend.api.locations_router import router as locations_router
from backend.api.history_router import router as history_router
from backend.api.admin_router import router as admin_router
from backend.api.dashboard_router import router as dashboard_router
from backend.api.geo_router import router as geo_router
from backend.api.ecology_router import router as ecology_router
from backend.api.spatial_router import router as spatial_router
from backend.api.stats_router import router as stats_router

# API_TOKEN is set via environment variable
API_TOKEN = os.getenv("API_TOKEN", "your-secret-token-change-me")

# Initialize database
try:
    init_db()
    print(" Database initialized")
except Exception as e:
    print(f"  Database initialization: {e}")


# Health check
@get("/health")
async def health_check() -> dict:
    try:
        result = client.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()
        location_count = result[0] if result else 0
        db_size_mb = round(DB_PATH.stat().st_size / (1024 * 1024), 2) if DB_PATH.exists() else 0
        
        # Additional statistics for dynamic badges
        city_count = client.execute("SELECT COUNT(DISTINCT city) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
        locker_count = client.execute("SELECT COUNT(*) FROM parcel_lockers WHERE deleted_at IS NULL").fetchone()[0]
        
        return {
            "status": "healthy",
            "database": "DuckDB",
            "database_size_mb": db_size_mb,
            "locations": location_count,
            "cities": city_count,
            "parcel_lockers": locker_count,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


# Public download endpoints
@get("/api/download/database")
async def download_database() -> File:
    """Download the raw DuckDB database file containing all populated tables."""
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="Database file not found"
        )
    return File(
        path=DB_PATH,
        filename="zabka.duckdb",
        media_type="application/octet-stream"
    )


@get("/api/download/geojson")
async def download_geojson() -> File:
    """Download the generated GeoJSON boundary file."""
    geojson_path = DB_PATH.parent / "geo" / "wojewodztwa.geojson"
    if not geojson_path.exists():
        raise HTTPException(
            status_code=404,
            detail="GeoJSON file not found"
        )
    return File(
        path=geojson_path,
        filename="wojewodztwa.geojson",
        media_type="application/geo+json"
    )


# Protected endpoint: Upload snapshot
@post("/api/snapshot")
async def upload_snapshot(request: Request) -> dict:
    """
    Upload a new snapshot JSON file (DuckDB).
    """
    form_data = await request.form()
    token = form_data.get("token")
    file_upload = form_data.get("file")
    source_date = form_data.get("source_date")

    # Verify token
    if token != API_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid API token"
        )

    if not file_upload:
        raise HTTPException(
            status_code=400,
            detail="No file uploaded"
        )

    try:
        # Read uploaded file contents
        contents = file_upload.file.read()
        data = json.loads(contents)

        # Use provided date or extract from metadata
        if not source_date:
            source_date = data.get('meta', {}).get('source_date')
            if not source_date:
                raise ValueError("source_date not provided and not in JSON metadata")

        # Save file temporarily
        project_root = pathlib.Path(__file__).parent.parent
        data_input_dir = project_root / "data" / "input"
        data_input_dir.mkdir(parents=True, exist_ok=True)

        temp_path = data_input_dir / f"snapshot_{source_date}.json"
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)

        return {
            "status": "success",
            "file_saved": str(temp_path),
            "source_date": source_date,
            "message": "Snapshot received, processing queued"
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing snapshot: {str(e)}")


# Build route handlers list from our routers
routers = [
    geo_router,
    ecology_router,
    spatial_router,
    stats_router,
    locations_router,
    history_router,
    admin_router,
    dashboard_router,
]

route_handlers = [
    health_check,
    download_database,
    download_geojson,
    upload_snapshot,
]

# Map custom APIRouters to Litestar Router instances
for r in routers:
    route_handlers.append(r.to_litestar_router("/api"))

# Gather on_startup lifecyle handlers
on_startup = []
for r in routers:
    on_startup.extend(r.startup_handlers)

# Serve frontend from Vite build output (frontend/dist/).
_project_root = pathlib.Path(__file__).parent.parent
_frontend_root = _project_root / "frontend"
_dist_dir = _frontend_root / "dist"

if not _dist_dir.exists():
    print("Frontend dist missing — building now (npm run build)...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(_project_root),
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        print("Frontend built successfully.")
    else:
        print(f"Frontend build failed:\n{result.stderr}")

frontend_dir = _dist_dir if _dist_dir.exists() else _frontend_root

try:
    static_router = create_static_files_router(
        path="/",
        directories=[str(frontend_dir)],
        html_mode=True,
        name="frontend"
    )
    route_handlers.append(static_router)
except Exception as e:
    print(f"Note: Static files router could not be configured: {e}")

cors_config = CORSConfig(
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

compression_config = CompressionConfig(backend="gzip", minimum_size=1000)

app = Litestar(
    route_handlers=route_handlers,
    cors_config=cors_config,
    compression_config=compression_config,
    on_startup=on_startup
)

if __name__ == "__main__":
    import uvicorn
    import multiprocessing

    workers = int(os.getenv("UVICORN_WORKERS", max(2, multiprocessing.cpu_count())))
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        workers=workers,
        access_log=os.getenv("UVICORN_ACCESS_LOG", "false").lower() == "true",
    )
