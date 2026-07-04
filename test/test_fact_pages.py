# Tests for the shareable fact pages feature (backend/api/fact_pages.py):
# GET /fakt/{slug} (SPA shell with per-fact meta tags injected) and
# GET /fakt/{slug}/og.png (per-fact OG preview image). Zero coverage existed
# for this feature before this file.

import html

import pytest
from litestar.testing import TestClient

import backend.api.fact_pages as fact_pages_module
from backend.main import app

VALID_SLUGS = [
    "pustka-bieszczadzka",
    "samotna-zabka",
    "najstarsza-zabka",
    "zielonej-zabki",
    "mediana-odleglosci",
]


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("slug", VALID_SLUGS)
def test_fact_page_returns_html_with_injected_title(client, slug):
    response = client.get(f"/fakt/{slug}")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]

    # The fact's title is only known once FACTS has been built (lazily on
    # first access, same code path the handler itself uses - the request
    # above already triggered that build). Read the module attribute fresh
    # rather than a name imported at collection time: _ensure_facts()
    # rebinds the module-level FACTS to a new dict, so an earlier `from
    # backend.api.fact_pages import FACTS` would keep pointing at the
    # original empty one. FACTS is keyed by language first ("pl"/"en"), then
    # by slug - no ?lang= query param means "pl" (see fact_pages._lang).
    fact = fact_pages_module.FACTS["pl"][slug]
    assert f"<title>{fact['title']}" in response.text
    # Confirm it's not just the generic homepage title still sitting there.
    assert "<title>Żabkozbiór – interaktywny atlas sieci w Polsce</title>" not in response.text
    # og:description/twitter:description carry a trailing data-t-content
    # attribute in the built HTML (for the client-side i18n system) - a past
    # regression here silently left the generic homepage description in
    # place because the injection regex didn't tolerate that extra
    # attribute. Assert the fact's own description actually landed.
    assert f'content="{html.escape(fact["description"], quote=True)}"' in response.text
    assert 'og:description content="Gdzie, kiedy i jak rosła sieć' not in response.text


def test_fact_page_unknown_slug_returns_404(client):
    response = client.get("/fakt/not-a-real-slug")
    assert response.status_code == 404


@pytest.mark.parametrize("slug", VALID_SLUGS)
def test_fact_og_image_returns_png(client, slug):
    response = client.get(f"/fakt/{slug}/og.png")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert len(response.content) > 0


def test_fact_og_image_unknown_slug_returns_404(client):
    response = client.get("/fakt/not-a-real-slug/og.png")
    assert response.status_code == 404
