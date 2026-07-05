# Unit tests for backend.etl.geo.py.
# Emojis are strictly forbidden in this project.

import math

import numpy as np

import backend.etl.geo as geo


def test_unit_vectors():
    lats = [0.0, 90.0]
    lons = [0.0, 0.0]
    vecs = geo.unit_vectors(lats, lons)
    assert np.allclose(vecs[0], [1.0, 0.0, 0.0])
    assert np.allclose(vecs[1], [0.0, 0.0, 1.0])

def test_sphere_tree():
    lats = [0.0, 0.0]
    lons = [0.0, 90.0]
    tree, xyz = geo.sphere_tree(lats, lons)
    assert xyz.shape == (2, 3)
    dist, idx = tree.query(geo.unit_vectors([0.0], [0.0])[0], k=1)
    assert idx == 0

def test_chord_to_km():
    # Chord of 0 should be 0 km
    assert geo.chord_to_km(0.0) == 0.0
    # Half circumference chord is 2.0 (on unit sphere) -> pi * radius
    assert np.isclose(geo.chord_to_km(2.0), math.pi * geo.EARTH_KM)

def test_km_to_chord():
    assert geo.km_to_chord(0.0) == 0.0
    assert np.isclose(geo.km_to_chord(math.pi * geo.EARTH_KM), 2.0)

def test_ring_contains():
    # Square ring clockwise
    ring = [[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]]
    assert geo.ring_contains(5.0, 5.0, ring) is True
    assert geo.ring_contains(15.0, 5.0, ring) is False

def test_polygon_index_and_assign():
    geojson = {
        "features": [
            {
                "properties": {"nazwa": "Woj1"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]]]
                }
            }
        ]
    }
    index = geo.build_polygon_index(geojson)
    assert len(index) == 1
    assert index[0][0] == "Woj1"
    
    assert geo.assign_region(5.0, 5.0, index) == "Woj1"
    assert geo.assign_region(15.0, 5.0, index) is None
    
    # Test nearest fallback
    assert geo.nearest_region(12.0, 5.0, index) == "Woj1"

def test_shoelace_area():
    # Unit square
    ring = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]
    # Counter-clockwise winding gives positive area
    assert geo._shoelace_area(ring) == -1.0
    assert abs(geo._shoelace_area(ring)) == 1.0

def test_polygon_centroid():
    ring = [[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]]
    cx, cy = geo.polygon_centroid([ring])
    assert np.isclose(cx, 5.0)
    assert np.isclose(cy, 5.0)

def test_region_centroids():
    geojson = {
        "features": [
            {
                "properties": {"nazwa": "Woj1"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]]]
                }
            }
        ]
    }
    centroids = geo.region_centroids(geojson, lambda x: x.lower())
    assert centroids["woj1"] == (5.0, 5.0)

def test_poland_rings():
    geojson = {
        "features": [
            {
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]]
                }
            }
        ]
    }
    rings = geo.poland_rings(geojson)
    assert len(rings) == 1
    assert rings[0] == [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]

def test_wgs84_to_puwg1992():
    # Warsaw coordinates: lat 52.23, lon 21.01
    n, e = geo.wgs84_to_puwg1992(52.23, 21.01)
    # Check that it returns plausible PL-1992 coordinates
    # PL-1992 coordinates in Warsaw are around X (northing) ~ 488000, Y (easting) ~ 637000
    assert 450000 < n < 550000
    assert 600000 < e < 700000
