# Żabka Dashboard

An interactive, high-performance spatial analytics platform for tracking the density, growth, and socio-economic correlations of the Żabka store network and InPost parcel lockers across Poland.

[![build status](https://img.shields.io/badge/build-failed-red.svg)](https://github.com/barankiewicz/zabka-stats/actions)
[![stars](https://img.shields.io/github/stars/barankiewicz/zabka-stats.svg?style=social)](https://github.com/barankiewicz/zabka-stats)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![python](https://img.shields.io/badge/python-3.13%2B-blue.svg)](https://www.python.org)
[![duckdb](https://img.shields.io/badge/database-DuckDB-orange.svg)](https://duckdb.org)
[![database size](https://img.shields.io/badge/database%20size-22.01%20MB-blue.svg)](https://github.com/barankiewicz/zabka-stats)
[![locations](https://img.shields.io/badge/locations-13%2C177-orange.svg)](https://github.com/barankiewicz/zabka-stats)
[![parcel lockers](https://img.shields.io/badge/parcel%20lockers-31%2C950-brightgreen.svg)](https://github.com/barankiewicz/zabka-stats)
[![query time](https://img.shields.io/badge/avg%20query%20time-%3C5ms-yellow.svg)](https://github.com/barankiewicz/zabka-stats)
[![uptime](https://img.shields.io/badge/uptime-100%25-green.svg)](https://github.com/barankiewicz/zabka-stats)

---

## 1. Goal & Purpose

The goal of this project is to analyze geographic patterns, historical expansion, and socio-economic correlates of convenience retail density in Poland. 

By cross-referencing locations of over **13,100+ active convenience stores** (Żabka) and **31,900+ parcel lockers** (InPost) against official registers of the Central Statistical Office (GUS BDL), the Head Office of Geodesy and Cartography (GUGiK), and environmental data, this platform uncovers hidden retail anomalies, regional divides, and urban-rural splits.

---

## 2. The Dashboard & Verified Findings

The dashboard is structured into four interactive storytelling layers:

*   **Sieć (Network):** Growth history, calendar heatmaps of store openings, and administrative rankings (Voivodeships, Powiats, Gminas, and Cities).
*   **Społeczeństwo (Society):** Scatter plots correlating store density against average salaries and unemployment rates, alongside an InPost vs. Żabka competitiveness index.
*   **Edge Case'y (Edge Cases):** Curiosities, geographic extremes (e.g., elevation analysis and park overlaps), and the "Void" analysis.
*   **Płazy (Amphibians):** A playful look at the density of ecological frog occurrences (GBIF database) near Żabka stores.

### Key Insights You Can Get:
*   **F1 - Survival Cohort Growth:** 45.4% of currently active stores opened since 2023. The oldest active store is in Swarzędz (opened in October 1998).
*   **F3 - The Western Sunday Wall:** A distinct regional anomaly where stores in western Poland (e.g., Dolnośląskie at 10.6%) are up to 5x more likely to remain closed on Sundays compared to the rest of the country.
*   **F4 - Silesia Density Outlier:** Śląskie voivodeship is a massive density outlier with **0.156 stores/km²** (nearly 4x the national average of 0.042/km²).
*   **F5 - InPost East-West Dominance Reversal:** Eastern Poland (Podkarpackie) has 4.54 parcel lockers per store, whereas Western Poland (Zachodniopomorskie) has only 1.83.
*   **F8 - Elevation Extremes:** The highest active store sits at **962.6m** (Kościelisko in the Tatry foothills), while the lowest is in the Gdańsk port area at **-1.5m** (below sea level).
*   **F13 - Proximity:** Half of the entire store network lives within **300m** of another store, while the most isolated store sits **27.3 km** away from its nearest neighbor (Michałowo, Podlaskie).

---

## 3. Tech Stack

*   **Frontend:** Vite, Vanilla HTML5/CSS3 (Curated dark mode), Chart.js (Interactive charts), Leaflet.js (Vector polygons and canvas overlays), ECharts (Economic scatters).
*   **Backend:** FastAPI (Python 3.13), Uvicorn server, Redis cache.
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

#### `parcel_lockers` (Fact Table)
Stores latest snapshot of InPost parcel lockers.
*   `id` (INTEGER - PK)
*   `latitude`, `longitude` (DOUBLE)
*   `voivodeship_id`, `powiat_id`, `miasto_id`, `gmina_id` (INTEGER) - FKs.
*   `status`, `operator` (VARCHAR)

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

The backend serves 17 endpoints. Key JSON endpoints include:

*   `GET /api/stats/summary` - Core KPI statistics.
*   `GET /api/geo/voivodeships` - Serves `wojewodztwa.geojson`.
*   `GET /api/stats/by-dimension?dim={voivodeship|powiat|gmina|city}` - Aggregated counts and densities.
*   `GET /api/stats/powiat-economics` - Returns powiat average salaries, unemployment, and density.
*   `GET /api/stats/inpost-vs-zabka` - Locker-to-store ratios.
*   `GET /api/stats/section3-rare` - Curiosities, including elevation and spatial extremes loaded from `fun_facts`.

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
*   **Raw DuckDB Database:** [http://localhost:8000/api/download/database](http://localhost:8000/api/download/database) - Downloads `zabka.duckdb` (~28.7 MB), which contains the fully populated, enriched tables.
*   **Voivodeship GeoJSON:** [http://localhost:8000/api/download/geojson](http://localhost:8000/api/download/geojson) - Downloads `wojewodztwa.geojson` (~16.9 MB), containing precalculated spatial boundaries.

### Connect as Read-Only Guest
Because DuckDB is an embedded database, concurrent write processes are restricted, but multiple read-only connections are fully supported. To query the database without locking the application server, you should connect with read-only access.

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
    COUNT(l.id) AS store_count, 
    ROUND(COUNT(l.id) * 10000.0 / population, 2) AS stores_per_10k
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
3. In connection properties, check **Read-Only** (or add `read_only=true` to the driver connection parameters) to ensure it does not conflict with the active FastAPI server.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
