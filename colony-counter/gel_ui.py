"""Gel lane labeling UI.

You mark the LANES (the visible sample bands) - the model learns those, since a
lane has image features to key off, unlike the empty gap a divider sits in.
Dividers are derived afterwards as the midpoints between neighbouring lanes.

Features
--------
- Open a gel image folder and pick images from the left list.
- Straighten the gel (rotation), then single-click each lane to drop a line.
- Each lane has a TOP and a BOTTOM vertex handle, draggable horizontally
  only - move them to tilt the line onto the band (two points make a line).
- Right click a handle to delete that lane. Undo / clear all.
- Save labels as JSON (+ CSV). Train a U-Net and run inference, then correct
  the predicted lanes and retrain (mirrors the colony counter workflow).

Install:
    python -m pip install PySide6           # labeling only
    python -m pip install torch opencv-python numpy pandas tqdm   # + train/infer

Run:
    python gel_ui.py
"""

from __future__ import annotations

import csv
import json
import math
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from PySide6.QtCore import QThread, QTimer, QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QAction, QBrush, QColor, QImage, QKeySequence, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QComboBox,
    QDockWidget,
    QDoubleSpinBox,
    QFileDialog,
    QGraphicsEllipseItem,
    QGraphicsItem,
    QGraphicsLineItem,
    QGraphicsPixmapItem,
    QGraphicsScene,
    QGraphicsView,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QRadioButton,
    QScrollArea,
    QSpinBox,
    QStatusBar,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

# Reuse the colony counter's loss plot widget.
from ui import LossCurveWidget

DEFAULT_CHECKPOINT = Path("gel_lane_unet.pt")
HANDLE_RADIUS = 8  # device pixels (handles ignore the view zoom)


def _x_at_y(p1: tuple[float, float], p2: tuple[float, float], y: float) -> float:
    """x coordinate of the line through p1, p2 at the given y (extrapolated)."""
    (x1, y1), (x2, y2) = p1, p2
    dy = y2 - y1
    if abs(dy) < 1e-6:
        return x1  # near-horizontal line: degenerate, fall back to an endpoint
    t = (y - y1) / dy
    return x1 + t * (x2 - x1)


def _apply(matrix: tuple, x: float, y: float) -> tuple[float, float]:
    """Apply a 2x3 affine (a, b, tx, c, d, ty) to a point."""
    a, b, tx, c, d, ty = matrix
    return (a * x + b * y + tx, c * x + d * y + ty)


def _pair_midpoints(lines: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Midpoint line of each adjacent pair (two dividers -> one lane center)."""
    ordered = sorted(lines, key=lambda line: 0.5 * (line[0] + line[1]))
    return [
        (0.5 * (a_top + b_top), 0.5 * (a_bottom + b_bottom))
        for (a_top, a_bottom), (b_top, b_bottom) in zip(ordered, ordered[1:])
    ]


_IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)


@dataclass
class Lane:
    x_top: float
    x_bottom: float


class LaneHandle(QGraphicsEllipseItem):
    """A draggable vertex locked to a fixed y (top or bottom edge); only x moves."""

    def __init__(self, lane_item: "LaneItem", y_fixed: float) -> None:
        super().__init__(-HANDLE_RADIUS, -HANDLE_RADIUS, 2 * HANDLE_RADIUS, 2 * HANDLE_RADIUS)
        self.lane_item = lane_item
        self.y_fixed = y_fixed
        self.setFlag(QGraphicsItem.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.setFlag(QGraphicsItem.ItemIgnoresTransformations, True)  # constant on-screen size
        self.setZValue(10)
        self.setPen(QPen(QColor(255, 255, 255), 2))
        self.setBrush(QBrush(QColor(0, 180, 255, 230)))
        self.setCursor(Qt.SizeHorCursor)

    def itemChange(self, change, value):  # noqa: N802 - Qt override name
        if change == QGraphicsItem.ItemPositionChange and self.scene() is not None:
            rect = self.scene().sceneRect()
            x = min(max(value.x(), rect.left()), rect.right())
            return QPointF(x, self.y_fixed)  # lock y, clamp x to the image
        if change == QGraphicsItem.ItemPositionHasChanged and self.lane_item is not None:
            self.lane_item.refresh_line()
            self.lane_item.notify_changed()
        return super().itemChange(change, value)


class LaneItem:
    """Holds the line plus the two vertex handles for one lane."""

    def __init__(self, scene: QGraphicsScene, x_top: float, x_bottom: float, height: float, on_changed) -> None:
        self.scene = scene
        self.height = height
        self.on_changed = on_changed

        self.line = QGraphicsLineItem()
        self.line.setPen(QPen(QColor(0, 180, 255), 2))
        self.line.setZValue(5)

        self.top = LaneHandle(self, 0.0)
        self.bottom = LaneHandle(self, height)
        self.top.setPos(x_top, 0.0)
        self.bottom.setPos(x_bottom, height)

        scene.addItem(self.line)
        scene.addItem(self.top)
        scene.addItem(self.bottom)
        self.refresh_line()

    @property
    def x_top(self) -> float:
        return self.top.pos().x()

    @property
    def x_bottom(self) -> float:
        return self.bottom.pos().x()

    def refresh_line(self) -> None:
        self.line.setLine(self.top.pos().x(), 0.0, self.bottom.pos().x(), self.height)

    def notify_changed(self) -> None:
        if self.on_changed is not None:
            self.on_changed()

    def remove(self) -> None:
        for item in (self.line, self.top, self.bottom):
            self.scene.removeItem(item)


class GelGraphicsView(QGraphicsView):
    lane_added = Signal(float)            # scene x of a new vertical lane
    lane_delete_requested = Signal(object)  # a LaneItem
    cursor_moved = Signal(QPointF)

    def __init__(self, scene: QGraphicsScene):
        super().__init__(scene)
        self.setRenderHint(QPainter.Antialiasing, True)
        self.setRenderHint(QPainter.SmoothPixmapTransform, True)
        self.setDragMode(QGraphicsView.NoDrag)
        self.setMouseTracking(True)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.mode = "add"  # "add" or "adjust"

    def set_mode(self, mode: str) -> None:
        self.mode = mode

    def mousePressEvent(self, event):  # noqa: N802 - Qt override name
        item = self.itemAt(event.position().toPoint())

        if event.button() == Qt.RightButton:
            if isinstance(item, LaneHandle):
                self.lane_delete_requested.emit(item.lane_item)
                return
            super().mousePressEvent(event)
            return

        if event.button() == Qt.LeftButton:
            if isinstance(item, LaneHandle):
                super().mousePressEvent(event)  # let the handle drag
                return
            if self.mode == "add":
                scene_point = self.mapToScene(event.position().toPoint())
                self.lane_added.emit(scene_point.x())
                return

        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):  # noqa: N802 - Qt override name
        self.cursor_moved.emit(self.mapToScene(event.position().toPoint()))
        super().mouseMoveEvent(event)

    def wheelEvent(self, event):  # noqa: N802 - Qt override name
        factor = 1.15 if event.angleDelta().y() > 0 else 1.0 / 1.15
        self.scale(factor, factor)


class GelTrainWorker(QThread):
    """Runs gel training off the GUI thread (see TrainWorker in ui.py for the
    main-thread import requirement and the large stack size)."""

    epoch_done = Signal(int, float, float)
    finished_ok = Signal(str)
    failed = Signal(str)

    def __init__(self, params: dict) -> None:
        super().__init__()
        self._params = params
        self._stop = False
        self.setStackSize(128 * 1024 * 1024)

    def request_stop(self) -> None:
        self._stop = True

    def run(self) -> None:  # noqa: D401 - QThread entry point
        try:
            from gel_training import GelTrainConfig, train  # torch must be imported on main thread first

            config = GelTrainConfig(**self._params)

            def on_epoch(result) -> None:
                valid = float("nan") if result.valid_loss is None else float(result.valid_loss)
                self.epoch_done.emit(int(result.epoch), float(result.train_loss), valid)

            checkpoint_path, _ = train(config, on_epoch=on_epoch, should_stop=lambda: self._stop)
            self.finished_ok.emit(str(checkpoint_path))
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(f"{type(exc).__name__}: {exc}")


class GelLabelerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Gel Lane Labeler")
        self.resize(1200, 800)

        self.image_path: Optional[Path] = None
        self.image_folder: Optional[Path] = None
        self.image_paths: list[Path] = []
        self.image_height: float = 0.0   # height of the (possibly rotated) display canvas
        self.dirty = False
        self.pixmap_item: Optional[QGraphicsPixmapItem] = None
        self.lanes: list[LaneItem] = []

        # Rotation ("straighten") state. Lanes are stored in the STRAIGHTENED
        # frame (what the model trains on); the same cv2 rotation is used here and
        # in gel_training, so the frames match exactly.
        self.angle: float = 0.0
        self.raw_pixmap: Optional[QPixmap] = None
        self.raw_bgr = None                    # cached cv2 image, loaded lazily when rotating
        self.raw_width: int = 0
        self.raw_height: int = 0
        self._M = _IDENTITY                    # raw -> straightened (2x3 affine, 6 floats)
        self._M_inv = _IDENTITY                # straightened -> raw
        self.corrected_width: int = 0
        self.corrected_height: float = 0.0

        self.checkpoint_path: Path = DEFAULT_CHECKPOINT
        self.label_folder: Optional[Path] = None
        self.detected_label_dir: Optional[Path] = None
        self.train_worker: Optional[GelTrainWorker] = None

        self.scene = QGraphicsScene(self)
        self.view = GelGraphicsView(self.scene)
        self.view.lane_added.connect(self.add_lane_at)
        self.view.lane_delete_requested.connect(self.delete_lane)
        self.view.cursor_moved.connect(self.update_cursor_status)

        self.status = QStatusBar(self)
        self.setStatusBar(self.status)

        self.count_label = QLabel("Lanes: 0  (dividers: 0)")
        self.coord_label = QLabel("x: -, y: -")

        left_panel = self._build_left_panel()
        side_panel = self._build_side_panel()
        side_scroll = QScrollArea(self)
        side_scroll.setWidget(side_panel)
        side_scroll.setWidgetResizable(True)
        side_scroll.setFixedWidth(290)
        side_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        root = QWidget(self)
        layout = QHBoxLayout(root)
        layout.addWidget(left_panel)
        layout.addWidget(self.view, stretch=1)
        layout.addWidget(side_scroll)
        self.setCentralWidget(root)

        self._build_toolbar()
        self._build_training_dock()
        self._update_status()
        QTimer.singleShot(0, self.show_startup_folder_hint)

    # ----- panels -----
    def _build_toolbar(self) -> None:
        toolbar = QToolBar("Main", self)
        self.addToolBar(toolbar)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        file_menu = self.menuBar().addMenu("File")

        open_folder_action = QAction("Open Folder", self)
        open_folder_action.setShortcut(QKeySequence.Open)
        open_folder_action.triggered.connect(self.open_image_folder)
        toolbar.addAction(open_folder_action)
        file_menu.addAction(open_folder_action)

        save_action = QAction("Save Labels", self)
        save_action.setShortcut(QKeySequence.Save)
        save_action.triggered.connect(self.save_labels)
        toolbar.addAction(save_action)
        file_menu.addAction(save_action)

        undo_action = QAction("Undo Lane", self)
        undo_action.setShortcut(QKeySequence.Undo)
        undo_action.triggered.connect(self.undo_lane)
        toolbar.addAction(undo_action)

        fit_action = QAction("Fit Image", self)
        fit_action.triggered.connect(self.fit_image)
        toolbar.addAction(fit_action)

    def _build_left_panel(self) -> QWidget:
        panel = QWidget(self)
        panel.setFixedWidth(280)
        layout = QVBoxLayout(panel)

        open_folder_button = QPushButton("Open Gel Image Folder")
        open_folder_button.clicked.connect(self.open_image_folder)
        open_folder_button.setMinimumHeight(42)
        open_folder_button.setStyleSheet("font-weight: 600;")
        layout.addWidget(open_folder_button)

        self.folder_label = QLabel("No folder opened")
        self.folder_label.setWordWrap(True)
        layout.addWidget(self.folder_label)

        self.image_list = QListWidget()
        self.image_list.currentItemChanged.connect(self.on_image_selected)
        layout.addWidget(self.image_list, stretch=1)

        return panel

    def _build_side_panel(self) -> QWidget:
        panel = QWidget(self)
        layout = QVBoxLayout(panel)

        save_button = QPushButton("Save Labels")
        save_button.clicked.connect(self.save_labels)
        layout.addWidget(save_button)

        layout.addSpacing(8)
        layout.addWidget(QLabel("Interaction mode"))
        self.add_radio = QRadioButton("Add lanes (click)")
        self.adjust_radio = QRadioButton("Adjust only (drag vertices)")
        self.add_radio.setChecked(True)
        group = QButtonGroup(self)
        group.addButton(self.add_radio)
        group.addButton(self.adjust_radio)
        self.add_radio.toggled.connect(lambda on: on and self.view.set_mode("add"))
        self.adjust_radio.toggled.connect(lambda on: on and self.view.set_mode("adjust"))
        layout.addWidget(self.add_radio)
        layout.addWidget(self.adjust_radio)

        layout.addSpacing(8)
        layout.addWidget(QLabel("Straighten (rotate degrees)"))
        rotate_row = QHBoxLayout()
        self.rotation_spin = QDoubleSpinBox()
        self.rotation_spin.setRange(-180.0, 180.0)
        self.rotation_spin.setSingleStep(0.5)
        self.rotation_spin.setDecimals(1)
        self.rotation_spin.setSuffix(" deg")
        self.rotation_spin.valueChanged.connect(self.set_angle)
        rotate_row.addWidget(self.rotation_spin)
        reset_button = QPushButton("0")
        reset_button.setFixedWidth(34)
        reset_button.clicked.connect(lambda: self.rotation_spin.setValue(0.0))
        rotate_row.addWidget(reset_button)
        minus90 = QPushButton("-90")
        minus90.setFixedWidth(42)
        minus90.clicked.connect(lambda: self.rotation_spin.setValue(self.rotation_spin.value() - 90.0))
        rotate_row.addWidget(minus90)
        plus90 = QPushButton("+90")
        plus90.setFixedWidth(42)
        plus90.clicked.connect(lambda: self.rotation_spin.setValue(self.rotation_spin.value() + 90.0))
        rotate_row.addWidget(plus90)
        layout.addLayout(rotate_row)

        undo_button = QPushButton("Undo Last Lane")
        undo_button.clicked.connect(self.undo_lane)
        layout.addWidget(undo_button)

        clear_button = QPushButton("Clear Lanes")
        clear_button.clicked.connect(self.clear_lanes)
        layout.addWidget(clear_button)

        layout.addSpacing(12)
        layout.addWidget(self._build_model_group())

        layout.addSpacing(12)
        layout.addWidget(self.count_label)
        layout.addWidget(self.coord_label)
        layout.addStretch(1)

        help_text = QLabel(
            "Workflow:\n"
            "1. Open a gel image folder.\n"
            "2. Straighten the gel (rotation), if tilted.\n"
            "3. Click on each lane (the sample band) to drop a line.\n"
            "4. Drag the top / bottom handle sideways to tilt onto the band.\n"
            "5. Right click a handle to delete a lane.\n"
            "6. Save, train, then Run Inference and correct.\n"
            "   (dividers are derived between lanes)\n\n"
            "Wheel: zoom   Ctrl+Z: undo   Ctrl+S: save"
        )
        help_text.setWordWrap(True)
        layout.addWidget(help_text)
        return panel

    def _build_model_group(self) -> QWidget:
        group = QGroupBox("Model / inference")
        layout = QVBoxLayout(group)

        self.checkpoint_label = QLabel(self._checkpoint_text())
        self.checkpoint_label.setWordWrap(True)
        layout.addWidget(self.checkpoint_label)

        load_button = QPushButton("Load Checkpoint...")
        load_button.clicked.connect(self.load_checkpoint)
        layout.addWidget(load_button)

        threshold_row = QHBoxLayout()
        threshold_row.addWidget(QLabel("Ridge prominence"))
        self.threshold_spin = QDoubleSpinBox()
        self.threshold_spin.setRange(0.0, 1.0)
        self.threshold_spin.setSingleStep(0.02)
        self.threshold_spin.setValue(0.1)
        threshold_row.addWidget(self.threshold_spin)
        layout.addLayout(threshold_row)

        self.infer_button = QPushButton("Run Inference (current image)")
        self.infer_button.clicked.connect(self.run_inference)
        layout.addWidget(self.infer_button)

        hint = QLabel("Predictions become editable lanes. Correct, save, retrain.")
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #666;")
        layout.addWidget(hint)
        return group

    def _build_training_dock(self) -> None:
        dock = QDockWidget("Training", self)
        dock.setFeatures(QDockWidget.DockWidgetMovable | QDockWidget.DockWidgetFloatable)
        container = QWidget(dock)
        outer = QHBoxLayout(container)

        controls = QVBoxLayout()
        controls.setSpacing(6)

        epochs_row = QHBoxLayout()
        epochs_row.addWidget(QLabel("Epochs"))
        self.epochs_spin = QSpinBox()
        self.epochs_spin.setRange(1, 2000)
        self.epochs_spin.setValue(60)
        epochs_row.addWidget(self.epochs_spin)
        controls.addLayout(epochs_row)

        size_row = QHBoxLayout()
        size_row.addWidget(QLabel("Image size"))
        self.img_size_combo = QComboBox()
        self.img_size_combo.addItems(["256", "512", "768", "1024"])
        self.img_size_combo.setCurrentText("512")
        size_row.addWidget(self.img_size_combo)
        controls.addLayout(size_row)

        self.label_dir_button = QPushButton("Label folder: (image folder)")
        self.label_dir_button.clicked.connect(self.choose_label_folder)
        controls.addWidget(self.label_dir_button)

        self.train_button = QPushButton("Train Model")
        self.train_button.setMinimumHeight(38)
        self.train_button.setStyleSheet("font-weight: 600;")
        self.train_button.clicked.connect(self.start_training)
        controls.addWidget(self.train_button)

        self.stop_button = QPushButton("Stop")
        self.stop_button.setEnabled(False)
        self.stop_button.clicked.connect(self.stop_training)
        controls.addWidget(self.stop_button)

        self.train_status_label = QLabel("Idle.")
        self.train_status_label.setWordWrap(True)
        controls.addWidget(self.train_status_label)
        controls.addStretch(1)

        controls_widget = QWidget(container)
        controls_widget.setLayout(controls)
        controls_widget.setFixedWidth(240)

        self.loss_curve = LossCurveWidget(container)
        outer.addWidget(controls_widget)
        outer.addWidget(self.loss_curve, stretch=1)
        dock.setWidget(container)
        self.addDockWidget(Qt.BottomDockWidgetArea, dock)

    def show_startup_folder_hint(self) -> None:
        if self.image_folder is not None:
            return
        reply = QMessageBox.question(
            self,
            "Open gel image folder?",
            "Open a folder containing your gel images now?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if reply == QMessageBox.Yes:
            self.open_image_folder()

    # ----- folder / image loading -----
    def open_image_folder(self) -> None:
        start_dir = str(self.image_folder or Path.home())
        folder_name = QFileDialog.getExistingDirectory(self, "Open Gel Image Folder", start_dir, QFileDialog.ShowDirsOnly)
        if not folder_name:
            return
        self.image_folder = Path(folder_name)
        self.load_image_folder(self.image_folder)

    def load_image_folder(self, folder: Path) -> None:
        suffixes = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
        self.image_paths = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in suffixes)

        self.image_list.blockSignals(True)
        self.image_list.clear()
        for image_path in self.image_paths:
            item = QListWidgetItem(image_path.name)
            item.setData(Qt.UserRole, str(image_path))
            self.image_list.addItem(item)
        self.image_list.blockSignals(False)

        self.folder_label.setText(f"{folder}\n{len(self.image_paths)} image(s)")
        if not self.image_paths:
            QMessageBox.information(self, "No images", "No supported image files were found in this folder.")
            return
        self.image_list.setCurrentRow(0)
        self.load_image_path(self.image_paths[0])

    def on_image_selected(self, current: Optional[QListWidgetItem], previous: Optional[QListWidgetItem]) -> None:
        if current is None:
            return
        image_path = Path(current.data(Qt.UserRole))
        if image_path == self.image_path:
            return
        if self.dirty:
            reply = QMessageBox.question(
                self,
                "Unsaved labels",
                "This image has unsaved lanes. Switch without saving?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                self.image_list.blockSignals(True)
                if previous is not None:
                    self.image_list.setCurrentItem(previous)
                self.image_list.blockSignals(False)
                return
        self.load_image_path(image_path)

    def load_image_path(self, image_path: Path) -> None:
        raw = QPixmap(str(image_path))
        if raw.isNull():
            QMessageBox.warning(self, "Open failed", f"Could not open image:\n{image_path}")
            return

        self.image_path = image_path
        self.raw_pixmap = raw
        self.raw_bgr = None
        self.raw_width = raw.width()
        self.raw_height = raw.height()
        self.lanes = []

        # Read saved labels (straightened-frame lanes + the angle), render at
        # that angle, then place the lanes directly (same frame they were saved in).
        angle, lanes = self._read_label_data(image_path)
        self.angle = angle
        self.rotation_spin.blockSignals(True)
        self.rotation_spin.setValue(angle)
        self.rotation_spin.blockSignals(False)

        self._render_current()
        for x_top, x_bottom in lanes:
            item = LaneItem(self.scene, x_top=x_top, x_bottom=x_bottom, height=self.image_height, on_changed=self._mark_dirty)
            self.lanes.append(item)

        self.dirty = False
        self.fit_image()
        self._update_status()

    def _render_current(self) -> bool:
        """(Re)draw the image straightened by self.angle and refresh the affine
        transforms. Existing lane graphics are wiped by scene.clear(); callers
        rebuild them. Returns False if rotation was requested but cv2 is missing."""
        if self.raw_pixmap is None:
            return True

        if self.angle % 360.0 == 0.0:
            corrected = self.raw_pixmap
            self._M = _IDENTITY
            self._M_inv = _IDENTITY
            cw, ch = self.raw_width, self.raw_height
        else:
            try:
                import cv2
                import numpy as np
                from gel_geometry import rotation_matrix
            except Exception as exc:  # noqa: BLE001
                QMessageBox.warning(
                    self, "Rotation needs OpenCV",
                    "Straightening needs opencv + numpy installed:\n"
                    "python -m pip install opencv-python numpy\n\n"
                    f"Import error: {exc}\n\nReverting to 0 degrees.",
                )
                return False
            if self.raw_bgr is None:
                self.raw_bgr = cv2.imread(str(self.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            matrix, cw, ch = rotation_matrix(self.raw_width, self.raw_height, self.angle)
            rotated = cv2.warpAffine(self.raw_bgr, matrix, (cw, ch), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
            corrected = self._bgr_to_pixmap(rotated)
            m = matrix.reshape(-1).tolist()
            self._M = (m[0], m[1], m[2], m[3], m[4], m[5])
            inv = cv2.invertAffineTransform(matrix).reshape(-1).tolist()
            self._M_inv = (inv[0], inv[1], inv[2], inv[3], inv[4], inv[5])

        self.corrected_width = int(cw)
        self.corrected_height = float(ch)
        self.image_height = float(ch)

        self.scene.clear()
        self.pixmap_item = self.scene.addPixmap(corrected)
        self.pixmap_item.setZValue(0)
        self.scene.setSceneRect(QRectF(corrected.rect()))
        return True

    @staticmethod
    def _bgr_to_pixmap(bgr) -> QPixmap:
        import cv2
        import numpy as np

        rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        height, width = rgb.shape[:2]
        image = QImage(rgb.data, width, height, 3 * width, QImage.Format_RGB888)
        return QPixmap.fromImage(image.copy())

    def set_angle(self, angle: float) -> None:
        if self.raw_pixmap is None:
            return
        # Preserve lanes across the rotation by going through their raw coords.
        raws = [self._lane_to_raw(item) for item in self.lanes]
        changed = abs(float(angle) - self.angle) > 1e-9
        self.angle = float(angle)
        if not self._render_current():  # cv2 missing -> revert to 0
            self.angle = 0.0
            self.rotation_spin.blockSignals(True)
            self.rotation_spin.setValue(0.0)
            self.rotation_spin.blockSignals(False)
            self._render_current()
        self.lanes = []  # old graphics were cleared by _render_current
        for x_top, x_bottom in raws:
            self._add_lane_from_raw(x_top, x_bottom)
        if changed:
            self.dirty = True
        self.fit_image()
        self._update_status()

    def _lane_to_raw(self, item: LaneItem) -> tuple[float, float]:
        """Map a lane (straightened frame) back to raw (x_top@y=0, x_bottom@y=H)."""
        p_top = _apply(self._M_inv, item.x_top, 0.0)
        p_bottom = _apply(self._M_inv, item.x_bottom, item.height)
        x_top = _x_at_y(p_top, p_bottom, 0.0)
        x_bottom = _x_at_y(p_top, p_bottom, float(self.raw_height))
        return x_top, x_bottom

    def _add_lane_from_raw(self, x_top: float, x_bottom: float) -> None:
        """Create a lane from raw (x_top, x_bottom), mapped into the straightened frame."""
        p_top = _apply(self._M, x_top, 0.0)
        p_bottom = _apply(self._M, x_bottom, float(self.raw_height))
        x_top_c = _x_at_y(p_top, p_bottom, 0.0)
        x_bottom_c = _x_at_y(p_top, p_bottom, self.corrected_height)
        item = LaneItem(self.scene, x_top=x_top_c, x_bottom=x_bottom_c, height=self.image_height, on_changed=self._mark_dirty)
        self.lanes.append(item)

    def fit_image(self) -> None:
        if self.pixmap_item is not None:
            self.view.fitInView(self.pixmap_item, Qt.KeepAspectRatio)

    # ----- lane editing -----
    def add_lane_at(self, x: float) -> None:
        if self.pixmap_item is None:
            return
        x = min(max(x, 0.0), float(self.pixmap_item.pixmap().width()))
        item = LaneItem(self.scene, x_top=x, x_bottom=x, height=self.image_height, on_changed=self._mark_dirty)
        self.lanes.append(item)
        self.dirty = True
        self._update_status()

    def delete_lane(self, lane_item: LaneItem) -> None:
        if lane_item in self.lanes:
            lane_item.remove()
            self.lanes.remove(lane_item)
            self.dirty = True
            self._update_status()

    def undo_lane(self) -> None:
        if not self.lanes:
            return
        self.lanes.pop().remove()
        self.dirty = True
        self._update_status()

    def clear_lanes(self) -> None:
        if not self.lanes:
            return
        reply = QMessageBox.question(
            self, "Clear lanes?", "Remove all lanes from this image?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return
        for item in self.lanes:
            item.remove()
        self.lanes.clear()
        self.dirty = True
        self._update_status()

    def _mark_dirty(self) -> None:
        self.dirty = True
        self._update_status()

    def _set_lanes_from_predictions(self, predicted: list[tuple[float, float]]) -> None:
        # Predictions are already in the straightened frame (inference rotated the
        # image by the same angle), so place them directly.
        for item in self.lanes:
            item.remove()
        self.lanes = []
        for x_top, x_bottom in predicted:
            item = LaneItem(self.scene, x_top=x_top, x_bottom=x_bottom, height=self.image_height, on_changed=self._mark_dirty)
            self.lanes.append(item)
        self.dirty = True
        self._update_status()

    # ----- save / load -----
    def save_labels(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a gel image before saving labels.")
            return

        default_path = self.image_path.with_suffix(".lanes.json")
        file_name, _ = QFileDialog.getSaveFileName(
            self, "Save Lane Labels", str(default_path), "JSON label file (*.json);;All Files (*)"
        )
        if not file_name:
            return
        json_path = Path(file_name)
        if json_path.suffix.lower() != ".json":
            json_path = json_path.with_suffix(".json")

        # Store lanes in the STRAIGHTENED frame plus the angle, so training and
        # inference straighten the image the same way and the lanes line up.
        lanes = sorted(
            (Lane(item.x_top, item.x_bottom) for item in self.lanes),
            key=lambda d: 0.5 * (d.x_top + d.x_bottom),
        )
        payload = {
            "image": str(self.image_path),
            "image_name": self.image_path.name,
            "image_width": self.raw_width,
            "image_height": self.raw_height,
            "rotation": self.angle,
            "corrected_width": self.corrected_width,
            "corrected_height": int(self.corrected_height),
            "lanes": [asdict(d) for d in lanes],
            "lane_count": len(lanes),
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        csv_path = json_path.with_suffix(".csv")
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["x_top", "x_bottom"])
            writer.writeheader()
            for d in lanes:
                writer.writerow({"x_top": f"{d.x_top:.3f}", "x_bottom": f"{d.x_bottom:.3f}"})

        self.dirty = False
        self.detected_label_dir = json_path.parent
        self._refresh_label_dir_button()
        self._update_status()
        QMessageBox.information(self, "Labels saved", f"Saved:\n{json_path}\n{csv_path}\n\nLanes: {len(lanes)}")

    def _find_label_file(self, image_path: Path) -> Optional[Path]:
        stem = image_path.stem
        candidate_dirs: list[Path] = []
        if self.label_folder is not None:
            candidate_dirs.append(self.label_folder)
        candidate_dirs.append(image_path.parent)
        candidate_dirs.append(image_path.parent.parent / "gel_label")

        seen: set[Path] = set()
        for directory in candidate_dirs:
            if directory in seen or not directory.is_dir():
                continue
            seen.add(directory)
            # Prefer new lane labels, fall back to older divider labels.
            for suffix in (".lanes.json", ".lanes.csv", ".dividers.json", ".dividers.csv"):
                candidate = directory / f"{stem}{suffix}"
                if candidate.exists():
                    return candidate
        return None

    def _read_label_data(self, image_path: Path) -> tuple[float, list[tuple[float, float]]]:
        """Return (rotation_angle, straightened-frame lane lines). Empty/0 if none.
        Old divider labels are converted to lane centers (midpoint of each pair)."""
        label_path = self._find_label_file(image_path)
        if label_path is None:
            return 0.0, []
        is_divider = ".dividers." in label_path.name.lower()
        try:
            if label_path.suffix.lower() == ".csv":
                with label_path.open(newline="", encoding="utf-8") as f:
                    lines = [(float(r["x_top"]), float(r["x_bottom"])) for r in csv.DictReader(f)]
                angle = 0.0  # CSV does not carry the angle
            else:
                payload = json.loads(label_path.read_text(encoding="utf-8"))
                key = "dividers" if is_divider else "lanes"
                lines = [(float(d["x_top"]), float(d["x_bottom"])) for d in payload.get(key, [])]
                angle = float(payload.get("rotation", 0.0))
        except (ValueError, KeyError, OSError) as exc:
            self.status.showMessage(f"Could not read labels: {label_path.name} ({exc})", 4000)
            return 0.0, []

        note = ""
        if is_divider:
            lines = _pair_midpoints(lines)  # two dividers -> one lane center
            note = " (converted from dividers)"

        self.detected_label_dir = label_path.parent
        self._refresh_label_dir_button()
        self.status.showMessage(f"Loaded {len(lines)} lane(s) from {label_path.name}{note}", 4000)
        return angle, lines

    # ----- model: checkpoint, training, inference -----
    def _checkpoint_text(self) -> str:
        status = "ready" if self.checkpoint_path.exists() else "not trained yet"
        return f"Checkpoint: {self.checkpoint_path.name} ({status})"

    def choose_label_folder(self) -> None:
        start_dir = str(self.label_folder or self.detected_label_dir or self.image_folder or Path.home())
        folder_name = QFileDialog.getExistingDirectory(self, "Choose Label Folder", start_dir, QFileDialog.ShowDirsOnly)
        if not folder_name:
            return
        self.label_folder = Path(folder_name)
        self._refresh_label_dir_button()

    def _effective_label_dir(self) -> Optional[Path]:
        return self.label_folder or self.detected_label_dir or self.image_folder

    def _refresh_label_dir_button(self) -> None:
        if not hasattr(self, "label_dir_button"):
            return
        if self.label_folder is not None:
            self.label_dir_button.setText(f"Label folder: {self.label_folder.name}")
        elif self.detected_label_dir is not None:
            self.label_dir_button.setText(f"Label folder: {self.detected_label_dir.name} (auto)")
        else:
            self.label_dir_button.setText("Label folder: (image folder)")

    def load_checkpoint(self) -> None:
        file_name, _ = QFileDialog.getOpenFileName(
            self, "Load Checkpoint",
            str(self.checkpoint_path.parent if self.checkpoint_path.exists() else Path.cwd()),
            "PyTorch checkpoint (*.pt *.pth);;All Files (*)",
        )
        if not file_name:
            return
        self.checkpoint_path = Path(file_name)
        self.checkpoint_label.setText(self._checkpoint_text())

    def start_training(self) -> None:
        if self.train_worker is not None and self.train_worker.isRunning():
            return
        if self.image_folder is None:
            QMessageBox.information(self, "No folder", "Open a gel image folder first.")
            return

        try:
            import gel_training  # noqa: F401 - load torch on the MAIN thread first
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(
                self, "Training libraries missing",
                "Training needs torch + opencv installed:\n"
                "python -m pip install torch opencv-python numpy pandas tqdm\n\n"
                f"Import error: {exc}",
            )
            return

        params = dict(
            image_dir=self.image_folder,
            label_dir=self._effective_label_dir() or self.image_folder,
            output=self.checkpoint_path,
            img_size=int(self.img_size_combo.currentText()),
            epochs=int(self.epochs_spin.value()),
        )
        self.loss_curve.reset()
        self.train_button.setEnabled(False)
        self.stop_button.setEnabled(True)
        self.train_status_label.setText("Starting... (first epoch loads torch and data)")

        self.train_worker = GelTrainWorker(params)
        self.train_worker.epoch_done.connect(self.on_epoch_done)
        self.train_worker.finished_ok.connect(self.on_train_finished)
        self.train_worker.failed.connect(self.on_train_failed)
        self.train_worker.start()

    def stop_training(self) -> None:
        if self.train_worker is not None and self.train_worker.isRunning():
            self.train_worker.request_stop()
            self.train_status_label.setText("Stopping after the current epoch...")
            self.stop_button.setEnabled(False)

    def on_epoch_done(self, epoch: int, train_loss: float, valid_loss: float) -> None:
        valid = None if math.isnan(valid_loss) else valid_loss
        self.loss_curve.add_point(epoch, train_loss, valid)
        if valid is None:
            self.train_status_label.setText(f"Epoch {epoch} - train {train_loss:.5f}")
        else:
            self.train_status_label.setText(f"Epoch {epoch} - train {train_loss:.5f} - valid {valid:.5f}")

    def on_train_finished(self, checkpoint_path: str) -> None:
        self.checkpoint_path = Path(checkpoint_path)
        self.checkpoint_label.setText(self._checkpoint_text())
        self.train_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.train_status_label.setText(f"Done. Saved {self.checkpoint_path.name}")
        QMessageBox.information(self, "Training complete", f"Best checkpoint saved to:\n{self.checkpoint_path}")

    def on_train_failed(self, message: str) -> None:
        self.train_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.train_status_label.setText("Failed.")
        QMessageBox.warning(
            self, "Training failed",
            f"{message}\n\nIf this is an import error, install the training dependencies:\n"
            "python -m pip install torch opencv-python numpy pandas tqdm",
        )

    def run_inference(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a gel image first.")
            return
        if not self.checkpoint_path.exists():
            QMessageBox.information(self, "No checkpoint", "Train a model or load a checkpoint first.")
            return
        if self.lanes:
            reply = QMessageBox.question(
                self, "Replace lanes?",
                "Replace the current lanes with the model's predictions?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                return

        try:
            import cv2
            from training import get_device
            from inference import load_model, predict_heatmap
            from gel_inference import column_prominence, extract_lanes, scale_lanes
            from gel_geometry import rotate_image
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(
                self, "ML libraries missing",
                "Inference needs torch + opencv installed:\n"
                "python -m pip install torch opencv-python numpy pandas tqdm\n\n"
                f"Import error: {exc}",
            )
            return

        self.infer_button.setEnabled(False)
        self.status.showMessage("Running inference...")
        QApplication.processEvents()
        try:
            device = get_device()
            model, img_size, _sigma = load_model(self.checkpoint_path, device)
            image_bgr = cv2.imread(str(self.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            if image_bgr is None:
                QMessageBox.warning(self, "Read failed", f"Could not read image:\n{self.image_path}")
                return
            # Straighten by the current angle so the model sees the same frame it
            # trained on; predictions then land in the displayed (straightened) view.
            image_bgr = rotate_image(image_bgr, self.angle)
            original_width = image_bgr.shape[1]
            heatmap = predict_heatmap(model, image_bgr, img_size, device)
            threshold = float(self.threshold_spin.value())
            lanes = extract_lanes(heatmap, threshold)
            lanes = scale_lanes(lanes, img_size, original_width)
            profile_max = float(column_prominence(heatmap).max())
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(self, "Inference failed", f"{type(exc).__name__}: {exc}")
            return
        finally:
            self.infer_button.setEnabled(True)

        self._set_lanes_from_predictions(lanes)
        if self.lanes:
            QMessageBox.information(
                self, "Inference complete",
                f"The model proposed {len(self.lanes)} lane(s) "
                f"({max(0, len(self.lanes) - 1)} dividers between them).\n\n"
                "Correct them, then Save Labels and retrain.",
            )
        else:
            hint = (
                f"Lower the ridge prominence (now {threshold:.2f}) below {profile_max:.3f} and try again."
                if profile_max < threshold
                else "No ridge stands out from the background - label more gels and retrain (the loss now\n"
                     "weights ridges, so retraining should give sharper predictions)."
            )
            QMessageBox.information(
                self, "No lanes found",
                f"The model proposed 0 lanes.\n\n"
                f"Strongest ridge prominence = {profile_max:.3f}, threshold = {threshold:.2f}.\n\n{hint}",
            )

    # ----- status -----
    def update_cursor_status(self, point: QPointF) -> None:
        self.coord_label.setText(f"x: {point.x():.1f}, y: {point.y():.1f}")

    def _update_status(self) -> None:
        dividers = max(0, len(self.lanes) - 1)
        self.count_label.setText(f"Lanes: {len(self.lanes)}  (dividers: {dividers})")
        image_name = self.image_path.name if self.image_path else "No image loaded"
        dirty_mark = "*" if self.dirty else ""
        self.status.showMessage(f"{dirty_mark}{image_name} | lanes: {len(self.lanes)}")

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt override name
        if self.train_worker is not None and self.train_worker.isRunning():
            self.train_worker.request_stop()
            self.train_worker.wait(15000)
        super().closeEvent(event)


def main() -> None:
    app = QApplication(sys.argv)
    window = GelLabelerWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
