"""
Generates frontend/public/og.png - the homepage social-preview image (S6 of the
shareability roadmap: "your strongest single visual, the glowing dot map, plus
ONE number, dark theme so it pops in feeds").

A one-off build tool, not part of the ETL or request path: og.png is a static
file Vite copies into dist/ as-is (unlike the per-fact /fakt/<slug>/og.png
cards, which backend/og_image.py renders live per request). Re-run by hand
whenever the store count or the brand visuals change meaningfully - it does
not need to track the daily ETL.

Usage: python data/tools/generate_og_image.py
"""

import math
import os

import duckdb
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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


def _font(name: str, size: int, variation: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(os.path.join(FONTS_DIR, name), size)
    f.set_variation_by_name(variation)
    return f


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def fetch_points() -> tuple:
    con = duckdb.connect(DB_PATH, read_only=True)
    total = con.execute("SELECT count(*) FROM locations WHERE deleted_at IS NULL").fetchone()[0]
    rows = con.execute(
        "SELECT latitude, longitude FROM locations WHERE deleted_at IS NULL"
    ).fetchall()
    con.close()
    return total, rows


def render_dot_map(points: list, box: tuple) -> Image.Image:
    """Render a glowing green dot map of the given (lat, lon) points, fit inside
    `box` = (x0, y0, x1, y1) in 1x canvas coordinates, preserving Poland's real
    aspect ratio (longitude degrees are compressed by cos(latitude))."""
    x0, y0, x1, y1 = [v * SS for v in box]
    box_w, box_h = x1 - x0, y1 - y0

    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)
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

    dots = Image.new("L", (WIDTH * SS, HEIGHT * SS), 0)
    draw = ImageDraw.Draw(dots)
    r = 1.5 * SS
    for lat, lon in points:
        px = origin_x + (lon - lon_min) * scale_x
        py = origin_y + (lat_max - lat) * scale_y
        draw.ellipse((px - r, py - r, px + r, py + r), fill=255)

    glow = dots.filter(ImageFilter.GaussianBlur(radius=2.2 * SS))
    core = dots.filter(ImageFilter.GaussianBlur(radius=0.4 * SS))
    from PIL import ImageChops
    intensity = ImageChops.lighter(
        Image.eval(glow, lambda v: min(v, 150)),
        Image.eval(core, lambda v: min(v, 235)),
    )

    color = _hex_to_rgb(GREEN_BRIGHT)
    layer = Image.new("RGBA", (WIDTH * SS, HEIGHT * SS), color + (0,))
    layer.putalpha(intensity)
    return layer


def horizontal_scrim(fade_start: int, fade_end: int) -> Image.Image:
    """Opaque BG on the left fading to fully transparent by fade_end, so the
    dot map stays visible on the right while text stays legible on the left."""
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


def build(total_count: int, points: list, lang: str = "pl") -> Image.Image:
    img = Image.new("RGBA", (WIDTH * SS, HEIGHT * SS), BG)

    dot_map = render_dot_map(points, box=(560, 20, 1160, 610))
    img = Image.alpha_composite(img, dot_map)
    img = Image.alpha_composite(img, horizontal_scrim(fade_start=560, fade_end=920))

    draw = ImageDraw.Draw(img)
    m = 80 * SS

    brand_font = _font("IBMPlexSans.ttf", 30 * SS, "SemiBold")
    kicker_font = _font("IBMPlexSans.ttf", 28 * SS, "SemiBold")
    value_font = _font("IBMPlexSans.ttf", 104 * SS, "Bold")
    subtitle_font = _font("IBMPlexSans.ttf", 32 * SS, "Regular")
    headline_font = _font("IBMPlexSans.ttf", 30 * SS, "SemiBold")
    tagline_font = _font("IBMPlexSans.ttf", 22 * SS, "Regular")
    footer_font = _font("JetBrainsMono.ttf", 24 * SS, "Medium")

    if lang == "en":
        brand_text = "ZABKOZBIOR"
        kicker_text = "ZABKA IN NUMBERS"
        subtitle_text = "active stores in Poland"
        headline_1 = "Żabka is everywhere."
        headline_2 = "We've got the data."
        tagline_text = "Maps, rankings, trivia — public data."
    else:
        brand_text = "ŻABKOZBIÓR"
        kicker_text = "ŻABKA W LICZBACH"
        subtitle_text = "aktywnych sklepów w Polsce"
        headline_1 = "Żabka jest wszędzie."
        headline_2 = "Mamy na to twarde dane."
        tagline_text = "Mapy, rankingi, ciekawostki — dane publiczne."

    draw.ellipse((m, 96 * SS, m + 16 * SS, 112 * SS), fill=GREEN)
    draw.text((m + 30 * SS, 84 * SS), brand_text, font=brand_font, fill=GREEN)

    kicker_y = 168 * SS
    draw.text((m, kicker_y), kicker_text, font=kicker_font, fill=MUTED)

    value = f"{total_count // 1000} 000+"
    value_y = kicker_y + 42 * SS
    draw.text((m, value_y), value, font=value_font, fill=GREEN_BRIGHT)
    value_bbox = draw.textbbox((m, value_y), value, font=value_font)

    subtitle_y = value_bbox[3] + 12 * SS
    draw.text((m, subtitle_y), subtitle_text, font=subtitle_font, fill=INK)

    line_y = subtitle_y + 54 * SS
    draw.line((m, line_y, m + 400 * SS, line_y), fill=(*_hex_to_rgb(GREEN), 90), width=int(2 * SS))

    headline_y = line_y + 34 * SS
    draw.text((m, headline_y), headline_1, font=headline_font, fill=INK)
    draw.text((m, headline_y + 40 * SS), headline_2, font=headline_font, fill=INK)

    tagline_y = headline_y + 40 * SS + 46 * SS
    draw.text((m, tagline_y), tagline_text, font=tagline_font, fill=MUTED)

    footer_y = HEIGHT * SS - 56 * SS
    draw.text((m, footer_y), "zabkozbior.barankiewicz.dev", font=footer_font, fill=MUTED)

    return img.resize((WIDTH, HEIGHT), Image.LANCZOS).convert("RGB")


def main():
    total_count, points = fetch_points()
    img_pl = build(total_count, points, lang="pl")
    img_pl.save(OUT_PATH_PL, format="PNG")
    print(f"Wrote {OUT_PATH_PL} ({total_count} active stores plotted, headline value {total_count // 1000} 000+)")
    
    img_en = build(total_count, points, lang="en")
    img_en.save(OUT_PATH_EN, format="PNG")
    print(f"Wrote {OUT_PATH_EN} ({total_count} active stores plotted, headline value {total_count // 1000} 000+)")


if __name__ == "__main__":
    main()
