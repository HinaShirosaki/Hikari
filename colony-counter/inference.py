"""Count colonies on plate images with a trained center-heatmap model.

The checkpoint is the one written by training.py. Counting is done by *peak
detection* on the predicted heatmap: pixels that are a local maximum within a
``min_distance`` neighborhood and exceed ``threshold`` are treated as colony
centers. This matches training, where each colony is a Gaussian merged with
``np.maximum`` (a peak-style heatmap, not an additive density map).

Caveat for dense plates
-----------------------
At the training resolution (``img_size``), neighbouring colonies whose spacing is
smaller than the Gaussian ``sigma`` merge into one blob, and peak detection will
undercount. If your plates are dense, retrain at a larger ``--img-size`` with a
smaller ``--sigma`` (so peaks stay separable), or switch the target in
training.py to an *additive* density map and count by integrating the heatmap
(sum of heatmap / sum of one unit Gaussian) instead of peak-finding.

Install (this imports training.py, so it shares its dependencies):
    python -m pip install torch torchvision opencv-python numpy pandas tqdm

Run:
    python inference.py --image image/IMG_0634.jpeg
    python inference.py --image-dir image --overlay-dir overlays
    python inference.py --image-dir image --threshold 0.4 --min-distance 4
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
import torch

from training import IMAGE_SUFFIXES, SmallUNet, get_device


def load_model(checkpoint_path: Path, device: torch.device) -> tuple[SmallUNet, int, float]:
    checkpoint = torch.load(checkpoint_path, map_location=device)
    base_channels = int(checkpoint.get("base_channels", 16))
    img_size = int(checkpoint.get("img_size", 512))
    sigma = float(checkpoint.get("sigma", 5.0))

    model = SmallUNet(base_channels=base_channels).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, img_size, sigma


@torch.no_grad()
def predict_heatmap(
    model: SmallUNet, image_bgr: np.ndarray, img_size: int, device: torch.device
) -> np.ndarray:
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    image_resized = cv2.resize(image_rgb, (img_size, img_size), interpolation=cv2.INTER_AREA)

    tensor = torch.from_numpy(image_resized.astype(np.float32) / 255.0)
    tensor = tensor.permute(2, 0, 1).unsqueeze(0).to(device)

    heatmap = model(tensor)[0, 0].detach().cpu().numpy()
    return heatmap


def find_peaks(heatmap: np.ndarray, threshold: float, min_distance: int) -> np.ndarray:
    """Return colony-center coordinates (N, 2) as (x, y) in heatmap pixel space."""
    kernel_size = max(3, int(2 * min_distance + 1))
    kernel = np.ones((kernel_size, kernel_size), np.uint8)

    # A pixel is a local maximum if it equals the dilated (neighbourhood-max) value.
    dilated = cv2.dilate(heatmap, kernel)
    peak_mask = ((heatmap >= dilated) & (heatmap >= threshold)).astype(np.uint8)

    if int(peak_mask.sum()) == 0:
        return np.empty((0, 2), dtype=np.float32)

    # Collapse flat plateaus (several equal-valued adjacent pixels) into one point
    # by taking the centroid of each connected peak region.
    _, _, _, centroids = cv2.connectedComponentsWithStats(peak_mask, connectivity=8)
    return centroids[1:].astype(np.float32)  # drop background (index 0); (x, y) order


def scale_peaks(peaks: np.ndarray, img_size: int, original_width: int, original_height: int) -> np.ndarray:
    if peaks.size == 0:
        return peaks
    scaled = peaks.copy()
    scaled[:, 0] *= original_width / img_size
    scaled[:, 1] *= original_height / img_size
    return scaled


def save_overlay(image_bgr: np.ndarray, peaks: np.ndarray, output_path: Path) -> None:
    overlay = image_bgr.copy()
    radius = max(4, round(0.004 * max(overlay.shape[:2])))
    for x, y in peaks:
        cv2.circle(overlay, (int(round(x)), int(round(y))), radius, (40, 40, 255), 2)

    text = f"count: {len(peaks)}"
    cv2.putText(overlay, text, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 8)
    cv2.putText(overlay, text, (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (255, 255, 255), 3)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), overlay)


def collect_images(args: argparse.Namespace) -> list[Path]:
    if args.image is not None:
        return [args.image]
    return sorted(
        path
        for path in args.image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Count colonies with a trained heatmap model.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", type=Path, help="Single plate image to count.")
    group.add_argument("--image-dir", type=Path, help="Folder of plate images to count.")

    parser.add_argument("--checkpoint", type=Path, default=Path("colony_heatmap_unet.pt"))
    parser.add_argument("--threshold", type=float, default=0.5, help="Min heatmap value for a peak (0-1).")
    parser.add_argument(
        "--min-distance",
        type=int,
        default=3,
        help="Min separation between peaks, in heatmap pixels (model resolution).",
    )
    parser.add_argument("--overlay-dir", type=Path, default=None, help="If set, write annotated images here.")
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
        raise RuntimeError("No images found to count.")

    total = 0
    for image_path in images:
        # IGNORE_ORIENTATION: match the labeler's raw-pixel frame (no EXIF rotate).
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            print(f"  skipped (unreadable): {image_path.name}")
            continue

        original_height, original_width = image_bgr.shape[:2]
        heatmap = predict_heatmap(model, image_bgr, img_size, device)
        peaks = find_peaks(heatmap, args.threshold, args.min_distance)
        peaks = scale_peaks(peaks, img_size, original_width, original_height)

        count = len(peaks)
        total += count
        print(f"{image_path.name}: {count}")

        if args.overlay_dir is not None:
            save_overlay(image_bgr, peaks, args.overlay_dir / f"{image_path.stem}_count.png")

    if len(images) > 1:
        print(f"\nTotal across {len(images)} image(s): {total}")


if __name__ == "__main__":
    main()
