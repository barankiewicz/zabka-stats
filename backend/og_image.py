"""
Per-fact Open Graph preview images for /fakt/<slug> (see backend/api/fact_pages.py).

Rendered once per process (facts only change as often as the daily ETL, which
restarts the backend anyway - see CLAUDE.md). Fonts are vendored locally under
assets/fonts/ since Pillow needs a file on disk (the site itself only loads
fonts from the Google Fonts CDN). Both are variable fonts, so a named weight
instance is pinned via set_variation_by_name() instead of shipping one file
per weight.
"""

import io
import pathlib

from PIL import Image, ImageDraw, ImageFont

_FONTS_DIR = pathlib.Path(__file__).parent / "assets" / "fonts"

WIDTH, HEIGHT = 1200, 630

BG = "#0a120a"
GREEN_BRIGHT = "#a6e84a"
GREEN = "#84c341"
MUTED = "#93a487"
INK = "#e8f0e0"


def _font(name: str, size: int, variation: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(_FONTS_DIR / name), size)
    f.set_variation_by_name(variation)
    return f


def render_fact_card(kicker: str, value: str, subtitle: str, footer: str) -> bytes:
    """Draw a 1200x630 dark-theme stat card and return it as PNG bytes."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    # A faint green vignette in the corner - a nod to the hero particle glow
    # without loading a real particle sim for a one-shot render.
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((WIDTH - 520, -260, WIDTH + 260, 480), fill=(132, 195, 65, 26))
    img.paste(Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB"), (0, 0))
    draw = ImageDraw.Draw(img)

    margin = 80
    kicker_font = _font("IBMPlexSans.ttf", 34, "SemiBold")
    value_font = _font("IBMPlexSans.ttf", 128, "Bold")
    subtitle_font = _font("IBMPlexSans.ttf", 40, "Regular")
    footer_font = _font("JetBrainsMono.ttf", 26, "Medium")
    brand_font = _font("IBMPlexSans.ttf", 30, "SemiBold")

    draw.ellipse((margin, 96, margin + 16, 112), fill=GREEN)
    draw.text((margin + 30, 84), "ŻABKOZBIÓR", font=brand_font, fill=GREEN)

    draw.text((margin, 190), kicker.upper(), font=kicker_font, fill=MUTED)
    draw.text((margin, 235), value, font=value_font, fill=GREEN_BRIGHT)

    value_bbox = draw.textbbox((margin, 235), value, font=value_font)
    subtitle_y = value_bbox[3] + 28
    draw.text((margin, subtitle_y), subtitle, font=subtitle_font, fill=INK)

    draw.text((margin, HEIGHT - 70), footer, font=footer_font, fill=MUTED)
    site_label = "zabkozbior.barankiewicz.dev"
    site_bbox = draw.textbbox((0, 0), site_label, font=footer_font)
    site_w = site_bbox[2] - site_bbox[0]
    draw.text((WIDTH - margin - site_w, HEIGHT - 70), site_label, font=footer_font, fill=MUTED)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
