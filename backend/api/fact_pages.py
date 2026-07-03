"""
Standalone single-fact share pages and their per-fact OG preview images.

Each fact gets its own URL (/fakt/<slug>) so a Reddit/Twitter link points at
one striking stat instead of the whole dashboard, and its own OG image
(/fakt/<slug>/og.png) so the link preview shows that stat instead of the
generic homepage card. See CLAUDE.md for the site's data model - each query
below mirrors an existing endpoint's logic (kraniec-facts, neighbor-stats,
network-origin) rather than introducing new SQL.

FACTS is built lazily (same pattern as _pow_geo()/_voiv_area() in
geo_router.py): a fact/image request builds it on first access if the
on_startup hook hasn't run yet, so a slow or skipped startup hook degrades to
one slightly slower request instead of a permanent 404.
"""

import pathlib
import re

from litestar import Router, get
from litestar.exceptions import HTTPException
from litestar.response import Response

from backend.database import client
from backend.og_image import render_fact_card

BASE_URL = "https://zabkozbior.barankiewicz.dev"

_project_root = pathlib.Path(__file__).parent.parent.parent
_INDEX_HTML_PATH = _project_root / "frontend" / "dist" / "index.html"

FACTS: dict[str, dict] = {}
_OG_IMAGES: dict[str, bytes] = {}
_INDEX_HTML_CACHE: str | None = None


def _query_facts() -> dict[str, dict]:
    facts: dict[str, dict] = {}

    void = client.execute(
        "SELECT value, lat, lon FROM fun_facts WHERE key = 'farthest_from_zabka'"
    ).fetchone()
    void_str = str(round(float(void[0]), 2)).replace(".", ",") if void else "46,52"
    facts["pustka-bieszczadzka"] = {
        "fact_id": "void",
        "title": f"Pustka Bieszczad: {void_str} km od najbliższej Żabki",
        "description": (
            f"Gdzieś w Bieszczadach jest punkt oddalony o {void_str} km od "
            "najbliższej Żabki - największa biała plama na mapie ponad 13 "
            "tysięcy sklepów w Polsce."
        ),
        "og_kicker": "Pustka Bieszczad",
        "og_value": f"{void_str} km",
        "og_subtitle": "od najbliższej Żabki",
        "og_footer": "Bieszczady, podkarpackie",
    }

    loner = client.execute("""
        SELECT city, voivodeship, nearest_neighbor_distance_meters
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """).fetchone()
    loner_city = loner[0] if loner else "Michałowo"
    loner_voiv = loner[1] if loner else "podlaskie"
    loner_km_str = str(round((loner[2] if loner else 27321) / 1000, 1)).replace(".", ",")
    facts["samotna-zabka"] = {
        "fact_id": "isolated",
        "title": f"Najbardziej samotna Żabka w Polsce: {loner_km_str} km do sąsiadki",
        "description": (
            f"W {loner_city} ({loner_voiv}) stoi Żabka, której najbliższa "
            f"siostra jest {loner_km_str} km dalej - najbardziej odizolowany "
            "sklep w całej sieci."
        ),
        "og_kicker": "Najdalej od sąsiadki",
        "og_value": f"{loner_km_str} km",
        "og_subtitle": "do najbliższej Żabki",
        "og_footer": f"{loner_city}, {loner_voiv}",
    }

    oldest = client.execute("""
        SELECT city, voivodeship, first_opening_date
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """).fetchone()
    oldest_city = oldest[0] if oldest else "Swarzędz"
    oldest_voiv = oldest[1] if oldest else "wielkopolskie"
    oldest_year = str(oldest[2])[:4] if oldest else "1998"
    facts["najstarsza-zabka"] = {
        "fact_id": "oldest",
        "title": f"Najstarsza wciąż działająca Żabka: {oldest_city}, {oldest_year}",
        "description": (
            f"Ta Żabka w {oldest_city} działa nieprzerwanie od {oldest_year} "
            "roku - najstarszy wciąż czynny sklep w całej sieci ponad 13 "
            "tysięcy Żabek."
        ),
        "og_kicker": "Najstarsza aktywna",
        "og_value": oldest_year,
        "og_subtitle": "wciąż działa",
        "og_footer": f"{oldest_city}, {oldest_voiv}",
    }

    facts["zielonej-zabki"] = {
        "fact_id": "frog",
        "title": "Żabka na ulicy Zielonej Żabki",
        "description": (
            "W Żabiej Woli, przy ulicy Zielonej Żabki 7, stoi sklep, który "
            "sam siebie reklamuje. Sprawdziliśmy, czy sieć faktycznie jest "
            "nazwana od żaby."
        ),
        "og_kicker": "Perła kolekcji",
        "og_value": "ul. Zielonej Żabki 7",
        "og_subtitle": "Żabka na Żabiej",
        "og_footer": "Żabia Wola, mazowieckie",
    }

    median = client.execute("""
        SELECT MEDIAN(nearest_neighbor_distance_meters)
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
    """).fetchone()
    median_m = round(float(median[0])) if median and median[0] is not None else 299
    facts["mediana-odleglosci"] = {
        "fact_id": None,
        "title": f"Połowa Żabek ma sąsiadkę bliżej niż {median_m} m",
        "description": (
            f"Mediana odległości do najbliższej Żabki to zaledwie {median_m} "
            "metrów. Połowa z ponad 13 tysięcy sklepów w Polsce ma inną "
            "Żabkę bliżej niż trzy minuty spacerem."
        ),
        "og_kicker": "Najbliższy sąsiad",
        "og_value": f"{median_m} m",
        "og_subtitle": "mediana odległości do najbliższej Żabki",
        "og_footer": "cała sieć, Polska",
    }

    return facts


def _ensure_facts() -> dict[str, dict]:
    global FACTS
    if not FACTS:
        FACTS = _query_facts()
        for slug, fact in FACTS.items():
            _OG_IMAGES[slug] = render_fact_card(
                kicker=fact["og_kicker"],
                value=fact["og_value"],
                subtitle=fact["og_subtitle"],
                footer=fact["og_footer"],
            )
    return FACTS


def startup_facts() -> None:
    _ensure_facts()


def _load_index_html() -> str:
    global _INDEX_HTML_CACHE
    if _INDEX_HTML_CACHE is None:
        _INDEX_HTML_CACHE = _INDEX_HTML_PATH.read_text(encoding="utf-8")
    return _INDEX_HTML_CACHE


def _tag_sub(html: str, pattern: str, replacement: str) -> str:
    return re.sub(pattern, lambda _m: replacement, html, count=1)


def _inject_meta(html: str, slug: str, fact: dict) -> str:
    title = f"{fact['title']} – Żabkozbiór"
    description = fact["description"]
    url = f"{BASE_URL}/fakt/{slug}"
    image_url = f"{BASE_URL}/fakt/{slug}/og.png"

    html = _tag_sub(html, r"<title>.*?</title>", f"<title>{title}</title>")
    html = _tag_sub(html, r'<meta name="description" content="[^"]*">',
                     f'<meta name="description" content="{description}">')
    html = _tag_sub(html, r'<link rel="canonical" href="[^"]*">',
                     f'<link rel="canonical" href="{url}">')
    html = _tag_sub(html, r'<meta property="og:url" content="[^"]*">',
                     f'<meta property="og:url" content="{url}">')
    html = _tag_sub(html, r'<meta property="og:title" content="[^"]*">',
                     f'<meta property="og:title" content="{title}">')
    html = _tag_sub(html, r'<meta property="og:description" content="[^"]*">',
                     f'<meta property="og:description" content="{description}">')
    html = _tag_sub(html, r'<meta property="og:image" content="[^"]*">',
                     f'<meta property="og:image" content="{image_url}">')
    html = _tag_sub(html, r'<meta property="og:image:alt" content="[^"]*">',
                     f'<meta property="og:image:alt" content="{title}">')
    html = _tag_sub(html, r'<meta name="twitter:title" content="[^"]*">',
                     f'<meta name="twitter:title" content="{title}">')
    html = _tag_sub(html, r'<meta name="twitter:description" content="[^"]*">',
                     f'<meta name="twitter:description" content="{description}">')
    html = _tag_sub(html, r'<meta name="twitter:image" content="[^"]*">',
                     f'<meta name="twitter:image" content="{image_url}">')
    html = _tag_sub(html, r'<meta name="twitter:image:alt" content="[^"]*">',
                     f'<meta name="twitter:image:alt" content="{title}">')
    return html


@get("/fakt/{slug:str}", sync_to_thread=True)
def fact_page(slug: str) -> Response:
    facts = _ensure_facts()
    fact = facts.get(slug)
    if fact is None:
        raise HTTPException(status_code=404, detail="Nie znaleziono takiego faktu")
    html = _inject_meta(_load_index_html(), slug, fact)
    return Response(content=html, media_type="text/html")


@get("/fakt/{slug:str}/og.png", sync_to_thread=True)
def fact_og_image(slug: str) -> Response:
    facts = _ensure_facts()
    if slug not in facts:
        raise HTTPException(status_code=404, detail="Nie znaleziono takiego faktu")
    return Response(content=_OG_IMAGES[slug], media_type="image/png")


startup_handlers = [startup_facts]

router = Router(
    path="",
    route_handlers=[
        fact_page,
        fact_og_image,
    ]
)
