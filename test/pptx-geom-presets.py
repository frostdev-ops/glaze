#!/usr/bin/env python3
"""Reproduce lib/pptx-geom.js's PRESETS block; Python standard library only.

Download ECMA-376 Part 1, 5th edition (2016), then extract
OfficeOpenXML-DrawingMLGeometries.zip/presetShapeDefinitions.xml:
https://ecma-international.org/wp-content/uploads/ECMA-376-1_5th_edition_december_2016.zip
XML SHA-256: 2f7c868d857c1e3c4b5a6068759fe0e07d77ad58377a6618d1b02ba3507b6939

python3 test/pptx-geom-presets.py presetShapeDefinitions.xml > presets.js
Compare that block with lib/pptx-geom.js before replacing it. Optional remaining
arguments select presets; '-' reads XML from stdin. Adjust handles and
extrusionOk are intentionally omitted. Formula whitespace is normalized.
upArrow is the one handwritten exception: the addendum's downArrow flipped
vertically, with the path reversed to retain its winding.
"""

import sys
import xml.etree.ElementTree as ET

PRESETS = """rect roundRect ellipse triangle rtTriangle diamond parallelogram trapezoid pentagon
hexagon octagon star5 rightArrow leftArrow upArrow downArrow leftRightArrow chevron homePlate
flowChartProcess flowChartDecision flowChartTerminator wedgeRectCallout wedgeRoundRectCallout
wedgeEllipseCallout cloudCallout line bentConnector3 curvedConnector3 snip1Rect plaque can cube
heart donut noSmoking bracketPair bracePair""".split()
NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
UP_ARROW = """    // The addendum has no upArrow: this is its downArrow turned upside down.
    upArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 100000 h ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        dy2     */ ss a2 100000
        y2      +- t dy2 0
        dx1     */ w a1 200000
        x1      +- hc 0 dx1
        x2      +- hc dx1 0
        dy1     */ x1 dy2 wd2
        y1      +- y2 0 dy1`,
      cxn: `
        3cd4 hc t
        cd2  l y2
        cd4  hc b
        0    r y2`,
      rect: 'x1 y1 x2 b',
      paths: `
        moveTo l y2
        lnTo hc t
        lnTo r y2
        lnTo x2 y2
        lnTo x2 b
        lnTo x1 b
        lnTo x1 y2
        close`,
    },"""


def multiline(key, rows, align=False):
    if not rows:
        return []
    width = max(len(row[0]) for row in rows) if align else 0
    lines = [f"      {key}: `"]
    for row in rows:
        first = row[0].ljust(width) if align else row[0]
        lines.append("        " + first + (" " + " ".join(row[1:]) if len(row) > 1 else ""))
    lines[-1] += "`,"
    return lines


def transcribe(shape):
    lines = [f"    {shape.tag}: {{"]
    adjusts = []
    for g in shape.findall("a:avLst/a:gd", NS):
        op, value = g.attrib["fmla"].split()
        if op != "val":
            raise ValueError("An adjust must be a literal: " + g.attrib["fmla"])
        adjusts.append(f"{g.attrib['name']}: {int(value)}")
    if adjusts:
        lines.append("      av: { " + ", ".join(adjusts) + " },")
    guides = [[g.attrib["name"], *g.attrib["fmla"].split()] for g in shape.findall("a:gdLst/a:gd", NS)]
    lines.extend(multiline("gd", guides, align=True))
    sites = []
    for c in shape.findall("a:cxnLst/a:cxn", NS):
        p = c.find("a:pos", NS).attrib
        sites.append([c.attrib["ang"], p["x"], p["y"]])
    lines.extend(multiline("cxn", sites, align=True))
    rect = shape.find("a:rect", NS)
    if rect is not None:
        lines.append("      rect: '" + " ".join(rect.attrib[k] for k in ["l", "t", "r", "b"]) + "',")
    paths = shape.findall("a:pathLst/a:path", NS)
    commands = []
    for p in paths:
        attrs = [f"{k}={p.attrib[k]}" for k in ["w", "h", "fill", "stroke"] if k in p.attrib]
        header = bool(attrs) or len(paths) > 1
        if header:
            commands.append(["path", *attrs])
        for c in p:
            name = c.tag.split("}")[-1]
            args = []
            if name == "arcTo":
                args = [c.attrib[k] for k in ["wR", "hR", "stAng", "swAng"]]
            elif name != "close":
                args = [v for pt in c.findall("a:pt", NS) for v in [pt.attrib["x"], pt.attrib["y"]]]
            commands.append([("  " if header else "") + name, *args])
    lines.extend(multiline("paths", commands))
    return "\n".join([*lines, "    },"])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = ET.parse(sys.stdin if sys.argv[1] == "-" else sys.argv[1]).getroot()
    definitions = {shape.tag: shape for shape in root}
    names = sys.argv[2:] or PRESETS
    blocks = [UP_ARROW if name == "upArrow" else transcribe(definitions[name]) for name in names]
    print("  const PRESETS = {\n" + "\n".join(blocks) + "\n  };")


if __name__ == "__main__":
    main()
