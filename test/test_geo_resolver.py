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
