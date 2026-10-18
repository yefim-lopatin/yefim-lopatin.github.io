"""Build Dice-Regular.woff2 from the existing board dice and V5 outlines.

Run in a venv with fonttools, brotli, svgpathtools and shapely installed.
Digits are derived from Assistant (SIL OFL 1.1); see the adjacent OFL.txt.
"""
import json
import math
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from shapely import affinity
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from svgpathtools import parse_path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages/excalidraw/fonts/Dice"
source = TTFont(ROOT / "public/Assistant-Regular.woff2")
source_glyphs = source.getGlyphSet()
source_map = source.getBestCmap()
source_units = source["head"].unitsPerEm
board_source = (ROOT / "excalidraw-app/components/BoardDice.ts").read_text()
board_object = board_source.split("export const BOARD_DICE = ", 1)[1].split(" as const;", 1)[0]
board = json.loads(subprocess.check_output(
    ["node", "-e", "process.stdout.write(JSON.stringify((" + board_object + ")))"],
    text=True,
))
SIDES = [2, 4, 6, 8, 10, 12, 20, 100]
SCALE = 16


def path_lines(path):
    for subpath in parse_path(path).continuous_subpaths():
        points = []
        for segment in subpath:
            steps = 1 if segment.__class__.__name__ == "Line" else max(4, min(500, math.ceil(segment.length() / .3)))
            points.extend((segment.point(i / steps).real, segment.point(i / steps).imag) for i in range(steps))
        points.append((subpath[-1].end.real, subpath[-1].end.imag))
        yield points


def stroke(path, width):
    return unary_union([LineString(points).buffer(width / 2, cap_style=1, join_style=1)
                       for points in path_lines(path)])


def contour(sides):
    if sides == 2:
        points = [(32 + 28 * math.cos(i * math.tau / 180), 32 + 28 * math.sin(i * math.tau / 180)) for i in range(181)]
        return LineString(points).buffer(1), 32, 33
    die = board[str(sides)]
    return unary_union([stroke(die["outline"], 2), stroke(die["facets"], 1.25)]), die["x"], die["y"]


def draw_geometry(pen, geometry):
    if geometry.is_empty:
        return
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    for polygon in polygons:
        if polygon.geom_type != "Polygon":
            continue
        # The SVG-to-font Y flip reverses winding.
        polygon = orient(polygon, sign=1)
        for ring in [polygon.exterior, *polygon.interiors]:
            points = list(ring.coords)[:-1]
            pen.moveTo((round(points[0][0] * SCALE), round((64 - points[0][1]) * SCALE)))
            for x, y in points[1:]:
                pen.lineTo((round(x * SCALE), round((64 - y) * SCALE)))
            pen.closePath()


def number(pen, value, x, y, size):
    text = str(value)
    names = [source_map[ord(c)] for c in text]
    scale = size * SCALE / source_units
    width = sum(source["hmtx"][name][0] for name in names)
    bounds = BoundsPen(source_glyphs)
    cursor = 0
    for name in names:
        source_glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, cursor, 0)))
        cursor += source["hmtx"][name][0]
    _, bottom, _, top = bounds.bounds
    tx = x * SCALE - width * scale / 2
    ty = (64 - y) * SCALE - (top + bottom) * scale / 2
    cursor = 0
    for name in names:
        source_glyphs[name].draw(TransformPen(pen, (scale, 0, 0, scale, tx + cursor * scale, ty)))
        cursor += source["hmtx"][name][0]
    return box(x - width * scale / SCALE / 2 - 1, y - size / 2 - 1,
               x + width * scale / SCALE / 2 + 1, y + size / 2 + 1)


def regular(sides, result):
    pen = TTGlyphPen(None)
    if sides == 100:
        geometry, x, y = contour(10)
        for offset, value in [(0, "00" if result == 100 else str(result // 10 * 10).zfill(2)),
                              (58, 0 if result == 100 else result % 10)]:
            shape = affinity.translate(affinity.scale(geometry, .9, .9, origin=(0, 0)), xoff=offset)
            text_pen = TTGlyphPen(None)
            clear = number(text_pen, value, x * .9 + offset, y * .9, 17 * .9)
            draw_geometry(pen, shape.difference(clear))
            text_pen.glyph().draw(pen, None)
        return pen.glyph(), 1856
    geometry, x, y = contour(sides)
    text_pen = TTGlyphPen(None)
    clear = number(text_pen, result, x, y, 14 if sides == 6 else 17)
    draw_geometry(pen, geometry.difference(clear))
    text_pen.glyph().draw(pen, None)
    return pen.glyph(), 1024


def v5(symbol):
    pen = TTGlyphPen(None)
    shape, _, _ = contour(10)
    draw_geometry(pen, shape)
    svg = ET.parse(ROOT / f"excalidraw-app/components/v5-symbols/{symbol}.svg").getroot()
    _, _, width, height = map(float, svg.attrib["viewBox"].split())
    scale = min(16 / width, 12 / height)
    for node in svg.iter():
        if node.tag.endswith("path"):
            filled = Polygon()
            for points in path_lines(node.attrib["d"]):
                filled = filled.symmetric_difference(Polygon(points).buffer(0))
            filled = affinity.scale(filled, scale, scale, origin=(0, 0))
            draw_geometry(pen, affinity.translate(filled, xoff=32 - width * scale / 2, yoff=27 - height * scale / 2))
    return pen.glyph(), 1024


glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
metrics = {".notdef": (1024, 0), "space": (192, 0)}
cmap = {32: "space"}
for kind, sides in enumerate(SIDES):
    for result in range(1, sides + 1):
        name = f"d{sides}_{result}"
        glyph, width = regular(sides, result)
        glyphs[name] = glyph
        metrics[name] = (width, 0)
        cmap[0xE000 + kind * 128 + result - 1] = name
for index, symbol in enumerate(["black-dot", "black-success", "black-triumph", "red-dot", "red-success", "red-triumph", "red-unluck"]):
    glyphs[symbol], width = v5(symbol)
    metrics[symbol] = (width, 0)
    cmap[0xE400 + index] = symbol

copyright_text = next(n.toUnicode() for n in source["name"].names if n.nameID == 0)
license_source = (ROOT / "site/vtm/assets/fonts/Manrope-OFL.txt").read_text()
license_text = copyright_text + "\n\n" + license_source[license_source.index("SIL OPEN FONT LICENSE"):]
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "OFL.txt").write_text(license_text)
font = FontBuilder(1024, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap(cmap)
font.setupGlyf(glyphs)
font.setupHorizontalMetrics(metrics)
font.setupHorizontalHeader(ascent=1024, descent=0)
font.setupNameTable({"familyName": "Dice", "styleName": "Regular", "uniqueFontIdentifier": "Dice-Regular-1.0",
                     "fullName": "Dice Regular", "psName": "Dice-Regular", "version": "Version 1.0",
                     "copyright": copyright_text, "licenseDescription": license_text,
                     "licenseInfoURL": "https://openfontlicense.org"})
font.setupOS2(sTypoAscender=1024, sTypoDescender=0, usWinAscent=1024, usWinDescent=0)
font.setupPost()
font.font.flavor = "woff2"
font.save(OUT / "Dice-Regular.woff2")
print(f"Generated {len(cmap)} characters, {(OUT / 'Dice-Regular.woff2').stat().st_size} bytes")
