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

Language: the dashboard's client-side i18n (frontend/src/i18n.js) picks a
language from a `?lang=` URL param or localStorage. These server-rendered
pages have no access to localStorage, so they honor `?lang=en` (default
`pl`) for the injected <title>/meta/OG text and the OG preview image text -
matching the query-param convention already used for hreflang alternates on
index.html.
"""

import html
import pathlib
import re

from litestar import Request, Router, get
from litestar.exceptions import HTTPException
from litestar.response import Response

from backend.database import client
from backend.og_image import render_fact_card

BASE_URL = "https://zabkozbior.barankiewicz.dev"
BRAND = {"pl": "Żabkozbiór", "en": "Żabka Collector"}
NO_DATA = {"pl": "brak danych", "en": "no data"}
NOT_FOUND_DETAIL = {"pl": "Nie znaleziono takiego faktu", "en": "Fact not found"}

_project_root = pathlib.Path(__file__).parent.parent.parent
_INDEX_HTML_PATH = _project_root / "frontend" / "dist" / "index.html"

FACTS: dict[str, dict[str, dict]] = {}
_OG_IMAGES: dict[tuple[str, str], bytes] = {}
_INDEX_HTML_CACHE: str | None = None


def _lang(request: Request) -> str:
    lang = request.query_params.get("lang")
    return "en" if lang == "en" else "pl"


def _fmt_km(value: float, lang: str, decimals: int = 2) -> str:
    s = f"{round(value, decimals)} km"
    return s.replace(".", ",") if lang == "pl" else s


def _query_facts() -> dict[str, dict[str, dict]]:
    facts: dict[str, dict[str, dict]] = {"pl": {}, "en": {}}

    void = client.execute(
        "SELECT value, lat, lon FROM fun_facts WHERE key = 'farthest_from_zabka'"
    ).fetchone()
    for lang in ("pl", "en"):
        void_str = _fmt_km(float(void[0]), lang) if void else NO_DATA[lang]
        if lang == "pl":
            facts["pl"]["pustka-bieszczadzka"] = {
                "fact_id": "void",
                "title": f"Pustka Bieszczad: {void_str} od najbliższej Żabki" if void else "Pustka Bieszczad: brak danych",
                "description": (
                    f"Gdzieś w Bieszczadach jest punkt oddalony o {void_str} od "
                    "najbliższej Żabki - największa biała plama na mapie ponad 13 "
                    "tysięcy sklepów w Polsce." if void else "Brak danych o najdalszym punkcie."
                ),
                "og_kicker": "Pustka Bieszczad",
                "og_value": void_str,
                "og_subtitle": "od najbliższej Żabki",
                "og_footer": "Bieszczady, podkarpackie",
            }
        else:
            facts["en"]["pustka-bieszczadzka"] = {
                "fact_id": "void",
                "title": f"The Bieszczady Void: {void_str} from the nearest Żabka" if void else "The Bieszczady Void: no data",
                "description": (
                    f"Somewhere in the Bieszczady Mountains sits a point {void_str} "
                    "from the nearest Żabka - the largest blank spot on a map of "
                    "over 13,000 stores in Poland." if void else "No data on the farthest point."
                ),
                "og_kicker": "Bieszczady Void",
                "og_value": void_str,
                "og_subtitle": "from the nearest Żabka",
                "og_footer": "Bieszczady, Podkarpackie",
            }

    loner = client.execute("""
        SELECT city, voivodeship, nearest_neighbor_distance_meters
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
        ORDER BY nearest_neighbor_distance_meters DESC LIMIT 1
    """).fetchone()
    for lang in ("pl", "en"):
        loner_city = loner[0] if loner else NO_DATA[lang]
        loner_voiv = loner[1] if loner else NO_DATA[lang]
        loner_km_str = _fmt_km(loner[2] / 1000, lang, 1) if loner else NO_DATA[lang]
        if lang == "pl":
            facts["pl"]["samotna-zabka"] = {
                "fact_id": "isolated",
                "title": f"Najbardziej samotna Żabka w Polsce: {loner_km_str} do sąsiadki" if loner else "Najbardziej samotna Żabka w Polsce: brak danych",
                "description": (
                    f"W {loner_city} ({loner_voiv}) stoi Żabka, której najbliższa "
                    f"siostra jest {loner_km_str} dalej - najbardziej odizolowany "
                    "sklep w całej sieci." if loner else "Brak danych o samotnej Żabce."
                ),
                "og_kicker": "Najdalej od sąsiadki",
                "og_value": loner_km_str,
                "og_subtitle": "do najbliższej Żabki",
                "og_footer": f"{loner_city}, {loner_voiv}" if loner else "brak danych",
            }
        else:
            facts["en"]["samotna-zabka"] = {
                "fact_id": "isolated",
                "title": f"Poland's Loneliest Żabka: {loner_km_str} to its neighbor" if loner else "Poland's Loneliest Żabka: no data",
                "description": (
                    f"In {loner_city} ({loner_voiv}) stands a Żabka whose nearest "
                    f"sibling is {loner_km_str} away - the most isolated store in "
                    "the entire network." if loner else "No data on the loneliest Żabka."
                ),
                "og_kicker": "Farthest from a neighbor",
                "og_value": loner_km_str,
                "og_subtitle": "to the nearest Żabka",
                "og_footer": f"{loner_city}, {loner_voiv}" if loner else "no data",
            }

    oldest = client.execute("""
        SELECT city, voivodeship, first_opening_date
        FROM locations
        WHERE deleted_at IS NULL AND first_opening_date IS NOT NULL
        ORDER BY first_opening_date ASC LIMIT 1
    """).fetchone()
    for lang in ("pl", "en"):
        oldest_city = oldest[0] if oldest else NO_DATA[lang]
        oldest_voiv = oldest[1] if oldest else NO_DATA[lang]
        oldest_year = str(oldest[2])[:4] if oldest else NO_DATA[lang]
        if lang == "pl":
            facts["pl"]["najstarsza-zabka"] = {
                "fact_id": "oldest",
                "title": f"Najstarsza wciąż działająca Żabka: {oldest_city}, {oldest_year}" if oldest else "Najstarsza wciąż działająca Żabka: brak danych",
                "description": (
                    f"Ta Żabka w {oldest_city} działa nieprzerwanie od {oldest_year} "
                    "roku - najstarszy wciąż czynny sklep w całej sieci ponad 13 "
                    "tysięcy Żabek." if oldest else "Brak danych o najstarszej Żabce."
                ),
                "og_kicker": "Najstarsza aktywna",
                "og_value": oldest_year,
                "og_subtitle": "wciąż działa",
                "og_footer": f"{oldest_city}, {oldest_voiv}" if oldest else "brak danych",
            }
        else:
            facts["en"]["najstarsza-zabka"] = {
                "fact_id": "oldest",
                "title": f"Poland's Oldest Still-Active Żabka: {oldest_city}, {oldest_year}" if oldest else "Poland's Oldest Still-Active Żabka: no data",
                "description": (
                    f"This Żabka in {oldest_city} has been running continuously "
                    f"since {oldest_year} - the oldest still-active store in the "
                    "entire network of over 13,000 Żabkas." if oldest else "No data on the oldest Żabka."
                ),
                "og_kicker": "Oldest active",
                "og_value": oldest_year,
                "og_subtitle": "still running",
                "og_footer": f"{oldest_city}, {oldest_voiv}" if oldest else "no data",
            }

    facts["pl"]["zielonej-zabki"] = {
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
    facts["en"]["zielonej-zabki"] = {
        "fact_id": "frog",
        "title": "A Żabka on Green Frog Street",
        "description": (
            "In Żabia Wola, at 7 Zielonej Żabki (Green Frog) Street, stands a "
            "store that markets itself. We checked whether the network is "
            "actually named after a frog."
        ),
        "og_kicker": "Collector's gem",
        "og_value": "ul. Zielonej Żabki 7",
        "og_subtitle": "Żabka on Frog Street",
        "og_footer": "Żabia Wola, Mazowieckie",
    }

    median = client.execute("""
        SELECT MEDIAN(nearest_neighbor_distance_meters)
        FROM locations WHERE deleted_at IS NULL
          AND nearest_neighbor_distance_meters IS NOT NULL
    """).fetchone()
    median_m = round(float(median[0])) if median and median[0] is not None else None
    facts["pl"]["mediana-odleglosci"] = {
        "fact_id": None,
        "title": f"Połowa Żabek ma sąsiadkę bliżej niż {median_m} m" if median_m is not None else "Połowa Żabek ma sąsiadkę blisko: brak danych",
        "description": (
            f"Mediana odległości do najbliższej Żabki to zaledwie {median_m} "
            "metrów. Połowa z ponad 13 tysięcy sklepów w Polsce ma inną "
            "Żabkę bliżej niż trzy minuty spacerem." if median_m is not None else "Brak danych o odległościach."
        ),
        "og_kicker": "Najbliższy sąsiad",
        "og_value": f"{median_m} m" if median_m is not None else "brak danych",
        "og_subtitle": "mediana odległości do najbliższej Żabki",
        "og_footer": "cała sieć, Polska",
    }
    facts["en"]["mediana-odleglosci"] = {
        "fact_id": None,
        "title": f"Half of All Żabkas Have a Neighbor Within {median_m} m" if median_m is not None else "Half of All Żabkas Have a Neighbor Close By: no data",
        "description": (
            f"The median distance to the nearest Żabka is just {median_m} "
            "meters. Half of the more than 13,000 stores in Poland have "
            "another Żabka closer than a three-minute walk." if median_m is not None else "No data on inter-store distances."
        ),
        "og_kicker": "Nearest neighbor",
        "og_value": f"{median_m} m" if median_m is not None else "no data",
        "og_subtitle": "median distance to the nearest Żabka",
        "og_footer": "entire network, Poland",
    }

    return facts


def _ensure_facts() -> dict[str, dict[str, dict]]:
    global FACTS
    if not FACTS:
        FACTS = _query_facts()
        for lang, slugs in FACTS.items():
            for slug, fact in slugs.items():
                _OG_IMAGES[(slug, lang)] = render_fact_card(
                    kicker=fact["og_kicker"],
                    value=fact["og_value"],
                    subtitle=fact["og_subtitle"],
                    footer=fact["og_footer"],
                )
    return FACTS


def startup_facts() -> None:
    try:
        _ensure_facts()
    except Exception as e:
        print(f"[startup_facts] facts build deferred to lazy loading: {e}")


def _load_index_html() -> str:
    global _INDEX_HTML_CACHE
    if _INDEX_HTML_CACHE is None:
        _INDEX_HTML_CACHE = _INDEX_HTML_PATH.read_text(encoding="utf-8")
    return _INDEX_HTML_CACHE


def _tag_sub(html: str, pattern: str, replacement: str) -> str:
    return re.sub(pattern, lambda _m: replacement, html, count=1)


def _inject_meta(html_str: str, slug: str, fact: dict, lang: str) -> str:
    lang_suffix = "?lang=en" if lang == "en" else ""
    title = html.escape(f"{fact['title']} – {BRAND[lang]}", quote=True)
    description = html.escape(fact["description"], quote=True)
    url = html.escape(f"{BASE_URL}/fakt/{slug}{lang_suffix}", quote=True)
    image_url = html.escape(f"{BASE_URL}/fakt/{slug}/og.png{lang_suffix}", quote=True)

    html_str = _tag_sub(html_str, r'<html lang="[^"]*">', f'<html lang="{lang}">')
    html_str = _tag_sub(html_str, r"<title>.*?</title>", f"<title>{title}</title>")
    html_str = _tag_sub(html_str, r'<meta name="description" content="[^"]*">',
                     f'<meta name="description" content="{description}">')
    html_str = _tag_sub(html_str, r'<link rel="canonical" href="[^"]*">',
                     f'<link rel="canonical" href="{url}">')
    html_str = _tag_sub(html_str, r'<meta property="og:url" content="[^"]*">',
                     f'<meta property="og:url" content="{url}">')
    html_str = _tag_sub(html_str, r'<meta property="og:title" content="[^"]*">',
                     f'<meta property="og:title" content="{title}">')
    html_str = _tag_sub(html_str, r'<meta property="og:description" content="[^"]*">',
                     f'<meta property="og:description" content="{description}">')
    html_str = _tag_sub(html_str, r'<meta property="og:image" content="[^"]*">',
                     f'<meta property="og:image" content="{image_url}">')
    html_str = _tag_sub(html_str, r'<meta property="og:image:alt" content="[^"]*">',
                     f'<meta property="og:image:alt" content="{title}">')
    html_str = _tag_sub(html_str, r'<meta name="twitter:title" content="[^"]*">',
                     f'<meta name="twitter:title" content="{title}">')
    html_str = _tag_sub(html_str, r'<meta name="twitter:description" content="[^"]*">',
                     f'<meta name="twitter:description" content="{description}">')
    html_str = _tag_sub(html_str, r'<meta name="twitter:image" content="[^"]*">',
                     f'<meta name="twitter:image" content="{image_url}">')
    html_str = _tag_sub(html_str, r'<meta name="twitter:image:alt" content="[^"]*">',
                     f'<meta name="twitter:image:alt" content="{title}">')
    return html_str


@get("/fakt/{slug:str}", sync_to_thread=True)
def fact_page(slug: str, request: Request) -> Response:
    lang = _lang(request)
    fact = _ensure_facts()[lang].get(slug)
    if fact is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL[lang])
    html = _inject_meta(_load_index_html(), slug, fact, lang)
    return Response(content=html, media_type="text/html")


@get("/fakt/{slug:str}/og.png", sync_to_thread=True)
def fact_og_image(slug: str, request: Request) -> Response:
    lang = _lang(request)
    facts = _ensure_facts()
    if slug not in facts[lang]:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL[lang])
    return Response(content=_OG_IMAGES[(slug, lang)], media_type="image/png")


startup_handlers = [startup_facts]

router = Router(
    path="",
    route_handlers=[
        fact_page,
        fact_og_image,
    ]
)
