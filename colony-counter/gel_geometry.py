"""Shared rotation helpers for the gel tools.

Both the labeler (gel_ui.py) and the model (gel_training.py / gel_inference.py)
rotate images through THIS module, so the straightened frame the user labels in
is byte-for-byte the same frame the model trains and infers on. No torch import
here, so the labeler can use it without the training stack.
"""

from __future__ import annotations

import cv2
import numpy as np


def rotation_matrix(width: int, height: int, angle_deg: float) -> tuple[np.ndarray, int, int]:
    """Affine matrix mapping raw image coords -> straightened (expanded) canvas,
    plus the new canvas (width, height). Rotation is about the image center and
    the canvas is grown so nothing is clipped."""
    center = (width / 2.0, height / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_w = int(round(height * sin + width * cos))
    new_h = int(round(height * cos + width * sin))
    matrix[0, 2] += (new_w - width) / 2.0
    matrix[1, 2] += (new_h - height) / 2.0
    return matrix, new_w, new_h


def rotate_image(image_bgr: np.ndarray, angle_deg: float) -> np.ndarray:
    """Return image_bgr straightened by angle_deg (unchanged when angle is a
    multiple of 360)."""
    if float(angle_deg) % 360.0 == 0.0:
        return image_bgr
    height, width = image_bgr.shape[:2]
    matrix, new_w, new_h = rotation_matrix(width, height, angle_deg)
    return cv2.warpAffine(image_bgr, matrix, (new_w, new_h), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
