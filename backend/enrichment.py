"""
Data enrichment: Add administrative context (powiat, voivodeship, country).
Uses Nominatim reverse geocoding for high-quality boundaries.
"""

import requests
import time
import duckdb
from typing import Dict, Optional

# Nominatim user agent (required by their policy)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "zabka-dashboard-enrichment/1.0"

# Cache for requests (avoid hitting API multiple times)
geocode_cache = {}

def reverse_geocode(lat: float, lon: float) -> Dict:
    """
    Get administrative context from coordinates.

    Returns:
        {
            'city': 'Warszawa',
            'powiat': 'Powiat warszawski',
            'voivodeship': 'Mazowieckie',
            'country': 'Polska',
            'postcode': '00-XXX'
        }
    """

    cache_key = f"{lat:.4f},{lon:.4f}"
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    try:
        params = {
            'lat': lat,
            'lon': lon,
            'format': 'json',
            'language': 'pl',
            'zoom': 10,
        }

        headers = {'User-Agent': USER_AGENT}

        response = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=5)
        response.raise_for_status()

        data = response.json()
        address = data.get('address', {})

        result = {
            'city': address.get('city') or address.get('town') or address.get('village'),
            'powiat': address.get('county'),  # Polish: powiat
            'voivodeship': address.get('state'),  # Polish: województwo
            'country': address.get('country'),
            'postcode': address.get('postcode'),
        }

        geocode_cache[cache_key] = result

        # Be respectful to Nominatim
        time.sleep(1)

        return result

    except Exception as e:
        print(f"Geocode error for {lat},{lon}: {e}")
        return {
            'city': None,
            'powiat': None,
            'voivodeship': None,
            'country': None,
            'postcode': None,
        }

def enrich_locations_with_powiat():
    """
    Enrich existing locations with powiat (county) data.
    Updates DuckDB with new columns if needed.
    """

    conn = duckdb.connect('data/zabka.duckdb')

    # Check if powiat column exists
    schema = conn.execute("DESCRIBE locations").fetchall()
    columns = [col[0] for col in schema]

    if 'powiat' not in columns:
        print("Adding powiat column to locations...")
        conn.execute("ALTER TABLE locations ADD COLUMN powiat VARCHAR")
        conn.execute("ALTER TABLE locations ADD COLUMN postcode VARCHAR")
        print(" Columns added")

    # Get locations without powiat
    empty_locations = conn.execute("""
        SELECT id, latitude, longitude, voivodeship
        FROM locations
        WHERE deleted_at IS NULL AND powiat IS NULL
    """).fetchall()

    print(f" Enriching {len(empty_locations)} locations with powiat data...")

    for idx, (loc_id, lat, lon, existing_voiv) in enumerate(empty_locations):
        if idx % 100 == 0:
            print(f"  Progress: {idx}/{len(empty_locations)}")

        # Get administrative context
        context = reverse_geocode(lat, lon)

        # Update location
        conn.execute("""
            UPDATE locations
            SET powiat = ?, postcode = ?
            WHERE id = ?
        """, (context['powiat'], context['postcode'], loc_id))

    conn.commit()
    print(f" Enrichment complete! {len(empty_locations)} locations updated")

    # Show sample
    sample = conn.execute("""
        SELECT id, name, city, powiat, voivodeship
        FROM locations
        WHERE deleted_at IS NULL
        LIMIT 5
    """).fetchall()

    print("\n Sample enriched data:")
    for row in sample:
        print(f"  {row[1]}: {row[2]} ({row[3]}), {row[4]}")

def get_administrative_hierarchy(lat: float, lon: float) -> Dict:
    """
    Get full administrative hierarchy for a location.

    Returns: {
        'country': 'Polska',
        'voivodeship': 'Mazowieckie',
        'powiat': 'Powiat warszawski',
        'city': 'Warszawa',
        'postcode': '00-001'
    }
    """
    return reverse_geocode(lat, lon)

if __name__ == '__main__':
    enrich_locations_with_powiat()
