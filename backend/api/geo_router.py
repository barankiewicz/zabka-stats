import hashlib
import json
import math
import re
from pathlib import Path

from litestar import Response, Router, get
from litestar.connection import Request
from litestar.exceptions import HTTPException
from litestar.params import FromQuery

from backend.api.demographics import (
    get_voiv_area,
    get_voiv_population,
    load_demographics_from_db,
)
from backend.cache import cached
from backend.database import client
from backend.etl.geo import assign_region, build_polygon_index, nearest_region
from backend.schemas.api_models import (
    ByDimensionItem,
    ByDimensionResponse,
    CitiesWithoutZabkaResponse,
    CityCoverageResponse,
    CityWithoutZabkaItem,
    CoverageFunnelItem,
    GminaLeadersItem,
    GminaLeadersResponse,
    PowiatCoverageResponse,
    VoivodeshipDensityResponseItem,
)

_GEO_DIR = Path(__file__).parent.parent.parent / "data" / "geo"

_VOIV_AREA = None
_POW_GEO = None
_GMINA_AGG = None
_GEO_BYTES: dict = {}   # filename -> raw bytes (boundary geojson, read once)
_GEO_ETAG: dict = {}    # filename -> strong ETag for those bytes (computed once)


def _geo_bytes(filename: str):
    """Boundary geojson held in memory, read from disk once. These files are
    static (they only change on a rare boundary refresh + restart), and the
    endpoints serving them return a raw Response that the Redis cache can't
    store - so without this every request re-read the file off disk."""
    if filename not in _GEO_BYTES:
        path = _GEO_DIR / filename
        _GEO_BYTES[filename] = path.read_bytes() if path.exists() else None
    return _GEO_BYTES[filename]


def _geojson_response(filename: str, request: Request, not_found: str) -> Response:
    """Serve a static boundary geojson with an ETag + Cache-Control so repeat
    visits revalidate cheaply (304) instead of re-downloading hundreds of KB.

    These files are large (gminy.geojson is ~500 KB gzipped) and effectively
    immutable between boundary refreshes, but the raw Response path can't use the
    Redis cache, and nginx only microcaches /api/ for 2s. A content-hash ETag
    lets the browser skip the transfer entirely on repeat visits; max-age caps
    how long a client waits before revalidating after a (rare) boundary change.
    """
    data = _geo_bytes(filename)
    if data is None:
        raise HTTPException(status_code=404, detail=not_found)

    etag = _GEO_ETAG.get(filename)
    if etag is None:
        etag = '"' + hashlib.md5(data).hexdigest() + '"'  # noqa: S324 (cache validator, not security)
        _GEO_ETAG[filename] = etag

    headers = {"ETag": etag, "Cache-Control": "public, max-age=3600"}

    if_none_match = request.headers.get("if-none-match")
    if if_none_match and etag in [tag.strip() for tag in if_none_match.split(",")]:
        return Response(content=b"", status_code=304, headers=headers)

    return Response(content=data, media_type="application/json", headers=headers)


# --- Startup Event ---
def startup_geo() -> None:
    load_demographics_from_db()
    # Warm the lazy caches so no request pays the build cost on first hit -
    # _pow_geo in particular point-in-polygons every powiat against the
    # voivodeship index, which is too much to do on a request thread.
    try:
        _voiv_area()
        _pow_geo()
        _gmina_agg()
        _geo_bytes("wojewodztwa.geojson")
        _geo_bytes("powiaty.geojson")
        global _POW_ECON_GEO
        _POW_ECON_GEO = _build_pow_econ_geo()
    except Exception as e:
        print(f"[startup_geo] cache warm skipped: {e}")

startup_handlers = [startup_geo]

# --- Geometry Helpers ---
def _rings(geom):
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon":
        return [c[0]] if c else []
    if t == "MultiPolygon":
        return [poly[0] for poly in c if poly]
    return []

def _ring_area_km2(ring):
    n = len(ring)
    if n < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / n
    k = math.cos(math.radians(lat0))
    s = 0.0
    for i in range(n):
        x1, y1 = ring[i][0] * k * 111.320, ring[i][1] * 110.574
        x2, y2 = ring[(i + 1) % n][0] * k * 111.320, ring[(i + 1) % n][1] * 110.574
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0

def _strip_pow(name):
    return name[7:] if name and name.lower().startswith("powiat ") else name


_DISAMBIG_SUFFIX_RE = re.compile(r"\s*\([^)]+\)\s*$")


def _pow_geo_key(name: str) -> str:
    """Strip both the 'powiat ' prefix AND a trailing ' (skrot)' disambiguator.

    Used ONLY as the lookup key into the powiaty.geojson index. The geojson's
    'nazwa' property never carries the suffix (it's just 'powiat grodziski'),
    so the disambiguated dim_powiat name ('powiat grodziski (maz.)') must be
    reduced to the same plain key for the match to work. The DISPLAY name in
    API responses keeps the suffix - this function is not used for display.
    """
    s = _strip_pow(name)
    return _DISAMBIG_SUFFIX_RE.sub("", s)


# powiaty.geojson predates the 2021 rename of powiat jeleniogórski to
# karkonoski - map both spellings onto the same polygon/data.
_POW_NAME_ALIASES = {"jeleniogórski": "karkonoski", "karkonoski": "jeleniogórski"}


def _teryt7(gus_id: str) -> str | None:
    """12-char BDL unit id -> 7-digit TERYT gmina code (with kind digit),
    matching the `kod` property in gminy.geojson. A city with powiat rights
    is stored under its level-5 id (ends '000') and maps to its urban gmina
    ('...011'), e.g. '071412865000' -> '1465011' (Warszawa)."""
    if not gus_id or len(gus_id) != 12:
        return None
    if gus_id.endswith("000"):
        return gus_id[2:4] + gus_id[7:9] + "011"
    return gus_id[2:4] + gus_id[7:9] + gus_id[9:12]

def _voiv_area():
    global _VOIV_AREA
    if _VOIV_AREA is None:
        path = _GEO_DIR / "wojewodztwa.geojson"
        if not path.exists():
            return {}
        gj = json.loads(path.read_bytes())
        _VOIV_AREA = {f["properties"].get("nazwa"):
                      round(sum(_ring_area_km2(r) for r in _rings(f.get("geometry") or {})), 1)
                      for f in gj.get("features", [])}
    return _VOIV_AREA

def _norm_voiv(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    replacements = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z'
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    return s

def _pow_geo():
    global _POW_GEO
    if _POW_GEO is None:
        woj_path = _GEO_DIR / "wojewodztwa.geojson"
        pow_path = _GEO_DIR / "powiaty.geojson"
        if not woj_path.exists() or not pow_path.exists():
            return {}
        woj_idx = build_polygon_index(json.loads(woj_path.read_bytes()))
        gj = json.loads(pow_path.read_bytes())
        out = {}
        for f in gj.get("features", []):
            rings = _rings(f.get("geometry") or {})
            if not rings:
                continue
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            voiv = assign_region(cx, cy, woj_idx) or nearest_region(cx, cy, woj_idx)
            voiv_norm = _norm_voiv(voiv)
            sname = _strip_pow(f["properties"].get("nazwa") or "").lower()
            rec = {"id": f["properties"].get("id"),
                   "area": round(sum(_ring_area_km2(r) for r in rings), 1)}
            out[(voiv_norm, sname)] = rec
            if sname in _POW_NAME_ALIASES:
                out.setdefault((voiv_norm, _POW_NAME_ALIASES[sname]), rec)
        _POW_GEO = out
    return _POW_GEO

def _gmina_agg():
    global _GMINA_AGG
    if _GMINA_AGG is None:
        raw = client.execute("""
            SELECT g.name, COUNT(l.store_id), g.population, g.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name)
            FROM dim_gmina g
            JOIN locations l ON l.gmina_id = g.id
              AND l.deleted_at IS NULL 
            LEFT JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            GROUP BY g.id, g.name, g.population, g.area_km2
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        rows = []
        for name, cnt, pop, area, lat, lon, voiv in raw:
            rows.append({
                "name": name,
                "voivodeship": voiv or "",
                "cnt": cnt,
                "population": pop,
                "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat,
                "lon": lon,
                "geo_id": None
            })
        _GMINA_AGG = rows
    return _GMINA_AGG

# --- Endpoints ---

@get("/geo/voivodeships", sync_to_thread=True)
def geo_voivodeships(request: Request) -> Response:
    return _geojson_response(
        "wojewodztwa.geojson", request, "Voivodeships boundary file not found"
    )

@get("/geo/powiats", sync_to_thread=True)
def geo_powiats(request: Request) -> Response:
    return _geojson_response(
        "powiaty.geojson", request, "Powiats boundary file not found"
    )

@get("/geo/gminas", sync_to_thread=True)
def geo_gminas(request: Request) -> Response:
    return _geojson_response(
        "gminy.geojson", request, "Gminas boundary file not found"
    )

# --- Powiat economics choropleth (residual maps) ---
# Two side-by-side choropleths in the "Żabka a Polska" tab both use powiat
# boundaries; instead of raw density they show the *residual* of Żabka density
# (stores per 1000 residents) against a linear fit on an economic variable:
#   left  map -> residual vs unemployment_rate
#   right map -> residual vs avg_salary
# Green = the powiat has more Żabki than its economy would predict, red = fewer.
# We bake both residuals into the powiat geojson server-side so the frontend
# only fetches one joined FeatureCollection and reads the right property per map.
_POW_ECON_GEO = None


def _linreg(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0, (sum(ys) / n if n else 0.0)
    mx = sum(xs) / n
    my = sum(ys) / n
    num = den = 0.0
    for x, y in zip(xs, ys, strict=True):
        dx = x - mx
        num += dx * (y - my)
        den += dx * dx
    slope = num / den if den else 0.0
    return slope, my - slope * mx


def _pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sx = sy = 0.0
    for x, y in zip(xs, ys, strict=True):
        dx, dy = x - mx, y - my
        sxy += dx * dy
        sx += dx * dx
        sy += dy * dy
    return sxy / math.sqrt(sx * sy) if sx and sy else 0.0


def _p90_abs(vals):
    if not vals:
        return 1.0
    s = sorted(abs(v) for v in vals)
    idx = min(len(s) - 1, int(round(0.90 * (len(s) - 1))))
    return s[idx] or 1.0


def _feature_centroid(geom):
    rings = _rings(geom)
    if not rings:
        return None
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _build_pow_econ_geo():
    """Join powiaty.geojson with per-powiat economics and precompute residuals.

    dim_powiat holds the 314 land powiats; the geojson carries 380 polygons
    (the extra 66 are cities with powiat rights). Those cities are merged into
    their surrounding land powiat in our data model, so a city polygon inherits
    the residual of the nearest land powiat in the same voivodeship - keeps the
    map seamless instead of leaving big grey holes over Kraków/Wrocław/Łódź.

    If the geojson assets are missing (CI checkout, fresh install before ETL
    has populated the data dir, which is gitignored), return an empty
    FeatureCollection instead of None so the endpoint stays 200 - clients
    get a well-formed empty response and can render the "no data" path
    instead of having to special-case a 404."""
    pow_path = _GEO_DIR / "powiaty.geojson"
    woj_path = _GEO_DIR / "wojewodztwa.geojson"
    if not pow_path.exists() or not woj_path.exists():
        print(f"[gugik-pow-econ-geo] Brak {pow_path.name} / {woj_path.name} - zwracam pusty FeatureCollection.")
        return json.dumps(
            {"type": "FeatureCollection", "features": [], "_meta": {"reason": "no_geojson_assets"}},
            ensure_ascii=False,
        ).encode("utf-8")

    rows = client.execute("""
        SELECT dp.name, dv.name AS voiv,
               COALESCE(dp.avg_salary, 0), COALESCE(dp.unemployment_rate, 0),
               dp.population AS land_pop,
               COUNT(l.store_id) AS stores,
               dp.centroid_lon, dp.centroid_lat
        FROM dim_powiat dp
        JOIN dim_voivodeship dv ON dp.voivodeship_id = dv.id
        LEFT JOIN locations l
          ON l.powiat_id = dp.id AND l.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM v_city_powiat_miasta c WHERE c.id = l.miasto_id)
        GROUP BY dp.name, dv.name, dp.avg_salary, dp.unemployment_rate,
                 dp.population, dp.centroid_lon, dp.centroid_lat
    """).fetchall()

    lands = []
    for name, voiv, salary, unemp, pop, stores, clon, clat in rows:
        per_1k = round(stores * 1000.0 / pop, 3) if pop else 0.0
        lands.append({
            "name": name, "voiv": voiv,
            "salary": float(salary or 0), "unemp": float(unemp or 0),
            "per_1k": per_1k, "stores": int(stores),
            "clon": float(clon) if clon is not None else None,
            "clat": float(clat) if clat is not None else None,
        })

    # Cities with powiat rights are their own GUS level-5 units with their own
    # salary/unemployment - they enter the choropleth with their OWN numbers.
    city_rows = client.execute("""
        SELECT c.name, dv.name AS voiv,
               COALESCE(c.avg_salary, 0), COALESCE(c.unemployment_rate, 0),
               c.population, COUNT(l.store_id) AS stores
        FROM dim_city c
        JOIN dim_voivodeship dv ON dv.id = c.voivodeship_id
        LEFT JOIN locations l
          ON l.miasto_id = c.id AND l.deleted_at IS NULL
        WHERE SUBSTR(c.gus_id, 8, 2) >= '61'
        GROUP BY c.name, dv.name, c.avg_salary, c.unemployment_rate, c.population
    """).fetchall()
    city_units = []
    for name, voiv, salary, unemp, pop, stores in city_rows:
        per_1k = round(stores * 1000.0 / pop, 3) if pop else 0.0
        city_units.append({
            "name": name, "voiv": voiv,
            "salary": float(salary or 0), "unemp": float(unemp or 0),
            "per_1k": per_1k, "stores": int(stores),
        })

    # The regression/r/bounds stay fitted on land powiats only (the published
    # correlation story); city residuals are measured against that same line.
    fit = [d for d in lands if d["salary"] > 0 and d["per_1k"] > 0]
    sal = [d["salary"] for d in fit]
    une = [d["unemp"] for d in fit]
    dens = [d["per_1k"] for d in fit]
    s_slope, s_int = _linreg(sal, dens)
    u_slope, u_int = _linreg(une, dens)
    r_salary = _pearson(sal, dens)
    r_unemp = _pearson(une, dens)

    for d in lands + city_units:
        d["resid_salary"] = round(d["per_1k"] - (s_slope * d["salary"] + s_int), 3)
        d["resid_unemp"] = round(d["per_1k"] - (u_slope * d["unemp"] + u_int), 3)

    bound_salary = round(_p90_abs([d["resid_salary"] for d in fit]), 3)
    bound_unemp = round(_p90_abs([d["resid_unemp"] for d in fit]), 3)

    # lookup by (voiv_norm, stripped lowercase name) for the direct match
    by_key = {(_norm_voiv(d["voiv"]), _pow_geo_key(d["name"]).lower()): d for d in lands}
    city_by_key = {(_norm_voiv(d["voiv"]), d["name"].lower()): d for d in city_units}

    woj_idx = build_polygon_index(json.loads(woj_path.read_bytes()))
    gj = json.loads(pow_path.read_bytes())
    features = []
    for i, f in enumerate(gj.get("features", [])):
        geom = f.get("geometry") or {}
        cen = _feature_centroid(geom)
        if cen is None:
            continue
        cx, cy = cen
        voiv = assign_region(cx, cy, woj_idx) or nearest_region(cx, cy, woj_idx)
        voiv_norm = _norm_voiv(voiv)
        sname = _strip_pow(f["properties"].get("nazwa") or "").lower()
        d = by_key.get((voiv_norm, sname))
        if d is None and sname in _POW_NAME_ALIASES:
            d = by_key.get((voiv_norm, _POW_NAME_ALIASES[sname]))
        if d is None:
            # City with powiat rights - its polygon shows the CITY's own
            # numbers, never the neighbouring land powiat's (hovering Warszawa
            # vs powiat warszawski zachodni must give different data).
            d = city_by_key.get((voiv_norm, sname))
        props = {"_fid": i, "nazwa": f["properties"].get("nazwa")}
        if d is not None:
            props.update({
                "name": _strip_pow(d["name"]),
                "voivodeship": d["voiv"],
                "per_1k": d["per_1k"],
                "avg_salary": round(d["salary"]),
                "unemployment_rate": round(d["unemp"], 1),
                "resid_salary": d["resid_salary"],
                "resid_unemp": d["resid_unemp"],
            })
        features.append({"type": "Feature", "geometry": geom, "properties": props})

    fc = {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "r_salary": round(r_salary, 2),
            "r_unemp": round(r_unemp, 2),
            "bound_salary": bound_salary,
            "bound_unemp": bound_unemp,
            "n": len(fit),
        },
    }
    return json.dumps(fc, ensure_ascii=False).encode("utf-8")


@get("/stats/powiat-economics-geo", sync_to_thread=True)
def powiat_economics_geo() -> Response:
    global _POW_ECON_GEO
    if _POW_ECON_GEO is None:
        _POW_ECON_GEO = _build_pow_econ_geo()
    if _POW_ECON_GEO is None:
        raise HTTPException(status_code=404, detail="Powiat economics geo unavailable")
    return Response(content=_POW_ECON_GEO, media_type="application/json")


@get("/stats/powiat-coverage", sync_to_thread=True)
@cached(ttl=86400)
def powiat_coverage() -> PowiatCoverageResponse:
    raw = client.execute("""
        SELECT AVG(latitude), AVG(longitude) 
        FROM locations 
        WHERE deleted_at IS NULL AND powiat_id IS NOT NULL 
        GROUP BY powiat_id
        UNION ALL
        SELECT AVG(latitude), AVG(longitude)
        FROM locations
        WHERE deleted_at IS NULL AND miasto_id IN (
            SELECT id FROM administrative_division 
            WHERE level = 4 AND SUBSTR(gus_id, 8, 2) >= '61'
        )
        GROUP BY miasto_id
    """).fetchall()
    dots = [[round(r[0], 4), round(r[1], 4)] for r in raw if r[0] is not None and r[1] is not None]
    # covered/total describe LAND powiats only (a city with powiat rights is a
    # separate unit counted in the MIASTA dimension, and stores there carry
    # powiat_id NULL). The dots stay a union of both so the map has no holes
    # over Warszawa/Kraków - so len(dots) can exceed `covered`.
    total_row = client.execute("SELECT COUNT(*) FROM dim_powiat").fetchone()
    total = total_row[0] if total_row else 314
    covered_row = client.execute("""
        SELECT COUNT(DISTINCT powiat_id) FROM locations
        WHERE deleted_at IS NULL AND powiat_id IS NOT NULL
    """).fetchone()
    covered = covered_row[0] if covered_row else 0
    return PowiatCoverageResponse(total=total, covered=covered, dots=dots)

@get("/stats/city-coverage", sync_to_thread=True)
@cached(ttl=3600)
def city_coverage() -> CityCoverageResponse:
    total_row = client.execute("SELECT COUNT(*) FROM dim_city").fetchone()
    total = total_row[0] if total_row else 302
    
    covered_row = client.execute("""
        SELECT COUNT(DISTINCT miasto_id) FROM locations 
        WHERE deleted_at IS NULL AND miasto_id IS NOT NULL
    """).fetchone()
    covered = covered_row[0] if covered_row else 0
    
    zab_localities_row = client.execute("""
        SELECT COUNT(DISTINCT lower(trim(city))) FROM locations 
        WHERE deleted_at IS NULL AND city IS NOT NULL AND city <> ''
    """).fetchone()
    zab_localities = zab_localities_row[0] if zab_localities_row else 0
    
    return CityCoverageResponse(
        total_cities=total,
        with_zabka=covered,
        without_zabka=total - covered,
        pct=round(100.0 * covered / total, 1) if total else 0,
        zabka_localities=zab_localities
    )

@get("/stats/cities-without-zabka", sync_to_thread=True)
@cached(ttl=3600)
def cities_without_zabka() -> CitiesWithoutZabkaResponse:
    total_row = client.execute("SELECT COUNT(*) FROM dim_city").fetchone()
    total = total_row[0] if total_row else 302

    rows = client.execute("""
        SELECT dc.name, dv.name AS voivodeship, dc.population,
               dp.centroid_lon, dp.centroid_lat
        FROM dim_city dc
        JOIN dim_voivodeship dv ON dv.id = dc.voivodeship_id
        LEFT JOIN dim_powiat dp ON dp.id = dc.powiat_id
        WHERE dc.id NOT IN (
            SELECT DISTINCT miasto_id FROM locations
            WHERE deleted_at IS NULL AND miasto_id IS NOT NULL
        )
        ORDER BY dc.population DESC NULLS LAST
    """).fetchall()
    cities = [CityWithoutZabkaItem(name=r[0], voivodeship=r[1], population=r[2],
                                   centroid_lon=r[3], centroid_lat=r[4]) for r in rows]
    without = len(cities)
    return CitiesWithoutZabkaResponse(
        total_cities=total,
        without_zabka=without,
        pct=round(100.0 * without / total, 1) if total else 0,
        cities=cities,
    )

@get("/stats/coverage-funnel", sync_to_thread=True)
@cached(ttl=3600)
def coverage_funnel() -> list[CoverageFunnelItem]:
    # Inline the powiat/city/gmina queries directly; calling decorated route
    # handlers as coroutines does not work (they are Litestar HTTPRouteHandler
    # objects, not plain coroutines).

    # Powiaty
    pc_row = client.execute("""
        SELECT COUNT(DISTINCT powiat_id) FROM locations
        WHERE deleted_at IS NULL AND powiat_id IS NOT NULL
    """).fetchone()
    pc_covered = pc_row[0] if pc_row else 0
    # 314 land powiats; cities with powiat rights live in the MIASTA level below.
    pc_total_row = client.execute("SELECT COUNT(*) FROM dim_powiat").fetchone()
    pc_total = pc_total_row[0] if pc_total_row else 314

    # Officially recognised cities (dim_city = 302 rows)
    cc_total_row = client.execute("SELECT COUNT(*) FROM dim_city").fetchone()
    cc_total = cc_total_row[0] if cc_total_row else 302
    cc_covered_row = client.execute("""
        SELECT COUNT(DISTINCT miasto_id) FROM locations
        WHERE deleted_at IS NULL AND miasto_id IS NOT NULL
    """).fetchone()
    cc_covered = cc_covered_row[0] if cc_covered_row else 0

    # Gminy
    total_gminas_row = client.execute("SELECT COUNT(*) FROM dim_gmina").fetchone()
    total_gminas = total_gminas_row[0] if total_gminas_row else 2479
    row = client.execute("""
        SELECT COUNT(DISTINCT gmina_id) FROM locations
        WHERE deleted_at IS NULL AND gmina_id IS NOT NULL
    """).fetchone()
    gminas_with = row[0] if row and row[0] else 0

    def node(level, w, t):
        return {"level": level, "covered": w, "total": t,
                "pct": round(100.0 * w / t, 1) if t else 0}

    return [
        CoverageFunnelItem(**node("powiaty", pc_covered, pc_total)),
        CoverageFunnelItem(**node("miasta", cc_covered, cc_total)),
        CoverageFunnelItem(**node("gminy", gminas_with, total_gminas)),
    ]

@get("/stats/by-dimension", sync_to_thread=True)
@cached(ttl=3600)
def by_dimension(
    dim: FromQuery[str] = "voivodeship",
    metric: FromQuery[str] = "count",
    sort: FromQuery[str] = "desc",
    limit: FromQuery[int] = 20,
    offset: FromQuery[int] = 0
) -> ByDimensionResponse:
    if dim not in ("city", "gmina", "powiat", "powiat_all", "voivodeship"):
        raise HTTPException(status_code=400, detail="Invalid dimension")

    lim = max(1, min(int(limit), 3000))
    off = max(0, int(offset))

    if dim == "city":
        raw = client.execute("""
            SELECT c.name, COUNT(l.store_id), c.population, c.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name), c.id
            FROM dim_city c
            JOIN locations l ON l.miasto_id = c.id
              AND l.deleted_at IS NULL 
            LEFT JOIN dim_voivodeship v ON v.id = c.voivodeship_id
            GROUP BY c.id, c.name, c.population, c.area_km2
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        rows = [{"name": r[0], "cnt": r[1], "population": r[2], "area_km2": r[3],
                 "per_1k": round(r[1] * 1000.0 / r[2], 2) if r[2] else None,
                 "per_km2": round(r[1] / r[3], 3) if r[3] else None,
                 "lat": r[4], "lon": r[5], "voivodeship": r[6], "geo_id": str(r[7])}
                for r in raw]
    elif dim == "gmina":
        # geo_id = 7-digit TERYT, joinable client-side with gminy.geojson `kod`.
        raw = client.execute("""
            SELECT g.name, COUNT(l.store_id), g.population, g.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name), g.gus_id
            FROM dim_gmina g
            JOIN locations l ON l.gmina_id = g.id
              AND l.deleted_at IS NULL
            LEFT JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            GROUP BY g.id, g.name, g.population, g.area_km2, g.gus_id
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        raw = [r[:7] + (_teryt7(r[7]),) for r in raw]
        if raw:
            rows = [{"name": r[0], "cnt": r[1], "population": r[2], "area_km2": r[3],
                     "per_1k": round(r[1] * 1000.0 / r[2], 2) if r[2] else None,
                     "per_km2": round(r[1] / r[3], 3) if r[3] else None,
                     "lat": r[4], "lon": r[5], "voivodeship": r[6],
                     "geo_id": r[7]}
                    for r in raw]
        else:
            rows = _gmina_agg()
    elif dim == "powiat_all":
        # The PHYSICAL powiat division: 314 land powiats + 66 cities with
        # powiat rights, each with its own stores/population/area. This is the
        # map-side dataset - the choropleth over powiaty.geojson (380 polygons)
        # is the same regardless of whether the bar chart shows land powiats
        # or cities. geo_id = powiaty.geojson feature id.
        geo = _pow_geo()
        rows = []
        land = client.execute("""
            SELECT d.name, COUNT(l.store_id), d.population,
                   AVG(l.latitude), AVG(l.longitude), MAX(l.voivodeship)
            FROM dim_powiat d
            LEFT JOIN locations l
              ON l.powiat_id = d.id AND l.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM v_city_powiat_miasta c
                              WHERE c.id = l.miasto_id)
            GROUP BY d.id, d.name, d.population
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        for name, cnt, pop, lat, lon, voiv in land:
            g = geo.get((_norm_voiv(voiv), _pow_geo_key(name).lower()), {})
            area, gid = g.get("area"), g.get("id")
            rows.append({
                "name": _strip_pow(name), "cnt": cnt, "population": pop,
                "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat, "lon": lon, "voivodeship": voiv or "",
                "geo_id": str(gid) if gid is not None else None,
            })
        cities = client.execute("""
            SELECT c.name, COUNT(l.store_id), c.population, c.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name)
            FROM dim_city c
            JOIN dim_voivodeship v ON v.id = c.voivodeship_id
            LEFT JOIN locations l
              ON l.miasto_id = c.id AND l.deleted_at IS NULL
            WHERE SUBSTR(c.gus_id, 8, 2) >= '61'
            GROUP BY c.id, c.name, c.population, c.area_km2
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        for name, cnt, pop, area, lat, lon, voiv in cities:
            g = geo.get((_norm_voiv(voiv), name.lower()), {})
            gid = g.get("id")
            rows.append({
                "name": name, "cnt": cnt, "population": pop, "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat, "lon": lon, "voivodeship": voiv or "",
                "geo_id": str(gid) if gid is not None else None,
            })
    else:
        # Per-capita density at the powiat level counts only stores that are NOT
        # in a city with powiat rights (those belong to the MIASTA dimension),
        # divided by the land powiat's own population - so a land powiat that
        # surrounds a big city is not drowned by that city's stores+population.
        # See v_city_powiat_miasta in database.py.
        if dim == "powiat":
            dimtbl, fk = "dim_powiat", "powiat_id"
            extra = "WHERE NOT regexp_matches(d.name, '^powiat [A-ZĄĆĘŁŃÓŚŹŻ]')"
            geo = _pow_geo()
            pop_field = "d.population"
            pop_join = ""
            store_filter = ("AND NOT EXISTS (SELECT 1 FROM v_city_powiat_miasta c "
                            "WHERE c.id = l.miasto_id)")
        else:
            dimtbl, fk = "dim_voivodeship", "voivodeship_id"
            extra = ""
            pop_join = "JOIN v_voiv_pop_eff pe ON pe.voivodeship_id = d.id"
            varea = _voiv_area()
            pop_field = "pe.population"
            store_filter = ""
        raw = client.execute(f"""
            SELECT d.name, COUNT(l.store_id), {pop_field} AS population,
                   AVG(l.latitude), AVG(l.longitude), MAX(l.voivodeship)
            FROM {dimtbl} d
            {pop_join}
            LEFT JOIN locations l
              ON l.{fk} = d.id AND l.deleted_at IS NULL {store_filter}
            {extra}
            GROUP BY d.id, d.name, {pop_field}
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        rows = []
        for name, cnt, pop, lat, lon, voiv in raw:
            if dim == "powiat":
                disp = _strip_pow(name)  # display keeps the (skrot) suffix
                geo_key = _pow_geo_key(name).lower()  # match key strips it
                voiv_norm = _norm_voiv(voiv)
                g = geo.get((voiv_norm, geo_key), {})
                area, gid = g.get("area"), g.get("id")
            else:
                disp, area, gid = name, varea.get(name) if varea else None, name
                if not area:
                    area = get_voiv_area(name)
            rows.append({
                "name": disp, "cnt": cnt, "population": pop, "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat, "lon": lon, "voivodeship": voiv or "",
                "geo_id": str(gid) if gid is not None else None,
            })

    keyf = {"per1k": lambda x: x["per_1k"] or 0,
            "per_km2": lambda x: x["per_km2"] or 0}.get(metric, lambda x: x["cnt"] or 0)
    # name pre-sort + stable metric sort => deterministic tie order, so paging
    # (offset/limit) returns the same rows across recomputes. Same values.
    rows.sort(key=lambda r: r.get("name") or "")
    rows.sort(key=keyf, reverse=(sort != "asc"))
    full_vals = [keyf(r) for r in rows]
    if full_vals:
        full_sum = sum(full_vals)
        full_avg = full_sum / len(full_vals)
        s = sorted(full_vals)
        n = len(s)
        full_median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    else:
        full_sum = full_avg = full_median = 0
    return ByDimensionResponse(
        rows=[ByDimensionItem(**r) for r in rows[off:off + lim]],
        total=len(rows),
        dim=dim,
        metric=metric,
        sort=sort,
        avg=round(full_avg, 3),
        median=round(full_median, 3),
        sum=int(full_sum)
    )

@get("/stats/gmina-leaders", sync_to_thread=True)
@cached(ttl=3600)
def gmina_leaders(limit: FromQuery[int] = 12) -> GminaLeadersResponse:
    rows = _gmina_agg()
    per1k = sorted((r for r in rows if r.get("per_1k") and r.get("cnt", 0) >= 3),
                   key=lambda x: -x["per_1k"])[:max(1, min(int(limit), 30))]
    per_km2 = sorted((r for r in rows if r.get("per_km2") and r.get("cnt", 0) >= 5),
                     key=lambda x: -x["per_km2"])[:max(1, min(int(limit), 30))]

    def shape(r):
        return {"name": r["name"], "voivodeship": r["voivodeship"], "cnt": r["cnt"],
                "population": r["population"], "area_km2": r["area_km2"],
                "per_1k": r["per_1k"], "per_km2": r["per_km2"]}

    total_row = client.execute("SELECT COUNT(*) FROM locations WHERE deleted_at IS NULL").fetchone()
    total = total_row[0] if total_row else 0
    
    # Calculate national population baseline
    nat_pop = 0
    for name in ["mazowieckie", "śląskie", "dolnośląskie", "wielkopolskie", "małopolskie", 
                 "pomorskie", "łódzkie", "zachodniopomorskie", "kujawsko-pomorskie", 
                 "lubelskie", "podkarpackie", "warmińsko-mazurskie", "lubuskie", 
                 "świętokrzyskie", "opolskie", "podlaskie"]:
        nat_pop += get_voiv_population(name)
        
    nat_per_1k = round(total * 1000.0 / nat_pop, 3) if nat_pop else None
    return GminaLeadersResponse(
        per_1k=[GminaLeadersItem(**shape(r)) for r in per1k],
        per_km2=[GminaLeadersItem(**shape(r)) for r in per_km2],
        national_per_1k=nat_per_1k
    )

@get("/stats/voivodeship-density", sync_to_thread=True)
@cached(ttl=3600)
def voivodeship_density() -> list[VoivodeshipDensityResponseItem]:
    rows = client.execute("""
        SELECT voivodeship, COUNT(*) AS stores
        FROM locations WHERE deleted_at IS NULL GROUP BY voivodeship
    """).fetchall()
    return [
        VoivodeshipDensityResponseItem(
            voivodeship=r[0],
            stores=int(r[1]),
            area_km2=get_voiv_area(r[0])
        )
        for r in rows if r[0]
    ]

router = Router(
    path="",
    route_handlers=[
        geo_voivodeships,
        geo_powiats,
        geo_gminas,
        powiat_economics_geo,
        powiat_coverage,
        city_coverage,
        cities_without_zabka,
        coverage_funnel,
        by_dimension,
        gmina_leaders,
        voivodeship_density,
    ]
)
