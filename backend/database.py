"""
DuckDB database connection and initialization.
"""

import json
import logging
import os
import threading
from pathlib import Path

import duckdb

logger = logging.getLogger("database")

# Database path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = os.getenv("ZABKA_DB")
if DB_PATH:
    p = Path(DB_PATH)
    if not p.is_absolute():
        DB_PATH = (PROJECT_ROOT / p).resolve()
    else:
        DB_PATH = p.resolve()
else:
    DB_PATH = (PROJECT_ROOT / "data" / "zabka.duckdb").resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _ensure_dim_date(con: duckdb.DuckDBPyConnection) -> None:
    """Ensure dim_date table exists and is seeded from 1998 to 2030."""
    tables = [t[0] for t in con.execute("SELECT table_name FROM information_schema.tables").fetchall()]
    if 'dim_date' not in tables:
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
    
    # Check if we need to seed or expand
    res = con.execute("SELECT MIN(date_actual) FROM dim_date").fetchone()
    import datetime
    seed_needed = True
    if res and res[0]:
        val = res[0]
        if isinstance(val, str):
            try:
                val = datetime.date.fromisoformat(val[:10])
            except Exception:
                val = None
        if val and val <= datetime.date(1998, 1, 1):
            seed_needed = False

    if seed_needed:
        logger.info("Seeding dim_date table back to 1998...")
        con.execute("TRUNCATE TABLE dim_date")
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
            FROM generate_series(DATE '1998-01-01', DATE '2030-12-31', INTERVAL '1 day') AS t(d)
        """)


def _run_all_ddl(con: duckdb.DuckDBPyConnection) -> None:
    """All DDL: schema creation + migrations. Requires a read-write connection.

    Idempotent - safe to call on every startup. ETL also calls this directly
    before loading data, so the backend never needs to create tables itself
    in production. The function is here as a fallback for local dev.
    """
    tables = con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    table_names = [t[0] for t in tables]

    if 'locations' not in table_names:
        logger.info("Creating DuckDB schema...")

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP
            )
        """)

        # dim_date table and seeding
        _ensure_dim_date(con)

        for stmt in (
            "CREATE INDEX idx_locations_city ON locations(city)",
            "CREATE INDEX idx_locations_voivodeship ON locations(voivodeship)",
            "CREATE INDEX idx_locations_powiat ON locations(powiat)",
            "CREATE INDEX idx_locations_deleted_at ON locations(deleted_at)",
            "CREATE INDEX idx_locations_created_at ON locations(created_at)",
            "CREATE INDEX idx_locations_voivodeship_id ON locations(voivodeship_id)",
            "CREATE INDEX idx_locations_powiat_id ON locations(powiat_id)",
        ):
            con.execute(stmt)

        logger.info("DuckDB schema created.")

    # Idempotentne migracje - bezpieczne przy kazdym wywolaniu.
    ensure_extra_tables(con)
    ensure_enrichment_columns(con)
    _migrate_locations_pk_if_needed(con)


def _migrate_locations_pk_if_needed(con: duckdb.DuckDBPyConnection) -> None:
    """Migrate the locations table if it has the old integer id PK.
    Preserves all data and history during the migration."""
    cols = {r[1] for r in con.execute("PRAGMA table_info('locations')").fetchall()}
    if 'id' not in cols:
        return
    logger.info("[migrate] locations has old integer id PK - migrating schema and preserving data")
    con.execute("ALTER TABLE locations RENAME TO locations_old")
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
            gmina_id INTEGER, miasto_id INTEGER,
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
        except Exception as e:
            logger.debug(f"Failed to create index {stmt}: {e}")

    try:
        common_cols = cols - {'id'}
        cols_str = ", ".join(common_cols)
        con.execute(f"INSERT INTO locations ({cols_str}) SELECT {cols_str} FROM locations_old")
        con.execute("DROP TABLE locations_old")
        logger.info("[migrate] done - locations rebuilt with store_id as primary key, data preserved")
    except Exception as e:
        logger.error(f"[migrate] error copying data: {e}")
        try:
            con.execute("DROP TABLE locations")
            con.execute("ALTER TABLE locations_old RENAME TO locations")
        except Exception as e2:
            logger.debug(f"Failed to rollback migration: {e2}")
        raise e


def _ensure_schema() -> None:
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

    def __init__(self, db_path: Path | str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._connections = []
        self._local = threading.local()
        self._enabled = True
        self._generation = 0

    def _get_conn(self) -> duckdb.DuckDBPyConnection:
        with self._lock:
            if not self._enabled:
                raise RuntimeError("Database client is closed/disabled.")
            
            if hasattr(self._local, "conn_info"):
                conn, gen = self._local.conn_info
                if gen == self._generation:
                    return conn
                else:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    self._local.conn_info = None

            conn = duckdb.connect(str(self._db_path), read_only=True)
            self._local.conn_info = (conn, self._generation)
            self._connections.append(conn)
            return conn

    def close(self) -> None:
        with self._lock:
            self._generation += 1
            for conn in self._connections:
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()
            if hasattr(self._local, "conn_info"):
                self._local.conn_info = None

    def _replace(self, db_path: Path | str | None) -> None:
        self.close()
        with self._lock:
            self._db_path = db_path
            self._enabled = (db_path is not None)

    def __getattr__(self, name: str) -> any:
        conn = self._get_conn()
        return getattr(conn, name)


if not DB_PATH.exists():
    duckdb.connect(str(DB_PATH)).close()
client = _ConnectionProxy(DB_PATH)


def init_db(keep_open: bool = True) -> _ConnectionProxy | None:
    """Initialize schema and optionally reopen the read-only client.

    The backend calls init_db() on startup with keep_open=True (default) so
    the shared client is ready for query handlers immediately.

    The ETL calls init_db(keep_open=False) so the file is released for the
    read-write connection it opens right after - DuckDB does not allow
    concurrent read-only and read-write connections to the same file.
    """
    client.close()
    try:
        _ensure_schema()
    except Exception as e:
        # In a multi-worker setup, concurrent workers race to open a read-write
        # connection for schema init. The losers get a lock error - that's fine,
        # the winner already created the tables. We still need to reopen
        # client below, so just swallow the error here.
        logger.warning(f"Schema init skipped (concurrent worker): {e}")
    if keep_open:
        client._replace(DB_PATH)
    else:
        client._replace(None)
    return client if keep_open else None


def _seed_administrative_division(con: duckdb.DuckDBPyConnection) -> None:
    """Load the GUS hierarchy JSON into administrative_division on a fresh/migrated DB."""
    seed_path = Path(__file__).parent.parent / "data" / "geo" / "administrative_division_gus.json"
    if not seed_path.exists():
        logger.warning(f"[schema] seed file not found: {seed_path}")
        return
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    if not rows:
        logger.warning(f"[schema] seed file is empty: {seed_path}")
        return
    con.executemany(
        "INSERT INTO administrative_division "
        "(id, level, name, population, area_km2, avg_salary, unemployment_rate, voivodeship_id, powiat_id, gus_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            (r["id"], r["level"], r["name"],
             r.get("population"), r.get("area_km2"),
             r.get("avg_salary"), r.get("unemployment_rate"), r.get("voivodeship_id"),
             r.get("powiat_id"), r.get("gus_id"))
            for r in rows
        ]
    )
    logger.info(f"[schema] seeded administrative_division with {len(rows)} rows")


def _migrate_parcel_lockers_pk(con: duckdb.DuckDBPyConnection) -> None:
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

    logger.info("[migrate] rebuilding parcel_lockers with external_id as primary key (dedup)")
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
    logger.info(f"[migrate] parcel_lockers rebuilt: {kept:,} unique lockers")


def _ensure_teryt_tables(con: duckdb.DuckDBPyConnection) -> None:
    """Ensure extra tables exist for the parcel lockers entity and GUS hierarchies."""
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
    # Migracja kolumn na istniejacej bazie
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
    con.execute("""
        CREATE TABLE IF NOT EXISTS etl_meta (
            key VARCHAR PRIMARY KEY,
            updated_at TIMESTAMP
        )
    """)

    # Seed on a fresh or migrated DB that is missing the hierarchy data.
    if con.execute("SELECT COUNT(*) FROM administrative_division").fetchone()[0] == 0:
        _seed_administrative_division(con)


def _ensure_teryt_views(con: duckdb.DuckDBPyConnection) -> None:
    """Recreate teryt and effective population views."""
    # Drop any old physical dim tables before recreating them as views.
    for tbl in ("dim_voivodeship", "dim_powiat", "dim_gmina", "dim_miasto", "dim_city"):
        try:
            con.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")
        except Exception as e:
            logger.debug(f"Failed to drop old table/view {tbl}: {e}")

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

    # Level-4 cities with powiat rights (gus_id pow_code >= '61'). A store whose
    # miasto_id lands here belongs to that CITY (shown in the MIASTA dimension),
    # NOT to the surrounding land powiat - so powiat-level per-capita queries
    # exclude such stores via `NOT EXISTS (SELECT 1 FROM v_city_powiat_miasta c
    # WHERE c.id = l.miasto_id)` and divide by dim_powiat.population directly.
    con.execute("DROP VIEW IF EXISTS v_city_powiat_miasta")
    con.execute("""
        CREATE VIEW v_city_powiat_miasta AS
        SELECT id FROM administrative_division
        WHERE level = 4 AND SUBSTR(gus_id, 8, 2) >= '61'
    """)

    # Effective-population view for VOIVODESHIP-level per-capita only. A
    # voivodeship genuinely contains its cities, so their populations must be
    # folded into the denominator (dim_voivodeship.population excludes them).
    # NB: there is intentionally NO powiat-level equivalent - at the powiat
    # level a city with powiat rights is a separate unit, so land-powiat
    # density uses dim_powiat.population alone (see v_city_powiat_miasta).
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


def _ensure_teryt_indexes(con: duckdb.DuckDBPyConnection) -> None:
    """Ensure DDL indexes exist on location and locker tables."""
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
        except Exception as e:
            logger.debug(f"Index creation skipped/failed: {stmt} ({e})")


def ensure_extra_tables(con: duckdb.DuckDBPyConnection) -> None:
    """Tabela faktow paczkomatow (osobna encja, jak locations) + krotkie wymiary
    geograficzne (dim_powiat, dim_voivodeship). Z poziomu wymiarow pisze sie
    zapytania zestawiajace Żabki i paczkomaty (JOIN po powiat/voivodeship).
    Bezpieczne do wielokrotnego wywolania."""
    _ensure_dim_date(con)
    _migrate_parcel_lockers_pk(con)
    _ensure_teryt_tables(con)
    _ensure_teryt_views(con)
    _disambiguate_duplicate_powiaty(con)
    _ensure_teryt_indexes(con)


# Voivodeship (canonical uppercase, matches GUS) -> display suffix appended to
# powiat names that collide across voivodeships (e.g. "Powiat grodziski (maz.)"
# vs "(wlkp.)"). Only covers voivodeships that participate in a name collision.
VOIV_ABBR = {
    "MAŁOPOLSKIE":  "małop.",
    "ŚLĄSKIE":      "śl.",
    "PODLASKIE":    "podl.",
    "MAZOWIECKIE":  "maz.",
    "WIELKOPOLSKIE": "wlkp.",
    "OPOLSKIE":     "op.",
    "LUBUSKIE":     "lub.",
    "PODKARPACKIE": "podk.",
    "POMORSKIE":    "pom.",
    "LUBELSKIE":    "lubel.",
    "ŁÓDZKIE":      "łódz.",
    "DOLNOŚLĄSKIE": "doln.",
}


def _disambiguate_duplicate_powiaty(con: duckdb.DuckDBPyConnection) -> None:
    """Append "(skrot)" to powiat names duplicated across voivodeships.

    10 GUS powiat names exist in more than one voivodeship (bielski, brzeski,
    grodziski, krośnieński, nowodworski, opolski, ostrowski, tomaszowski,
    średzki, świdnicki). Without a suffix the GRAN bar and economics choropleth
    show two indistinguishable rows. The suffix is computed from the voivodeship
    via VOIV_ABBR. Idempotent: rows already containing a parenthesised suffix
    are skipped, so re-runs are no-ops. Voivodeship lookup is case-insensitive
    because the seed lowercases names while ETL (prod) stores them UPPERCASE.
    """
    if not VOIV_ABBR:
        return
    # Build a VALUES list from VOIV_ABBR (keys in canonical uppercase).
    values_sql = ", ".join(f"('{k}', '{v}')" for k, v in VOIV_ABBR.items())
    con.execute(f"""
        UPDATE administrative_division AS ad
        SET name = ad.name || ' (' || vmap.abbr || ')'
        FROM (VALUES {values_sql}) AS vmap(voiv_name, abbr)
        WHERE ad.level = 2
          AND ad.voivodeship_id IN (SELECT id FROM dim_voivodeship
                                    WHERE lower(name) = lower(vmap.voiv_name))
          AND lower(ad.name) IN (
              SELECT lower(name) FROM administrative_division
              WHERE level = 2
              GROUP BY lower(name)
              HAVING COUNT(DISTINCT voivodeship_id) > 1
          )
          AND ad.name NOT LIKE '%(%'
    """)
    logger.info("[disambig] duplicate powiat names suffixed (idempotent)")


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
]


def ensure_enrichment_columns(con: duckdb.DuckDBPyConnection) -> None:
    """Zapewnia obecnosc kolumn wzbogacenia. Bezpieczne do wielokrotnego wywolania."""
    for name, decl in ENRICHMENT_COLUMNS:
        con.execute(f"ALTER TABLE locations ADD COLUMN IF NOT EXISTS {name} {decl}")

    con.execute("ALTER TABLE administrative_division ADD COLUMN IF NOT EXISTS gus_id VARCHAR")

    # Remove old fake-data columns (light pollution was derived from neighbor distance,
    # never real measured data). voivodeship/powiat/street are kept - API depends on them.
    for col in ("light_pollution_brightness", "bortle_scale"):
        try:
            con.execute(f"ALTER TABLE locations DROP COLUMN IF EXISTS {col}")
        except Exception as e:
            logger.debug(f"Failed to drop old column {col}: {e}")

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
        except Exception as e:
            logger.debug(f"Failed to add column {name} to parcel_lockers: {e}")


def get_client() -> _ConnectionProxy:
    """Get DuckDB connection."""
    return client


def build_where_clause(clauses: list[str], prefix: str = "") -> str:
    """Helper to join where clauses with AND and optionally prefix it."""
    if not clauses:
        return ""
    joined = " AND ".join(clauses)
    return f"{prefix} {joined}".strip() if prefix else joined
