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
  not abort the ETL, the column just stays empty).
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

- **Dashboard** Chart.js + MapLibre GL (bars, WebGL map, heatmap)
- **Interactive map** MapLibre GL with 13k+ locations
- **Litestar backend** with DuckDB + Redis
- **Full change history** - tracks openings, closings, attribute changes
- **REST API** for integration
- **Daily refresh** of data snapshots
- **Dark theme** "Żabka in the dark city"

## Documentation

All documentation lives in this file (CLAUDE.md), in the chapters below: backend
(chapter 2), data/ETL/enrichment/schema (chapter 3), frontend (chapter 4).

## Quick start

### 1. Install dependencies & configure env
```bash
cd /home/alice/zabka-dashboard
pip install -r requirements.txt
```
Configurable environment variables (optional):
- `API_TOKEN` - Secure token for snapshot uploads (default: `your-secret-token-change-me`)
- `ZABKA_DB` - DuckDB database path (default: `data/zabka.duckdb`)
- `REDIS_SOCKET` - Redis UNIX socket path (default: `/run/redis/redis-server.sock`)
- `GUS_BDL_KEY` - Optional client ID to raise GUS BDL API limits

### 2. Run the backend
```bash
python -m backend
```
The server is available at `http://localhost:8000`. API docs: `http://localhost:8000/docs`.

### 3. Load / ETL data
```bash
# Offline/fast run (skips slow remote APIs)
python -m backend.daily_etl --no-geocode --skip-parks --skip-gus --skip-amphibians

# Full ETL (runs elevation, GBIF, GUS API - requires network and takes time)
python -m backend.daily_etl --elevation
```

### 4. Run tests
```bash
python -m pytest test/test_api.py
```

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

**HTTPS via nginx.** nginx reverse-proxies `https://zabka-stats.barankiewicz.dev/` to
`127.0.0.1:8000`, with a Let's Encrypt cert (certbot `--nginx`, auto-renew via the
`certbot.timer`) and a 80->443 redirect. Port 8000 is not exposed - the firewall
(ufw) allows only SSH, 80, and 443; the backend is reachable only over loopback
behind nginx. nginx also handles **gzip** for API/JSON and the JS/CSS bundle
(`gzip_proxied any`, types include `application/json` and `text/javascript`) so
the single worker never spends CPU compressing - the app sends plain bytes and
nginx compresses on the way out. A small 2 s **microcache** (`proxy_cache` +
`proxy_cache_lock`) sits in front of `/api/` to absorb bursts before Redis warms.
Static assets carry long-lived `Cache-Control`: hashed JS/CSS under `/assets/`
get `immutable, max-age=31536000` (the content hash is the cache key, so this
is always safe); unhashed `public/` files (favicon, OG image, logos,
robots.txt, sitemap.xml) get `max-age=86400, must-revalidate`; `index.html`
stays `no-cache` so a deploy is picked up immediately. Full config:
`deploy/nginx_zabka.conf` - **note it is not auto-deployed**, `deploy/deploy.sh`
only ships the app; nginx config changes must be copied to the VPS by hand and
reloaded (`nginx -t` then `systemctl reload nginx`).

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
`https://zabka-stats.barankiewicz.dev/gc/` (login: `alicja.barankiewicz@formula5.com`,
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

All API endpoints are documented and referenceable under [Chapter 2: Backend -> API](#4-api). For interactive execution, run the server and visit `/docs`.

## Database

DuckDB `data/zabka.duckdb` contains (full schema with types: chapter 3):

Facts:
- **locations** - stores (city, voivodeship, street, lat, lon, flags, enrichment, created_at, deleted_at)
- **parcel_lockers** - InPost parcel lockers (second fact entity)

Dimensions: **dim_voivodeship**, **dim_powiat** (GUS economics), **dim_gmina**
(population + area_km2), **dim_park**; plus **fun_facts**.
Cities (`dim_city`) are stored in a DuckDB dimension table `dim_city` containing population and `area_km2` for the 302 official Polish cities (miasta with powiat rights - powiat kind 2, and gmina miejska - gmina kind 1).

Locations support soft delete via the `deleted_at` timestamp.

## Project structure

```
backend/                 - code + API (chapter 2)
  main.py                - Litestar app + /api/snapshot
  database_ch.py         - DuckDB connection + schema (facts + dimensions)
  cache.py               - Redis cache (UNIX socket)
  daily_etl.py           - thin ETL entrypoint (re-exports run + CLI)
  etl/                   - ETL pipeline: geo.py, io.py, pipeline.py, sources/ (one class per source)
  api/                   - decomposed routers (locations, history, admin, dashboard_router, geo_router, ecology_router, stats_router, spatial_router, demographics)
  schemas/               - Pydantic models for API validation (api_models)

frontend/                - Vite SPA, modular ES + Chart.js + MapLibre GL + Observable Plot + D3 + ECharts (chapter 4)
  index.html             - DOM scaffold + <head> (SEO, fonts); loads /src/main.js
  methodology.html       - methodology page
  src/                   - main.js (tab router, lazy chunks), data.js (fetch buckets),
                           config.js (colors/plugins), filter.js, state.js, utils.js, style.css
  src/tabs/              - one module per tab: siec.js + spoleczenstwo.js (lazy-loaded),
                           plus econ.js, edge.js, kraniec.js, bubble.js (bundled into their parent)
  public/                - og.png, robots.txt, sitemap.xml (copied to dist/ by Vite)
  dist/                  - built bundle shipped to prod

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
- The maps are tile-free dark vector (MapLibre GL); only the fonts and GoatCounter analytics need internet
- Chart.js charts render on the client (no render server)
- Soft deletes preserve history, so deleted locations can be "restored"
- Database indexes are tuned for filtering by city/voivodeship/date

## License

Internal use only.


---

# 2. Backend

Litestar + DuckDB. Serves the analytics API over the Żabka data. The data
pipeline (ETL) is described in chapter 3.

## 1. Tech stack

- **Litestar** (async Python) - high-performance API server + static frontend serving.
- **DuckDB** - embedded column store for analytics.
- **Redis** (UNIX socket) - cache for aggregate responses.
- Geocoding/boundaries: offline point-in-polygon.

Dependencies: `requirements.txt` (root). Main modules: `main.py` (app + CORS +
health + snapshot upload), `database_ch.py` (connection + schema + column
migration), `cache.py` (Redis cache decorator), `api/` (routers), `etl/` (data
pipeline, chapter 3).

## 2. Database choice: DuckDB

**Why:** fast columnar queries for reports, embedded (no server), good for a
read-heavy + append workload (daily snapshots).
**Trade-off:** not suited for transactional OLTP, but we only read and append.
**Schema migration:** `ADD COLUMN IF NOT EXISTS` without `DEFAULT` (a `DEFAULT`
clause in ALTER breaks DuckDB's WAL replay; the ETL sets the values explicitly
anyway). Table schema with types: chapter 3.
**Concurrency & Thread Safety:** DuckDB connections are not thread-safe if shared directly. The backend uses a thread-safe connection pool proxy (`_ConnectionProxy` in [database_ch.py](file:///home/alice/zabka-dashboard/backend/database_ch.py)) managing read-only connections via thread-local storage (`threading.local`). All registered connections are closed during ETL to release the file lock.


## 3. Cache: Redis over a UNIX socket

**Why:** sub-100 ms responses, no TCP overhead, local and safe.
**Where:** `/api/stats/*`, `/api/changes/*`, `/api/trends/*` (TTL 3600 s).
The ETL clears the cache after loading data; the backend rebuilds it on the next
query. Config: `REDIS_SOCKET` (path to the UNIX socket). On the production VPS
this is `/run/redis/redis-server.sock` (Debian `redis-server`, the `zabka` user is
in the `redis` group; the systemd unit passes `REDIS_SOCKET` and waits on
`redis-server.service`). Redis is optional: if the socket is missing (for example
a bare local checkout), `cache.py` logs it and the app runs without a cache.

**How the `@cached` decorator stores values.** Handlers return Pydantic models,
which `json.dumps` cannot encode, so `set_cache` passes a `default` that calls
`model_dump(mode="json")` - the same plain structure Litestar emits, so the
cached and uncached responses are byte-identical. The two largest payloads
(`/api/locations/map` ~3.6 MB, `/api/stats/stores-timeline` ~300 KB) skip the
decorator and instead cache the **pre-serialized JSON string** (via
`get_cached_blob`/`set_cached_blob`) and return it as a raw `Response`, so warm
hits avoid re-parsing and re-encoding the blob on every request.

**Cached responses are reproducible.** Anything that fed a cache used to drift
between recomputes (random `USING SAMPLE`, `ORDER BY` ties) now uses a
deterministic subset (`ORDER BY hash(store_id) LIMIT n`) and stable name
tiebreakers, so the value cached after one ETL run is identical to the next - the
cache is meaningful, not a coin flip.

**Lazy caches warmed at startup.** The voivodeship/powiat area indexes
(`_pow_geo`, `_voiv_area`, `_gmina_agg`), the boundary geojson bytes, and the
~1 MB amphibians GBIF count (`_gbif_total`) are built in `on_startup` hooks
(`startup_geo`, `startup_ecology`) rather than on the first request, so no user
thread pays the build/parse cost. The boundary files (`/api/geo/voivodeships`,
`/api/geo/powiats`) are held in memory and served from there, not re-read from
disk per request. Each router that needs warming exposes a `startup_handlers`
list; `main.py` gathers them into the app's `on_startup`.

**Post-ETL cache warming.** `backend/warm_cache.py` (run by the cron right after
the daily ETL restarts the backend) fires the exact set of URLs the SPA loads -
with the same query params, since the Redis key includes them - so the first
visitor in the hour after the 03:00 ETL gets warm hits instead of repopulating
the cache cold. Keep its `PATHS` in sync with `frontend/src/data.js`.

**Compression is nginx's job, not the app's.** The single uvicorn worker no
longer gzips responses (the Litestar `CompressionConfig` was removed); nginx does
it with `gzip_proxied any` (see the nginx section in chapter 1). This frees the
CPU from compressing the big payloads on every request.

## 4. API

Litestar serves modular native API routers (`backend/api/`) grouped under a parent API router in `backend/main.py`, validated natively using Pydantic schemas (`backend/schemas/api_models.py`). Most endpoints are cached for 1 hour using Redis.

### Endpoints Summary

- **Geo Boundaries:**
  - `GET /api/geo/voivodeships` -> Voivodeship GeoJSON
  - `GET /api/geo/powiats` -> Powiat boundaries (24h cache)
- **Locations & History:**
  - `GET /api/locations` -> Query locations with filters (`?month=`, `?voivodeship=`, `?limit=`)
  - `GET /api/locations/{id}` -> Get single store record
  - `GET /api/locations/map` -> Fast GeoJSON of all stores
  - `GET /api/history/location/{location_id}` -> History of single store
- **Analytical Stats (SIEC tab):**
  - `/api/stats/summary`, `/api/stats/network-growth`, `/api/stats/network-origin`, `/api/stats/stores-timeline`, `/api/stats/openings-monthly`, `/api/stats/opening-hours`, `/api/stats/opening-seasonality`, `/api/stats/by-dimension`
- **Spatial / Coverage / Extremes:**
  - `/api/stats/powiat-coverage`, `/api/stats/city-coverage`, `/api/stats/coverage-funnel`, `/api/stats/neighbor-by-level`, `/api/stats/neighbor-stats`, `/api/stats/twins`, `/api/stats/kraniec-facts`, `/api/stats/elevation`, `/api/stats/parks-stores`, `/api/stats/section3-rare`, `/api/stats/amphibians`
- **Socioeconomics (ŻABKA A POLSKA tab):**
  - `/api/stats/per-capita`, `/api/stats/powiat-economics` (average gross salary, unemployment rate)
  - `/api/stats/inpost-vs-zabka`, `/api/stats/inpost-vs-zabka-by-level` (ratio and dumbbell)
  - `/api/stats/common-streets`, `/api/stats/gmina-leaders`, `/api/stats/sunday-by-voivodeship`
- **Data Export:**
  - `GET /api/download/database` -> Downloads the raw `zabka.duckdb` (~23MB)
  - `GET /api/download/geojson` -> Downloads voivodeships GeoJSON
- **Protected Actions:**
  - `POST /api/snapshot?token=YOUR_TOKEN` -> Uploads a new JSON snapshot to trigger ETL


---

# 3. Data: ETL, core, enrichment, schema

Covers the ETL process, the data core (the main fetched JSON), the full list of
enrichment sources (source, refresh frequency, API method), and the database
schema with data types. Pipeline code: `backend/etl/` (geometry in `geo.py`, I/O
in `io.py`, one enrichment class per source in `sources/`, orchestration in
`pipeline.py`).

### 0. Data model (galaxy schema)

Two fact tables (`locations` = Żabki, `parcel_lockers` = InPost parcel lockers)
share common geographic dimensions (`dim_powiat`, `dim_voivodeship`).
This is a galaxy / fact-constellation schema. The geography has been restructured to four levels: Voivodeship (Level 1), Powiat (Level 2), Gmina (Level 3), and City (Level 4).
GUS economics (salary, unemployment, population) live only in `dim_powiat` (representing the 314 land counties). The 66 cities with powiat rights are assigned to their surrounding/corresponding land powiats at Level 2, ensuring they are fully integrated into county-level economic and statistical queries.

Note: The dimension table `dim_gmina` (2,479 rows) holds all gminas (Level 3), and the view `dim_city` (302 rows) holds all cities (Level 4, consisting of 66 cities with powiat rights and 236 urban gminy miejskie). The table columns `miasto_id` and `gmina_id` are fully populated (100.0% coverage) for both stores and parcel lockers using UUG GUGiK geocoding.

**Keys are numeric** - no string joins. A powiat name is not unique across
voivodeships (for example "powiat grodziski"), so facts join to dimensions via
`voivodeship_id` / `powiat_id` (surrogate keys), and `dim_powiat` points to its
voivodeship through `voivodeship_id`. Names stay on the facts as a display and
grouping attribute, but relationships go through ids.

GDOŚ parks get their own dimension (`dim_park`), linked from `locations` by
`nature_park_id`.

```text
  FACTS                                      DIMENSIONS
  -----                                      ----------
  locations (Żabki)                          dim_powiat
    id (PK)                                    id (PK)
    voivodeship_id   -> dim_voivodeship.id     name
    powiat_id        -> dim_powiat.id          voivodeship_id -> dim_voivodeship.id
    gmina_id         -> dim_gmina.id           population
    miasto_id        -> dim_city.id            avg_salary
    nature_park_id   -> dim_park.id            unemployment_rate
    city, street, lat, lon, flags, ...
    elevation_meters, is_in_nature_park,     dim_voivodeship
    neighbor dist, amphibian fields,           id (PK)
    h3_index_9                                 name
                                               population
  parcel_lockers (parcel lockers)
    external_id (PK)                         dim_gmina
    voivodeship_id   -> dim_voivodeship.id     id (PK)
    powiat_id        -> dim_powiat.id          name
    gmina_id         -> dim_gmina.id           voivodeship_id -> dim_voivodeship.id
    miasto_id        -> dim_city.id            powiat_id      -> dim_powiat.id
    status, lat, lon, created_at, deleted_at   population
                                               area_km2
  fun_facts (key, lat, lon, value)
    - interesting facts, no relations        dim_city
                                               id (PK)
                                               name
                                               voivodeship_id -> dim_voivodeship.id
                                               powiat_id      -> dim_powiat.id
                                               population
                                               area_km2

                                             dim_park
                                               id (PK)
                                               name
                                               type
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
   names, derive flags (h24, Sunday, merrychef), and calculate a resolution 9 H3 index (`h3_index_9`) for each store coordinates using the Python `h3` library.
3. **Enrich Żabki** - each source enriches the stores independently (best-effort:

   a missing source does not abort the ETL, the column just stays empty). Order:
   regions, neighbor, amphibians, parks, elevation. Details in section 4.
4. **Parcel lockers** - InPost parcel lockers loaded as a separate entity (voivodeship/powiat geocoding by the same GUGiK geocoder and fallback matching as the stores).
5. **Build dimensions** - assemble the dimensions with numeric keys, then attach
   GUS economics into `dim_powiat`.
6. **Interesting facts** - compute the facts written to `fun_facts`: the point in
   Poland farthest from any Żabka, the loner (most isolated Żabka), and the most
   froggy Żabka.
7. **Load** - reconcile and load the locations, parcel lockers, dimensions, and
   fun_facts to DuckDB using Polars and PyArrow memory sharing. Incoming rows are loaded into a Polars DataFrame and joined directly with database-active records in DuckDB SQL using memory tables. This allows bulk inserts, in-place overwrites, and soft-deletes (`deleted_at` stamped) without row-by-row iteration or temporary CSV files.
8. **Cache** - clear Redis; the backend rebuilds on the next query.


The database keeps one row per physical store location in a pure SCD Type 2 model. Birth/death trends (created/deleted per month) are queried directly from `locations` via `created_at` and `deleted_at` timestamps. Soft delete (`deleted_at`) marks the date a store was last seen; queries filter `deleted_at IS NULL` by default.

CLI flags: `--no-geocode`, `--limit N`, `--skip-parks`,
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
(~13.2k stores). Administrative boundaries: official GUS registers.

Geographic enrichment adds several sources: GDOŚ parks/buffers, GUS BDL powiat
economics, GUGiK NMT terrain elevation, GBIF amphibian observations, InPost parcel
lockers, and a local neighborhood analysis. Network steps are best-effort - when a
source is missing, the column stays NULL/FALSE and the ETL moves on.

Origin legend:
- SOURCE - value taken straight from a field in the Żabka JSON
- DERIVED - computed from another source field
- GEO - assigned by point-in-polygon against GeoJSON boundaries
- PARKS - point-in-polygon against GDOŚ park/buffer boundaries
- ECONOMY - GUS BDL, attached to the powiat dimension
- ELEVATION - GUGiK NMT numeric terrain model
- SPATIAL - computed locally in the pipeline (no network)
- AMPHIBIANS - amphibian (Amphibia) observations from GBIF
- ETL - generated by the pipeline (keys, timestamps)

### Table `locations` (one row = one store, pure SCD2)

| Column | Type | Origin | Source field / rule |
|---|---|---|---|
| id | INTEGER | ETL | primary key |
| store_id | VARCHAR | SOURCE | `storeId` |
| city | VARCHAR | DERIVED | `town`, case-normalized (LEGNICA -> Legnica) |
| street | VARCHAR | DERIVED | `street` with `<br>` and any embedded postcode removed from display; empty -> "nieokreślona" |
| voivodeship | VARCHAR | GEO | voivodeship name (GUGiK geocoding, 16); display attribute |
| powiat | VARCHAR | GEO | powiat name (GUGiK geocoding, 382); display attribute |
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
| elevation_meters | DOUBLE | ELEVATION | elevation above sea level from GUGiK NMT (`GetHByXY`, PL-1992/EPSG:2180 coordinates); NULL when the service did not answer |
| is_in_nature_park | BOOLEAN | PARKS | TRUE when the point falls inside a GDOŚ park or buffer (point-in-polygon) |
| nature_park_id | INTEGER | PARKS | FK -> `dim_park.id` (the park the store is in, when any) |
| nearest_neighbor_distance_meters | INTEGER | SPATIAL | distance to the nearest other Żabka (BallTree k=2, haversine, meters) |
| amphibian_occurrences_5km | INTEGER | AMPHIBIANS | count of amphibian observations (GBIF, Amphibia) within 5 km of the store, a thematic nod to the network's name |
| nearest_amphibian_km | DOUBLE | AMPHIBIANS | distance to the nearest amphibian observation (GBIF, km) |
| gmina_id | INTEGER | GEO | FK -> dim_gmina.id (resolved via geocoder TERYT code) |
| miasto_id | INTEGER | GEO | FK -> dim_city.id (resolved for stores in the 302 cities) |
| created_at | TIMESTAMP | ETL | time the row was written |
| deleted_at | TIMESTAMP | ETL | soft-delete for active/inactive tracking (NULL = active) |

### Table `parcel_lockers` (InPost parcel lockers - separate fact entity)

A second fact table parallel to `locations`. Tracks inserts and deletes as SCD Type 2. Source: InPost ShipX API. Joins to dimensions by numeric keys (`voivodeship_id`, `powiat_id`, `gmina_id`).

| Column | Type | Origin | Rule |
|---|---|---|---|
| external_id | VARCHAR (PK) | SOURCE | unique locker code/identifier (natural primary key, one row per locker) |
| source_date | DATE | SOURCE | date of the locker data snapshot |
| latitude | DOUBLE | SOURCE | geographical latitude |
| longitude | DOUBLE | SOURCE | geographical longitude |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` (resolved via geocoder) |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` (resolved via geocoder) |
| miasto_id | INTEGER | GEO | FK -> `dim_city.id` (resolved for lockers in the 302 cities) |
| gmina_id | INTEGER | GEO | FK -> `dim_gmina.id` (resolved via geocoder TERYT code) |
| status | VARCHAR | SOURCE | point status (e.g. Operating) |
| created_at | TIMESTAMP | ETL | time the row was written |
| deleted_at | TIMESTAMP | ETL | soft-delete timestamp (NULL = active) |

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

### Table `administrative_division` (base dictionary table)

The master territory dictionary built directly from official GUS BDL / TERYT registers, holding voivodeships (level 1), powiats (level 2), gminas (level 3), and cities (level 4).

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | unique surrogate identifier |
| level | INTEGER | ETL | administrative level: 1 = Voivodeship, 2 = Powiat, 3 = Gmina, 4 = City |
| name | VARCHAR | GEO | name of the territory unit |
| population | INTEGER | ECONOMY | population (GUS BDL) |
| area_km2 | DOUBLE | GEO | territory area in km2 |
| avg_salary | DOUBLE | ECONOMY | average monthly salary (GUS BDL, powiats only) |
| unemployment_rate | DOUBLE | ECONOMY | registered unemployment rate (GUS BDL, powiats only) |
| voivodeship_id | INTEGER | GEO | self-reference: id of parent voivodeship (NULL for voivodeships) |
| powiat_id | INTEGER | GEO | self-reference: id of parent powiat (NULL for powiats/voivodeships) |
| gus_id | VARCHAR | ETL | official GUS BDL/TERYT identifier |

### Table `dim_voivodeship` (dimension)

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | voivodeship name (same as on the facts) |
| population | INTEGER | ECONOMY | sum of powiat populations in the voivodeship (from `dim_powiat`) |

### Table `dim_city` (dimension)

City level dimension view (`administrative_division` level 4). Holds the 302 urban municipalities (gminy miejskie) and cities with powiat rights.

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | city name |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` |
| population | INTEGER | ECONOMY | city population |
| area_km2 | DOUBLE | GEO | city area in km2 |

### Table `dim_gmina` (dimension)

Gmina level dimension view (`administrative_division` level 3).

| Column | Type | Origin | Rule |
|---|---|---|---|
| id | INTEGER (PK) | ETL | surrogate key (numbered in the ETL) |
| name | VARCHAR | GEO | gmina name |
| voivodeship_id | INTEGER | GEO | FK -> `dim_voivodeship.id` |
| powiat_id | INTEGER | GEO | FK -> `dim_powiat.id` (assigned to corresponding land powiat for the 66 cities with powiat rights) |
| population | INTEGER | ECONOMY | gmina population |
| area_km2 | DOUBLE | GEO | gmina area in km2 |

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

Enrichment runs during the ETL pipeline to pre-calculate spatial features, ensuring high performance at query time.

| Source | What it adds / Target Tables | Implementation | Access & Frequency | Config / Parameter |
|---|---|---|---|---|
| **Regions (GUGiK PRG)** | `voivodeship_id`, `powiat_id` in `locations`/`parcel_lockers` | `regions.py` / DuckDB Spatial PIP | Local Shapefiles / rarely | `data/geo/granice/` |
| **GDOŚ Parks** | `is_in_nature_park`, `nature_park_id` (FK to `dim_park`) | `ParksEnricher` / point-in-polygon | Static GeoJSON / yearly | `data/input/parki_gdos.geojson` |
| **GUS BDL Economics** | `population`, `avg_salary`, `unemployment_rate` on `dim_powiat`/`dim_gmina` | `fetch_gus_hierarchy.py` / `populate_administrative_division` | REST API / yearly | `GUS_BDL_KEY`, variables: 64428, 60270, 72305 |
| **InPost ShipX** | `parcel_lockers` fact table | `fetch_parcel_lockers` / `load_parcel_lockers` | Public REST API / monthly | `data/geo/paczkomaty_pl.json` |
| **GUGiK NMT Terrain** | `elevation_meters` | `ElevationEnricher` / HTTP GET | REST `GetHByXY` / daily (new coords only) | `--elevation`, cache: `data/geo/elevation_cache.json` |
| **GBIF Amphibians** | `amphibian_occurrences_5km`, `nearest_amphibian_km` | `AmphibiansEnricher` / BallTree | REST API / yearly | `data/geo/amphibians_pl.json` (taxonKey 131) |
| **Local Proximity** | `nearest_neighbor_distance_meters` | `NeighborEnricher` / BallTree | Local CPU / every ETL | BallTree (k=2, haversine) |

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

## 4. Enrichment & Ingestion Notes

Detailed logic, caching, and exceptions for the ingestion and enrichment sources:

- **GUS BDL Economics:** Downloads average salary (64428), unemployment rate (60270), and population (72305) at powiat level (unit-level=5). Normalizes names (e.g., wałbrzych) and resolves temporal/alias shifts (e.g., jeleniogórski -> karkonoski).
- **GUGiK NMT Elevation:** Projects WGS84 coordinates to EPSG:2180 (PL-1992) using custom transverse Mercator projection. Queries `services.gugik.gov.pl/nmt/?request=GetHByXY` and caches elevation.
- **GDOŚ Parks:** Runs point-in-polygon tests offline against local `data/input/parki_gdos.geojson` (259 national/landscape parks and buffers).
- **GBIF Amphibians:** Counts Amphibia (`taxonKey=131`) observations within 5km using a local BallTree over `data/geo/amphibians_pl.json` (~46k observations).
- **Dropped Source Fields:** The ETL discards marketing URLs, internal locator IDs, and PII (e.g., `salesZoneDirector` personal data) to ensure database cleanliness.
- **Cache Invalidation:** A successful ETL run automatically triggers Redis cache invalidation via `reload_cache()` by connecting to the Redis UNIX socket (`REDIS_SOCKET`).

### 4.1. Data Quality & Caveats
- **`first_opening_date` (1.7% / 218 nulls):** Reflects the opening date of stores *currently active*. Closed historical stores are missing, so early years (1998–2015) remain underrepresented in time-series (treat as "surviving cohort growth").
- **Opening Hours / `is_visible`:** 3.3% (433 stores) are missing hours. `is_visible` is null for 0.4% (53 stores); the ETL leaves those NULL (not coerced to FALSE).
- **Enrichments & Economics:** 100% complete with zero nulls.

### 4.2. Key Proximity & Terrain Distributions
- **Nearest Neighbor Distance:** Min 0m (same GPS pin in malls), Median 299m, Avg 942m, p95 4,751m, Max 27.3km (Michałowo, podlaskie).
- **Elevation (m above sea level):** Min -1.5m (Gdańsk port), Median 132m, Avg 161m, p95 332m, Max 962.6m (Kościelisko).
- **Amphibian Observations (within 5km):** Min 0, Median 17, Avg 55, p95 143, Max 2,028 (Warszawa Ursynów).

### 4.3. Verified Findings Summary
- **F1 (Growth):** 45.4% of surviving stores opened since 2023. Peak year 2025 (1,943 new). Oldest: Swarzędz (1998-10-17).
- **F2 (Capita):** Pomorskie leads per capita (0.46/1k) vs Podkarpackie last (0.18/1k). Kamieński leads powiats (0.99/1k).
- **F3 (Sunday Wall):** 10.6% of stores in Dolnośląskie are closed Sundays (border anomaly), vs <6% in eastern Poland.
- **F4 (Silesia):** Highly dense outlier (0.156 stores/km², 3.5x national average).
- **F5 (InPost dumbbell):** Podkarpackie has 4.54 paczkomaty/Żabka (InPost dominates) vs Zachodniopomorskie at 1.83. National: 2.42.
- **F6 (Merrychef):** Dolnośląskie has a lower merrychef oven rate (90.6% vs 97.4% national).
- **F7 (Standardization):** 91.7% of stores run standard 06:00-23:00 Mon-Sat hours.
- **F9 (Amphibians):** Prime forest (Białowieża) has 425 observations vs urban Ursynów at 2,028. 5.1% of stores have 0 nearby.
- **F10 (h24 border):** 32 stores total; heavily concentrated near motorway/border junctions (e.g. Lubuskie / Świnoujście).
- **F11 (Powiats & Addresses):** 314/314 land powiats covered (cities with powiat rights are merged into their land powiat at level 2). Most common street name is "Rynek" (222 stores), then Kościuszki (193).
- **F12 (Frog Streets):** 24 stores on frog/wetland streets (e.g., Zielonej Żabki 7 in Żabia Wola).

---

# 4. Frontend

Single-page dashboard, dark theme, served by Litestar. A Vite build: `index.html` is just
the DOM scaffold + `<head>`; all logic lives in modular ES under `frontend/src/`, entry
`src/main.js`. Rendered via Chart.js + MapLibre GL + Observable Plot + ECharts + D3 + Canvas 2D, pulling from
`/api/*`. For the full component register, see [Section 3 (Components and charts)](#3-components-and-charts) below.

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
glows, teal (`#4dd0b1`) for ecological / amphibian data. All maps are tile-free dark vector
(MapLibre GL); the Atlas carries a faint store-dot backdrop instead of raster tiles.

---

## 3. Components and charts

This section is the navigable index — what each component shows and where its data comes from. The SQL logic, layout constraints, and interactions are implemented directly in the backend APIs and frontend modules.

There is no global header KPI strip. Each tab carries its own hero + stat tiles.

### Tab SIEĆ (`siec.js`, render order)

Imports `bubble.js` (D3 force chart), `kraniec.js` (Atlas krańców), `edge.js` (edge KPI strip).

| Ref | Library | Endpoint | What it shows |
|---|---|---|---|
| Hero | Canvas 2D | `/stats/summary`, `/stats/network-origin` | Full-bleed opening: mono eyebrow (snapshot date), giant gradient-clipped glowing count-up of total active stores, drifting green particle field, headline + lede. Respects `prefers-reduced-motion`. |
| Stat strip | DOM | `/stats/network-growth`, `/network-origin`, `/neighbor-stats`, `/coverage-funnel` | Six fact tiles: first-1k cadence, last-5k cadence, best year, median neighbor distance, % of Polish cities with a Żabka, new in the last month. |
| Origin cards | DOM | `/stats/network-origin` | Oldest still-active store (Swarzędz, 1998) vs newest (updates each run). |
| BUBBLE | D3 (force) | `/stats/by-dimension?dim=city&metric=count&limit=60` | Force-directed bubbles, one per city, size = store count, drag + Ctrl-scroll zoom, "Pozostałe" bubble for the tail. |
| MAPA growth map + calendar | MapLibre GL (WebGL circles) + Canvas 2D (calendar) | `/geo/voivodeships`, `/stats/stores-timeline`, `/stats/openings-monthly` | Large dark vector map of Poland (no tiles), pitched to 38° (drag-to-rotate / right-click tilts). All 13k+ stores are a single WebGL circle layer that animates in by opening year via a `setFilter` sweep, a ~2.8s sweep 1998->2026 with year label + replay. A companion calendar grid (Canvas 2D) shows month-by-month openings. |
| 1.1f fingerprint | Canvas 2D | `/stats/network-growth`, `/stats/stores-timeline` | The "odcisk" unrolled flat: X = compass direction (N-E-S-W-N), Y = year (1998->2026); each row bulges toward that year's dominant expansion bearing. Hover -> year + direction. |
| 1.1 growth chart | Chart.js | `/stats/network-growth` | One x-axis (years), two y-axes: bars = new stores/year, line = YoY change %. Era background bands. Footnote: covers only currently-active stores; early years underrepresented. |
| GRAN ranking | Chart.js (bar) + MapLibre GL (choropleth) | `/stats/by-dimension`, `/geo/voivodeships` | Left: horizontal ranking bar with three switchers — level (Woj./Powiaty/Miasta) x metric (Liczba / na 1000 mieszk. / na km²) x sort (Największe/Najmniejsze). Right: voivodeship choropleth (always voivodeship-level, value labels as HTML markers). Click a row sets the cross-filter. |
| Edge KPI strip | DOM | `/stats/section3-rare`, `/elevation`, `/neighbor-stats`, `/amphibians` | Six clickable tiles feeding the Atlas: 32 h24 stores (amber), stores in parks, frog record, the 46.5 km void, oldest active, farthest-from-frog. Click flies the Atlas map to that fact. |
| Atlas krańców | MapLibre GL + mini panels | `/stats/kraniec-facts`, `/elevation`, `/neighbor-stats`, `/parks-stores`, `/twins`, `/amphibians` | One interactive Poland map (tile-free) with a faint store backdrop. Compass points, highest/lowest store, the loner, the Bieszczady void (dashed geodesic circle, no dots inside), the frog street, h24, parks, twins. Hover/click a fact -> `flyTo` + tooltip; leave -> national view. |
| POWIATY coverage | Chart.js (donut) + Canvas 2D | `/stats/powiat-coverage`, `/stats/coverage-funnel`, `/geo/voivodeships` | Animated donut: % of powiats / miasta / gminy with at least one Żabka (level toggle). Canvas mini-map: green = covered, red = uncovered. |

### Tab ŻABKA A POLSKA (`spoleczenstwo.js`, default tab, render order)

Imports `econ.js` (the two ECharts economic chapters).

| Ref | Library | Endpoint | What it shows |
|---|---|---|---|
| Hero | Canvas 2D | `/stats/section3-rare` | Count-up of the 46.5 km void distance, particle field, lede with live totals. |
| KPI strip | DOM | `/stats/summary`, `/per-capita`, `/voivodeship-density`, `/inpost-vs-zabka`, `/coverage-funnel` | Six national stats: one store per X residents, density /100 km², gmina coverage %, InPost-per-Żabka ratio, cities with Żabka, salary correlation. |
| 2.3 InPost | MapLibre GL (choropleth) + SVG/DOM (dumbbell) | `/stats/inpost-vs-zabka`, `/inpost-vs-zabka-by-level` | Left: voivodeship choropleth of the InPost/Żabka ratio (inverted ramp: high ratio = dim, low = bright). Right: dumbbell — green dot = Żabka/100k, amber dot = paczkomaty/100k, connecting line; level toggle Województwo / Powiat / Miasto re-queries `by-level`. National callout: 2.42 paczkomaty per Żabka. |
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
- **MapLibre GL JS 5.24** — all four dashboard maps: the SIEĆ growth map (a single
  WebGL circle layer for 13k+ stores, filtered by year, pitched to 38° for 3D),
  the GRAN voivodeship choropleth, the Atlas krańców extremes map, and the
  InPost ratio choropleth (2.3). Tile-free dark-vector base (voivodeship polygons
  on near-black); the Atlas adds a faint store-dot backdrop for context. Value
  labels are HTML Markers (no glyph atlas needed → keeps it offline). Shared
  primitives live in `frontend/src/maplibre-map.js` (dark style, voivodeship
  layer factory, green ramp, geodesic circle, bounds helper).
- **D3.js** — bubble chart only (`bubble.js`): force simulation + zoom/drag, tree-shaken
  (`forceSimulation`, `forceX/Y`, `forceCollide`, `scaleSqrt`, `zoom`, `drag`). Never the DOM elsewhere.
- **Canvas 2D** — hero particles + count-up (both tabs), the growth-map calendar
  grid, the unrolled fingerprint (1.1f), the POWIATY coverage mini-map. Used
  wherever 13k+ DOM nodes would hurt. (The growth-map dot overlay moved to a
  MapLibre WebGL circle layer.)
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
Mobile (< 768px): grids reflow to 1-2 columns and maps/charts shrink via media
queries (`src/style.css`), but there is no static-text fallback or narrow-screen
banner - the full maps, D3 bubble, and ECharts scatters still render at phone
widths. Touch interactions (map ctrl+scroll hints, drag-to-zoom) are unchanged
from desktop, so some affordances (e.g. "ctrl + scroll przybliża") don't apply
on touch.

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
