"""
Administrative context API - voivodeship, powiat, city, country.
Hierarchical aggregations for Polish administrative divisions.
Live weather and air quality (NO caching - always fresh!)
"""

from fastapi import APIRouter
from backend.database_ch import client
from backend.cache import cached
from backend.live_data import (
    get_weather_for_location,
    get_air_quality_for_location,
    get_light_pollution,
    get_nearby_lightning
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
    """)

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
    """)

    result = {}
    for (voiv,) in voivodeships:
        # Get powiats in this voivodeship
        powiats_data = client.execute(f"""
            SELECT DISTINCT powiat, COUNT(*) as count
            FROM locations
            WHERE voivodeship = '{voiv}' AND deleted_at IS NULL
            GROUP BY powiat
            ORDER BY count DESC
        """)

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
            name,
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
    """)

    if not nearest:
        return {"error": "No locations found"}

    row = nearest[0]
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
        SELECT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude DESC
        LIMIT 1
    """).fetchone().fetchone()[0]

    southernmost = client.execute("""
        SELECT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude ASC
        LIMIT 1
    """).fetchone()[0]

    easternmost = client.execute("""
        SELECT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude DESC
        LIMIT 1
    """).fetchone()[0]

    westernmost = client.execute("""
        SELECT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY longitude ASC
        LIMIT 1
    """).fetchone()[0]

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
        """)[0][0],
        "total_cities": client.execute("""
            SELECT COUNT(DISTINCT city)
            FROM locations
            WHERE deleted_at IS NULL
        """)[0][0],
        "total_locations": client.execute("""
            SELECT COUNT(*)
            FROM locations
            WHERE deleted_at IS NULL
        """)[0][0],
    }

@router.get("/live/best-worst-weather")
async def get_best_worst_weather():
    """
    LIVE - najlepszy i najgorszy weather teraz!
    Za każdym razem świeże dane z Open-Meteo.
    """

    # Get all active locations for weather scoring
    locations = client.execute("""
        SELECT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY latitude, longitude
    """).fetchall()

    if not locations:
        return {"error": "No locations found"}

    # Prepare location data
    loc_list = [
        {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "latitude": row[5],
            "longitude": row[6],
        }
        for row in locations
    ]

    # Score weather for each location
    scores = []
    for loc in loc_list:
        weather = get_weather_for_location(loc["latitude"], loc["longitude"])
        if weather:
            # Higher temp + lower wind = better
            score = weather["temperature"] - (weather["wind_speed"] / 10)
            scores.append({
                **loc,
                "weather": weather,
                "score": score
            })

    if not scores:
        return {"error": "Could not fetch weather data"}

    best = max(scores, key=lambda x: x["score"])
    worst = min(scores, key=lambda x: x["score"])

    return {
        "best_weather_now": {
            "location": {
                "id": best["id"],
                "name": best["name"],
                "city": best["city"],
                "powiat": best["powiat"],
                "voivodeship": best["voivodeship"],
                "lat": best["latitude"],
                "lon": best["longitude"],
            },
            "weather": best["weather"],
            "score": round(best["score"], 1),
            "message": f" Najlepsza pogoda: {best['name']} ({best['city']}) - {best['weather']['temperature']}°C, {best['weather']['weather_description']}"
        },
        "worst_weather_now": {
            "location": {
                "id": worst["id"],
                "name": worst["name"],
                "city": worst["city"],
                "powiat": worst["powiat"],
                "voivodeship": worst["voivodeship"],
                "lat": worst["latitude"],
                "lon": worst["longitude"],
            },
            "weather": worst["weather"],
            "score": round(worst["score"], 1),
            "message": f" Najgorsza pogoda: {worst['name']} ({worst['city']}) - {worst['weather']['temperature']}°C, {worst['weather']['weather_description']}"
        }
    }

@router.get("/live/air-quality-extremes")
async def get_air_quality_extremes():
    """
    LIVE - najlepsze i najgorsze powietrze teraz!
    Za każdym razem świeże dane z GIOŚ.
    """

    # Get strategic locations for AQ monitoring
    locations = client.execute("""
        SELECT DISTINCT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY RANDOM()
        LIMIT 20
    """)

    if not locations:
        return {"error": "No locations found"}

    loc_list = [
        {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "latitude": row[5],
            "longitude": row[6],
        }
        for row in locations
    ]

    # Get AQ for each location
    scores = []
    for loc in loc_list:
        aq = get_air_quality_for_location(loc["latitude"], loc["longitude"])
        if aq:
            # Lower pollutants = better
            score = -(
                (aq.get("pm25") or 999) +
                (aq.get("pm10") or 999) +
                (aq.get("no2") or 999)
            )
            scores.append({
                **loc,
                "air_quality": aq,
                "score": score
            })

    if not scores:
        return {"error": "Could not fetch air quality data"}

    best = max(scores, key=lambda x: x["score"])
    worst = min(scores, key=lambda x: x["score"])

    aqi_emoji = {
        "GOOD": "",
        "FAIR": "",
        "MODERATE": "",
        "POOR": "",
        "VERY_POOR": "",
        "EXTREMELY_POOR": ""
    }

    return {
        "best_air_quality_now": {
            "location": {
                "id": best["id"],
                "name": best["name"],
                "city": best["city"],
                "powiat": best["powiat"],
                "voivodeship": best["voivodeship"],
                "lat": best["latitude"],
                "lon": best["longitude"],
            },
            "air_quality": best["air_quality"],
            "score": round(best["score"], 1),
            "message": f"{aqi_emoji.get(best['air_quality'].get('aqi_category'), '')} Najczystsze powietrze: {best['name']} ({best['city']}) - {best['air_quality'].get('aqi_category')}"
        },
        "worst_air_quality_now": {
            "location": {
                "id": worst["id"],
                "name": worst["name"],
                "city": worst["city"],
                "powiat": worst["powiat"],
                "voivodeship": worst["voivodeship"],
                "lat": worst["latitude"],
                "lon": worst["longitude"],
            },
            "air_quality": worst["air_quality"],
            "score": round(worst["score"], 1),
            "message": f"{aqi_emoji.get(worst['air_quality'].get('aqi_category'), '')} Najgorsze powietrze: {worst['name']} ({worst['city']}) - {worst['air_quality'].get('aqi_category')}"
        }
    }

@router.get("/live/darkest-sky-stargazing")
async def get_darkest_sky_for_stargazing():
    """
    LIVE -  Najciemniejsza Żabka do obserwacji gwiazd!
    Za każdym razem świeże dane z OpenLightMap.
    """

    # Get strategic locations (sample for performance)
    locations = client.execute("""
        SELECT DISTINCT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY RANDOM()
        LIMIT 15
    """)

    if not locations:
        return {"error": "No locations found"}

    loc_list = [
        {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "latitude": row[5],
            "longitude": row[6],
        }
        for row in locations
    ]

    # Get light pollution for each location
    scores = []
    for loc in loc_list:
        lp = get_light_pollution(loc["latitude"], loc["longitude"])
        if lp and lp.get("brightness_level") is not None:
            # Lower brightness = better for stargazing (inverse scoring)
            score = -(lp["brightness_level"])  # Negative = lower is better
            scores.append({
                **loc,
                "light_pollution": lp,
                "score": score
            })

    if not scores:
        return {"error": "Could not fetch light pollution data"}

    best = max(scores, key=lambda x: x["score"])  # Darkest = best for stargazing
    worst = min(scores, key=lambda x: x["score"])  # Brightest = worst

    return {
        "best_stargazing_spot_now": {
            "location": {
                "id": best["id"],
                "name": best["name"],
                "city": best["city"],
                "powiat": best["powiat"],
                "voivodeship": best["voivodeship"],
                "lat": best["latitude"],
                "lon": best["longitude"],
            },
            "light_pollution": best["light_pollution"],
            "milky_way_visible": best["light_pollution"]["milky_way_visible"],
            "message": f" Najciemniejsza Żabka: {best['name']} ({best['city']}) - {best['light_pollution']['description']} (Bortle {best['light_pollution']['bortle_scale']})"
        },
        "worst_stargazing_spot_now": {
            "location": {
                "id": worst["id"],
                "name": worst["name"],
                "city": worst["city"],
                "powiat": worst["powiat"],
                "voivodeship": worst["voivodeship"],
                "lat": worst["latitude"],
                "lon": worst["longitude"],
            },
            "light_pollution": worst["light_pollution"],
            "milky_way_visible": worst["light_pollution"]["milky_way_visible"],
            "message": f" Najjaśniejsza Żabka: {worst['name']} ({worst['city']}) - {worst['light_pollution']['description']} (Bortle {worst['light_pollution']['bortle_scale']})"
        }
    }

@router.get("/live/lightning-danger")
async def get_lightning_danger():
    """
    LIVE -  Świetlne zjawiska teraz!
    Gdzie są pioruny, gdzie jest niebezpiecznie.
    """

    # Get strategic locations
    locations = client.execute("""
        SELECT DISTINCT id, name, city, powiat, voivodeship, latitude, longitude
        FROM locations
        WHERE deleted_at IS NULL
        ORDER BY RANDOM()
        LIMIT 12
    """)

    if not locations:
        return {"error": "No locations found"}

    loc_list = [
        {
            "id": row[0],
            "name": row[1],
            "city": row[2],
            "powiat": row[3],
            "voivodeship": row[4],
            "latitude": row[5],
            "longitude": row[6],
        }
        for row in locations
    ]

    # Get lightning data for each location
    danger_scores = []
    for loc in loc_list:
        lightning = get_nearby_lightning(loc["latitude"], loc["longitude"])
        if lightning:
            # Score: DANGER=3, WARNING=2, SAFE=1
            danger_map = {"DANGER": 3, "WARNING": 2, "SAFE": 1}
            score = danger_map.get(lightning["danger_level"], 0)
            danger_scores.append({
                **loc,
                "lightning": lightning,
                "danger_score": score
            })

    if not danger_scores:
        return {"error": "Could not fetch lightning data"}

    most_dangerous = max(danger_scores, key=lambda x: x["danger_score"])
    safest = min(danger_scores, key=lambda x: x["danger_score"])

    # Find most active (most strikes)
    most_active = max(danger_scores, key=lambda x: x["lightning"]["strikes_last_hour"] or 0)

    danger_emoji = {
        "DANGER": "",
        "WARNING": "",
        "SAFE": ""
    }

    return {
        "most_dangerous_now": {
            "location": {
                "id": most_dangerous["id"],
                "name": most_dangerous["name"],
                "city": most_dangerous["city"],
                "powiat": most_dangerous["powiat"],
                "voivodeship": most_dangerous["voivodeship"],
                "lat": most_dangerous["latitude"],
                "lon": most_dangerous["longitude"],
            },
            "lightning": most_dangerous["lightning"],
            "message": f"{danger_emoji.get(most_dangerous['lightning']['danger_level'], '')} {most_dangerous['name']} ({most_dangerous['city']}) - {most_dangerous['lightning']['danger_level']}"
        },
        "safest_now": {
            "location": {
                "id": safest["id"],
                "name": safest["name"],
                "city": safest["city"],
                "powiat": safest["powiat"],
                "voivodeship": safest["voivodeship"],
                "lat": safest["latitude"],
                "lon": safest["longitude"],
            },
            "lightning": safest["lightning"],
            "message": f"{danger_emoji.get(safest['lightning']['danger_level'], '')} {safest['name']} ({safest['city']}) - {safest['lightning']['danger_level']}"
        },
        "most_active_lightning_now": {
            "location": {
                "id": most_active["id"],
                "name": most_active["name"],
                "city": most_active["city"],
                "powiat": most_active["powiat"],
                "voivodeship": most_active["voivodeship"],
                "lat": most_active["latitude"],
                "lon": most_active["longitude"],
            },
            "lightning": most_active["lightning"],
            "message": f" {most_active['name']} ({most_active['city']}) - {most_active['lightning']['strikes_last_hour']} piorunów w ostatniej godzinie!"
        }
    }
