"""
Litestar backend for Żabka Dashboard v2.

Cached endpoints:
- /api/stats/* - Aggregated statistics
- /api/trends/* - Trends and historical data
- /api/locations/* - Location data
- /api/history/* - Change history
"""

import json
import os
import pathlib
import subprocess
from datetime import datetime

from litestar import Litestar, Router, get, post
from litestar.config.compression import CompressionConfig
from litestar.config.cors import CORSConfig
from litestar.connection import Request
from litestar.exceptions import HTTPException
from litestar.response import File
from litestar.static_files import create_static_files_router

from backend.api.admin_router import router as admin_router
from backend.api.dashboard_router import router as dashboard_router
from backend.api.ecology_router import router as ecology_router
from backend.api.geo_router import router as geo_router
from backend.api.history_router import router as history_router
from backend.api.locations_router import router as locations_router
from backend.api.spatial_router import router as spatial_router
from backend.api.stats_router import router as stats_router
from backend.database_ch import DB_PATH, client, init_db

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


# Public download endpoints (paths relative to /api/download/...)
@get("/download/database")
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


@get("/download/geojson")
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


@get("/download/parquet")
async def download_parquet() -> File:
    """Export active locations to Parquet (ZSTD-compressed, ~1 MB).

    DuckDB writes to a temp file via its native Parquet writer; the file is
    served as a download and overwritten on each request. Column selection
    mirrors the public schema minus the internal surrogate keys.
    """
    out = pathlib.Path("/tmp/zabka_locations.parquet")
    import duckdb as _duckdb

    con = _duckdb.connect(str(DB_PATH), read_only=True)
    try:
        con.execute(f"""
            COPY (
                SELECT
                    store_id, city, street, voivodeship, powiat,
                    voivodeship_id, powiat_id, gmina_id, miasto_id,
                    latitude, longitude,
                    has_merrychef, open_sunday, h24,
                    opening_hours_monsat, opening_hours_sun,
                    first_opening_date, is_visible,
                    elevation_meters, is_in_nature_park,
                    nearest_neighbor_distance_meters,
                    amphibian_occurrences_5km, nearest_amphibian_km,
                    h3_index_9, created_at
                FROM locations
                WHERE deleted_at IS NULL
                ORDER BY voivodeship_id, powiat_id
            ) TO '{out}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
    finally:
        con.close()
    return File(
        path=out,
        filename="zabka_locations.parquet",
        media_type="application/vnd.apache.parquet",
    )


# Protected endpoint: Upload snapshot (path relative to /api/snapshot)
@post("/snapshot")
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


# Router modules to import startup lifecycle hooks from
router_modules = [
    geo_router,
    ecology_router,
    spatial_router,
    stats_router,
    locations_router,
    history_router,
    admin_router,
    dashboard_router,
]

# Create parent API router prefixed with /api
api_router = Router(
    path="/api",
    route_handlers=[
        locations_router,
        history_router,
        admin_router,
        dashboard_router,
        geo_router,
        ecology_router,
        spatial_router,
        stats_router,
        download_database,
        download_geojson,
        download_parquet,
        upload_snapshot,
    ]
)

# Gather on_startup lifecyle handlers
on_startup = []
for rm in router_modules:
    if hasattr(rm, "startup_handlers"):
        on_startup.extend(rm.startup_handlers)

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

route_handlers = [api_router, health_check]

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
    import multiprocessing

    import uvicorn

    workers = int(os.getenv("UVICORN_WORKERS", max(2, multiprocessing.cpu_count())))
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        workers=workers,
        access_log=os.getenv("UVICORN_ACCESS_LOG", "false").lower() == "true",
    )
