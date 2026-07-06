import os
from unittest.mock import MagicMock, mock_open, patch

import duckdb
import pytest

import backend.etl.io as io
from backend.database import _run_all_ddl
from backend.etl.sources.amphibians import AmphibiansEnricher
from backend.etl.sources.elevation import ElevationEnricher
from backend.etl.sources.neighbor import NeighborEnricher
from backend.etl.sources.parks import ParksEnricher


def test_etl_helpers():
    # Test _derive_h24
    assert io._derive_h24({"mon-sat": "00:00:00 - 24:00:00"}) is True
    assert io._derive_h24({"mon-sat": "00:00:00 - 00:00:00"}) is True
    assert io._derive_h24({"mon-sat": "06:00:00 - 23:00:00"}) is False
    assert io._derive_h24({}) is False

    # Test _norm_powiat (used to JOIN GUS economics -> dim_powiat). The
    # disambiguation suffix "(maz.)/(wlkp.)/..." must be stripped so the key
    # matches what GUS BDL returns (GUS does not carry the suffix).
    from backend.etl.sources.economy import _norm_powiat
    assert _norm_powiat("Powiat grodziski (maz.)") == "grodziski"
    assert _norm_powiat("Powiat grodziski (wlkp.)") == "grodziski"
    assert _norm_powiat("Powiat bielski (śl.)") == "bielski"
    assert _norm_powiat("powiat sławieński") == "sławieński"
    assert _norm_powiat("Powiat m. st. Warszawa") == "warszawa"
    assert _norm_powiat("Powiat m. Wałbrzych od 2013") == "wałbrzych"
    # Without the suffix, the result is unchanged
    assert _norm_powiat("Powiat grodziski") == "grodziski"


def test_geo_dims_lowercase_voiv_lookup():
    # Regression: GUS BDL returns voivodeship names LOWERCASE (via
    # _TERYT_VOIV in economy.py), but administrative_division stores them
    # UPPERCASE (seed + ETL convention). _lookup must lowercase the voiv it
    # receives from locations before the dict lookup, otherwise the (voiv,
    # key) tuple misses the GUS key and the field ends up NULL on prod. The
    # previous "name-only fallback" masked this case mismatch and silently
    # produced the cross-contamination we just fixed.
    import duckdb
    from backend.database import _run_all_ddl

    con = duckdb.connect(":memory:")
    _run_all_ddl(con)

    # Seed two voivodeships and one duplicated powiat in each.
    con.execute("""
        INSERT INTO administrative_division (id, level, name, population, gus_id, voivodeship_id, powiat_id)
        VALUES
            (900001, 1, 'MAZOWIECKIE',  1000, NULL, NULL, NULL),
            (900002, 1, 'WIELKOPOLSKIE', 2000, NULL, NULL, NULL),
            (900011, 2, 'Powiat grodziski (maz.)',  100, NULL, 900001, NULL),
            (900012, 2, 'Powiat grodziski (wlkp.)', 200, NULL, 900002, NULL)
    """)

    # Minimal facts as they come from locations: voivodeship in UPPERCASE.
    rows = [
        {"voivodeship_id": 900001, "voivodeship": "MAZOWIECKIE",
         "powiat_id": 900011, "powiat": "Powiat grodziski (maz.)"},
        {"voivodeship_id": 900002, "voivodeship": "WIELKOPOLSKIE",
         "powiat_id": 900012, "powiat": "Powiat grodziski (wlkp.)"},
    ]

    # GUS dict: lowercase voiv + normalised powiat key (this is what
    # fetch_gus_economics actually returns).
    fake_gus = (
        {("mazowieckie", "grodziski"):  100.0,    # salary
         ("wielkopolskie", "grodziski"): 200.0},
        {("mazowieckie", "grodziski"):  3.2,      # unempl
         ("wielkopolskie", "grodziski"): 5.0},
        {("mazowieckie", "grodziski"):  108342,   # popul
         ("wielkopolskie", "grodziski"): 51358},
    )

    from backend.etl import pipeline as pipe
    original = pipe.fetch_gus_economics
    pipe.fetch_gus_economics = lambda: fake_gus
    try:
        dim_powiat, _ = pipe._build_geo_dims(rows, [], skip_gus=False)
    finally:
        pipe.fetch_gus_economics = original

    by_id = {row[0]: row for row in dim_powiat}
    # Each duplicated powiat must receive ITS OWN voiv's value, never the
    # partner's. This is the assertion that would have failed under the old
    # name-only fallback.
    assert by_id[900011][3] == 108342, f"maz grodziski got {by_id[900011][3]}"
    assert by_id[900012][3] == 51358,  f"wlkp grodziski got {by_id[900012][3]}"
    assert by_id[900011][4] == 100.0
    assert by_id[900012][4] == 200.0
    assert by_id[900011][5] == 3.2
    assert by_id[900012][5] == 5.0

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


def test_load_to_duckdb_truncation_guard():
    # A snapshot that comes back with far fewer stores than what's already
    # active should be rejected rather than soft-deleting most of the table -
    # guards against a partial/broken upstream response wiping history.
    con = duckdb.connect(":memory:")
    _run_all_ddl(con)

    rows_full = [{"store_id": str(i), "latitude": 50.0, "longitude": 20.0} for i in range(10)]
    io.load_to_duckdb(con, rows_full, {"source_date": "2026-06-15"})
    active_before = con.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    assert active_before == 10

    rows_truncated = [{"store_id": str(i), "latitude": 50.0, "longitude": 20.0} for i in range(5)]  # 50% < 70% threshold
    with pytest.raises(ValueError, match="safety guard"):
        io.load_to_duckdb(con, rows_truncated, {"source_date": "2026-06-16"})

    # Nothing should have been soft-deleted by the rejected load.
    active_after = con.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    assert active_after == 10


def test_per_capita_effective_population_views():
    # v_voiv_pop_eff folds a city-with-powiat-rights' own population back onto
    # its voivodeship before any per-capita query divides by it - a voivodeship
    # genuinely contains its cities, so their populations must be in the
    # denominator. v_city_powiat_miasta exposes those same cities' level-4 ids
    # so powiat-level queries can EXCLUDE their stores from the surrounding land
    # powiat (a city with powiat rights is a separate unit, shown in the MIASTA
    # dimension). Uses IDs well above the ~3100 seeded rows to avoid collisions.
    con = duckdb.connect(":memory:")
    _run_all_ddl(con)

    con.execute("""
        INSERT INTO administrative_division (id, level, name, population, gus_id, voivodeship_id, powiat_id)
        VALUES
            (900001, 1, 'testowe', 100000, NULL, NULL, NULL),
            (900002, 2, 'testowy', 5000, NULL, 900001, NULL),
            (900003, 2, 'bez_miasta', 3000, NULL, 900001, NULL),
            (900004, 4, 'Testograd', 200000, '000000061000', 900001, 900002)
    """)

    # v_city_powiat_miasta: exactly the level-4 rows with pow_code >= '61'.
    city_ids = {r[0] for r in con.execute("SELECT id FROM v_city_powiat_miasta").fetchall()}
    assert city_ids == {900004}

    # Voivodeship: land population + every hosted city's population.
    voiv = con.execute(
        "SELECT population FROM v_voiv_pop_eff WHERE voivodeship_id = 900001"
    ).fetchone()
    assert voiv[0] == 100000 + 200000


def test_disambiguate_duplicate_powiaty():
    # Two powiaty named identically in different voivodeships get a "(skrot)"
    # suffix appended. The suffix comes from VOIV_ABBR via the voivodeship.
    # Re-running is a no-op (idempotent). Voivodeship-name match is case-
    # insensitive (seed lowercases, ETL may UPPERCASE).
    from backend.api.geo_router import _pow_geo_key
    from backend.database import VOIV_ABBR, _disambiguate_duplicate_powiaty

    # _pow_geo_key: strips 'powiat ' and a trailing '(...)' suffix
    assert _pow_geo_key("Powiat grodziski (maz.)") == "grodziski"
    assert _pow_geo_key("powiat grodziski") == "grodziski"
    assert _pow_geo_key("Powiat bielski (śl.)") == "bielski"
    # name without suffix / prefix passthrough
    assert _pow_geo_key("grodziski") == "grodziski"

    con = duckdb.connect(":memory:")
    _run_all_ddl(con)

    # Insert the two voivodeships we need (self-contained - don't rely on the
    # GUS seed JSON being loaded into this in-memory DB).
    con.execute("""
        INSERT INTO administrative_division (id, level, name, population, gus_id, voivodeship_id, powiat_id)
        VALUES
            (900001, 1, 'MAZOWIECKIE', 1000, NULL, NULL, NULL),
            (900002, 1, 'WIELKOPOLSKIE', 2000, NULL, NULL, NULL)
    """)

    # Two "Powiat testowy" in two voivodeships + one non-duplicate control.
    con.execute("""
        INSERT INTO administrative_division (id, level, name, population, gus_id, voivodeship_id, powiat_id)
        VALUES
            (900011, 2, 'Powiat testowy', 1000, NULL, 900001, NULL),
            (900012, 2, 'Powiat testowy', 2000, NULL, 900002, NULL),
            (900013, 2, 'Powiat unikatowy', 3000, NULL, 900001, NULL)
    """)

    # Sanity: VOIV_ABBR has both voivodeships.
    assert "MAZOWIECKIE" in VOIV_ABBR and "WIELKOPOLSKIE" in VOIV_ABBR

    _disambiguate_duplicate_powiaty(con)

    names = {r[0] for r in con.execute(
        "SELECT name FROM administrative_division WHERE level=2 AND id IN (900011,900012,900013)"
    ).fetchall()}
    assert "Powiat testowy (maz.)" in names
    assert "Powiat testowy (wlkp.)" in names
    # The non-duplicate is untouched (no suffix added).
    assert "Powiat unikatowy" in names
    assert "Powiat unikatowy ()" not in names  # would mean it got a bogus empty suffix

    # Idempotent: a second run must not double-suffix.
    _disambiguate_duplicate_powiaty(con)
    names2 = {r[0] for r in con.execute(
        "SELECT name FROM administrative_division WHERE level=2 AND id IN (900011,900012,900013)"
    ).fetchall()}
    assert names2 == names, f"second run changed names: {names2 - names} / {names - names2}"


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


@patch("backend.etl.io.time.sleep")
@patch("requests.get")
@patch("os.path.exists")
def test_fetch_zabka_json(mock_exists, mock_get, mock_sleep):
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
        m_open.assert_called_with(os.path.join(io.GEO_DIR, "local.geojson"), "w", encoding="utf-8")


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
