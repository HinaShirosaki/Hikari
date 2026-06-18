"""Train a gel lane heatmap model from the gel labeler output.

The model predicts a ridge over each LANE band (a visible feature it can learn),
not the empty gaps between lanes. Each labeled lane is a near-vertical line from
(x_top, 0) to (x_bottom, image_height), drawn with a Gaussian cross-section.
Dividers are derived afterwards as the midpoints between neighbouring lanes
(see gel_inference.derive_dividers). The same SmallUNet, masked-MSE loss,
run_epoch loop, and device handling are reused from training.py.

Expected layout
---------------
colony-counter/
  gel_image/
    gel001.jpg
  gel_label/
    gel001.lanes.json   # from gel_ui.py
  gel_training.py

Install:
    python -m pip install torch opencv-python numpy tqdm

Run:
    python gel_training.py
    python gel_training.py --image-dir gel_image --label-dir gel_label --epochs 80 --img-size 512
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset, Subset

# Reuse the colony-counter building blocks.
from training import (
    IMAGE_SUFFIXES,
    EpochResult,
    Sample,
    SmallUNet,
    find_samples,
    get_device,
    masked_mse_loss,
    run_epoch,
    seed_everything,
)
from gel_geometry import rotate_image

# Accept the new lane labels and the older divider labels (auto-converted below).
GEL_LABEL_SUFFIXES = (".lanes.json", ".lanes.csv", ".dividers.json", ".dividers.csv")


def pair_midpoints(lines: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Midpoint line of each adjacent pair, left to right. Two dividers make a lane:
    given dividers this returns the lane centers (and given lanes it returns the
    dividers between them - it is its own dual)."""
    ordered = sorted(lines, key=lambda line: 0.5 * (line[0] + line[1]))
    return [
        (0.5 * (a_top + b_top), 0.5 * (a_bottom + b_bottom))
        for (a_top, a_bottom), (b_top, b_bottom) in zip(ordered, ordered[1:])
    ]


def read_gel_label_file(label_path: Path) -> tuple[float, list[tuple[float, float]]]:
    """Return (rotation_angle_deg, lane lines) in the STRAIGHTENED-image frame.

    Lane labels (*.lanes.*) are used directly. Divider labels (*.dividers.*) are
    converted to lane centers - the midpoint between each pair of neighbouring
    dividers - so existing divider labels train a lane model with no re-labeling.
    """
    is_divider = ".dividers." in label_path.name.lower()

    if label_path.suffix.lower() == ".csv":
        with label_path.open(newline="", encoding="utf-8") as f:
            lines = [(float(row["x_top"]), float(row["x_bottom"])) for row in csv.DictReader(f)]
        angle = 0.0  # CSV does not carry the angle
    else:
        payload = json.loads(label_path.read_text(encoding="utf-8"))
        angle = float(payload.get("rotation", 0.0))
        key = "dividers" if is_divider else "lanes"
        lines = [(float(d["x_top"]), float(d["x_bottom"])) for d in payload.get(key, [])]

    if is_divider:
        lines = pair_midpoints(lines)  # two dividers -> one lane center
    return angle, lines


def build_lane_heatmap(
    lanes: list[tuple[float, float]],
    original_width: int,
    original_height: int,
    img_size: int,
    sigma: float,
) -> np.ndarray:
    """Draw each lane as a blurred line ridge (peak 1.0), merged with maximum."""
    heatmap = np.zeros((img_size, img_size), dtype=np.float32)
    if not lanes:
        return heatmap

    scale_x = img_size / original_width
    scale_y = img_size / original_height  # currently unused (lines span full height)
    kernel = max(3, int(6 * sigma) | 1)  # odd kernel covering ~3 sigma each side

    for x_top, x_bottom in lanes:
        line = np.zeros((img_size, img_size), dtype=np.float32)
        x0 = int(round(x_top * scale_x))
        x1 = int(round(x_bottom * scale_x))
        cv2.line(line, (x0, 0), (x1, img_size - 1), color=1.0, thickness=1, lineType=cv2.LINE_AA)
        if sigma > 0:
            line = cv2.GaussianBlur(line, (kernel, kernel), sigma)
            peak = float(line.max())
            if peak > 0:
                line /= peak
        heatmap = np.maximum(heatmap, line)

    return heatmap


def find_gel_samples(image_dir: Path, label_dir: Path) -> list[Sample]:
    return find_samples(image_dir, label_dir, label_suffixes=GEL_LABEL_SUFFIXES)


class GelLaneDataset(Dataset):
    def __init__(self, samples: list[Sample], img_size: int, sigma: float, augment: bool, pos_weight: float = 10.0) -> None:
        self.samples = samples
        self.img_size = img_size
        self.sigma = sigma
        self.augment = augment
        self.pos_weight = pos_weight

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        sample = self.samples[index]

        image_bgr = cv2.imread(str(sample.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            raise ValueError(f"Could not read image: {sample.image_path}")

        angle, lanes = read_gel_label_file(sample.label_path)
        # Straighten the image the same way the labeler did; the saved lanes are
        # in this straightened frame, so they line up with the rotated pixels.
        image_bgr = rotate_image(image_bgr, angle)

        original_height, original_width = image_bgr.shape[:2]
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image_rgb = cv2.resize(image_rgb, (self.img_size, self.img_size), interpolation=cv2.INTER_AREA)

        heatmap = build_lane_heatmap(lanes, original_width, original_height, self.img_size, self.sigma)

        if self.augment:
            # Horizontal flip mirrors the lane geometry, so flipping both arrays
            # together stays consistent (no need to recompute coordinates).
            if random.random() < 0.5:
                image_rgb = np.ascontiguousarray(np.fliplr(image_rgb))
                heatmap = np.ascontiguousarray(np.fliplr(heatmap))
            if random.random() < 0.35:
                factor = random.uniform(0.75, 1.25)
                image_rgb = np.clip(image_rgb.astype(np.float32) * factor, 0, 255).astype(np.uint8)

        image = image_rgb.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))

        # Class imbalance: lane ridges are a tiny fraction of pixels, so plain
        # MSE is minimised by predicting ~0 everywhere (flat heatmap -> 0 lanes).
        # Weight ridge pixels up so the model is forced to commit to the lines.
        weight = (1.0 + self.pos_weight * heatmap).astype(np.float32)

        return (
            torch.from_numpy(image).float(),
            torch.from_numpy(heatmap[None, :, :]).float(),
            torch.from_numpy(weight[None, :, :]).float(),
        )


@dataclass
class GelTrainConfig:
    image_dir: Path = Path("gel_image")
    label_dir: Path = Path("gel_label")
    output: Path = Path("gel_lane_unet.pt")
    img_size: int = 512
    sigma: float = 3.0
    pos_weight: float = 10.0
    epochs: int = 60
    batch_size: int = 4
    lr: float = 1e-3
    base_channels: int = 16
    validation_fraction: float = 0.15
    seed: int = 42


def make_loaders(
    samples: list[Sample],
    img_size: int,
    sigma: float,
    pos_weight: float,
    batch_size: int,
    validation_fraction: float,
    device: torch.device,
    seed: int,
) -> tuple[DataLoader, DataLoader | None]:
    train_dataset = GelLaneDataset(samples, img_size=img_size, sigma=sigma, augment=True, pos_weight=pos_weight)

    if len(samples) >= 5 and validation_fraction > 0:
        validation_count = max(1, int(round(len(samples) * validation_fraction)))
        training_count = len(samples) - validation_count
        valid_dataset = GelLaneDataset(samples, img_size=img_size, sigma=sigma, augment=False, pos_weight=pos_weight)
        generator = torch.Generator().manual_seed(seed)
        permutation = torch.randperm(len(samples), generator=generator).tolist()
        train_subset = Subset(train_dataset, permutation[:training_count])
        valid_subset = Subset(valid_dataset, permutation[training_count:])
    else:
        train_subset = train_dataset
        valid_subset = None

    workers = 0 if device.type == "mps" else 4

    train_loader = DataLoader(
        train_subset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=workers,
        pin_memory=(device.type == "cuda"),
        persistent_workers=(workers > 0),
    )

    valid_loader = None
    if valid_subset is not None:
        valid_loader = DataLoader(
            valid_subset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=workers,
            pin_memory=(device.type == "cuda"),
            persistent_workers=(workers > 0),
        )

    return train_loader, valid_loader


def train(
    config: GelTrainConfig,
    on_epoch: Callable[[EpochResult], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> tuple[Path, list[EpochResult]]:
    seed_everything(config.seed)

    if not config.image_dir.exists():
        raise FileNotFoundError(f"Image folder not found: {config.image_dir}")
    if not config.label_dir.exists():
        raise FileNotFoundError(f"Label folder not found: {config.label_dir}")

    samples = find_gel_samples(config.image_dir, config.label_dir)
    if not samples:
        raise RuntimeError(
            "No gel image/label pairs found. Label files must share the image stem, "
            "for example gel_image/gel001.jpg and gel_label/gel001.lanes.json."
        )

    device = get_device()
    print(f"Using device: {device}")
    print(f"Found {len(samples)} labeled gel image(s).")

    train_loader, valid_loader = make_loaders(
        samples=samples,
        img_size=config.img_size,
        sigma=config.sigma,
        pos_weight=config.pos_weight,
        batch_size=config.batch_size,
        validation_fraction=config.validation_fraction,
        device=device,
        seed=config.seed,
    )

    model = SmallUNet(base_channels=config.base_channels).to(device)
    if device.type == "cuda":
        model = model.to(memory_format=torch.channels_last)

    optimizer = torch.optim.AdamW(model.parameters(), lr=config.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=6)

    history: list[EpochResult] = []
    best_metric = float("inf")

    for epoch in range(1, config.epochs + 1):
        print(f"\nEpoch {epoch}/{config.epochs}")
        train_loss = run_epoch(model, train_loader, device, optimizer)

        if valid_loader is not None:
            valid_loss = run_epoch(model, valid_loader, device, optimizer=None)
            metric = valid_loss
            print(f"train_loss={train_loss:.6f} valid_loss={valid_loss:.6f}")
        else:
            valid_loss = None
            metric = train_loss
            print(f"train_loss={train_loss:.6f}")

        scheduler.step(metric)

        is_best = metric < best_metric
        if is_best:
            best_metric = metric
            checkpoint = {
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "epoch": epoch,
                "best_metric": best_metric,
                "img_size": config.img_size,
                "sigma": config.sigma,
                "base_channels": config.base_channels,
                "label_format": "lane_heatmap",
            }
            torch.save(checkpoint, config.output)
            print(f"Saved best checkpoint: {config.output}")

        result = EpochResult(epoch=epoch, train_loss=train_loss, valid_loss=valid_loss, is_best=is_best)
        history.append(result)
        if on_epoch is not None:
            on_epoch(result)

        if should_stop is not None and should_stop():
            print("Stopping early (requested).")
            break

    print("Training complete.")
    return config.output, history


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train gel lane heatmap model.")
    parser.add_argument("--image-dir", type=Path, default=Path("gel_image"))
    parser.add_argument("--label-dir", type=Path, default=Path("gel_label"))
    parser.add_argument("--output", type=Path, default=Path("gel_lane_unet.pt"))
    parser.add_argument("--img-size", type=int, default=512)
    parser.add_argument("--sigma", type=float, default=3.0, help="Gaussian width of each lane ridge.")
    parser.add_argument("--pos-weight", type=float, default=10.0, help="Loss weight on ridge pixels (counters imbalance).")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--base-channels", type=int, default=16)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = GelTrainConfig(
        image_dir=args.image_dir,
        label_dir=args.label_dir,
        output=args.output,
        img_size=args.img_size,
        sigma=args.sigma,
        pos_weight=args.pos_weight,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        base_channels=args.base_channels,
        validation_fraction=args.validation_fraction,
        seed=args.seed,
    )
    train(config)


if __name__ == "__main__":
    main()
