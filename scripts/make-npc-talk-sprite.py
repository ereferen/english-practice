#!/usr/bin/env python3
"""Generate the PoC NPC talk sprite sheet for issue #85.

2-frame bust (24x24 each, 48x24 sheet): closed mouth / open mouth.
Drawn from the approved nightfall palette (docs/art/sprite-prompt.md)
so it passes scripts/validate-sprite.py --frames 2. This is the
placeholder until the AI-generated production asset arrives; the
generation prompt for that is defined in docs/art/sprite-prompt.md.

Usage: python3 scripts/make-npc-talk-sprite.py > src/assets/npc-talk-sheet.png
(or --out PATH)
"""

from __future__ import annotations

import argparse
import sys

# Palette (same 10-color contract as the traveler sheet)
K = (0x05, 0x08, 0x10)  # outline
N = (0x1B, 0x27, 0x40)  # coat body
n = (0x14, 0x1D, 0x31)  # coat shadow
b = (0x2A, 0x3B, 0x5C)  # coat lit
B = (0x31, 0x41, 0x5F)  # rim light
l = (0x5B, 0x51, 0x48)  # leather
g = (0x8A, 0x72, 0x33)  # brass
y = (0xE8, 0xC5, 0x6B)  # lantern glow
s = (0xF5, 0xEA, 0xD1)  # skin / highlight
T = (0, 0, 0, 0)  # transparent

W = H = 24
INK = (0, 0, 0, 255)


def base_bust() -> list:
    """Rows of the shared bust (head + shoulders), mouth row left blank."""
    grid = [[T] * W for _ in range(H)]

    def put(x: int, y0: int, c) -> None:
        grid[y0][x] = c

    def fill(x0: int, y0: int, x1: int, y1: int, c) -> None:
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                grid[yy][xx] = c

    # hair / head top outline
    fill(8, 2, 15, 3, K)
    # face rows 4..12
    fill(7, 4, 16, 4, K)  # forehead outline
    for yy in range(5, 12):
        put(7, yy, K)
        put(16, yy, K)
        fill(8, yy, 15, yy, s)
    fill(8, 12, 15, 12, K)  # chin outline
    # rim light along the right cheek
    for yy in range(5, 12):
        put(16, yy, B)
    # eyes
    put(9, 7, K)
    put(10, 7, K)
    put(13, 7, K)
    put(14, 7, K)
    # brows
    put(9, 6, n)
    put(10, 6, n)
    put(13, 6, n)
    put(14, 6, n)
    # neck
    fill(10, 13, 13, 13, l)
    # shoulders / coat with collar + brass clasp
    fill(4, 15, 19, 15, K)
    fill(3, 16, 20, 21, K)
    fill(4, 16, 19, 20, N)
    fill(5, 16, 8, 20, n)  # shadow side
    fill(15, 16, 18, 20, b)  # lit side
    put(19, 16, B)
    put(19, 17, B)
    put(19, 18, B)
    put(11, 17, g)  # clasp
    put(12, 17, y)  # tiny lantern glow at the chest
    return grid


def render_frame(mouth_open: bool) -> list:
    grid = base_bust()
    if mouth_open:
        # open: 4x2 dark cavity with a warm interior
        for xx in range(10, 14):
            grid[10][xx] = K
        grid[10][11] = n
        grid[10][12] = n
    else:
        # closed: 1px mouth line
        for xx in range(10, 14):
            grid[10][xx] = n
        grid[10][11] = K
        grid[10][12] = K
    return grid


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=None, help="output PNG (default: stdout)")
    args = ap.parse_args()

    try:
        from PIL import Image
    except ImportError:
        print("FAIL: Pillow is required (pip install pillow)", file=sys.stderr)
        return 1

    sheet = Image.new("RGBA", (W * 2, H), T)
    for i, open_mouth in enumerate((False, True)):
        grid = render_frame(open_mouth)
        for yy in range(H):
            for xx in range(W):
                c = grid[yy][xx]
                sheet.putpixel((i * W + xx, yy), c if c != T else (0, 0, 0, 0))

    if args.out:
        sheet.save(args.out)
        print(f"wrote {args.out} ({sheet.size[0]}x{sheet.size[1]})")
    else:
        sheet.save(sys.stdout.buffer, format="PNG")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
