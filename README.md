# Żabka Dashboard

An interactive, high-performance spatial analytics platform for tracking the density, growth, and socio-economic correlations of the Żabka store network and InPost parcel lockers across Poland.

**Live Demo:** [https://zabkozbior.barankiewicz.dev](https://zabkozbior.barankiewicz.dev)

![Dashboard Screenshot](./frontend/public/og.png)

[![stars](https://img.shields.io/github/stars/barankiewicz/zabka-stats.svg?style=social)](https://github.com/barankiewicz/zabka-stats)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![python](https://img.shields.io/badge/python-3.13%2B-blue.svg)](https://www.python.org)
[![duckdb](https://img.shields.io/badge/database-DuckDB-orange.svg)](https://duckdb.org)

---

## 1. Goal & Purpose

The goal of this project is to analyze geographic patterns, historical expansion, and socio-economic correlates of convenience retail density in Poland. 

By cross-referencing locations of over **13,100+ active convenience stores** (Żabka) and **31,900+ parcel lockers** (InPost) against official registers of the Central Statistical Office (GUS BDL), the Head Office of Geodesy and Cartography (GUGiK), and environmental data, this platform uncovers hidden retail anomalies, regional divides, and urban-rural splits.

---

## 2. The Dashboard & Verified Findings

The dashboard is structured into two interactive storytelling tabs:

*   **Sieć (Network):** Growth history, calendar heatmaps of store openings, administrative rankings (Voivodeships, Powiats, Gminas, Cities), and the *Atlas krańców* of geographic extremes - elevation, the largest "Void", park overlaps, and the playful look at ecological frog occurrences (GBIF) near stores (edge cases and amphibians are folded in here).
*   **Żabka a Polska (Society):** Residual choropleth maps correlating store density against average salaries and unemployment rates, alongside an InPost vs. Żabka competitiveness index.

---

## 3. Tech Stack

*   **Frontend:** Vite, Vanilla HTML5/CSS3 (Curated dark mode), Chart.js (Interactive charts), MapLibre GL JS (tile-free dark vector maps), D3 (force bubble).
*   **Backend:** Litestar (Python 3.13, async), Uvicorn. Redis caches every aggregate response (TTL 1 h, cleared by the ETL); nginx in front handles gzip + a 2 s microcache, so warm queries return in single-digit ms.
*   **Database:** DuckDB (Ultra-fast local analytics database).

---

## 4. Data Architecture

The project implements a **galaxy (fact-constellation) schema** optimized for rapid analytical queries.

```
       +------------------+         +-------------------------+
       |   parcel_lockers |         |        locations        |
       |     (Fact Table) |         |     (Main Fact Table)   |
       +--------+---------+         +------------+------------+
                |                                |
                +---------------+----------------+
                                |
                                v (FK on ID)
               +----------------------------------+
               |      administrative_division     |
               |        (Central Dimension)       |
               +----------------+-----------------+
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v (Level 1)             v (Level 2)             v (Level 3/4)
+---------------+       +---------------+       +---------------+
|dim_voivodeship|       |  dim_powiat   |       |   dim_gmina   |
|    (View)     |       |    (View)     |       |   dim_city    |
+---------------+       +---------------+       +---------------+
```

### Table Schema Summary

#### `locations` (Main Fact Table - SCD Type 2)
Stores historical and current convenience store records.
*   `store_id` (VARCHAR) - Original unique identifier.
*   `voivodeship_id`, `powiat_id`, `gmina_id`, `miasto_id` (INTEGER) - FKs to `administrative_division`.
*   `latitude`, `longitude` (DOUBLE) - Coordinate location.
*   `has_merrychef` (BOOLEAN) - Oven presence.
*   `open_sunday` (BOOLEAN) - Sunday opening status.
*   `h24` (BOOLEAN) - 24/7 status.
*   `first_opening_date` (DATE) - Opening date (98.3% populated).
*   `elevation_meters` (DOUBLE) - Elevation above sea level.
*   `is_in_nature_park` (BOOLEAN) - Located in protected area.
*   `nature_park_id` (INTEGER) - FK to `dim_park` dimension.
*   `nearest_neighbor_distance_meters` (INTEGER) - Distance to closest store.
*   `created_at`, `deleted_at` (TIMESTAMP) - Validity window.

#### `parcel_lockers` (Fact Table - SCD Type 2)
InPost parcel lockers, modeled exactly like `locations`.
*   `external_id` (VARCHAR - PK) - natural key, one row per locker (no surrogate id, no duplicates).
*   `latitude`, `longitude` (DOUBLE)
*   `voivodeship_id`, `powiat_id`, `miasto_id`, `gmina_id` (INTEGER) - FKs.
*   `status` (VARCHAR)
*   `created_at`, `deleted_at` (TIMESTAMP) - validity window (NULL `deleted_at` = active).

#### `administrative_division` (Dimension Table)
Consolidated dictionary for 16 Voivodeships, 314 Powiats, 2,479 Gminas, and 302 Cities.
*   `id` (INTEGER - PK)
*   `level` (INTEGER) - 1=Voivodeship, 2=Powiat, 3=Gmina, 4=City.
*   `name` (VARCHAR)
*   `population` (INTEGER) - GUS BDL.
*   `area_km2` (DOUBLE) - Boundary polygon area.
*   `avg_salary` (DOUBLE), `unemployment_rate` (DOUBLE) - Powiat economic metrics.

#### `fun_facts` (Helper Table)
Caches precomputed retail extremes.
*   `key` (VARCHAR - PK) - e.g. `farthest_from_zabka`, `most_isolated_zabka`.
*   `lat`, `lon` (DOUBLE)
*   `value` (DOUBLE) - Distance in km or observations count.

---

## 5. Data Sources & Enrichment Pipeline

Materialized during the ETL run to allow instant frontend filtering without expensive query-time calculations.

*   **Żabka Locator:** Raw locator JSON processed via linear deduplication.
*   **GUGiK PRG (Official Boundary Shapefiles):** Official boundary shapefiles (`A01_Granice_wojewodztw.shp`, `A02_Granice_powiatow.shp`) parsed via the **DuckDB Spatial extension** to calculate the furthest point from any store and output `wojewodztwa.geojson` for the UI.
*   **GUS BDL API:** Fetches local population, average salary, and unemployment rates.
*   **InPost ShipX API:** Location data for 31,900+ parcel lockers.
*   **GUGiK NMT:** Flat coordinates projected to `PL-1992 / EPSG:2180` to fetch elevation above sea level.
*   **GDOŚ Parks:** Bounding boxes of national/landscape parks.
*   **GBIF occurrences:** Amphibian occurrence logs within a 5 km radius.

---

## 6. API Reference

The backend serves a set of read-only JSON endpoints (all cached in Redis). Key ones include:

*   `GET /api/stats/summary` - Core KPI statistics.
*   `GET /api/geo/voivodeships` - Serves `wojewodztwa.geojson`.
*   `GET /api/stats/by-dimension?dim={voivodeship|powiat|gmina|city}` - Aggregated counts and densities.
*   `GET /api/stats/powiat-economics` - Returns powiat average salaries, unemployment, and density.
*   `GET /api/stats/inpost-vs-zabka` - Locker-to-store ratios.
*   `GET /api/stats/section3-rare` - Curiosities, including elevation and spatial extremes loaded from `fun_facts`.
*   `GET /fakt/{slug}` - Shareable single-fact page (server-rendered SPA with per-fact SEO/OG tags). Slugs: `pustka-bieszczadzka`, `samotna-zabka`, `najstarsza-zabka`, `zielonej-zabki`, `mediana-odleglosci`.
*   `GET /fakt/{slug}/og.png` - The matching per-fact social preview image.

---

## 7. Getting Started

### Prerequisites
*   Python 3.13+
*   Node.js (for building frontend)

### Installation
1.  Clone the repository and enter the directory:
    ```bash
    git clone https://github.com/barankiewicz/zabka-stats.git
    cd zabka-stats
    ```
2.  Install python dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Run the Backend (with embedded frontend)
```bash
python -m backend
```
The server will start on [http://localhost:8000](http://localhost:8000).

### Run the ETL pipeline
The ETL pipeline handles raw data ingestion, geocoding via GUGiK, external API enrichments, and populating DuckDB.
```bash
# Run basic ETL (fast, offline)
python -m backend.daily_etl --no-geocode --skip-parks --skip-gus --skip-amphibians

# Run full ETL with GUGiK terrain model (takes time, queries remote services)
python -m backend.daily_etl --elevation
```

---

## 8. Querying & Dataset Downloads (Play with the Data)

This project encourages open data exploration. The entire compiled dataset is available for download, and you can query the analytical database directly.

### Dataset Downloads
You can download the raw datasets directly via the API when the server is running:
*   **Raw DuckDB Database:** [http://localhost:8000/api/download/database](http://localhost:8000/api/download/database) - Downloads `zabka.duckdb` (~48 MB), which contains the fully populated, enriched tables.
*   **Voivodeship GeoJSON:** [http://localhost:8000/api/download/geojson](http://localhost:8000/api/download/geojson) - Downloads `wojewodztwa.geojson` (~160 KB), containing simplified voivodeship boundaries.
*   **Parquet export:** [http://localhost:8000/api/download/parquet](http://localhost:8000/api/download/parquet) - Active locations as ZSTD-compressed Parquet (~1 MB).

### Connect as Read-Only Guest
Because DuckDB is an embedded database, concurrent write processes are restricted, but multiple read-only connections are fully supported. To query the database without locking the backend server, you should connect with read-only access.

#### Option A: DuckDB Command Line Interface (CLI)
Start the CLI in read-only mode by passing the `-readonly` flag:
```bash
duckdb data/zabka.duckdb -readonly
```
Example query to find the top 5 powiats with the highest number of stores per 10,000 residents:
```sql
SELECT 
    name, 
    population, 
    COUNT(l.store_id) AS store_count, 
    ROUND(COUNT(l.store_id) * 10000.0 / population, 2) AS stores_per_10k
FROM administrative_division ad
JOIN locations l ON l.powiat_id = ad.id
WHERE ad.level = 2 AND l.deleted_at IS NULL
GROUP BY name, population
ORDER BY stores_per_10k DESC
LIMIT 5;
```

#### Option B: Python (Pandas / SQL)
You can connect programmatically using python by passing `read_only=True`:
```python
import duckdb

# Connect in read-only guest mode
conn = duckdb.connect("data/zabka.duckdb", read_only=True)

# Run query and retrieve as a Pandas DataFrame
df = conn.execute("""
    SELECT city, COUNT(*) AS store_count 
    FROM locations 
    WHERE deleted_at IS NULL 
    GROUP BY city 
    ORDER BY store_count DESC 
    LIMIT 10
""").fetchdf()

print(df)
```

#### Option C: GUI Database Clients (DBeaver / DataGrip)
To inspect the tables, views, and schemas using a graphical client:
1. Create a new **DuckDB** connection.
2. Set the database path to `data/zabka.duckdb`.
3. In connection properties, check **Read-Only** (or add `read_only=true` to the driver connection parameters) to ensure it does not conflict with the active backend server.

---

## 9. FAQ

Answers to the questions that always show up once this gets shared somewhere.

**Where does the data come from? Is scraping it legal?**
Store locations come from Żabka's own public store locator JSON, the same file that
powers the "find a store near you" map on zabka.pl. There's no login wall to get
around and no rate limits being dodged, it's just a JSON file that anyone's browser
can request. The ETL also drops any personal fields it finds in the raw source
(sales zone director names, for example) before anything reaches the database. The
economic and geographic enrichment comes from official Polish open registers, GUS
BDL and GUGiK.

**Why do the early years look so small on the growth chart?**
Because the dataset is a snapshot of stores that are active right now, not a full
historical register of every store that ever opened. Every date on the chart is a
store's opening date, but a store that opened in 2005 and closed in 2019 is gone
from this snapshot, and its opening date goes with it. The older a cohort, the more
of it has closed over the years, so early years end up underrepresented. This is
survivorship bias, and the chart carries the same note directly on it.

**How is per-capita computed for cities with powiat rights (Warszawa etc.)?**
GUS's population numbers for a powiat are land-only. They don't include the
population of a city with powiat rights that sits inside its borders, so Warszawa's
1.87M residents aren't counted into any powiat's population figure. Stores located
in Warszawa, though, do get attributed to a host powiat for geographic joins, and
dividing store count by that powiat's land-only population would inflate density by
roughly 10x near any big city. The fix lives in two database views that add the
missing city population back onto the host powiat and voivodeship before computing
density, applied only where per-capita numbers are calculated. The base tables stay
untouched and GUS-accurate.

**What's the stack?**
Litestar and DuckDB on the backend, Redis for caching, Vite with Chart.js and
MapLibre GL on the frontend. Full breakdown in the sections above, or see the
[methodology page](https://zabkozbior.barankiewicz.dev/methodology.html) for how
the numbers themselves are calculated.

**Do you work for Żabka?**
No. This is an independent project, unaffiliated with and not endorsed by Żabka
Polska. It's built entirely from public data.

---

## 10. My Goals

This project was as much about learning as it was about building something people could
actually use. Things I wanted to get better at, in no particular order:

*   **Infrastructure & hosting:** hosting my own service from scratch on a Linux VPS,
    and learning how much performance you can squeeze out when you have total freedom
    over how the data flows, on both the frontend and the backend.
*   **Backend & data engineering:** building a fast API in Litestar, learning DuckDB
    (it's all the rage recently, for good reason), learning Polars, working with Redis,
    and building a custom ETL pipeline that doesn't just filter and join data but
    actually enriches it.
*   **Data testing:** writing real tests for a data pipeline, not just the API surface.
*   **Public Polish data:** learning to work with official registers like GUS and
    GUGiK - what's actually available, how clean (or not) it is, and how to reconcile
    it with itself.
*   **GIS:** working with and visualizing geographic data - GeoJSON, point-in-polygon
    algorithms, and coordinate encodings.
*   **Frontend:** building a modern frontend with Vite, making a site properly
    multilingual, optimizing it for performance on both ends, and experimenting
    with data visualization techniques to try to land on something a bit more creative than
    the usual dashboard template.
*   **Tooling and automation:** scripting the tedious parts (test scaffolding,
    audits, repetitive fixes) so the interesting work gets the attention it needs.
*   **Understanding BI dashboards:** seeing how one works end-to-end, under the hood,
    instead of just consuming one someone else built.
*   And, hopefully, **building a dataset someone else can actually use** - not just a
    portfolio piece.

---

## 11. Next Steps

Nothing planned yet, but the pipeline (ETL -> DuckDB -> Litestar -> Vite dashboard) is
generic enough to point at a different Polish retail or logistics network with its own
public locator data. InPost's own parcel-locker network on its own terms, Biedronka, or
Dino are all interesting candidates - each with a different regional footprint and its
own story to tell.

---

## 12. License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
