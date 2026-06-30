"""Paczkomaty (InPost) jako osobna encja faktow - rownolegla do Żabek.

Pobiera punkty z publicznego API InPost ShipX (bez tokena), przypisuje
wojewodztwo i powiat tym samym point-in-polygon co Żabki, miasto bierze z adresu.
Bez ciezkich wzbogacen - to czysta encja do zestawien przez wspolne wymiary.
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from backend.etl.io import (
    HTTP_TIMEOUT,
    USER_AGENT,
    with_retries,
)

INPOST_POINTS_URL = "https://api-shipx-pl.easypack24.net/v1/points"
INPOST_TYPE = os.getenv("INPOST_TYPE", "parcel_locker")   # parcel_locker | pop
PACZKOMAT_CACHE = os.getenv("PACZKOMAT_CACHE", "data/geo/paczkomaty_pl.json")
INPOST_PER_PAGE = 500
INPOST_WORKERS = int(os.getenv("INPOST_WORKERS", "8"))


def _parse_point(p: dict) -> dict:
    """Wyciagnij interesujace pola z punktu ShipX."""
    loc = p.get("location") or {}
    addr = p.get("address_details") or {}
    return {
        "external_id": p.get("name"),
        "type": p.get("type"),
        "status": p.get("status"),
        "city": addr.get("city"),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
    }


def _fetch_page(page: int) -> list:
    """Jedna strona punktow InPost z krotkim retry. Pusta lista przy bledzie."""
    for attempt in range(3):
        try:
            r = requests.get(INPOST_POINTS_URL,
                             params={"type": INPOST_TYPE, "per_page": INPOST_PER_PAGE, "page": page},
                             headers={"User-Agent": USER_AGENT}, timeout=max(HTTP_TIMEOUT, 40))
            r.raise_for_status()
            items = r.json().get("items", [])
            return [_parse_point(p) for p in items
                    if (p.get("location") or {}).get("latitude") is not None]
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return []


def _load_inpost_points() -> list:
    """Punkty InPost (PL) z cache lub z API (strony rownolegle - sekwencyjnie ShipX dlawi).
    Pobranie ze zrodla ponawiane wg polityki with_retries; [] gdy sie nie uda (best-effort)."""
    if os.path.exists(PACZKOMAT_CACHE):
        try:
            with open(PACZKOMAT_CACHE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    def _fetch():
        head = requests.get(INPOST_POINTS_URL,
                            params={"type": INPOST_TYPE, "per_page": 1, "page": 1},
                            headers={"User-Agent": USER_AGENT}, timeout=max(HTTP_TIMEOUT, 40))
        head.raise_for_status()
        count = int(head.json().get("count", 0))
        pages = (count + INPOST_PER_PAGE - 1) // INPOST_PER_PAGE
        pts = []
        with ThreadPoolExecutor(max_workers=INPOST_WORKERS) as ex:
            for chunk in ex.map(_fetch_page, range(1, pages + 1)):
                pts.extend(chunk)
        if not pts:
            raise RuntimeError("ShipX zwrocil 0 punktow")
        return pts

    pts = with_retries(_fetch, "paczkomaty")
    if not pts:
        return []
    os.makedirs(os.path.dirname(PACZKOMAT_CACHE) or ".", exist_ok=True)
    with open(PACZKOMAT_CACHE, "w", encoding="utf-8") as f:
        json.dump(pts, f, ensure_ascii=False)
    return pts


def fetch_parcel_lockers() -> list:
    """Lista paczkomatow gotowa do zapisu. Best-effort: [] gdy zrodlo niedostepne."""
    try:
        pts = _load_inpost_points()
    except Exception as e:
        print(f"[paczkomaty] InPost niedostepne: {e} - pomijam")
        return []
    if not pts:
        print("[paczkomaty] brak punktow - pomijam")
        return []
    out = []
    for p in pts:
        out.append({
            "external_id": p.get("external_id"),
            "city": p.get("city"),
            "voivodeship": None,
            "powiat": None,
            "latitude": p["latitude"],
            "longitude": p["longitude"],
            "status": p.get("status"),
        })
    print(f"[paczkomaty] wczytano {len(out):,} punktow InPost (typ {INPOST_TYPE})")
    return out
