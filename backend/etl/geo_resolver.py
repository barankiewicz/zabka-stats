import json
import os
import re
import time

import numpy as np
import requests

from backend.etl.geo import wgs84_to_puwg1992


class GugikGeoResolver:
    """Klasa odpowiedzialna za mapowanie punktów (sklepów/paczkomatów) na województwa, powiaty i gminy z GUS.
    
    Wykorzystuje cache lokalny oraz usługę UUG GUGiK do geokodowania.
    """
    
    def __init__(self, con, cache_path: str | None = None):
        self.con = con
        if cache_path is None:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            self.cache_path = os.path.join(project_root, "data", "geo", ".city_gugik_cache.json")
        else:
            self.cache_path = cache_path
        self.gugik_cache = self._load_cache()
        self.cache_dirty = False
        
        # Słowniki pomocnicze z bazy danych
        self.voiv_by_id = {}
        self.voiv_by_name = {}
        for r_id, name in con.execute("SELECT id, name FROM administrative_division WHERE level = 1").fetchall():
            self.voiv_by_id[r_id] = name
            self.voiv_by_name[name.lower()] = r_id
            
        self.powiat_by_id = {}
        self.powiat_by_name = {}  # (voiv_id, p_clean) -> id
        
        for r_id, name, vid in con.execute("SELECT id, name, voivodeship_id FROM administrative_division WHERE level = 2").fetchall():
            self.powiat_by_id[r_id] = name
            p_clean = self.clean_powiat_name(name)
            self.powiat_by_name[(vid, p_clean)] = r_id
            
        # Słowniki pomocnicze dla gmin (poziom 3)
        self.gmina_by_teryt6 = {}
        self.gmina_by_name = {}          # (powiat_id, gmina_clean) -> id
        self.city_powiat_by_name = {}    # (voiv_id, gmina_clean) -> id
        self.gmina_parents = {}
        
        for g_id, name, vid, pid, gus_id in con.execute(
            "SELECT id, name, voivodeship_id, powiat_id, gus_id FROM administrative_division WHERE level = 3"
        ).fetchall():
            self.gmina_parents[g_id] = (vid, pid)
            if gus_id:
                if gus_id.endswith("000"):
                    t6 = gus_id[2:4] + gus_id[7:9] + "01"
                else:
                    t6 = gus_id[2:4] + gus_id[7:9] + gus_id[9:11]
                self.gmina_by_teryt6[t6] = g_id
                
            clean_gname = name.lower().strip()
            if pid:
                self.gmina_by_name[(pid, clean_gname)] = g_id
            else:
                self.city_powiat_by_name[(vid, clean_gname)] = g_id
                
        # Map z gmina_id (poziom 3) na city_id (poziom 4) na bazie gus_id
        gmina_by_gus = {}
        for g_id, gus_id in con.execute("SELECT id, gus_id FROM administrative_division WHERE level = 3").fetchall():
            if gus_id:
                gmina_by_gus[gus_id] = g_id
                
        self.city_by_gmina_id = {}
        for c_id, gus_id in con.execute("SELECT id, gus_id FROM administrative_division WHERE level = 4").fetchall():
            if gus_id in gmina_by_gus:
                g_id = gmina_by_gus[gus_id]
                self.city_by_gmina_id[g_id] = c_id
            
    def _load_cache(self) -> dict:
        if os.path.exists(self.cache_path):
            try:
                with open(self.cache_path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}
        
    def _save_cache(self) -> None:
        if self.cache_dirty:
            os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
            try:
                with open(self.cache_path, "w", encoding="utf-8") as f:
                    json.dump(self.gugik_cache, f, ensure_ascii=False, indent=2)
                self.cache_dirty = False
            except Exception:
                pass

    @staticmethod
    def clean_powiat_name(name: str) -> str:
        if not name:
            return ""
        return (name.lower()
                .replace("powiat m. st.", "")
                .replace("powiat m.", "")
                .replace("powiat", "")
                .replace("m. st.", "")
                .replace("m.", "")
                .replace("miasto", "")
                .strip())

    @staticmethod
    def normalize_city_name(city: str) -> str:
        if not city:
            return ""
        s = city.strip()
        s = s.replace("Wlkp.", "Wielkopolski").replace("wlkp.", "Wielkopolski")
        s = s.replace("Śl.", "Śląskie").replace("śl.", "Śląskie")
        s = s.replace(" k.Poznania", " koło Poznania").replace(" K.Poznania", " koło Poznania")
        s = s.replace(" k.Mosiny", " koło Mosiny").replace(" K.Mosiny", " koło Mosiny")
        s = s.replace(" Gm. Mrągowo", "").replace(" gm. Mrągowo", "")
        s = s.replace("Oswięcim", "Oświęcim").replace("oswięcim", "Oświęcim")
        s = s.replace("Świętochowice", "Świętochłowice").replace("świętochowice", "Świętochłowice")
        s = s.replace("Stargard Szczeciński", "Stargard")
        s = s.replace(" - ", "-").replace(" -", "-").replace("- ", "-")
        s = re.sub(r"\b(Zdroj|zdroj)\b", "Zdrój", s)
        s = re.sub(r"\b(Zdrój|zdroj)\b", "Zdrój", s)
        return s

    def resolve_facts(self, facts: list) -> None:
        """Mapuje całą listę faktów i zapisuje cache po zakończeniu."""
        # 1. Grupujemy po znormalizowanej nazwie miasta, by zminimalizować zapytania HTTP
        unique_cities = {}
        for r in facts:
            c = r.get("city")
            if not c:
                continue
            c_norm = " ".join(c.split()).strip()
            if not c_norm:
                continue
            unique_cities.setdefault(c_norm.lower(), []).append(r)
            
        # 2. Iterujemy po miastach i odpytujemy GUGiK/wyciągamy z cache
        for c_lower, group in unique_cities.items():
            candidates = self.gugik_cache.get(c_lower)
            if candidates is None:
                c_name_rep = group[0]["city"]
                c_query = self.normalize_city_name(c_name_rep)
                print(f"[gugik] Pobieram kandydatow dla miasta '{c_name_rep}' (jako '{c_query}')...")
                try:
                    url = "https://services.gugik.gov.pl/uug/"
                    r = requests.get(url, params={"request": "GetAddress", "address": c_query}, timeout=15)
                    if r.status_code == 200:
                        data = r.json()
                        results = data.get("results")
                        if isinstance(results, dict):
                            candidates = list(results.values())
                        elif isinstance(results, list):
                            candidates = results
                        else:
                            candidates = []
                    else:
                        candidates = []
                    self.gugik_cache[c_lower] = candidates
                    self.cache_dirty = True
                    time.sleep(0.1)
                except Exception as e:
                    print(f"[gugik] Blad pobierania '{c_name_rep}': {e}")
                    candidates = []

            # 3. Dla każdego punktu przypisujemy najbliższego kandydata
            for r in group:
                lat = r["latitude"]
                lon = r["longitude"]
                
                best_candidate = None
                if candidates:
                    if len(candidates) == 1:
                        best_candidate = candidates[0]
                    else:
                        store_n, store_e = wgs84_to_puwg1992(lat, lon)
                        best_dist = float("inf")
                        for cand in candidates:
                            try:
                                cand_e = float(cand.get("x", 0))
                                cand_n = float(cand.get("y", 0))
                                dist2 = (cand_e - store_e)**2 + (cand_n - store_n)**2
                                if dist2 < best_dist:
                                    best_dist = dist2
                                    best_candidate = cand
                            except (ValueError, TypeError):
                                continue
                                
                resolved_v = None
                resolved_p = None
                resolved_t = None
                resolved_c = None
                if best_candidate:
                    resolved_v = best_candidate.get("voivodeship")
                    resolved_p = best_candidate.get("county")
                    resolved_t = best_candidate.get("teryt")
                    resolved_c = best_candidate.get("commune")
                    
                vid = None
                pid = None
                gid = None
                v_name = None
                p_name = None
                
                if resolved_v:
                    vid = self.voiv_by_name.get(resolved_v.lower())
                    if vid:
                        v_name = self.voiv_by_id[vid]
                        
                if resolved_p and vid:
                    p_clean = self.clean_powiat_name(resolved_p)
                    pid = self.powiat_by_name.get((vid, p_clean))
                    if pid:
                        p_name = self.powiat_by_id[pid]
                        
                # Rozstrzyganie gminy
                if resolved_t:
                    t6 = resolved_t[:6]
                    gid = self.gmina_by_teryt6.get(t6)
                if not gid and resolved_c and vid:
                    clean_commune = resolved_c.lower().strip()
                    if pid:
                        gid = self.gmina_by_name.get((pid, clean_commune))
                    else:
                        gid = self.city_powiat_by_name.get((vid, clean_commune))
                
                if gid:
                    # Przepisujemy poprawne id rodziców z poziomu gminy z bazy danych
                    g_vid, g_pid = self.gmina_parents.get(gid, (None, None))
                    if g_vid:
                        vid = g_vid
                        v_name = self.voiv_by_id.get(vid)
                    if g_pid:
                        pid = g_pid
                        p_name = self.powiat_by_id.get(pid)
                        
                r["voivodeship_id"] = vid
                r["powiat_id"] = pid
                r["miasto_id"] = self.city_by_gmina_id.get(gid) if gid else None
                r["gmina_id"] = gid
                r["voivodeship"] = v_name
                r["powiat"] = p_name

        # 4. Zapasowy fallback dla nieprzypisanych punktów (najbliższy geograficznie sąsiad)
        self._apply_spatial_fallback(facts)
        
        # 5. Zapisujemy zaktualizowany cache
        self._save_cache()

    def _apply_spatial_fallback(self, facts: list) -> None:
        ref_pts = []
        for r in facts:
            if r.get("voivodeship_id") is not None and r.get("powiat_id") is not None and r.get("gmina_id") is not None:
                ref_pts.append((
                    r["latitude"], 
                    r["longitude"], 
                    r["voivodeship_id"], 
                    r["powiat_id"], 
                    r["gmina_id"],
                    r["voivodeship"], 
                    r["powiat"]
                ))
                
        if ref_pts:
            ref_coords = np.array([[x[0], x[1]] for x in ref_pts])
            fallback_count = 0
            for r in facts:
                if r.get("voivodeship_id") is None or r.get("powiat_id") is None or r.get("gmina_id") is None:
                    dists = (ref_coords[:, 0] - r["latitude"])**2 + (ref_coords[:, 1] - r["longitude"])**2
                    idx = int(np.argmin(dists))
                    best_ref = ref_pts[idx]
                    
                    r["voivodeship_id"] = best_ref[2]
                    r["powiat_id"] = best_ref[3]
                    r["miasto_id"] = self.city_by_gmina_id.get(best_ref[4]) if best_ref[4] else None
                    r["gmina_id"] = best_ref[4]
                    r["voivodeship"] = best_ref[5]
                    r["powiat"] = best_ref[6]
                    fallback_count += 1
            if fallback_count > 0:
                print(f"[gugik-fallback] Zmapowano zapasowo {fallback_count} punktow do ich najblizszych sasiadow.")
