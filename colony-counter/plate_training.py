"""Train a plate-segmentation U-Net for the colony counter.

The colony counter uses a mask (rectangle/circle) to bound where colonies are
counted. Drawing that mask by hand is tedious; this network learns to predict the
plate region automatically, so it can fill in the mask when none is given.

Labeling: in ui.py, draw a mask (a circle works best for round plates) around the
PLATE and click "Save Plate Mask". That writes a mask-only "<stem>.mask.json" file,
SEPARATE from the colony "<stem>.labels.json" (pins + counting-region mask). Put
the mask files in plate_label/ (default) so the two networks train independently.

The model predicts a 1-channel plate mask (1 inside the plate, 0 outside); the
same SmallUNet / run_epoch / device handling are reused from training.py.

Install:
    python -m pip install torch opencv-python numpy pandas tqdm

Run:
    python plate_training.py
    python plate_training.py --image-dir plate_image --label-dir plate_label --epochs 60
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset, Subset

from training import (
    EpochResult,
    Sample,
    SmallUNet,
    TrainingMask,
    build_mask_array,
    find_samples,
    get_device,
    masked_mse_loss,
    run_epoch,
    seed_everything,
)

# Plate masks live in their OWN label files, separate from the colony *.labels.json
# (which hold pins + the counting-region mask). Save these from ui.py "Save Plate Mask".
MASK_LABEL_SUFFIXES = (".mask.json",)


def read_mask_label(label_path: Path) -> TrainingMask:
    payload = json.loads(label_path.read_text(encoding="utf-8"))
    mask_payload = payload.get("mask") or {"kind": "none"}
    return TrainingMask(
        kind=mask_payload.get("kind", "none"),
        x=float(mask_payload.get("x", 0.0)),
        y=float(mask_payload.get("y", 0.0)),
        width=float(mask_payload.get("width", 0.0)),
        height=float(mask_payload.get("height", 0.0)),
    )


def find_plate_samples(image_dir: Path, label_dir: Path) -> list[Sample]:
    """Image/*.mask.json pairs whose mask is non-empty (kind != none)."""
    samples = []
    skipped = 0
    for sample in find_samples(image_dir, label_dir, label_suffixes=MASK_LABEL_SUFFIXES):
        if read_mask_label(sample.label_path).kind != "none":
            samples.append(sample)
        else:
            skipped += 1
    if skipped:
        print(f"Skipped {skipped} mask label(s) with kind=none (nothing to learn from).")
    return samples


class PlateMaskDataset(Dataset):
    def __init__(self, samples: list[Sample], img_size: int, augment: bool) -> None:
        self.samples = samples
        self.img_size = img_size
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        sample = self.samples[index]

        image_bgr = cv2.imread(str(sample.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            raise ValueError(f"Could not read image: {sample.image_path}")

        original_height, original_width = image_bgr.shape[:2]
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image_rgb = cv2.resize(image_rgb, (self.img_size, self.img_size), interpolation=cv2.INTER_AREA)

        mask = read_mask_label(sample.label_path)
        target = build_mask_array(mask, original_width, original_height, self.img_size)  # 1 inside plate

        if self.augment:
            if random.random() < 0.5:
                image_rgb = np.ascontiguousarray(np.fliplr(image_rgb))
                target = np.ascontiguousarray(np.fliplr(target))
            if random.random() < 0.5:
                image_rgb = np.ascontiguousarray(np.flipud(image_rgb))
                target = np.ascontiguousarray(np.flipud(target))
            if random.random() < 0.35:
                factor = random.uniform(0.75, 1.25)
                image_rgb = np.clip(image_rgb.astype(np.float32) * factor, 0, 255).astype(np.uint8)

        image = image_rgb.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))
        # The whole image is supervised (segmentation), so the loss weight is all ones
        # -> masked_mse_loss becomes plain MSE over the mask.
        weight = np.ones((self.img_size, self.img_size), dtype=np.float32)

        return (
            torch.from_numpy(image).float(),
            torch.from_numpy(target[None, :, :]).float(),
            torch.from_numpy(weight[None, :, :]).float(),
        )


@dataclass
class PlateTrainConfig:
    image_dir: Path = Path("plate_image")
    label_dir: Path = Path("plate_label")
    output: Path = Path("plate_unet.pt")
    img_size: int = 512
    epochs: int = 60
    batch_size: int = 4
    lr: float = 1e-3
    base_channels: int = 16
    validation_fraction: float = 0.15
    seed: int = 42


def make_loaders(
    samples: list[Sample],
    img_size: int,
    batch_size: int,
    validation_fraction: float,
    device: torch.device,
    seed: int,
) -> tuple[DataLoader, DataLoader | None]:
    train_dataset = PlateMaskDataset(samples, img_size=img_size, augment=True)

    if len(samples) >= 5 and validation_fraction > 0:
        validation_count = max(1, int(round(len(samples) * validation_fraction)))
        training_count = len(samples) - validation_count
        valid_dataset = PlateMaskDataset(samples, img_size=img_size, augment=False)
        generator = torch.Generator().manual_seed(seed)
        permutation = torch.randperm(len(samples), generator=generator).tolist()
        train_subset = Subset(train_dataset, permutation[:training_count])
        valid_subset = Subset(valid_dataset, permutation[training_count:])
    else:
        train_subset = train_dataset
        valid_subset = None

    workers = 0 if device.type == "mps" else 4
    train_loader = DataLoader(
        train_subset, batch_size=batch_size, shuffle=True, num_workers=workers,
        pin_memory=(device.type == "cuda"), persistent_workers=(workers > 0),
    )
    valid_loader = None
    if valid_subset is not None:
        valid_loader = DataLoader(
            valid_subset, batch_size=batch_size, shuffle=False, num_workers=workers,
            pin_memory=(device.type == "cuda"), persistent_workers=(workers > 0),
        )
    return train_loader, valid_loader


def train(
    config: PlateTrainConfig,
    on_epoch: Callable[[EpochResult], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> tuple[Path, list[EpochResult]]:
    seed_everything(config.seed)

    if not config.image_dir.exists():
        raise FileNotFoundError(f"Image folder not found: {config.image_dir}")
    if not config.label_dir.exists():
        raise FileNotFoundError(f"Label folder not found: {config.label_dir}")

    samples = find_plate_samples(config.image_dir, config.label_dir)
    if not samples:
        raise RuntimeError(
            "No plate masks found. In ui.py draw a mask around the plate and click "
            "'Save Plate Mask' to write <stem>.mask.json into the plate label folder "
            "(default plate_label/)."
        )

    device = get_device()
    print(f"Using device: {device}")
    print(f"Found {len(samples)} plate mask(s).")

    train_loader, valid_loader = make_loaders(
        samples=samples, img_size=config.img_size, batch_size=config.batch_size,
        validation_fraction=config.validation_fraction, device=device, seed=config.seed,
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
                "base_channels": config.base_channels,
                "label_format": "plate_mask",
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
    parser = argparse.ArgumentParser(description="Train plate-segmentation U-Net.")
    parser.add_argument("--image-dir", type=Path, default=Path("plate_image"))
    parser.add_argument("--label-dir", type=Path, default=Path("plate_label"))
    parser.add_argument("--output", type=Path, default=Path("plate_unet.pt"))
    parser.add_argument("--img-size", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--base-channels", type=int, default=16)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = PlateTrainConfig(
        image_dir=args.image_dir, label_dir=args.label_dir, output=args.output,
        img_size=args.img_size, epochs=args.epochs, batch_size=args.batch_size,
        lr=args.lr, base_channels=args.base_channels,
        validation_fraction=args.validation_fraction, seed=args.seed,
    )
    train(config)


if __name__ == "__main__":
    main()
