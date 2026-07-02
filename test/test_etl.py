import pytest
import duckdb
from unittest.mock import patch, mock_open, MagicMock
import backend.etl.io as io
from backend.database import _run_all_ddl
from backend.etl.sources.neighbor import NeighborEnricher
from backend.etl.sources.parks import ParksEnricher
from backend.etl.sources.amphibians import AmphibiansEnricher
from backend.etl.sources.elevation import ElevationEnricher

def test_etl_helpers():
    # Test _derive_h24
    assert io._derive_h24({"mon-sat": "00:00:00 - 00:00:00"}) is True
    assert io._derive_h24({"mon-sat": "00:00:00 - 24:00:00"}) is True
    assert io._derive_h24({"mon-sat": "06:00:00 - 23:00:00"}) is False
    assert io._derive_h24({}) is False

    # Test _derive_open_sunday
    assert io._derive_open_sunday({"sun": "10:00:00 - 20:00:00"}) is True
    assert io._derive_open_sunday({}) is False

    # Test _normalize_city
    assert io._normalize_city("  LEGNICA  ") == "Legnica"
    assert io._normalize_city("warszawa praga") == "Warszawa Praga"
    assert io._normalize_city(None) is None

    # Test _clean_street
    assert io._clean_street("ul. Główna <br> 12-345") == "ul. Główna"
    assert io._clean_street("ul. Kwiatowa 5") == "ul. Kwiatowa 5"
    assert io._clean_street("") == "nieokreślona"

    # Test _dedupe
    records = [
        {"storeId": "101", "locationId": "ID101", "street": "Kwiatowa 5"},
        {"storeId": "101", "locationId": "101", "street": "Kwiatowa 5 <br>"}
    ]
    deduped = io._dedupe(records)
    assert len(deduped) == 1
    assert deduped[0]["locationId"] == "ID101"

def test_to_tabular():
    raw_data = {
        "locations": [
            {
                "storeId": "1234",
                "town": "Kraków",
                "street": "Floriańska 12",
                "lat": 50.0619,
                "lon": 19.9373,
                "locatorMerrychef": True,
                "openingHours": {"mon-sat": "06:00 - 23:00", "sun": "10:00 - 20:00"},
                "firstOpeningDate": "2024-01-15",
                "isVisible": True,
                "locatorNewMonth": False,
                "locatorNewTwoWeeks": True
            }
        ]
    }
    rows = io.to_tabular(raw_data)
    assert len(rows) == 1
    row = rows[0]
    assert row["store_id"] == "1234"
    assert row["city"] == "Kraków"
    assert row["street"] == "Floriańska 12"
    assert row["latitude"] == 50.0619
    assert row["longitude"] == 19.9373
    assert row["has_merrychef"] is True
    assert row["open_sunday"] is True
    assert row["h24"] is False
    assert row["first_opening_date"] == "2024-01-15"
    assert row["is_visible"] is True
    assert row["is_new_month"] is False
    assert row["is_new_two_weeks"] is True
    assert row["h3_index_9"] is not None
    assert len(row["h3_index_9"]) == 15

def test_neighbor_enricher():
    rows = [
        {"latitude": 52.0000, "longitude": 21.0000, "store_id": "A"},
        {"latitude": 52.0005, "longitude": 21.0005, "store_id": "B"}, # approx 50-60m
        {"latitude": 53.0000, "longitude": 22.0000, "store_id": "C"}  # far away
    ]
    enricher = NeighborEnricher()
    enricher.enrich(rows)
    
    assert rows[0]["nearest_neighbor_distance_meters"] is not None
    assert rows[1]["nearest_neighbor_distance_meters"] is not None
    assert rows[2]["nearest_neighbor_distance_meters"] is not None
    
    # Store C is far away, so it must be the loner
    loner = enricher.fun_fact()
    assert loner is not None
    assert abs(loner["lat"] - 53.0) < 1e-4

@patch("backend.etl.sources.parks.load_static_geojson")
def test_parks_enricher(mock_load):
    # Mock nature park GeoJSON covering area [20.0, 52.0] to [20.2, 52.2]
    mock_load.return_value = {
        "features": [
            {
                "properties": {"nazwa": "Mock National Park", "typ": "Park Narodowy"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[20.0, 52.0], [20.2, 52.0], [20.2, 52.2], [20.0, 52.2], [20.0, 52.0]]]
                }
            }
        ]
    }
    
    rows = [
        {"latitude": 52.1, "longitude": 20.1},  # Inside
        {"latitude": 52.5, "longitude": 20.5}   # Outside
    ]
    
    enricher = ParksEnricher()
    enricher.enrich(rows)
    
    assert rows[0]["is_in_nature_park"] is True
    assert rows[0]["nature_park_id"] == 1
    assert rows[1]["is_in_nature_park"] is False
    assert rows[1]["nature_park_id"] is None
    
    parks = enricher.parks()
    assert len(parks) == 1
    assert parks[0] == (1, "Mock National Park", "Park Narodowy")

@patch("backend.etl.sources.amphibians._load_amphibian_points")
def test_amphibians_enricher(mock_points):
    # Mock amphibian observations
    mock_points.return_value = [
        [52.0001, 21.0001, 2024],
        [52.0002, 21.0002, 2024]
    ]
    
    rows = [
        {"latitude": 52.0, "longitude": 21.0},
        {"latitude": 53.0, "longitude": 22.0}
    ]
    
    enricher = AmphibiansEnricher()
    enricher.enrich(rows)
    
    assert rows[0]["amphibian_occurrences_5km"] == 2
    assert rows[0]["nearest_amphibian_km"] is not None
    assert rows[1]["amphibian_occurrences_5km"] == 0
    assert rows[1]["nearest_amphibian_km"] is not None

@patch("builtins.open", new_callable=mock_open, read_data='{"52.00000,21.00000": 152.5}')
@patch("os.path.exists")
def test_elevation_enricher(mock_exists, mock_file):
    mock_exists.return_value = True
    rows = [
        {"latitude": 52.0, "longitude": 21.0}
    ]
    enricher = ElevationEnricher(max_passes=1)
    enricher.enrich(rows)
    
    assert rows[0]["elevation_meters"] == 152.5

def test_load_to_duckdb_integration():
    # Setup in-memory database
    con = duckdb.connect(":memory:")
    _run_all_ddl(con)
    
    # Snapshot A data
    rows_a = [
        {
            "store_id": "1",
            "city": "Kraków",
            "street": "Floriańska 10",
            "voivodeship": "małopolskie",
            "powiat": "Kraków",
            "voivodeship_id": 1,
            "powiat_id": 12,
            "latitude": 50.061,
            "longitude": 19.937,
            "has_merrychef": True,
            "open_sunday": False,
            "h24": False,
            "opening_hours_monsat": "06:00-23:00",
            "opening_hours_sun": "",
            "first_opening_date": "2024-01-01",
            "is_visible": True,
            "is_new_month": False,
            "is_new_two_weeks": False,
            "elevation_meters": 210.0,
            "is_in_nature_park": False,
            "nature_park_id": None,
            "nearest_neighbor_distance_meters": 150,
            "amphibian_occurrences_5km": 5,
            "nearest_amphibian_km": 0.5,
            "gmina_id": 101,
            "miasto_id": 201
        },
        {
            "store_id": "2",
            "city": "Warszawa",
            "street": "Marszałkowska 50",
            "voivodeship": "mazowieckie",
            "powiat": "Warszawa",
            "voivodeship_id": 2,
            "powiat_id": 24,
            "latitude": 52.231,
            "longitude": 21.011,
            "has_merrychef": False,
            "open_sunday": True,
            "h24": False,
            "opening_hours_monsat": "06:00-23:00",
            "opening_hours_sun": "10:00-20:00",
            "first_opening_date": "2024-02-01",
            "is_visible": True,
            "is_new_month": False,
            "is_new_two_weeks": False,
            "elevation_meters": 110.0,
            "is_in_nature_park": False,
            "nature_park_id": None,
            "nearest_neighbor_distance_meters": 200,
            "amphibian_occurrences_5km": 0,
            "nearest_amphibian_km": 6.2,
            "gmina_id": 102,
            "miasto_id": 202
        }
    ]
    
    meta_a = {"source_date": "2026-06-15"}
    
    # 1. First Load
    io.load_to_duckdb(con, rows_a, meta_a)
    
    active_count = con.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    assert active_count == 2
    
    # 2. Second Load with:
    # - New store (ID 3)
    # - Updated store (ID 1, changed street to "Floriańska 12")
    # - Missing store (ID 2, should be soft-deleted)
    rows_b = [
        # Updated
        {
            "store_id": "1",
            "city": "Kraków",
            "street": "Floriańska 12", # CHANGED
            "voivodeship": "małopolskie",
            "powiat": "Kraków",
            "voivodeship_id": 1,
            "powiat_id": 12,
            "latitude": 50.061,
            "longitude": 19.937,
            "has_merrychef": True,
            "open_sunday": False,
            "h24": False,
            "opening_hours_monsat": "06:00-23:00",
            "opening_hours_sun": "",
            "first_opening_date": "2024-01-01",
            "is_visible": True,
            "is_new_month": False,
            "is_new_two_weeks": False,
            "elevation_meters": 210.0,
            "is_in_nature_park": False,
            "nature_park_id": None,
            "nearest_neighbor_distance_meters": 150,
            "amphibian_occurrences_5km": 5,
            "nearest_amphibian_km": 0.5,
            "gmina_id": 101,
            "miasto_id": 201
        },
        # New
        {
            "store_id": "3",
            "city": "Gdańsk",
            "street": "Długa 5",
            "voivodeship": "pomorskie",
            "powiat": "Gdańsk",
            "voivodeship_id": 3,
            "powiat_id": 35,
            "latitude": 54.352,
            "longitude": 18.647,
            "has_merrychef": True,
            "open_sunday": True,
            "h24": True,
            "opening_hours_monsat": "00:00-24:00",
            "opening_hours_sun": "00:00-24:00",
            "first_opening_date": "2026-06-20",
            "is_visible": True,
            "is_new_month": True,
            "is_new_two_weeks": True,
            "elevation_meters": 5.0,
            "is_in_nature_park": False,
            "nature_park_id": None,
            "nearest_neighbor_distance_meters": 300,
            "amphibian_occurrences_5km": 2,
            "nearest_amphibian_km": 1.1,
            "gmina_id": 103,
            "miasto_id": 203
        }
    ]
    
    meta_b = {"source_date": "2026-06-16"}
    io.load_to_duckdb(con, rows_b, meta_b)
    
    # Assertions
    # ID 1 and ID 3 should be active
    active = con.execute("SELECT store_id, street, created_at, deleted_at FROM locations WHERE deleted_at IS NULL ORDER BY store_id").fetchall()
    assert len(active) == 2
    assert active[0][0] == "1"
    assert active[0][1] == "Floriańska 12"  # Overwritten in place!
    assert active[1][0] == "3"
    
    # ID 2 should be soft-deleted
    deleted = con.execute("SELECT store_id, deleted_at FROM locations WHERE store_id = '2'").fetchone()
    assert deleted is not None
    assert deleted[1] is not None  # Has deleted_at timestamp


def test_with_retries():
    # Succeeds on first attempt
    fn = MagicMock(return_value="success")
    res = io.with_retries(fn, "test-label", attempts=3, delay=0.01)
    assert res == "success"
    assert fn.call_count == 1

    # Fails twice then succeeds
    fn = MagicMock(side_effect=[Exception("fail1"), Exception("fail2"), "success"])
    res = io.with_retries(fn, "test-label", attempts=3, delay=0.01)
    assert res == "success"
    assert fn.call_count == 3

    # Fails all attempts
    fn = MagicMock(side_effect=Exception("fail"))
    res = io.with_retries(fn, "test-label", attempts=3, delay=0.01)
    assert res is None
    assert fn.call_count == 3


@patch("requests.get")
@patch("os.path.exists")
def test_fetch_zabka_json(mock_exists, mock_get):
    # Mock successful HTTP request
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"locations": []}
    mock_get.return_value = mock_resp

    data = io.fetch_zabka_json("http://dummy-url")
    assert data == {"locations": []}

    # Mock HTTP failure, fallback file exists
    mock_get.side_effect = Exception("HTTP Error")
    mock_exists.return_value = True
    with patch("builtins.open", mock_open(read_data='{"fallback": true}')):
        data = io.fetch_zabka_json("http://dummy-url", fallback="local.json")
        assert data == {"fallback": True}

    # Mock HTTP failure, fallback file does not exist -> RuntimeError
    mock_exists.return_value = False
    with pytest.raises(RuntimeError):
        io.fetch_zabka_json("http://dummy-url", fallback="local.json")


@patch("requests.get")
@patch("os.path.exists")
@patch("os.makedirs")
def test_load_geojson(mock_makedirs, mock_exists, mock_get):
    # Local file exists
    mock_exists.return_value = True
    with patch("builtins.open", mock_open(read_data='{"type": "FeatureCollection"}')):
        res = io.load_geojson("http://dummy-url", "local.geojson")
        assert res == {"type": "FeatureCollection"}

    # Local file does not exist -> downloads and saves it
    mock_exists.return_value = False
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"type": "FeatureCollection", "features": []}
    mock_get.return_value = mock_resp

    m_open = mock_open()
    with patch("builtins.open", m_open):
        res = io.load_geojson("http://dummy-url", "local.geojson")
        assert res == {"type": "FeatureCollection", "features": []}
        m_open.assert_called_with("data/geo/local.geojson", "w", encoding="utf-8")


def test_find_farthest_point():
    # Mock Poland polygon (square covering coordinates 15.0 to 16.0 lon, 50.0 to 51.0 lat)
    woj_geo = {
        "features": [
            {
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[15.0, 50.0], [15.0, 51.0], [16.0, 51.0], [16.0, 50.0], [15.0, 50.0]]]
                }
            }
        ]
    }
    
    # Store at 15.5, 50.5
    lats = [50.5]
    lons = [15.5]
    
    # Run the empty circle search
    res = io.farthest_point_from_any_zabka(lats, lons, woj_geo, coarse_deg=0.2, fine_deg=0.05)
    assert res["lat"] is not None
    assert res["lon"] is not None
    assert res["dist_km"] > 0.0


@patch("backend.etl.io.time.sleep")
def test_reload_cache(mock_sleep):
    with patch("backend.cache.cache") as mock_cache:
        # Mock Redis scan yielding keys, then ending
        mock_cache.scan.side_effect = [
            (1, ["k1", "k2"]),
            (0, [])
        ]
        
        io.reload_cache()
        mock_cache.delete.assert_any_call("k1", "k2")
