

"""Train a colony-center heatmap model from the labeler output.

Expected project layout
-----------------------
colony-counter/
  image/
    plate001.jpg
    plate002.png
  label/
    plate001.labels.json   # preferred, from ui.py
    plate002.csv           # also supported, x,y columns
  training.py

The JSON label format is the one saved by ui.py. CSV labels must have x,y columns.
The model is trained to predict a 1-channel colony-center heatmap.

Install:
    python -m pip install torch torchvision opencv-python pandas numpy tqdm

Run:
    python training.py

Optional:
    python training.py --image-dir image --label-dir label --epochs 80 --img-size 512
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, Subset
from tqdm import tqdm


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
LABEL_SUFFIXES = (".labels.json", ".labels.csv", ".json", ".csv")


@dataclass(frozen=True)
class Sample:
    image_path: Path
    label_path: Path


@dataclass
class TrainingMask:
    kind: Literal["none", "rectangle", "circle"] = "none"
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0

    def contains_xy(self, x: float, y: float) -> bool:
        if self.kind == "none":
            return True

        if self.kind == "rectangle":
            return self.x <= x <= self.x + self.width and self.y <= y <= self.y + self.height

        if self.kind == "circle":
            rx = abs(self.width) / 2.0
            ry = abs(self.height) / 2.0
            if rx <= 0 or ry <= 0:
                return False
            cx = self.x + self.width / 2.0
            cy = self.y + self.height / 2.0
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            return dx * dx + dy * dy <= 1.0

        return True


def get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def find_samples(
    image_dir: Path,
    label_dir: Path,
    label_suffixes: tuple[str, ...] = LABEL_SUFFIXES,
) -> list[Sample]:
    images = sorted(path for path in image_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES)

    samples: list[Sample] = []
    missing_labels: list[str] = []

    for image_path in images:
        label_path = None
        for suffix in label_suffixes:
            candidate = label_dir / f"{image_path.stem}{suffix}"
            if candidate.exists():
                label_path = candidate
                break

        if label_path is None:
            missing_labels.append(image_path.name)
            continue

        samples.append(Sample(image_path=image_path, label_path=label_path))

    if missing_labels:
        print(f"Skipped {len(missing_labels)} image(s) with no label file.")

    return samples


def read_label_file(label_path: Path) -> tuple[np.ndarray, TrainingMask]:
    if label_path.suffix.lower() == ".csv":
        df = pd.read_csv(label_path)
        points = df[["x", "y"]].to_numpy(dtype=np.float32)
        return points, TrainingMask(kind="none")

    payload = json.loads(label_path.read_text(encoding="utf-8"))
    points = np.array(
        [[float(pin["x"]), float(pin["y"])] for pin in payload.get("pins", [])],
        dtype=np.float32,
    )

    mask_payload = payload.get("mask") or {"kind": "none"}
    mask = TrainingMask(
        kind=mask_payload.get("kind", "none"),
        x=float(mask_payload.get("x", 0.0)),
        y=float(mask_payload.get("y", 0.0)),
        width=float(mask_payload.get("width", 0.0)),
        height=float(mask_payload.get("height", 0.0)),
    )

    return points, mask


def draw_gaussian(heatmap: np.ndarray, x: float, y: float, sigma: float) -> None:
    height, width = heatmap.shape
    radius = int(3 * sigma)

    x0 = max(0, int(x) - radius)
    x1 = min(width, int(x) + radius + 1)
    y0 = max(0, int(y) - radius)
    y1 = min(height, int(y) + radius + 1)

    if x0 >= x1 or y0 >= y1:
        return

    xs = np.arange(x0, x1, dtype=np.float32)
    ys = np.arange(y0, y1, dtype=np.float32)
    xs, ys = np.meshgrid(xs, ys)

    gaussian = np.exp(-((xs - x) ** 2 + (ys - y) ** 2) / (2 * sigma**2))
    heatmap[y0:y1, x0:x1] = np.maximum(heatmap[y0:y1, x0:x1], gaussian)


def build_mask_array(mask: TrainingMask, original_width: int, original_height: int, img_size: int) -> np.ndarray:
    mask_array = np.ones((img_size, img_size), dtype=np.float32)

    if mask.kind == "none":
        return mask_array

    scale_x = img_size / original_width
    scale_y = img_size / original_height

    x = mask.x * scale_x
    y = mask.y * scale_y
    width = mask.width * scale_x
    height = mask.height * scale_y

    mask_array.fill(0.0)

    if mask.kind == "rectangle":
        x0 = max(0, int(round(x)))
        y0 = max(0, int(round(y)))
        x1 = min(img_size, int(round(x + width)))
        y1 = min(img_size, int(round(y + height)))
        mask_array[y0:y1, x0:x1] = 1.0
        return mask_array

    if mask.kind == "circle":
        yy, xx = np.ogrid[:img_size, :img_size]
        cx = x + width / 2.0
        cy = y + height / 2.0
        rx = abs(width) / 2.0
        ry = abs(height) / 2.0
        if rx > 0 and ry > 0:
            inside = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0
            mask_array[inside] = 1.0

    return mask_array


class ColonyHeatmapDataset(Dataset):
    def __init__(self, samples: list[Sample], img_size: int, sigma: float, augment: bool) -> None:
        self.samples = samples
        self.img_size = img_size
        self.sigma = sigma
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        sample = self.samples[index]

        # IGNORE_ORIENTATION: read raw stored pixels (do NOT auto-rotate by EXIF).
        # The labeler (QPixmap) and the saved label coordinates are in this raw
        # frame; applying EXIF here would rotate the image away from its labels.
        image_bgr = cv2.imread(str(sample.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if image_bgr is None:
            raise ValueError(f"Could not read image: {sample.image_path}")

        original_height, original_width = image_bgr.shape[:2]
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        image_rgb = cv2.resize(image_rgb, (self.img_size, self.img_size), interpolation=cv2.INTER_AREA)

        points, mask = read_label_file(sample.label_path)

        scale_x = self.img_size / original_width
        scale_y = self.img_size / original_height

        heatmap = np.zeros((self.img_size, self.img_size), dtype=np.float32)
        train_mask = build_mask_array(mask, original_width, original_height, self.img_size)

        for point_x, point_y in points:
            if mask.contains_xy(float(point_x), float(point_y)):
                draw_gaussian(heatmap, float(point_x) * scale_x, float(point_y) * scale_y, self.sigma)

        if self.augment:
            if random.random() < 0.5:
                image_rgb = np.ascontiguousarray(np.fliplr(image_rgb))
                heatmap = np.ascontiguousarray(np.fliplr(heatmap))
                train_mask = np.ascontiguousarray(np.fliplr(train_mask))

            if random.random() < 0.5:
                image_rgb = np.ascontiguousarray(np.flipud(image_rgb))
                heatmap = np.ascontiguousarray(np.flipud(heatmap))
                train_mask = np.ascontiguousarray(np.flipud(train_mask))

            if random.random() < 0.35:
                factor = random.uniform(0.75, 1.25)
                image_rgb = np.clip(image_rgb.astype(np.float32) * factor, 0, 255).astype(np.uint8)

        image = image_rgb.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))

        return (
            torch.from_numpy(image).float(),
            torch.from_numpy(heatmap[None, :, :]).float(),
            torch.from_numpy(train_mask[None, :, :]).float(),
        )


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class SmallUNet(nn.Module):
    def __init__(self, base_channels: int = 16) -> None:
        super().__init__()
        c = base_channels

        self.enc1 = ConvBlock(3, c)
        self.enc2 = ConvBlock(c, c * 2)
        self.enc3 = ConvBlock(c * 2, c * 4)
        self.enc4 = ConvBlock(c * 4, c * 8)
        self.pool = nn.MaxPool2d(2)

        self.mid = ConvBlock(c * 8, c * 16)

        self.up4 = nn.ConvTranspose2d(c * 16, c * 8, kernel_size=2, stride=2)
        self.dec4 = ConvBlock(c * 16, c * 8)
        self.up3 = nn.ConvTranspose2d(c * 8, c * 4, kernel_size=2, stride=2)
        self.dec3 = ConvBlock(c * 8, c * 4)
        self.up2 = nn.ConvTranspose2d(c * 4, c * 2, kernel_size=2, stride=2)
        self.dec2 = ConvBlock(c * 4, c * 2)
        self.up1 = nn.ConvTranspose2d(c * 2, c, kernel_size=2, stride=2)
        self.dec1 = ConvBlock(c * 2, c)

        self.out = nn.Conv2d(c, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))

        mid = self.mid(self.pool(e4))

        d4 = self.up4(mid)
        d4 = self.dec4(torch.cat([d4, e4], dim=1))
        d3 = self.up3(d4)
        d3 = self.dec3(torch.cat([d3, e3], dim=1))
        d2 = self.up2(d3)
        d2 = self.dec2(torch.cat([d2, e2], dim=1))
        d1 = self.up1(d2)
        d1 = self.dec1(torch.cat([d1, e1], dim=1))

        return torch.sigmoid(self.out(d1))


def masked_mse_loss(prediction: torch.Tensor, target: torch.Tensor, train_mask: torch.Tensor) -> torch.Tensor:
    squared_error = (prediction - target) ** 2
    masked_error = squared_error * train_mask
    return masked_error.sum() / train_mask.sum().clamp_min(1.0)


def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    optimizer: torch.optim.Optimizer | None,
) -> float:
    is_training = optimizer is not None
    model.train(is_training)

    total_loss = 0.0
    total_batches = 0

    pbar = tqdm(loader, desc="train" if is_training else "valid")
    for images, heatmaps, train_masks in pbar:
        images = images.to(device, non_blocking=False)
        # channels_last speeds up CUDA but is unsupported/broken for this net on MPS.
        if device.type == "cuda":
            images = images.to(memory_format=torch.channels_last)
        heatmaps = heatmaps.to(device, non_blocking=False)
        train_masks = train_masks.to(device, non_blocking=False)

        with torch.set_grad_enabled(is_training):
            predictions = model(images)
            loss = masked_mse_loss(predictions, heatmaps, train_masks)

            if is_training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()

        loss_value = float(loss.detach().cpu())
        total_loss += loss_value
        total_batches += 1
        pbar.set_postfix(loss=f"{loss_value:.5f}")

    return total_loss / max(total_batches, 1)


def make_loaders(
    samples: list[Sample],
    img_size: int,
    sigma: float,
    batch_size: int,
    validation_fraction: float,
    device: torch.device,
    seed: int,
) -> tuple[DataLoader, DataLoader | None]:
    train_dataset = ColonyHeatmapDataset(samples, img_size=img_size, sigma=sigma, augment=True)

    if len(samples) >= 5 and validation_fraction > 0:
        validation_count = max(1, int(round(len(samples) * validation_fraction)))
        training_count = len(samples) - validation_count

        # Split the index set, not the dataset object. random_split would hand back
        # two Subsets that share one underlying dataset, so toggling `augment` on the
        # validation Subset would also disable it for training. Two separate dataset
        # instances keep the augment flags independent.
        valid_dataset = ColonyHeatmapDataset(samples, img_size=img_size, sigma=sigma, augment=False)
        generator = torch.Generator().manual_seed(seed)
        permutation = torch.randperm(len(samples), generator=generator).tolist()
        train_subset = Subset(train_dataset, permutation[:training_count])
        valid_subset = Subset(valid_dataset, permutation[training_count:])
    else:
        train_subset = train_dataset
        valid_subset = None

    # MPS often works best with 0 workers for small local image datasets.
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


@dataclass
class TrainConfig:
    image_dir: Path = Path("image")
    label_dir: Path = Path("label")
    output: Path = Path("colony_heatmap_unet.pt")
    img_size: int = 512
    sigma: float = 5.0
    epochs: int = 60
    batch_size: int = 4
    lr: float = 1e-3
    base_channels: int = 16
    validation_fraction: float = 0.15
    seed: int = 42


@dataclass
class EpochResult:
    epoch: int
    train_loss: float
    valid_loss: float | None
    is_best: bool


def train(
    config: TrainConfig,
    on_epoch: Callable[[EpochResult], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> tuple[Path, list[EpochResult]]:
    """Train a model and return (checkpoint_path, per-epoch history).

    ``on_epoch`` is called once per completed epoch (use it to stream metrics to a
    UI). ``should_stop`` is polled after each epoch; return True to stop early.
    """
    seed_everything(config.seed)

    if not config.image_dir.exists():
        raise FileNotFoundError(f"Image folder not found: {config.image_dir}")
    if not config.label_dir.exists():
        raise FileNotFoundError(f"Label folder not found: {config.label_dir}")

    samples = find_samples(config.image_dir, config.label_dir)
    if not samples:
        raise RuntimeError(
            "No image/label pairs found. Label files must have the same stem as images, "
            "for example image/plate001.jpg and label/plate001.labels.json."
        )

    device = get_device()
    print(f"Using device: {device}")
    print(f"Found {len(samples)} labeled image(s).")

    train_loader, valid_loader = make_loaders(
        samples=samples,
        img_size=config.img_size,
        sigma=config.sigma,
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
                "label_format": "center_heatmap",
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
    parser = argparse.ArgumentParser(description="Train colony-center heatmap model.")
    parser.add_argument("--image-dir", type=Path, default=Path("image"), help="Folder containing plate images.")
    parser.add_argument("--label-dir", type=Path, default=Path("label"), help="Folder containing label JSON/CSV files.")
    parser.add_argument("--output", type=Path, default=Path("colony_heatmap_unet.pt"), help="Output checkpoint path.")
    parser.add_argument("--img-size", type=int, default=512, help="Training image size. Use 1024 for dense plates.")
    parser.add_argument("--sigma", type=float, default=5.0, help="Gaussian sigma for each colony-center heatmap dot.")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--base-channels", type=int, default=16)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = TrainConfig(
        image_dir=args.image_dir,
        label_dir=args.label_dir,
        output=args.output,
        img_size=args.img_size,
        sigma=args.sigma,
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