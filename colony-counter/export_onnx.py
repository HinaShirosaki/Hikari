"""Export trained colony-counter U-Net checkpoints to ONNX.

The Electron colony-counter UI loads generated ONNX models through ONNX Runtime
Web. Keep this script next to training.py so it can reuse the exact SmallUNet
definition that produced colony_heatmap_unet.pt and plate_unet.pt.

Run from colony-counter/:
    python3 export_onnx.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from training import SmallUNet


DEFAULT_CHECKPOINT = Path("colony_heatmap_unet.pt")
DEFAULT_OUTPUT = Path("../vendor/colony-counter/colony_heatmap_unet.onnx")


def load_checkpoint(checkpoint_path: Path) -> dict:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
    return torch.load(checkpoint_path, map_location="cpu")


def export_checkpoint(checkpoint_path: Path, output_path: Path, opset: int) -> Path:
    checkpoint = load_checkpoint(checkpoint_path)
    img_size = int(checkpoint.get("img_size", 1024))
    base_channels = int(checkpoint.get("base_channels", 16))

    model = SmallUNet(base_channels=base_channels)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sample = torch.zeros(1, 3, img_size, img_size, dtype=torch.float32)
    torch.onnx.export(
        model,
        sample,
        output_path,
        input_names=["image"],
        output_names=["heatmap"],
        opset_version=opset,
        dynamo=False,
    )

    metadata = {
        "model": output_path.name,
        "checkpoint": checkpoint_path.name,
        "img_size": img_size,
        "sigma": float(checkpoint.get("sigma", 5.0)),
        "base_channels": base_channels,
        "label_format": str(checkpoint.get("label_format", "center_heatmap")),
        "default_threshold": 0.5,
        "default_min_distance": 3,
        "default_plate_threshold": 0.5,
        "input": "RGB float32 NCHW scaled 0..1",
        "output": "single-channel sigmoid heatmap",
    }
    metadata_path = output_path.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export colony heatmap checkpoint to ONNX.")
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--opset", type=int, default=17)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = export_checkpoint(args.checkpoint, args.output, args.opset)
    print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
