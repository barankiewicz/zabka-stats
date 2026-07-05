"""
Generates frontend/public/og.png and og-en.png - the homepage social-preview images.
Layout: a big active-store count headline (e.g. 13 000+) plus a secondary KPI for
the national per-capita density (Żabki / 1000 mieszk., the same figure GRAN's
national reference line draws on), over the Powiaty choropleth map coloured by
per_1k.

Usage: python data/tools/generate_og_image.py
"""

import json
import math
import os
import sys

# Ensure backend package can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import duckdb
from PIL import Image, ImageDraw, ImageFont

from backend.api.demographics import get_voiv_population
from backend.api.geo_router import _build_pow_econ_geo

WIDTH, HEIGHT = 1200, 630
SS = 2  # supersample factor: draw at 2x, downsample at the end for antialiasing

BG = "#0a120a"
GREEN = "#84c341"
GREEN_BRIGHT = "#a6e84a"
MUTED = "#93a487"
INK = "#e8f0e0"

DB_PATH = os.environ.get("ZABKA_DB", "data/zabka.duckdb")
FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "assets", "fonts")
OUT_PATH_PL = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "og.png")
OUT_PATH_EN = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "og-en.png")

GRAN_RAMP_STOPS = ['#233d1a', '#3b5f24', '#54802e', '#6ca237', '#84c341']


def _font(name: str, size: int, variation: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(os.path.join(FONTS_DIR, name), size)
    f.set_variation_by_name(variation)
    return f


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def interpolate_color(t: float) -> tuple:
    t = max(0.0, min(1.0, t))
    seg = t * (len(GRAN_RAMP_STOPS) - 1)
    i = min(len(GRAN_RAMP_STOPS) - 2, int(seg))
    u = seg - i
    a = _hex_to_rgb(GRAN_RAMP_STOPS[i])
    b = _hex_to_rgb(GRAN_RAMP_STOPS[i + 1])
    r = int(round(a[0] + (b[0] - a[0]) * u))
    g = int(round(a[1] + (b[1] - a[1]) * u))
    b_val = int(round(a[2] + (b[2] - a[2]) * u))
    return (r, g, b_val)


def fetch_points() -> tuple:
    con = duckdb.connect(DB_PATH, read_only=True)
    total = con.execute("SELECT count(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    con.close()
    return total


def fetch_per_1k(total: int) -> float:
    """National per-capita density - Żabki per 1000 residents.

    Same correction as the /stats/gmina-leaders endpoint: sum the
    v_voiv_pop_eff populations (which fold cities with powiat rights back
    into their host land powiat) instead of the raw dim_voivodeship column,
    so the denominator isn't ~10% short.
    """
    names = [
        "mazowieckie", "śląskie", "dolnośląskie", "wielkopolskie",
        "małopolskie", "pomorskie", "łódzkie", "zachodniopomorskie",
        "kujawsko-pomorskie", "lubelskie", "podkarpackie",
        "warmińsko-mazurskie", "lubuskie", "świętokrzyskie",
        "opolskie", "podlaskie",
    ]
    nat_pop = sum(get_voiv_population(n) for n in names)
    return round(total * 1000.0 / nat_pop, 3) if nat_pop else 0.0


def render_powiaty_map(geojson_data: dict, box: tuple) -> Image.Image:
    """Render a powiaty choropleth map of Poland, colored by per_1k,
    fit inside `box` = (x0, y0, x1, y1) in 1x canvas coordinates, preserving aspect ratio."""
    features = geojson_data.get("features", [])

    # 1. Collect all coordinates to compute global bounding box of Poland
    lons = []
    lats = []
    for f in features:
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []
        if gtype == "Polygon":
            for ring in coords:
                for lon, lat in ring:
                    lons.append(lon)
                    lats.append(lat)
        elif gtype == "MultiPolygon":
            for poly in coords:
                for ring in poly:
                    for lon, lat in ring:
                        lons.append(lon)
                        lats.append(lat)

    if not lons or not lats:
        lon_min, lon_max, lat_min, lat_max = 14.07, 24.15, 49.00, 54.84
    else:
        lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)

    # 2. Compute scale and origin using the projection logic
    x0, y0, x1, y1 = [v * SS for v in box]
    box_w, box_h = x1 - x0, y1 - y0

    mean_lat_rad = math.radians((lat_min + lat_max) / 2)
    lon_correction = math.cos(mean_lat_rad)

    width_units = (lon_max - lon_min) * lon_correction
    height_units = lat_max - lat_min

    scale_by_height = box_h / height_units
    scale_by_width = box_w / (width_units if width_units else 1)
    scale_y = min(scale_by_height, scale_by_width)
    scale_x = scale_y * lon_correction

    plot_w = (lon_max - lon_min) * scale_x
    plot_h = (lat_max - lat_min) * scale_y
    origin_x = x0 + (box_w - plot_w) / 2
    origin_y = y0 + (box_h - plot_h) / 2

    # 3. Create transparency layer for drawing
    map_layer = Image.new("RGBA", (WIDTH * SS, HEIGHT * SS), (0, 0, 0, 0))
    map_draw = ImageDraw.Draw(map_layer)

    # 4. Extract values to normalize per_1k
    vals = []
    for f in features:
        v = f.get("properties", {}).get("per_1k")
        if v is not None:
            vals.append(v)
    vmin = min(vals) if vals else 0.0
    vmax = max(vals) if vals else 1.0
    if vmax <= vmin:
        vmax = vmin + 0.001

    # 5. Draw each powiat
    outline_color = _hex_to_rgb("#08110a") + (255,)

    for f in features:
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []

        v = f.get("properties", {}).get("per_1k")
        if v is None:
            v = 0.0

        t = (v - vmin) / (vmax - vmin)
        color = interpolate_color(t)
        fill_color = color + (int(0.86 * 255),)  # 86% opacity

        polygons = []
        if gtype == "Polygon":
            polygons = coords
        elif gtype == "MultiPolygon":
            for poly in coords:
                polygons.extend(poly)

        for ring in polygons:
            xy = []
            for lon, lat in ring:
                px = origin_x + (lon - lon_min) * scale_x
                py = origin_y + (lat_max - lat) * scale_y
                xy.append((px, py))
            if len(xy) >= 3:
                # Fill the polygon
                map_draw.polygon(xy, fill=fill_color, outline=None)
                # Draw the outline with thickness 1.5 * SS (3 pixels)
                map_draw.line(xy + [xy[0]], fill=outline_color, width=int(1.5 * SS))

    return map_layer


def horizontal_scrim(fade_start: int, fade_end: int) -> Image.Image:
    """Opaque BG on the left fading to fully transparent by fade_end, so the
    map stays visible on the right while text stays legible on the left."""
    w, h = WIDTH * SS, HEIGHT * SS
    fade_start *= SS
    fade_end *= SS
    row = []
    for x in range(w):
        if x <= fade_start:
            a = 255
        elif x >= fade_end:
            a = 0
        else:
            a = int(255 * (1 - (x - fade_start) / (fade_end - fade_start)))
        row.append(a)
    alpha = Image.new("L", (w, 1))
    alpha.putdata(row)
    alpha = alpha.resize((w, h))
    scrim = Image.new("RGBA", (w, h), _hex_to_rgb(BG) + (0,))
    scrim.putalpha(alpha)
    return scrim


def build(total_count: int, per_1k: float, geojson_data: dict, lang: str = "pl") -> Image.Image:
    img = Image.new("RGBA", (WIDTH * SS, HEIGHT * SS), BG)

    powiaty_map = render_powiaty_map(geojson_data, box=(560, 20, 1160, 610))
    img = Image.alpha_composite(img, powiaty_map)
    img = Image.alpha_composite(img, horizontal_scrim(fade_start=560, fade_end=920))

    draw = ImageDraw.Draw(img)
    m = 80 * SS

    brand_font = _font("IBMPlexSans.ttf", 30 * SS, "SemiBold")
    kicker_font = _font("IBMPlexSans.ttf", 28 * SS, "SemiBold")
    value_font = _font("IBMPlexSans.ttf", 100 * SS, "Bold")
    subtitle_font = _font("IBMPlexSans.ttf", 32 * SS, "Regular")
    kpi_value_font = _font("IBMPlexSans.ttf", 64 * SS, "Bold")
    kpi_label_font = _font("IBMPlexSans.ttf", 24 * SS, "SemiBold")
    kpi_sub_font = _font("IBMPlexSans.ttf", 20 * SS, "Regular")
    tagline_font = _font("IBMPlexSans.ttf", 22 * SS, "Regular")
    footer_font = _font("JetBrainsMono.ttf", 24 * SS, "Medium")

    if lang == "en":
        brand_text = "ZABKOZBIOR"
        kicker_text = "ZABKA IN NUMBERS"
        subtitle_text = "active stores in Poland"
        kpi_value = f"{per_1k:.2f}"
        kpi_label = "stores per 1000 residents"
        kpi_sub = "national network density (GUS)"
        tagline_text = "Maps, rankings, trivia - public data."
    else:
        brand_text = "ŻABKOZBIÓR"
        kicker_text = "ŻABKA W LICZBACH"
        subtitle_text = "aktywnych sklepów w Polsce"
        kpi_value = f"{per_1k:.2f}".replace(".", ",")
        kpi_label = "Żabki na 1000 mieszkańców"
        kpi_sub = "gęstość sieci w Polsce (GUS)"
        tagline_text = "Mapy, rankingi, ciekawostki - dane publiczne."

    # Draw Brand header
    draw.ellipse((m, 96 * SS, m + 16 * SS, 112 * SS), fill=GREEN)
    draw.text((m + 30 * SS, 84 * SS), brand_text, font=brand_font, fill=GREEN)

    # Draw Kicker
    kicker_y = 160 * SS
    draw.text((m, kicker_y), kicker_text, font=kicker_font, fill=MUTED)

    # Draw Value (Count)
    value = f"{total_count // 1000} 000+"
    value_y = kicker_y + 38 * SS
    draw.text((m, value_y), value, font=value_font, fill=GREEN_BRIGHT)
    value_bbox = draw.textbbox((m, value_y), value, font=value_font)

    # Draw Subtitle
    subtitle_y = value_bbox[3] + 10 * SS
    draw.text((m, subtitle_y), subtitle_text, font=subtitle_font, fill=INK)

    # Draw horizontal separator line
    line_y = subtitle_y + 50 * SS
    draw.line((m, line_y, m + 400 * SS, line_y), fill=(*_hex_to_rgb(GREEN), 90), width=int(2 * SS))

    # Secondary KPI: per-capita density (the GRAN national reference figure)
    kpi_y = line_y + 26 * SS
    # vertical accent bar to mark the secondary stat
    draw.rectangle((m, kpi_y + 4 * SS, m + 6 * SS, kpi_y + 64 * SS), fill=GREEN_BRIGHT)
    kpi_text_x = m + 26 * SS
    draw.text((kpi_text_x, kpi_y - 4 * SS), kpi_value, font=kpi_value_font, fill=GREEN_BRIGHT)
    kpi_bbox = draw.textbbox((kpi_text_x, kpi_y - 4 * SS), kpi_value, font=kpi_value_font)
    label_x = kpi_bbox[2] + 20 * SS
    draw.text((label_x, kpi_y + 6 * SS), kpi_label, font=kpi_label_font, fill=INK)
    draw.text((label_x, kpi_y + 36 * SS), kpi_sub, font=kpi_sub_font, fill=MUTED)

    # Draw Tagline
    tagline_y = kpi_y + 86 * SS
    draw.text((m, tagline_y), tagline_text, font=tagline_font, fill=MUTED)

    # Draw Footer
    footer_y = HEIGHT * SS - 56 * SS
    draw.text((m, footer_y), "zabkozbior.barankiewicz.dev", font=footer_font, fill=MUTED)

    return img.resize((WIDTH, HEIGHT), Image.LANCZOS).convert("RGB")


def main():
    total_count = fetch_points()
    per_1k = fetch_per_1k(total_count)

    # Load GeoJSON data
    geojson_bytes = _build_pow_econ_geo()
    geojson_data = json.loads(geojson_bytes.decode("utf-8"))

    img_pl = build(total_count, per_1k, geojson_data, lang="pl")
    img_pl.save(OUT_PATH_PL, format="PNG")
    print(f"Wrote {OUT_PATH_PL} ({total_count} stores, per_1k={per_1k})")

    img_en = build(total_count, per_1k, geojson_data, lang="en")
    img_en.save(OUT_PATH_EN, format="PNG")
    print(f"Wrote {OUT_PATH_EN} ({total_count} stores, per_1k={per_1k})")


if __name__ == "__main__":
    main()
