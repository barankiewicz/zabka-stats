"""
Import demo snapshot into DuckDB.
"""

import json
import sys
sys.path.insert(0, '.')

from backend.database_ch import client, init_db

def import_snapshot(json_path: str, source_date: str):
    """Import snapshot JSON to DuckDB."""

    # Initialize DB
    init_db()

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    locations = data.get('locations', [])
    summary = data.get('summary', {})

    print(f" Importing {len(locations)} locations...")

    # Create snapshot
    snapshot_result = client.execute("""
        INSERT INTO snapshots (source_date, total_count, visible_count, with_merrychef, open_sunday, h24, towns)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        RETURNING id
    """, (
        source_date,
        summary.get('total', len(locations)),
        summary.get('visible', len(locations)),
        summary.get('with_merrychef', 0),
        summary.get('open_sunday', 0),
        summary.get('h24', 0),
    )).fetchone()

    snapshot_id = snapshot_result[0]
    print(f" Snapshot created: ID={snapshot_id}, date={source_date}")

    # Insert locations
    for idx, loc in enumerate(locations):
        client.execute("""
            INSERT INTO locations (
                snapshot_id, external_id, name, street, city, voivodeship, country,
                latitude, longitude, has_merrychef, open_sunday, h24, powiat, postcode
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            snapshot_id,
            loc.get('external_id', f"zabka_{idx}"),
            loc.get('name', 'Żabka'),
            loc.get('street', ''),
            loc.get('city', ''),
            loc.get('voivodeship', 'Unknown'),
            'Polska',
            loc.get('latitude', 0),
            loc.get('longitude', 0),
            loc.get('has_merrychef', False),
            loc.get('open_sunday', False),
            loc.get('h24', False),
            loc.get('powiat', None),
            loc.get('postcode', None),
        ))

        if (idx + 1) % 5 == 0:
            print(f"   {idx + 1}/{len(locations)} locations...")

    print(f" Import complete! {len(locations)} locations inserted")

    # Show stats
    stats = client.execute("""
        SELECT
            COUNT(*) as total,
            SUM(has_merrychef) as merrychef,
            SUM(open_sunday) as sunday,
            SUM(h24) as h24
        FROM locations
        WHERE deleted_at IS NULL
    """).fetchone()

    print(f"\n Database stats:")
    print(f"  Total: {stats[0]}")
    print(f"  MerryChef: {stats[1]}")
    print(f"  Open Sunday: {stats[2]}")
    print(f"  24/7: {stats[3]}")

if __name__ == '__main__':
    import_snapshot('data/input/snapshot_2026-06-15.json', '2026-06-15')
