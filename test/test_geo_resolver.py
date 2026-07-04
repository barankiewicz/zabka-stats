# Unit tests for backend.etl.geo_resolver.py.
# Emojis are strictly forbidden in this project.

import pytest
import duckdb
import json
from unittest.mock import patch, MagicMock
from backend.etl.geo_resolver import GugikGeoResolver

@pytest.fixture
def db_conn():
    con = duckdb.connect(":memory:")
    con.execute("""
        CREATE TABLE administrative_division (
            id INTEGER PRIMARY KEY,
            level INTEGER,
            name VARCHAR,
            voivodeship_id INTEGER,
            powiat_id INTEGER,
            gus_id VARCHAR,
            area_km2 DOUBLE,
            centroid_lon DOUBLE,
            centroid_lat DOUBLE
        )
    """)
    # Level 1 Voivodeship
    con.execute("INSERT INTO administrative_division VALUES (1, 1, 'Mazowieckie', NULL, NULL, '1400000', 35559.0, 21.0, 52.0)")
    # Level 2 Powiat
    con.execute("INSERT INTO administrative_division VALUES (2, 2, 'powiat Warszawa', 1, NULL, '1465000', 517.0, 21.01, 52.23)")
    # Level 3 Gmina
    con.execute("INSERT INTO administrative_division VALUES (3, 3, 'Warszawa', 1, 2, '1465011', 517.0, 21.01, 52.23)")
    # Level 4 City
    con.execute("INSERT INTO administrative_division VALUES (4, 4, 'Warszawa', 1, 2, '1465011', 517.0, 21.01, 52.23)")
    yield con
    con.close()

def test_helpers():
    assert GugikGeoResolver.clean_powiat_name("Powiat m. st. Warszawa") == "warszawa"
    assert GugikGeoResolver.clean_powiat_name("Powiat m. Kraków") == "kraków"
    assert GugikGeoResolver.clean_powiat_name(None) == ""
    
    assert GugikGeoResolver.normalize_city_name("Gorzów Wlkp.") == "Gorzów Wielkopolski"
    assert GugikGeoResolver.normalize_city_name("Stargard Szczeciński") == "Stargard"
    assert GugikGeoResolver.normalize_city_name(None) == ""

@patch("builtins.open", new_callable=pytest.importorskip("unittest.mock").mock_open, read_data="{}")
@patch("os.path.exists")
def test_cache_load_save(mock_exists, mock_open, db_conn):
    mock_exists.return_value = True
    resolver = GugikGeoResolver(db_conn, "./dummy_cache.json")
    assert resolver.gugik_cache == {}
    
    resolver.cache_dirty = True
    resolver._save_cache()
    mock_open.assert_called_with(resolver.cache_path, "w", encoding="utf-8")

@patch("requests.get")
def test_resolve_facts(mock_get, db_conn):
    resolver = GugikGeoResolver(db_conn, "./dummy_cache.json")
    
    # Mock successful GUGiK response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {
                "voivodeship": "Mazowieckie",
                "county": "powiat Warszawa",
                "commune": "Warszawa",
                "teryt": "1465011",
                "x": "21.01",
                "y": "52.23"
            }
        ]
    }
    mock_get.return_value = mock_response
    
    facts = [
        {"city": "Warszawa", "latitude": 52.23, "longitude": 21.01}
    ]
    
    resolver.resolve_facts(facts)
    assert facts[0]["voivodeship_id"] == 1
    assert facts[0]["powiat_id"] == 2
    assert facts[0]["gmina_id"] == 3
    assert facts[0]["miasto_id"] == 4
    assert facts[0]["voivodeship"] == "Mazowieckie"
    assert facts[0]["powiat"] == "powiat Warszawa"

def test_resolve_facts_spatial_fallback(db_conn):
    resolver = GugikGeoResolver(db_conn, "./dummy_cache.json")

    # Pre-populate cache so resolver doesn't hit HTTP
    resolver.gugik_cache = {
        "warszawa": [
            {
                "voivodeship": "Mazowieckie",
                "county": "powiat Warszawa",
                "commune": "Warszawa",
                "teryt": "1465011",
                "x": "21.01",
                "y": "52.23"
            }
        ],
        "inny": [] # Will force empty/no candidates
    }

    facts = [
        {"city": "Warszawa", "latitude": 52.23, "longitude": 21.01}, # Resolved
        {"city": "Inny", "latitude": 52.24, "longitude": 21.02} # Not resolved -> will fallback
    ]

    resolver.resolve_facts(facts)

    # Verify the fallback applied properties of the closest resolved neighbor
    assert facts[1]["voivodeship_id"] == 1
    assert facts[1]["powiat_id"] == 2
    assert facts[1]["gmina_id"] == 3
    assert facts[1]["miasto_id"] == 4
    assert facts[1]["voivodeship"] == "Mazowieckie"
    assert facts[1]["powiat"] == "powiat Warszawa"


@patch("builtins.open", new_callable=pytest.importorskip("unittest.mock").mock_open, read_data="{}")
@patch("os.path.exists")
def test_resolve_facts_rewires_known_gugik_miss(mock_exists, mock_open, db_conn):
    # Simulate the Duszniki-Zdroj case: a city whose name in the Zabka source
    # ('Duszniki Zdroj', with a space) GUGiK refuses to resolve, so the
    # spatial fallback would otherwise park it on the neighbouring Szczytna
    # gmina. The KNOWN_MISS_FIXES whitelist re-wires it to the right
    # gmina/city regardless of what the spatial fallback did.
    con = db_conn
    con.execute("INSERT INTO administrative_division VALUES (5, 1, 'Dolnoslaskie', NULL, NULL, '0200000', 19947.0, 16.0, 50.5)")
    con.execute("INSERT INTO administrative_division VALUES (6, 2, 'powiat klodzki', 5, NULL, '0208000', 1641.0, 16.4, 50.4)")
    con.execute("INSERT INTO administrative_division VALUES (7, 3, 'Szczytna', 5, 6, '0208143', 100.0, 16.4, 50.4)")
    con.execute("INSERT INTO administrative_division VALUES (8, 3, 'Duszniki-Zdroj', 5, 6, '0208011', 30.0, 16.39, 50.40)")
    con.execute("INSERT INTO administrative_division VALUES (9, 4, 'Duszniki-Zdroj', 5, 6, '0208011', 30.0, 16.39, 50.40)")

    mock_exists.return_value = True
    resolver = GugikGeoResolver(con, "./dummy_cache.json")
    # GUGiK resolves Szczytna correctly, returns 0 candidates for the spaced
    # 'duszniki zdroj' query (mirrors reality: GUGiK only knows the hyphenated
    # 'Duszniki-Zdroj' form).
    resolver.gugik_cache = {
        "szczytna": [
            {
                "voivodeship": "Dolnoslaskie",
                "county": "powiat klodzki",
                "commune": "Szczytna",
                "teryt": "0208143",
                "x": "570000", "y": "350000"
            }
        ],
        "duszniki zdroj": [],
    }

    facts = [
        # Szczytna store - GUGiK nails it
        {"city": "Szczytna", "latitude": 50.4, "longitude": 16.4},
        # Two Duszniki-Zdroj stores - GUGiK returns 0 candidates, the spatial
        # fallback would otherwise park both on gmina Szczytna (id=7). The
        # KNOWN_MISS_FIXES whitelist re-wires them to the right gmina/city.
        {"city": "Duszniki Zdroj", "latitude": 50.404098, "longitude": 16.390269},
        {"city": "Duszniki Zdroj", "latitude": 50.401455, "longitude": 16.391479},
    ]

    resolver.resolve_facts(facts)

    # Szczytna store is correctly geocoded
    assert facts[0]["gmina_id"] == 7
    assert facts[0]["miasto_id"] is None  # Szczytna is a gmina miejsko-wiejska, not a city
    assert facts[0]["voivodeship_id"] == 5
    assert facts[0]["powiat_id"] == 6

    # Both Duszniki-Zdroj stores got rewired to the right gmina/city
    for f in facts[1:]:
        assert f["gmina_id"] == 8, f"expected gmina Duszniki-Zdroj (id=8), got {f['gmina_id']}"
        assert f["miasto_id"] == 9, f"expected city Duszniki-Zdroj (id=9), got {f['miasto_id']}"
        assert f["voivodeship_id"] == 5
        assert f["powiat_id"] == 6
        assert f["voivodeship"] == "Dolnoslaskie"
        assert f["powiat"] == "powiat klodzki"


@patch("builtins.open", new_callable=pytest.importorskip("unittest.mock").mock_open, read_data="{}")
@patch("os.path.exists")
def test_resolve_facts_known_miss_no_op_when_already_correct(mock_exists, mock_open, db_conn):
    # If GUGiK somehow already assigned a store to the right gmina (e.g. the
    # cache was warm or a future API change started returning the spaced form),
    # the known-miss pass must leave it alone rather than churning the row.
    con = db_conn
    con.execute("INSERT INTO administrative_division VALUES (5, 1, 'Dolnoslaskie', NULL, NULL, '0200000', 19947.0, 16.0, 50.5)")
    con.execute("INSERT INTO administrative_division VALUES (6, 2, 'powiat klodzki', 5, NULL, '0208000', 1641.0, 16.4, 50.4)")
    con.execute("INSERT INTO administrative_division VALUES (8, 3, 'Duszniki-Zdroj', 5, 6, '0208011', 30.0, 16.39, 50.40)")
    con.execute("INSERT INTO administrative_division VALUES (9, 4, 'Duszniki-Zdroj', 5, 6, '0208011', 30.0, 16.39, 50.40)")

    mock_exists.return_value = True
    resolver = GugikGeoResolver(con, "./dummy_cache.json")
    # Pretend a future GUGiK resolves 'duszniki zdroj' correctly
    resolver.gugik_cache = {
        "duszniki zdroj": [
            {
                "voivodeship": "Dolnoslaskie",
                "county": "powiat klodzki",
                "commune": "Duszniki-Zdroj",
                "teryt": "0208011",
                "x": "570000", "y": "350000"
            }
        ],
    }

    facts = [{"city": "Duszniki Zdroj", "latitude": 50.40, "longitude": 16.39}]
    resolver.resolve_facts(facts)

    # Already correct - no churn
    assert facts[0]["gmina_id"] == 8
    assert facts[0]["miasto_id"] == 9
    assert facts[0]["voivodeship_id"] == 5
    assert facts[0]["powiat_id"] == 6


def test_norm_key_matches_across_hyphen_and_diacritics():
    assert GugikGeoResolver._norm_key("Duszniki Zdroj") == "duszniki zdroj"
    assert GugikGeoResolver._norm_key("Duszniki-Zdroj") == "duszniki zdroj"
    assert GugikGeoResolver._norm_key("DUSZNIKI   ZDRÓJ") == "duszniki zdroj"
    assert GugikGeoResolver._norm_key(None) == ""
    assert GugikGeoResolver._norm_key("") == ""
