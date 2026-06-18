"""Plate-mask labeling UI (separate from the colony counter).

Label the PLATE region with a rectangle or circle mask and save it as a mask-only
"<stem>.mask.json" for plate_training.py. The mask is fully adjustable: after you
draw it, drag the body to move it and the handles to resize it; switch between
rectangle and circle at any time. Train the plate model and Detect Plate (then
adjust the predicted mask) round out the loop.

Install:
    python -m pip install PySide6           # labeling only
    python -m pip install torch opencv-python numpy pandas tqdm   # + train/detect

Run:
    python plate_ui.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Optional

from PySide6.QtCore import QThread, QTimer, QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QAction, QBrush, QColor, QKeySequence, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QComboBox,
    QDockWidget,
    QFileDialog,
    QGraphicsEllipseItem,
    QGraphicsItem,
    QGraphicsPixmapItem,
    QGraphicsRectItem,
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

from ui import LossCurveWidget

DEFAULT_CHECKPOINT = Path("plate_unet.pt")
HANDLE_SIZE = 10  # device pixels (handles ignore zoom)


class PlateGraphicsView(QGraphicsView):
    """One adjustable mask (rectangle or circle): draw on empty space, drag the
    body to move, drag a handle to resize. All interaction is handled here so a
    single mask stays simple."""

    mask_changed = Signal()
    cursor_moved = Signal(QPointF)

    def __init__(self, scene: QGraphicsScene):
        super().__init__(scene)
        self.setRenderHint(QPainter.Antialiasing, True)
        self.setRenderHint(QPainter.SmoothPixmapTransform, True)
        self.setDragMode(QGraphicsView.NoDrag)
        self.setMouseTracking(True)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)

        self.mask_kind = "circle"
        self.mask_rect: Optional[QRectF] = None
        self.image_rect = QRectF()

        self.body_item: Optional[QGraphicsItem] = None
        self.handle_items: list[QGraphicsRectItem] = []

        self._drag: Optional[str] = None     # "draw" | "move" | "resize"
        self._resize_index = -1
        self._press_scene = QPointF()
        self._rect_at_press = QRectF()

    # ----- public API -----
    def set_image_rect(self, rect: QRectF) -> None:
        self.image_rect = QRectF(rect)

    def set_kind(self, kind: str) -> None:
        self.mask_kind = kind
        self._redraw()
        if self.mask_rect is not None:
            self.mask_changed.emit()

    def set_mask(self, kind: str, rect: Optional[QRectF]) -> None:
        self.mask_kind = kind if kind != "none" else self.mask_kind
        self.mask_rect = QRectF(rect) if rect is not None else None
        self._redraw()

    def clear_mask(self) -> None:
        self.mask_rect = None
        self._redraw()
        self.mask_changed.emit()

    def get_mask(self) -> tuple[str, Optional[QRectF]]:
        if self.mask_rect is None:
            return "none", None
        return self.mask_kind, QRectF(self.mask_rect.normalized())

    # ----- drawing -----
    def _handle_points(self, r: QRectF) -> list[QPointF]:
        cx, cy = r.center().x(), r.center().y()
        return [
            QPointF(r.left(), r.top()), QPointF(cx, r.top()), QPointF(r.right(), r.top()),
            QPointF(r.right(), cy), QPointF(r.right(), r.bottom()), QPointF(cx, r.bottom()),
            QPointF(r.left(), r.bottom()), QPointF(r.left(), cy),
        ]

    def _redraw(self) -> None:
        if self.body_item is not None:
            self.scene().removeItem(self.body_item)
            self.body_item = None
        for handle in self.handle_items:
            self.scene().removeItem(handle)
        self.handle_items = []

        if self.mask_rect is None:
            return

        r = self.mask_rect.normalized()
        pen = QPen(QColor(0, 180, 255))
        pen.setCosmetic(True)
        pen.setWidth(2)
        brush = QBrush(QColor(0, 180, 255, 40))

        self.body_item = QGraphicsRectItem(r) if self.mask_kind == "rectangle" else QGraphicsEllipseItem(r)
        self.body_item.setPen(pen)
        self.body_item.setBrush(brush)
        self.body_item.setZValue(5)
        self.scene().addItem(self.body_item)

        for point in self._handle_points(r):
            handle = QGraphicsRectItem(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
            handle.setPos(point)
            handle.setFlag(QGraphicsItem.ItemIgnoresTransformations, True)
            handle.setBrush(QBrush(QColor(255, 255, 255)))
            handle.setPen(QPen(QColor(0, 120, 200), 1))
            handle.setZValue(10)
            self.scene().addItem(handle)
            self.handle_items.append(handle)

    def _handle_index(self, item) -> int:
        for index, handle in enumerate(self.handle_items):
            if handle is item:
                return index
        return -1

    def _clamp(self, point: QPointF) -> QPointF:
        if self.image_rect.isNull():
            return point
        x = min(max(point.x(), self.image_rect.left()), self.image_rect.right())
        y = min(max(point.y(), self.image_rect.top()), self.image_rect.bottom())
        return QPointF(x, y)

    @staticmethod
    def _resized(rect: QRectF, index: int, p: QPointF) -> QRectF:
        left, top, right, bottom = rect.left(), rect.top(), rect.right(), rect.bottom()
        if index in (0, 6, 7):
            left = p.x()
        if index in (2, 3, 4):
            right = p.x()
        if index in (0, 1, 2):
            top = p.y()
        if index in (4, 5, 6):
            bottom = p.y()
        return QRectF(QPointF(left, top), QPointF(right, bottom))

    # ----- mouse -----
    def mousePressEvent(self, event):  # noqa: N802
        if event.button() != Qt.LeftButton:
            super().mousePressEvent(event)
            return
        scene_pos = self._clamp(self.mapToScene(event.position().toPoint()))
        self._press_scene = scene_pos

        index = self._handle_index(self.itemAt(event.position().toPoint()))
        if index >= 0 and self.mask_rect is not None:
            self._drag = "resize"
            self._resize_index = index
            self._rect_at_press = self.mask_rect.normalized()
            return
        if self.mask_rect is not None and self.mask_rect.normalized().contains(scene_pos):
            self._drag = "move"
            self._rect_at_press = self.mask_rect.normalized()
            return
        self._drag = "draw"
        self.mask_rect = QRectF(scene_pos, scene_pos)
        self._redraw()

    def mouseMoveEvent(self, event):  # noqa: N802
        scene_pos = self._clamp(self.mapToScene(event.position().toPoint()))
        self.cursor_moved.emit(scene_pos)
        if self._drag is None:
            super().mouseMoveEvent(event)
            return
        if self._drag == "draw":
            self.mask_rect = QRectF(self._press_scene, scene_pos)
        elif self._drag == "move":
            delta = scene_pos - self._press_scene
            self.mask_rect = self._rect_at_press.translated(delta.x(), delta.y())
        elif self._drag == "resize":
            self.mask_rect = self._resized(self._rect_at_press, self._resize_index, scene_pos)
        self._redraw()

    def mouseReleaseEvent(self, event):  # noqa: N802
        if self._drag is not None:
            self._drag = None
            self._resize_index = -1
            if self.mask_rect is not None:
                r = self.mask_rect.normalized()
                self.mask_rect = None if (r.width() < 3 or r.height() < 3) else r
                self._redraw()
            self.mask_changed.emit()
            return
        super().mouseReleaseEvent(event)

    def wheelEvent(self, event):  # noqa: N802
        factor = 1.15 if event.angleDelta().y() > 0 else 1.0 / 1.15
        self.scale(factor, factor)


class PlateTrainWorker(QThread):
    """Runs plate training off the GUI thread (see ui.TrainWorker for the
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

    def run(self) -> None:  # noqa: D401
        try:
            from plate_training import PlateTrainConfig, train  # torch on main thread first

            config = PlateTrainConfig(**self._params)

            def on_epoch(result) -> None:
                valid = float("nan") if result.valid_loss is None else float(result.valid_loss)
                self.epoch_done.emit(int(result.epoch), float(result.train_loss), valid)

            checkpoint_path, _ = train(config, on_epoch=on_epoch, should_stop=lambda: self._stop)
            self.finished_ok.emit(str(checkpoint_path))
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(f"{type(exc).__name__}: {exc}")


class PlateMaskWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Plate Mask Labeler")
        self.resize(1200, 800)

        self.image_path: Optional[Path] = None
        self.image_folder: Optional[Path] = None
        self.image_paths: list[Path] = []
        self.pixmap_item: Optional[QGraphicsPixmapItem] = None
        self.dirty = False

        self.checkpoint_path: Path = DEFAULT_CHECKPOINT
        self.label_folder: Optional[Path] = None
        self.detected_label_dir: Optional[Path] = None
        self.train_worker: Optional[PlateTrainWorker] = None

        self.scene = QGraphicsScene(self)
        self.view = PlateGraphicsView(self.scene)
        self.view.mask_changed.connect(self.on_mask_changed)
        self.view.cursor_moved.connect(self.update_cursor_status)

        self.status = QStatusBar(self)
        self.setStatusBar(self.status)
        self.mask_label = QLabel("Mask: none")
        self.coord_label = QLabel("x: -, y: -")

        left_panel = self._build_left_panel()
        side_panel = self._build_side_panel()
        side_scroll = QScrollArea(self)
        side_scroll.setWidget(side_panel)
        side_scroll.setWidgetResizable(True)
        side_scroll.setFixedWidth(280)
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

        open_action = QAction("Open Folder", self)
        open_action.setShortcut(QKeySequence.Open)
        open_action.triggered.connect(self.open_image_folder)
        toolbar.addAction(open_action)
        file_menu.addAction(open_action)

        save_action = QAction("Save Mask", self)
        save_action.setShortcut(QKeySequence.Save)
        save_action.triggered.connect(self.save_mask)
        toolbar.addAction(save_action)
        file_menu.addAction(save_action)

        fit_action = QAction("Fit Image", self)
        fit_action.triggered.connect(self.fit_image)
        toolbar.addAction(fit_action)

    def _build_left_panel(self) -> QWidget:
        panel = QWidget(self)
        panel.setFixedWidth(280)
        layout = QVBoxLayout(panel)

        open_button = QPushButton("Open Plate Image Folder")
        open_button.clicked.connect(self.open_image_folder)
        open_button.setMinimumHeight(42)
        open_button.setStyleSheet("font-weight: 600;")
        layout.addWidget(open_button)

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

        save_button = QPushButton("Save Plate Mask")
        save_button.clicked.connect(self.save_mask)
        layout.addWidget(save_button)

        layout.addSpacing(8)
        layout.addWidget(QLabel("Mask shape"))
        self.circle_radio = QRadioButton("Circle")
        self.rect_radio = QRadioButton("Rectangle")
        self.circle_radio.setChecked(True)
        group = QButtonGroup(self)
        group.addButton(self.circle_radio)
        group.addButton(self.rect_radio)
        self.circle_radio.toggled.connect(lambda on: on and self.view.set_kind("circle"))
        self.rect_radio.toggled.connect(lambda on: on and self.view.set_kind("rectangle"))
        layout.addWidget(self.circle_radio)
        layout.addWidget(self.rect_radio)

        clear_button = QPushButton("Clear Mask")
        clear_button.clicked.connect(self.view.clear_mask)
        layout.addWidget(clear_button)

        layout.addSpacing(12)
        layout.addWidget(self._build_model_group())

        layout.addSpacing(12)
        layout.addWidget(self.mask_label)
        layout.addWidget(self.coord_label)
        layout.addStretch(1)

        help_text = QLabel(
            "Workflow:\n"
            "1. Open a plate image folder.\n"
            "2. Pick Circle or Rectangle.\n"
            "3. Drag on empty space to draw the mask.\n"
            "4. Drag the body to move; drag a handle to resize.\n"
            "5. Save Plate Mask (writes <stem>.mask.json).\n"
            "6. Train, then Detect Plate and adjust.\n\n"
            "Wheel: zoom   Ctrl+S: save"
        )
        help_text.setWordWrap(True)
        layout.addWidget(help_text)
        return panel

    def _build_model_group(self) -> QWidget:
        group = QGroupBox("Plate model")
        layout = QVBoxLayout(group)

        self.checkpoint_label = QLabel(self._checkpoint_text())
        self.checkpoint_label.setWordWrap(True)
        layout.addWidget(self.checkpoint_label)

        load_button = QPushButton("Load Checkpoint...")
        load_button.clicked.connect(self.load_checkpoint)
        layout.addWidget(load_button)

        self.detect_button = QPushButton("Detect Plate (current image)")
        self.detect_button.clicked.connect(self.detect_plate)
        layout.addWidget(self.detect_button)

        hint = QLabel("Detect proposes a mask you can then move/resize, then save.")
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

        self.label_dir_button = QPushButton("Mask folder: (image folder)")
        self.label_dir_button.clicked.connect(self.choose_label_folder)
        controls.addWidget(self.label_dir_button)

        self.train_button = QPushButton("Train Plate Model")
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
            self, "Open plate image folder?", "Open a folder of plate images now?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes,
        )
        if reply == QMessageBox.Yes:
            self.open_image_folder()

    # ----- folder / image -----
    def open_image_folder(self) -> None:
        start_dir = str(self.image_folder or Path.home())
        folder = QFileDialog.getExistingDirectory(self, "Open Plate Image Folder", start_dir, QFileDialog.ShowDirsOnly)
        if not folder:
            return
        self.image_folder = Path(folder)
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
            QMessageBox.information(self, "No images", "No supported image files were found.")
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
                self, "Unsaved mask", "This image has an unsaved mask. Switch without saving?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                self.image_list.blockSignals(True)
                if previous is not None:
                    self.image_list.setCurrentItem(previous)
                self.image_list.blockSignals(False)
                return
        self.load_image_path(image_path)

    def load_image_path(self, image_path: Path) -> None:
        pixmap = QPixmap(str(image_path))
        if pixmap.isNull():
            QMessageBox.warning(self, "Open failed", f"Could not open image:\n{image_path}")
            return
        self.image_path = image_path
        self.scene.clear()
        self.pixmap_item = self.scene.addPixmap(pixmap)
        self.pixmap_item.setZValue(0)
        self.scene.setSceneRect(QRectF(pixmap.rect()))
        self.view.set_image_rect(QRectF(pixmap.rect()))
        self.view.mask_rect = None
        self.view.body_item = None
        self.view.handle_items = []

        self._load_mask(image_path)
        self.dirty = False
        self.fit_image()
        self._update_status()

    def fit_image(self) -> None:
        if self.pixmap_item is not None:
            self.view.fitInView(self.pixmap_item, Qt.KeepAspectRatio)

    # ----- mask save / load -----
    def _find_mask_file(self, image_path: Path) -> Optional[Path]:
        stem = image_path.stem
        dirs: list[Path] = []
        if self.label_folder is not None:
            dirs.append(self.label_folder)
        dirs.append(image_path.parent)
        dirs.append(image_path.parent.parent / "plate_label")
        seen: set[Path] = set()
        for directory in dirs:
            if directory in seen or not directory.is_dir():
                continue
            seen.add(directory)
            candidate = directory / f"{stem}.mask.json"
            if candidate.exists():
                return candidate
        return None

    def _load_mask(self, image_path: Path) -> None:
        mask_path = self._find_mask_file(image_path)
        if mask_path is None:
            self.view.set_mask("none", None)
            return
        try:
            payload = json.loads(mask_path.read_text(encoding="utf-8"))
            m = payload.get("mask") or {"kind": "none"}
            kind = m.get("kind", "none")
            if kind == "none":
                self.view.set_mask("none", None)
                return
            rect = QRectF(float(m["x"]), float(m["y"]), float(m["width"]), float(m["height"]))
        except (ValueError, KeyError, OSError) as exc:
            self.status.showMessage(f"Could not read mask: {mask_path.name} ({exc})", 4000)
            return
        self.view.set_mask(kind, rect)
        (self.rect_radio if kind == "rectangle" else self.circle_radio).setChecked(True)
        self.detected_label_dir = mask_path.parent
        self._refresh_label_dir_button()
        self.status.showMessage(f"Loaded {kind} mask from {mask_path.name}", 4000)

    def save_mask(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a plate image first.")
            return
        kind, rect = self.view.get_mask()
        if kind == "none" or rect is None:
            QMessageBox.information(self, "No mask", "Draw a mask around the plate before saving.")
            return

        default_dir = Path("plate_label")
        base = default_dir if default_dir.is_dir() else self.image_path.parent
        default_path = base / f"{self.image_path.stem}.mask.json"
        file_name, _ = QFileDialog.getSaveFileName(
            self, "Save Plate Mask", str(default_path), "Mask label (*.mask.json);;All Files (*)"
        )
        if not file_name:
            return
        mask_path = Path(file_name)
        if not mask_path.name.endswith(".mask.json"):
            mask_path = mask_path.with_name(f"{mask_path.stem}.mask.json")

        payload = {
            "image": str(self.image_path),
            "image_name": self.image_path.name,
            "image_width": self.pixmap_item.pixmap().width() if self.pixmap_item else None,
            "image_height": self.pixmap_item.pixmap().height() if self.pixmap_item else None,
            "mask": {"kind": kind, "x": rect.x(), "y": rect.y(), "width": rect.width(), "height": rect.height()},
        }
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        mask_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.dirty = False
        self.detected_label_dir = mask_path.parent
        self._refresh_label_dir_button()
        self._update_status()
        QMessageBox.information(self, "Plate mask saved", f"Saved:\n{mask_path}")

    # ----- model -----
    def _checkpoint_text(self) -> str:
        status = "ready" if self.checkpoint_path.exists() else "not trained yet"
        return f"Checkpoint: {self.checkpoint_path.name} ({status})"

    def choose_label_folder(self) -> None:
        start_dir = str(self.label_folder or self.detected_label_dir or self.image_folder or Path.home())
        folder = QFileDialog.getExistingDirectory(self, "Choose Mask Folder", start_dir, QFileDialog.ShowDirsOnly)
        if not folder:
            return
        self.label_folder = Path(folder)
        self._refresh_label_dir_button()

    def _effective_label_dir(self) -> Optional[Path]:
        return self.label_folder or self.detected_label_dir or self.image_folder

    def _refresh_label_dir_button(self) -> None:
        if not hasattr(self, "label_dir_button"):
            return
        if self.label_folder is not None:
            self.label_dir_button.setText(f"Mask folder: {self.label_folder.name}")
        elif self.detected_label_dir is not None:
            self.label_dir_button.setText(f"Mask folder: {self.detected_label_dir.name} (auto)")
        else:
            self.label_dir_button.setText("Mask folder: (image folder)")

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
            QMessageBox.information(self, "No folder", "Open a plate image folder first.")
            return
        try:
            import plate_training  # noqa: F401 - load torch on the main thread first
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

        self.train_worker = PlateTrainWorker(params)
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

    def detect_plate(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a plate image first.")
            return
        if not self.checkpoint_path.exists():
            QMessageBox.information(self, "No checkpoint", "Train a plate model or load a checkpoint first.")
            return
        try:
            import cv2
            from training import get_device
            from inference import load_model
            from plate_inference import predict_plate_mask
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(
                self, "ML libraries missing",
                "Detection needs torch + opencv installed:\n"
                "python -m pip install torch opencv-python numpy pandas tqdm\n\n"
                f"Import error: {exc}",
            )
            return

        self.detect_button.setEnabled(False)
        self.status.showMessage("Detecting plate...")
        QApplication.processEvents()
        try:
            device = get_device()
            model, img_size, _ = load_model(self.checkpoint_path, device)
            image_bgr = cv2.imread(str(self.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            if image_bgr is None:
                QMessageBox.warning(self, "Read failed", f"Could not read image:\n{self.image_path}")
                return
            mask = predict_plate_mask(model, image_bgr, img_size, device)
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(self, "Plate detection failed", f"{type(exc).__name__}: {exc}")
            return
        finally:
            self.detect_button.setEnabled(True)

        if mask is None:
            QMessageBox.information(self, "No plate found", "The plate model did not find a plate in this image.")
            return
        rect = QRectF(mask["x"], mask["y"], mask["width"], mask["height"])
        self.view.set_mask("circle", rect)
        self.circle_radio.setChecked(True)
        self.dirty = True
        self._update_status()
        self.status.showMessage("Plate detected -> adjust the mask, then Save Plate Mask.", 4000)

    # ----- status -----
    def on_mask_changed(self) -> None:
        self.dirty = True
        self._update_status()

    def update_cursor_status(self, point: QPointF) -> None:
        self.coord_label.setText(f"x: {point.x():.1f}, y: {point.y():.1f}")

    def _update_status(self) -> None:
        kind, rect = self.view.get_mask()
        if kind == "none" or rect is None:
            self.mask_label.setText("Mask: none")
        else:
            self.mask_label.setText(
                f"Mask: {kind} x={rect.x():.0f} y={rect.y():.0f} w={rect.width():.0f} h={rect.height():.0f}"
            )
        image_name = self.image_path.name if self.image_path else "No image loaded"
        dirty_mark = "*" if self.dirty else ""
        self.status.showMessage(f"{dirty_mark}{image_name} | mask: {kind}")

    def closeEvent(self, event) -> None:  # noqa: N802
        if self.train_worker is not None and self.train_worker.isRunning():
            self.train_worker.request_stop()
            self.train_worker.wait(15000)
        super().closeEvent(event)


def main() -> None:
    app = QApplication(sys.argv)
    window = PlateMaskWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
