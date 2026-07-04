import os
from datetime import datetime
from pathlib import Path
from backend.database import client, DB_PATH

def cap_name(n: str) -> str:
    if not n:
        return ""
    # Remove prefix/postfix artefacts if any
    n = n.replace("województwo ", "").replace("powiat ", "")
    return n.capitalize()

def compile_live_stats() -> dict:
    # 1. Total active stores
    total_active = client.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0] or 0
    # Rounded to nearest 100
    total_stores_rounded = int(round(total_active, -2))

    # 2. Cities count
    cities_count = client.execute("SELECT COUNT(DISTINCT city) FROM locations WHERE deleted_at IS NULL").fetchone()[0] or 0
    cities_count_rounded = int(round(cities_count, -2))

    # 3. Merrychef and Sunday Pct. The unpacking of three aggregate columns
    # would TypeError on an empty locations table (fetchone() returns None),
    # so coalesce to (None, None, 0) - the percentages stay nullable (no data
    # to compute them from) but h24_count is a plain count that defaults to 0.
    row = client.execute("""
        SELECT
            ROUND(100.0 * SUM(CASE WHEN has_merrychef THEN 1 ELSE 0 END) / NULLIF(COUNT(has_merrychef), 0), 1),
            ROUND(100.0 * SUM(CASE WHEN open_sunday THEN 1 ELSE 0 END) / NULLIF(COUNT(open_sunday), 0), 1),
            SUM(CASE WHEN h24 THEN 1 ELSE 0 END)
        FROM locations
        WHERE deleted_at IS NULL
    """).fetchone()
    merrychef_pct = row[0] if row else None
    sunday_pct = row[1] if row else None
    h24_count = int(row[2]) if row and row[2] is not None else 0

    # 4. Data year max
    max_year_row = client.execute("SELECT strftime('%Y', MAX(first_opening_date)) FROM locations WHERE deleted_at IS NULL").fetchone()
    data_year_max = int(max_year_row[0]) if max_year_row and max_year_row[0] else datetime.now().year

    # 5. Last updated (Date modified)
    last_run = client.execute("SELECT updated_at FROM etl_meta WHERE key = 'last_run'").fetchone()
    date_modified = str(last_run[0])[:10] if last_run and last_run[0] else datetime.now().strftime("%Y-%m-%d")

    # 6. Pct since 2023
    pct_since_2023_row = client.execute("""
        SELECT ROUND(100.0 * SUM(CASE WHEN first_opening_date >= '2023-01-01' THEN 1 ELSE 0 END) / COUNT(*), 1)
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
    """).fetchone()
    pct_since_2023 = pct_since_2023_row[0] if pct_since_2023_row and pct_since_2023_row[0] is not None else 0.0

    # 7. Undated stores count
    undated_stores_row = client.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL AND first_opening_date IS NULL").fetchone()
    undated_stores = undated_stores_row[0] if undated_stores_row else 0

    # 8. Oldest store details
    oldest_row = client.execute("""
        SELECT first_opening_date, city, street
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """).fetchone()
    if oldest_row:
        oldest_year = int(str(oldest_row[0])[:4])
        oldest_city = oldest_row[1]
        oldest_street = oldest_row[2]
        oldest_age = datetime.now().year - oldest_year
    else:
        oldest_year = 1998
        oldest_city = "Swarzędz"
        oldest_street = "Rynek 4/5"
        oldest_age = datetime.now().year - oldest_year

    # 9. Newest store details
    newest_row = client.execute("""
        SELECT first_opening_date, city, street
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date DESC LIMIT 1
    """).fetchone()
    newest_year = int(str(newest_row[0])[:4]) if newest_row else datetime.now().year
    newest_city = newest_row[1] if newest_row else "Warszawa"
    newest_street = newest_row[2] if newest_row else "Żytnia 64"

    # 10. Void distance
    void_row = client.execute("SELECT value FROM fun_facts WHERE key = 'farthest_from_zabka'").fetchone()
    void_distance_km = round(float(void_row[0]), 2) if void_row else 46.52

    # 11. Elevation extremes
    top_row = client.execute("""
        SELECT elevation_meters, city, street
        FROM locations
        WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters DESC LIMIT 1
    """).fetchone()
    elevation_max_m = round(top_row[0], 1) if top_row else 962.6
    elevation_max_city = top_row[1] if top_row else "Kościelisko"
    elevation_max_street = top_row[2] if top_row else "Nędzy Kubińca 101"

    bot_row = client.execute("""
        SELECT elevation_meters, city, street
        FROM locations
        WHERE deleted_at IS NULL AND elevation_meters IS NOT NULL
        ORDER BY elevation_meters ASC LIMIT 1
    """).fetchone()
    elevation_min_m = round(bot_row[0], 1) if bot_row else -1.5
    elevation_min_city = bot_row[1] if bot_row else "Gdańsk (port)"
    elevation_min_street = bot_row[2] if bot_row else "Przełom 12"

    # 12. Isolated store (Loner)
    loner_row = client.execute("""
        SELECT nearest_neighbor_distance_meters, city, street
        FROM locations
        WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """).fetchone()
    isolated_max_km = round(loner_row[0] / 1000, 1) if loner_row else 27.3
    isolated_max_city = loner_row[1] if loner_row else "Michałowo"
    isolated_max_street = loner_row[2] if loner_row else "Białostocka 2"

    # 13. Powiat coverage
    powiat_covered_row = client.execute("SELECT COUNT(*) FROM dim_powiat WHERE id IN (SELECT DISTINCT powiat_id FROM locations WHERE deleted_at IS NULL)").fetchone()
    powiat_total_row = client.execute("SELECT COUNT(*) FROM dim_powiat").fetchone()
    powiat_covered = powiat_covered_row[0] if powiat_covered_row else 314
    powiat_total = powiat_total_row[0] if powiat_total_row else 314

    # 14. Neighbor distance statistics (Median/Avg)
    median_row = client.execute("SELECT MEDIAN(nearest_neighbor_distance_meters) FROM locations WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL").fetchone()
    avg_row = client.execute("SELECT AVG(nearest_neighbor_distance_meters) FROM locations WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL").fetchone()
    neighbor_median_m = round(median_row[0]) if median_row and median_row[0] is not None else 299
    neighbor_avg_m = round(avg_row[0]) if avg_row and avg_row[0] is not None else 942

    # 15. Podkarpackie neighbor statistics
    podk_median_row = client.execute("""
        SELECT MEDIAN(nearest_neighbor_distance_meters)
        FROM locations
        WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL
          AND voivodeship_id = (SELECT id FROM dim_voivodeship WHERE lower(name) = 'podkarpackie')
    """).fetchone()
    podk_avg_row = client.execute("""
        SELECT AVG(nearest_neighbor_distance_meters)
        FROM locations
        WHERE deleted_at IS NULL AND nearest_neighbor_distance_meters IS NOT NULL
          AND voivodeship_id = (SELECT id FROM dim_voivodeship WHERE lower(name) = 'podkarpackie')
    """).fetchone()
    podkarpackie_median_m = round(podk_median_row[0]) if podk_median_row and podk_median_row[0] is not None else 459
    podkarpackie_avg_km = round((podk_avg_row[0] or 1800) / 1000, 1) if podk_avg_row and podk_avg_row[0] is not None else 1.8

    # 16. Leader voivodeships
    leader_abs_row = client.execute("""
        SELECT name FROM dim_voivodeship
        WHERE id = (SELECT voivodeship_id FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship_id ORDER BY COUNT(*) DESC LIMIT 1)
    """).fetchone()
    leader_absolute_voiv = cap_name(leader_abs_row[0]) if leader_abs_row else "Mazowieckie"

    leader_pc_row = client.execute("""
        SELECT v.name, ROUND(COUNT(*)*1000.0/v.population, 2) AS per_1k
        FROM dim_voivodeship v
        JOIN locations l ON l.voivodeship_id = v.id
        WHERE l.deleted_at IS NULL
        GROUP BY v.id, v.name, v.population
        ORDER BY per_1k DESC LIMIT 1
    """).fetchone()
    leader_percapita_voiv = cap_name(leader_pc_row[0]) if leader_pc_row else "Pomorskie"
    leader_percapita_value = leader_pc_row[1] if leader_pc_row else 0.46

    # 17. Parks counts
    parks_total_row = client.execute("SELECT COUNT(*) FROM dim_park").fetchone()
    parks_nat_row = client.execute("SELECT COUNT(*) FROM dim_park WHERE type = 'national'").fetchone()
    parks_land_row = client.execute("SELECT COUNT(*) FROM dim_park WHERE type = 'landscape'").fetchone()
    parks_total = parks_total_row[0] if parks_total_row else 259
    parks_national = parks_nat_row[0] if parks_nat_row else 46
    parks_landscape = parks_land_row[0] if parks_land_row else 213

    # 18. InPost Total
    inpost_row = client.execute("SELECT COUNT(*) FROM parcel_lockers WHERE deleted_at IS NULL").fetchone()
    inpost_total = inpost_row[0] if inpost_row else 31852

    # 19. GBIF Total (Amphibians records)
    from backend.api.ecology_router import _gbif_total
    gbif_total = _gbif_total() or 46000

    # 20. Amphibian record count (Most froggy)
    most_frog_row = client.execute("""
        SELECT amphibian_occurrences_5km FROM locations
        WHERE deleted_at IS NULL AND amphibian_occurrences_5km IS NOT NULL
        ORDER BY amphibian_occurrences_5km DESC LIMIT 1
    """).fetchone()
    amphibian_record_count = most_frog_row[0] if most_frog_row else 2028

    # 21. Warsaw stores count
    warsaw_row = client.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL AND LOWER(city) = 'warszawa'").fetchone()
    warsaw_store_count = warsaw_row[0] if warsaw_row else 1100

    # 22. Record year & openings
    rec_year_row = client.execute("""
        SELECT year_actual, COUNT(*) AS openings
        FROM dim_date d
        JOIN locations l ON l.first_opening_date = d.date_actual
        WHERE l.deleted_at IS NULL
        GROUP BY year_actual
        ORDER BY openings DESC LIMIT 1
    """).fetchone()
    record_year = rec_year_row[0] if rec_year_row else 2025
    record_year_openings = rec_year_row[1] if rec_year_row else 1943

    # 23. Gminy coverage pct
    gminy_cov_row = client.execute("""
        SELECT ROUND(100.0 * COUNT(DISTINCT gmina_id) / (SELECT COUNT(*) FROM dim_gmina), 1)
        FROM locations
        WHERE deleted_at IS NULL
    """).fetchone()
    gminy_coverage_pct = gminy_cov_row[0] if gminy_cov_row and gminy_cov_row[0] is not None else 60.0

    # 24. DB Size MB
    db_size_mb = int(round(DB_PATH.stat().st_size / (1024 * 1024))) if DB_PATH.exists() else 48

    # 25. r_salary
    corr_row = client.execute("""
        SELECT corr(dp.avg_salary, COALESCE(l.cnt, 0) / dp.population)
        FROM dim_powiat dp
        LEFT JOIN (
            SELECT powiat_id, COUNT(*) cnt FROM locations
            WHERE deleted_at IS NULL GROUP BY 1
        ) l ON l.powiat_id = dp.id
        WHERE dp.avg_salary IS NOT NULL
    """).fetchone()
    r_salary = round(corr_row[0], 2) if corr_row and corr_row[0] is not None else 0.25

    return {
        "total_active": total_active,
        "total_stores_rounded": total_stores_rounded,
        "cities_count": cities_count,
        "cities_count_rounded": cities_count_rounded,
        "merrychef_pct": merrychef_pct,
        "sunday_pct": sunday_pct,
        "h24_count": h24_count,
        "last_updated": str(last_run[0]) if last_run and last_run[0] else None,
        "data_year_max": data_year_max,
        "date_modified": date_modified,
        "pct_since_2023": pct_since_2023,
        "undated_stores": undated_stores,
        "oldest_store_year": oldest_year,
        "oldest_store_age_years": oldest_age,
        "oldest_store_city": oldest_city,
        "oldest_store_street": oldest_street,
        "newest_store_year": newest_year,
        "newest_store_city": newest_city,
        "newest_store_street": newest_street,
        "void_distance_km": void_distance_km,
        "elevation_max_m": elevation_max_m,
        "elevation_max_city": elevation_max_city,
        "elevation_max_street": elevation_max_street,
        "elevation_min_m": elevation_min_m,
        "elevation_min_city": elevation_min_city,
        "elevation_min_street": elevation_min_street,
        "isolated_max_km": isolated_max_km,
        "isolated_max_city": isolated_max_city,
        "isolated_max_street": isolated_max_street,
        "powiat_covered": powiat_covered,
        "powiat_total": powiat_total,
        "neighbor_median_m": neighbor_median_m,
        "neighbor_avg_m": neighbor_avg_m,
        "podkarpackie_median_m": podkarpackie_median_m,
        "podkarpackie_avg_km": podkarpackie_avg_km,
        "leader_absolute_voiv": leader_absolute_voiv,
        "leader_percapita_voiv": leader_percapita_voiv,
        "leader_percapita_value": leader_percapita_value,
        "parks_total": parks_total,
        "parks_national": parks_national,
        "parks_landscape": parks_landscape,
        "inpost_total": inpost_total,
        "gbif_total": gbif_total,
        "amphibian_record_count": amphibian_record_count,
        "warsaw_store_count": warsaw_store_count,
        "record_year": record_year,
        "record_year_openings": record_year_openings,
        "gminy_coverage_pct": gminy_coverage_pct,
        "db_size_mb": db_size_mb,
        "r_salary": r_salary,
    }

def get_cached_stats() -> dict:
    import json
    from backend.cache import cache
    if cache:
        try:
            val = cache.get("live_stats_dict")
            if val:
                return json.loads(val)
        except Exception:
            pass
    stats = compile_live_stats()
    if cache:
        try:
            cache.setex("live_stats_dict", 3600, json.dumps(stats))
        except Exception:
            pass
    return stats
