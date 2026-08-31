"""Render a white Compass mark + wordmark PNG with a transparent background.

Does not change the splash screen. Output: assets/compass-wordmark-white.png
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "compass-wordmark-white.png"

# Splash proportions: 128px mark, 14px gap, 2rem (32px) Urbanist 300, 0.14em tracking.
MARK_PX = 1600
GAP_RATIO = 14 / 128
FONT_RATIO = 32 / 128
TRACKING_EM = 0.14
PAD_RATIO = 0.16
SS = 2  # supersample, then downscale


def draw_mark(size: int) -> Image.Image:
    """Compass ring + needle from public/compass-logo.svg, in 256 viewBox units."""
    scale = size / 256
    cx = cy = 128 * scale
    ring_r = 84 * scale
    stroke = 10 * scale
    hole_r = 9 * scale
    pts = [
        (177 * scale, 79 * scale),
        (141 * scale, 145 * scale),
        (79 * scale, 177 * scale),
        (115 * scale, 111 * scale),
    ]

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    outer = ring_r + stroke / 2
    inner = ring_r - stroke / 2
    draw.ellipse((cx - outer, cy - outer, cx + outer, cy + outer), fill=255)
    draw.ellipse((cx - inner, cy - inner, cx + inner, cy + inner), fill=0)
    draw.polygon(pts, fill=255)
    draw.ellipse((cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r), fill=0)

    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark.paste((255, 255, 255, 255), (0, 0), mask)
    return mark


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(path), size=size)
    if hasattr(font, "set_variation_by_axes"):
        try:
            font.set_variation_by_axes([300])
        except OSError:
            pass
    return font


def text_size(font: ImageFont.FreeTypeFont, text: str, tracking: float) -> tuple[float, float]:
    widths = [font.getlength(ch) for ch in text]
    width = sum(widths) + tracking * max(len(text) - 1, 0)
    bbox = font.getbbox(text)
    height = bbox[3] - bbox[1]
    return width, height


def draw_tracked(
    canvas: Image.Image,
    font: ImageFont.FreeTypeFont,
    text: str,
    origin: tuple[float, float],
    tracking: float,
) -> None:
    draw = ImageDraw.Draw(canvas)
    x, y = origin
    for index, ch in enumerate(text):
        draw.text((x, y), ch, font=font, fill=(255, 255, 255, 255))
        x += font.getlength(ch)
        if index < len(text) - 1:
            x += tracking


def render(font_path: Path) -> Image.Image:
    mark_hi = MARK_PX * SS
    mark = draw_mark(mark_hi)
    gap = int(round(mark_hi * GAP_RATIO))
    font_size = int(round(mark_hi * FONT_RATIO))
    font = load_font(font_path, font_size)
    tracking = TRACKING_EM * font_size
    text = "Compass"
    text_w, text_h = text_size(font, text, tracking)
    bbox = font.getbbox(text)
    pad = int(round(mark_hi * PAD_RATIO))

    width = int(max(mark_hi, text_w) + pad * 2)
    height = int(pad + mark_hi + gap + text_h + pad)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.paste(mark, ((width - mark_hi) // 2, pad), mark)
    text_x = (width - text_w) / 2
    text_y = pad + mark_hi + gap - bbox[1]
    draw_tracked(canvas, font, text, (text_x, text_y), tracking)
    return canvas.resize((width // SS, height // SS), Image.Resampling.LANCZOS)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: make-wordmark.py /path/to/Urbanist.ttf")
    font_path = Path(sys.argv[1])
    if not font_path.is_file():
        raise SystemExit(f"font not found: {font_path}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image = render(font_path)
    image.save(OUT, "PNG")
    print(f"wrote {OUT} ({image.size[0]}x{image.size[1]}, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
