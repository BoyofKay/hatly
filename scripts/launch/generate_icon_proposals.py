#!/usr/bin/env python3
"""Generates REVIEWABLE launcher-icon proposals from the existing customer artwork. It never touches an app: output goes to
docs/launch/store/icons/ and `apply_icon_proposal.sh` (same folder) copies it into an app only when the owner approves.

Why: the shipped customer icon is a rounded orange tile on a WHITE square. iOS applies its own rounded mask and Android adaptive icons
crop to a shape, so users see a small tile inside a white frame. Both stores want a full-bleed square. The driver app still ships the stock
Flutter icon. Needs only Pillow (no numpy).

  customer-fixed : the same artwork, tile enlarged to full bleed (white corners filled with the tile's own gradient)
  driver         : the same mark with the palette inverted (dark tile, orange mark) so the two apps are told apart on a home screen
"""
import json, os, sys
from collections import deque
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'apps/customer-app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png')
OUT = os.path.join(ROOT, 'docs/launch/store/icons')
IOS_SET = os.path.join(ROOT, 'apps/customer-app/ios/Runner/Assets.xcassets/AppIcon.appiconset')
RES = os.path.join(ROOT, 'apps/customer-app/android/app/src/main/res')
DARK = (24, 28, 38)
ORANGE = (255, 106, 0)


def tile_bbox(img):
    """Bounding box of the orange tile: pixels that are clearly not white (blue channel low)."""
    px = img.load(); w, h = img.size
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y][:3]
            if r > 200 and b < 90:
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def corner_radius(tile):
    """The tile's corner radius: on the very first row only the straight top edge is orange, so the first orange x is the radius."""
    px = tile.load(); w, _ = tile.size
    for x in range(w):
        r, g, b = px[x, 0][:3]
        if r > 200 and b < 120:
            return x + 2
    return int(.2 * w)


def corner_samples(tile, radius):
    w, h = tile.size; px = tile.load(); k = radius
    pts = {'tl': (k, k), 'tr': (w - 1 - k, k), 'bl': (k, h - 1 - k), 'br': (w - 1 - k, h - 1 - k)}
    return {n: px[x, y][:3] for n, (x, y) in pts.items()}


def bilinear(samples, u, v):
    return tuple(round((samples['tl'][i] * (1 - u) + samples['tr'][i] * u) * (1 - v) + (samples['bl'][i] * (1 - u) + samples['br'][i] * u) * v) for i in range(3))


def fill_corners(tile):
    """Replace ONLY the geometric outside of the rounded corners (never any white inside the tile - the H and the road are white too)
    with the tile's own gradient, sampled bilinearly from four points just inside the corners."""
    w, h = tile.size; r = corner_radius(tile); samples = corner_samples(tile, r)
    out = tile.copy(); op = out.load(); mask = Image.new('L', tile.size, 0); mp = mask.load()
    for (cx, cy, x0, y0) in ((r, r, 0, 0), (w - 1 - r, r, w - r, 0), (r, h - 1 - r, 0, h - r), (w - 1 - r, h - 1 - r, w - r, h - r)):
        for y in range(y0, y0 + r):
            for x in range(x0, x0 + r):
                if (x - cx) ** 2 + (y - cy) ** 2 > (r - 1) ** 2:
                    op[x, y] = bilinear(samples, x / (w - 1), y / (h - 1)); mp[x, y] = 255
    blurred = out.filter(ImageFilter.GaussianBlur(1.5))
    return Image.composite(blurred, out, mask.filter(ImageFilter.MaxFilter(5)))


def background_gradient(full, size=432):
    """Adaptive-icon background layer: the same gradient as the art, so the foreground blends in without a visible seam."""
    r = corner_radius(full); s = corner_samples(full, int(full.width * .12))
    g = Image.new('RGB', (size, size)); gp = g.load()
    for y in range(size):
        for x in range(size):
            gp[x, y] = bilinear(s, x / (size - 1), y / (size - 1))
    return g


def inverted(img):
    """Dark tile, orange mark: the original's blue channel is ~0 on orange and ~255 on white, so it is a clean mask."""
    mask = img.split()[2]
    return Image.composite(Image.new('RGB', img.size, ORANGE), Image.new('RGB', img.size, DARK), mask)


def rounded(img, radius_frac=0.2237):
    m = Image.new('L', img.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius=int(img.width * radius_frac), fill=255)
    out = img.convert('RGBA'); out.putalpha(m); return out


def adaptive_foreground(full, size=432, scale=0.52):
    """Art scaled into the adaptive-icon safe zone, edge-feathered so it blends into the solid background layer."""
    art = full.resize((int(size * scale), int(size * scale)), Image.LANCZOS).convert('RGBA')
    feather = Image.new('L', art.size, 0); ImageDraw.Draw(feather).rectangle((6, 6, art.width - 7, art.height - 7), fill=255)
    art.putalpha(feather.filter(ImageFilter.GaussianBlur(5)))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0)); canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return canvas


def write_sets(name, full, bg_hex):
    base = os.path.join(OUT, name); ios = os.path.join(base, 'ios/AppIcon.appiconset'); os.makedirs(ios, exist_ok=True)
    full = full.convert('RGB').resize((1024, 1024), Image.LANCZOS)
    full.save(os.path.join(base, 'store-icon-1024.png'))  # App Store / Play listing icon (Play wants 512; resized below)
    full.resize((512, 512), Image.LANCZOS).save(os.path.join(base, 'play-store-icon-512.png'))
    for f in os.listdir(IOS_SET):
        if f.endswith('.png'):
            side = Image.open(os.path.join(IOS_SET, f)).width
            full.resize((side, side), Image.LANCZOS).save(os.path.join(ios, f), optimize=True)  # RGB: no alpha, as the App Store requires
    with open(os.path.join(ios, 'Contents.json'), 'w') as fh: fh.write(open(os.path.join(IOS_SET, 'Contents.json')).read())
    for dens, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        d = os.path.join(base, f'android/mipmap-{dens}'); os.makedirs(d, exist_ok=True)
        rounded(full.resize((px, px), Image.LANCZOS)).save(os.path.join(d, 'ic_launcher.png'), optimize=True)
        adaptive_foreground(full, size=round(px * 108 / 48)).save(os.path.join(d, 'ic_launcher_foreground.png'), optimize=True)
        background_gradient(full, size=round(px * 108 / 48)).save(os.path.join(d, 'ic_launcher_background.png'), optimize=True)
    anydpi = os.path.join(base, 'android/mipmap-anydpi-v26'); os.makedirs(anydpi, exist_ok=True)
    with open(os.path.join(anydpi, 'ic_launcher.xml'), 'w') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                 '    <background android:drawable="@mipmap/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n')
    # one preview sheet: iOS-masked, Android circle, Android squircle-ish
    sheet = Image.new('RGB', (3 * 300, 300), (225, 225, 225)); r = rounded(full.resize((256, 256), Image.LANCZOS), 0.2237); sheet.paste(r, (22, 22), r)
    circ = Image.new('L', (256, 256), 0); ImageDraw.Draw(circ).ellipse((0, 0, 255, 255), fill=255)
    bgimg = background_gradient(full, 432); fg = adaptive_foreground(full, 432); bgimg.paste(fg, (0, 0), fg)
    a = bgimg.crop((72, 72, 360, 360)).resize((256, 256), Image.LANCZOS)
    sheet.paste(a, (322, 22), circ); sq = rounded(a, 0.3); sheet.paste(sq, (622, 22), sq)
    sheet.save(os.path.join(base, 'preview.png'))


def main():
    src = Image.open(SRC).convert('RGB')
    x0, y0, x1, y1 = tile_bbox(src)
    side = min(x1 - x0, y1 - y0)
    tile = src.crop((x0, y0, x0 + side, y0 + side))
    full = fill_corners(tile)
    write_sets('customer-fixed', full, '#FF6B00')
    write_sets('driver', inverted(full), '#181C26')
    print('tile bbox', (x0, y0, x1, y1), '-> outputs in', OUT)


if __name__ == '__main__':
    main()
