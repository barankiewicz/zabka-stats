"""
DuckDB database connection and initialization.
Ultra-fast analytics database - 100x faster than SQLite!
"""

import duckdb
from pathlib import Path

# Database path
DB_PATH = Path(__file__).parent.parent / "data" / "zabka.duckdb"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Global connection (DuckDB is thread-safe)
client = duckdb.connect(str(DB_PATH))

def init_db():
    """Initialize DuckDB schema if needed."""

    # Check if tables exist
    tables = client.execute("SELECT table_name FROM information_schema.tables").fetchall()
    table_names = [t[0] for t in tables]

    if 'snapshots' not in table_names:
        print(" Creating DuckDB schema...")

        # Create sequences first
        try:
            client.execute("CREATE SEQUENCE seq_snapshots START 1")
        except:
            pass
        try:
            client.execute("CREATE SEQUENCE seq_locations START 1")
        except:
            pass
        try:
            client.execute("CREATE SEQUENCE seq_histories START 1")
        except:
            pass

        # Snapshots table
        client.execute("""
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

        # Locations table - czysty model analityczny.
        # Wyrzucone smieci ze zrodla: name/country (stale), active (stala),
        # salesZone* (PII), locationId/townId/salesZoneId (wewnetrzne id),
        # storeUrl/relativeStoreUrl (marketing). Zachowane tylko pola do analizy.
        client.execute("""
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
                postcode VARCHAR,
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

        # History table (immutable audit log)
        client.execute("""
            CREATE TABLE histories (
                id INTEGER PRIMARY KEY DEFAULT nextval('seq_histories'),
                location_id INTEGER NOT NULL,
                snapshot_id INTEGER,
                change_type VARCHAR NOT NULL,
                field_changed VARCHAR,
                old_value VARCHAR,
                new_value VARCHAR,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (location_id) REFERENCES locations(id),
                FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
            )
        """)

        # Create indexes for performance
        client.execute("CREATE INDEX idx_locations_snapshot_id ON locations(snapshot_id)")
        client.execute("CREATE INDEX idx_locations_city ON locations(city)")
        client.execute("CREATE INDEX idx_locations_voivodeship ON locations(voivodeship)")
        client.execute("CREATE INDEX idx_locations_powiat ON locations(powiat)")
        client.execute("CREATE INDEX idx_locations_deleted_at ON locations(deleted_at)")
        client.execute("CREATE INDEX idx_locations_store_id ON locations(store_id)")
        client.execute("CREATE INDEX idx_histories_location_id ON histories(location_id)")
        client.execute("CREATE INDEX idx_histories_snapshot_id ON histories(snapshot_id)")
        client.execute("CREATE INDEX idx_snapshots_source_date ON snapshots(source_date)")

        print(" DuckDB schema created!")

    # Migracja kolumn wzbogacenia geograficznego (ENRICHMENT.md) dla istniejacych baz.
    # ADD COLUMN IF NOT EXISTS jest idempotentne, wiec mozna wolac przy kazdym starcie.
    ensure_enrichment_columns(client)
    # Tabela faktow paczkomatow + wymiary geograficzne (model gwiazdy do zestawien).
    ensure_extra_tables(client)

    return client


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
