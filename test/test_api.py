import pytest
from litestar.testing import TestClient

from backend.main import app


@pytest.fixture
def client():
    # Use standard Litestar TestClient
    with TestClient(app) as c:
        yield c

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "DuckDB"
    assert "locations" in data

def test_get_locations(client):
    # Retrieve first few locations
    response = client.get("/api/locations?limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "data" in data
    assert len(data["data"]) <= 5

def test_get_locations_by_voivodeship(client):
    # Test valid filter
    response = client.get("/api/locations?voivodeship=mazowieckie&limit=2")
    assert response.status_code == 200
    data = response.json()
    for loc in data["data"]:
        assert loc["voivodeship"].lower() == "mazowieckie"

def test_get_locations_sql_injection_prevention(client):
    # Attempt SQL injection via voivodeship filter
    # If parameterization is correct, it will search for the literal string "mazowieckie' OR 1=1 --" and return 0 results (no error)
    payload = "mazowieckie' OR 1=1 --"
    response = client.get(f"/api/locations?voivodeship={payload}&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 0

def test_get_by_powiat_sql_injection_prevention(client):
    payload = "mazowieckie' OR 1=1 --"
    response = client.get(f"/api/stats/by-powiat?voivodeship={payload}")
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 0

def test_get_by_city_sql_injection_prevention(client):
    payload = "Warszawa' OR 1=1 --"
    response = client.get(f"/api/stats/by-city?powiat={payload}")
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 0

def test_get_location_history_invalid_id(client):
    response = client.get("/api/history/location/9999999")
    assert response.status_code == 404
