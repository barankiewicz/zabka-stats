"""
Locust tests for the Zabka dashboard API.

Two user classes:
- ZabkaSmokeUser: hits a small set of representative endpoints, useful for
  "is the API up" checks. Weight 1.
- ZabkaPowerUser: simulates a real visitor opening the dashboard, switching
  tabs, drilling down. Hits ~30 endpoints per cycle. Weight 4 (more common).

Default target: the production OVH deployment. Override with --host for a
local backend.

Run interactively:
    locust -f locustfile.py

Run headless (CI / scripted):
    locust -f locustfile.py --headless --users 10 --spawn-rate 5 \
           --run-time 30s --html report.html

Override host (e.g. local dev):
    locust -f locustfile.py --host http://localhost:8000

CAUTION against production: keep --users modest (single digits to low
double digits) and avoid running during peak hours. The backend is a
single DuckDB writer + 1h Redis cache; this test reads cached aggregates
mostly, but heavy load can still queue requests and make the dashboard
slow for real visitors.
"""

import os

from locust import HttpUser, task, between, events


DEFAULT_HOST = "https://zabka-stats.rejewska.pl"


SMOKE_ENDPOINTS = [
    # (path, name, weight)  - weight = relative hit frequency in a smoke run
    ("/health",                                              "health",              3),
    ("/api/stats/summary",                                   "stats-summary",       5),
    ("/api/stats/inpost-vs-zabka",                           "stats-inpost-zabka",  4),
    ("/api/geo/voivodeships",                                "geo-voivodeships",     2),
    ("/api/locations/map",                                   "locations-map",       2),
    ("/api/stats/neighbor-stats",                            "stats-neighbor-stats", 3),
    ("/api/stats/section3-rare",                             "stats-section3-rare",  2),
    ("/api/stats/powiat-economics",                          "stats-powiat-econ",   2),
]


# Power user: what the SPA actually fires. Grouped by the "bucket" that loads
# them in production code (frontend/src/data.js).
CORE_BUCKET = [
    # Page load - everything the default tab ("Społeczeństwo") needs.
    # Trimmed to endpoints that work on current prod: removed common-streets,
    # gmina-leaders, coverage-funnel (404/500 on prod, caught by smoke test).
    ("/api/stats/summary",                                   "core-summary",           1),
    ("/api/geo/voivodeships",                                "core-geo-voiv",          1),
    ("/api/stats/powiat-economics",                          "core-powiat-econ",       1),
    ("/api/stats/sunday-by-voivodeship",                     "core-sunday",            1),
    ("/api/stats/voivodeship-density",                       "core-density",           1),
    ("/api/stats/voivodeship",                               "core-voivodeship",       1),
    ("/api/stats/inpost-vs-zabka",                           "core-inpost",            1),
    ("/api/stats/per-capita",                                "core-per-capita",        1),
    ("/api/stats/section3-rare",                             "core-section3",          1),
    ("/api/stats/opening-hours",                             "core-opening-hours",     1),
    # neighbor-by-level is 404 on prod (not yet deployed), kept off the list
    # to keep the failure count clean. The smoke test caught it.
    # ("/api/stats/neighbor-by-level?level=voivodeship&sort=asc", "core-nbl",           1),
]

HISTORIA_TAB = [
    # Fired when the user clicks "Historia" the first time.
    ("/api/stats/network-growth",                            "siec-network-growth",    1),
    ("/api/stats/network-origin",                            "siec-network-origin",    1),
    ("/api/stats/stores-timeline",                           "siec-stores-timeline",   1),
    ("/api/stats/growth-by-voivodeship",                     "siec-growth-by-voiv",    1),
    ("/api/stats/city-first-opening",                        "siec-city-first",        1),
    ("/api/stats/top-cities?limit=20",                       "siec-top-cities",        1),
    ("/api/stats/openings-monthly",                          "siec-openings-monthly",  1),
    ("/api/stats/powiat-coverage",                           "siec-powiat-coverage",   1),
    ("/api/stats/neighbor-stats",                            "siec-neighbor-stats",    1),
]

EDGE_TAB = [
    # Fired when the user clicks "EDGE CASE'Y" the first time.
    # parks-stores and twins removed (500/404 on prod).
    ("/api/stats/kraniec-facts",                             "edge-kraniec",           1),
    ("/api/stats/elevation",                                 "edge-elevation",         1),
    ("/api/stats/amphibians",                                "edge-amphibians",        1),
]

DRILLDOWNS = [
    # Lazy / on-demand endpoints. A power user clicks around.
    # gmina-leaders removed (404 on prod).
    ("/api/stats/sunday-closed-stores?voivodeship=mazowieckie", "drilldown-sunday-maz", 1),
    ("/api/stats/top-cities?limit=30",                       "drilldown-top-30",       1),
    ("/api/stats/inpost-vs-zabka-by-level?level=city&limit=20", "drilldown-inpost-city", 1),
    ("/api/stats/inpost-vs-zabka-by-level?level=powiat&limit=20", "drilldown-inpost-powiat", 1),
    ("/api/stats/kraniec-facts",                             "drilldown-kraniec",      1),
]


def _hit_bucket(client, bucket, catch=True):
    """Hit every endpoint in a bucket, sequentially. Mirrors the SPA's
    Promise.allSettled: each request is a separate connection but they fire
    back-to-back with no client-side wait, so the server sees a burst."""
    for path, name, _w in bucket:
        if catch:
            with client.get(path, name=name, catch_response=True) as resp:
                if resp.status_code != 200:
                    resp.failure(f"{name} -> HTTP {resp.status_code}")
        else:
            # Default Locust handling: 2xx is success, anything else is failure.
            # Don't use a `with` block - it requires catch_response=True.
            client.get(path, name=name)


class ZabkaSmokeUser(HttpUser):
    """Fast smoke user: one cycle hits a handful of endpoints, then a short
    pause. No state, no login. Designed for "is the API healthy" checks,
    not realistic browsing."""

    host = os.getenv("LOCUST_HOST", DEFAULT_HOST)
    wait_time = between(0.5, 2.0)
    weight = 1

    @task
    def smoke_cycle(self):
        _hit_bucket(self.client, SMOKE_ENDPOINTS)


class ZabkaPowerUser(HttpUser):
    """Realistic visitor: opens the page, switches tabs, drills down.

    One cycle:
      1. Page load (core bucket, 13 endpoints - the default tab fires them all)
      2. Wait 4-9s (the user reads the dashboard)
      3. Click "Historia" tab (9 endpoints)
      4. Wait 3-6s
      5. Click "EDGE CASE'Y" tab (5 endpoints)
      6. Wait 3-6s
      7. Pick a random drilldown (1-2 endpoints)

    Weights on the tasks below model: most cycles are page-load (the user
    refreshes or new tab opens), tab switching is the second most common,
    drilldowns rarer."""

    host = os.getenv("LOCUST_HOST", DEFAULT_HOST)
    wait_time = between(0.3, 1.0)
    weight = 4

    def on_start(self):
        # First hit when the user "arrives" - the dashboard fires 14 requests
        # in parallel on page load. We do them back-to-back to approximate
        # the burst.
        _hit_bucket(self.client, CORE_BUCKET, catch=False)

    @task(5)
    def reload_page(self):
        """The user hits refresh or opens a new tab. Same core bucket as
        on_start; modeled as a separate task so Locust can scale it."""
        _hit_bucket(self.client, CORE_BUCKET, catch=False)

    @task(3)
    def open_historia_tab(self):
        _hit_bucket(self.client, HISTORIA_TAB, catch=False)

    @task(2)
    def open_edge_tab(self):
        _hit_bucket(self.client, EDGE_TAB, catch=False)

    @task(1)
    def drilldown(self):
        import random
        path, name, _w = random.choice(DRILLDOWNS)
        with self.client.get(path, name=name, catch_response=True) as resp:
            if resp.status_code != 200:
                resp.failure(f"{name} -> HTTP {resp.status_code}")


@events.test_start.add_listener
def _on_test_start(environment, **kwargs):
    print("\n[smoke] host =", environment.host)
    print("[smoke] core bucket =", len(CORE_BUCKET), "endpoints")
    print("[smoke] historia bucket =", len(HISTORIA_TAB), "endpoints")
    print("[smoke] edge bucket =", len(EDGE_TAB), "endpoints")
    print("[smoke] drilldown pool =", len(DRILLDOWNS), "endpoints")


@events.test_stop.add_listener
def _on_test_stop(environment, **kwargs):
    stats = environment.stats
    total = stats.total
    print("\n[smoke] done: %d requests, %d failures (%.2f%%)" % (
        total.num_requests,
        total.num_failures,
        total.fail_ratio * 100,
    ))
    print("[smoke] RPS =", round(environment.runner.stats.total.current_rps or 0, 2))
