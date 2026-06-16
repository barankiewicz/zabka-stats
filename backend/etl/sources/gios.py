"""Wzbogacenie: najblizsza stacja jakosci powietrza GIOŚ (best-effort)."""

import requests
import numpy as np

from backend.etl.base import Enricher
from backend.etl.geo import EARTH_KM
from backend.etl.io import USER_AGENT, HTTP_TIMEOUT, with_retries


def fetch_gios_stations() -> list:
    """Pobierz wszystkie stacje GIOŚ (API v1, paginowane), z ponawianiem.
    Zwraca [] gdy po wszystkich probach sie nie uda (best-effort)."""
    base = "https://api.gios.gov.pl/pjp-api/v1/rest/station/findAll"

    def _fetch():
        out = []
        page, total = 0, 1
        while page < total:
            r = requests.get(base, params={"page": page, "size": 500},
                             headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            j = r.json()
            total = j.get("totalPages", 1)
            for s in j.get("Lista stacji pomiarowych", []):
                try:
                    out.append({
                        "id": int(s["Identyfikator stacji"]),
                        "name": s.get("Nazwa stacji"),
                        "lat": float(s["WGS84 φ N"]),
                        "lon": float(s["WGS84 λ E"]),
                    })
                except (KeyError, TypeError, ValueError):
                    continue
        return out

    out = with_retries(_fetch, "gios") or []
    print(f"[gios] {len(out)} stacji (API v1)")
    return out


class GiosEnricher(Enricher):
    """Przypisz najblizsza stacje GIOŚ kazdemu sklepowi: gios_station_id (FK do
    dim_gios_station) + gios_distance_km. Nazwa stacji zyje w wymiarze, nie na fakcie."""

    tag = "gios"
    columns = ("gios_station_id", "gios_distance_km")

    def __init__(self, stations: list = None):
        # stacje wstrzykiwane (fetch best-effort robi pipeline), albo pobierane tutaj
        self._stations = stations

    def enrich(self, rows: list) -> None:
        for r in rows:
            r.setdefault("gios_station_id", None)
            r.setdefault("gios_distance_km", None)
        stations = self._stations if self._stations is not None else fetch_gios_stations()
        if not stations:
            return
        from sklearn.neighbors import BallTree
        spts = np.radians([[s["lat"], s["lon"]] for s in stations])
        tree = BallTree(spts, metric="haversine")
        q = np.radians([[r["latitude"], r["longitude"]] for r in rows])
        dist, idx = tree.query(q, k=1)
        for r, d, i in zip(rows, dist[:, 0], idx[:, 0]):
            r["gios_station_id"] = stations[int(i)]["id"]
            r["gios_distance_km"] = round(float(d) * EARTH_KM, 2)
        print(f"[gios] przypisano najblizsza stacje do {len(rows):,} sklepow")
