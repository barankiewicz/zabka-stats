"""
Wejscie/wyjscie ETL Żabki.

Pobieranie surowego JSON, zamiana na forme tabelaryczna, ladowanie geojsonow
(granice administracyjne + statyczne zbiory), najdalszy punkt Polski, zapis do
DuckDB i przeladowanie cache Redis. Cala styczna z siecia, dyskiem i baza zyje
tutaj; wzbogacenia (etl/sources) operuja juz tylko na liscie wierszy.
"""

import json
import os
import re
import time
from collections import defaultdict
from datetime import date, datetime

import h3
import numpy as np
import polars as pl
import requests

from backend.database_ch import ENRICHMENT_COLUMNS
from backend.etl.geo import EARTH_KM, poland_rings

DB_PATH = os.getenv("ZABKA_DB", "data/zabka.duckdb")
# Zrodlo danych Zabki - publiczny locator. Nadpisywalny przez env.
ZABKA_SOURCE_URL = os.getenv(
    "ZABKA_SOURCE_URL",
    "https://www.zabka.pl/app/uploads/locator-store-data.json",
)
USER_AGENT = "zabka-dashboard-etl/1.0"

# --- Polityka ponawiania dla krokow sieciowych ---
# API zrodlowe bywaja kapryśne. Kazdy fetch ze zrodla ponawiamy do RETRY_ATTEMPTS
# razy, czekajac RETRY_DELAY sekund miedzy probami (domyslnie 3 prob co 1 minute -
# damy szanse na przelotne problemy). Pojedyncze zapytanie ma timeout HTTP_TIMEOUT.
# Po wyczerpaniu prob caller leci dalej bez zrodla (best-effort / lazy, kolumna pusta).
RETRY_ATTEMPTS = int(os.getenv("ETL_RETRY_ATTEMPTS", "3"))
RETRY_DELAY = float(os.getenv("ETL_RETRY_DELAY", "60"))
HTTP_TIMEOUT = float(os.getenv("ETL_HTTP_TIMEOUT", "30"))


def with_retries(fn, label, attempts=None, delay=None):
    """Wolaj fn() ponawiajac przy wyjatku: do `attempts` prob, `delay` s przerwy.
    Maksymalny czas oczekiwania to ~attempts*delay. fn musi rzucic wyjatek przy
    niepowodzeniu. Po wyczerpaniu prob zwraca None - caller robi best-effort
    (lazy loading bez zrodla). Sukces zwraca natychmiast."""
    attempts = attempts or RETRY_ATTEMPTS
    delay = RETRY_DELAY if delay is None else delay
    for i in range(1, attempts + 1):
        try:
            return fn()
        except Exception as e:
            if i < attempts:
                print(f"[{label}] proba {i}/{attempts} nieudana ({e}); ponawiam za {delay:.0f}s")
                time.sleep(delay)
            else:
                print(f"[{label}] {attempts} prob nieudanych ({e}) - lece dalej bez zrodla (lazy)")
    return None

# Granice administracyjne Polski (ppatrzyk/polska-geojson). Pobierane raz, cache lokalny.
GEOJSON_WOJ = "https://raw.githubusercontent.com/ppatrzyk/polska-geojson/master/wojewodztwa/wojewodztwa-min.geojson"
GEOJSON_POW = "https://raw.githubusercontent.com/ppatrzyk/polska-geojson/master/powiaty/powiaty-min.geojson"
GEO_DIR = "data/geo"

# Pola PII ze zrodla Zabki - NIGDY nie zapisujemy (dane osobowe dyrektorow)
_PII_FIELDS = {"salesZoneDirector", "salesZoneDirectorEmail", "salesZoneDirectorId"}
# Pola-smieci pomijane: stale, wewnetrzne id, url-e marketingowe
_JUNK_FIELDS = {"active", "salesZoneId", "locationId", "townId",
                "storeUrl", "relativeStoreUrl"}


# ---------------------------------------------------------------------------
# 1. FETCH
# ---------------------------------------------------------------------------
def fetch_zabka_json(url: str = ZABKA_SOURCE_URL, fallback: str = None) -> dict:
    """Pobierz surowy JSON ze sklepami (z ponawianiem). Gdy sie nie uda mimo prob -
    uzyj pliku lokalnego, a gdy i tego brak - rzuc (bez sklepow nie ma ETL)."""
    def _download():
        print(f"[fetch] pobieram {url}")
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        print(f"[fetch] OK, {len(json.dumps(data)):,} bajtow")
        return data

    data = with_retries(_download, "fetch")
    if data is not None:
        return data
    if fallback and os.path.exists(fallback):
        print(f"[fetch] uzywam pliku lokalnego: {fallback}")
        with open(fallback, encoding="utf-8") as f:
            return json.load(f)
    raise RuntimeError("nie udalo sie pobrac zrodla Zabki i brak pliku fallback")


# ---------------------------------------------------------------------------
# 2. TO TABULAR
# ---------------------------------------------------------------------------
def _derive_h24(hours: dict) -> bool:
    """24h gdy okno mon-sat to pelna doba. Zabka koduje to jako '00:00:00 - 00:00:00'."""
    v = ((hours or {}).get("mon-sat", "") or "").strip()
    return v in ("00:00:00 - 00:00:00", "00:00:00 - 24:00:00", "00:00 - 24:00")


def _derive_open_sunday(hours: dict) -> bool:
    return bool((hours or {}).get("sun"))


def _normalize_city(town: str) -> str:
    """Ujednolic wielkosc liter (LEGNICA -> Legnica), zwin biale znaki."""
    if not town:
        return None
    return re.sub(r"\s+", " ", town.strip()).title()


def _clean_street(street: str) -> str:
    """Usun <br> i wklejony kod pocztowy z wyswietlanej nazwy ulicy."""
    if not street:
        return "nieokreślona"
    s = street.replace("<br>", " ").replace("<br/>", " ")
    m = re.search(r"\b(\d{2}-\d{3})\b", s)
    if m:
        s = s.replace(m.group(1), " ")
    s = re.sub(r"\s+", " ", s).strip(" ,;")
    return s or "nieokreślona"


def _dedupe(records: list) -> list:
    """Usun zduplikowane sklepy. Po storeId preferuj czysty rekord (locationId 'ID', bez <br>)."""
    groups = defaultdict(list)
    for s in records:
        groups[s.get("storeId") or s.get("locationId")].append(s)

    def score(s):
        lid = s.get("locationId", "") or ""
        return (lid.startswith("ID"), "<br>" not in (s.get("street") or ""))

    return [max(v, key=score) for v in groups.values()]


def to_tabular(raw) -> list:
    """
    Zamien surowy JSON Zabki na czysta liste rekordow.
    Dedup, czyszczenie ulic, normalizacja miast, derywacja flag. PII i smieci odrzucone.
    """
    rows = []
    if isinstance(raw, list):
        records = raw
    elif isinstance(raw, dict) and isinstance(raw.get("locations"), list):
        records = raw["locations"]
    elif isinstance(raw, dict) and isinstance(raw.get("points") , list):
        for i, p in enumerate(raw["points"]):
            rows.append({"store_id": f"zabka_{i:05d}", "city": None, "street": None,
                         "latitude": float(p[0]), "longitude": float(p[1]),
                         "has_merrychef": None, "open_sunday": None, "h24": None,
                         "opening_hours_monsat": None, "opening_hours_sun": None,
                         "first_opening_date": None, "is_visible": None, "is_new_month": None, "is_new_two_weeks": None})
        print(f"[tabular] {len(rows):,} rekordow (mockup points)")
        return rows
    else:
        raise ValueError("Nieznany ksztalt JSON Zabki")

    n_raw = len(records)
    records = _dedupe(records)
    n_dedup = len(records)
    cleaned_streets = 0
    for loc in records:
        hours = loc.get("openingHours") or {}
        raw_street = loc.get("street") or ""
        street = _clean_street(raw_street)
        if raw_street and ("<br>" in raw_street or re.search(r"\b\d{2}-\d{3}\b", raw_street)):
            cleaned_streets += 1
        lat = float(loc.get("lat", loc.get("latitude")))
        lon = float(loc.get("lon", loc.get("longitude")))
        rows.append({
            "store_id": loc.get("storeId") or loc.get("locationId"),
            "city": _normalize_city(loc.get("town") or loc.get("city")),
            "street": street,
            "latitude": lat,
            "longitude": lon,
            "has_merrychef": bool(loc.get("locatorMerrychef")),
            "open_sunday": _derive_open_sunday(hours),
            "h24": _derive_h24(hours),
            "opening_hours_monsat": hours.get("mon-sat"),
            "opening_hours_sun": hours.get("sun"),
            "first_opening_date": loc.get("firstOpeningDate") or None,
            "is_visible": bool(loc.get("isVisible")) if loc.get("isVisible") is not None else None,
            "is_new_month": bool(loc.get("locatorNewMonth")),
            "is_new_two_weeks": bool(loc.get("locatorNewTwoWeeks")),
            "h3_index_9": h3.latlng_to_cell(lat, lon, 9),
        })
    print(f"[tabular] {n_raw:,} surowych -> {n_dedup:,} po dedup "
          f"({n_raw-n_dedup} duplikatow usunietych); {cleaned_streets} ulic wyczyszczonych")
    print(f"[tabular] odrzucone PII: {sorted(_PII_FIELDS)} | smieci: {sorted(_JUNK_FIELDS)}")
    return rows


# ---------------------------------------------------------------------------
# GEOJSON LOADERS
# ---------------------------------------------------------------------------
def load_geojson(url: str, cache_name: str) -> dict:
    """Pobierz GeoJSON (cache lokalny w data/geo, z ponawianiem). Granice sie nie zmieniaja."""
    os.makedirs(GEO_DIR, exist_ok=True)
    path = os.path.join(GEO_DIR, cache_name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def _download():
        r = requests.get(url, timeout=max(HTTP_TIMEOUT, 60))
        r.raise_for_status()
        return r.json()

    gj = with_retries(_download, f"geojson:{cache_name}")
    if gj is None:
        raise RuntimeError(f"nie udalo sie pobrac granic {cache_name}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    return gj


def load_static_geojson(local_path: str, url: str, label: str) -> dict:
    """GeoJSON dla danych statycznych: najpierw plik lokalny, potem opcjonalny URL
    (z ponawianiem). Zwraca None gdy ani pliku, ani dzialajacego URL - krok pominiety."""
    if local_path and os.path.exists(local_path):
        try:
            with open(local_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[{label}] plik lokalny nieczytelny ({e})")
    if not url:
        return None

    def _download():
        print(f"[{label}] pobieram {url}")
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=max(HTTP_TIMEOUT, 120))
        r.raise_for_status()
        return r.json()

    gj = with_retries(_download, label)
    if gj is None:
        return None
    os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)
    return gj


def resolve_poland_boundaries(raw) -> dict:
    """Granice Polski (do najdalszego punktu). Domyslnie te same granice wojewodztw,
    ktorych uzywa RegionsEnricher (`data/geo/wojewodztwa.geojson`) - zawsze obecne po
    geokodowaniu. Opcjonalnie nadpisywalne polem `woj_geo` w zrodle lub plikiem."""
    woj_geo = raw.get("woj_geo") if isinstance(raw, dict) else None
    if not woj_geo:
        cand = "data/woj_geo.json"
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                wj = json.load(f)
            woj_geo = wj.get("woj_geo", wj) if isinstance(wj, dict) else None
            if woj_geo:
                print(f"[farthest] granice Polski z {cand}")
    if not woj_geo:
        try:
            woj_geo = load_geojson(GEOJSON_WOJ, "wojewodztwa.geojson")
            print("[farthest] granice Polski z data/geo/wojewodztwa.geojson")
        except Exception as e:
            print(f"[farthest] nie udalo sie wczytac granic: {e}")
    return woj_geo


# ---------------------------------------------------------------------------
# NAJDALSZY PUNKT POLSKI OD JAKIEJKOLWIEK ŻABKI  (najwieksze puste kolo)
# ---------------------------------------------------------------------------
def farthest_point_from_any_zabka(lats, lons, woj_geo: dict,
                                  coarse_deg=0.15, fine_deg=0.01) -> dict:
    """
    Znajdz punkt w granicach Polski najdalszy od najblizszej Żabki
    (problem najwiekszego pustego kola). Zwraca {lat, lon, dist_km}.
    """
    from sklearn.neighbors import BallTree

    from backend.etl.geo import ring_contains

    pts = np.radians(np.column_stack([lats, lons]))
    tree = BallTree(pts, metric="haversine")
    raw_rings = poland_rings(woj_geo)

    # Subsample rings to speed up ray casting and precompute bboxes
    prepared_rings = []
    for r in raw_rings:
        # Take every 20th coordinate to speed up, keep the first/last
        sub = r[::20]
        if not sub or sub[-1] != r[-1]:
            sub.append(r[-1])
        xs = [pt[0] for pt in sub]
        ys = [pt[1] for pt in sub]
        bbox = (min(xs), min(ys), max(xs), max(ys))
        prepared_rings.append((bbox, sub))

    def point_in_prepared(lon, lat):
        inside = False
        for (x0, y0, x1, y1), ring in prepared_rings:
            if x0 <= lon <= x1 and y0 <= lat <= y1:
                if ring_contains(lon, lat, ring):
                    inside = not inside
                    break # disjoint voivodeships
        return inside

    def nearest_km(grid_lat, grid_lon):
        q = np.radians(np.column_stack([grid_lat, grid_lon]))
        d, _ = tree.query(q, k=1)
        return d[:, 0] * EARTH_KM

    def search(lat0, lat1, lon0, lon1, step):
        glat = np.arange(lat0, lat1, step)
        glon = np.arange(lon0, lon1, step)
        LON, LAT = np.meshgrid(glon, glat)
        LAT = LAT.ravel()
        LON = LON.ravel()
        # tylko punkty wewnatrz Polski
        mask = np.array([point_in_prepared(lo, la)
                         for la, lo in zip(LAT, LON)])
        if not mask.any():
            return None
        LAT, LON = LAT[mask], LON[mask]
        dist = nearest_km(LAT, LON)
        k = int(np.argmax(dist))
        return {"lat": float(LAT[k]), "lon": float(LON[k]), "dist_km": float(dist[k])}

    # zgrubnie po calej Polsce
    coarse = search(48.9, 55.0, 14.0, 24.2, coarse_deg)
    if not coarse:
        return {"lat": None, "lon": None, "dist_km": None}
    # doprecyzuj wokol zwyciezcy
    fine = search(coarse["lat"] - coarse_deg, coarse["lat"] + coarse_deg,
                  coarse["lon"] - coarse_deg, coarse["lon"] + coarse_deg, fine_deg)
    best = fine if fine and fine["dist_km"] >= coarse["dist_km"] else coarse
    print(f"[farthest] punkt ({best['lat']:.4f}, {best['lon']:.4f}) "
          f"= {best['dist_km']:.1f} km od najblizszej Żabki")
    return best


# ---------------------------------------------------------------------------
# LOAD DO DUCKDB
# ---------------------------------------------------------------------------
def ensure_enrichment_columns(con):
    """Dodaj brakujace kolumny wzbogacenia (gdy baza powstala przed ENRICHMENT.md).
    ALTER bez DEFAULT - replay WAL dla 'ADD COLUMN ... DEFAULT' wywala sie w DuckDB."""
    for name, decl in ENRICHMENT_COLUMNS:
        con.execute(f"ALTER TABLE locations ADD COLUMN IF NOT EXISTS {name} {decl}")


def load_to_duckdb(con, rows: list, meta: dict):
    """Zapisz snapshot w tabeli locations.
    store_id jest kluczem glownym — jeden wiersz na sklep:
    - nowe sklepy: INSERT z created_at = source_date
    - istniejace: UPDATE wszystkich pol oprocz created_at (ON CONFLICT)
    - brakujace: soft-delete (deleted_at = source_date)
    - wroty (deleted -> obecny): deleted_at = NULL (przywrocone przez ON CONFLICT)
    """
    ensure_enrichment_columns(con)
    src_date = meta.get("source_date") or date.today().isoformat()
    src_dt = datetime.fromisoformat(src_date)

    schema = {
        "store_id": pl.Utf8,
        "city": pl.Utf8,
        "street": pl.Utf8,
        "voivodeship": pl.Utf8,
        "powiat": pl.Utf8,
        "voivodeship_id": pl.Int32,
        "powiat_id": pl.Int32,
        "latitude": pl.Float64,
        "longitude": pl.Float64,
        "has_merrychef": pl.Boolean,
        "open_sunday": pl.Boolean,
        "h24": pl.Boolean,
        "opening_hours_monsat": pl.Utf8,
        "opening_hours_sun": pl.Utf8,
        "first_opening_date": pl.Utf8,
        "is_visible": pl.Boolean,
        "is_new_month": pl.Boolean,
        "is_new_two_weeks": pl.Boolean,
        "elevation_meters": pl.Float64,
        "is_in_nature_park": pl.Boolean,
        "nature_park_id": pl.Int32,
        "nearest_neighbor_distance_meters": pl.Int32,
        "amphibian_occurrences_5km": pl.Int32,
        "nearest_amphibian_km": pl.Float64,
        "gmina_id": pl.Int32,
        "miasto_id": pl.Int32,
        "h3_index_9": pl.Utf8,
    }

    for r in rows:
        if not r.get("first_opening_date"):
            r["first_opening_date"] = None
        for col in schema:
            if col not in r:
                r[col] = None

    incoming_df = pl.DataFrame(rows, schema=schema)
    incoming_df = incoming_df.filter(pl.col("store_id").is_not_null()).unique(subset=["store_id"])

    for idx in ("idx_locations_city", "idx_locations_voivodeship", "idx_locations_powiat",
                "idx_locations_deleted_at", "idx_locations_created_at",
                "idx_locations_voivodeship_id", "idx_locations_powiat_id",
                "idx_locations_miasto_id", "idx_locations_gmina_id", "idx_locations_h3_index_9"):
        try:
            con.execute(f"DROP INDEX IF EXISTS {idx}")
        except Exception:
            pass

    con.register("incoming_df", incoming_df)

    # Soft-delete: stores active in DB but absent from this snapshot
    deleted = con.execute("""
        UPDATE locations
        SET deleted_at = ?
        WHERE store_id NOT IN (SELECT store_id FROM incoming_df)
          AND deleted_at IS NULL
    """, [src_dt]).rowcount
    if deleted and deleted > 0:
        print(f"[load] soft-deleted {deleted} stores")

    # Upsert: insert new stores, update existing (created_at preserved via ON CONFLICT)
    con.execute("""
        INSERT INTO locations (
            store_id, city, street, voivodeship, powiat,
            voivodeship_id, powiat_id, latitude, longitude,
            has_merrychef, open_sunday, h24,
            opening_hours_monsat, opening_hours_sun, first_opening_date,
            is_visible, is_new_month, is_new_two_weeks,
            elevation_meters, is_in_nature_park, nature_park_id,
            nearest_neighbor_distance_meters,
            amphibian_occurrences_5km, nearest_amphibian_km,
            gmina_id, miasto_id, h3_index_9,
            created_at, deleted_at
        )
        SELECT
            store_id, city, street, voivodeship, powiat,
            voivodeship_id, powiat_id, latitude, longitude,
            has_merrychef, open_sunday, h24,
            opening_hours_monsat, opening_hours_sun, CAST(first_opening_date AS DATE),
            is_visible, is_new_month, is_new_two_weeks,
            elevation_meters, is_in_nature_park, nature_park_id,
            nearest_neighbor_distance_meters,
            amphibian_occurrences_5km, nearest_amphibian_km,
            gmina_id, miasto_id, h3_index_9,
            ? AS created_at,
            CAST(NULL AS TIMESTAMP) AS deleted_at
        FROM incoming_df
        ON CONFLICT (store_id) DO UPDATE SET
            city = excluded.city,
            street = excluded.street,
            voivodeship = excluded.voivodeship,
            powiat = excluded.powiat,
            voivodeship_id = excluded.voivodeship_id,
            powiat_id = excluded.powiat_id,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            has_merrychef = excluded.has_merrychef,
            open_sunday = excluded.open_sunday,
            h24 = excluded.h24,
            opening_hours_monsat = excluded.opening_hours_monsat,
            opening_hours_sun = excluded.opening_hours_sun,
            first_opening_date = excluded.first_opening_date,
            is_visible = excluded.is_visible,
            is_new_month = excluded.is_new_month,
            is_new_two_weeks = excluded.is_new_two_weeks,
            elevation_meters = excluded.elevation_meters,
            is_in_nature_park = excluded.is_in_nature_park,
            nature_park_id = excluded.nature_park_id,
            nearest_neighbor_distance_meters = excluded.nearest_neighbor_distance_meters,
            amphibian_occurrences_5km = excluded.amphibian_occurrences_5km,
            nearest_amphibian_km = excluded.nearest_amphibian_km,
            gmina_id = excluded.gmina_id,
            miasto_id = excluded.miasto_id,
            h3_index_9 = excluded.h3_index_9,
            deleted_at = NULL
    """, [src_dt])

    con.unregister("incoming_df")

    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_locations_city ON locations(city)",
        "CREATE INDEX IF NOT EXISTS idx_locations_deleted_at ON locations(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_locations_created_at ON locations(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_locations_voivodeship_id ON locations(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_powiat_id ON locations(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_miasto_id ON locations(miasto_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_gmina_id ON locations(gmina_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_h3_index_9 ON locations(h3_index_9)",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass

    active = con.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    print(f"[load] snapshot ({src_date}): {len(rows):,} incoming, {active:,} active in DB")


# ---------------------------------------------------------------------------
# FAZA: ciekawe fakty (fun_facts)
# ---------------------------------------------------------------------------
def load_fun_facts(con, facts: dict):
    """Zapisz ciekawe fakty do tabeli fun_facts. `facts` = {key: {lat, lon, value}}.
    Tu trafia m.in. najdalszy punkt Polski od Żabki, samotnik i najbardziej zabia Zabka."""
    con.execute("""CREATE TABLE IF NOT EXISTS fun_facts
        (key VARCHAR PRIMARY KEY, lat DOUBLE, lon DOUBLE, value DOUBLE, computed_at TIMESTAMP)""")
    n = 0
    for key, f in (facts or {}).items():
        if not f or f.get("lat") is None:
            continue
        con.execute("INSERT OR REPLACE INTO fun_facts VALUES (?, ?, ?, ?, now())",
                    [key, f["lat"], f["lon"], f.get("value", f.get("dist_km"))])
        n += 1
    print(f"[fun_facts] zapisano {n} faktow: {', '.join(sorted(facts or {}))}")


# ---------------------------------------------------------------------------
# PRZEŁADUJ CACHE REDIS
# ---------------------------------------------------------------------------
def reload_cache():
    """Wyczysc cache Redis. Backend odbuduje go przy nastepnym zapytaniu."""
    try:
        from backend.cache import clear_cache
        clear_cache("*")
        print("[cache] Redis wyczyszczony - backend odbuduje przy nastepnym zapytaniu")
    except Exception as e:
        print(f"[cache] pominiete ({e})")


# ---------------------------------------------------------------------------
# LOAD: paczkomaty (osobna encja) + wymiary geograficzne
# ---------------------------------------------------------------------------
def load_parcel_lockers(con, lockers: list, src_date: str):
    """Zapisz paczkomaty w tabeli parcel_lockers.
    Porównuje biezace aktywne paczkomaty z wejsciowymi:
    - nowe sa wstawiane (created_at = source_date)
    - brakujace sa soft-deletowane (deleted_at = source_date)
    - istniejace aktywne sa aktualizowane w miejscu gdy ulegly zmianie.
    """
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    if not lockers:
        print("[paczkomaty] brak danych")
        return
        
    src_dt = datetime.fromisoformat(src_date)
    
    # Drop secondary indexes to avoid index corruption/fatal errors during bulk update
    for idx in ("idx_lockers_voiv_id", "idx_lockers_powiat_id", "idx_lockers_miasto_id", "idx_lockers_gmina_id", "idx_lockers_deleted_at", "idx_lockers_external_id"):
        try:
            con.execute(f"DROP INDEX IF EXISTS {idx}")
        except Exception:
            pass

    # 1. Load incoming rows into Polars DataFrame
    schema = {
        "external_id": pl.Utf8,
        "source_date": pl.Utf8,
        "latitude": pl.Float64,
        "longitude": pl.Float64,
        "voivodeship_id": pl.Int32,
        "powiat_id": pl.Int32,
        "miasto_id": pl.Int32,
        "gmina_id": pl.Int32,
        "status": pl.Utf8
    }

    # Ensure all columns present
    for L in lockers:
        L["source_date"] = src_date
        for col in schema:
            if col not in L:
                L[col] = None

    incoming_df = pl.DataFrame(lockers, schema=schema)
    incoming_df = incoming_df.filter(pl.col("external_id").is_not_null()).unique(subset=["external_id"])

    # 2. Get active database records into Polars DataFrame
    active_arrow = con.execute("""
        SELECT id, external_id, latitude, longitude, voivodeship_id, powiat_id, miasto_id, gmina_id, status 
        FROM parcel_lockers 
        WHERE deleted_at IS NULL
    """).to_arrow_table()
    if active_arrow.num_rows == 0:
        active_df = pl.DataFrame(schema={
            "id": pl.Int64, "external_id": pl.Utf8, "latitude": pl.Float64, "longitude": pl.Float64,
            "voivodeship_id": pl.Int32, "powiat_id": pl.Int32, "miasto_id": pl.Int32, "gmina_id": pl.Int32, "status": pl.Utf8
        })
    else:
        active_df = pl.from_arrow(active_arrow)

    # 3. Soft-deletes: active in DB, but not in incoming data
    to_delete_df = active_df.join(incoming_df, on="external_id", how="anti")
    if not to_delete_df.is_empty():
        con.register("to_delete_df", to_delete_df)
        con.execute("""
            UPDATE parcel_lockers 
            SET deleted_at = ?
            FROM to_delete_df 
            WHERE parcel_lockers.id = to_delete_df.id
        """, [src_dt])
        con.unregister("to_delete_df")
        print(f"[paczkomaty] soft-deleted {len(to_delete_df)} parcel lockers")

    # 4. Inserts: incoming, but not in active DB
    to_insert_df = incoming_df.join(active_df, on="external_id", how="anti")
    if not to_insert_df.is_empty():
        con.register("to_insert_df", to_insert_df)
        con.execute("""
            INSERT INTO parcel_lockers (
                id, external_id, source_date, latitude, longitude, 
                voivodeship_id, powiat_id, miasto_id, gmina_id, status, 
                created_at, deleted_at
            )
            SELECT 
                nextval('seq_parcel_lockers'),
                external_id, CAST(source_date AS DATE), latitude, longitude, 
                voivodeship_id, powiat_id, miasto_id, gmina_id, status, 
                ? as created_at, CAST(NULL AS TIMESTAMP) as deleted_at
            FROM to_insert_df
        """, [src_dt])
        con.unregister("to_insert_df")
        print(f"[paczkomaty] inserted {len(to_insert_df):,} new parcel lockers")

    # 5. Updates: incoming, and also in active DB
    to_update_df = incoming_df.join(active_df, on="external_id", how="inner", suffix="_db")
    
    # Filter to rows where values changed
    to_update_df = to_update_df.filter(
        ((pl.col("latitude") - pl.col("latitude_db")).abs() > 1e-5) |
        ((pl.col("longitude") - pl.col("longitude_db")).abs() > 1e-5) |
        (pl.col("voivodeship_id") != pl.col("voivodeship_id_db")) |
        (pl.col("powiat_id") != pl.col("powiat_id_db")) |
        (pl.col("miasto_id") != pl.col("miasto_id_db")) |
        (pl.col("gmina_id") != pl.col("gmina_id_db")) |
        (pl.col("status") != pl.col("status_db"))
    )

    if not to_update_df.is_empty():
        con.register("to_update_df", to_update_df)
        con.execute("""
            UPDATE parcel_lockers SET
                source_date = CAST(u.source_date AS DATE),
                latitude = u.latitude,
                longitude = u.longitude,
                voivodeship_id = u.voivodeship_id,
                powiat_id = u.powiat_id,
                miasto_id = u.miasto_id,
                gmina_id = u.gmina_id,
                status = u.status
            FROM to_update_df AS u
            WHERE parcel_lockers.id = u.id
        """)
        con.unregister("to_update_df")
        print(f"[paczkomaty] updated {len(to_update_df)} existing parcel lockers")

    # Recreate secondary indexes
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_lockers_voiv_id ON parcel_lockers(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_powiat_id ON parcel_lockers(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_miasto_id ON parcel_lockers(miasto_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_gmina_id ON parcel_lockers(gmina_id)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_deleted_at ON parcel_lockers(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_lockers_external_id ON parcel_lockers(external_id)",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass


def enforce_retention(con, src_date: str, months: int = 6):
    """Rolling window: trzymaj tylko dane z ostatnich `months` miesiecy.
    Usuwa soft-deletowane lokalizacje i paczkomaty starsze niz prog."""
    from dateutil.relativedelta import relativedelta
    cutoff = (date.fromisoformat(str(src_date)) - relativedelta(months=months)).isoformat()
    
    deleted_locs = con.execute("DELETE FROM locations WHERE deleted_at < ?", [cutoff]).rowcount or 0
    deleted_lockers = con.execute("DELETE FROM parcel_lockers WHERE deleted_at < ?", [cutoff]).rowcount or 0
    print(f"[retencja] usunieto {deleted_locs} usunietych sklepow i {deleted_lockers} paczkomatow starszych niz {cutoff}")


def load_dimensions(con, dim_powiat: list, dim_voivodeship: list):
    """Aktualizuje wymiary geograficzne (populacja, płaca, bezrobocie) 
    w tabeli administrative_division na bazie danych z GUS.
    """
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    
    if dim_voivodeship:
        payload_voiv = [(v[2], v[0]) for v in dim_voivodeship]
        con.executemany("UPDATE administrative_division SET population = ? WHERE id = ?", payload_voiv)
        
    if dim_powiat:
        payload_pow = [(p[3], p[4], p[5], p[0]) for p in dim_powiat]
        con.executemany("UPDATE administrative_division SET population = ?, avg_salary = ?, unemployment_rate = ? WHERE id = ?", payload_pow)
        
    print(f"[dims] Zaktualizowano dane GUS dla {len(dim_voivodeship)} wojewodztw i {len(dim_powiat)} powiatow w administrative_division")


def load_dim_park(con, parks: list):
    """Zapisz wymiar parku/otuliny GDOŚ (replace). parks: [(id, name, type)]."""
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    con.execute("DELETE FROM dim_park")
    if parks:
        con.executemany("INSERT INTO dim_park (id, name, type) VALUES (?,?,?)", parks)
    print(f"[dims] dim_park: {len(parks or [])}")
