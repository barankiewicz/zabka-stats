"""Wzbogacenie: dystans do najblizszej innej Żabki (lokalne) + fakt samotnika."""

import numpy as np

from backend.etl.base import Enricher
from backend.etl.geo import chord_to_km, sphere_tree


class NeighborEnricher(Enricher):
    """Policz dystans do najblizszej innej Żabki (w metrach) dla kazdego sklepu.
    Wystawia fakt 'samotnik' (most_isolated_zabka) - rekord o najwiekszej izolacji."""

    tag = "neighbor"
    columns = ("nearest_neighbor_distance_meters",)

    def __init__(self):
        self._loner = None

    def enrich(self, rows: list) -> None:
        for r in rows:
            r["nearest_neighbor_distance_meters"] = None
        n = len(rows)
        if n < 2:
            return
        tree, xyz = sphere_tree([r["latitude"] for r in rows],
                                [r["longitude"] for r in rows])
        dist, _idx = tree.query(xyz, k=2)          # k=2: kolumna 0 to sam punkt
        nn_km = chord_to_km(dist[:, 1])
        for r, d in zip(rows, nn_km):
            r["nearest_neighbor_distance_meters"] = int(round(float(d) * 1000))
        k = int(np.argmax(nn_km))
        self._loner = {"lat": rows[k]["latitude"], "lon": rows[k]["longitude"],
                       "dist_km": float(nn_km[k])}
        clustered = int((nn_km * 1000 < 100).sum())
        print(f"[neighbor] mediana do sasiada {np.median(nn_km)*1000:.0f} m; "
              f"samotnik {self._loner['dist_km']:.1f} km od najblizszej Żabki; "
              f"{clustered} sklepow <100 m (klastry zageszczenia)")

    def fun_fact(self):
        return self._loner
