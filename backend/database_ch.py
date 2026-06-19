"""
DuckDB database connection and initialization.
Ultra-fast analytics database - 100x faster than SQLite!
"""

import duckdb
from pathlib import Path

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

    if 'snapshots' not in table_names:
        print("Creating DuckDB schema...")

        for seq in ("seq_snapshots", "seq_locations", "seq_histories"):
            try:
                con.execute(f"CREATE SEQUENCE {seq} START 1")
            except Exception:
                pass

        con.execute("""
            CREATE TABLE snapshots (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_snapshots'),
                source_date DATE UNIQUE NOT NULL,
                total_count INTEGER,
                visible_count INTEGER,
                with_merrychef INTEGER,
                open_sunday INTEGER,
                h24 INTEGER,
                towns INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Czysty model analityczny — PII, stale pola i wewnetrzne id wyrzucone.
        con.execute("""
            CREATE TABLE locations (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_locations'),
                snapshot_id INTEGER NOT NULL,
                store_id VARCHAR,
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
                gios_station_id INTEGER,
                gios_distance_km DOUBLE,
                elevation_meters DOUBLE,
                light_pollution_brightness DOUBLE,
                bortle_scale INTEGER,
                is_in_nature_park BOOLEAN DEFAULT FALSE,
                nature_park_id INTEGER,
                nearest_neighbor_distance_meters INTEGER,
                amphibian_occurrences_5km INTEGER,
                nearest_amphibian_km DOUBLE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP,
                FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
            )
        """)

        # Bez FK — retencja kasuje stare snapshoty/lokalizacje, a wymuszony FK
        # by sie na tym wywalal. source_date + store_id zdenormalizowane.
        con.execute("""
            CREATE TABLE histories (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_histories'),
                location_id INTEGER,
                snapshot_id INTEGER,
                source_date DATE,
                store_id VARCHAR,
                change_type VARCHAR NOT NULL,
                field_changed VARCHAR,
                old_value VARCHAR,
                new_value VARCHAR,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        for stmt in (
            "CREATE INDEX idx_locations_snapshot_id ON locations(snapshot_id)",
            "CREATE INDEX idx_locations_city ON locations(city)",
            "CREATE INDEX idx_locations_voivodeship ON locations(voivodeship)",
            "CREATE INDEX idx_locations_powiat ON locations(powiat)",
            "CREATE INDEX idx_locations_deleted_at ON locations(deleted_at)",
            "CREATE INDEX idx_locations_store_id ON locations(store_id)",
            "CREATE INDEX idx_histories_location_id ON histories(location_id)",
            "CREATE INDEX idx_histories_snapshot_id ON histories(snapshot_id)",
            "CREATE INDEX idx_histories_source_date ON histories(source_date)",
            "CREATE INDEX idx_histories_change_type ON histories(change_type)",
            "CREATE INDEX idx_snapshots_source_date ON snapshots(source_date)",
        ):
            con.execute(stmt)

        print("DuckDB schema created.")

    # Idempotentne migracje — bezpieczne przy kazdym wywolaniu.
    ensure_enrichment_columns(con)
    ensure_extra_tables(con)


def _ensure_schema():
    """Run all DDL via a temporary read-write connection, then close it."""
    rw = duckdb.connect(str(DB_PATH))
    try:
        _run_all_ddl(rw)
    finally:
        rw.close()


class _ConnectionProxy:
    """Proxy so `from database_ch import client` stays valid after init_db()
    swaps the underlying connection. Without this, all module-level imports
    of `client` hold a stale reference to the connection that init_db() closed."""

    def __init__(self, conn=None):
        self._conn = conn

    def _replace(self, conn):
        self._conn = conn

    def close(self):
        if self._conn is not None:
            self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


# Read-only connection shared across all API request handlers.
# DuckDB allows multiple concurrent read-only connections to the same file.
# The ETL cron stops the backend service before opening its own read-write
# connection, so there is no write/read conflict in production.
client = _ConnectionProxy(duckdb.connect(str(DB_PATH), read_only=True))


def init_db(keep_open: bool = True):
    """Initialize schema and optionally reopen the read-only client.

    The backend calls init_db() on startup with keep_open=True (default) so
    the shared client is ready for query handlers immediately.

    The ETL calls init_db(keep_open=False) so the file is released for the
    read-write connection it opens right after — DuckDB does not allow
    concurrent read-only and read-write connections to the same file.
    """
    client.close()
    _ensure_schema()
    if keep_open:
        client._replace(duckdb.connect(str(DB_PATH), read_only=True))
    else:
        client._replace(None)
    return client if keep_open else None


def ensure_extra_tables(con):
    """Tabela faktow paczkomatow (osobna encja, jak locations) + krotkie wymiary
    geograficzne (dim_powiat, dim_voivodeship). Z poziomu wymiarow pisze sie
    zapytania zestawiajace Żabki i paczkomaty (JOIN po powiat/voivodeship).
    Bezpieczne do wielokrotnego wywolania."""
    # Fakty: paczkomaty (InPost). Stan najnowszy (replace), bez ciezkich wzbogacen
    # - tylko geografia (miasto z adresu, woj/powiat przez point-in-polygon).
    con.execute("""
        CREATE TABLE IF NOT EXISTS parcel_lockers (
            id INTEGER PRIMARY KEY,
            snapshot_id INTEGER,
            source_date DATE,
            operator VARCHAR,
            external_id VARCHAR,
            type VARCHAR,
            city VARCHAR,
            voivodeship VARCHAR,
            powiat VARCHAR,
            voivodeship_id INTEGER,
            powiat_id INTEGER,
            latitude DOUBLE,
            longitude DOUBLE,
            status VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Wymiar powiatu: jedyne miejsce ekonomii GUS (znormalizowane z locations).
    # Klucz numeryczny (id); nazwa powiatu nie jest unikalna miedzy wojewodztwami
    # (np. "powiat grodziski"), wiec fakty lacza sie po powiat_id, nie po nazwie.
    con.execute("""
        CREATE TABLE IF NOT EXISTS dim_powiat (
            id INTEGER PRIMARY KEY,
            name VARCHAR,
            voivodeship_id INTEGER,
            population INTEGER,
            avg_salary DOUBLE,
            unemployment_rate DOUBLE
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS dim_voivodeship (
            id INTEGER PRIMARY KEY,
            name VARCHAR,
            population INTEGER
        )
    """)
    # Wymiar stacji pomiarowej GIOŚ - locations wskazuje na nia przez gios_station_id.
    con.execute("""
        CREATE TABLE IF NOT EXISTS dim_gios_station (
            id INTEGER PRIMARY KEY,
            name VARCHAR,
            latitude DOUBLE,
            longitude DOUBLE
        )
    """)
    # Wymiar parku/otuliny (GDOŚ) - locations wskazuje przez nature_park_id.
    con.execute("""
        CREATE TABLE IF NOT EXISTS dim_park (
            id INTEGER PRIMARY KEY,
            name VARCHAR,
            type VARCHAR
        )
    """)
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_lockers_voiv_id ON parcel_lockers(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_powiat_id ON parcel_lockers(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_operator ON parcel_lockers(operator)",
        "CREATE INDEX IF NOT EXISTS idx_dim_powiat_voiv_id ON dim_powiat(voivodeship_id)",
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
    ("light_pollution_brightness", "DOUBLE"),
    ("bortle_scale", "INTEGER"),
    ("is_in_nature_park", "BOOLEAN"),
    ("nature_park_id", "INTEGER"),
    ("voivodeship_id", "INTEGER"),
    ("powiat_id", "INTEGER"),
    ("nearest_neighbor_distance_meters", "INTEGER"),
    ("amphibian_occurrences_5km", "INTEGER"),
    ("nearest_amphibian_km", "DOUBLE"),
]


def ensure_enrichment_columns(con):
    """Dodaj brakujace kolumny wzbogacenia do tabeli locations. Bezpieczne do wielokrotnego wywolania."""
    for name, decl in ENRICHMENT_COLUMNS:
        con.execute(f"ALTER TABLE locations ADD COLUMN IF NOT EXISTS {name} {decl}")

def get_client():
    """Get DuckDB connection."""
    return client
