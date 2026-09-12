#!/usr/bin/env python3
"""Import an AI-generated sprite sheet into src/assets (issue #85 pipeline).

The generation side (user's image AI) does not always honor the sheet grid
(e.g. a 4-frame walk cycle delivered as 2304x288). This script normalizes a
received sheet to the contract size and hard-quantizes it to the approved
palette, then runs scripts/validate-sprite.py on the result. Only a PASSing
file is written to the destination asset path.

Steps:
  1. resize to (width*frames) x height with NEAREST (no smoothing -> no AA)
  2. alpha: threshold at 128 -> strictly 0 or 255
  3. color: snap every opaque pixel to the nearest PALETTE entry (validate-
     sprite.py semantics: RGB Euclidean distance; ties resolve to the darker
     entry, matching the night-scene tone rule)
  4. run validate-sprite.py on the written file; on FAIL the destination is
     rolled back and the violations are surfaced (regenerate prompt-side!)

Usage:
  python3 scripts/import-sprite.py incoming.png src/assets/traveler-sheet.png
  python3 scripts/import-sprite.py incoming.png src/assets/npc-talk-sheet.png --frames 2

Refuses to touch the destination if validation fails, so a bad drop can never
break the deployed app.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = REPO_ROOT / "scripts" / "validate-sprite.py"

# Same contract palette as scripts/validate-sprite.py (docs/art/sprite-prompt.md)
PALETTE = [
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
]

ALPHA_THRESHOLD = 128


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("png", help="incoming generated sprite sheet PNG")
    ap.add_argument("dest", help="destination asset path, e.g. src/assets/traveler-sheet.png")
    ap.add_argument("--frames", type=int, default=4)
    ap.add_argument("--width", type=int, default=24, help="frame width px")
    ap.add_argument("--height", type=int, default=24, help="frame height px")
    args = ap.parse_args()

    try:
        from PIL import Image
    except ImportError:
        print("FAIL: Pillow is required (pip install pillow)", file=sys.stderr)
        return 1

    src = Path(args.png)
    dest = Path(args.dest)
    if not dest.is_absolute():
        dest = REPO_ROOT / dest
    if not src.exists():
        print(f"FAIL: no such file: {src}")
        return 1

    img = Image.open(src).convert("RGBA")
    expect = (args.width * args.frames, args.height)
    if img.size != expect:
        print(f"note: resizing {img.size[0]}x{img.size[1]} -> {expect[0]}x{expect[1]} (NEAREST)")
        img = img.resize(expect, Image.Resampling.NEAREST)

    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < ALPHA_THRESHOLD:
                px[x, y] = (0, 0, 0, 0)
                continue
            px[x, y] = (*min(PALETTE, key=lambda p: (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2), 255)

    backup = None
    if dest.exists():
        backup = dest.with_suffix(dest.suffix + ".bak")
        shutil.copy2(dest, backup)

    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest)

    check = subprocess.run(
        [
            sys.executable,
            str(VALIDATOR),
            str(dest),
            "--frames",
            str(args.frames),
            "--width",
            str(args.width),
            "--height",
            str(args.height),
        ],
        capture_output=True,
        text=True,
    )
    print(check.stdout, end="")
    print(check.stderr, end="", file=sys.stderr)

    if check.returncode != 0:
        if backup is not None:
            shutil.move(backup, dest)
            print(f"FAIL: rolled back {dest} from backup")
        else:
            dest.unlink(missing_ok=True)
            print("FAIL: new asset removed (validation failed, nothing was deployed)")
        print("-> fix the generation prompt and re-export; do NOT widen the palette "
              "(docs/art/sprite-prompt.md)")
        return 1

    if backup is not None:
        backup.unlink(missing_ok=True)
    print(f"OK: {dest.relative_to(REPO_ROOT) if dest.is_relative_to(REPO_ROOT) else dest} imported")
    print("next: npm run build && check /english/ , then commit the swapped asset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
