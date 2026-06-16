"""
Orkiestracja ETL Żabki.

Czyta sie liniowo: pobierz surowy JSON -> tabularyzuj -> wzbogac (kazde zrodlo
niezaleznie, przez wspolny interfejs Enricher) -> najdalszy punkt -> zaladuj do
DuckDB -> wyczysc cache. Pominiete kroki ustawiaja swoje kolumny na wartosci
neutralne (None/False), zeby ksztalt danych byl staly.
"""

import time
from datetime import datetime, date

import numpy as np
import duckdb

from backend.etl.io import (
    DB_PATH, fetch_zabka_json, to_tabular, resolve_poland_boundaries,
    farthest_point_from_any_zabka, load_to_duckdb, reload_cache,
    load_parcel_lockers, load_dimensions, load_fun_facts,
    load_dim_gios_station, load_dim_park,
)
from backend.etl.sources.regions import RegionsEnricher
from backend.etl.sources.gios import GiosEnricher, fetch_gios_stations
from backend.etl.sources.neighbor import NeighborEnricher
from backend.etl.sources.amphibians import AmphibiansEnricher
from backend.etl.sources.parks import ParksEnricher
from backend.etl.sources.economy import fetch_gus_economics, _norm_powiat
from backend.etl.sources.elevation import ElevationEnricher
from backend.etl.sources.parcel_lockers import fetch_parcel_lockers


def _build_geo_dims(rows, lockers, skip_gus):
    """Nadaj klucze numeryczne wymiarom i faktom (bez JOIN-ow po stringach).

    Zbiera wojewodztwa i pary (wojewodztwo, powiat) z obu faktow, nadaje im id,
    wpisuje voivodeship_id/powiat_id do wierszy Żabek i paczkomatow (w miejscu),
    po czym buduje wiersze wymiarow z ekonomia GUS (po znormalizowanej nazwie
    powiatu). Zwraca (dim_powiat, dim_voivodeship) gotowe do zapisu."""
    facts = rows + lockers
    voiv_names = sorted({r["voivodeship"] for r in facts if r.get("voivodeship")})
    voiv_id = {n: i + 1 for i, n in enumerate(voiv_names)}
    pairs = sorted({(r["voivodeship"], r["powiat"]) for r in facts
                    if r.get("voivodeship") and r.get("powiat")})
    powiat_id = {pair: i + 1 for i, pair in enumerate(pairs)}
    for r in facts:
        r["voivodeship_id"] = voiv_id.get(r.get("voivodeship"))
        r["powiat_id"] = powiat_id.get((r.get("voivodeship"), r.get("powiat")))

    salary, unempl, popul = ({}, {}, {}) if skip_gus else fetch_gus_economics()
    if skip_gus:
        print("[gus] pominiete (--skip-gus) - wymiary bez ekonomii")
    dim_powiat, pop_by_voiv = [], {}
    for (voiv, powiat), pid in sorted(powiat_id.items(), key=lambda kv: kv[1]):
        key = _norm_powiat(powiat)
        p = popul.get(key)
        pop_i = int(p) if p is not None else None
        dim_powiat.append((pid, powiat, voiv_id[voiv], pop_i,
                           salary.get(key), unempl.get(key)))
        if pop_i is not None:
            pop_by_voiv[voiv] = pop_by_voiv.get(voiv, 0) + pop_i
    dim_voiv = [(voiv_id[n], n, pop_by_voiv.get(n)) for n in voiv_names]
    print(f"[dims] {len(dim_voiv)} wojewodztw, {len(dim_powiat)} powiatow (klucze numeryczne)")
    return dim_powiat, dim_voiv


def _skip(rows, columns, neutral, msg):
    """Pominiety krok: ustaw kolumny zrodla na wartosci neutralne, wypisz powod."""
    print(msg)
    for r in rows:
        for col in columns:
            r.setdefault(col, neutral.get(col))


def run(no_geocode=False, limit=None, skip_gios=False, fallback=None,
        skip_parks=False, skip_gus=False, elevation=False,
        skip_amphibians=False, skip_paczkomaty=False):
    t0 = time.time()
    print(f"=== Dzienny ETL Żabki  {datetime.now().isoformat(timespec='seconds')} ===")

    raw = fetch_zabka_json(fallback=fallback)
    meta = raw.get("meta", {}) if isinstance(raw, dict) else {}
    rows = to_tabular(raw)

    con = duckdb.connect(DB_PATH)
    try:
        # wojewodztwo + powiat: point-in-polygon, offline (bez tysiecy zapytan API)
        if not no_geocode:
            RegionsEnricher().enrich(rows)
        else:
            _skip(rows, RegionsEnricher.columns,
                  {"voivodeship": None, "powiat": None},
                  "[regions] pominiete (--no-geocode)")

        # GIOŚ: najblizsza stacja jakosci powietrza per sklep (stacje -> dim_gios_station)
        gios_stations = []
        if not skip_gios:
            gios_stations = fetch_gios_stations()
            GiosEnricher(stations=gios_stations).enrich(rows)
        else:
            _skip(rows, GiosEnricher.columns,
                  {"gios_station_id": None, "gios_distance_km": None},
                  "[gios] pominiete (--skip-gios)")

        # --- Wzbogacenie geograficzne (ENRICHMENT.md) ---
        # Sekcja 5: najblizszy sasiad - lokalne, zawsze (tanie, bez sieci)
        neighbor = NeighborEnricher()
        neighbor.enrich(rows)
        loner = neighbor.fun_fact()

        # Sekcja 6: populacja plazow z GBIF (bo Zabka to zaba)
        froggy = None
        if not skip_amphibians:
            amphibians = AmphibiansEnricher()
            amphibians.enrich(rows)
            froggy = amphibians.fun_fact()
        else:
            _skip(rows, AmphibiansEnricher.columns,
                  {"amphibian_occurrences_5km": None, "nearest_amphibian_km": None},
                  "[amphibians] pominiete (--skip-amphibians)")

        # Parki/otuliny GDOŚ (point-in-polygon) - parki -> dim_park, fakt -> nature_park_id
        parks_enricher = ParksEnricher()
        if not skip_parks:
            parks_enricher.enrich(rows)
        else:
            _skip(rows, ParksEnricher.columns,
                  {"is_in_nature_park": False, "nature_park_id": None},
                  "[parks] pominiete (--skip-parks)")

        # Sekcja 3: wysokosc GUGiK NMT (per punkt, cache; opt-in bo 13k+ zapytan)
        if elevation:
            ElevationEnricher().enrich(rows)
        else:
            _skip(rows, ElevationEnricher.columns,
                  {"elevation_meters": None},
                  "[elevation] pominiete (wlacz --elevation)")

        # --- Paczkomaty: osobna encja faktow (stan najnowszy), geografia jak Żabki ---
        src_date = meta.get("source_date") or date.today().isoformat()
        if not skip_paczkomaty:
            lockers = fetch_parcel_lockers()
        else:
            lockers = []
            print("[paczkomaty] pominiete (--skip-paczkomaty)")

        # --- Wymiary geograficzne (klucze numeryczne) + ekonomia GUS w dim_powiat ---
        dim_powiat, dim_voiv = _build_geo_dims(rows, lockers, skip_gus)

        # --- Faza: obliczanie ciekawych faktow (fun_facts) ---
        # Najdalszy punkt Polski od Żabki + samotnik (sasiad) + najbardziej zabia Zabka.
        woj_geo = resolve_poland_boundaries(raw)
        farthest = None
        if woj_geo:
            lats = np.array([r["latitude"] for r in rows])
            lons = np.array([r["longitude"] for r in rows])
            farthest = farthest_point_from_any_zabka(lats, lons, woj_geo)
        else:
            print("[farthest] brak granic Polski - pomijam")
        fun = {
            "farthest_from_zabka": farthest,
            "most_isolated_zabka": loner,
            "most_froggy_zabka": froggy,
        }

        load_to_duckdb(con, rows, meta)
        load_parcel_lockers(con, lockers, src_date)
        load_dimensions(con, dim_powiat, dim_voiv)
        load_dim_gios_station(con, gios_stations)
        load_dim_park(con, parks_enricher.parks())
        load_fun_facts(con, fun)
    finally:
        con.close()

    reload_cache()
    print(f"=== Gotowe w {time.time()-t0:.1f}s ===")
