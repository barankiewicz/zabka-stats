import json
import os
import re
import time
from collections import Counter

import requests

GUS_BDL_BASE = "https://bdl.stat.gov.pl/api/v1/data/by-variable"
HTTP_TIMEOUT = 45
CACHE_FILE = "data/geo/.bdl_cache.json"

# BDL Variables
VAR_POPULATION = "72305"
VAR_AREA = "2018"
VAR_UNEMPLOYMENT = "60270"
VAR_SALARY = "64428"

# Skroty wojewodztw dopisywane do nazw powiatow zdublowanych miedzy
# wojewodztwami (np. "Powiat grodziski (maz.)" vs "(wlkp.)"). Musi pokrywac
# wszystkie 16 wojewodztw - o tym, ktore nazwy dostana suffix, decyduje
# wylacznie wykryta kolizja nazw. Ten sam slownik (podzbior) zyje w
# backend/database.py jako VOIV_ABBR - trzymac spojnie.
VOIV_ABBR = {
    "DOLNOŚLĄSKIE": "doln.",
    "KUJAWSKO-POMORSKIE": "kuj.-pom.",
    "LUBELSKIE": "lubel.",
    "LUBUSKIE": "lub.",
    "ŁÓDZKIE": "łódz.",
    "MAŁOPOLSKIE": "małop.",
    "MAZOWIECKIE": "maz.",
    "OPOLSKIE": "op.",
    "PODKARPACKIE": "podk.",
    "PODLASKIE": "podl.",
    "POMORSKIE": "pom.",
    "ŚLĄSKIE": "śl.",
    "ŚWIĘTOKRZYSKIE": "święt.",
    "WARMIŃSKO-MAZURSKIE": "warm.-maz.",
    "WIELKOPOLSKIE": "wlkp.",
    "ZACHODNIOPOMORSKIE": "zach.",
}

class RateLimitError(Exception):
    pass

def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[gus-fetch] Cache read error: {e}. Starting fresh.")
            return {}
    return {}

def save_cache(cache: dict):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

def fetch_bdl_variable(var_id: str, level: int, cache: dict) -> dict:
    """Fetch variable values for all units at a level, returning a dict of unit_id -> metadata.
    Uses cached pages if available to avoid redundant API calls.
    """
    url = f"{GUS_BDL_BASE}/{var_id}"
    results = {}
    page = 0
    attempts = 0

    # Estimate max pages: levels 2 and 5 have few units, level 6 has ~2500 units (up to 43 pages for size 100)
    max_pages = 50 if level == 6 else 10

    while page < max_pages:
        cache_key = f"{var_id}_lvl{level}_page{page}"

        # Check cache
        if cache_key in cache:
            items = cache[cache_key]
        else:
            # Page not in cache, fetch it from API
            params = {
                "unit-level": level,
                "format": "json",
                "page-size": 100,
                "page": page
            }
            print(f"[gus-fetch] Fetching page {page} for var {var_id} lvl {level} from API...")
            try:
                r = requests.get(url, params=params, timeout=HTTP_TIMEOUT)
                if r.status_code == 429:
                    print("[gus-fetch] Got HTTP 429 (Rate Limit). Sleeping 30s...")
                    time.sleep(30)
                    raise RateLimitError("Rate limit exceeded")
                r.raise_for_status()
                data = r.json()
                items = data.get("results", [])

                # Update cache
                cache[cache_key] = items
                save_cache(cache)
                attempts = 0
                time.sleep(1.0)  # gentle delay to prevent rate limit
            except Exception as e:
                if isinstance(e, RateLimitError):
                    raise
                attempts += 1
                if attempts > 3:
                    print(f"[gus-fetch] Page {page} failed after 3 attempts.")
                    save_cache(cache)
                    raise
                print(f"[gus-fetch] Error: {e}. Retrying page {page} (attempt {attempts})...")
                time.sleep(5)
                continue

        if not items:
            break

        for item in items:
            unit_id = item.get("id")
            name = item.get("name")
            values = item.get("values", [])

            # Get the latest value
            latest_yr = None
            latest_val = None
            for v in values:
                if v.get("val") is not None:
                    yr = str(v.get("year"))
                    if latest_yr is None or yr > latest_yr:
                        latest_yr = yr
                        latest_val = float(v["val"])

            if latest_val is not None:
                results[unit_id] = {
                    "name": name,
                    "val": latest_val,
                    "year": latest_yr
                }

        page += 1

    return results


def is_city_powiat(gus_id: str) -> bool:
    """TERYT: kody powiatow 61-99 to miasta na prawach powiatu."""
    return gus_id[7:9] >= "61"


def clean_unit_name(name: str) -> str:
    """Zdejmuje z nazwy BDL znaczniki czasowe i prefiks miasta stolecznego.

    'M.st.Warszawa od 2002' -> 'Warszawa', 'Wałbrzych od 2013' -> 'Wałbrzych'.
    Jednostki historyczne ('... do 2002') sa odfiltrowane wczesniej po roku
    ostatniego pomiaru, wiec czyscimy tylko nazwy jednostek aktywnych.
    """
    n = re.sub(r"\s*\b(?:od|do)\s+\d{4}\b", "", name).strip()
    n = re.sub(r"^M\.\s*st\.\s*", "", n, flags=re.IGNORECASE).strip()
    return n


def latest_data_year(pop: dict) -> str:
    """Najswiezszy rok w zbiorze - jednostki, ktorych dane koncza sie
    wczesniej (zniesione powiaty/gminy, np. 'Wałbrzych do 2002'), nie sa
    aktywnymi jednostkami podzialu administracyjnego."""
    return max(v["year"] for v in pop.values())


def validate(voivodeships: list, powiats: list, gminas: list, cities: list) -> list:
    """Twarde inwarianty wyniku. Zwraca liste bledow (pusta = OK)."""
    errors = []

    if len(voivodeships) != 16:
        errors.append(f"oczekiwano 16 wojewodztw, jest {len(voivodeships)}")
    if len(powiats) != 314:
        errors.append(f"oczekiwano 314 powiatow ziemskich, jest {len(powiats)}")

    # Nazwy: bez wersalikow, bez znacznikow czasowych, bez 'M.st.'
    for r in voivodeships + powiats + gminas + cities:
        n = r["name"]
        if not n:
            errors.append(f"pusta nazwa: {r['gus_id']}")
            continue
        if n == n.upper() and len(n) > 3:
            errors.append(f"nazwa wersalikami: {n!r}")
        if re.search(r"\b(?:od|do)\s+\d{4}\b", n) or "M.st" in n or "m.st" in n:
            errors.append(f"niewyczyszczona nazwa: {n!r}")

    # Poziom 2: tylko powiaty ziemskie, nazwy unikalne (suffix wojewodztwa).
    for p in powiats:
        if is_city_powiat(p["gus_id"]):
            errors.append(f"miasto na prawach powiatu na poziomie 2: {p['name']}")
    dupes = [n for n, c in Counter(p["name"] for p in powiats).items() if c > 1]
    if dupes:
        errors.append(f"zdublowane nazwy powiatow (brak suffixu?): {dupes}")

    # Kazdy wiersz ma populacje, powierzchnie i (od poziomu 2) wojewodztwo.
    for r in voivodeships + powiats + gminas + cities:
        if r["population"] is None or not r["population"]:
            errors.append(f"brak populacji: lvl{r['level']} {r['name']}")
        if r["area_km2"] is None or not r["area_km2"]:
            errors.append(f"brak powierzchni: lvl{r['level']} {r['name']}")
        if r["level"] > 1 and r["voivodeship_id"] is None:
            errors.append(f"brak wojewodztwa: lvl{r['level']} {r['name']}")

    # Poziomy 3/4: gmina/miasto w powiecie ziemskim MUSI wskazywac powiat,
    # miasto na prawach powiatu NIE MOZE (jest osobna jednostka - inaczej
    # jego Żabki i populacja wpadaja do sasiedniego powiatu ziemskiego).
    for r in gminas + cities:
        if is_city_powiat(r["gus_id"]):
            if r["powiat_id"] is not None:
                errors.append(f"miasto na prawach powiatu z powiat_id: {r['name']}")
        elif r["powiat_id"] is None:
            errors.append(f"gmina bez powiatu: lvl{r['level']} {r['name']} ({r['gus_id']})")

    city_powiat_count = sum(1 for g in gminas if is_city_powiat(g["gus_id"]))
    if city_powiat_count != 66:
        errors.append(f"oczekiwano 66 miast na prawach powiatu, jest {city_powiat_count}")

    # Spojnosc populacji: wojewodztwo (bez miast na prawach powiatu) musi byc
    # suma swoich powiatow ziemskich - dokladnie ta liczba jest mianownikiem
    # gestosci powiatowej, a v_voiv_pop_eff dodaje miasta z powrotem.
    land_sum = {}
    for p in powiats:
        land_sum[p["voivodeship_id"]] = land_sum.get(p["voivodeship_id"], 0) + p["population"]
    for v in voivodeships:
        if v["population"] != land_sum.get(v["id"]):
            errors.append(
                f"populacja {v['name']}: {v['population']} != suma powiatow ziemskich {land_sum.get(v['id'])}"
            )

    return errors


def main():
    print("=== Fetching/Parsing GUS BDL Administrative Units ===")
    cache = load_cache()

    # 1. Fetch level 2 (voivodeships) data
    print("Processing level 2 (voivodeships) data...")
    pop_l2 = fetch_bdl_variable(VAR_POPULATION, 2, cache)
    area_l2 = fetch_bdl_variable(VAR_AREA, 2, cache)

    # 2. Fetch level 5 (counties) data
    print("Processing level 5 (counties) data...")
    pop_l5 = fetch_bdl_variable(VAR_POPULATION, 5, cache)
    area_l5 = fetch_bdl_variable(VAR_AREA, 5, cache)
    unemp_l5 = fetch_bdl_variable(VAR_UNEMPLOYMENT, 5, cache)
    salary_l5 = fetch_bdl_variable(VAR_SALARY, 5, cache)

    # 3. Fetch level 6 (gminas) data
    print("Processing level 6 (gminas) data...")
    pop_l6 = fetch_bdl_variable(VAR_POPULATION, 6, cache)
    area_l6 = fetch_bdl_variable(VAR_AREA, 6, cache)

    print("All variable data loaded. Building 3-level hierarchy...")

    # Jednostki aktywne = te z danymi w najswiezszym dostepnym roku. Zniesione
    # jednostki (np. 'Powiat m. Wałbrzych do 2002', dzielnice Warszawy do 2001)
    # koncza serie wczesniej i odpadaja tutaj, niezaleznie od nazwy.
    latest_l5 = latest_data_year(pop_l5)
    latest_l6 = latest_data_year(pop_l6)

    voivodeships = []
    powiats = []
    gminas = []
    cities_l4 = []

    # Map for finding generated ID of parents by BDL ID
    voiv_id_map = {}   # gus_id -> db_id
    voiv_name_by_db_id = {}
    powiat_id_map = {} # gus_id -> db_id
    db_id_counter = 1

    # --- LEVEL 1: Voivodeships (16 units) ---
    # Nazwy malymi literami (konwencja pisowni polskiej i format GUGiK).
    # population = suma powiatow ziemskich (bez miast na prawach powiatu),
    # zgodnie z konwencja dim_voivodeship - widok v_voiv_pop_eff dodaje
    # miasta z powrotem przy metrykach per capita. Uzupelniamy ja nizej,
    # po zbudowaniu poziomu 2.
    all_l2_ids = sorted(set(pop_l2.keys()) | set(area_l2.keys()))
    for gid in all_l2_ids:
        name = pop_l2.get(gid, {}).get("name") or area_l2.get(gid, {}).get("name")
        if not name:
            continue
        voiv_id_map[gid] = db_id_counter
        voiv_name_by_db_id[db_id_counter] = name.lower()
        voivodeships.append({
            "id": db_id_counter,
            "level": 1,
            "name": name.lower(),
            "population": None,  # uzupelniane po poziomie 2
            "area_km2": float(area_l2[gid]["val"]) if gid in area_l2 else None,
            "unemployment_rate": None,
            "avg_salary": None,
            "voivodeship_id": None,
            "powiat_id": None,
            "gus_id": gid
        })
        db_id_counter += 1

    # --- LEVEL 2: Powiats ziemskie (314 units) ---
    # Wylacznie powiaty ziemskie (kod TERYT < 61) aktywne w najswiezszym roku.
    # Miasta na prawach powiatu sa oddzielnymi jednostkami na poziomach 3/4.
    all_l5_ids = sorted(set(pop_l5.keys()) | set(area_l5.keys()))
    for gid in all_l5_ids:
        if is_city_powiat(gid):
            continue
        if gid not in pop_l5 or pop_l5[gid].get("year") != latest_l5:
            continue

        name = pop_l5[gid]["name"]
        voiv_gus_id = gid[:4] + "00000000"
        vid = voiv_id_map.get(voiv_gus_id)

        powiat_id_map[gid] = db_id_counter
        powiats.append({
            "id": db_id_counter,
            "level": 2,
            "name": name,
            "population": int(pop_l5[gid]["val"]),
            "area_km2": float(area_l5[gid]["val"]) if gid in area_l5 else None,
            "unemployment_rate": float(unemp_l5[gid]["val"]) if gid in unemp_l5 else None,
            "avg_salary": float(salary_l5[gid]["val"]) if gid in salary_l5 else None,
            "voivodeship_id": vid,
            "powiat_id": None,
            "gus_id": gid
        })
        db_id_counter += 1

    # Suffix wojewodztwa dla nazw powiatow wystepujacych w >1 wojewodztwie
    # ("Powiat grodziski" -> "Powiat grodziski (maz.)" / "(wlkp.)"). Bez tego
    # slownikowe dopasowania po nazwie (GUS economics, frontend) mieszaja dane
    # miedzy wojewodztwami.
    name_counts = Counter(p["name"] for p in powiats)
    for p in powiats:
        if name_counts[p["name"]] > 1:
            voiv_name = voiv_name_by_db_id.get(p["voivodeship_id"], "")
            abbr = VOIV_ABBR.get(voiv_name.upper())
            if not abbr:
                raise SystemExit(f"Brak skrotu wojewodztwa dla {voiv_name!r} (powiat {p['name']!r})")
            p["name"] = f"{p['name']} ({abbr})"

    # Populacja wojewodztwa = suma jego powiatow ziemskich (patrz komentarz
    # przy poziomie 1).
    land_pop_by_voiv = {}
    for p in powiats:
        land_pop_by_voiv[p["voivodeship_id"]] = land_pop_by_voiv.get(p["voivodeship_id"], 0) + p["population"]
    for v in voivodeships:
        v["population"] = land_pop_by_voiv.get(v["id"])

    # --- Aktywne miasta na prawach powiatu (66 units) ---
    active_cities = {
        gid: pop_l5[gid]
        for gid in all_l5_ids
        if is_city_powiat(gid) and gid in pop_l5 and pop_l5[gid].get("year") == latest_l5
    }
    city_prefixes = {gid[:9]: gid for gid in active_cities}

    # --- LEVEL 3: Gminas (2479 units, w tym 66 miast na prawach powiatu) ---
    # Rodzaje TERYT 1 (miejska), 2 (wiejska), 3 (miejsko-wiejska w calosci).
    all_l6_ids = sorted(set(pop_l6.keys()) | set(area_l6.keys()))
    gmina_candidates = [
        gid for gid in all_l6_ids
        if gid[-1] in ("1", "2", "3") and gid in pop_l6 and pop_l6[gid].get("year") == latest_l6
    ]

    def make_unit(gid: str, level: int) -> dict:
        """Wiersz poziomu 3/4 dla jednostki BDL poziomu 6.

        Miasto na prawach powiatu dostaje dane (populacja/powierzchnia)
        z wlasnej jednostki poziomu 5 i powiat_id = None - NIE nalezy do
        zadnego powiatu ziemskiego, wiec jego Żabki nie moga byc liczone
        do sasiedniego powiatu (np. Warszawa vs powiat warszawski zachodni).
        """
        nonlocal db_id_counter
        prefix = gid[:9]
        name = clean_unit_name(pop_l6[gid]["name"])
        if prefix in city_prefixes:
            city_l5_id = city_prefixes[prefix]
            row = {
                "id": db_id_counter,
                "level": level,
                "name": name,
                "population": int(pop_l5[city_l5_id]["val"]),
                "area_km2": float(area_l5[city_l5_id]["val"]) if city_l5_id in area_l5 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": voiv_id_map.get(city_l5_id[:4] + "00000000"),
                "powiat_id": None,
                "gus_id": city_l5_id
            }
        else:
            row = {
                "id": db_id_counter,
                "level": level,
                "name": name,
                "population": int(pop_l6[gid]["val"]),
                "area_km2": float(area_l6[gid]["val"]) if gid in area_l6 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": voiv_id_map.get(gid[:4] + "00000000"),
                "powiat_id": powiat_id_map.get(gid[:9] + "000"),
                "gus_id": gid
            }
        db_id_counter += 1
        return row

    for gid in gmina_candidates:
        gminas.append(make_unit(gid, 3))

    # --- LEVEL 4: Miasta (302 units - gminy miejskie, w tym 66 miast na
    # prawach powiatu). Wylacznie rodzaj TERYT 1.
    for gid in gmina_candidates:
        if gid.endswith("1"):
            cities_l4.append(make_unit(gid, 4))

    division_data = voivodeships + powiats + gminas + cities_l4

    errors = validate(voivodeships, powiats, gminas, cities_l4)
    if errors:
        for e in errors:
            print(f"[VALIDATION] {e}")
        raise SystemExit(f"Walidacja nie przeszla: {len(errors)} blad(y). Plik NIE zostal zapisany.")

    # Save to file
    out_path = "data/geo/administrative_division_gus.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(division_data, f, ensure_ascii=False, indent=2)

    print(f"Successfully wrote {len(division_data)} rows to {out_path}")
    print(f"Counts: {len(voivodeships)} voivodeships, {len(powiats)} powiats, {len(gminas)} gminas, {len(cities_l4)} cities.")

if __name__ == "__main__":
    main()
