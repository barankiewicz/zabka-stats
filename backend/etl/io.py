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
from datetime import date

import requests
import numpy as np

from backend.etl.geo import EARTH_KM, poland_rings, point_in_multipolygon
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
# razy, czekajac RETRY_DELAY sekund miedzy probami (domyslnie 5 prob co 5 minut -
# damy szanse na przelotne problemy). Pojedyncze zapytanie ma timeout HTTP_TIMEOUT.
# Po wyczerpaniu prob caller leci dalej bez zrodla (best-effort / lazy, kolumna pusta).
RETRY_ATTEMPTS = int(os.getenv("ETL_RETRY_ATTEMPTS", "5"))
RETRY_DELAY = float(os.getenv("ETL_RETRY_DELAY", "300"))
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


def _clean_street(street: str):
    """Usun <br>, wyciagnij kod pocztowy. Zwraca (czysta_ulica, kod|None)."""
    if not street:
        return "nieokreślona", None
    s = street.replace("<br>", " ").replace("<br/>", " ")
    m = re.search(r"\b(\d{2}-\d{3})\b", s)
    postcode = m.group(1) if m else None
    if postcode:
        s = s.replace(postcode, " ")
    s = re.sub(r"\s+", " ", s).strip(" ,;")
    return (s or "nieokreślona"), postcode


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
    elif isinstance(raw, dict) and isinstance(raw.get("points"), list):
        for i, p in enumerate(raw["points"]):
            rows.append({"store_id": f"zabka_{i:05d}", "city": None, "street": None,
                         "postcode": None, "latitude": float(p[0]), "longitude": float(p[1]),
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
        street, postcode = _clean_street(loc.get("street"))
        if loc.get("street") and ("<br>" in loc["street"] or postcode):
            cleaned_streets += 1
        rows.append({
            "store_id": loc.get("storeId") or loc.get("locationId"),
            "city": _normalize_city(loc.get("town") or loc.get("city")),
            "street": street,
            "postcode": postcode,
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
                                  coarse_deg=0.05, fine_deg=0.005) -> dict:
    """
    Znajdz punkt w granicach Polski najdalszy od najblizszej Żabki
    (problem najwiekszego pustego kola). Zwraca {lat, lon, dist_km}.
    """
    from sklearn.neighbors import BallTree

    pts = np.radians(np.column_stack([lats, lons]))
    tree = BallTree(pts, metric="haversine")
    rings = poland_rings(woj_geo)

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
        mask = np.array([point_in_multipolygon(lo, la, rings)
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
    """Zapisz snapshot + lokalizacje. Zastepuje dane dla tej samej daty.
    Ciekawe fakty (fun_facts) laduje osobno load_fun_facts()."""
    ensure_enrichment_columns(con)
    src_date = meta.get("source_date") or date.today().isoformat()
    total = len(rows)
    czy = sum(1 for r in rows if r.get("has_merrychef"))
    sun = sum(1 for r in rows if r.get("open_sunday"))
    h24 = sum(1 for r in rows if r.get("h24"))
    visible = sum(1 for r in rows if r.get("is_visible"))
    towns = len({r.get("city") for r in rows if r.get("city")})

    # idempotentny re-run dla tej samej daty: czyscimy snapshot, jego lokalizacje i historie
    con.execute("DELETE FROM locations WHERE snapshot_id IN "
                "(SELECT id FROM snapshots WHERE source_date = ?)", [src_date])
    con.execute("DELETE FROM histories WHERE source_date = ?", [src_date])
    con.execute("DELETE FROM snapshots WHERE source_date = ?", [src_date])
    sid = con.execute("SELECT COALESCE(MAX(id),0)+1 FROM snapshots").fetchone()[0]
    con.execute("""INSERT INTO snapshots
        (id, source_date, total_count, visible_count, with_merrychef, open_sunday, h24, towns, created_at)
        VALUES (?,?,?,?,?,?,?,?, now())""",
        [sid, src_date, total, visible, czy, sun, h24, towns])

    base = con.execute("SELECT COALESCE(MAX(id),0) FROM locations").fetchone()[0]
    payload = []
    for j, r in enumerate(rows):
        fod = r.get("first_opening_date") or None
        payload.append((base + j + 1, sid, r.get("store_id"),
                        r.get("city"), r.get("street"), r.get("voivodeship"),
                        r.get("powiat"), r.get("postcode"),
                        r["latitude"], r["longitude"],
                        r.get("has_merrychef"), r.get("open_sunday"), r.get("h24"),
                        r.get("opening_hours_monsat"), r.get("opening_hours_sun"),
                        fod, r.get("is_visible"),
                        r.get("is_new_month"), r.get("is_new_two_weeks"),
                        r.get("gios_station_id"), r.get("gios_distance_km"),
                        r.get("elevation_meters"),
                        r.get("is_in_nature_park"), r.get("nature_park_id"),
                        r.get("nearest_neighbor_distance_meters"),
                        r.get("amphibian_occurrences_5km"), r.get("nearest_amphibian_km"),
                        r.get("voivodeship_id"), r.get("powiat_id")))
    con.executemany("""INSERT INTO locations
        (id, snapshot_id, store_id, city, street, voivodeship, powiat, postcode,
         latitude, longitude, has_merrychef, open_sunday, h24,
         opening_hours_monsat, opening_hours_sun, first_opening_date,
         is_visible, is_new_month, is_new_two_weeks,
         gios_station_id, gios_distance_km,
         elevation_meters, is_in_nature_park, nature_park_id,
         nearest_neighbor_distance_meters,
         amphibian_occurrences_5km, nearest_amphibian_km,
         voivodeship_id, powiat_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", payload)
    record_history(con, sid, src_date)
    print(f"[load] snapshot {sid} ({src_date}): {total:,} sklepow zapisanych")
    return sid


def record_history(con, sid: int, src_date: str):
    """Zapisz narodziny/zgony Żabek: diff store_id miedzy biezacym snapshotem a
    poprzednim. created = store_id w nowym, nie ma w poprzednim; deleted = odwrotnie.
    Dodatkowo znacznik deleted_at na wierszu znikajacego sklepu w poprzednim snapshocie.
    Pierwszy snapshot (brak poprzedniego) nie generuje historii - to baza, nie zmiana."""
    prev = con.execute("SELECT id FROM snapshots WHERE source_date < ? "
                       "ORDER BY source_date DESC LIMIT 1", [src_date]).fetchone()
    if not prev:
        print("[history] pierwszy snapshot - brak diffu (baza)")
        return
    prev_sid = prev[0]
    # narodziny: sklepy obecne dzis, nieobecne w poprzednim
    con.execute("""
        INSERT INTO histories (location_id, snapshot_id, source_date, store_id, change_type, recorded_at)
        SELECT l.id, ?, ?, l.store_id, 'created', now()
        FROM locations l
        WHERE l.snapshot_id = ?
          AND l.store_id NOT IN (SELECT store_id FROM locations WHERE snapshot_id = ?)
    """, [sid, src_date, sid, prev_sid])
    # zgony: sklepy z poprzedniego, nieobecne dzis (location_id wskazuje wiersz z prev)
    con.execute("""
        INSERT INTO histories (location_id, snapshot_id, source_date, store_id, change_type, recorded_at)
        SELECT lp.id, ?, ?, lp.store_id, 'deleted', now()
        FROM locations lp
        WHERE lp.snapshot_id = ?
          AND lp.store_id NOT IN (SELECT store_id FROM locations WHERE snapshot_id = ?)
    """, [sid, src_date, prev_sid, sid])
    # soft-delete: oznacz znikajace sklepy w poprzednim snapshocie data biezaca
    con.execute("""
        UPDATE locations SET deleted_at = now()
        WHERE snapshot_id = ?
          AND store_id NOT IN (SELECT store_id FROM locations WHERE snapshot_id = ?)
    """, [prev_sid, sid])
    born = con.execute("SELECT count(*) FROM histories WHERE snapshot_id=? AND change_type='created'", [sid]).fetchone()[0]
    died = con.execute("SELECT count(*) FROM histories WHERE snapshot_id=? AND change_type='deleted'", [sid]).fetchone()[0]
    print(f"[history] narodziny: {born}, zgony: {died} (vs snapshot {prev_sid})")


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
    """Zapisz paczkomaty otagowane snapshot_id (jak Żabki) - per dzien, do trendow.
    Idempotentnie czysci paczkomaty tej daty przed wstawieniem."""
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    con.execute("DELETE FROM parcel_lockers WHERE source_date = ?", [src_date])
    if not lockers:
        print("[paczkomaty] brak danych")
        return
    base = con.execute("SELECT COALESCE(MAX(id),0) FROM parcel_lockers").fetchone()[0]
    payload = [(base + i + 1, sid, src_date, L.get("operator"), L.get("external_id"),
                L.get("type"), L.get("city"), L.get("voivodeship"), L.get("powiat"),
                L.get("voivodeship_id"), L.get("powiat_id"),
                L.get("latitude"), L.get("longitude"), L.get("status"))
               for i, L in enumerate(lockers)]
    con.executemany("""INSERT INTO parcel_lockers
        (id, snapshot_id, source_date, operator, external_id, type, city, voivodeship, powiat,
         voivodeship_id, powiat_id, latitude, longitude, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", payload)
    print(f"[paczkomaty] zapisano {len(payload):,} punktow (snapshot {sid})")


def enforce_retention(con, src_date: str, months: int = 6):
    """Rolling window: trzymaj tylko ostatnie `months` miesiecy. Usun ogon -
    snapshoty (i ich lokalizacje, historie, paczkomaty) starsze niz prog."""
    from dateutil.relativedelta import relativedelta
    cutoff = (date.fromisoformat(str(src_date)) - relativedelta(months=months)).isoformat()
    old = con.execute("SELECT id FROM snapshots WHERE source_date < ?", [cutoff]).fetchall()
    if not old:
        print(f"[retencja] okno {months} mies. (prog {cutoff}) - nic do usuniecia")
        return
    ids = [o[0] for o in old]
    ph = ",".join("?" * len(ids))
    con.execute(f"DELETE FROM locations WHERE snapshot_id IN ({ph})", ids)
    con.execute(f"DELETE FROM parcel_lockers WHERE snapshot_id IN ({ph})", ids)
    con.execute("DELETE FROM histories WHERE source_date < ?", [cutoff])
    con.execute("DELETE FROM snapshots WHERE source_date < ?", [cutoff])
    print(f"[retencja] usunieto {len(ids)} snapshotow starszych niz {cutoff} (okno {months} mies.)")


def load_dimensions(con, dim_powiat: list, dim_voivodeship: list):
    """Zapisz wymiary geograficzne (replace), z kluczami numerycznymi.
    dim_powiat: [(id, name, voivodeship_id, population, avg_salary, unemployment_rate)],
    dim_voivodeship: [(id, name, population)]."""
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    con.execute("DELETE FROM dim_powiat")
    con.execute("DELETE FROM dim_voivodeship")
    if dim_voivodeship:
        con.executemany("INSERT INTO dim_voivodeship (id, name, population) "
                        "VALUES (?,?,?)", dim_voivodeship)
    if dim_powiat:
        con.executemany("INSERT INTO dim_powiat (id, name, voivodeship_id, population, "
                        "avg_salary, unemployment_rate) VALUES (?,?,?,?,?,?)", dim_powiat)
    print(f"[dims] dim_powiat: {len(dim_powiat)}, dim_voivodeship: {len(dim_voivodeship)}")


def load_dim_gios_station(con, stations: list):
    """Zapisz wymiar stacji GIOŚ (replace). stations: [{id, name, lat, lon}]."""
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    con.execute("DELETE FROM dim_gios_station")
    if stations:
        con.executemany("INSERT INTO dim_gios_station (id, name, latitude, longitude) "
                        "VALUES (?,?,?,?)",
                        [(s["id"], s.get("name"), s.get("lat"), s.get("lon")) for s in stations])
    print(f"[dims] dim_gios_station: {len(stations or [])}")


def load_dim_park(con, parks: list):
    """Zapisz wymiar parku/otuliny GDOŚ (replace). parks: [(id, name, type)]."""
    from backend.database_ch import ensure_extra_tables
    ensure_extra_tables(con)
    con.execute("DELETE FROM dim_park")
    if parks:
        con.executemany("INSERT INTO dim_park (id, name, type) VALUES (?,?,?)", parks)
    print(f"[dims] dim_park: {len(parks or [])}")
