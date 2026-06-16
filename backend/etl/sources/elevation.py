"""Wzbogacenie: wysokosc n.p.m. z GUGiK NMT (per punkt, cache, opt-in)."""

import os
import re
import json
import time

from backend.etl.base import Enricher
from backend.etl.geo import wgs84_to_puwg1992
from backend.etl.io import USER_AGENT

import requests

# --- numeryczny model terenu (GUGiK NMT, per punkt, cache) ---
GUGIK_NMT_URL = os.getenv("GUGIK_NMT_URL", "https://services.gugik.gov.pl/nmt/")
ELEVATION_CACHE = os.getenv("ELEVATION_CACHE", "data/geo/elevation_cache.json")
ELEVATION_WORKERS = int(os.getenv("ELEVATION_WORKERS", "8"))


def _elev_key(lat: float, lon: float) -> str:
    return f"{lat:.5f},{lon:.5f}"


class ElevationEnricher(Enricher):
    """Wysokosc n.p.m. z GUGiK NMT (wspolrzedne plaskie PL-1992). Cache lokalny
    trzyma TYLKO udane odczyty, wiec brakujace punkty sa ponawiane przy kolejnych
    przebiegach - usluga czesto zwraca bledy przy duzym ruchu. Kilka przebiegow z
    retry per zapytanie domyka pokrycie."""

    tag = "elevation"
    columns = ("elevation_meters",)

    def __init__(self, max_passes: int = 3):
        self.max_passes = max_passes

    @staticmethod
    def _fetch_one(r):
        lat, lon = r["latitude"], r["longitude"]
        key = _elev_key(lat, lon)
        x, y = wgs84_to_puwg1992(lat, lon)   # GUGiK NMT przyjmuje XY w PL-1992
        for attempt in range(3):
            try:
                resp = requests.get(GUGIK_NMT_URL,
                                    params={"request": "GetHByXY", "x": x, "y": y},
                                    headers={"User-Agent": USER_AGENT}, timeout=15)
                resp.raise_for_status()
                m = re.search(r"-?\d+(?:\.\d+)?", resp.text)
                if m:
                    return key, float(m.group())
            except Exception:
                time.sleep(0.3 * (attempt + 1))
        return key, None

    def enrich(self, rows: list) -> None:
        cache = {}
        if os.path.exists(ELEVATION_CACHE):
            try:
                with open(ELEVATION_CACHE, encoding="utf-8") as f:
                    cache = json.load(f)
            except Exception:
                cache = {}

        from concurrent.futures import ThreadPoolExecutor
        have = sum(1 for r in rows
                   if cache.get(_elev_key(r["latitude"], r["longitude"])) is not None)
        print(f"[elevation] {have:,}/{len(rows):,} z cache; ponawiam brakujace (do {self.max_passes} przebiegow)")
        for p in range(self.max_passes):
            # brak wpisu LUB zapamietany None = do pobrania (cache trzyma tylko sukcesy)
            todo = [r for r in rows
                    if cache.get(_elev_key(r["latitude"], r["longitude"])) is None]
            if not todo:
                break
            got = 0
            with ThreadPoolExecutor(max_workers=ELEVATION_WORKERS) as ex:
                for key, val in ex.map(self._fetch_one, todo):
                    if val is not None:
                        cache[key] = val
                        got += 1
            os.makedirs(os.path.dirname(ELEVATION_CACHE) or ".", exist_ok=True)
            with open(ELEVATION_CACHE, "w", encoding="utf-8") as f:
                json.dump(cache, f)
            print(f"[elevation] przebieg {p + 1}: +{got:,} (brakowalo {len(todo):,})")
            if got == 0:
                break
        for r in rows:
            r["elevation_meters"] = cache.get(_elev_key(r["latitude"], r["longitude"]))
        final = sum(1 for r in rows if r["elevation_meters"] is not None)
        print(f"[elevation] pokrycie {final:,}/{len(rows):,}")
