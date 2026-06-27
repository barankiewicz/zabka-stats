"""
Wspolne narzedzia geometryczne ETL Żabki.

Czyste funkcje przestrzenne bez wejscia/wyjscia: indeks poligonow, ray casting
(_ring_contains), transformacja WGS84 -> PUWG1992 oraz stala promienia Ziemi.
Te same prymitywy uzywaja wzbogacenia regionow, parkow i najdalszego punktu.
"""

import math

# Promien Ziemi w km - stala dla haversine (BallTree zwraca radiany).
EARTH_KM = 6371.0088


# ---------------------------------------------------------------------------
# Ray casting / point-in-polygon
# ---------------------------------------------------------------------------
def ring_contains(lon, lat, ring) -> bool:
    """Czy punkt (lon, lat) lezy wewnatrz pojedynczego pierscienia (ray casting)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and \
           (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside



# ---------------------------------------------------------------------------
# Indeksy poligonow
# ---------------------------------------------------------------------------
def build_polygon_index(geojson: dict) -> list:
    """Lista (nazwa, bbox, area, [pierscienie]). Sortowana rosnaco po powierzchni,
    zeby przy nakladaniu (powiat grodzki w ziemskim) wygrywal mniejszy = bardziej szczegolowy."""
    index = []
    for feat in geojson.get("features", []):
        name = feat.get("properties", {}).get("nazwa")
        geom = feat.get("geometry", {})
        gtype, coords = geom.get("type"), geom.get("coordinates", [])
        rings = []
        if gtype == "Polygon":
            rings = [coords[0]]
        elif gtype == "MultiPolygon":
            rings = [poly[0] for poly in coords]
        if not rings:
            continue
        xs = [pt[0] for r in rings for pt in r]
        ys = [pt[1] for r in rings for pt in r]
        bbox = (min(xs), min(ys), max(xs), max(ys))
        area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        index.append((name, bbox, area, rings))
    index.sort(key=lambda x: x[2])  # najmniejsze najpierw
    return index


def assign_region(lon, lat, index):
    """Zwroc nazwe obszaru zawierajacego punkt. Index posortowany rosnaco po powierzchni,
    wiec pierwszy trafiony = najmniejszy = grodzki wygrywa z ziemskim."""
    for name, (x0, y0, x1, y1), _area, rings in index:
        if x0 <= lon <= x1 and y0 <= lat <= y1:
            if any(ring_contains(lon, lat, r) for r in rings):
                return name
    return None


def nearest_region(lon, lat, index):
    """Fallback dla punktow tuz za uproszczona granica: najblizszy obszar wg centroidu bbox."""
    best, bestd = None, 1e18
    for name, (x0, y0, x1, y1), _area, _rings in index:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        d = (cx - lon) ** 2 + (cy - lat) ** 2
        if d < bestd:
            best, bestd = name, d
    return best


# nazwa parku z dowolnego sensownego klucza properties
_PARK_NAME_KEYS = ("nazwa", "name", "NAZWA", "Name", "nazwa_pl", "nazwaParku", "NAZWAPARKU")


def polygon_index_named(gj: dict) -> list:
    """Jak build_polygon_index, ale nazwa z dowolnego sensownego klucza properties.
    Zwraca [(nazwa, bbox, [pierscienie])]."""
    index = []
    for feat in gj.get("features", []):
        props = feat.get("properties", {}) or {}
        name = next((props[k] for k in _PARK_NAME_KEYS if props.get(k)), None)
        geom = feat.get("geometry") or {}
        gtype, coords = geom.get("type"), geom.get("coordinates", [])
        rings = []
        if gtype == "Polygon":
            rings = [coords[0]]
        elif gtype == "MultiPolygon":
            rings = [poly[0] for poly in coords]
        if not rings:
            continue
        xs = [pt[0] for rg in rings for pt in rg]
        ys = [pt[1] for rg in rings for pt in rg]
        index.append((name, (min(xs), min(ys), max(xs), max(ys)), rings))
    return index


def geojson_points(gj: dict) -> list:
    """Reprezentatywne punkty [lat, lon] z dowolnej geometrii.
    Punkty wprost; poligony przez centroid pierscienia (wystarczy do progu 50 m)."""
    pts = []
    for feat in gj.get("features", []):
        geom = feat.get("geometry") or {}
        t, c = geom.get("type"), geom.get("coordinates")
        if not c:
            continue
        if t == "Point":
            pts.append((c[1], c[0]))
        elif t == "MultiPoint":
            pts.extend((p[1], p[0]) for p in c)
        elif t in ("Polygon", "MultiPolygon"):
            ring = c[0][0] if t == "MultiPolygon" else c[0]
            if ring:
                xs = [p[0] for p in ring]
                ys = [p[1] for p in ring]
                pts.append((sum(ys) / len(ys), sum(xs) / len(xs)))
    return pts


def poland_rings(woj_geo: dict) -> list:
    """Wyciagnij wszystkie zewnetrzne pierscienie wojewodztw jako liste pierscieni."""
    rings = []
    for feat in woj_geo.get("features", []):
        geom = feat.get("geometry", {})
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        if gtype == "Polygon":
            rings.append(coords[0])
        elif gtype == "MultiPolygon":
            for poly in coords:
                rings.append(poly[0])
    return rings


# ---------------------------------------------------------------------------
# Transformacja wspolrzednych
# ---------------------------------------------------------------------------
def wgs84_to_puwg1992(lat: float, lon: float):
    """WGS84 (lat, lon) -> PL-1992 / EPSG:2180 (X=northing, Y=easting).
    Forward transverse Mercator (GRS80, poludnik 19E, k0=0.9993). Usluga GUGiK NMT
    przyjmuje wylacznie wspolrzedne plaskie XY, nie geograficzne."""
    a = 6378137.0
    f = 1 / 298.257222101
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    k0 = 0.9993
    lon0 = math.radians(19.0)
    FE, FN = 500000.0, -5300000.0
    phi, lam = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T = math.tan(phi) ** 2
    C = ep2 * math.cos(phi) ** 2
    A = (lam - lon0) * math.cos(phi)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
             - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
             - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    easting = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6
                             + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120)
    northing = FN + k0 * (M + N * math.tan(phi) * (A ** 2 / 2
                          + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
                          + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720))
    return northing, easting
