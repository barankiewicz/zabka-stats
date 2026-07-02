"""
DuckDB database connection and initialization.
"""

import json
import threading
from pathlib import Path

import duckdb

# Database path
DB_PATH = Path(__file__).parent.parent / "data" / "zabka.duckdb"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def _run_all_ddl(con):
    """All DDL: schema creation + migrations. Requires a read-write connection.

    Idempotent — safe to call on every startup. ETL also calls this directly
    before loading data, so the backend never needs to create tables itself
    in production. The function is here as a fallback for local dev.
    """
    tables = con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    table_names = [t[0] for t in tables]

    if 'locations' not in table_names:
        print("Creating DuckDB schema...")

        # store_id is the natural PK (one row per physical store, no surrogate int id).
        # created_at = first-seen timestamp (never overwritten on upsert).
        # deleted_at = when the store vanished from the source (NULL = active).
        con.execute("""
            CREATE TABLE locations (
                store_id VARCHAR PRIMARY KEY,
                city VARCHAR,
                street VARCHAR,
                voivodeship VARCHAR,
                powiat VARCHAR,
                voivodeship_id INTEGER,
                powiat_id INTEGER,
                latitude DOUBLE NOT NULL,
                longitude DOUBLE NOT NULL,
                has_merrychef BOOLEAN,
                open_sunday BOOLEAN,
                h24 BOOLEAN,
                opening_hours_monsat VARCHAR,
                opening_hours_sun VARCHAR,
                first_opening_date DATE,
                is_visible BOOLEAN,
                is_new_month BOOLEAN,
                is_new_two_weeks BOOLEAN,
                elevation_meters DOUBLE,
                is_in_nature_park BOOLEAN DEFAULT FALSE,
                nature_park_id INTEGER,
                nearest_neighbor_distance_meters INTEGER,
                amphibian_occurrences_5km INTEGER,
                nearest_amphibian_km DOUBLE,
                gmina_id INTEGER,
                miasto_id INTEGER,
                h3_index_9 VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP
            )
        """)

        # dim_date table
        con.execute("""
            CREATE TABLE dim_date (
                date_actual DATE PRIMARY KEY,
                day_name VARCHAR NOT NULL,
                day_of_week INTEGER NOT NULL,
                day_of_month INTEGER NOT NULL,
                day_of_year INTEGER NOT NULL,
                month_number INTEGER NOT NULL,
                month_name VARCHAR NOT NULL,
                year_actual INTEGER NOT NULL,
                is_weekend BOOLEAN NOT NULL,
                quarter INTEGER NOT NULL
            )
        """)

        con.execute("""
            INSERT INTO dim_date (
                date_actual, day_name, day_of_week, day_of_month, day_of_year,
                month_number, month_name, year_actual, is_weekend, quarter
            )
            SELECT
                d AS date_actual,
                dayname(d) AS day_name,
                dayofweek(d) AS day_of_week,
                dayofmonth(d) AS day_of_month,
                dayofyear(d) AS day_of_year,
                month(d) AS month_number,
                monthname(d) AS month_name,
                year(d) AS year_actual,
                CASE WHEN dayofweek(d) IN (0, 6) THEN TRUE ELSE FALSE END AS is_weekend,
                quarter(d) AS quarter
            FROM generate_series(DATE '2024-01-01', DATE '2030-12-31', INTERVAL '1 day') AS t(d)
        """)

        for stmt in (
            "CREATE INDEX idx_locations_city ON locations(city)",
            "CREATE INDEX idx_locations_voivodeship ON locations(voivodeship)",
            "CREATE INDEX idx_locations_powiat ON locations(powiat)",
            "CREATE INDEX idx_locations_deleted_at ON locations(deleted_at)",
            "CREATE INDEX idx_locations_created_at ON locations(created_at)",
            "CREATE INDEX idx_locations_voivodeship_id ON locations(voivodeship_id)",
            "CREATE INDEX idx_locations_powiat_id ON locations(powiat_id)",
            "CREATE INDEX idx_locations_h3_index_9 ON locations(h3_index_9)",
        ):
            con.execute(stmt)

        print("DuckDB schema created.")

    # Idempotentne migracje — bezpieczne przy kazdym wywolaniu.
    ensure_extra_tables(con)
    ensure_enrichment_columns(con)
    _migrate_locations_pk_if_needed(con)


def _migrate_locations_pk_if_needed(con):
    """Drop and immediately recreate the locations table if it has the old integer id PK.
    Data will be re-populated on the next ETL run."""
    cols = {r[1] for r in con.execute("PRAGMA table_info('locations')").fetchall()}
    if 'id' not in cols:
        return
    print("[migrate] locations has old integer id PK — dropping and rebuilding schema")
    con.execute("DROP TABLE locations")
    con.execute("""
        CREATE TABLE locations (
            store_id VARCHAR PRIMARY KEY,
            city VARCHAR, street VARCHAR, voivodeship VARCHAR, powiat VARCHAR,
            voivodeship_id INTEGER, powiat_id INTEGER,
            latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL,
            has_merrychef BOOLEAN, open_sunday BOOLEAN, h24 BOOLEAN,
            opening_hours_monsat VARCHAR, opening_hours_sun VARCHAR,
            first_opening_date DATE, is_visible BOOLEAN, is_new_month BOOLEAN,
            is_new_two_weeks BOOLEAN, elevation_meters DOUBLE,
            is_in_nature_park BOOLEAN DEFAULT FALSE, nature_park_id INTEGER,
            nearest_neighbor_distance_meters INTEGER,
            amphibian_occurrences_5km INTEGER, nearest_amphibian_km DOUBLE,
            gmina_id INTEGER, miasto_id INTEGER, h3_index_9 VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP
        )
    """)
    for stmt in (
        "CREATE INDEX idx_locations_city ON locations(city)",
        "CREATE INDEX idx_locations_deleted_at ON locations(deleted_at)",
        "CREATE INDEX idx_locations_created_at ON locations(created_at)",
        "CREATE INDEX idx_locations_voivodeship_id ON locations(voivodeship_id)",
        "CREATE INDEX idx_locations_powiat_id ON locations(powiat_id)",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass
    print("[migrate] done — locations rebuilt with store_id as primary key")


def _ensure_schema():
    """Run all DDL via a temporary read-write connection, then close it."""
    rw = duckdb.connect(str(DB_PATH))
    try:
        _run_all_ddl(rw)
    finally:
        rw.close()


class _ConnectionProxy:
    """Proxy so `from database import client` stays valid after init_db()
    swaps the underlying connection. It uses thread-local storage to provide
    thread-safe read-only connections and registers all open connections so
    they can be closed collectively to release the database file."""

    def __init__(self, db_path):
        self._db_path = db_path
        self._lock = threading.Lock()
        self._connections = []
        self._local = threading.local()
        self._enabled = True

    def _get_conn(self):
        with self._lock:
            if not self._enabled:
                raise RuntimeError("Database client is closed/disabled.")
            
            if hasattr(self._local, "conn") and self._local.conn is not None:
                return self._local.conn

            conn = duckdb.connect(str(self._db_path), read_only=True)
            self._local.conn = conn
            self._connections.append(conn)
            return conn

    def close(self):
        with self._lock:
            for conn in self._connections:
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()
            if hasattr(self._local, "conn"):
                self._local.conn = None

    def _replace(self, db_path):
        self.close()
        with self._lock:
            self._db_path = db_path
            self._enabled = (db_path is not None)

    def __getattr__(self, name):
        conn = self._get_conn()
        return getattr(conn, name)


if not DB_PATH.exists():
    duckdb.connect(str(DB_PATH)).close()
client = _ConnectionProxy(DB_PATH)


def init_db(keep_open: bool = True):
    """Initialize schema and optionally reopen the read-only client.

    The backend calls init_db() on startup with keep_open=True (default) so
    the shared client is ready for query handlers immediately.

    The ETL calls init_db(keep_open=False) so the file is released for the
    read-write connection it opens right after — DuckDB does not allow
    concurrent read-only and read-write connections to the same file.
    """
    client.close()
    try:
        _ensure_schema()
    except Exception as e:
        # In a multi-worker setup, concurrent workers race to open a read-write
        # connection for schema init. The losers get a lock error — that's fine,
        # the winner already created the tables. We still need to reopen
        # client below, so just swallow the error here.
        print(f"  Schema init skipped (concurrent worker): {e}")
    if keep_open:
        client._replace(DB_PATH)
    else:
        client._replace(None)
    return client if keep_open else None


def _seed_administrative_division(con) -> None:
    """Load the GUS hierarchy JSON into administrative_division on a fresh/migrated DB."""
    seed_path = Path(__file__).parent.parent / "data" / "geo" / "administrative_division_gus.json"
    if not seed_path.exists():
        print(f"[schema] seed file not found: {seed_path}")
        return
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    if not rows:
        return
    con.executemany(
        "INSERT INTO administrative_division "
        "(id, level, name, population, area_km2, avg_salary, unemployment_rate, voivodeship_id, powiat_id, gus_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            (r["id"], r["level"], r["name"], r.get("population"), r.get("area_km2"),
             r.get("avg_salary"), r.get("unemployment_rate"), r.get("voivodeship_id"),
             r.get("powiat_id"), r.get("gus_id"))
            for r in rows
        ]
    )
    print(f"[schema] seeded administrative_division with {len(rows)} rows")


def _migrate_parcel_lockers_pk(con):
    """One-time migration: rebuild parcel_lockers keyed on external_id.

    The old schema had a surrogate `id INTEGER PRIMARY KEY` and the load path
    could insert the same external_id many times (one full copy per ETL run),
    so prod ended up with ~10 duplicates of every locker. The table now mirrors
    locations: external_id is the PK, one row per locker, SCD2 via created_at /
    deleted_at. This collapses any duplicates to the freshest active row.
    Idempotent: a no-op once the table already has external_id as its PK.
    """
    exists = con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'parcel_lockers'"
    ).fetchone()[0]
    if not exists:
        return
    cols = [r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'parcel_lockers'"
    ).fetchall()]
    if "id" not in cols:
        return  # already migrated

    print("[migrate] rebuilding parcel_lockers with external_id as primary key (dedup)")
    con.execute("DROP TABLE IF EXISTS parcel_lockers_new")
    con.execute("""
        CREATE TABLE parcel_lockers_new (
            external_id VARCHAR PRIMARY KEY,
            source_date DATE,
            latitude DOUBLE,
            longitude DOUBLE,
            voivodeship_id INTEGER,
            powiat_id INTEGER,
            miasto_id INTEGER,
            gmina_id INTEGER,
            status VARCHAR,
            created_at TIMESTAMP,
            deleted_at TIMESTAMP
        )
    """)
    # Keep one row per external_id: prefer an active row, then the newest, then
    # the highest surrogate id as the final tie-break.
    con.execute("""
        INSERT INTO parcel_lockers_new
        SELECT external_id, source_date, latitude, longitude,
               voivodeship_id, powiat_id, miasto_id, gmina_id, status,
               created_at, deleted_at
        FROM (
            SELECT *, row_number() OVER (
                PARTITION BY external_id
                ORDER BY (deleted_at IS NULL) DESC, created_at DESC, id DESC
            ) AS rn
            FROM parcel_lockers
            WHERE external_id IS NOT NULL
        )
        WHERE rn = 1
    """)
    kept = con.execute("SELECT count(*) FROM parcel_lockers_new").fetchone()[0]
    con.execute("DROP TABLE parcel_lockers")
    con.execute("ALTER TABLE parcel_lockers_new RENAME TO parcel_lockers")
    print(f"[migrate] parcel_lockers rebuilt: {kept:,} unique lockers")


def ensure_extra_tables(con):
    """Tabela faktow paczkomatow (osobna encja, jak locations) + krotkie wymiary
    geograficzne (dim_powiat, dim_voivodeship). Z poziomu wymiarow pisze sie
    zapytania zestawiajace Żabki i paczkomaty (JOIN po powiat/voivodeship).
    Bezpieczne do wielokrotnego wywolania."""
    # parcel_lockers mirrors locations: external_id is the natural PK (one row per
    # physical locker, no surrogate int id). created_at = first-seen, never
    # overwritten on upsert; deleted_at = when the locker left the source.
    _migrate_parcel_lockers_pk(con)
    con.execute("""
        CREATE TABLE IF NOT EXISTS parcel_lockers (
            external_id VARCHAR PRIMARY KEY,
            source_date DATE,
            latitude DOUBLE,
            longitude DOUBLE,
            voivodeship_id INTEGER,
            powiat_id INTEGER,
            miasto_id INTEGER,
            gmina_id INTEGER,
            status VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP
        )
    """)
    # Zunifikowany slownik terytorialny (GUS BDL + GADM)
    con.execute("""
        CREATE TABLE IF NOT EXISTS administrative_division (
            id INTEGER PRIMARY KEY,
            level INTEGER NOT NULL,
            name VARCHAR NOT NULL,
            population INTEGER,
            area_km2 DOUBLE,
            avg_salary DOUBLE,
            unemployment_rate DOUBLE,
            voivodeship_id INTEGER,
            powiat_id INTEGER,
            gus_id VARCHAR,
            centroid_lon DOUBLE,
            centroid_lat DOUBLE
        )
    """)
    # Migracja kolumn na istniejacej bazie - musi wykonac sie przed utworzeniem
    # widoku dim_powiat ponizej, ktory je selectuje.
    con.execute("ALTER TABLE administrative_division ADD COLUMN IF NOT EXISTS centroid_lon DOUBLE")
    con.execute("ALTER TABLE administrative_division ADD COLUMN IF NOT EXISTS centroid_lat DOUBLE")

    # Wymiar parku/otuliny (GDOŚ) - locations wskazuje przez nature_park_id.
    con.execute("""
        CREATE TABLE IF NOT EXISTS dim_park (
            id INTEGER PRIMARY KEY,
            name VARCHAR,
            type VARCHAR
        )
    """)

    # Tabela ciekawych faktów (fun_facts)
    con.execute("""
        CREATE TABLE IF NOT EXISTS fun_facts (
            key VARCHAR PRIMARY KEY,
            lat DOUBLE,
            lon DOUBLE,
            value DOUBLE,
            computed_at TIMESTAMP
        )
    """)

    # Znacznik ostatniego udanego przebiegu ETL (jeden wiersz, key='last_run').
    # Osobno od `locations.created_at`, ktore trzyma date snapshotu zrodla
    # (godzina 00:00), a nie faktyczny czas wykonania joba.
    con.execute("""
        CREATE TABLE IF NOT EXISTS etl_meta (
            key VARCHAR PRIMARY KEY,
            updated_at TIMESTAMP
        )
    """)

    # Seed on a fresh or migrated DB that is missing the hierarchy data.
    if con.execute("SELECT COUNT(*) FROM administrative_division").fetchone()[0] == 0:
        _seed_administrative_division(con)

    # Drop any old physical dim tables before recreating them as views.
    for tbl in ("dim_voivodeship", "dim_powiat", "dim_gmina", "dim_miasto", "dim_city"):
        try:
            con.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")
        except Exception:
            pass

    # Views backed by administrative_division.
    con.execute("DROP VIEW IF EXISTS dim_voivodeship")
    con.execute("""
        CREATE VIEW dim_voivodeship AS
        SELECT id, name, population, area_km2
        FROM administrative_division
        WHERE level = 1
    """)

    con.execute("DROP VIEW IF EXISTS dim_powiat")
    con.execute("""
        CREATE VIEW dim_powiat AS
        SELECT id, name, voivodeship_id, population, avg_salary, unemployment_rate, area_km2,
               centroid_lon, centroid_lat
        FROM administrative_division
        WHERE level = 2
    """)

    con.execute("DROP VIEW IF EXISTS dim_city")
    con.execute("""
        CREATE VIEW dim_city AS
        SELECT id, name, voivodeship_id, powiat_id, population, area_km2
        FROM administrative_division
        WHERE level = 4
    """)

    con.execute("DROP VIEW IF EXISTS dim_gmina")
    con.execute("""
        CREATE VIEW dim_gmina AS
        SELECT id, name, voivodeship_id, powiat_id, population, area_km2
        FROM administrative_division
        WHERE level = 3
    """)

    # Effective-population views for per-capita density. dim_powiat / dim_voivodeship
    # populations are land-only GUS figures and exclude the 66 cities with powiat
    # rights (TERYT kind >= 61), yet those cities' stores DO count against their host
    # land powiat - so raw stores/population inflates density ~10x (Warszawa's stores
    # land on powiat warszawski zachodni, pop 137k, not its own 1.87M). These views
    # add each host's cities-with-powiat-rights population back, in ONE place, so every
    # per-capita query joins the view instead of repeating the correction. The base
    # dimension columns stay land-only (clean, sourced, and safe for the downloadable DB).
    con.execute("DROP VIEW IF EXISTS v_powiat_pop_eff")
    con.execute("""
        CREATE VIEW v_powiat_pop_eff AS
        SELECT dp.id AS powiat_id,
               dp.population + COALESCE(cr.addpop, 0) AS population
        FROM dim_powiat dp
        LEFT JOIN (
            SELECT dc.powiat_id AS pid, SUM(dc.population) AS addpop
            FROM dim_city dc
            JOIN administrative_division ad
              ON ad.id = dc.id AND ad.level = 4 AND SUBSTR(ad.gus_id, 8, 2) >= '61'
            GROUP BY dc.powiat_id
        ) cr ON cr.pid = dp.id
    """)

    con.execute("DROP VIEW IF EXISTS v_voiv_pop_eff")
    con.execute("""
        CREATE VIEW v_voiv_pop_eff AS
        SELECT dv.id AS voivodeship_id,
               dv.population + COALESCE(cr.addpop, 0) AS population
        FROM dim_voivodeship dv
        LEFT JOIN (
            SELECT dc.voivodeship_id AS vid, SUM(dc.population) AS addpop
            FROM dim_city dc
            JOIN administrative_division ad
              ON ad.id = dc.id AND ad.level = 4 AND SUBSTR(ad.gus_id, 8, 2) >= '61'
            GROUP BY dc.voivodeship_id
        ) cr ON cr.vid = dv.id
    """)

    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_lockers_voiv_id ON parcel_lockers(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_powiat_id ON parcel_lockers(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_miasto_id ON parcel_lockers(miasto_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_gmina_id ON parcel_lockers(gmina_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_voiv_id ON locations(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_powiat_id ON locations(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_miasto_id ON locations(miasto_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_gmina_id ON locations(gmina_id)",
        "CREATE INDEX IF NOT EXISTS idx_admin_division_level ON administrative_division(level)",
        "CREATE INDEX IF NOT EXISTS idx_admin_division_voiv ON administrative_division(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_admin_division_powiat ON administrative_division(powiat_id)",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass


# Kolumny dodane przez pipeline wzbogacenia (zabytki, wysokosc, parki, ekonomia, sasiedztwo).
# Bez DEFAULT w ALTER: replay WAL dla 'ADD COLUMN ... DEFAULT' wywala sie w DuckDB
# (binding domyslnej wartosci przy odtwarzaniu). ETL i tak ustawia kazda wartosc jawnie.
ENRICHMENT_COLUMNS = [
    ("elevation_meters", "DOUBLE"),
    ("is_in_nature_park", "BOOLEAN"),
    ("nature_park_id", "INTEGER"),
    ("voivodeship_id", "INTEGER"),
    ("powiat_id", "INTEGER"),
    ("miasto_id", "INTEGER"),
    ("gmina_id", "INTEGER"),
    ("nearest_neighbor_distance_meters", "INTEGER"),
    ("amphibian_occurrences_5km", "INTEGER"),
    ("nearest_amphibian_km", "DOUBLE"),
    ("h3_index_9", "VARCHAR"),
]


def ensure_enrichment_columns(con):
    """Zapewnia obecnosc kolumn wzbogacenia. Bezpieczne do wielokrotnego wywolania."""
    for name, decl in ENRICHMENT_COLUMNS:
        con.execute(f"ALTER TABLE locations ADD COLUMN IF NOT EXISTS {name} {decl}")

    con.execute("ALTER TABLE administrative_division ADD COLUMN IF NOT EXISTS gus_id VARCHAR")

    # Remove old fake-data columns (light pollution was derived from neighbor distance,
    # never real measured data). voivodeship/powiat/street are kept — API depends on them.
    for col in ("light_pollution_brightness", "bortle_scale"):
        try:
            con.execute(f"ALTER TABLE locations DROP COLUMN IF EXISTS {col}")
        except Exception:
            pass

    for name, decl in [
        ("voivodeship_id", "INTEGER"),
        ("powiat_id", "INTEGER"),
        ("miasto_id", "INTEGER"),
        ("gmina_id", "INTEGER"),
        ("external_id", "VARCHAR"),
        ("deleted_at", "TIMESTAMP")
    ]:
        try:
            con.execute(f"ALTER TABLE parcel_lockers ADD COLUMN IF NOT EXISTS {name} {decl}")
        except Exception:
            pass

def get_client():
    """Get DuckDB connection."""
    return client
