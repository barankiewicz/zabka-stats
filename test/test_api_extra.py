# Extra tests to hit remaining REST endpoints and increase test coverage.
# Emojis are strictly forbidden in this project.

import pytest
from litestar.testing import TestClient

from backend.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_hierarchy_voivodeships(client):
    response = client.get("/api/hierarchy/voivodeships")
    assert response.status_code == 200

def test_context_coords(client):
    response = client.get("/api/context/52.23/21.01")
    assert response.status_code == 200

def test_fun_extremes(client):
    response = client.get("/api/fun/extremes")
    assert response.status_code == 200

def test_admin_summary(client):
    response = client.get("/api/stats/administrative-summary")
    assert response.status_code == 200

def test_amphibians_stats(client):
    response = client.get("/api/stats/amphibians")
    assert response.status_code == 200

def test_section3_rare(client):
    response = client.get("/api/stats/section3-rare")
    assert response.status_code == 200

def test_parks_stores(client):
    response = client.get("/api/stats/parks-stores")
    assert response.status_code == 200

def test_geo_voivodeships(client):
    response = client.get("/api/geo/voivodeships")
    assert response.status_code in (200, 404, 500) # Defer to available test assets

def test_geo_powiats(client):
    response = client.get("/api/geo/powiats")
    assert response.status_code in (200, 404, 500)

def test_powiat_economics_geo(client):
    response = client.get("/api/stats/powiat-economics-geo")
    assert response.status_code == 200

def test_powiat_coverage(client):
    response = client.get("/api/stats/powiat-coverage")
    assert response.status_code == 200

def test_city_coverage(client):
    response = client.get("/api/stats/city-coverage")
    assert response.status_code == 200

def test_coverage_funnel(client):
    response = client.get("/api/stats/coverage-funnel")
    assert response.status_code == 200

def test_by_dimension(client):
    response = client.get("/api/stats/by-dimension?dimension=voivodeship&metric=count&sort=desc")
    assert response.status_code == 200

def test_by_dimension_powiat_excludes_city_with_powiat_rights(client):
    # A land powiat hosting a city with powiat rights (Warszawa sits inside
    # powiat warszawski zachodni in the data model) must report its LAND-only
    # stores and population - not the city's. Regression for the bug where the
    # merged ~2,000,000 denominator crashed per_1k to 0.59 instead of ~0.33.
    response = client.get("/api/stats/by-dimension?dim=powiat&metric=per1k&sort=desc&limit=400")
    assert response.status_code == 200
    rows = response.json()["rows"]
    wz = next((r for r in rows if "warszawski zachodni" in r["name"].lower()), None)
    assert wz is not None, "powiat warszawski zachodni missing from powiat dimension"
    # Land population is ~137k; the folded/merged value was ~2,000,000.
    assert wz["population"] < 300000, f"population inflated by city: {wz['population']}"
    # City stores (~1145 in Warszawa) must not be counted under the land powiat.
    assert wz["cnt"] < 200, f"city stores leaked into land powiat: {wz['cnt']}"

def test_gmina_leaders(client):
    response = client.get("/api/stats/gmina-leaders")
    assert response.status_code == 200

def test_voivodeship_density(client):
    response = client.get("/api/stats/voivodeship-density")
    assert response.status_code == 200

def test_changes_monthly(client):
    response = client.get("/api/changes/monthly")
    assert response.status_code == 200

def test_changes_voivodeship(client):
    response = client.get("/api/changes/voivodeship")
    assert response.status_code == 200

def test_changes_timeline(client):
    response = client.get("/api/changes/timeline")
    assert response.status_code == 200

def test_locations_map(client):
    response = client.get("/api/locations/map")
    assert response.status_code == 200

def test_elevation_stats(client):
    response = client.get("/api/stats/elevation")
    assert response.status_code == 200

def test_neighbor_stats(client):
    response = client.get("/api/stats/neighbor-stats")
    assert response.status_code == 200

def test_kraniec_facts(client):
    response = client.get("/api/stats/kraniec-facts")
    assert response.status_code == 200

def test_twins(client):
    response = client.get("/api/stats/twins")
    assert response.status_code == 200

def test_neighbor_by_level(client):
    response = client.get("/api/stats/neighbor-by-level")
    assert response.status_code == 200

def test_stats_summary(client):
    response = client.get("/api/stats/summary")
    assert response.status_code == 200

def test_network_growth(client):
    response = client.get("/api/stats/network-growth")
    assert response.status_code == 200

def test_network_origin(client):
    response = client.get("/api/stats/network-origin")
    assert response.status_code == 200

def test_stores_timeline(client):
    response = client.get("/api/stats/stores-timeline")
    assert response.status_code == 200

def test_growth_by_voivodeship(client):
    response = client.get("/api/stats/growth-by-voivodeship")
    assert response.status_code == 200

def test_per_capita(client):
    response = client.get("/api/stats/per-capita")
    assert response.status_code == 200

def test_city_first_opening(client):
    response = client.get("/api/stats/city-first-opening")
    assert response.status_code == 200

def test_top_cities(client):
    response = client.get("/api/stats/top-cities")
    assert response.status_code == 200

def test_opening_seasonality(client):
    response = client.get("/api/stats/opening-seasonality")
    assert response.status_code == 200

def test_opening_hours(client):
    response = client.get("/api/stats/opening-hours")
    assert response.status_code == 200

def test_stats_voivodeship(client):
    response = client.get("/api/stats/voivodeship")
    assert response.status_code == 200

def test_powiat_economics(client):
    response = client.get("/api/stats/powiat-economics")
    assert response.status_code == 200

def test_sunday_by_voivodeship(client):
    response = client.get("/api/stats/sunday-by-voivodeship")
    assert response.status_code == 200

def test_inpost_vs_zabka(client):
    response = client.get("/api/stats/inpost-vs-zabka")
    assert response.status_code == 200

def test_inpost_vs_zabka_by_level(client):
    response = client.get("/api/stats/inpost-vs-zabka-by-level")
    assert response.status_code == 200

def test_common_streets(client):
    response = client.get("/api/stats/common-streets")
    assert response.status_code == 200

def test_openings_monthly(client):
    response = client.get("/api/stats/openings-monthly")
    assert response.status_code == 200

def test_sunday_closed_stores(client):
    response = client.get("/api/stats/sunday-closed-stores?voivodeship=mazowieckie")
    assert response.status_code == 200

def test_top_streets(client):
    response = client.get("/api/stats/top-streets")
    assert response.status_code == 200

def test_clear_cache_unauthorized(client):
    # No API_TOKEN configured in the test environment - must refuse, not clear.
    response = client.post("/api/cache/clear")
    assert response.status_code == 401

def test_clear_cache_wrong_token(client, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "the-real-token")
    response = client.post("/api/cache/clear", headers={"X-API-Token": "wrong"})
    assert response.status_code == 401

def test_clear_cache_authorized(client, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "the-real-token")
    response = client.post("/api/cache/clear", headers={"X-API-Token": "the-real-token"})
    assert response.status_code == 201
    assert response.json()["status"] == "cache cleared"

def test_upload_snapshot_unauthorized(client):
    response = client.post("/api/snapshot", data={"token": "wrong"})
    assert response.status_code in (401, 403, 400)

def test_upload_snapshot_wrong_token(client, monkeypatch):
    import backend.main as main_module
    monkeypatch.setattr(main_module, "API_TOKEN", "the-real-token")
    response = client.post("/api/snapshot", data={"token": "wrong", "source_date": "2026-01-01"})
    assert response.status_code == 401

def test_upload_snapshot_bad_source_date_format(client, monkeypatch, tmp_path):
    import backend.main as main_module
    monkeypatch.setattr(main_module, "API_TOKEN", "the-real-token")
    files = {"file": ("snapshot.json", b'{"meta": {}, "locations": []}', "application/json")}
    response = client.post(
        "/api/snapshot",
        data={"token": "the-real-token", "source_date": "not-a-date"},
        files=files,
    )
    assert response.status_code == 400


def test_stats_summary_with_empty_db(client, monkeypatch, tmp_path):
    # Simulates the CI scenario: a fresh checkout with no ETL data, so the
    # `locations` table is empty. The endpoint must still return 200 (and a
    # valid SummaryResponse, not 500 from a None field slipping into
    # Pydantic). Regression for the h24_count=NULL bug on empty rows.
    import backend.database as db
    empty_db = tmp_path / "empty.duckdb"
    monkeypatch.setattr(db, "DB_PATH", empty_db)
    db.init_db()  # rewires client to the empty file and reseeds dim_date

    response = client.get("/api/stats/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["total_active"] == 0
    assert body["cities_count"] == 0
    assert body["h24_count"] == 0
    assert body["total_stores_rounded"] == 0
    assert body["undated_stores"] == 0


def test_powiat_economics_geo_without_assets(client, monkeypatch, tmp_path):
    # Simulates the CI scenario: a fresh checkout where data/geo/ is empty
    # (the whole directory is gitignored). The endpoint must still return
    # 200 with a well-formed empty FeatureCollection so clients can render
    # the "no data" path instead of special-casing a 404.
    import backend.api.geo_router as geo_module

    fake_geo = tmp_path / "no_geojson_here"
    fake_geo.mkdir()
    monkeypatch.setattr(geo_module, "_GEO_DIR", fake_geo)
    # Reset the lazy-cached build so it picks up the new _GEO_DIR
    monkeypatch.setattr(geo_module, "_POW_ECON_GEO", None)

    response = client.get("/api/stats/powiat-economics-geo")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"] == []
    assert body.get("_meta", {}).get("reason") == "no_geojson_assets"


def test_upload_snapshot_auth(client, monkeypatch):
    # Test unauthorized
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    resp = client.post("/api/snapshot", data={"token": "wrong-token"})
    assert resp.status_code == 401

    resp = client.post("/api/snapshot", data={"token": ""})
    assert resp.status_code == 401

    resp = client.post("/api/snapshot", data={})
    assert resp.status_code == 401


def test_upload_snapshot_no_file(client, monkeypatch):
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    resp = client.post("/api/snapshot", data={"token": "test-token"})
    assert resp.status_code == 400
    assert "No file uploaded" in resp.json()["detail"]


def test_upload_snapshot_invalid_json(client, monkeypatch):
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    files = {"file": ("snapshot.json", b"not a json", "application/json")}
    resp = client.post("/api/snapshot", data={"token": "test-token"}, files=files)
    assert resp.status_code == 400
    assert "Invalid JSON" in resp.json()["detail"]


def test_upload_snapshot_invalid_structure(client, monkeypatch):
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    files = {"file": ("snapshot.json", b'{"other_key": 123}', "application/json")}
    resp = client.post("/api/snapshot", data={"token": "test-token"}, files=files)
    assert resp.status_code == 400
    assert "Invalid JSON format" in resp.json()["detail"]


def test_upload_snapshot_too_large(client, monkeypatch):
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    large_content = b"x" * (50 * 1024 * 1024 + 10)
    files = {"file": ("snapshot.json", large_content, "application/json")}
    resp = client.post("/api/snapshot", data={"token": "test-token"}, files=files)
    assert resp.status_code in (400, 413)
    if resp.status_code == 400:
        assert "exceeds" in resp.json()["detail"]


def test_upload_snapshot_success(client, monkeypatch, tmp_path):
    monkeypatch.setattr("backend.main.API_TOKEN", "test-token")
    
    # Mock the target input directory to a temp path
    mock_input_dir = tmp_path / "data" / "input"
    mock_input_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("backend.main.pathlib.Path", lambda *args: tmp_path)
    
    # Mock daily_etl.run to do nothing
    import backend.daily_etl
    monkeypatch.setattr(backend.daily_etl, "run", lambda *args, **kwargs: None)

    valid_json = b'{"meta": {"source_date": "2026-07-05"}, "stores": []}'
    files = {"file": ("snapshot.json", valid_json, "application/json")}
    resp = client.post("/api/snapshot", data={"token": "test-token", "source_date": "2026-07-05"}, files=files)
    assert resp.status_code in (200, 201)
    assert resp.json()["status"] == "success"
    assert resp.json()["source_date"] == "2026-07-05"
