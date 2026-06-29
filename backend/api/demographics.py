import logging

from backend.database_ch import client

logger = logging.getLogger("demographics")

# Lowercase, diacritic-free mappings
VOIV_POPULATION_CACHE = {}
VOIV_AREA_CACHE = {}

# Hardcoded fallback values from GUS 2024
FALLBACK_POP = {
    "mazowieckie": 5540000, "slaskie": 4350000, "dolnoslaskie": 2900000,
    "wielkopolskie": 3500000, "malopolskie": 3430000, "pomorskie": 2350000,
    "lodzkie": 2380000, "zachodniopomorskie": 1660000,
    "kujawsko-pomorskie": 2010000, "lubelskie": 2040000,
    "podkarpackie": 2080000, "warminsko-mazurskie": 1380000,
    "lubuskie": 980000, "swietokrzyskie": 1180000,
    "opolskie": 950000, "podlaskie": 1160000,
}

FALLBACK_AREA = {
    "mazowieckie": 35559.0, "slaskie": 12333.0, "dolnoslaskie": 19947.0,
    "wielkopolskie": 29826.0, "malopolskie": 15183.0, "pomorskie": 18310.0,
    "lodzkie": 18219.0, "zachodniopomorskie": 22905.0,
    "kujawsko-pomorskie": 17972.0, "lubelskie": 25122.0,
    "podkarpackie": 17846.0, "warminsko-mazurskie": 24173.0,
    "lubuskie": 13988.0, "swietokrzyskie": 11711.0,
    "opolskie": 9412.0, "podlaskie": 20187.0,
}

def normalize_voivodeship(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    replacements = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
        'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z'
    }
    for orig, rep in replacements.items():
        s = s.replace(orig, rep)
    return s

def load_demographics_from_db():
    """Load demographic values from dim_voivodeship into cache."""
    try:
        rows = client.execute("SELECT name, population, area_km2 FROM dim_voivodeship").fetchall()
        if rows:
            VOIV_POPULATION_CACHE.clear()
            VOIV_AREA_CACHE.clear()
            for name, pop, area in rows:
                if name:
                    norm = normalize_voivodeship(name)
                    if pop and pop > 0:
                        VOIV_POPULATION_CACHE[norm] = int(pop)
                    if area and area > 0:
                        VOIV_AREA_CACHE[norm] = float(area)
            logger.info("Successfully loaded voivodeship demographics from database.")
    except Exception as e:
        logger.warning(f"Could not load demographics from database, using fallbacks: {e}")

def get_voiv_population(name: str) -> int:
    norm = normalize_voivodeship(name)
    return VOIV_POPULATION_CACHE.get(norm) or FALLBACK_POP.get(norm, 0)

def get_voiv_area(name: str) -> float:
    norm = normalize_voivodeship(name)
    return VOIV_AREA_CACHE.get(norm) or FALLBACK_AREA.get(norm, 0.0)
