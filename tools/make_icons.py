#!/usr/bin/env python3
"""Generate the PWA icons in ../icons (needs Pillow).

Magenta square with a white ballot box (the square you mark on the ballot)
containing an X cross. The maskable variant keeps the drawing inside the
central safe zone so launchers can crop it to a circle.

    python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw

MAGENTA = (0xC4, 0x30, 0x6C)
WHITE = (255, 255, 255)
SS = 4  # supersampling factor for smooth edges
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def icon(size, scale):
    """scale = side of the ballot box relative to the icon side."""
    S = size * SS
    im = Image.new('RGB', (S, S), MAGENTA)
    d = ImageDraw.Draw(im)
    side = S * scale
    x0 = (S - side) / 2
    y0 = (S - side) / 2
    stroke = side * 0.11
    d.rectangle([x0, y0, x0 + side, y0 + side], outline=WHITE, width=round(stroke))
    pad = side * 0.24
    w = round(side * 0.13)
    a, b = x0 + pad, x0 + side - pad
    c, e = y0 + pad, y0 + side - pad
    d.line([(a, c), (b, e)], fill=WHITE, width=w)
    d.line([(a, e), (b, c)], fill=WHITE, width=w)
    # round line caps
    r = w / 2
    for (px, py) in [(a, c), (b, e), (a, e), (b, c)]:
        d.ellipse([px - r, py - r, px + r, py + r], fill=WHITE)
    im = im.resize((size, size), Image.LANCZOS)
    # few colours are enough (magenta, white, anti-aliasing) -> small PNG
    return im.quantize(colors=16, method=Image.MEDIANCUT)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (192, 512):
        icon(size, 0.56).save(os.path.join(OUT, f'icon-{size}.png'), optimize=True)
        icon(size, 0.44).save(os.path.join(OUT, f'icon-maskable-{size}.png'), optimize=True)
    icon(180, 0.56).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)


if __name__ == '__main__':
    main()
