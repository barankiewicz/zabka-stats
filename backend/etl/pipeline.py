"""
Orkiestracja ETL Żabki.

Czyta sie liniowo: pobierz surowy JSON -> tabularyzuj -> wzbogac (kazde zrodlo
niezaleznie, przez wspolny interfejs Enricher) -> najdalszy punkt -> zaladuj do
DuckDB -> wyczysc cache. Pominiete kroki ustawiaja swoje kolumny na wartosci
neutralne (None/False), zeby ksztalt danych byl staly.
"""

import json
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb
import numpy as np

from backend.etl.geo import region_centroids
from backend.etl.io import (
    DB_PATH,
    farthest_point_from_any_zabka,
    fetch_zabka_json,
    load_dim_park,
    load_dimensions,
    load_fun_facts,
    load_parcel_lockers,
    load_to_duckdb,
    reload_cache,
    resolve_poland_boundaries,
    stamp_etl_run,
    to_tabular,
)
from backend.etl.sources.amphibians import AmphibiansEnricher
from backend.etl.sources.economy import _norm_powiat, fetch_gus_economics
from backend.etl.sources.elevation import ElevationEnricher
from backend.etl.sources.neighbor import NeighborEnricher
from backend.etl.sources.parcel_lockers import fetch_parcel_lockers
from backend.etl.sources.parks import ParksEnricher

_GEO_DIR = Path(__file__).parent.parent.parent / "data" / "geo"


def _load_powiat_centroids() -> dict:
    """{normalized_powiat_name: (lon, lat)} from the local powiaty.geojson
    (380 land + city polygons), keyed with the same normalizer GUS economics
    uses so it lines up with dim_powiat regardless of the 'powiat'/'m.' prefix."""
    path = _GEO_DIR / "powiaty.geojson"
    if not path.exists():
        return {}
    geojson = json.loads(path.read_text(encoding="utf-8"))
    return region_centroids(geojson, _norm_powiat)


def _build_geo_dims(rows: list[dict], lockers: list[dict], skip_gus: bool) -> tuple[list, list]:
    """Zbiera wojewodztwa i powiaty z obu faktow na bazie przypisanych juz id,
    po czym buduje wiersze wymiarow z ekonomia GUS.
    Zwraca (dim_powiat, dim_voivodeship) gotowe do zapisu."""
    facts = rows + lockers
    
    # Budujemy mapy identyfikatorow na nazwy z przypisanych juz geokodow
    voiv_map = {}
    powiat_map = {}
    for r in facts:
        vid, vname = r.get("voivodeship_id"), r.get("voivodeship")
        pid, pname = r.get("powiat_id"), r.get("powiat")
        if vid and vname:
            voiv_map[vid] = vname
        if pid and pname and vid:
            powiat_map[pid] = (pname, vid)

    salary, unempl, popul = ({}, {}, {}) if skip_gus else fetch_gus_economics()
    if skip_gus:
        print("[gus] pominiete (--skip-gus) - wymiary bez ekonomii")

    # GUS BDL returns {(voiv, powiat): value} and the voiv key disambiguates the
    # 10 powiat names that exist in more than one voivodeship. We MUST look up
    # by the full (voiv, key) tuple only - a name-only fallback would silently
    # copy the mazowiecki grodziski value onto the wielkopolski grodziski row
    # (or vice versa) whenever GUS has a gap for one of the pair. Better to
    # leave the field NULL than to publish the wrong number. See commit
    # "Fix per-capita and per-100k density" history for the original bug.
    def _lookup(d, voiv, key):
        return d.get((voiv, key))

    centroids = _load_powiat_centroids()
    dim_powiat, pop_by_voiv = [], {}
    for pid, (powiat, vid) in sorted(powiat_map.items()):
        voiv = voiv_map[vid]
        key = _norm_powiat(powiat)
        p = _lookup(popul, voiv, key)
        pop_i = int(p) if p is not None else None
        lon, lat = centroids.get(key, (None, None))
        dim_powiat.append((pid, powiat, vid, pop_i,
                           _lookup(salary, voiv, key),
                           _lookup(unempl, voiv, key),
                           lon, lat))
        if pop_i is not None:
            pop_by_voiv[voiv] = pop_by_voiv.get(voiv, 0) + pop_i
    missing = sum(1 for p in dim_powiat if p[6] is None)
    if missing:
        print(f"[dims] centroid nie znaleziony dla {missing}/{len(dim_powiat)} powiatow")
            
    dim_voiv = [(vid, name, pop_by_voiv.get(name)) for vid, name in sorted(voiv_map.items())]
    print(f"[dims] {len(dim_voiv)} wojewodztw, {len(dim_powiat)} powiatow (klucze numeryczne)")
    return dim_powiat, dim_voiv


def _skip(rows: list[dict], columns: list[str], neutral: dict[str, Any], msg: str) -> None:
    """Pominiety krok: ustaw kolumny zrodla na wartosci neutralne, wypisz powod."""
    print(msg)
    for r in rows:
        for col in columns:
            r.setdefault(col, neutral.get(col))


def run(no_geocode: bool = False,
        fallback: str | None = None, skip_parks: bool = False, skip_gus: bool = False,
        elevation: bool = False, skip_amphibians: bool = False,
        skip_paczkomaty: bool = False) -> None:
    t0 = time.time()
    print(f"=== Dzienny ETL Żabki  {datetime.now().isoformat(timespec='seconds')} ===")

    raw = fetch_zabka_json(fallback=fallback)
    meta = raw.get("meta", {}) if isinstance(raw, dict) else {}
    rows = to_tabular(raw)

    from backend.database import init_db
    init_db(keep_open=False)  # release read-only before opening read-write below

    con = duckdb.connect(DB_PATH)
    try:
        # wojewodztwo + powiat: GUGiK geocoding / cache z bazy administrative_division
        if not no_geocode:
            from backend.etl.geo_resolver import GugikGeoResolver
            resolver = GugikGeoResolver(con)
            resolver.resolve_facts(rows)
        else:
            _skip(rows, ["voivodeship", "powiat", "voivodeship_id", "powiat_id", "gmina_id", "miasto_id"],
                  {"voivodeship": None, "powiat": None, "voivodeship_id": None, "powiat_id": None, "gmina_id": None, "miasto_id": None},
                  "[regions] pominiete (--no-geocode)")

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
            if lockers and not no_geocode:
                from backend.etl.geo_resolver import GugikGeoResolver
                resolver = GugikGeoResolver(con)
                resolver.resolve_facts(lockers)
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
        load_dimensions(con, dim_powiat, dim_voiv, skip_gus=skip_gus)
        load_dim_park(con, parks_enricher.parks())
        load_fun_facts(con, fun)
        stamp_etl_run(con)
    finally:
        con.close()

    reload_cache()
    print(f"=== Gotowe w {time.time()-t0:.1f}s ===")
