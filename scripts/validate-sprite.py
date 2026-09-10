#!/usr/bin/env python3
"""Validate a walk-cycle sprite sheet for issue #85.

Checks the received PNG against the production pipeline contract
(see docs/art/sprite-prompt.md):
  1. exact sheet size: (frame_w * frames) x frame_h
  2. every non-transparent pixel matches the allowed palette EXACTLY
     (no anti-aliasing, no palette drift)
  3. alpha is only 0 or 255 (half-transparent edges are rejected)
  4. each frame has a minimum amount of ink (catches empty/duplicate frames)

Exit code 0 = PASS, 1 = FAIL (each violation is printed).

Usage:
  python3 scripts/validate-sprite.py src/assets/traveler-sheet.png
  python3 scripts/validate-sprite.py sheet.png --frames 4 --width 24 --height 24
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

# Traveler v2 approved palette (docs/art/sprite-prompt.md)
PALETTE = {
    (0x05, 0x08, 0x10),
    (0x14, 0x1D, 0x31),
    (0x1B, 0x27, 0x40),
    (0x2A, 0x3B, 0x5C),
    (0x31, 0x41, 0x5F),
    (0x5B, 0x51, 0x48),
    (0x8A, 0x72, 0x33),
    (0xE8, 0xC5, 0x6B),
    (0xF5, 0xEA, 0xD1),
    (0xFF, 0xF2, 0xC4),
}

MIN_INK_PER_FRAME = 30  # px; the PoC frames sit at ~225


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("png", help="sprite sheet PNG path")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--width", type=int, default=24, help="frame width px")
    ap.add_argument("--height", type=int, default=24, help="frame height px")
    args = ap.parse_args()

    try:
        from PIL import Image
    except ImportError:
        print("FAIL: Pillow is required (pip install pillow)", file=sys.stderr)
        return 1

    try:
        img = Image.open(args.png)
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: cannot open {args.png}: {exc}")
        return 1

    img = img.convert("RGBA")
    problems: list[str] = []

    expect = (args.width * args.frames, args.height)
    if img.size != expect:
        problems.append(f"size mismatch: got {img.size[0]}x{img.size[1]}, want {expect[0]}x{expect[1]}")

    px = img.load()
    w, h = img.size
    ink = Counter()
    palette_hits = Counter()
    alpha_hits = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            frame = min(x // args.width, args.frames - 1)
            ink[frame] += 1
            if a != 255:
                alpha_hits[a] += 1
                continue
            if (r, g, b) not in PALETTE:
                palette_hits[(r, g, b)] += 1

    if alpha_hits:
        detail = ", ".join(f"alpha={a}x{n}" for a, n in alpha_hits.most_common(5))
        problems.append(f"anti-aliased alpha: {sum(alpha_hits.values())} semi-transparent px ({detail})")
    if palette_hits:
        worst = ", ".join(
            f"#{r:02x}{g:02x}{b:02x}x{n}" for (r, g, b), n in palette_hits.most_common(5)
        )
        problems.append(f"palette violation: {len(palette_hits)} off-palette colors, top: {worst}")
    for f in range(args.frames):
        if ink[f] < MIN_INK_PER_FRAME:
            problems.append(f"frame {f} too sparse: {ink[f]} ink px (min {MIN_INK_PER_FRAME})")

    if problems:
        print(f"FAIL {args.png}")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(
        f"PASS {args.png} ({args.frames} frames {args.width}x{args.height}, "
        f"ink per frame: {[ink[f] for f in range(args.frames)]})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
