# CLAUDE.md - Żabka Dashboard (single source of truth)

The single source of truth for this project. All documentation lives in this one
file, split into chapters (it used to be scattered across README / ARCHITECTURE /
SCHEMA / ENRICHMENT / per-folder READMEs - now merged here). This is the file we
work on.

## Table of contents

- 0. Instructions for Claude Code (directives, commit style, notes)
- 1. Overview and quick start
- 2. Backend (tech stack, Redis, database choice, API)
- 3. Data (ETL process, data core, enrichment, schema with types)
- 4. Frontend (dashboard, visual story, components, libraries)

---

# 0. Instructions for Claude Code

## CRITICAL DIRECTIVE: ZERO EMOJIS

Every single file in this project must contain ZERO emojis. This includes:
- Documentation (this file, READMEs, etc.)
- Code comments and docstrings
- Commit messages
- Configuration files
- Print statements and console output
- Any other repo-facing text

If a change requires repo-facing text (commit messages, docs, comments, output),
use humanizing language instead. No emoji whatsoever. This is non-negotiable.

## Language and writing

- Documentation is written in English. Keep it correct and casual-but-formal.
  Run client-facing text through a humanizer pass (strip the usual AI-writing
  tells: inflated phrasing, rule-of-three padding, em-dash overuse, "not just X
  but Y") before shipping.
- Keep identifiers in their original form: column names, table names, variable
  names, env-var names, CLI flags, function names, and code comments. Do not
  translate them. Same for data values (voivodeship names and similar) and URLs.
- When writing Polish (commit messages, chat), do not contort sentences to dodge
  English loanwords. Using English technical terms is fine.

## Commit message style

Documentation (this file, docstrings): formal, precise, no typos, well organized.

Git commits:
- Natural, conversational tone, like explaining something to a coworker over coffee
- Typos and shorthand are fine ("tbh", "gonna")
- No emoji (just say it plainly)
- Humanized, not corporate-speak
- Focus on WHY, not just WHAT

Good example:
```
Bring back original green map UI with new backend

Restored the original dashboard design with the cool voivodeship map
built in Chart.js. The dark theme still looks really good with the green
colors. Added live weather and air quality widgets to the KPI cards.
```

Bad example (emoji + dry bullet list with no "why"):
```
Revert frontend implementation

- Removed: v2 dashboard components
- Restored: voivodeship map
- Added: live data widgets
```

## Developer notes

- **Soft delete:** queries filter `deleted_at IS NULL` by default. To include
  deleted rows, add the condition explicitly in the router.
- **Indexes:** the database has indexes on commonly filtered fields (city,
  voivodeship, deleted_at, powiat, store_id). Add more if it helps.
- **Source JSON structure:** parsing of the Żabka source lives in
  `backend/etl/io.py` (`to_tabular`); re-check it against the real format when it
  changes.
- **Map performance:** with 13k+ locations the markers are fine; consider
  clustering above 50k.
- **ETL pipeline:** each enrichment source is its own `Enricher` class in
  `backend/etl/sources/`; network steps are best-effort (a missing source does
  not abort the ETL, the column just stays empty). Shared dimensions are not
  wiped on a transient failure: `load_dim_gios_station` skips the `DELETE` when
  the GIOŚ fetch comes back empty, so an unlucky run keeps the previous day's
  stations instead of zeroing `dim_gios_station`.
- **Retries:** every source fetch goes through `with_retries` - up to
  `ETL_RETRY_ATTEMPTS` tries (default 3), `ETL_RETRY_DELAY` seconds apart (default
  60, so 3x1 min), each request capped at `ETL_HTTP_TIMEOUT` (default 30s). This
  rides out transient API hiccups; only after all retries fail does the source
  fall back to lazy/empty. The core Żabka fetch falls back to a local file before
  giving up. Per-point elevation keeps its own short retry, not the 3x1 min policy.
- **DuckDB UNION ALL gotcha:** `ORDER BY ... LIMIT` is not allowed directly inside
  a `UNION ALL` branch. Wrap each branch: `SELECT * FROM (SELECT ... ORDER BY x LIMIT 1)
  UNION ALL SELECT * FROM (SELECT ... ORDER BY y LIMIT 1)`. Affects any endpoint that
  needs "top-1 per category" assembled from multiple queries.

## TODO (next up)

- [ ] Comparison modes (voivodeship vs national trend)
- [ ] Run ETL with `--elevation` and full GBIF/GUS to populate NULL columns (amphibians, elevation, powiat economics)

## Future improvements

- [ ] Webhook for automatic snapshot ingest (GitHub Actions, Lambda)


---

# 1. Overview and quick start

An interactive analytics platform for tracking the density and location changes of
the Żabka network across Poland.

## Features

- **Dashboard** Chart.js + Leaflet (bars, map, heatmap)
- **Interactive map** Leaflet with 13k+ locations
- **FastAPI backend** with DuckDB + Redis
- **Full change history** - tracks openings, closings, attribute changes
- **REST API** for integration
- **Daily refresh** of data snapshots
- **Dark theme** "Żabka in the dark city"

## Documentation

All documentation lives in this file (CLAUDE.md), in the chapters below: backend
(chapter 2), data/ETL/enrichment/schema (chapter 3), frontend (chapter 4).

## Quick start

### 1. Install dependencies

```bash
cd /home/alice/zabka-dashboard
pip install -r requirements.txt
```

### 2. Run the backend

**Option A: From the project root (recommended)**
```bash
python -m backend
```

**Option B: From the backend directory**
```bash
cd backend
python main.py
```

Backend is available at `http://localhost:8000`
- Frontend: `http://localhost:8000/`
- API docs (Swagger): `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 3. Load test data

```bash
# Full ETL: fetches data from the Żabka source, loads into DuckDB, clears the Redis cache
python -m backend.daily_etl

# From a local JSON file instead of fetching from the source
python -m backend.daily_etl --fallback data/input/snapshot_2026-06-15.json
```

### 4. Open the dashboard

Go to `http://localhost:8000` and see the charts and map.

## Workflow: loading new data

### Option A: CLI (for cron/automation)

```bash
python -m backend.daily_etl
```

### Option B: API (for applications)

```bash
curl -X POST http://localhost:8000/api/snapshot \
  -F "token=your-secret-token-change-me" \
  -F "file=@data/input/snapshot_YYYY-MM-DD.json"
```

Change `your-secret-token-change-me` to a secure token:

```bash
export API_TOKEN="your-super-secret-token-2024"
python backend/main.py
```

### Option C: Production - OVH VPS (systemd + daily cron)

The live deployment runs on an OVH VPS (Debian, Warsaw). Shared hosting (lh.pl)
was abandoned: `/home` is mounted `noexec`, so the native extensions (duckdb,
numpy, scikit-learn) cannot load their `.so` files there.

**Backend as a service.** A systemd unit `zabka-backend` runs
`venv/bin/python -m backend.main` (uvicorn on `0.0.0.0:8000`), `Restart=on-failure`,
under a non-root `zabka` user.

**HTTPS via nginx.** nginx reverse-proxies `https://zabka-stats.rejewska.pl/` to
`127.0.0.1:8000`, with a Let's Encrypt cert (certbot `--nginx`, auto-renew via the
`certbot.timer`) and a 80->443 redirect. Port 8000 is not exposed - the firewall
(ufw) allows only SSH, 80, and 443; the backend is reachable only over loopback
behind nginx.

**SSH hardening.** Key-only auth (`PasswordAuthentication no`), root login
disabled (`PermitRootLogin no`), and sshd moved off the default port to **420**
(set in `/etc/ssh/sshd_config.d/port.conf`; ufw allows 420, fail2ban's `sshd` jail
is pinned to it). Log in with `ssh -p 420 <user>@<vps-ip>`.

**Daily ETL via cron.** `crontab` runs `/home/zabka/cron_etl.sh` at 03:00
Europe/Warsaw. The script: `git pull --ff-only` (code arrives via a read-only
deploy key, not a push-deploy), `pip install -r requirements.txt`, **stops the
backend** (DuckDB is single-writer, so the service must release the lock before
the ETL opens it read-write), runs `python -m backend.daily_etl`, **restarts the
backend**, then emails a run status (success/failure + log tail) directly through
the Resend API. Secrets (`RESEND_API_KEY`, `MAIL_TO`) live in `/home/zabka/.cron_env`
(chmod 600), outside the repo.

The status email is the only run-status channel - there is no GitHub Actions step
in the daily loop. Code reaches the VPS by `git pull`, not by CI deploy.

**Analytics: GoatCounter.** A systemd unit `goatcounter.service` runs
`/usr/local/bin/goatcounter serve` (SQLite at `/home/zabka/goatcounter/goatcounter.sqlite3`,
listening on `127.0.0.1:8081`). nginx proxies `/gc/` to it; GoatCounter is told about
the path prefix via `-base-path /gc`. No cookies, no GDPR banner required. Dashboard:
`https://zabka-stats.rejewska.pl/gc/` (login: `alicja.barankiewicz@formula5.com`,
password in `/home/zabka/goatcounter/.gc_env`). The tracking script is inlined in
`<head>` of both HTML pages and fires on every page load automatically.

## Data format (JSON)

A snapshot JSON must contain:

```json
{
  "meta": {
    "total": 13168,
    "visible": 13083,
    "towns": 2203,
    "with_merrychef": 12790,
    "open_sunday": 12549,
    "h24": 35,
    "source_date": "2026-06-15"
  },
  "locations": [
    {
      "id": "unique_id",
      "name": "Żabka Centrum",
      "city": "Warszawa",
      "voivodeship": "mazowieckie",
      "street": "Marszałkowska",
      "lat": 52.23,
      "lon": 21.01,
      "has_merrychef": true,
      "open_sunday": true,
      "h24": false
    }
  ]
}
```

## API endpoints

### Public (read-only)

```
GET /api/locations?month=2026-06&voivodeship=Mazowieckie&limit=100
GET /api/locations/{id}
GET /api/locations/map  -> GeoJSON

GET /api/stats/summary
GET /api/stats/voivodeship
GET /api/stats/top-cities?limit=30
GET /api/stats/top-streets?limit=20
GET /api/trends/growth

GET /api/history/location/{location_id}
GET /api/changes/monthly?year=2026&voivodeship=...
GET /api/changes/voivodeship?month=2026-06
GET /api/changes/timeline?limit_months=12
```

**Frontend router** (`backend/api/frontend_router.py`) — additional endpoints consumed
exclusively by `frontend/index.html`, 1-hour cache, registered before the aggregates
router so it takes precedence on overlapping paths:

```
GET /api/geo/voivodeships              -> GeoJSON for choropleth maps
GET /api/geo/powiats                   -> GeoJSON powiat boundaries (24h cache)

# network history / growth (SIEC tab)
GET /api/stats/network-growth          -> [{year, new_stores, cumulative}]
GET /api/stats/network-origin          -> {oldest, newest, new_this_month}
GET /api/stats/stores-timeline         -> {stores[[lat,lon,year]], undated, year_range, milestones}
GET /api/stats/openings-monthly        -> [{year, month, cnt}]  (calendar grid)
GET /api/stats/opening-hours           -> [{pattern, cnt}]  (top patterns)
GET /api/stats/opening-seasonality     -> [{month, label, cnt}]
GET /api/stats/growth-by-voivodeship   -> [{voivodeship, yr, new_stores}]
GET /api/stats/city-first-opening      -> [{yr, new_cities, cumulative_cities}]
GET /api/stats/top-cities?limit=N      -> [{city, cnt, voivodeship}]

# ranking by administrative level (GRAN/NBL/coverage switchers)
GET /api/stats/by-dimension?dim=&metric=&sort=&limit=&offset=
                                       -> {rows, total, dim, metric, sort, avg, median, sum}
                                          dim: voivodeship|powiat|city|gmina; metric: count|per1k|per_km2
GET /api/stats/neighbor-by-level?level=&metric=&sort=&limit=
                                       -> {rows[{name,voivodeship,n,median_m,avg_m}], total, level, metric}
                                          level: voivodeship|powiat|city
GET /api/stats/inpost-vs-zabka-by-level?level=&sort=&limit=&offset=
                                       -> {rows, total, level}  (level: voivodeship|powiat|city|gmina)
GET /api/stats/coverage-funnel         -> [{level, with, total, pct}]  (powiaty/miasta/gminy)
GET /api/stats/powiat-coverage         -> {total, covered, dots[[lat,lon]]}  (24h cache)
GET /api/stats/city-coverage           -> {total_cities, with_zabka, without_zabka, pct, zabka_localities}
GET /api/stats/common-streets?limit=N  -> {streets[{name, cnt}], distinct}
GET /api/stats/gmina-leaders?limit=N   -> {per_1k[], per_km2[], national_per_1k}

# Poland-through-a-frog (ZABKA A POLSKA tab)
GET /api/stats/per-capita              -> [{voivodeship, stores, population, per_1k}]
GET /api/stats/powiat-economics        -> [{powiat, voivodeship, avg_salary, unemployment_rate, population, stores, per_1k}]
GET /api/stats/sunday-by-voivodeship   -> [{voivodeship, closed_pct, closed_count, total}]
GET /api/stats/voivodeship             -> [{voivodeship, total, mc_count, mc_pct}]  (merrychef)
GET /api/stats/voivodeship-density     -> [{voivodeship, stores, area_km2}]
GET /api/stats/inpost-vs-zabka         -> [{voivodeship, zabki, paczkomaty, population, zabki_per_100k, lockers_per_100k, ratio}]

# extremes / Atlas krańców / amphibians (folded into SIEC tab)
GET /api/stats/kraniec-facts           -> {facts[{id,group,label,value,lat,lon,zoom,type}], backdrop[[lat,lon]]}
GET /api/stats/elevation               -> {extremes, histogram, percentiles}
GET /api/stats/neighbor-stats          -> {loner, distribution, zero_distance_count}
GET /api/stats/twins                   -> {within_50m, within_100m, within_200m, total, closest_pairs, same_address, points, points_50}
GET /api/stats/parks-stores            -> [[lat,lon]]
GET /api/stats/section3-rare           -> {h24_cities, h24_points, parks, void, frog_streets, frog_streets_count, west_wall_points, powiats_covered, powiat_range, civic_streets, physical_streets}
GET /api/stats/amphibians              -> {gbif_total, median_occurrences, most_froggy, zero_frog_count, farthest_from_frog, stores, scatter_sample, distribution, by_voivodeship, top10, gbif_obs}

GET /api/stats/sunday-closed-stores?voivodeship=X  -> drilldown, not cached
```

All `/api/stats/*` here are cached 1h (geo + powiat-coverage 24h). `frontend_router`
shadows the legacy `aggregates_router` versions of summary/voivodeship/top-cities/per-capita.

### Protected (token required)

```
POST /api/snapshot?token=YOUR_TOKEN
  -F "file=@snapshot.json"
  -F "source_date=2026-06-15" (optional)
```

## Database

DuckDB `data/zabka.duckdb` contains (full schema with types: chapter 3):

Facts:
- **snapshots** - snapshots with metadata (total, visible, towns, etc.)
- **locations** - stores (city, voivodeship, street, lat, lon, flags, enrichment)
- **histories** - store births and deaths (created/deleted per snapshot)
- **parcel_lockers** - InPost parcel lockers (second fact entity)

Dimensions: **dim_voivodeship**, **dim_powiat** (GUS economics), **dim_gmina**
(population + area_km2), **dim_gios_station**, **dim_park**; plus **fun_facts**.
Cities (`dim_miasto`) are a bundled JSON (`data/geo/miasta_pl.json`) read by the API,
not a DuckDB table.

Locations support soft delete via the `deleted_at` timestamp.

## Project structure

```
backend/                 - code + API (chapter 2)
  main.py                - FastAPI app + /api/snapshot
  database_ch.py         - DuckDB connection + schema (facts + dimensions)
  cache.py               - Redis cache (UNIX socket)
  daily_etl.py           - thin ETL entrypoint (re-exports run + CLI)
  etl/                   - ETL pipeline: geo.py, io.py, pipeline.py, sources/ (one class per source)
  api/                   - routers (locations, history, aggregates, admin, frontend_router)

frontend/                - Vite SPA, modular ES + Chart.js + Leaflet + D3 + ECharts (chapter 4)
  index.html             - DOM scaffold + <head> (SEO, fonts); loads /src/main.js
  methodology.html       - methodology page
  src/                   - main.js (tab router, lazy chunks), data.js (fetch buckets),
                           config.js (colors/plugins), filter.js, state.js, utils.js, style.css
  src/tabs/              - one module per tab: siec.js + spoleczenstwo.js (lazy-loaded),
                           plus econ.js, edge.js, kraniec.js, bubble.js (bundled into their parent)
  public/                - og.png, robots.txt, sitemap.xml (copied to dist/ by Vite)
  dist/                  - built bundle shipped to prod
  mock-data.js           - dev reference snapshot (700KB, shape matches API; not loaded in prod)

data/                    - data + data documentation (chapter 3)
  input/                 - snapshot JSON
  geo/                   - boundaries/cache (geojson, elevation, parcel lockers, amphibians)
  tools/                 - import_demo_data.py, demo_snapshot_generator.py
  zabka.duckdb           - DuckDB (created on first run)

__main__.py              - alternative backend launcher (root)
CLAUDE.md                - instructions for Claude Code + documentation (this file)
.claude/analysis/        - internal analytics artifacts (outside the repo)
```

## Troubleshooting

**"Module not found" errors**
- Make sure you are in the `backend/` directory before running `python main.py`

**Database locked**
- Make sure there is no other backend instance running
- Try deleting `data/zabka.duckdb` (you will lose history)

**Frontend does not load**
- Check the browser console (F12) for CORS errors
- Make sure the `frontend/` directory exists

**API token not working**
- Make sure the `API_TOKEN` env var is set
- Default token: `your-secret-token-change-me`

## Notes

- The project is a dark theme and deliberately does not support a light mode
- The map uses CartoDB dark tiles, so it needs internet
- Chart.js charts render on the client (no render server)
- Soft deletes preserve history, so deleted locations can be "restored"
- Database indexes are tuned for filtering by city/voivodeship/date

## License

Internal use only.


---

# 2. Backend

FastAPI + DuckDB. Serves the analytics API over the Żabka data plus live data
(weather, air quality). The data pipeline (ETL) is described in chapter 3.

## 1. Tech stack

- **FastAPI** (async Python) - API server + static frontend serving.
- **DuckDB** - embedded column store for analytics.
- **Redis** (UNIX socket) - cache for aggregate responses.
- **Live integrations:** Open-Meteo (weather), GIOS (air quality), OpenLightMap
  (light pollution). Geocoding/boundaries: offline point-in-polygon.

Dependencies: `requirements.txt` (root). Main modules: `main.py` (app + CORS +
health + snapshot upload), `database_ch.py` (connection + schema + column
migration), `cache.py` (Redis cache decorator), `live_data.py` (live
integrations), `api/` (routers), `etl/` (data pipeline, chapter 3).

## 2. Database choice: DuckDB

**Why:** fast columnar queries for reports, embedded (no server), good for a
read-heavy + append workload (daily snapshots).
**Trade-off:** not suited for transactional OLTP, but we only read and append.
**Schema migration:** `ADD COLUMN IF NOT EXISTS` without `DEFAULT` (a `DEFAULT`
clause in ALTER breaks DuckDB's WAL replay; the ETL sets the values explicitly
anyway). Table schema with types: chapter 3.

## 3. Cache: Redis over a UNIX socket

**Why:** sub-100 ms responses, no TCP overhead, local and safe.
**Where:** `/api/stats/*`, `/api/changes/*`, `/api/trends/*` (TTL 3600 s).
**Where NOT:** `/api/live/*` - always fresh, no cache.
The ETL clears the cache after loading data; the backend rebuilds it on the next
query. Config: `REDIS_SOCKET` (path to the UNIX socket). On the production VPS
this is `/run/redis/redis-server.sock` (Debian `redis-server`, the `zabka` user is
in the `redis` group; the systemd unit passes `REDIS_SOCKET` and waits on
`redis-server.service`). Redis is optional: if the socket is missing (for example
a bare local checkout), `cache.py` logs it and the app runs without a cache.

## 4. API

**Protected (requires `token`):**
- `POST /api/snapshot` - upload a snapshot JSON.

**Aggregates / geography / history (1h cache):**
- `GET /api/stats/summary | /voivodeship | /top-cities | /top-streets | /by-powiat | /per-capita`
- `GET /api/trends/growth`, `GET /api/changes/monthly | /voivodeship | /timeline`
- `GET /api/locations | /locations/{id} | /locations/map`
- `GET /api/history/location/{id}`, `GET /api/fun/extremes`, `GET /api/context/{lat}/{lon}`

Interactive docs: `/docs` (Swagger), `/redoc`.

## 5. Quick start

```bash
cd /home/alice/zabka-dashboard
pip install -r requirements.txt
python -m backend.main          # http://localhost:8000  (front + /docs)
python -m backend.daily_etl     # load/refresh data (chapter 3)
```

Environment variables: `ZABKA_DB` (DuckDB path), `REDIS_SOCKET`, `API_TOKEN`
(snapshot upload token). Production deployment - see the team runbook.


---

# 3. Data: ETL, core, enrichment, schema

Covers the ETL process, the data core (the main fetched JSON), the full list of
enrichment sources (source, refresh frequency, API method), and the database
schema with data types. Pipeline code: `backend/etl/` (geometry in `geo.py`, I/O
in `io.py`, one enrichment class per source in `sources/`, orchestration in
`pipeline.py`).

### 0. Data model (galaxy schema)

Two fact tables (`locations` = Żabki, `parcel_lockers` = InPost parcel lockers)
share common geographic dimensions (`dim_gmina`, `dim_powiat`, `dim_voivodeship`).
This is a galaxy / fact-constellation schema. The geography is lightly snowflaked
(`dim_gmina` -> `dim_powiat` -> `dim_voivodeship`). That way "who dominates the
public space" queries are a JOIN over the dimension instead of proximity columns
on the facts. GUS economics (salary, unemployment, population) live only in
`dim_powiat`.

`dim_gmina` is the lowest geographic level (`locations.gmina_id` -> `dim_gmina.id`):
gmina boundaries + `area_km2` come from GADM (`data/geo/gminy.geojson`), population
from GUS BDL (var 72305). It powers the gmina granularity of the Historia chart
(stores, per 1000 residents, per km²). Stores are assigned to a gmina by
point-in-polygon. `dim_miasto` (cities) is a separate reference set bundled in
`data/geo/miasta_pl.json` (GUS units kind 1+4 with population), used for the city
granularity and the "% of Polish cities with a Żabka" stat — it is read by the API,
not stored as a DuckDB table.

**Keys are numeric** - no string joins. A powiat name is not unique across
voivodeships (for example "powiat grodziski"), so facts join to dimensions via
`voivodeship_id` / `powiat_id` (surrogate keys), and `dim_powiat` points to its
voivodeship through `voivodeship_id`. Names stay on the facts as a display and
grouping attribute, but relationships go through ids.

GIOŚ air-quality stations and GDOŚ parks each get their own dimension
(`dim_gios_station`, `dim_park`), linked from `locations` by numeric id. The
nearest station's distance is kept on `locations` as `gios_distance_km`; the
station's identity and coordinates live in `dim_gios_station`.

```text
  FACTS                                      DIMENSIONS
  -----                                      ----------
  locations (Żabki)                          dim_powiat
    id (PK)                                    id (PK)
    snapshot_id      -> snapshots.id           name
    voivodeship_id   -> dim_voivodeship.id     voivodeship_id -> dim_voivodeship.id
    powiat_id        -> dim_powiat.id          population
    gios_station_id  -> dim_gios_station.id    avg_salary
    nature_park_id   -> dim_park.id            unemployment_rate
    city, street, lat, lon, flags, ...
    gios_distance_km, elevation_meters,      dim_voivodeship
    is_in_nature_park, neighbor dist,          id (PK)
    amphibian fields, ...                      name
                                               population
  parcel_lockers (parcel lockers)
    id (PK)                                  dim_gios_station
    voivodeship_id   -> dim_voivodeship.id     id (PK)
    powiat_id        -> dim_powiat.id          name
    operator, type, city, lat, lon, status     latitude, longitude

  snapshots (snapshots) 1 --< locations,     dim_park
                        1 --< histories         id (PK)
  histories (audit) location_id -> locations    name
  fun_facts (key, lat, lon, value)             type
    - interesting facts, no relations
```

Example query (who dominates per voivodeship, per 1000 residents) - JOIN by id:

```sql
SELECT v.name,
       z.cnt AS zabki, p.cnt AS parcel_lockers, v.population,
       round(p.cnt*1000.0/v.population, 2) AS lockers_per_1k,
       round(p.cnt::DOUBLE/NULLIF(z.cnt,0), 2)  AS lockers_per_zabka
FROM dim_voivodeship v
LEFT JOIN (SELECT voivodeship_id, count(*) cnt FROM locations
           WHERE deleted_at IS NULL GROUP BY 1) z ON z.voivodeship_id = v.id
LEFT JOIN (SELECT voivodeship_id, count(*) cnt FROM parcel_lockers GROUP BY 1) p
       ON p.voivodeship_id = v.id
ORDER BY lockers_per_1k DESC;
```

### 1. ETL process

The flow (`python -m backend.daily_etl`, orchestrated in
`backend/etl/pipeline.py`):

1. **Fetch** - download the raw JSON of stores from the Żabka source (or
   `--fallback <file>`).
2. **Tabularize** - flatten to rows: dedup by `storeId`, drop PII and junk
   fields, clean streets (remove `<br>` and any embedded postcode from the display string), normalize city
   names, derive flags (h24, Sunday, merrychef).
3. **Enrich Żabki** - each source enriches the stores independently (best-effort:
   a missing source does not abort the ETL, the column just stays empty). Order:
   regions, gios, neighbor, amphibians, parks, elevation, light pollution. Details in
   section 4. (Light pollution / Bortle is a neighbor-distance proxy, not a measurement.)
4. **Parcel lockers** - InPost parcel lockers loaded as a separate entity
   (voivodeship/powiat geocoding by the same point-in-polygon as the stores).
5. **Build dimensions** - assemble the dimensions with numeric keys, then attach
   GUS economics into `dim_powiat`.
6. **Interesting facts** - compute the facts written to `fun_facts`: the point in
   Poland farthest from any Żabka, the loner (most isolated Żabka), and the most
   froggy Żabka.
7. **Load** - write the snapshot + locations + parcel lockers + dimensions +
   fun_facts to DuckDB (column migration `ADD COLUMN IF NOT EXISTS`). Loading the
   stores also diffs against the previous snapshot to record births/deaths in
   `histories` and stamp `deleted_at` on closed stores.
8. **Retention** - rolling 6-month window: snapshots older than 6 months (and their
   locations, parcel lockers, histories) are dropped. Daily this means head in,
   tail out.
9. **Cache** - clear Redis; the backend rebuilds on the next query.

The database keeps the last 6 months of daily snapshots. Birth/death trends come
from `histories` (created/deleted per month); totals and regional trends from the
per-snapshot `locations` and `parcel_lockers`. Soft delete (`deleted_at`) marks the
date a store was last seen; queries filter `deleted_at IS NULL` by default.

CLI flags: `--no-geocode`, `--limit N`, `--skip-gios`, `--skip-parks`,
`--skip-gus`, `--skip-amphibians`, `--skip-paczkomaty`, `--elevation` (opt-in,
13k+ requests), `--fallback <file>`.

### 2. Data core - the source Żabka JSON

Source: `https://www.zabka.pl/app/uploads/locator-store-data.json` (public store
locator, ~13.2k stores). From each record we take the fields useful for analysis;
we drop PII (director data), constants (`name`, `country`, `active`), internal
ids, and marketing URLs. The full list of dropped fields and the cleaning rules
are in section 3.

---

## Żabka data model - schema summary

Where each column comes from after a daily ETL run (`backend/daily_etl.py`).
Raw source: `https://www.zabka.pl/app/uploads/locator-store-data.json`
(~13.2k stores). Administrative boundaries: ppatrzyk/polska-geojson.
Air-quality stations: GIOŚ API v1.

Geographic enrichment adds several sources: GDOŚ parks/buffers, GUS BDL powiat
economics, GUGiK NMT terrain elevation, GBIF amphibian observations, InPost parcel
lockers, and a local neighborhood analysis. Network steps are best-effort - when a
source is missing, the column stays NULL/FALSE and the ETL moves on.

Origin legend:
- SOURCE - value taken straight from a field in the Żabka JSON
- DERIVED - computed from another source field
- GEO - assigned by point-in-polygon against GeoJSON boundaries
- GIOŚ - from the air-quality API
- PARKS - point-in-polygon against GDOŚ park/buffer boundaries
- ECONOMY - GUS BDL, attached to the powiat dimension
- ELEVATION - GUGiK NMT numeric terrain model
- SPATIAL - computed locally in the pipeline (no network)
- AMPHIBIANS - amphibian (Amphibia) observations from GBIF
- ETL - generated by the pipeline (keys, timestamps)

### Table `locations` (one row = one store in a given snapshot)

| Column | Type | Origin | Source field / rule |
|---|---|---|---|
| id | INTEGER | ETL | primary key |
| snapshot_id | INTEGER | ETL | FK to `snapshots.id` |
| store_id | VARCHAR | SOURCE | `storeId` |
| city | VARCHAR | DERIVED | `town`, case-normalized (LEGNICA -> Legnica) |
| street | VARCHAR | DERIVED | `street` with `<br>` and any embedded postcode removed from display; empty -> "nieokreślona" |
| voivodeship | VARCHAR | GEO | voivodeship name (point-in-polygon, 16); display attribute |
| powiat | VARCHAR | GEO | powiat name (point-in-polygon, 380); display attribute |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` (joins are by numeric key) |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` |
| latitude | DOUBLE | SOURCE | `lat` |
| longitude | DOUBLE | SOURCE | `lon` |
| has_merrychef | BOOLEAN | SOURCE | `locatorMerrychef` (oven for hot meals) |
| open_sunday | BOOLEAN | DERIVED | `openingHours.sun` exists and is non-empty |
| h24 | BOOLEAN | DERIVED | `openingHours.mon-sat` == "00:00:00 - 00:00:00" |
| opening_hours_monsat | VARCHAR | SOURCE | `openingHours["mon-sat"]` |
| opening_hours_sun | VARCHAR | SOURCE | `openingHours["sun"]` |
| first_opening_date | DATE | SOURCE | `firstOpeningDate` (NULL when the source has no date) |
| is_visible | BOOLEAN | SOURCE | `isVisible` |
| is_new_month | BOOLEAN | SOURCE | `locatorNewMonth` (opened in the last month) |
| is_new_two_weeks | BOOLEAN | SOURCE | `locatorNewTwoWeeks` |
| gios_station_id | INTEGER | GIOŚ | FK -> `dim_gios_station.id` (nearest air-quality station) |
| gios_distance_km | DOUBLE | GIOŚ | distance to that station (haversine, km) |
| elevation_meters | DOUBLE | ELEVATION | elevation above sea level from GUGiK NMT (`GetHByXY`, PL-1992/EPSG:2180 coordinates); NULL when the service did not answer |
| light_pollution_brightness | DOUBLE | derived | sky brightness proxy; NOT a measurement - derived from neighbor distance as a fallback, so do not present it as observed light pollution |
| bortle_scale | INTEGER | derived | Bortle class (1-9) from the same proxy; same caveat |
| is_in_nature_park | BOOLEAN | PARKS | TRUE when the point falls inside a GDOŚ park or buffer (point-in-polygon) |
| nature_park_id | INTEGER | PARKS | FK -> `dim_park.id` (the park the store is in, when any) |
| nearest_neighbor_distance_meters | INTEGER | SPATIAL | distance to the nearest other Żabka (BallTree k=2, haversine, meters) |
| amphibian_occurrences_5km | INTEGER | AMPHIBIANS | count of amphibian observations (GBIF, Amphibia) within 5 km of the store, a thematic nod to the network's name |
| nearest_amphibian_km | DOUBLE | AMPHIBIANS | distance to the nearest amphibian observation (GBIF, km) |
| gmina_id | INTEGER | GEO | FK -> `dim_gmina.id` (point-in-polygon against GADM gmina boundaries) |
| created_at | TIMESTAMP | ETL | time the row was written |
| deleted_at | TIMESTAMP | ETL | soft-delete for snapshot-to-snapshot comparisons (NULL = active) |

Note on air quality: `locations` stores only the nearest-station link
(`gios_station_id` + `gios_distance_km`), not the actual air-quality readings. Air
quality is live, time-varying data served on demand via `/api/live`. Baking a
measurement into a daily snapshot would be stale by design, so the snapshot keeps
the stable geographic link and the live endpoint fetches fresh readings.

### Table `snapshots` (one row = one daily fetch)

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER | ETL | primary key |
| source_date | DATE | ETL | fetch date (defaults to today) |
| total_count | INTEGER | ETL | store count after dedup |
| visible_count | INTEGER | ETL | count with `is_visible = true` |
| with_merrychef | INTEGER | ETL | sum of `has_merrychef` |
| open_sunday | INTEGER | ETL | sum of `open_sunday` |
| h24 | INTEGER | ETL | sum of `h24` |
| towns | INTEGER | ETL | distinct `city` count |
| created_at | TIMESTAMP | ETL | snapshot creation time |

### Table `histories` (store births and deaths)

Change log driven by diffing `store_id` sets between consecutive snapshots: on each
run, store_ids present today but not in the previous snapshot are recorded as
`created` (a store opened), store_ids gone from the previous snapshot as `deleted`
(a store closed). `source_date` and `store_id` are denormalized so birth/death
trends (created/deleted per month) need no joins. No foreign keys here: retention
deletes old snapshots and their locations, and an enforced FK would block that.
The first snapshot writes no history (it is the baseline, not a change).

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | primary key |
| location_id | INTEGER | ETL | the store's row id (in the new snapshot for `created`, the previous one for `deleted`) |
| snapshot_id | INTEGER | ETL | snapshot where the change was detected |
| source_date | DATE | ETL | date of that snapshot (denormalized for grouping) |
| store_id | VARCHAR | ETL | which store opened/closed |
| change_type | VARCHAR | ETL | `created` (born) / `deleted` (died) |
| field_changed / old_value / new_value | VARCHAR | ETL | reserved for future `updated` events (attribute changes) |
| recorded_at | TIMESTAMP | ETL | when the change was recorded |

`deleted_at` on `locations`: when a store disappears, its row in the previous
snapshot is stamped with `deleted_at` (its death date).

### Table `parcel_lockers` (InPost parcel lockers - separate fact entity)

A second fact table parallel to `locations`. Enriched geographically only
(voivodeship/powiat by the same point-in-polygon as the stores; city from the
InPost address). Snapshotted per day like `locations` (tagged with `snapshot_id`),
so locker counts also have month-to-month trends, and the same 6-month retention
applies. Source: InPost ShipX API. Joins to dimensions by numeric key
(`voivodeship_id`, `powiat_id`).

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | primary key |
| snapshot_id | INTEGER | ETL | FK -> `snapshots.id` (same daily snapshot as the stores) |
| source_date | DATE | ETL | dump date |
| operator | VARCHAR | SOURCE | network (`InPost`) |
| external_id | VARCHAR | SOURCE | point code (`name` from ShipX) |
| type | VARCHAR | SOURCE | `parcel_locker` / `pop` |
| city | VARCHAR | SOURCE | city from the InPost address |
| voivodeship | VARCHAR | GEO | name (display attribute) |
| powiat | VARCHAR | GEO | name (display attribute) |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` (point-in-polygon) |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` (point-in-polygon) |
| latitude | DOUBLE | SOURCE | `location.latitude` |
| longitude | DOUBLE | SOURCE | `location.longitude` |
| status | VARCHAR | SOURCE | point status (for example Operating) |
| created_at | TIMESTAMP | ETL | time the row was written |

### Table `dim_powiat` (dimension - the only home of GUS economics)

GUS economics normalized out of the facts into a dimension. Numeric key `id`;
facts join through `powiat_id` (a powiat name is not unique across voivodeships,
so a string join would be wrong). The voivodeship is referenced via
`voivodeship_id`.

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | powiat name (same as on the facts) |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` |
| population | INTEGER | ECONOMY | population; GUS BDL variable 72305 (as of 31 Dec) |
| avg_salary | DOUBLE | ECONOMY | average gross salary; GUS BDL 64428 (zł) |
| unemployment_rate | DOUBLE | ECONOMY | registered unemployment rate; GUS BDL 60270 (%) |

### Table `dim_voivodeship` (dimension)

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | voivodeship name (same as on the facts) |
| population | INTEGER | ECONOMY | sum of powiat populations in the voivodeship (from `dim_powiat`) |

### Table `dim_gmina` (dimension - lowest geographic level)

The lowest geographic level (`locations.gmina_id` -> `dim_gmina.id`). Boundaries +
`area_km2` from GADM (`data/geo/gminy.geojson`), population from GUS BDL (var 72305).
Powers the gmina granularity of the ranking switchers (stores, per 1000 residents,
per km²). Note: the live DB carries ~1,501 gminas; `population` is not yet filled for
every row (it relies on a separate GUS gmina pull), `area_km2` is complete.

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | gmina name |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` |
| population | INTEGER | ECONOMY | gmina population (GUS BDL); may be NULL where unmatched |
| area_km2 | DOUBLE | GEO | gmina area from GADM polygons |

### Table `dim_gios_station` (dimension - nearest air-quality stations)

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | GIOŚ | station id from the GIOŚ API |
| name | VARCHAR | GIOŚ | station name |
| latitude | DOUBLE | GIOŚ | station latitude |
| longitude | DOUBLE | GIOŚ | station longitude |

### Table `dim_park` (dimension - GDOŚ parks/buffers)

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | PARKS | park / protection-form name |
| type | VARCHAR | PARKS | park type (national / landscape) |

### Table `fun_facts` (helper computations)

| Key | Origin | Description |
|---|---|---|
| farthest_from_zabka | ETL | the point inside Poland's borders farthest from any Żabka (Bieszczady, ~49.01/22.89, ~46.5 km). Computed by the largest-empty-circle method: a grid of candidates within the country, for each the distance to the nearest store (BallTree, haversine), pick the maximum, then refine. |
| most_isolated_zabka | SPATIAL | the "loner" - the Żabka with the largest distance to its nearest neighbor (~27.3 km). Same BallTree as `nearest_neighbor_distance_meters`, take the maximum. |
| most_froggy_zabka | AMPHIBIANS | the "most froggy Żabka" - the store with the most amphibian observations within 5 km (the `value` field holds that count). |

Schema: `key` PK, `lat`, `lon`, `value`, `computed_at`.

### External enrichment - sources and method

Materialized in the ETL so that global filters (cross-filtering) on the frontend
work without expensive runtime calculations.

| Source | What it adds | Access | Frequency | Config |
|---|---|---|---|---|
| Regions (ppatrzyk/polska-geojson) | `voivodeship_id`, `powiat_id` + names | static GeoJSON, offline point-in-polygon | rarely | bundled boundary files |
| GIOŚ | `dim_gios_station` (id, name, lat, lon); `gios_station_id`, `gios_distance_km` on `locations` | REST API (air quality) | each ETL | `--skip-gios` |
| GDOŚ | `dim_park` (name, type); `is_in_nature_park`, `nature_park_id` on `locations` | static GeoJSON, local file | rarely (yearly) | `data/input/parki_gdos.geojson` or `PARKS_GEOJSON_URL` |
| GUS BDL | `dim_powiat` (population, avg_salary, unemployment_rate) + `dim_voivodeship.population` | REST API JSON, powiat level (unit-level=5) | yearly | `GUS_BDL_KEY` (10->100 req/min); variables `GUS_SALARY_VAR`=64428, `GUS_UNEMPLOY_VAR`=60270, `GUS_POPULATION_VAR`=72305 |
| InPost (ShipX) | `parcel_lockers` entity (lockers, voivodeship/powiat geo) | public REST API (no token), paginated | rarely (network grows slowly) | cache `data/geo/paczkomaty_pl.json`; `--skip-paczkomaty`, `INPOST_TYPE`=parcel_locker |
| GUGiK NMT | `elevation_meters` | REST per point (`GetHByXY`, PL-1992) | daily (only new coordinates) | opt-in `--elevation`; cache `data/geo/elevation_cache.json` (successes only) |
| GBIF | `amphibian_occurrences_5km`, `nearest_amphibian_km`, `most_froggy_zabka` | REST API (occurrence/search), class Amphibia | rarely (observations grow slowly) | cache `data/geo/amphibians_pl.json`; `--skip-amphibians`, `GBIF_AMPHIBIA_TAXON`=131, `AMPHIBIAN_RADIUS_KM`=5 |
| Local (DuckDB/BallTree) | `nearest_neighbor_distance_meters`, `most_isolated_zabka` | no network | every ETL | - |

Decision: point-in-polygon + BallTree (haversine) instead of the DuckDB spatial
extension - metric distances come straight out of haversine, and the
voivodeship/powiat boundaries already use this method offline. Full rationale in
section 7.

### Data quality

#### Cleaning and normalization

- Dedup by `storeId` (the source has ~32 duplicates: the same store once clean,
  once with a hash prefix and `<br>` in the street) - keep the cleaner record.
- Streets: remove `<br>` and any embedded NN-NNN postcode from the display string (~57 cases); the postcode is not stored.
- Cities: case normalization merges duplicates like LEGNICA/Legnica (2203 -> ~2201).
- Economy attached to the powiat dimension: powiat-name normalization strips the
  `powiat`/`m.`/`st.` prefix and the GUS temporal suffix (`Powiat m. Wałbrzych od
  2013` -> `wałbrzych`); on a name collision the newer year wins. Renames are
  mapped by alias (`jeleniogórski` -> `karkonoski`, 2021). After this all 370
  powiats that contain stores match to GUS.

#### Known issues and caveats

- ~218 stores have no `firstOpeningDate` in the source, so `first_opening_date`
  stays NULL for them.
- ~3 border points sit just outside the simplified boundary and fall back to the
  nearest region.
- GUS powiat-name reconciliation depends on the normalization above; new GUS
  renames may need a fresh alias.

---

## Geographic data enrichment specification: terrain elevation, parks, economics, and logistics

This section sets out the technical requirements, integration methods,
limitations, and analytical mechanics for the enrichment directions of the Żabka
database. All processes run on the backend in the ETL cycle, which keeps
performance high and makes the frontend's global filters (cross-filtering)
respond instantly.

---

### 1. Economic and regional data (GUS BDL)

* **Source:** Główny Urząd Statystyczny (GUS) - Bank Danych Lokalnych (BDL).
* **Access type:** REST API (JSON) for pulling statistical variables at given
  territorial-division levels.
* **Rate limit / key:** Free. Requires an API key (X-ClientId) in the HTTP
  header. Anonymous requests are capped at 10 calls per minute; sending the token
  raises the limit to 100 calls per minute and 10,000 per day.
* **Refresh frequency:** BACKEND (yearly, after GUS publishes the final
  statistical yearbooks).
* **Method:**
  1. Query the GUS endpoint for the variables: average gross salary (64428),
     unemployment rate (60270), and total population (72305, as of 31 Dec - the
     annual series, not the 33036 census from 2002), with `unit-level=5` (powiat
     level). Population is the base for the "stores per 1000 residents" metric.
  2. Request URL: `https://bdl.stat.gov.pl/api/v1/data/by-variable/{variable_id}?unit-level=5&format=json&page-size=1000`
  3. A Python script normalizes the powiat names from the JSON (stripping
     prefixes like "powiat ").
  4. Materialize the data into `dim_powiat` and join the facts to it by numeric
     `powiat_id`.
* **Required input:** the `powiat` column (obtained earlier from point-in-polygon
  geocoding).

---

### 2. Numeric terrain model (GUGiK Geoportal)

* **Source:** Główny Urząd Geodezji i Kartografii (GUGiK).
* **Access type:** REST web service (national integration of the numeric terrain
  model) that takes a point's coordinates.
* **Rate limit / key:** Fully free, open (public access), no auth keys, no
  declared performance limits.
* **Refresh frequency:** BACKEND (daily ETL, only for new rows).
* **Method:**
  1. Use `backend/daily_etl.py` to identify unique, newly added store records.
  2. Make an async HTTP GET for each new point.
  3. Request URL: `https://services.gugik.gov.pl/nmt/?request=GetHByXY&x={x}&y={y}`
     (flat XY in PL-1992).
  4. The API returns raw text with the numeric elevation. The result is parsed to
     float and written to `elevation_meters`.
* **Required input:** accurate `latitude` and `longitude` from `locations`.

---

### 3. National and landscape park boundaries with buffers (GDOŚ)

* **Source:** Generalna Dyrekcja Ochrony Środowiska (GDOŚ).
* **Access type:** Static spatial dataset (Shapefile / GeoJSON) with current
  boundaries of nature-protection forms in Poland.
* **Rate limit / key:** Fully free, no API keys, no request limits (you download
  the whole vector repository).
* **Refresh frequency:** BACKEND (one-off / rare, about once a year).
* **Method:**
  1. Download the vector file directly from the GDOŚ spatial-data servers and save
     it locally as `data/input/parki_gdos.geojson`.
  2. Load the polygon geometries.
  3. Run a point-in-polygon test to check whether a store's coordinates fall
     inside a park or its official buffer.
  4. Set `is_in_nature_park = TRUE` and link the park via `nature_park_id` into
     `dim_park`.
* **Required input:** `latitude`, `longitude`.

---

### 4. Internal spatial analysis (DuckDB / BallTree)

* **Source:** No external network dependencies. The computations run entirely on
  local data structures.
* **Rate limit / key:** Not applicable (local process, no risk of an IP block or
  hitting external limits).
* **Refresh frequency:** BACKEND (during every daily ETL cycle after the current
  snapshot is loaded).
* **Method:**
  1. Nearest neighbor: a BallTree (k=2, haversine) over all active stores yields
     `nearest_neighbor_distance_meters` for each point.
  2. Isolation (the loner): sort the nearest-neighbor distances; the record with
     the largest minimum distance is tagged as the most isolated and written to
     `fun_facts`.
* **Required input:** `id`, `latitude`, `longitude`, and the soft-delete flag
  (`deleted_at IS NULL`).

---

### 5. Cache invalidation (Redis)

After a successful pipeline run, the pipeline clears Redis over the local UNIX
socket (`reload_cache()` uses the same `cache.py` connection as the backend,
driven by the `REDIS_SOCKET` env var):

```python
import os, redis
r = redis.Redis(unix_socket_path=os.getenv("REDIS_SOCKET", "/run/redis/redis-server.sock"))
r.flushdb()
```

This way the freshly recomputed extremes reach the FastAPI endpoints immediately
and render correctly in the Chart.js + Leaflet frontend. If Redis is unreachable
the step is a no-op (best-effort, like the rest of the pipeline).

---

### 6. Implementation status

All enrichment directions are implemented in `backend/daily_etl.py`, and the
database schema carries the fact and dimension tables described above
(`backend/database_ch.py`, with `ALTER TABLE ADD COLUMN IF NOT EXISTS` migration
for existing databases).

**Technical decision: point-in-polygon + BallTree (haversine), no DuckDB spatial
extension.** Voivodeship and powiat boundaries already compute offline this way,
so parks reuse the existing pattern instead of introducing a second mechanism.
Metric distances (meters to the nearest neighbor) come straight out of haversine;
the spatial equivalent (`ST_DWithin`) works in degrees and would need
`ST_Transform` to EPSG:2180. BallTree is already a dependency used by GIOŚ and the
farthest-point computation.

| # | Section | Implementation | Columns / tables |
|---|--------|-----------|---------|
| 1 | GUS BDL economics | `enrich_economy` - materialized into `dim_powiat`, joined by numeric `powiat_id` (variables 64428, 60270, 72305; rename aliases + temporal suffixes) | `dim_powiat`, `dim_voivodeship.population` |
| 2 | GUGiK NMT elevation | `enrich_elevation` - per point, local cache, only new coordinates (opt-in `--elevation`) | `elevation_meters` |
| 3 | GDOŚ parks/buffers | `enrich_nature_parks` - point-in-polygon | `is_in_nature_park`, `nature_park_id`, `dim_park` |
| 4 | GIOŚ stations | `enrich_gios` - nearest station, BallTree | `gios_station_id`, `gios_distance_km`, `dim_gios_station` |
| 5 | Spatial analysis | `enrich_nearest_neighbor` - BallTree k=2; loner into `fun_facts` | `nearest_neighbor_distance_meters` |
| 6 | GBIF amphibians | `enrich_amphibians` - BallTree over observations | `amphibian_occurrences_5km`, `nearest_amphibian_km`, `most_froggy_zabka` |
| 7 | InPost parcel lockers | `enrich_paczkomaty` - separate fact entity | `parcel_lockers` |

Correction relative to the original spec: the GUGiK NMT service only accepts flat
XY coordinates in PL-1992 (EPSG:2180) via `request=GetHByXY` - the `GetH` variant
with lon/lat returns an empty response. The ETL transforms WGS84 -> PL-1992 with
its own function (transverse Mercator, no pyproj dependency); verified directly
against the service: Kraków 212.8 m, Gdańsk 7.8 m, Zakopane 821.3 m.

Network steps are best-effort: a missing source does not abort the ETL, the
column just stays empty. Static data (parks) is fetched once into `data/input/`;
paths and URLs are overridable via env vars (`PARKS_GEOJSON_URL`/`_FILE`). The
`GUS_BDL_KEY` key raises the BDL limit from 10 to 100 requests per minute. Cache
invalidation (section 5) already runs through `reload_cache()` in the pipeline.

#### Acquired data sources
- **Parks (GDOŚ):** fetched from the WFS `https://sdi.gdos.gov.pl/wfs` (layers
  `ParkiNarodowe` + `ParkiKrajobrazowe`, `srsName=CRS:84`), merged into
  `data/input/parki_gdos.geojson` (259 features: 46 national with buffers + 213
  landscape).
- **Amphibians (GBIF):** `occurrence/search` for class Amphibia
  (`taxonKey=131`), country PL, records with coordinates only (~46k), cached in
  `data/geo/amphibians_pl.json` (paginated by 300).
- **Parcel lockers (InPost ShipX):** public API, paginated, ~31.8k parcel-locker
  points cached in `data/geo/paczkomaty_pl.json`.

### What was dropped from the source (not useful for analysis)

- PII: `salesZoneDirector`, `salesZoneDirectorEmail`, `salesZoneDirectorId`
  (directors' personal data)
- Constants: `active` (always "true"), `name` (always "Żabka"), `country`
  (always "Polska")
- Empty constant: `isAgency` (null in every record)
- Internal ids: `locationId`, `townId`, `salesZoneId`
- Marketing URLs: `storeUrl`, `relativeStoreUrl`

### Thematic extension: amphibian population (GBIF)

On top of the geographic enrichment we added amphibian data, a thematic nod to the
network's name (Żabka = little frog). Source: GBIF (Global Biodiversity
Information Facility), `occurrence/search` for class Amphibia (`taxonKey=131`),
country PL, records with coordinates only (~46k). Points are cached in
`data/geo/amphibians_pl.json` (paginated by 300).

Method: a BallTree (haversine) over the observations; per store the count within
the radius (`amphibian_occurrences_5km`) and the distance to the nearest one
(`nearest_amphibian_km`). The `most_froggy_zabka` fun fact is the store with the
most amphibians nearby. The step can be skipped with `--skip-amphibians`.


---

# 4. Frontend

Single-page dashboard, dark theme, served by FastAPI. A Vite build: `index.html` is just
the DOM scaffold + `<head>`; all logic lives in modular ES under `frontend/src/`, entry
`src/main.js`. Rendered via Chart.js + Leaflet + ECharts + D3 + Canvas 2D, pulling from
`/api/*`. Full component register: `.claude/analysis/DASHBOARD_SPEC.md`.

**Two tabs** (not the old four): `siec` ("SIEĆ", the network's anatomy + extremes) and
`spoleczenstwo` ("ŻABKA A POLSKA", the default tab on load, correlations with Polish
economics). The old EDGE CASE'Y and PŁAZY tabs were folded in: the extremes atlas, parks,
twins and amphibian facts now live inside SIEĆ; the econ scatters live inside ŻABKA A
POLSKA. There is no longer a global header KPI strip — the hero count-up carries the
headline total (`renderKPI` is a guarded no-op kept for the cross-filter callback).

**SEO.** Both HTML pages (`index.html`, `methodology.html`) carry a full `<head>` stack:
unique `<title>` and `<meta name="description">`, `<link rel="canonical">`, Open Graph
(`og:title`, `og:description`, `og:image`, `og:type`), Twitter Card (`summary_large_image`),
and JSON-LD structured data (`WebSite` + `Dataset` schema — original data is a real
candidate for Google rich results). The OG image (`/og.png`, 1200x630, dark theme) lives
in `frontend/public/` and is copied to `dist/` by Vite. `robots.txt` and `sitemap.xml`
also live in `frontend/public/` (Vite copies both to dist root).

**Data loading** (`src/data.js`): split into a core bucket and per-tab buckets, all via
`Promise.allSettled` so a failed endpoint can't white-screen the page. `loadCore()` fires
the ~15 endpoints the default tab (ŻABKA A POLSKA) + shared header need; `loadTabData('siec')`
fires the SIEĆ bucket (~16 endpoints) on first open and caches. Each settled result is
mapped into `M`, the global data object (`src/state.js`) consumed by all render functions;
failures fall back to empty arrays/objects. The level/metric switchers (GRAN, NBL, the
InPost dumbbell) lazy-fetch their `/api/stats/by-dimension`, `/neighbor-by-level`,
`/inpost-vs-zabka-by-level` variants on demand and cache per (level, metric, sort).

**Module loading:** `main.js` lazy-imports only `siec.js` and `spoleczenstwo.js` as
separate Rollup chunks (`TAB_LOADERS`). `econ.js` is bundled into the spoleczenstwo chunk;
`bubble.js`, `kraniec.js`, `edge.js` into the siec chunk. The default tab renders on load;
the other renders on first click and is marked in `RENDERED` so it never double-renders.

`frontend/mock-data.js` (700KB) is a dev reference — its shape is 1:1 with the API
responses but it is no longer loaded by the production frontend.

Note: `loadCore()` still fetches `sunday-by-voivodeship`, `voivodeship-density`, and
`voivodeship` (merrychef); those datasets are not currently rendered as cards (the Sunday
Wall / density / merrychef-gap visuals were retired from the visible layout) but stay in
`M` for the cross-filter and possible reuse.

---

## 1. Dashboard description

Two-tab data story about Poland's Żabka convenience store network (~13,154 active stores,
latest snapshot). The page is designed to reward exploration - it is not a reporting tool.

**Page layout:**
- Tab-bar navigation (two tabs), no global KPI header
- Tab SIEĆ: the network's anatomy + extremes — how Żabka grew over 28 years, how it ranks
  by administrative level (woj/powiat/miasto/gmina), the Atlas krańców of geographic
  extremes, powiat/city/gmina coverage, and the city bubble chart
- Tab ŻABKA A POLSKA (default): correlations with Polish economics (salary, unemployment),
  Żabka vs InPost, neighbor density by level, the busiest streets, per-capita gmina leaders

**Main message the user should grasp in 10 seconds:**
Nearly half of all Żabka stores opened since 2023 (47.5%). They are not evenly distributed.
Richer powiats have more. Higher unemployment means fewer. Somewhere in Bieszczady, you are
46.5 km from the nearest one. The network is named after a frog and we checked.

**Audience:** Data-literate, curious. Not a business dashboard — a data portrait.

**One-sentence hook:** The network looks uniform from a distance. The data says otherwise.

---

## 2. Visual story

The story is split across two tabs. ŻABKA A POLSKA is where the page lands; SIEĆ is the
deeper-dive companion.

**ŻABKA A POLSKA (landing):** The uniform network hides fault lines. A hero count-up
(the 46.5 km void) and a strip of national KPIs set the stage. Then Żabka vs InPost —
a voivodeship choropleth of the ratio plus a dumbbell that drills woj -> powiat -> miasto.
Then how densely the stores stand (median distance to the nearest Żabka by level, with a
kNN histogram). Then the busiest streets and the per-capita gmina leaders (resorts win).
The economic core: two ECharts chapters — wealthier powiats have more stores (r = +0.41),
higher unemployment means fewer (r = -0.35) — each with a scatter, quartile bars, and
animated stat tiles. It closes on "Co z tego wynika?": Żabka follows money and crowds.

**SIEĆ (anatomy + extremes):** Numbers first — a giant glowing count-up of all active
stores, then a stat strip of history facts (milestone cadence, best year, oldest store,
median neighbor, % of cities covered). A force-directed bubble of the biggest cities.
Then geography: a big dark vector map of Poland fills in dot by dot as the network grows
1998->2026, with a companion month-by-month calendar grid. The fingerprint (1.1f) unrolls
28 yearly rings to show which compass bearing each year favored. The growth chart (bars =
new stores/year, line = YoY change). The GRAN ranking switcher (woj/powiat/miasto by count,
per 1000, or per km²) with a voivodeship choropleth beside it. Then the extremes: a strip
of clickable KPI tiles feeds the Atlas krańców — one interactive map where hovering/clicking
a fact flies there (compass points, highest/lowest store, the loner, the Bieszczady void as
a red hollow circle, the frog street, the 32 h24 stores, parks, twins). Finally a coverage
donut + mini-map (powiaty / miasta / gminy).

**Theme:** "Żabka in the dark city." Near-black green-tinted canvas (`#0a120a`), Żabka
green (`#84c341`) as primary accent with a brighter lime (`#a6e84a`) for big numbers and
glows, teal (`#4dd0b1`) for ecological / amphibian data. CartoDB dark tiles on the Leaflet maps.

---

## 3. Components and charts

Full spec (SQL, pixel dimensions, annotations, interactions): `.claude/analysis/DASHBOARD_SPEC.md`.
This section is the navigable index — what each component shows and where its data comes from.

There is no global header KPI strip. Each tab carries its own hero + stat tiles.

### Tab SIEĆ (`siec.js`, render order)

Imports `bubble.js` (D3 force chart), `kraniec.js` (Atlas krańców), `edge.js` (edge KPI strip).

| Ref | Library | Endpoint | What it shows |
|---|---|---|---|
| Hero | Canvas 2D | `/stats/summary`, `/stats/network-origin` | Full-bleed opening: mono eyebrow (snapshot date), giant gradient-clipped glowing count-up of total active stores, drifting green particle field, headline + lede. Respects `prefers-reduced-motion`. |
| Stat strip | DOM | `/stats/network-growth`, `/network-origin`, `/neighbor-stats`, `/coverage-funnel` | Six fact tiles: first-1k cadence, last-5k cadence, best year, median neighbor distance, % of Polish cities with a Żabka, new in the last month. |
| Origin cards | DOM | `/stats/network-origin` | Oldest still-active store (Swarzędz, 1998) vs newest (updates each run). |
| BUBBLE | D3 (force) | `/stats/by-dimension?dim=city&metric=count&limit=60` | Force-directed bubbles, one per city, size = store count, drag + Ctrl-scroll zoom, "Pozostałe" bubble for the tail. |
| MAPA growth map + calendar | Leaflet + Canvas 2D | `/geo/voivodeships`, `/stats/stores-timeline`, `/stats/openings-monthly` | Large dark vector map of Poland (no tiles). Store dots on a canvas overlay animate in by opening year, a ~2.8s sweep 1998->2026 with year label + replay. A companion calendar grid shows month-by-month openings. |
| 1.1f fingerprint | Canvas 2D | `/stats/network-growth`, `/stats/stores-timeline` | The "odcisk" unrolled flat: X = compass direction (N-E-S-W-N), Y = year (1998->2026); each row bulges toward that year's dominant expansion bearing. Hover -> year + direction. |
| 1.1 growth chart | Chart.js | `/stats/network-growth` | One x-axis (years), two y-axes: bars = new stores/year, line = YoY change %. Era background bands. Footnote: covers only currently-active stores; early years underrepresented. |
| GRAN ranking | Chart.js (bar) + Leaflet (choropleth) | `/stats/by-dimension`, `/geo/voivodeships` | Left: horizontal ranking bar with three switchers — level (Woj./Powiaty/Miasta) x metric (Liczba / na 1000 mieszk. / na km²) x sort (Największe/Najmniejsze). Right: voivodeship choropleth (always voivodeship-level). Click a row sets the cross-filter. |
| Edge KPI strip | DOM | `/stats/section3-rare`, `/elevation`, `/neighbor-stats`, `/amphibians` | Six clickable tiles feeding the Atlas: 32 h24 stores (amber), stores in parks, frog record, the 46.5 km void, oldest active, farthest-from-frog. Click flies the Atlas map to that fact. |
| Atlas krańców | Leaflet + mini panels | `/stats/kraniec-facts`, `/elevation`, `/neighbor-stats`, `/parks-stores`, `/twins`, `/amphibians` | One interactive Poland map with a faint store backdrop. Compass points, highest/lowest store, the loner, the Bieszczady void (red hollow circle, no dots inside), the frog street, h24, parks, twins. Hover/click a fact -> `flyTo` + tooltip; leave -> national view. |
| POWIATY coverage | Chart.js (donut) + Canvas 2D | `/stats/powiat-coverage`, `/stats/coverage-funnel`, `/geo/voivodeships` | Animated donut: % of powiats / miasta / gminy with at least one Żabka (level toggle). Canvas mini-map: green = covered, red = uncovered. |

### Tab ŻABKA A POLSKA (`spoleczenstwo.js`, default tab, render order)

Imports `econ.js` (the two ECharts economic chapters).

| Ref | Library | Endpoint | What it shows |
|---|---|---|---|
| Hero | Canvas 2D | `/stats/section3-rare` | Count-up of the 46.5 km void distance, particle field, lede with live totals. |
| KPI strip | DOM | `/stats/summary`, `/per-capita`, `/voivodeship-density`, `/inpost-vs-zabka`, `/coverage-funnel` | Six national stats: one store per X residents, density /100 km², gmina coverage %, InPost-per-Żabka ratio, cities with Żabka, salary correlation. |
| 2.3 InPost | Leaflet (choropleth) + SVG/DOM (dumbbell) | `/stats/inpost-vs-zabka`, `/inpost-vs-zabka-by-level` | Left: voivodeship choropleth of the InPost/Żabka ratio. Right: dumbbell — green dot = Żabka/100k, amber dot = paczkomaty/100k, connecting line; level toggle Województwo / Powiat / Miasto re-queries `by-level`. National callout: 2.42 paczkomaty per Żabka. |
| NBL neighbor-by-level | Chart.js (bar) | `/stats/neighbor-by-level` | Median (or average) distance to the nearest Żabka per voivodeship/powiat/miasto. Three switchers: level x metric (Mediana/Średnia) x sort (Najgęstsze/Najrzadsze). |
| kNN histogram | Chart.js (bar) | `/stats/neighbor-stats` | 6-bucket distribution of nearest-neighbor distance. Median 299m / avg 942m / max ~27.8km reference lines. |
| STREETS | Chart.js (horizontal bar) | `/stats/common-streets?limit=15` | Busiest street names nationwide, dual-label y-axis (street name large, city small). Value labels at bar ends. |
| GMINA-LEAD | Chart.js (horizontal bar) | `/stats/gmina-leaders?limit=12` | Top gminy by stores per 1000 residents (default) or per km² (metric toggle). Resorts lead per capita. National reference line on the per-1k view. |
| ECON ch.1 salary | ECharts (scatter + bar) | `/stats/powiat-economics` | "Im wyższe zarobki, tym więcej Żabek." Scatter X = avg salary, Y = stores per 1k, point size = sqrt(population), trend r = +0.41; quartile-mean bars; animated stat tiles. |
| ECON ch.2 unemployment | ECharts (scatter + bar) | `/stats/powiat-economics` | "Gdzie brak pracy, tam brak Żabki." Scatter X = unemployment %, Y = per 1k, downward trend r = -0.35; quartile-mean bars; stat tiles. Shares the one economics request. |
| Conclusion | DOM | — | "Co z tego wynika?" narrative close: Żabka follows money and crowds, not ideology. |

---

## 4. Rendering libraries

- **Chart.js 4.4.1** — vertical/horizontal bars, line, scatter, donut, histograms. The
  1.1 growth chart, GRAN ranking, NBL, kNN histogram, STREETS, GMINA-LEAD, POWIATY donut.
- **ECharts** — the two economic chapters in `econ.js` (salary + unemployment scatters and
  quartile bars). Bundled into the spoleczenstwo chunk.
- **Leaflet 1.9.4** — SIEĆ growth map (vector voivodeship polygons, no tiles, canvas dot
  overlay), the GRAN voivodeship choropleth, the Atlas krańców extremes map, the InPost
  ratio choropleth (2.3). CartoDB dark tiles where tiles are used; `L.CircleMarker` for points.
- **D3.js** — bubble chart only (`bubble.js`): force simulation + zoom/drag, tree-shaken
  (`forceSimulation`, `forceX/Y`, `forceCollide`, `scaleSqrt`, `zoom`, `drag`). Never the DOM elsewhere.
- **Canvas 2D** — hero particles + count-up (both tabs), growth-map dot overlay + calendar
  grid, the unrolled fingerprint (1.1f), the POWIATY coverage mini-map, the Atlas mini-maps.
  Used wherever 13k+ DOM nodes would hurt.
- **Fonts:** one production set — Bricolage Grotesque (display) + IBM Plex Sans (body)
  + JetBrains Mono (mono), loaded from Google Fonts.

---

## 5. Visual language

**Color system:**

| Token | Hex | Use |
|---|---|---|
| Background | `#0a120a` | Page background, canvas background |
| Surface | `#0f1b0e` | Cards, chart containers |
| Green | `#84c341` | Primary Żabka accent, positive / active state |
| Green bright | `#a6e84a` | Big numbers, hero count-up, glows, hover highlight |
| Amber | `#f2a359` | Surprising facts, outliers, h24 stores |
| Red-orange | `#e8693d` | Anomalies (Sunday Wall, merrychef gap, void distance) |
| Teal | `#4dd0b1` | Ecological / amphibian data (frog density, coexistence) |
| North region (Polnoc) | `#4dd0b1` | pomorskie, warmińsko-mazurskie, kujawsko-pomorskie, podlaskie |
| West region (Zachod) | `#a6e84a` | dolnośląskie, zachodniopomorskie, lubuskie, opolskie |
| Center region (Centrum) | `#84c341` | mazowieckie, łódzkie, świętokrzyskie, wielkopolskie |
| South region (Poludnie) | `#f2a359` | śląskie, małopolskie, podkarpackie, lubelskie |
| Muted text | `#93a487` | Secondary labels, caveats, footnotes |
| Axis lines | `rgba(140,200,80,.14)` | Chart gridlines, tick marks |

Macro-region colors used consistently across the ranking and economic charts. Amphibian
visuals use sequential teal ramps (density) instead of the green accent.

**Typography:** three roles, one fixed production set (see above).
- Display: large KPI numbers, chart titles that state a finding
- Body: axis labels, card copy, caveats
- Mono: coordinates, raw numbers, code-like values

**Chart title rule:** every title states the finding, not the variable.
Right: "Połowa Żabek otwarta od 2023". Wrong: "Rozkład dat otwarcia".

**Grid:** 12-column CSS Grid, 16px gap. Desktop-first (>= 1280px). Tablet (768-1279px):
two-column pairs stack vertically, Section 3 cards go 2-column, maps shrink to ~380px.
Mobile (< 768px): graceful degradation — maps, dual scatter, beeswarm, stacked area
replaced by static text summaries; banner prompts user to open on a wider screen.

**Cross-filter:** Single global state `STATE.filter` (`src/filter.js`), voivodeship only.
Set by clicking a GRAN ranking row. Render callbacks are registered per tab in `main.js`
(`registerFilterCallbacks`): the GRAN chart (`renderGranular`) and the InPost dumbbell
(`renderDumbbellByLevel`) react; the `renderKPI` callback is a guarded no-op since the
header tiles were removed. What does NOT react: the 1.1 growth chart and fingerprint
(network-level story), and the Atlas krańców / coverage / amphibian views (always national).

---

## 6. Loading states

API requests fire in parallel via `Promise.allSettled` with an 8s `AbortController`
timeout per request, split into the core bucket (on load) and a per-tab bucket (on first
open) — see "Data loading" above. Each chart enters a skeleton state immediately and swaps
to rendered content when its own data arrives. Never gate a chart on other charts finishing.

**Skeleton CSS:** `is-loading` class. `background: linear-gradient(90deg, #0f1b0e 25%,
#16261280 50%, #0f1b0e 75%); background-size: 400%; animation: shimmer 1.4s infinite;`

**Reserved heights (prevent layout shift):**

| Component | Height |
|---|---|
| Tab hero | ~360px |
| Stat / KPI strip | ~110px |
| Big growth map + calendar | ~560px |
| 1.1f fingerprint | ~680px |
| 1.1 growth chart | ~340px |
| GRAN bar + choropleth | ~420px |
| Atlas krańców map | ~460px |
| POWIATY donut + mini-map | ~360px |
| BUBBLE chart | ~420px |
| 2.3 InPost choropleth + dumbbell | ~420px |
| NBL bar + kNN histogram | ~400px |
| STREETS / GMINA-LEAD bars | ~420px |
| ECON scatter + bars (each chapter) | ~400px |
| Edge KPI / card rows | ~220px per row |

**Error states:**
- Network error / 5xx: shimmer stops, show "Nie udało się załadować danych. [Spróbuj
  ponownie]". Retry re-fetches only that one endpoint. Other charts stay rendered.
- Empty data (200 + `[]`): "Brak danych dla wybranych filtrów." Only when a voivodeship
  filter returns an empty result set.
- Timeout (> 8s): same as API failure.
- Partial data badge (non-blocking): "218 sklepów bez daty otwarcia nie uwzględnionych"
  on the 1.1 growth chart.

The live data endpoints (`/api/live/*`, weather / air quality / sky in `admin_router.py`)
still exist on the backend but are not wired into the current two-tab layout.
