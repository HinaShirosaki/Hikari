"""Detect the plate region with a trained plate-segmentation model.

The checkpoint comes from plate_training.py. The model predicts a plate-mask
probability; we threshold it, take the largest blob, and fit a circle. The result
is returned as a mask dict {kind, x, y, width, height} in original-image pixels -
the same shape the colony counter (ui.py / training.py) uses - so it can fill in
the mask when none was drawn.

Install:
    python -m pip install torch opencv-python numpy pandas tqdm

Run:
    python plate_inference.py --image image/IMG_0634.jpeg
    python plate_inference.py --image-dir image --overlay-dir plate_overlays
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from training import IMAGE_SUFFIXES, get_device
from inference import load_model, predict_heatmap  # reused as-is


def predict_plate_mask(
    model, image_bgr: np.ndarray, img_size: int, device, threshold: float = 0.5
) -> Optional[dict]:
    """Return the plate as a circle mask dict in original-image coords, or None."""
    original_height, original_width = image_bgr.shape[:2]
    prob = predict_heatmap(model, image_bgr, img_size, device)  # (img_size, img_size) in [0, 1]

    binary = (prob >= threshold).astype(np.uint8)
    if int(binary.sum()) == 0:
        return None
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # The model works in a SQUARE-resized space, so a circular plate becomes an
    # ellipse there with different x/y semi-axes. A single enclosing-circle radius
    # mapped back through the different x/y scales over-expands the shorter axis.
    # The contour bounding box keeps the x and y extents separate, so scaling each
    # through its own axis recovers the true plate ellipse.
    bx, by, bw, bh = cv2.boundingRect(max(contours, key=cv2.contourArea))
    scale_x = original_width / img_size
    scale_y = original_height / img_size

    # Clamp to the image so the mask never extends past the edge.
    x0 = max(0.0, bx * scale_x)
    y0 = max(0.0, by * scale_y)
    x1 = min(float(original_width), (bx + bw) * scale_x)
    y1 = min(float(original_height), (by + bh) * scale_y)
    if x1 - x0 < 1.0 or y1 - y0 < 1.0:
        return None

    return {"kind": "circle", "x": float(x0), "y": float(y0), "width": float(x1 - x0), "height": float(y1 - y0)}


def save_overlay(image_bgr: np.ndarray, mask: Optional[dict], output_path: Path) -> None:
    overlay = image_bgr.copy()
    if mask is not None:
        cx = int(round(mask["x"] + mask["width"] / 2))
        cy = int(round(mask["y"] + mask["height"] / 2))
        axes = (int(round(mask["width"] / 2)), int(round(mask["height"] / 2)))
        thickness = max(2, round(0.003 * max(overlay.shape[:2])))
        cv2.ellipse(overlay, (cx, cy), axes, 0, 0, 360, (0, 180, 255), thickness)
        text = "plate found"
    else:
        text = "no plate"
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
    parser = argparse.ArgumentParser(description="Detect the plate region with a trained model.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", type=Path, help="Single plate image.")
    group.add_argument("--image-dir", type=Path, help="Folder of plate images.")

    parser.add_argument("--checkpoint", type=Path, default=Path("plate_unet.pt"))
    parser.add_argument("--threshold", type=float, default=0.5, help="Plate-mask probability cutoff (0-1).")
    parser.add_argument("--overlay-dir", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found: {args.checkpoint}")

    device = get_device()
    model, img_size, _sigma = load_model(args.checkpoint, device)
    print(f"Using device: {device} | img_size={img_size}")

    images = collect_images(args)
    if not images:
        raise RuntimeError("No images found.")

    for image_path in images:
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            print(f"  skipped (unreadable): {image_path.name}")
            continue

        mask = predict_plate_mask(model, image_bgr, img_size, device, args.threshold)
        if mask is None:
            print(f"{image_path.name}: no plate found")
        else:
            print(
                f"{image_path.name}: plate at center "
                f"({mask['x'] + mask['width'] / 2:.0f}, {mask['y'] + mask['height'] / 2:.0f}), "
                f"size {mask['width']:.0f}x{mask['height']:.0f}"
            )
        if args.overlay_dir is not None:
            save_overlay(image_bgr, mask, args.overlay_dir / f"{image_path.stem}_plate.png")


if __name__ == "__main__":
    main()
