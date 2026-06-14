"""Detect gel lanes with a trained ridge-heatmap model, and derive the dividers.

The checkpoint comes from gel_training.py. The model predicts a ridge over each
lane band (a visible feature it can learn). We project the heatmap onto the
x-axis and pick prominent peaks as lane centers, then place a divider at the
midpoint between each pair of neighbouring lanes.

Install:
    python -m pip install torch opencv-python numpy pandas tqdm

Run:
    python gel_inference.py --image gel_image/gel001.jpg
    python gel_inference.py --image-dir gel_image --overlay-dir gel_overlays
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from training import IMAGE_SUFFIXES, get_device
from inference import load_model, predict_heatmap  # reused as-is
from gel_geometry import rotate_image


def _moving_average(values: np.ndarray, radius: int) -> np.ndarray:
    """Edge-replicated moving average (no zero-padding artefacts at the borders)."""
    if radius < 1:
        return values
    padded = np.pad(values, radius, mode="edge")
    kernel = np.ones(2 * radius + 1, dtype=np.float64) / (2 * radius + 1)
    return np.convolve(padded, kernel, mode="valid")


def column_prominence(heatmap: np.ndarray, min_distance: int = 8) -> np.ndarray:
    """Column profile (mean over rows) with the inter-lane background removed, so
    each value is how far that column rises above the background floor.

    The background is a low percentile of the profile (most columns are between
    lanes), which is a single level shared by all lanes - so evenly spaced ridges
    are treated equally (a moving-average baseline would let neighbouring ridges
    suppress the ones between them)."""
    profile = heatmap.mean(axis=0).astype(np.float64)
    radius = max(1, int(min_distance))
    smooth = _moving_average(profile, radius)        # ridge -> single clean bump
    background = float(np.percentile(smooth, 25))    # inter-lane background floor
    return smooth - background


def extract_lanes(heatmap: np.ndarray, threshold: float, min_distance: int = 8) -> list[tuple[float, float]]:
    """Detect near-vertical lanes as PROMINENT peaks in the column profile.

    Because the gel is straightened before labeling, lanes are vertical, so a
    lane is a coherent vertical ridge -> a bump in the column profile. A peak
    must rise at least `threshold` above its local background (prominence), so a
    flat/low heatmap yields 0 lanes (not noise) while a real ridge is found
    regardless of the overall brightness level.

    Returns (x_top, x_bottom) per lane (vertical: x_top == x_bottom), left to right.
    """
    prominence = column_prominence(heatmap, min_distance)
    width = len(prominence)

    candidates = [
        x
        for x in range(1, width - 1)
        if prominence[x] >= threshold and prominence[x] >= prominence[x - 1] and prominence[x] > prominence[x + 1]
    ]
    # Greedy non-maximum suppression: keep the strongest, drop near neighbours.
    candidates.sort(key=lambda x: -prominence[x])
    kept: list[int] = []
    for x in candidates:
        if all(abs(x - k) >= min_distance for k in kept):
            kept.append(x)

    kept.sort()
    return [(float(x), float(x)) for x in kept]


def scale_lanes(lanes: list[tuple[float, float]], img_size: int, original_width: int) -> list[tuple[float, float]]:
    factor = original_width / img_size
    return [(x_top * factor, x_bottom * factor) for x_top, x_bottom in lanes]


def derive_dividers(lanes: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """A divider sits between two adjacent lanes: the midpoint of each neighbouring
    pair of lane lines. N lanes -> N-1 dividers. Lanes must be sorted left to right."""
    return [
        (0.5 * (a_top + b_top), 0.5 * (a_bottom + b_bottom))
        for (a_top, a_bottom), (b_top, b_bottom) in zip(lanes, lanes[1:])
    ]


def save_overlay(image_bgr: np.ndarray, lanes: list[tuple[float, float]], output_path: Path) -> None:
    overlay = image_bgr.copy()
    height = overlay.shape[0]
    thickness = max(2, round(0.002 * max(overlay.shape[:2])))

    for x_top, x_bottom in lanes:  # lane centers in cyan
        cv2.line(overlay, (int(round(x_top)), 0), (int(round(x_bottom)), height - 1), (0, 180, 255), thickness)
    for x_top, x_bottom in derive_dividers(lanes):  # derived dividers in red
        cv2.line(overlay, (int(round(x_top)), 0), (int(round(x_bottom)), height - 1), (40, 40, 255), thickness)

    text = f"lanes: {len(lanes)}  dividers: {max(0, len(lanes) - 1)}"
    cv2.putText(overlay, text, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 8)
    cv2.putText(overlay, text, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (255, 255, 255), 3)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), overlay)


def collect_images(args: argparse.Namespace) -> list[Path]:
    if args.image is not None:
        return [args.image]
    return sorted(
        path for path in args.image_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect gel lanes (and derive dividers) with a trained model.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", type=Path, help="Single gel image.")
    group.add_argument("--image-dir", type=Path, help="Folder of gel images.")

    parser.add_argument("--checkpoint", type=Path, default=Path("gel_lane_unet.pt"))
    parser.add_argument("--threshold", type=float, default=0.1, help="Min ridge prominence above local background.")
    parser.add_argument("--min-distance", type=int, default=8, help="Min separation between lanes (heatmap px).")
    parser.add_argument(
        "--rotation",
        type=float,
        default=0.0,
        help="Straighten angle (deg) applied before detection. Use the same angle you labeled with.",
    )
    parser.add_argument("--overlay-dir", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found: {args.checkpoint}")

    device = get_device()
    model, img_size, sigma = load_model(args.checkpoint, device)
    print(f"Using device: {device} | img_size={img_size} sigma={sigma}")

    images = collect_images(args)
    if not images:
        raise RuntimeError("No images found.")

    for image_path in images:
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            print(f"  skipped (unreadable): {image_path.name}")
            continue

        # Straighten by the same angle used at labeling time, then detect.
        image_bgr = rotate_image(image_bgr, args.rotation)
        original_width = image_bgr.shape[1]
        heatmap = predict_heatmap(model, image_bgr, img_size, device)
        lanes = extract_lanes(heatmap, args.threshold, args.min_distance)
        lanes = scale_lanes(lanes, img_size, original_width)

        prominence_max = float(column_prominence(heatmap, args.min_distance).max())
        print(
            f"{image_path.name}: {len(lanes)} lane(s) -> {max(0, len(lanes) - 1)} divider(s)"
            f"  [heatmap max={float(heatmap.max()):.2f}, ridge prominence max={prominence_max:.3f}, threshold={args.threshold}]"
        )
        if not lanes and prominence_max < args.threshold:
            print(f"    (no ridge stands out above {args.threshold}: lower --threshold, or the model is undertrained)")

        if args.overlay_dir is not None:
            save_overlay(image_bgr, lanes, args.overlay_dir / f"{image_path.stem}_lanes.png")


if __name__ == "__main__":
    main()
