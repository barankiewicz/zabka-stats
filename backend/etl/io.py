"""
Wejscie/wyjscie ETL Żabki.

Pobieranie surowego JSON, zamiana na forme tabelaryczna, ladowanie geojsonow
(granice administracyjne + statyczne zbiory), najdalszy punkt Polski, zapis do
DuckDB i przeladowanie cache Redis. Cala styczna z siecia, dyskiem i baza zyje
tutaj; wzbogacenia (etl/sources) operuja juz tylko na liscie wierszy.
"""

import os
import re
import json
import time
from collections import defaultdict
from datetime import date, datetime

import requests
import numpy as np

from backend.etl.geo import EARTH_KM, poland_rings
from backend.database_ch import ENRICHMENT_COLUMNS

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
        rows.append({
            "store_id": loc.get("storeId") or loc.get("locationId"),
            "city": _normalize_city(loc.get("town") or loc.get("city")),
            "street": street,
            "latitude": float(loc.get("lat", loc.get("latitude"))),
            "longitude": float(loc.get("lon", loc.get("longitude"))),
            "has_merrychef": bool(loc.get("locatorMerrychef")),
            "open_sunday": _derive_open_sunday(hours),
            "h24": _derive_h24(hours),
            "opening_hours_monsat": hours.get("mon-sat"),
            "opening_hours_sun": hours.get("sun"),
            "first_opening_date": loc.get("firstOpeningDate") or None,
            "is_visible": bool(loc.get("isVisible")) if loc.get("isVisible") is not None else None,
            "is_new_month": bool(loc.get("locatorNewMonth")),
            "is_new_two_weeks": bool(loc.get("locatorNewTwoWeeks")),
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
        for cand in ("data/woj_geo.json", "test/dashboard_data.json"):
            if os.path.exists(cand):
                with open(cand, encoding="utf-8") as f:
                    wj = json.load(f)
                woj_geo = wj.get("woj_geo", wj) if isinstance(wj, dict) else None
                if woj_geo:
                    print(f"[farthest] granice Polski z {cand}")
                    break
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
    """Zapisz snapshot jako SCD Type 2 w tabeli locations.
    Porównuje biezace aktywne sklepy z wejsciowymi:
    - nowe sklepy sa wstawiane (created_at = source_date)
    - brakujace sklepy sa soft-deletowane (deleted_at = source_date)
    - istniejace aktywne sa aktualizowane w miejscu.
    """
    ensure_enrichment_columns(con)
    src_date = meta.get("source_date") or date.today().isoformat()
    src_dt = datetime.fromisoformat(src_date)
    
    # Drop secondary indexes to avoid index corruption/fatal errors during bulk update
    for idx in ("idx_locations_city", "idx_locations_voivodeship", "idx_locations_powiat",
                "idx_locations_deleted_at", "idx_locations_store_id", "idx_locations_created_at",
                "idx_locations_voivodeship_id", "idx_locations_powiat_id",
                "idx_locations_voiv_id", "idx_locations_powiat_id", "idx_locations_miasto_id", "idx_locations_gmina_id"):
        try:
            con.execute(f"DROP INDEX IF EXISTS {idx}")
        except Exception:
            pass
            
    # 1. Pobierz wszystkie aktywne store_id z bazy danych (gdzie deleted_at IS NULL)
    db_active = {}
    db_rows = con.execute("SELECT store_id, id FROM locations WHERE deleted_at IS NULL").fetchall()
    for store_id, db_id in db_rows:
        db_active[store_id] = db_id

    incoming_store_ids = {r["store_id"] for r in rows}
    
    # 2. Sklepy do soft-delete (te co sa w db_active, ale nie w incoming)
    to_delete = [db_id for store_id, db_id in db_active.items() if store_id not in incoming_store_ids]
    if to_delete:
        con.executemany("UPDATE locations SET deleted_at = ? WHERE id = ?", 
                        [(src_dt, db_id) for db_id in to_delete])
        print(f"[load] soft-deleted {len(to_delete)} stores (not present in incoming data)")

    # 3. Rozdziel incoming rows na nowe i do aktualizacji
    to_insert = []
    to_update = []
    
    for r in rows:
        store_id = r["store_id"]
        fod = r.get("first_opening_date") or None
        vals = (
            r.get("store_id"),
            r.get("city"),
            r.get("street"),
            r.get("voivodeship"),
            r.get("powiat"),
            r.get("voivodeship_id"),
            r.get("powiat_id"),
            r["latitude"],
            r["longitude"],
            r.get("has_merrychef"),
            r.get("open_sunday"),
            r.get("h24"),
            r.get("opening_hours_monsat"),
            r.get("opening_hours_sun"),
            fod,
            r.get("is_visible"),
            r.get("is_new_month"),
            r.get("is_new_two_weeks"),
            r.get("elevation_meters"),
            r.get("is_in_nature_park"),
            r.get("nature_park_id"),
            r.get("nearest_neighbor_distance_meters"),
            r.get("amphibian_occurrences_5km"),
            r.get("nearest_amphibian_km"),
            r.get("gmina_id"),
            r.get("miasto_id")
        )
        
        if store_id in db_active:
            to_update.append(vals[1:] + (db_active[store_id],))
        else:
            to_insert.append(vals + (src_dt, None))

    if to_insert:
        con.executemany("""
            INSERT INTO locations (
                id, store_id, city, street, voivodeship, powiat,
                voivodeship_id, powiat_id, latitude, longitude,
                has_merrychef, open_sunday, h24,
                opening_hours_monsat, opening_hours_sun, first_opening_date,
                is_visible, is_new_month, is_new_two_weeks,
                elevation_meters, is_in_nature_park, nature_park_id,
                nearest_neighbor_distance_meters,
                amphibian_occurrences_5km, nearest_amphibian_km,
                gmina_id, miasto_id,
                created_at, deleted_at
            ) VALUES (nextval('seq_locations'),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, to_insert)
        print(f"[load] inserted {len(to_insert)} new stores")

    if to_update:
        con.executemany("""
            UPDATE locations SET
                city = ?,
                street = ?,
                voivodeship = ?,
                powiat = ?,
                voivodeship_id = ?,
                powiat_id = ?,
                latitude = ?,
                longitude = ?,
                has_merrychef = ?,
                open_sunday = ?,
                h24 = ?,
                opening_hours_monsat = ?,
                opening_hours_sun = ?,
                first_opening_date = ?,
                is_visible = ?,
                is_new_month = ?,
                is_new_two_weeks = ?,
                elevation_meters = ?,
                is_in_nature_park = ?,
                nature_park_id = ?,
                nearest_neighbor_distance_meters = ?,
                amphibian_occurrences_5km = ?,
                nearest_amphibian_km = ?,
                gmina_id = ?,
                miasto_id = ?
            WHERE id = ?
        """, to_update)
        print(f"[load] updated {len(to_update)} existing stores")

    # Recreate secondary indexes after bulk update
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_locations_city ON locations(city)",
        "CREATE INDEX IF NOT EXISTS idx_locations_deleted_at ON locations(deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_locations_store_id ON locations(store_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_created_at ON locations(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_locations_voivodeship_id ON locations(voivodeship_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_powiat_id ON locations(powiat_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_miasto_id ON locations(miasto_id)",
        "CREATE INDEX IF NOT EXISTS idx_locations_gmina_id ON locations(gmina_id)",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass

    print(f"[load] snapshot ({src_date}): {len(rows):,} stores processed")
    return 1


def record_history(con, sid: int, src_date: str):
    """Zapisz narodziny/zgony Żabek - no-op w nowym modelu SCD Type 2."""
    pass


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
def load_parcel_lockers(con, lockers: list, sid: int, src_date: str):
    """Zapisz paczkomaty jako SCD Type 2.
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

    # 1. Pobierz wszystkie aktywne paczkomaty z bazy danych
    db_active = {}
    db_rows = con.execute("""
        SELECT external_id, id, latitude, longitude, voivodeship_id, powiat_id, miasto_id, gmina_id, status 
        FROM parcel_lockers 
        WHERE deleted_at IS NULL
    """).fetchall()
    for row in db_rows:
        ext_id = row[0]
        if ext_id:
            db_active[ext_id] = {
                "id": row[1],
                "latitude": row[2],
                "longitude": row[3],
                "voivodeship_id": row[4],
                "powiat_id": row[5],
                "miasto_id": row[6],
                "gmina_id": row[7],
                "status": row[8]
            }

    incoming_ext_ids = {L["external_id"] for L in lockers if L.get("external_id")}
    
    # 2. Soft-delete paczkomaty (te co sa w db_active, ale nie w incoming)
    to_delete = [db_val["id"] for ext_id, db_val in db_active.items() if ext_id not in incoming_ext_ids]
    if to_delete:
        con.executemany("UPDATE parcel_lockers SET deleted_at = ? WHERE id = ?",
                        [(src_dt, db_id) for db_id in to_delete])
        print(f"[paczkomaty] soft-deleted {len(to_delete)} parcel lockers")

    # 3. Rozdziel incoming rows na nowe (inserts) i do aktualizacji (updates)
    to_insert = []
    to_update = []
    
    for L in lockers:
        ext_id = L.get("external_id")
        if not ext_id:
            continue
            
        vals = (
            ext_id,
            src_date,
            L.get("latitude"),
            L.get("longitude"),
            L.get("voivodeship_id"),
            L.get("powiat_id"),
            L.get("miasto_id"),
            L.get("gmina_id"),
            L.get("status")
        )
        
        if ext_id in db_active:
            db_val = db_active[ext_id]
            # Sprawdzamy czy cokolwiek sie zmienilo
            if (
                abs((L.get("latitude") or 0) - (db_val["latitude"] or 0)) > 1e-5 or
                abs((L.get("longitude") or 0) - (db_val["longitude"] or 0)) > 1e-5 or
                L.get("voivodeship_id") != db_val["voivodeship_id"] or
                L.get("powiat_id") != db_val["powiat_id"] or
                L.get("miasto_id") != db_val["miasto_id"] or
                L.get("gmina_id") != db_val["gmina_id"] or
                L.get("status") != db_val["status"]
            ):
                to_update.append(vals[1:] + (db_val["id"],))
        else:
            to_insert.append(vals)

    # 4. Wykonaj aktualizacje w miejscu (w bardzo nielicznych przypadkach)
    if to_update:
        con.executemany("""
            UPDATE parcel_lockers SET
                source_date = ?,
                latitude = ?,
                longitude = ?,
                voivodeship_id = ?,
                powiat_id = ?,
                miasto_id = ?,
                gmina_id = ?,
                status = ?
            WHERE id = ?
        """, to_update)
        print(f"[paczkomaty] updated {len(to_update)} existing parcel lockers")

    # 5. Hurtowe wstawianie nowych (przez CSV dla wydajnosci)
    if to_insert:
        import csv
        import tempfile
        
        with tempfile.NamedTemporaryFile(mode="w", newline="", encoding="utf-8", suffix=".csv", delete=False) as tmp:
            tmp_name = tmp.name
            writer = csv.writer(tmp)
            writer.writerow(["external_id", "source_date", "latitude", "longitude", "voivodeship_id", "powiat_id", "miasto_id", "gmina_id", "status"])
            for vals in to_insert:
                writer.writerow(vals)
                
        try:
            con.execute(f"""
                INSERT INTO parcel_lockers
                (id, external_id, source_date, latitude, longitude, voivodeship_id, powiat_id, miasto_id, gmina_id, status, created_at, deleted_at)
                SELECT nextval('seq_parcel_lockers'), external_id, source_date, latitude, longitude, voivodeship_id, powiat_id, miasto_id, gmina_id, status, ? as created_at, CAST(NULL AS TIMESTAMP) as deleted_at
                FROM read_csv_auto('{tmp_name}')
            """, [src_dt])
            print(f"[paczkomaty] inserted {len(to_insert):,} new parcel lockers")
        finally:
            try:
                os.unlink(tmp_name)
            except Exception:
                pass

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
    
    deleted_locs = con.execute("DELETE FROM locations WHERE deleted_at < ?", [cutoff]).rowcount
    deleted_lockers = con.execute("DELETE FROM parcel_lockers WHERE source_date < ?", [cutoff]).rowcount
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
