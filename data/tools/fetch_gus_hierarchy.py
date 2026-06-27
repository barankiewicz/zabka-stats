import os
import json
import time
import requests
import sys

GUS_BDL_BASE = "https://bdl.stat.gov.pl/api/v1/data/by-variable"
HTTP_TIMEOUT = 45
CACHE_FILE = "data/geo/.bdl_cache.json"

# BDL Variables
VAR_POPULATION = "72305"
VAR_AREA = "2018"
VAR_UNEMPLOYMENT = "60270"
VAR_SALARY = "64428"

class RateLimitError(Exception):
    pass

def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
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

def main():
    print("=== Fetching/Parsing GUS BDL Administrative Units ===")
    cache = load_cache()
    
    # 1. Fetch level 2 (voivodeships) data
    print("Processing level 2 (voivodeships) data...")
    pop_l2 = fetch_bdl_variable(VAR_POPULATION, 2, cache)
    area_l2 = fetch_bdl_variable(VAR_AREA, 2, cache)
    unemp_l2 = fetch_bdl_variable(VAR_UNEMPLOYMENT, 2, cache)
    salary_l2 = fetch_bdl_variable(VAR_SALARY, 2, cache)
    
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
    
    voivodeships = []
    powiats = []
    gminas = []
    
    # Map for finding generated ID of parents by BDL ID
    voiv_id_map = {}   # gus_id -> db_id
    powiat_id_map = {} # gus_id -> db_id
    db_id_counter = 1
    
    # --- LEVEL 1: Voivodeships (16 units) ---
    all_l2_ids = sorted(list(set(pop_l2.keys()) | set(area_l2.keys())))
    for gid in all_l2_ids:
        name = pop_l2.get(gid, {}).get("name") or area_l2.get(gid, {}).get("name")
        if not name:
            continue
        voiv_id_map[gid] = db_id_counter
        voivodeships.append({
            "id": db_id_counter,
            "level": 1,
            "name": name.upper(),
            "population": int(pop_l2[gid]["val"]) if gid in pop_l2 else None,
            "area_km2": float(area_l2[gid]["val"]) if gid in area_l2 else None,
            "unemployment_rate": None,
            "avg_salary": None,
            "voivodeship_id": None,
            "powiat_id": None,
            "gus_id": gid
        })
        db_id_counter += 1
        
    # --- LEVEL 2: Powiats (314 units) ---
    # ONLY take land counties: pow_code = gid[7:9] < '61' and not '071412831000' (warszawski)
    all_l5_ids = sorted(list(set(pop_l5.keys()) | set(area_l5.keys())))
    for gid in all_l5_ids:
        pow_code = gid[7:9]
        if pow_code >= '61' or gid == '071412831000':
            continue
            
        name = pop_l5.get(gid, {}).get("name") or area_l5.get(gid, {}).get("name")
        if not name:
            continue
            
        voiv_gus_id = gid[:4] + "00000000"
        vid = voiv_id_map.get(voiv_gus_id)
        
        powiat_id_map[gid] = db_id_counter
        powiats.append({
            "id": db_id_counter,
            "level": 2,
            "name": name,
            "population": int(pop_l5[gid]["val"]) if gid in pop_l5 else None,
            "area_km2": float(area_l5[gid]["val"]) if gid in area_l5 else None,
            "unemployment_rate": float(unemp_l5[gid]["val"]) if gid in unemp_l5 else None,
            "avg_salary": float(salary_l5[gid]["val"]) if gid in salary_l5 else None,
            "voivodeship_id": vid,
            "powiat_id": None,
            "gus_id": gid
        })
        db_id_counter += 1

    # --- Identify active 66 cities with powiat rights ---
    active_cities = {}
    for gid in all_l5_ids:
        pow_code = gid[7:9]
        if pow_code >= '61':
            name = pop_l5.get(gid, {}).get("name", "")
            if 'do 2002' in name:
                continue
            if gid in pop_l5 and pop_l5[gid].get("year") == "2025":
                active_cities[gid] = pop_l5[gid]

    city_prefixes = {gid[:9]: gid for gid in active_cities}

    # --- LEVEL 3: Gminas (2479 units) ---
    all_l6_ids = sorted(list(set(pop_l6.keys()) | set(area_l6.keys())))
    
    gmina_candidates = []
    for gid in all_l6_ids:
        if gid[-1] not in ('1', '2', '3'):
            continue
        if gid in pop_l6 and pop_l6[gid].get("year") == "2025":
            gmina_candidates.append(gid)

    CITY_TO_POWIAT = {
        "Kraków": "Powiat krakowski",
        "Nowy Sącz": "Powiat nowosądecki",
        "Tarnów": "Powiat tarnowski",
        "Bielsko-Biała": "Powiat bielski",
        "Bytom": "Powiat tarnogórski",
        "Piekary Śląskie": "Powiat tarnogórski",
        "Częstochowa": "Powiat częstochowski",
        "Gliwice": "Powiat gliwicki",
        "Zabrze": "Powiat tarnogórski",
        "Chorzów": "Powiat tarnogórski",
        "Katowice": "Powiat bieruńsko-lędziński",
        "Mysłowice": "Powiat bieruńsko-lędziński",
        "Ruda Śląska": "Powiat mikołowski",
        "Siemianowice Śląskie": "Powiat tarnogórski",
        "Świętochłowice": "Powiat tarnogórski",
        "Jastrzębie-Zdrój": "Powiat wodzisławski",
        "Rybnik": "Powiat rybnicki",
        "Żory": "Powiat rybnicki",
        "Dąbrowa Górnicza": "Powiat będziński",
        "Jaworzno": "Powiat chrzanowski",
        "Sosnowiec": "Powiat będziński",
        "Tychy": "Powiat bieruńsko-lędziński",
        "Gorzów Wielkopolski": "Powiat gorzowski",
        "Zielona Góra": "Powiat zielonogórski",
        "Kalisz": "Powiat kaliski",
        "Konin": "Powiat koniński",
        "Leszno": "Powiat leszczyński",
        "Poznań": "Powiat poznański",
        "Koszalin": "Powiat koszaliński",
        "Szczecin": "Powiat policki",
        "Świnoujście": "Powiat kamieński",
        "Jelenia Góra": "Powiat karkonoski",
        "Legnica": "Powiat legnicki",
        "Wałbrzych od 2013": "Powiat wałbrzyski",
        "Wrocław": "Powiat wrocławski",
        "Opole": "Powiat opolski",
        "Bydgoszcz": "Powiat bydgoski",
        "Toruń": "Powiat toruński",
        "Grudziądz": "Powiat grudziądzki",
        "Włocławek": "Powiat włocławski",
        "Słupsk": "Powiat słupski",
        "Gdańsk": "Powiat gdański",
        "Gdynia": "Powiat wejherowski",
        "Sopot": "Powiat wejherowski",
        "Elbląg": "Powiat elbląski",
        "Olsztyn": "Powiat olsztyński",
        "Łódź": "Powiat łódzki wschodni",
        "Piotrków Trybunalski": "Powiat piotrkowski",
        "Skierniewice": "Powiat skierniewicki",
        "Kielce": "Powiat kielecki",
        "Biała Podlaska": "Powiat bialski",
        "Chełm": "Powiat chełmski",
        "Zamość": "Powiat zamojski",
        "Lublin": "Powiat lubelski",
        "Krosno": "Powiat krośnieński",
        "Przemyśl": "Powiat przemyski",
        "Rzeszów": "Powiat rzeszowski",
        "Tarnobrzeg": "Powiat tarnobrzeski",
        "Białystok": "Powiat białostocki",
        "Łomża": "Powiat łomżyński",
        "Suwałki": "Powiat suwalski",
        "M.st.Warszawa od 2002": "Powiat warszawski zachodni",
        "Ostrołęka": "Powiat ostrołęcki",
        "Radom": "Powiat radomski",
        "Płock": "Powiat płocki",
        "Siedlce": "Powiat siedlecki"
    }
    powiat_id_by_name = {p["name"]: p["id"] for p in powiats}

    for gid in gmina_candidates:
        prefix = gid[:9]
        
        if prefix in city_prefixes:
            city_l5_id = city_prefixes[prefix]
            name = pop_l6[gid]["name"]
            
            voiv_gus_id = city_l5_id[:4] + "00000000"
            vid = voiv_id_map.get(voiv_gus_id)
            
            target_powiat = CITY_TO_POWIAT.get(name)
            pid = powiat_id_by_name.get(target_powiat) if target_powiat else None
            
            gminas.append({
                "id": db_id_counter,
                "level": 3,
                "name": name,
                "population": int(pop_l5[city_l5_id]["val"]) if city_l5_id in pop_l5 else None,
                "area_km2": float(area_l5[city_l5_id]["val"]) if city_l5_id in area_l5 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": vid,
                "powiat_id": pid,
                "gus_id": city_l5_id
            })
        else:
            name = pop_l6.get(gid, {}).get("name") or area_l6.get(gid, {}).get("name")
            
            voiv_gus_id = gid[:4] + "00000000"
            vid = voiv_id_map.get(voiv_gus_id)
            
            powiat_gus_id = gid[:9] + "000"
            pid = powiat_id_map.get(powiat_gus_id)
            
            gminas.append({
                "id": db_id_counter,
                "level": 3,
                "name": name,
                "population": int(pop_l6[gid]["val"]) if gid in pop_l6 else None,
                "area_km2": float(area_l6[gid]["val"]) if gid in area_l6 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": vid,
                "powiat_id": pid,
                "gus_id": gid
            })
        db_id_counter += 1

    # --- LEVEL 4: Cities (302 units) ---
    cities_l4 = []
    k1_candidates = []
    for gid in all_l6_ids:
        if gid.endswith('1') and gid in pop_l6 and pop_l6[gid].get("year") == "2025":
            k1_candidates.append(gid)
            
    for gid in sorted(k1_candidates):
        prefix = gid[:9]
        name = pop_l6[gid]["name"]
        
        if prefix in city_prefixes:
            city_l5_id = city_prefixes[prefix]
            voiv_gus_id = city_l5_id[:4] + "00000000"
            vid = voiv_id_map.get(voiv_gus_id)
            
            target_powiat = CITY_TO_POWIAT.get(name)
            pid = powiat_id_by_name.get(target_powiat) if target_powiat else None
            
            cities_l4.append({
                "id": db_id_counter,
                "level": 4,
                "name": name,
                "population": int(pop_l5[city_l5_id]["val"]) if city_l5_id in pop_l5 else None,
                "area_km2": float(area_l5[city_l5_id]["val"]) if city_l5_id in area_l5 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": vid,
                "powiat_id": pid,
                "gus_id": city_l5_id
            })
        else:
            voiv_gus_id = gid[:4] + "00000000"
            vid = voiv_id_map.get(voiv_gus_id)
            
            powiat_gus_id = gid[:9] + "000"
            pid = powiat_id_map.get(powiat_gus_id)
            
            cities_l4.append({
                "id": db_id_counter,
                "level": 4,
                "name": name,
                "population": int(pop_l6[gid]["val"]) if gid in pop_l6 else None,
                "area_km2": float(area_l6[gid]["val"]) if gid in area_l6 else None,
                "unemployment_rate": None,
                "avg_salary": None,
                "voivodeship_id": vid,
                "powiat_id": pid,
                "gus_id": gid
            })
        db_id_counter += 1

    division_data = voivodeships + powiats + gminas + cities_l4
    
    # Save to file
    out_path = "data/geo/administrative_division_gus.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(division_data, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully wrote {len(division_data)} rows to {out_path}")
    print(f"Counts: {len(voivodeships)} voivodeships, {len(powiats)} powiats, {len(gminas)} gminas, {len(cities_l4)} cities.")

if __name__ == "__main__":
    main()
