"""
FastAPI backend for Żabka Dashboard v2.

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
from fastapi import FastAPI, HTTPException, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database_ch import init_db, client
from backend.api.locations_router import router as locations_router
from backend.api.history_router import router as history_router
from backend.api.aggregates_router_cached import router as aggregates_router
from backend.api.admin_router import router as admin_router
from backend.api.dashboard_router import router as dashboard_router
from backend.api.frontend_router import router as frontend_router

# API_TOKEN is set via environment variable
API_TOKEN = os.getenv("API_TOKEN", "your-secret-token-change-me")

app = FastAPI(
    title="Żabka Dashboard API v2",
    description="Real-time analytics for Żabka store distribution across Poland",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
try:
    init_db()
    print(" Database initialized")
except Exception as e:
    print(f"  Database initialization: {e}")


# Health check
@app.get("/health")
async def health_check():
    try:
        result = client.execute("SELECT COUNT(*) FROM locations").fetchone()
        location_count = result[0] if result else 0
        return {
            "status": "healthy",
            "database": "DuckDB",
            "locations": location_count,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


# Protected endpoint: Upload snapshot
@app.post("/api/snapshot")
async def upload_snapshot(
    token: str,
    file: UploadFile = File(...),
    source_date: str = None
):
    """
    Upload a new snapshot JSON file (DuckDB).

    Args:
        token: API token (required)
        file: JSON file containing snapshot data
        source_date: YYYY-MM-DD (optional, derived from file if not provided)
    """
    # Verify token
    if token != API_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API token"
        )

    try:
        # Read uploaded file
        contents = await file.read()
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

        # TODO: Process the saved snapshot into DuckDB (see backend.daily_etl)

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


# Include routers — frontend_router first so its versions of summary/voivodeship/
# top-cities/per-capita take precedence over the legacy aggregates_router shapes.
app.include_router(frontend_router, prefix="/api", tags=["Frontend v2"])
app.include_router(locations_router, prefix="/api", tags=["Locations"])
app.include_router(history_router, prefix="/api", tags=["History"])
app.include_router(aggregates_router, prefix="/api", tags=["Aggregates"])
app.include_router(admin_router, prefix="/api", tags=["Administrative & Live Data"])
app.include_router(dashboard_router, prefix="/api", tags=["Dashboard"])

# Serve frontend from Vite build output (frontend/dist/).
# If the dist is missing, run `npm run build` automatically so the server always works.
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
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
except Exception:
    print(f"Note: Frontend directory not found at {frontend_dir}")


if __name__ == "__main__":
    import uvicorn
    import multiprocessing

    workers = int(os.getenv("UVICORN_WORKERS", max(2, multiprocessing.cpu_count())))
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        workers=workers,
        # access_log controlled by env; off in production to reduce I/O
        access_log=os.getenv("UVICORN_ACCESS_LOG", "false").lower() == "true",
    )
