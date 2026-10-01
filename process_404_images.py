#!/usr/bin/env python3
"""Prepare artwork for the Guest Portal offline (404) screen.

Strips the flat backdrop (white / grey / checkerboard / any border-matched
colour) so the image sits cleanly on the dark bg-slate-950 card, then writes
the result into frontend/public/404/NN.png where the login page rotation
picks it up automatically.

Usage:
    python process_404_images.py photo.jpg
    python process_404_images.py a.jpg b.png c.webp
    python process_404_images.py --slot 3 photo.jpg      # write 03.png
    python process_404_images.py --force --slot 1 x.png  # overwrite 01.png
    python process_404_images.py --flood screenshot.png  # flat/checkerboard backdrops

Uses an ML cutout (rembg) when installed — best for white clothing on white
backgrounds, gradient backdrops, and portraits. Falls back to a colour-flood
for flat backdrops; --flood forces that method.

Requires: pillow, numpy   (pip install pillow numpy)
Optional: rembg           (pip install rembg — downloads its model on first run)
"""

import argparse
import sys
import tempfile
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency: {exc.name} — run: pip install pillow numpy")

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "frontend" / "public" / "404"
_REMBG_SESSION = None


def detect_border_colors(rgb: np.ndarray):
    """Colors that make up the backdrop: frequent on at least 2 of 4 edges."""
    h, w, _ = rgb.shape
    strip = max(1, min(h, w) // 200)
    sides = [
        rgb[:strip].reshape(-1, 3),
        rgb[-strip:].reshape(-1, 3),
        rgb[:, :strip].reshape(-1, 3),
        rgb[:, -strip:].reshape(-1, 3),
    ]
    votes = {}
    for pixels in sides:
        quantized = (pixels // 8) * 8
        colors, counts = np.unique(quantized, axis=0, return_counts=True)
        total = int(counts.sum())
        for color, count in zip(colors, counts):
            if count / total >= 0.02:
                key = tuple(int(v) for v in color)
                votes[key] = votes.get(key, 0) + 1
    kept = [c for c, sides_count in votes.items() if sides_count >= 2]
    if not kept:
        kept = sorted(votes, key=votes.get, reverse=True)[:3]
    return kept or [(255, 255, 255)]


def border_seeds(w: int, h: int, step: int):
    """Flood seeds: full top edge, upper side edges, bottom corners.

    Avoids seeding the bottom-centre where a subject usually runs off-frame,
    which would let the flood leak into the artwork.
    """
    seeds = []
    for x in range(0, w, step):
        seeds.append((x, 0))
    for y in range(0, int(h * 0.4), step):
        seeds.append((0, y))
        seeds.append((w - 1, y))
    for y in range(int(h * 0.85), h, step):
        seeds.append((0, y))
        seeds.append((w - 1, y))
    for x in list(range(0, max(1, int(w * 0.15)), step)) + list(range(int(w * 0.85), w, step)):
        seeds.append((x, h - 1))
    return [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] + seeds


def background_mask(rgb: np.ndarray, tol: int):
    h, w, _ = rgb.shape
    border = detect_border_colors(rgb)
    match = np.zeros((h, w), dtype=bool)
    for color in border:
        diff = np.abs(rgb - np.array(color, dtype=np.int16)).max(axis=2)
        match |= diff <= tol

    # Light checkerboard / white backdrops: also catch off-border cells
    border_arr = np.array(border, dtype=np.int16)
    median = np.median(border_arr, axis=0)
    if median.min() >= 190 and (median.max() - median.min()) <= 30:
        mx, mn = rgb.max(axis=2), rgb.min(axis=2)
        match |= ((mx - mn) <= 14) & (mn >= 218)

    work = Image.fromarray(np.where(match, 255, 0).astype(np.uint8), "L").copy()
    pixels = work.load()
    step = max(1, min(w, h) // 32)
    for seed in border_seeds(w, h, step):
        if 0 <= seed[0] < w and 0 <= seed[1] < h and pixels[seed] == 255:
            ImageDraw.floodfill(work, seed, 128, thresh=0)
    return np.array(work) == 128


def resolve_slot(explicit, force):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if explicit is not None:
        if not 1 <= explicit <= 99:
            sys.exit("--slot must be between 1 and 99")
        target = OUT_DIR / f"{explicit:02d}.png"
        if target.exists() and not force:
            sys.exit(f"{target} already exists — use --force to overwrite or another --slot")
        return explicit
    for n in range(1, 100):
        if not (OUT_DIR / f"{n:02d}.png").exists():
            return n
    sys.exit("no free slot left in frontend/public/404 (01-99 all used)")


def ml_cutout(rgba: Image.Image):
    """Cutout via rembg (pip install rembg) — handles white-on-white and gradients."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        try:
            from rembg import new_session, remove
        except ImportError:
            return None
        _REMBG_SESSION = new_session("isnet-general-use")
    else:
        from rembg import remove
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    white.alpha_composite(rgba)
    cut = remove(white.convert("RGB"), session=_REMBG_SESSION)
    return np.array(cut.split()[3])


def process(path: Path, slot: int, tol: int, max_size: int, force: bool, flood_only: bool):
    image = Image.open(path)
    if max_size and max(image.size) > max_size:
        scale = max_size / max(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)

    rgba = image.convert("RGBA")
    old = np.array(rgba.split()[3])
    was_transparent = (old < 128).mean() >= 0.005
    border = np.concatenate([old[:6].ravel(), old[-6:].ravel(), old[:, :6].ravel(), old[:, -6:].ravel()])
    border_opaque = (border >= 128).mean()

    if was_transparent and border_opaque < 0.02:
        out = rgba
        print(f"{path.name}: already cut out — keeping alpha ({(old < 128).mean():.1%} transparent)")
    else:
        ml = None if flood_only else ml_cutout(rgba)
        if ml is not None:
            alpha = np.where(old >= 128, ml, 0).astype(np.uint8) if was_transparent else ml.astype(np.uint8)
            removed = (alpha < 128).mean()
            print(f"{path.name}: ML cutout (rembg) — {removed:.1%} transparent")
            alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.6)))
        else:
            rgb = np.array(rgba.convert("RGB")).astype(np.int16)
            mask = background_mask(rgb, tol)
            removed = mask.mean()
            print(f"{path.name}: backdrop flood — background removed: {removed:.1%}")
            if removed < 0.03:
                print("  WARNING: almost nothing removed — install rembg (pip install rembg) or raise --tol")
            elif removed > 0.92:
                print("  WARNING: almost everything removed — the subject may match the backdrop")
            alpha = np.array(Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L")
                             .filter(ImageFilter.GaussianBlur(1.0)))
        if not 0.03 <= removed <= 0.92:
            print("  WARNING: result looks suspicious — check the preview before deploying")
        out = rgba.copy()
        out.putalpha(Image.fromarray(alpha))

    target = OUT_DIR / f"{slot:02d}.png"
    if target.exists() and not force:
        sys.exit(f"{target} already exists — use --force to overwrite")
    out.save(target)

    preview_dir = Path(tempfile.gettempdir()) / "404-previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    preview = preview_dir / f"{target.stem}-preview.png"
    card = Image.new("RGBA", out.size, (2, 6, 23, 255))
    card.alpha_composite(out)
    card.convert("RGB").resize((out.width // 2, out.height // 2)).save(preview)

    print(f"  -> {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes)")
    print(f"  preview on the dark card: {preview}")


def main():
    parser = argparse.ArgumentParser(description="Make 404 artwork background-transparent for the dark Guest Portal screen")
    parser.add_argument("images", nargs="+", type=Path, help="image file(s) to process")
    parser.add_argument("--slot", type=int, help="target slot number (1-99), single input only")
    parser.add_argument("--force", action="store_true", help="overwrite an existing slot file")
    parser.add_argument("--tol", type=int, default=24, help="backdrop colour tolerance (default 24)")
    parser.add_argument("--max-size", type=int, default=1600, help="shrink longest side to this many px (0 = keep original)")
    parser.add_argument("--flood", action="store_true", help="use the colour-flood method instead of the ML cutout (for flat/checkerboard backdrops)")
    args = parser.parse_args()

    if args.slot is not None and len(args.images) > 1:
        sys.exit("--slot only works with a single input image")

    for image_path in args.images:
        if not image_path.is_file():
            sys.exit(f"not found: {image_path}")
        slot = resolve_slot(args.slot, args.force)
        process(image_path, slot, args.tol, args.max_size, args.force, args.flood)


if __name__ == "__main__":
    main()
