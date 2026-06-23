"""
Warm the Redis cache after a daily ETL run.

The ETL at 03:00 clears the Redis cache as its last step, so the first
real user on the dashboard after that hit DuckDB cold on every endpoint
(the dashboard fires ~14 requests in parallel on page load). This script
hits the same endpoints the SPA would, with a small concurrency, so the
cache is hot before any human traffic arrives.

Idempotent, best-effort: a single 5xx is logged and the script moves on.
"""

import asyncio
import logging
import os
import sys
import time
from typing import Iterable

import httpx


# Endpoints the SPA fires on page load (core bucket) + a couple of tab buckets.
# Keep this in sync with frontend/src/data.js.
PATHS: list[tuple[str, str]] = [
    # core bucket - default tab "Społeczeństwo"
    ("/api/stats/summary",                    "core-summary"),
    ("/api/geo/voivodeships",                 "core-geo-voiv"),
    ("/api/stats/powiat-economics",           "core-powiat-econ"),
    ("/api/stats/sunday-by-voivodeship",      "core-sunday"),
    ("/api/stats/voivodeship-density",        "core-density"),
    ("/api/stats/voivodeship",                "core-voivodeship"),
    ("/api/stats/inpost-vs-zabka",            "core-inpost"),
    ("/api/stats/per-capita",                 "core-per-capita"),
    ("/api/stats/section3-rare",              "core-section3"),
    ("/api/stats/opening-hours",              "core-opening-hours"),
    # tab "Historia" - loadSiec
    ("/api/stats/network-growth",             "siec-network-growth"),
    ("/api/stats/network-origin",             "siec-network-origin"),
    ("/api/stats/stores-timeline",            "siec-stores-timeline"),
    ("/api/stats/growth-by-voivodeship",      "siec-growth-by-voiv"),
    ("/api/stats/city-first-opening",         "siec-city-first"),
    ("/api/stats/top-cities?limit=20",        "siec-top-cities"),
    ("/api/stats/openings-monthly",           "siec-openings-monthly"),
    ("/api/stats/powiat-coverage",            "siec-powiat-coverage"),
    ("/api/stats/neighbor-stats",             "siec-neighbor-stats"),
    # tab "EDGE CASE'Y" - loadEdge (subset - the cheap ones)
    ("/api/stats/kraniec-facts",              "edge-kraniec"),
    ("/api/stats/elevation",                  "edge-elevation"),
    ("/api/stats/amphibians",                 "edge-amphibians"),
]


CONCURRENCY = 6        # 6 in flight; 1 vCPU VPS, don't push it
TIMEOUT_S = 30          # generous; a cold DuckDB query + nginx cold cache can be slow
BASE_URL = os.getenv("WARM_BASE_URL", "http://127.0.0.1:8000")


async def _hit(client: httpx.AsyncClient, path: str, name: str, log: logging.Logger) -> None:
    t0 = time.perf_counter()
    try:
        r = await client.get(BASE_URL + path, timeout=TIMEOUT_S)
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code == 200:
            log.info("  ok  %-7s %6.0f ms  %s", r.status_code, ms, name)
        else:
            log.warning("  %s  %6.0f ms  %s", r.status_code, ms, name)
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        log.warning("  ERR  %6.0f ms  %s  %s", ms, name, e)


async def _warm(sem: asyncio.Semaphore, log: logging.Logger) -> None:
    async with httpx.AsyncClient() as client:
        async def bounded(p, n):
            async with sem:
                await _hit(client, p, n, log)
        await asyncio.gather(*(bounded(p, n) for p, n in PATHS))


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    log = logging.getLogger("warm_cache")
    log.info("warming %d endpoints against %s (concurrency=%d)",
             len(PATHS), BASE_URL, CONCURRENCY)
    sem = asyncio.Semaphore(CONCURRENCY)
    t0 = time.perf_counter()
    asyncio.run(_warm(sem, log))
    log.info("done in %.1f s", time.perf_counter() - t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
