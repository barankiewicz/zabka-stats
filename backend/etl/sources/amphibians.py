"""Wzbogacenie: populacja plazow (GBIF) - bo Zabka to zaba. + fakt najbardziej zabiej Zabki."""

import datetime
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from backend.etl.base import Enricher
from backend.etl.geo import chord_to_km, km_to_chord, sphere_tree, unit_vectors
from backend.etl.io import HTTP_TIMEOUT, USER_AGENT, with_retries

# Obserwacje plazow (Amphibia) w Polsce z GBIF. Per sklep: ile obserwacji w
# promieniu oraz dystans do najblizszej. Tematyczny uklon do nazwy sieci.
GBIF_OCCURRENCE_URL = "https://api.gbif.org/v1/occurrence/search"
GBIF_AMPHIBIA_TAXON = os.getenv("GBIF_AMPHIBIA_TAXON", "131")   # klasa Amphibia
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
AMPHIBIAN_CACHE = os.getenv("AMPHIBIAN_CACHE")
if AMPHIBIAN_CACHE:
    AMPHIBIAN_CACHE = os.path.abspath(AMPHIBIAN_CACHE)
else:
    AMPHIBIAN_CACHE = os.path.join(_PROJECT_ROOT, "data", "geo", "amphibians_pl.json")
AMPHIBIAN_RADIUS_KM = float(os.getenv("AMPHIBIAN_RADIUS_KM", "5"))
GBIF_PAGE = 300
GBIF_OFFSET_CAP = 100000          # twardy limit offsetu w GBIF search
GBIF_WORKERS = int(os.getenv("GBIF_WORKERS", "8"))


def _year_range() -> str:
    """Zakres lat: od 1998 (poczatek sieci Zabka) do biezacego."""
    cur = datetime.date.today().year
    return f"1998,{cur}"


def _gbif_params(offset: int, limit: int) -> dict:
    return {"country": "PL", "taxonKey": GBIF_AMPHIBIA_TAXON,
            "hasCoordinate": "true", "year": _year_range(),
            "limit": limit, "offset": offset}


def _fetch_page(offset: int) -> list:
    """Jedna strona obserwacji [lat, lon] z retry. Pusta lista przy bledzie."""
    for attempt in range(3):
        try:
            r = requests.get(GBIF_OCCURRENCE_URL, params=_gbif_params(offset, GBIF_PAGE),
                             headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            out = []
            for rec in r.json().get("results", []):
                la, lo = rec.get("decimalLatitude"), rec.get("decimalLongitude")
                yr = rec.get("year")
                if la is not None and lo is not None:
                    out.append([la, lo, yr])
            return out
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return []


def _load_amphibian_points() -> list:
    """Punkty [lat, lon, year] obserwacji plazow w PL z GBIF (ostatnie 3 lata). Cache lokalny.
    Strony rownolegle (GBIF dlawi sekwencyjne); pobranie ponawiane wg with_retries,
    [] gdy sie nie uda (best-effort)."""
    if os.path.exists(AMPHIBIAN_CACHE):
        try:
            with open(AMPHIBIAN_CACHE, encoding="utf-8") as f:
                cached = json.load(f)
            # stary format [lat, lon] bez roku — wymusz ponowne pobranie
            if cached and len(cached[0]) == 2:
                print("[amphibians] stary cache bez roku — odswiezam")
            else:
                return cached
        except Exception:
            pass

    def _fetch():
        # najpierw licznik, potem rownolegle strony po znanych offsetach
        head = requests.get(GBIF_OCCURRENCE_URL, params=_gbif_params(0, 0),
                            headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT)
        head.raise_for_status()
        count = min(int(head.json().get("count", 0)), GBIF_OFFSET_CAP)
        offsets = list(range(0, count, GBIF_PAGE))
        pts = []
        with ThreadPoolExecutor(max_workers=GBIF_WORKERS) as ex:
            for chunk in ex.map(_fetch_page, offsets):
                pts.extend(chunk)
        if not pts:
            raise RuntimeError("GBIF zwrocil 0 obserwacji")
        return pts

    pts = with_retries(_fetch, "amphibians")
    if not pts:
        return []
    os.makedirs(os.path.dirname(AMPHIBIAN_CACHE) or ".", exist_ok=True)
    with open(AMPHIBIAN_CACHE, "w", encoding="utf-8") as f:
        json.dump(pts, f)
    return pts


class AmphibiansEnricher(Enricher):
    """Per sklep: liczba obserwacji plazow w promieniu i dystans do najblizszej.
    Wystawia fakt 'najbardziej zabia Zabka' (most_froggy_zabka) do fun_facts."""

    tag = "amphibians"
    columns = ("amphibian_occurrences_5km", "nearest_amphibian_km")

    def __init__(self):
        self._froggy = None

    def enrich(self, rows: list) -> None:
        for r in rows:
            r["amphibian_occurrences_5km"] = None
            r["nearest_amphibian_km"] = None
        try:
            pts = _load_amphibian_points()
        except Exception as e:
            print(f"[amphibians] GBIF niedostepne: {e} - pomijam")
            return
        if not pts:
            print("[amphibians] brak obserwacji - pomijam")
            return
        tree, _xyz = sphere_tree([p[0] for p in pts], [p[1] for p in pts])
        q = unit_vectors([r["latitude"] for r in rows], [r["longitude"] for r in rows])
        counts = tree.query_ball_point(q, r=km_to_chord(AMPHIBIAN_RADIUS_KM), return_length=True)
        dist, _idx = tree.query(q, k=1)   # cKDTree k=1 zwraca tablice 1-D
        best_i, best_c = -1, -1
        for i, (r, c, d) in enumerate(zip(rows, counts, dist)):
            r["amphibian_occurrences_5km"] = int(c)
            r["nearest_amphibian_km"] = round(float(chord_to_km(d)), 2)
            if c > best_c:
                best_c, best_i = int(c), i
        if best_i >= 0:
            self._froggy = {"lat": rows[best_i]["latitude"], "lon": rows[best_i]["longitude"],
                            "dist_km": float(best_c)}   # value = liczba obserwacji w promieniu
        print(f"[amphibians] {len(pts):,} obserwacji GBIF; mediana {int(np.median(counts))} "
              f"w {AMPHIBIAN_RADIUS_KM:.0f} km; najbardziej zabia Zabka ma {best_c} plazow w poblizu")

    def fun_fact(self):
        return self._froggy
