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

import httpx

# Endpoints the SPA fires on page load, with the EXACT query params it uses -
# the Redis cache key includes the params, so warming must hit the same URLs or
# the warmed keys won't match what the dashboard requests. Keep in sync with
# frontend/src/data.js (the loadCore / loadSiec / loadSpoleczenstwo buckets).
PATHS: list[tuple[str, str]] = [
    # shared / core
    ("/api/stats/summary",                              "summary"),
    ("/api/geo/voivodeships",                           "geo-voiv"),
    ("/api/stats/powiat-economics",                     "powiat-econ"),
    ("/api/stats/per-capita",                           "per-capita"),
    ("/api/stats/inpost-vs-zabka",                      "inpost"),
    ("/api/stats/coverage-funnel",                      "coverage-funnel"),
    ("/api/stats/voivodeship",                          "voivodeship"),
    ("/api/stats/voivodeship-density",                  "voiv-density"),
    ("/api/stats/opening-hours",                        "opening-hours"),
    # SIEĆ tab
    ("/api/stats/network-growth",                       "network-growth"),
    ("/api/stats/network-origin",                       "network-origin"),
    ("/api/stats/stores-timeline",                      "stores-timeline"),
    ("/api/stats/openings-monthly",                     "openings-monthly"),
    ("/api/stats/city-first-opening",                   "city-first"),
    ("/api/stats/top-cities?limit=20",                  "top-cities"),
    ("/api/stats/powiat-coverage",                      "powiat-coverage"),
    ("/api/stats/neighbor-stats",                       "neighbor-stats"),
    ("/api/stats/kraniec-facts",                        "kraniec"),
    ("/api/stats/elevation",                            "elevation"),
    ("/api/stats/amphibians",                           "amphibians"),
    ("/api/stats/parks-stores",                         "parks-stores"),
    ("/api/stats/twins",                                "twins"),
    ("/api/stats/section3-rare",                        "section3"),
    ("/api/stats/by-dimension?dim=city&metric=count&sort=desc&limit=60", "bubble-cities"),
    # ŻABKA A POLSKA tab
    ("/api/stats/common-streets?limit=15",              "common-streets"),
    ("/api/stats/gmina-leaders?limit=12",               "gmina-leaders"),
    ("/api/stats/neighbor-by-level?level=voivodeship&sort=asc", "nbl-voiv"),
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
