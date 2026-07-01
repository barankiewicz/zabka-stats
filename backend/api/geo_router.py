import json
import math
from pathlib import Path

from litestar import Response, Router, get
from litestar.exceptions import HTTPException
from litestar.params import FromQuery

from backend.api.demographics import (
    get_voiv_area,
    get_voiv_population,
    load_demographics_from_db,
)
from backend.cache import cached
from backend.database_ch import client
from backend.etl.geo import assign_region, build_polygon_index, nearest_region
from backend.schemas.api_models import (
    ByDimensionItem,
    ByDimensionResponse,
    CityCoverageResponse,
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


def _geo_bytes(filename: str):
    """Boundary geojson held in memory, read from disk once. These files are
    static (they only change on a rare boundary refresh + restart), and the
    endpoints serving them return a raw Response that the Redis cache can't
    store - so without this every request re-read the file off disk."""
    if filename not in _GEO_BYTES:
        path = _GEO_DIR / filename
        _GEO_BYTES[filename] = path.read_bytes() if path.exists() else None
    return _GEO_BYTES[filename]


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
            out[(voiv_norm, sname)] = {"id": f["properties"].get("id"),
                                  "area": round(sum(_ring_area_km2(r) for r in rings), 1)}
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
def geo_voivodeships() -> Response:
    data = _geo_bytes("wojewodztwa.geojson")
    if data is None:
        raise HTTPException(status_code=404, detail="Voivodeships boundary file not found")
    return Response(content=data, media_type="application/json")

@get("/geo/powiats", sync_to_thread=True)
def geo_powiats() -> Response:
    data = _geo_bytes("powiaty.geojson")
    if data is None:
        raise HTTPException(status_code=404, detail="Powiats boundary file not found")
    return Response(content=data, media_type="application/json")

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
    # 314 proper (land) powiats - cities with powiat rights are merged into their
    # surrounding land powiat at level 2, so dim_powiat is the right denominator.
    total_row = client.execute("SELECT COUNT(*) FROM dim_powiat").fetchone()
    total = total_row[0] if total_row else 314
    covered = len(dots)
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
    # 314 proper (land) powiats; cities with powiat rights are merged in at level 2.
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
    if dim not in ("city", "gmina", "powiat", "voivodeship"):
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
        raw = client.execute("""
            SELECT g.name, COUNT(l.store_id), g.population, g.area_km2,
                   AVG(l.latitude), AVG(l.longitude), MAX(v.name), g.id
            FROM dim_gmina g
            JOIN locations l ON l.gmina_id = g.id
              AND l.deleted_at IS NULL 
            LEFT JOIN dim_voivodeship v ON v.id = g.voivodeship_id
            GROUP BY g.id, g.name, g.population, g.area_km2
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        if raw:
            rows = [{"name": r[0], "cnt": r[1], "population": r[2], "area_km2": r[3],
                     "per_1k": round(r[1] * 1000.0 / r[2], 2) if r[2] else None,
                     "per_km2": round(r[1] / r[3], 3) if r[3] else None,
                     "lat": r[4], "lon": r[5], "voivodeship": r[6], "geo_id": str(r[7])}
                    for r in raw]
        else:
            rows = _gmina_agg()
    else:
        if dim == "powiat":
            dimtbl, fk = "dim_powiat", "powiat_id"
            extra = "WHERE NOT regexp_matches(d.name, '^powiat [A-ZĄĆĘŁŃÓŚŹŻ]')"
            geo = _pow_geo()
        else:
            dimtbl, fk = "dim_voivodeship", "voivodeship_id"
            extra = ""
            varea = _voiv_area()
        raw = client.execute(f"""
            SELECT d.name, COUNT(l.store_id), d.population,
                   AVG(l.latitude), AVG(l.longitude), MAX(l.voivodeship)
            FROM {dimtbl} d
            LEFT JOIN locations l
              ON l.{fk} = d.id AND l.deleted_at IS NULL 
            {extra}
            GROUP BY d.id, d.name, d.population
            HAVING COUNT(l.store_id) > 0
        """).fetchall()
        rows = []
        for name, cnt, pop, lat, lon, voiv in raw:
            if dim == "powiat":
                disp = _strip_pow(name)
                voiv_norm = _norm_voiv(voiv)
                g = geo.get((voiv_norm, disp.lower()), {})
                area, gid = g.get("area"), g.get("id")
            else:
                disp, area, gid = name, varea.get(name) if varea else None, name
                if not area:
                    area = get_voiv_area(name)
            rows.append({
                "name": disp, "cnt": cnt, "population": pop, "area_km2": area,
                "per_1k": round(cnt * 1000.0 / pop, 2) if pop else None,
                "per_km2": round(cnt / area, 3) if area else None,
                "lat": lat, "lon": lon, "voivodeship": voiv or "", "geo_id": gid,
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
        powiat_coverage,
        city_coverage,
        coverage_funnel,
        by_dimension,
        gmina_leaders,
        voivodeship_density,
    ]
)
