"""
Wspolny interfejs wzbogacen ETL Żabki.

Kazde zrodlo wzbogacenia to jedna klasa dziedziczaca po Enricher i ustawiajaca
swoj wlasny zestaw kolumn na wierszach. Krok jest jednorodny: pipeline trzyma
liste enricherow i wola enrich(rows) po kolei.
"""

from abc import ABC, abstractmethod


class Enricher(ABC):
    """
    Kontrakt wzbogacenia (mutacja w miejscu, best-effort).

    enrich(rows) NIE zwraca nic - modyfikuje liste wierszy w miejscu, dopisujac
    swoje kolumny do kazdego slownika. Kontrakt:

    - Best-effort: metoda NIGDY nie powinna wypuscic wyjatku na zewnatrz. Gdy
      zrodla brak lub pobieranie zawiedzie, loguj (z prefiksem [tag]) i zostaw
      kolumny puste (None/False). Pipeline idzie dalej jak przy GIOŚ.
    - Idempotentne kolumny: enricher zawsze najpierw ustawia swoje kolumny na
      wartosc neutralna dla KAZDEGO wiersza (None lub False), a potem nadpisuje
      udane trafienia. Dzieki temu skipniecie kroku w pipeline i wywolanie tu
      daja ten sam ksztalt danych.
    - Fakty pomocnicze (np. samotnik, najbardziej zabia Zabka) sa wystawiane
      przez metode fun_fact() po przebiegu enrich(); domyslnie None.
    """

    #: prefiks logow, np. "regions", "gios" - uzywany w komunikatach [tag]
    tag = "enricher"

    @abstractmethod
    def enrich(self, rows: list) -> None:
        """Ustaw kolumny tego zrodla na wierszach (mutacja w miejscu, best-effort)."""
        raise NotImplementedError

    def fun_fact(self):
        """Opcjonalny fakt do tabeli fun_facts (dict {lat, lon, dist_km}) lub None.
        Wolane przez pipeline PO enrich(). Domyslnie brak."""
        return None
