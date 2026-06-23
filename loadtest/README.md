# Zabka dashboard - load test

Smoke load test for the dashboard API. Hits a representative subset of
read-only endpoints the SPA fires on page load. Not a realistic user
simulation - just "is the API up, are the main paths returning 2xx,
what are the latencies".

**Default target:** the production deployment at
`https://zabka-stats.rejewska.pl/` (nginx + uvicorn on the OVH VPS).
Override with `--host` for a local backend, or set `LOCUST_HOST` env var.

## Install

```bash
cd loadtest
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

### Interactive (web UI at http://localhost:8089)

```bash
locust -f locustfile.py
```

In the UI set the host (defaults to prod), number of users, spawn rate,
then start. Good for exploring what each endpoint does and watching live
charts.

### Headless (CI / scripted)

```bash
locust -f locustfile.py --headless \
    --users 5 \
    --spawn-rate 2 \
    --run-time 20s \
    --html report.html
```

Writes `report.html` (Locust's HTML report with charts) and exits non-zero
if any requests failed. The script also prints a one-line summary on stop.

Override the host:

```bash
locust -f locustfile.py --host http://localhost:8000 --headless ...
```

Or via env var (used as the class default if `--host` is not given):

```bash
LOCUST_HOST=http://localhost:8000 locust -f locustfile.py
```

## Caution: load testing production

The default target is the live OVH deployment. Some ground rules:

- Keep `--users` modest (single digits to low double digits). The backend
  is uvicorn on a single vCPU + DuckDB with a 1h Redis cache. Most of the
  smoke endpoints hit cache and are cheap, but a flood of cold-cache
  requests on `/api/locations/map` (13k+ rows) or `powiat-economics`
  can queue up and slow the dashboard for real visitors.
- Avoid peak hours (after 18:00 PL time, when the dashboard gets organic
  traffic). Early morning or weekend is safer.
- Stop the test if real users start seeing 5xx.

### About the nginx rate limit (30 req/s per IP)

Production has `limit_req_zone $binary_remote_addr zone=api_limit:10m
rate=30r/s;` with `burst=50 nodelay`. Locust runs from one IP, so a
"power user" (page load = 14 requests back-to-back) plus spawn rate
triggers 503s **before the backend is anywhere near overloaded**. This
is the rate limit doing its job, not a backend failure.

To measure real backend throughput, temporarily raise the rate limit
on the VPS:

```bash
ssh zabka-vps 'sudo cp /etc/nginx/sites-available/zabka /tmp/zabka.normal && \
  sudo sed -i "s/rate=30r\/s/rate=500r\/s/; s/burst=50/burst=200/g" \
  /etc/nginx/sites-available/zabka && \
  sudo nginx -t && sudo systemctl reload nginx'
# run the test...
ssh zabka-vps 'sudo cp /tmp/zabka.normal /etc/nginx/sites-available/zabka && \
  sudo nginx -t && sudo systemctl reload nginx'
```

Tested at 10 power users with the raised limit: 2489 requests, 0
failures, ~90 RPS, p95 under 200 ms. Restore the limit after the test -
real users from different IPs won't hit it.

## What it tests

`SMOKE_ENDPOINTS` in `locustfile.py` lists 9 paths, mixing:

- cached aggregates (fast path, e.g. `/api/stats/summary`)
- heavy SQL (e.g. `/api/locations/map` returns 13k+ rows)
- static files (`/api/geo/voivodeships`)
- parameterized queries (powiat vs voivodeship level of `/api/stats/neighbor-by-level`)

The `weight` column is informational only - the smoke run hits each
endpoint once per cycle in the order listed. For a "real" user model
(many requests to heavy endpoints, page-load burst pattern, etc.) this
file would need a richer `ZabkaUser` class.

## Files

- `locustfile.py` - the test scenario
- `requirements.txt` - `locust`
- `README.md` - this file

