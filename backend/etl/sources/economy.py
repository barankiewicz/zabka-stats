"""Wymiary ekonomiczne powiatu (GUS BDL) - wynagrodzenie, bezrobocie, populacja.

To NIE jest row-enricher: ekonomia nalezy do wymiaru powiatu (dim_powiat), nie do
kazdego wiersza faktow. Modul pobiera dane z GUS i buduje wiersze wymiarow
(dim_powiat, dim_voivodeship), z ktorych pisze sie zestawienia Żabki vs paczkomaty."""

import os
import re
import time

import requests

from backend.etl.io import HTTP_TIMEOUT, USER_AGENT, with_retries

# Without an API key GUS BDL allows 10 req/min (anonymous).
# With a key: 100 req/min. Throttle to stay safely under the anonymous cap.
_GUS_THROTTLE = 7.0  # seconds between page requests when no key set

# --- dane ekonomiczne powiatow (GUS BDL) ---
GUS_BDL_BASE = "https://bdl.stat.gov.pl/api/v1/data/by-variable"
# Zmienne na poziomie powiatow (unit-level=5), potwierdzone w API BDL:
#   64428 = przecietne miesieczne wynagrodzenia brutto, ogolem (zl), podmiot P2497
#   60270 = stopa bezrobocia rejestrowanego, ogolem (%), podmiot P2392
#   33036 = ludnosc ogolem (osoba), podmiot P1924
GUS_SALARY_VAR = os.getenv("GUS_SALARY_VAR", "64428")
GUS_UNEMPLOY_VAR = os.getenv("GUS_UNEMPLOY_VAR", "60270")
# 72305 = ludnosc ogolem wg miejsca zamieszkania, stan na 31 XII (osoba), seria roczna
# (zmienna 33036 z P1924 to tylko spis 2002 - przestarzala, nie uzywac)
GUS_POPULATION_VAR = os.getenv("GUS_POPULATION_VAR", "72305")
GUS_BDL_KEY = os.getenv("GUS_BDL_KEY", "")

# Powiaty przemianowane: zrodlo polygonow (ppatrzyk) ma stara nazwe, GUS - nowa.
_POWIAT_ALIASES = {
    "jeleniogórski": "karkonoski",   # przemianowany w 2021
}

# Kod TERYT wojewodztwa = znaki [2:4] identyfikatora jednostki BDL (pierwsze dwa
# znaki to prefiks agregacji GUS, nie TERYT). Np. powiat '011212001000' -> '12'
# malopolskie, gmina Wroclaw '030210564011' -> '02' dolnoslaskie. Pozwala rozroznic
# powiaty o tej samej nazwie w roznych wojewodztwach (np. brzeski opolski vs malopolski).
_TERYT_VOIV = {
    "02": "dolnośląskie", "04": "kujawsko-pomorskie", "06": "lubelskie",
    "08": "lubuskie", "10": "łódzkie", "12": "małopolskie", "14": "mazowieckie",
    "16": "opolskie", "18": "podkarpackie", "20": "podlaskie", "22": "pomorskie",
    "24": "śląskie", "26": "świętokrzyskie", "28": "warmińsko-mazurskie",
    "30": "wielkopolskie", "32": "zachodniopomorskie",
}


def _voiv_from_unit_id(uid: str):
    """Nazwa wojewodztwa z identyfikatora jednostki BDL (kod TERYT na poz. [2:4])."""
    if uid and len(uid) >= 4:
        return _TERYT_VOIV.get(uid[2:4])
    return None


def _norm_powiat(name: str):
    """Ujednolic nazwe powiatu do JOIN: usun prefiks 'powiat'/'m.'/'st.', sufiks
    czasowy ('od 2013', 'do 2002'), lowercase, zastosuj alias rename'ow.
    Dziala dla 'powiat sławieński', 'Powiat m. st. Warszawa', 'Powiat m. Wałbrzych od 2013'."""
    if not name:
        return None
    s = name.strip().lower()
    s = re.sub(r"^powiat\s+", "", s)
    s = re.sub(r"\bm\.\s*st\.\s*", "", s)
    s = re.sub(r"\bm\.\s*", "", s)
    s = re.sub(r"\s+(od|do|w latach)\s+\d{4}.*$", "", s)   # sufiks czasowy GUS
    s = re.sub(r"\s+", " ", s).strip()
    s = s or None
    return _POWIAT_ALIASES.get(s, s)


def _fetch_gus_variable(var_id: str) -> dict:
    """{(wojewodztwo, znormalizowany_powiat): wartosc_z_najnowszego_roku} dla
    zmiennej na poziomie powiatow. Klucz zawiera wojewodztwo (z TERYT jednostki),
    bo nazwa powiatu nie jest unikalna w kraju ('powiat brzeski' jest i w opolskim,
    i w malopolskim). Przy kolizji rocznikow wygrywa wpis z nowszym rokiem."""
    headers = {"User-Agent": USER_AGENT}
    if GUS_BDL_KEY:
        headers["X-ClientId"] = GUS_BDL_KEY

    def _fetch():
        best = {}   # (voiv, name) -> (year, val)
        page = 0
        while page < 60:
            if page > 0 and not GUS_BDL_KEY:
                time.sleep(_GUS_THROTTLE)
            r = requests.get(f"{GUS_BDL_BASE}/{var_id}",
                             params={"unit-level": 5, "format": "json",
                                     "page-size": 100, "page": page},
                             headers=headers, timeout=HTTP_TIMEOUT)
            r.raise_for_status()
            j = r.json()
            for unit in j.get("results", []):
                name = _norm_powiat(unit.get("name"))
                if not name:
                    continue
                key = (_voiv_from_unit_id(unit.get("id")), name)
                for v in unit.get("values", []):
                    if v.get("val") is None:
                        continue
                    yr = str(v.get("year"))
                    if key not in best or yr > best[key][0]:
                        best[key] = (yr, float(v["val"]))
            if not (j.get("links", {}) or {}).get("next"):
                break
            page += 1
        return {k: val for k, (yr, val) in best.items()}

    return with_retries(_fetch, f"gus:{var_id}") or {}


def fetch_gus_economics():
    """Pobierz ekonomie z GUS BDL. Zwraca (salary, unempl, popul) - slowniki
    {znormalizowany_powiat: wartosc}. Montaz wymiarow (z kluczami numerycznymi)
    robi pipeline, bo to on trzyma mape powiat->wojewodztwo z faktow."""
    salary = _fetch_gus_variable(GUS_SALARY_VAR)
    unempl = _fetch_gus_variable(GUS_UNEMPLOY_VAR)
    popul = _fetch_gus_variable(GUS_POPULATION_VAR)
    if not salary and not unempl and not popul:
        print("[gus] brak danych BDL - wymiary bez ekonomii (ustaw GUS_BDL_KEY)")
    else:
        print(f"[gus] ekonomia: wynagrodzenia {len(salary)}, bezrobocie {len(unempl)}, "
              f"ludnosc {len(popul)} powiatow")
    return salary, unempl, popul
