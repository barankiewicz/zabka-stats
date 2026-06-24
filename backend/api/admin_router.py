"""
Administrative context API - voivodeship, powiat, city, country.
Hierarchical aggregations for Polish administrative divisions.
"""

from fastapi import APIRouter
from backend.database_ch import client
from backend.cache import cached
from backend.live_data import (
    get_weather_for_location,
    get_light_pollution,
    get_nearby_lightning,
)

router = APIRouter()

@router.get("/stats/by-powiat")
@cached(ttl=3600)
async def get_by_powiat(voivodeship: str = None):
    """Get statistics aggregated by powiat (county)."""

    where = ""
    if voivodeship:
        where = f"WHERE voivodeship = '{voivodeship}' AND deleted_at IS NULL"
    else:
        where = "WHERE deleted_at IS NULL"

    results = client.execute(f"""
        SELECT
            voivodeship,
            powiat,
            COUNT(*) as total,
            SUM(has_merrychef) as with_merrychef,
            SUM(open_sunday) as open_sunday,
            SUM(h24) as h24
        FROM locations
        {where}
        GROUP BY voivodeship, powiat
        ORDER BY voivodeship, total DESC
    """).fetchall()

    # Group by voivodeship
    by_voiv = {}
    for row in results:
        voiv = row[0]
        if voiv not in by_voiv:
            by_voiv[voiv] = []

        by_voiv[voiv].append({
            "powiat": row[1],
            "total": row[2],
            "with_merrychef": row[3] or 0,
            "open_sunday": row[4] or 0,
            "h24": row[5] or 0,
        })

    return {
        "data": by_voiv
    }

@router.get("/stats/by-city")
@cached(ttl=3600)
async def get_by_city(powiat: str = None, voivodeship: str = None):
    """Get statistics aggregated by city."""

    where = "WHERE deleted_at IS NULL"
    if voivodeship:
        where += f" AND voivodeship = '{voivodeship}'"
    if powiat:
        where += f" AND powiat = '{powiat}'"

    results = client.execute(f"""
        SELECT
            city,
            voivodeship,
            powiat,
            COUNT(*) as total,
            SUM(has_merrychef) as with_merrychef,
            SUM(open_sunday) as open_sunday,
            SUM(h24) as h24
        FROM locations
        {where}
        GROUP BY city, voivodeship, powiat
        ORDER BY total DESC
    """).fetchall()

    return {
        "data": [
            {
                "city": r[0],
                "voivodeship": r[1],
                "powiat": r[2],
                "total": r[3],
                "with_merrychef": r[4] or 0,
                "open_sunday": r[5] or 0,
                "h24": r[6] or 0,
            }
            for r in results
        ]
    }

@router.get("/hierarchy/voivodeships")
@cached(ttl=86400)
async def get_voivodeships():
    """Get all voivodeships with their powiats and cities."""

    voivodeships = client.execute("""
        SELECT DISTINCT voivodeship
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY voivodeship
    """).fetchall()

    result = {}
    for (voiv,) in voivodeships:
        # Get powiats in this voivodeship
        powiats_data = client.execute(f"""
            SELECT DISTINCT powiat, COUNT(*) as count
            FROM locations
            WHERE voivodeship = '{voiv}' AND deleted_at IS NULL
            GROUP BY powiat
            ORDER BY count DESC
        """).fetchall()

        powiats = {}
        for powiat, count in powiats_data:
            # Get cities in this powiat
            cities_data = client.execute(f"""
                SELECT DISTINCT city, COUNT(*) as count
                FROM locations
                WHERE voivodeship = '{voiv}' AND powiat = '{powiat}' AND deleted_at IS NULL
                GROUP BY city
                ORDER BY count DESC
            """).fetchall()

            powiats[powiat] = {
                "count": count,
                "cities": [{"city": c[0], "count": c[1]} for c in cities_data]
            }

        result[voiv] = powiats

    return {
        "hierarchy": result
    }

@router.get("/context/{lat}/{lon}")
@cached(ttl=86400)
async def get_location_context(lat: float, lon: float):
    """Get administrative context for coordinates using nearest location."""

    # Find nearest location to get context
    nearest = client.execute(f"""
        SELECT
            'Żabka' AS name,
            street,
            city,
            powiat,
            voivodeship,
            COUNT(*) OVER (PARTITION BY voivodeship) as voiv_count,
            COUNT(*) OVER (PARTITION BY powiat) as powiat_count,
            COUNT(*) OVER (PARTITION BY city) as city_count
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY
            sqrt(pow(latitude - {lat}, 2) + pow(longitude - {lon}, 2))
        LIMIT 1
    """).fetchone()

    if not nearest:
        return {"error": "No locations found"}

    row = nearest
    return {
        "nearest_location": row[0],
        "street": row[1],
        "city": row[2],
        "city_count": int(row[7]),
        "powiat": row[3],
        "powiat_count": int(row[6]),
        "voivodeship": row[4],
        "voivodeship_count": int(row[5]),
        "country": "Polska",
        "coordinates": {"lat": lat, "lon": lon},
    }

@router.get("/fun/extremes")
@cached(ttl=3600)
async def get_extremes():
    """Get extreme points - najfajniejsze Żabki!"""

    northernmost = client.execute("""
        SELECT id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude DESC
        LIMIT 1
    """).fetchone()

    southernmost = client.execute("""
        SELECT id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude ASC
        LIMIT 1
    """).fetchone()

    easternmost = client.execute("""
        SELECT id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude DESC
        LIMIT 1
    """).fetchone()

    westernmost = client.execute("""
        SELECT id, 'Żabka' AS name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude ASC
        LIMIT 1
    """).fetchone()

    def format_location(row):
        return {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "lat": row[5],
            "lon": row[6],
        }

    return {
        "_najwyżej_północy": format_location(northernmost),
        "_najniżej_południu": format_location(southernmost),
        "_najbardziej_wschód": format_location(easternmost),
        "_najbardziej_zachód": format_location(westernmost),
    }

@router.get("/stats/administrative-summary")
@cached(ttl=3600)
async def get_administrative_summary():
    """Summary: country → voivodeships → powiats → cities."""

    return {
        "country": "Polska",
        "voivodeships": client.execute("""
            SELECT voivodeship, COUNT(*) as count
            FROM locations
            WHERE deleted_at IS NULL
            GROUP BY voivodeship
            ORDER BY count DESC
        """).fetchall(),
        "total_powiats": client.execute("""
            SELECT COUNT(DISTINCT powiat)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
        "total_cities": client.execute("""
            SELECT COUNT(DISTINCT city)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
        "total_locations": client.execute("""
            SELECT COUNT(*)
            FROM locations
            WHERE deleted_at IS NULL
        """).fetchone()[0],
    }


@router.get("/live/best-worst-weather")
async def get_best_worst_weather():
    """
    LIVE - najbardziej sloneczna i najmokrzejsza Zabka teraz.
    Swieze dane z Open-Meteo dla wszystkich 16 wojewodztw.
    """
    locations = client.execute("""
        SELECT id, city, powiat, voivodeship, latitude, longitude
        FROM (
            SELECT id, city, powiat, voivodeship, latitude, longitude,
                   ROW_NUMBER() OVER (PARTITION BY voivodeship ORDER BY id) as rn
            FROM locations
            WHERE deleted_at IS NULL
        )
        WHERE rn = 1
    """).fetchall()

    if not locations:
        return {"error": "No locations found"}

    loc_list = [
        {
            "id": row[0],
            "city": row[1],
            "powiat": row[2],
            "voivodeship": row[3],
            "latitude": row[4],
            "longitude": row[5],
        }
        for row in locations
    ]

    RAIN_CODES = {51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99}

    results = []
    for loc in loc_list:
        weather = get_weather_for_location(loc["latitude"], loc["longitude"], loc["voivodeship"])
        if weather:
            wcode = weather.get("weather_code", 3)
            precip = weather.get("precipitation", 0.0) or 0.0
            sunny_score = (max(0, 2 - wcode) * 10) + weather["apparent_temperature"] - precip * 5
            wet_score = precip * 10 + (50 if wcode in RAIN_CODES else 0) + weather["humidity"] / 10
            results.append({
                **loc,
                "weather": weather,
                "sunny_score": sunny_score,
                "wet_score": wet_score,
            })

    if not results:
        return {"error": "Could not fetch weather data"}

    sunniest = max(results, key=lambda x: x["sunny_score"])
    wettest = max(results, key=lambda x: x["wet_score"])

    def _loc(r):
        return {
            "id": r["id"],
            "city": r["city"],
            "powiat": r["powiat"],
            "voivodeship": r["voivodeship"],
            "lat": r["latitude"],
            "lon": r["longitude"],
        }

    return {
        "sunniest_now": {
            "location": _loc(sunniest),
            "weather": sunniest["weather"],
            "message": f"Najbardziej sloneczna: {sunniest['city']} ({sunniest['voivodeship']}) - {sunniest['weather']['temperature']}C, {sunniest['weather']['weather_description']}",
        },
        "wettest_now": {
            "location": _loc(wettest),
            "weather": wettest["weather"],
            "message": f"Najmokrzejsza: {wettest['city']} ({wettest['voivodeship']}) - {wettest['weather']['precipitation']} mm, {wettest['weather']['weather_description']}",
        },
    }


@router.get("/live/darkest-sky-stargazing")
async def get_darkest_sky_for_stargazing():
    """
    LIVE - najciemniejsza i najjaśniejsza Żabka w Polsce.
    Zmaterializowane dane o zanieczyszczeniu swiatlem (Bortle) z DuckDB.
    """
    darkest_row = client.execute("""
        SELECT id, city, powiat, voivodeship, latitude, longitude,
               light_pollution_brightness, bortle_scale
        FROM locations
        WHERE deleted_at IS NULL AND bortle_scale IS NOT NULL
        ORDER BY light_pollution_brightness ASC
        LIMIT 1
    """).fetchone()

    brightest_row = client.execute("""
        SELECT id, city, powiat, voivodeship, latitude, longitude,
               light_pollution_brightness, bortle_scale
        FROM locations
        WHERE deleted_at IS NULL AND bortle_scale IS NOT NULL
        ORDER BY light_pollution_brightness DESC
        LIMIT 1
    """).fetchone()

    if not darkest_row or not brightest_row:
        darkest_row = client.execute("""
            SELECT id, city, powiat, voivodeship, latitude, longitude, 120.0, 5
            FROM locations WHERE deleted_at IS NULL LIMIT 1
        """).fetchone()
        brightest_row = darkest_row

    bortle_descriptions = {
        1: "Pristine Dark Sky",
        2: "Excellent Dark Sky",
        3: "Very Good Dark Sky",
        4: "Rural Sky",
        5: "Suburban Sky",
        6: "Bright Suburban Sky",
        7: "Urban Transition Sky",
        8: "City Sky",
        9: "Inner-City Sky"
    }

    def _loc_lp(row):
        brightness = row[6] or 120.0
        bortle = int(row[7]) if row[7] is not None else 5
        desc = bortle_descriptions.get(bortle, "Moderate Light Pollution")
        return {
            "location": {
                "id": row[0],
                "city": row[1],
                "powiat": row[2],
                "voivodeship": row[3],
                "lat": row[4],
                "lon": row[5],
            },
            "light_pollution": {
                "brightness_level": brightness,
                "bortle_scale": bortle,
                "description": desc,
                "suitable_for_stargazing": bortle <= 5,
                "milky_way_visible": bortle <= 4,
                "planets_visible": bortle <= 7,
            },
            "milky_way_visible": bortle <= 4,
        }

    darkest_data = _loc_lp(darkest_row)
    brightest_data = _loc_lp(brightest_row)

    darkest_data["message"] = f"Najciemniejsza: {darkest_row[1]} ({darkest_row[3]}) - {darkest_data['light_pollution']['description']} (Bortle {darkest_data['light_pollution']['bortle_scale']})"
    brightest_data["message"] = f"Najjasniejsza: {brightest_row[1]} ({brightest_row[3]}) - {brightest_data['light_pollution']['description']} (Bortle {brightest_data['light_pollution']['bortle_scale']})"

    return {
        "darkest_now": darkest_data,
        "brightest_now": brightest_data,
    }


@router.get("/live/lightning-danger")
async def get_lightning_danger():
    """
    LIVE - zagrozenie piorunami teraz.
    Oceniane w oparciu o 16 wojewodzkich stref pogodowych.
    """
    locations = client.execute("""
        SELECT id, city, powiat, voivodeship, latitude, longitude
        FROM (
            SELECT id, city, powiat, voivodeship, latitude, longitude,
                   ROW_NUMBER() OVER (PARTITION BY voivodeship ORDER BY id) as rn
            FROM locations
            WHERE deleted_at IS NULL
        )
        WHERE rn = 1
    """).fetchall()

    if not locations:
        return {"error": "No locations found"}

    loc_list = [
        {
            "id": row[0],
            "city": row[1],
            "powiat": row[2],
            "voivodeship": row[3],
            "latitude": row[4],
            "longitude": row[5],
        }
        for row in locations
    ]

    danger_scores = []
    for loc in loc_list:
        lightning = get_nearby_lightning(loc["latitude"], loc["longitude"])
        if lightning:
            danger_map = {"DANGER": 3, "WARNING": 2, "SAFE": 1}
            score = danger_map.get(lightning["danger_level"], 0)
            danger_scores.append({**loc, "lightning": lightning, "danger_score": score})

    if not danger_scores:
        return {"error": "Could not fetch lightning data"}

    most_dangerous = max(danger_scores, key=lambda x: x["danger_score"])
    safest = min(danger_scores, key=lambda x: x["danger_score"])
    most_active = max(danger_scores, key=lambda x: x["lightning"].get("strikes_last_hour") or 0)

    def _loc(r):
        return {
            "id": r["id"],
            "city": r["city"],
            "powiat": r["powiat"],
            "voivodeship": r["voivodeship"],
            "lat": r["latitude"],
            "lon": r["longitude"],
        }

    return {
        "most_dangerous_now": {
            "location": _loc(most_dangerous),
            "lightning": most_dangerous["lightning"],
            "message": f"{most_dangerous['city']} ({most_dangerous['voivodeship']}) - {most_dangerous['lightning']['danger_level']}",
        },
        "safest_now": {
            "location": _loc(safest),
            "lightning": safest["lightning"],
            "message": f"{safest['city']} ({safest['voivodeship']}) - {safest['lightning']['danger_level']}",
        },
        "most_active_lightning_now": {
            "location": _loc(most_active),
            "lightning": most_active["lightning"],
            "message": f"{most_active['city']} ({most_active['voivodeship']}) - {most_active['lightning'].get('strikes_last_hour', 0)} piorunow w ostatniej godzinie",
        },
    }
