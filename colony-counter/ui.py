

"""Colony counter training-label UI.

Features
--------
- Open a training image folder and choose images from the left list.
- Optional training mask: none, rectangle, or circle.
- Click colonies to drop training pins.
- Anything outside the mask is ignored by the saved labels.
- Undo / clear pins.
- Save labels as JSON and CSV.

Install:
    python -m pip install PySide6

Run:
    python ui.py
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
from PySide6.QtGui import QAction, QBrush, QColor, QKeySequence, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QComboBox,
    QDockWidget,
    QDoubleSpinBox,
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

DEFAULT_CHECKPOINT = Path("colony_heatmap_unet.pt")


@dataclass
class Pin:
    x: float
    y: float


@dataclass
class TrainingMask:
    kind: str  # "none", "rectangle", or "circle"
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0

    def contains(self, point: QPointF) -> bool:
        if self.kind == "none":
            return True

        if self.kind == "rectangle":
            return QRectF(self.x, self.y, self.width, self.height).contains(point)

        if self.kind == "circle":
            cx = self.x + self.width / 2.0
            cy = self.y + self.height / 2.0
            rx = abs(self.width) / 2.0
            ry = abs(self.height) / 2.0
            if rx <= 0 or ry <= 0:
                return False
            dx = (point.x() - cx) / rx
            dy = (point.y() - cy) / ry
            return dx * dx + dy * dy <= 1.0

        return True


class PlateGraphicsView(QGraphicsView):
    pin_added = Signal(QPointF)
    mask_changed = Signal(QRectF)
    cursor_moved = Signal(QPointF)

    def __init__(self, scene: QGraphicsScene):
        super().__init__(scene)
        self.setRenderHint(QPainter.Antialiasing, True)
        self.setRenderHint(QPainter.SmoothPixmapTransform, True)
        self.setDragMode(QGraphicsView.NoDrag)
        self.setMouseTracking(True)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)

        self.mode = "pin"  # "pin", "rectangle", or "circle"
        self._drawing_mask = False
        self._mask_start: Optional[QPointF] = None

    def set_mode(self, mode: str) -> None:
        self.mode = mode
        self._drawing_mask = False
        self._mask_start = None
        if mode == "pin":
            self.setDragMode(QGraphicsView.NoDrag)
        else:
            self.setDragMode(QGraphicsView.NoDrag)

    def mousePressEvent(self, event):  # noqa: N802 - Qt override name
        if event.button() != Qt.LeftButton:
            super().mousePressEvent(event)
            return

        scene_point = self.mapToScene(event.position().toPoint())

        if self.mode == "pin":
            self.pin_added.emit(scene_point)
            return

        self._drawing_mask = True
        self._mask_start = scene_point
        self.mask_changed.emit(QRectF(scene_point, scene_point))

    def mouseMoveEvent(self, event):  # noqa: N802 - Qt override name
        scene_point = self.mapToScene(event.position().toPoint())
        self.cursor_moved.emit(scene_point)

        if self._drawing_mask and self._mask_start is not None:
            self.mask_changed.emit(QRectF(self._mask_start, scene_point).normalized())
            return

        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):  # noqa: N802 - Qt override name
        if event.button() == Qt.LeftButton and self._drawing_mask and self._mask_start is not None:
            scene_point = self.mapToScene(event.position().toPoint())
            self.mask_changed.emit(QRectF(self._mask_start, scene_point).normalized())
            self._drawing_mask = False
            self._mask_start = None
            return

        super().mouseReleaseEvent(event)

    def wheelEvent(self, event):  # noqa: N802 - Qt override name
        zoom_in_factor = 1.15
        zoom_out_factor = 1.0 / zoom_in_factor
        factor = zoom_in_factor if event.angleDelta().y() > 0 else zoom_out_factor
        self.scale(factor, factor)


class LossCurveWidget(QWidget):
    """Self-contained loss plot (no matplotlib dependency)."""

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(190)
        self.setMinimumWidth(360)
        self._epochs: list[int] = []
        self._train: list[float] = []
        self._valid: list[Optional[float]] = []

    def reset(self) -> None:
        self._epochs.clear()
        self._train.clear()
        self._valid.clear()
        self.update()

    def add_point(self, epoch: int, train_loss: float, valid_loss: Optional[float]) -> None:
        self._epochs.append(epoch)
        self._train.append(train_loss)
        self._valid.append(valid_loss)
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt override name
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.fillRect(self.rect(), QColor(250, 250, 250))

        margin_left, margin_right, margin_top, margin_bottom = 56, 14, 16, 26
        plot_w = self.width() - margin_left - margin_right
        plot_h = self.height() - margin_top - margin_bottom
        if plot_w <= 10 or plot_h <= 10:
            return

        painter.setPen(QPen(QColor(190, 190, 190), 1))
        painter.drawRect(margin_left, margin_top, plot_w, plot_h)

        if not self._epochs:
            painter.setPen(QColor(140, 140, 140))
            painter.drawText(self.rect(), Qt.AlignCenter, "Loss curve appears here during training")
            return

        finite = [v for v in self._train if v is not None and not math.isnan(v)]
        finite += [v for v in self._valid if v is not None and not math.isnan(v)]
        if not finite:
            return

        y_min, y_max = min(finite), max(finite)
        if y_max - y_min < 1e-12:
            y_max = y_min + 1e-12
        x_min, x_max = min(self._epochs), max(self._epochs)
        if x_max == x_min:
            x_max = x_min + 1

        def to_px(epoch: int, loss: float) -> QPointF:
            px = margin_left + (epoch - x_min) / (x_max - x_min) * plot_w
            py = margin_top + (1.0 - (loss - y_min) / (y_max - y_min)) * plot_h
            return QPointF(px, py)

        font = painter.font()
        font.setPointSize(8)
        painter.setFont(font)
        painter.setPen(QColor(120, 120, 120))
        painter.drawText(QRectF(0, margin_top - 7, margin_left - 6, 14), Qt.AlignRight | Qt.AlignVCenter, f"{y_max:.4f}")
        painter.drawText(
            QRectF(0, margin_top + plot_h - 7, margin_left - 6, 14),
            Qt.AlignRight | Qt.AlignVCenter,
            f"{y_min:.4f}",
        )
        painter.drawText(
            QRectF(margin_left, self.height() - margin_bottom + 4, plot_w, 18),
            Qt.AlignHCenter,
            f"epoch {x_min} - {x_max}",
        )

        def draw_series(values: list[Optional[float]], color: QColor) -> None:
            painter.setPen(QPen(color, 2))
            previous: Optional[QPointF] = None
            for epoch, value in zip(self._epochs, values):
                if value is None or math.isnan(value):
                    previous = None
                    continue
                point = to_px(epoch, value)
                if previous is not None:
                    painter.drawLine(previous, point)
                previous = point

        draw_series(self._train, QColor(33, 120, 255))
        has_valid = any(v is not None and not math.isnan(v) for v in self._valid)
        if has_valid:
            draw_series(self._valid, QColor(230, 80, 60))

        painter.setPen(QColor(33, 120, 255))
        painter.drawText(margin_left + 8, margin_top + 14, f"train {self._train[-1]:.5f}")
        last_valid = self._valid[-1] if self._valid else None
        if last_valid is not None and not math.isnan(last_valid):
            painter.setPen(QColor(230, 80, 60))
            painter.drawText(margin_left + 8, margin_top + 30, f"valid {last_valid:.5f}")


class TrainWorker(QThread):
    """Runs training off the GUI thread. All torch imports happen here so the
    labeler still launches when torch is not installed."""

    epoch_done = Signal(int, float, float)  # epoch, train_loss, valid_loss (NaN if none)
    finished_ok = Signal(str)               # checkpoint path
    failed = Signal(str)

    def __init__(self, params: dict) -> None:
        super().__init__()
        self._params = params
        self._stop = False
        # A macOS secondary thread defaults to a ~512 KB stack, which torch's
        # autograd call stack overflows. The main thread has 8 MB; match that
        # generously so training runs the same off-thread as it does on the CLI.
        self.setStackSize(128 * 1024 * 1024)

    def request_stop(self) -> None:
        self._stop = True

    def run(self) -> None:  # noqa: D401 - QThread entry point
        try:
            # NOTE: callers must import `training` (hence torch) on the main thread
            # before starting this worker. torch's first import is not thread-safe;
            # here we only rebind names from the already-loaded module.
            from training import TrainConfig, train

            config = TrainConfig(**self._params)

            def on_epoch(result) -> None:
                valid = float("nan") if result.valid_loss is None else float(result.valid_loss)
                self.epoch_done.emit(int(result.epoch), float(result.train_loss), valid)

            checkpoint_path, _ = train(config, on_epoch=on_epoch, should_stop=lambda: self._stop)
            self.finished_ok.emit(str(checkpoint_path))
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            self.failed.emit(f"{type(exc).__name__}: {exc}")


class TrainingLabelerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Colony Training Labeler")
        self.resize(1200, 800)

        self.image_path: Optional[Path] = None
        self.image_folder: Optional[Path] = None
        self.image_paths: list[Path] = []
        self.dirty = False
        self.pixmap_item: Optional[QGraphicsPixmapItem] = None
        self.mask_item: Optional[QGraphicsItem] = None
        self.mask = TrainingMask(kind="none")
        self.pins: list[Pin] = []
        self.pin_items: list[QGraphicsItem] = []

        # Model / training state.
        self.checkpoint_path: Path = DEFAULT_CHECKPOINT
        self.label_folder: Optional[Path] = None        # explicit user choice
        self.detected_label_dir: Optional[Path] = None  # where labels were auto-found
        self.train_worker: Optional[TrainWorker] = None

        self.scene = QGraphicsScene(self)
        self.view = PlateGraphicsView(self.scene)
        self.view.pin_added.connect(self.add_pin)
        self.view.mask_changed.connect(self.update_mask_from_rect)
        self.view.cursor_moved.connect(self.update_cursor_status)

        self.status = QStatusBar(self)
        self.setStatusBar(self.status)

        self.count_label = QLabel("Pins: 0")
        self.mask_label = QLabel("Mask: none")
        self.coord_label = QLabel("x: -, y: -")

        left_panel = self._build_left_panel()
        side_panel = self._build_side_panel()

        # The side panel can grow tall; let it scroll instead of clipping.
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

    def _build_toolbar(self) -> None:
        toolbar = QToolBar("Main", self)
        self.addToolBar(toolbar)

        toolbar.setMovable(False)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)

        file_menu = self.menuBar().addMenu("File")

        open_folder_action = QAction("Open Folder", self)
        open_folder_action.setShortcut(QKeySequence.Open)
        open_folder_action.triggered.connect(self.open_image_folder)
        toolbar.addAction(open_folder_action)
        file_menu.addAction(open_folder_action)

        open_image_action = QAction("Open Single Image", self)
        open_image_action.triggered.connect(self.open_image)
        toolbar.addAction(open_image_action)
        file_menu.addAction(open_image_action)
        file_menu.addSeparator()

        save_action = QAction("Save Labels", self)
        save_action.setShortcut(QKeySequence.Save)
        save_action.triggered.connect(self.save_labels)
        toolbar.addAction(save_action)
        file_menu.addAction(save_action)

        undo_action = QAction("Undo Pin", self)
        undo_action.setShortcut(QKeySequence.Undo)
        undo_action.triggered.connect(self.undo_pin)
        toolbar.addAction(undo_action)

        fit_action = QAction("Fit Image", self)
        fit_action.triggered.connect(self.fit_image)
        toolbar.addAction(fit_action)

    def _build_left_panel(self) -> QWidget:
        panel = QWidget(self)
        panel.setFixedWidth(280)
        layout = QVBoxLayout(panel)

        open_folder_button = QPushButton("Open Training Image Folder")
        open_folder_button.clicked.connect(self.open_image_folder)
        layout.addWidget(open_folder_button)
        open_folder_button.setMinimumHeight(42)
        open_folder_button.setStyleSheet("font-weight: 600;")

        self.folder_label = QLabel("No folder opened")
        self.folder_label.setWordWrap(True)
        layout.addWidget(self.folder_label)

        self.image_list = QListWidget()
        self.image_list.currentItemChanged.connect(self.on_image_selected)
        layout.addWidget(self.image_list, stretch=1)

        return panel

    def show_startup_folder_hint(self) -> None:
        if self.image_folder is not None:
            return

        reply = QMessageBox.question(
            self,
            "Open training image folder?",
            "Open a folder containing your plate images now?\n\n"
            "You can also use File > Open Folder or the large button on the left.",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.Yes,
        )
        if reply == QMessageBox.Yes:
            self.open_image_folder()

    def _build_side_panel(self) -> QWidget:
        panel = QWidget(self)
        layout = QVBoxLayout(panel)

        open_button = QPushButton("Open Single Plate Image")
        open_button.clicked.connect(self.open_image)
        layout.addWidget(open_button)

        save_button = QPushButton("Save Labels")
        save_button.clicked.connect(self.save_labels)
        layout.addWidget(save_button)

        layout.addSpacing(12)
        layout.addWidget(QLabel("Interaction mode"))

        self.pin_radio = QRadioButton("Drop colony pins")
        self.rect_radio = QRadioButton("Draw rectangle mask")
        self.circle_radio = QRadioButton("Draw circle mask")
        self.pin_radio.setChecked(True)

        mode_group = QButtonGroup(self)
        mode_group.addButton(self.pin_radio)
        mode_group.addButton(self.rect_radio)
        mode_group.addButton(self.circle_radio)

        self.pin_radio.toggled.connect(lambda checked: checked and self.view.set_mode("pin"))
        self.rect_radio.toggled.connect(lambda checked: checked and self.view.set_mode("rectangle"))
        self.circle_radio.toggled.connect(lambda checked: checked and self.view.set_mode("circle"))

        layout.addWidget(self.pin_radio)
        layout.addWidget(self.rect_radio)
        layout.addWidget(self.circle_radio)

        clear_mask_button = QPushButton("Clear Mask")
        clear_mask_button.clicked.connect(self.clear_mask)
        layout.addWidget(clear_mask_button)

        layout.addSpacing(12)
        layout.addWidget(QLabel("Pin display radius"))
        self.pin_radius_spin = QSpinBox()
        self.pin_radius_spin.setRange(2, 30)
        self.pin_radius_spin.setValue(7)
        self.pin_radius_spin.valueChanged.connect(self.redraw_pins)
        layout.addWidget(self.pin_radius_spin)

        undo_button = QPushButton("Undo Last Pin")
        undo_button.clicked.connect(self.undo_pin)
        layout.addWidget(undo_button)

        clear_pins_button = QPushButton("Clear Pins")
        clear_pins_button.clicked.connect(self.clear_pins)
        layout.addWidget(clear_pins_button)

        layout.addSpacing(12)
        layout.addWidget(self._build_model_group())

        layout.addSpacing(12)
        layout.addWidget(self.count_label)
        layout.addWidget(self.mask_label)
        layout.addWidget(self.coord_label)
        layout.addStretch(1)

        help_text = QLabel(
            "Label - train - correct loop:\n"
            "1. Open a training image folder.\n"
            "2. Label a few plates (pins + optional mask), save.\n"
            "3. Train in the panel below; watch the loss curve.\n"
            "4. Open a new plate, Run Inference.\n"
            "5. Fix the model's pins (add / undo / clear).\n"
            "6. Save the corrected labels, then train again.\n\n"
            "Mouse wheel: zoom\n"
            "Ctrl+Z: undo pin\n"
            "Ctrl+S: save labels"
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
        threshold_row.addWidget(QLabel("Peak threshold"))
        self.threshold_spin = QDoubleSpinBox()
        self.threshold_spin.setRange(0.0, 1.0)
        self.threshold_spin.setSingleStep(0.05)
        self.threshold_spin.setValue(0.5)
        threshold_row.addWidget(self.threshold_spin)
        layout.addLayout(threshold_row)

        distance_row = QHBoxLayout()
        distance_row.addWidget(QLabel("Min peak distance"))
        self.min_distance_spin = QSpinBox()
        self.min_distance_spin.setRange(1, 30)
        self.min_distance_spin.setValue(3)
        distance_row.addWidget(self.min_distance_spin)
        layout.addLayout(distance_row)

        self.infer_button = QPushButton("Run Inference (current image)")
        self.infer_button.clicked.connect(self.run_inference)
        layout.addWidget(self.infer_button)

        hint = QLabel("Predictions become editable pins. Correct them, save, then retrain.")
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
        """Folder training reads labels from: explicit choice, else where labels
        were auto-detected on open, else the image folder."""
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
            self,
            "Load Checkpoint",
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
            QMessageBox.information(self, "No folder", "Open a training image folder first.")
            return

        # Import torch (via the training module) on the MAIN thread first. torch's
        # C-extension initialisation is not safe to run for the first time inside a
        # QThread - doing so raises 'RpcBackendOptions ... already defined' (or a
        # stack overflow). Once it is in sys.modules, the worker thread reuses it.
        try:
            import training  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(
                self,
                "Training libraries missing",
                "Training needs torch + opencv installed:\n"
                "python -m pip install torch opencv-python numpy pandas tqdm\n\n"
                f"Import error: {exc}",
            )
            return

        label_dir = self._effective_label_dir() or self.image_folder

        params = dict(
            image_dir=self.image_folder,
            label_dir=label_dir,
            output=self.checkpoint_path,
            img_size=int(self.img_size_combo.currentText()),
            epochs=int(self.epochs_spin.value()),
        )

        self.loss_curve.reset()
        self.train_button.setEnabled(False)
        self.stop_button.setEnabled(True)
        self.train_status_label.setText("Starting... (first epoch loads torch and data)")

        self.train_worker = TrainWorker(params)
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
            self,
            "Training failed",
            f"{message}\n\nIf this is an import error, install the training dependencies:\n"
            "python -m pip install torch opencv-python numpy pandas tqdm",
        )

    def run_inference(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a plate image first.")
            return

        if not self.checkpoint_path.exists():
            QMessageBox.information(
                self,
                "No checkpoint",
                "Train a model or load a checkpoint before running inference.",
            )
            return

        if self.pins:
            reply = QMessageBox.question(
                self,
                "Replace pins?",
                "Replace the current pins with the model's predictions?\n"
                "You can then correct them and save.",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                return

        try:
            import cv2
            from training import get_device
            from inference import find_peaks, load_model, predict_heatmap, scale_peaks
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(
                self,
                "ML libraries missing",
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

            # IGNORE_ORIENTATION: read raw pixels so predictions land in the same
            # frame as the displayed QPixmap (which does not apply EXIF rotation).
            image_bgr = cv2.imread(str(self.image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            if image_bgr is None:
                QMessageBox.warning(self, "Read failed", f"Could not read image:\n{self.image_path}")
                return

            original_height, original_width = image_bgr.shape[:2]
            heatmap = predict_heatmap(model, image_bgr, img_size, device)
            peaks = find_peaks(heatmap, float(self.threshold_spin.value()), int(self.min_distance_spin.value()))
            peaks = scale_peaks(peaks, img_size, original_width, original_height)

            # If a mask is drawn, keep only predictions whose center is inside it.
            # (The model still sees the whole plate for context; we filter outputs.)
            if self.mask.kind != "none":
                peaks = [
                    (float(x), float(y))
                    for x, y in peaks
                    if self.mask.contains(QPointF(float(x), float(y)))
                ]
        except Exception as exc:  # noqa: BLE001
            QMessageBox.warning(self, "Inference failed", f"{type(exc).__name__}: {exc}")
            return
        finally:
            self.infer_button.setEnabled(True)

        self._set_pins_from_predictions(peaks)
        where = f"inside the {self.mask.kind} mask" if self.mask.kind != "none" else "across the whole image"
        QMessageBox.information(
            self,
            "Inference complete",
            f"The model proposed {len(self.pins)} colonies {where}.\n\n"
            "Correct them (add / undo / clear), then Save Labels and retrain.",
        )

    def _set_pins_from_predictions(self, peaks) -> None:
        self.pins.clear()
        for item in self.pin_items:
            self.scene.removeItem(item)
        self.pin_items.clear()

        # Guard: a colony center can't be outside the image. Drop any out-of-bounds
        # prediction so pins never render off-picture.
        image_rect = QRectF(self.pixmap_item.pixmap().rect()) if self.pixmap_item is not None else None

        for x, y in peaks:
            fx, fy = float(x), float(y)
            if image_rect is not None and not image_rect.contains(QPointF(fx, fy)):
                continue
            pin = Pin(fx, fy)
            self.pins.append(pin)
            self._add_pin_item(pin)

        self.dirty = True
        self._update_status()

    def open_image_folder(self) -> None:
        start_dir = str(self.image_folder or Path.home())
        folder_name = QFileDialog.getExistingDirectory(
            self,
            "Open Training Image Folder",
            start_dir,
            QFileDialog.ShowDirsOnly,
        )
        if not folder_name:
            return

        self.image_folder = Path(folder_name)
        self.load_image_folder(self.image_folder)

    def load_image_folder(self, folder: Path) -> None:
        image_suffixes = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
        self.image_paths = sorted(
            path for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in image_suffixes
        )

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
                "This image has unsaved labels. Switch images without saving?",
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
        pixmap = QPixmap(str(image_path))
        if pixmap.isNull():
            QMessageBox.warning(self, "Open failed", f"Could not open image:\n{image_path}")
            return

        self.image_path = image_path
        self.scene.clear()
        self.pixmap_item = self.scene.addPixmap(pixmap)
        self.pixmap_item.setZValue(0)
        self.scene.setSceneRect(QRectF(pixmap.rect()))

        self.mask_item = None
        self.mask = TrainingMask(kind="none")
        self.pins.clear()
        self.pin_items.clear()
        self.dirty = False

        # If this plate was already labeled, render its saved pins and mask.
        self._load_labels_for_image(image_path)

        self.fit_image()
        self._update_status()

    def _find_label_file(self, image_path: Path) -> Optional[Path]:
        """Locate an existing label file for an image, trying the most likely
        places: a chosen label folder, next to the image, and a sibling
        ``label/`` directory (the layout training.py expects)."""
        stem = image_path.stem
        candidate_dirs: list[Path] = []
        if self.label_folder is not None:
            candidate_dirs.append(self.label_folder)
        candidate_dirs.append(image_path.parent)
        candidate_dirs.append(image_path.parent.parent / "label")

        seen: set[Path] = set()
        for directory in candidate_dirs:
            if directory in seen or not directory.is_dir():
                continue
            seen.add(directory)
            for suffix in (".labels.json", ".json", ".labels.csv", ".csv"):
                candidate = directory / f"{stem}{suffix}"
                if candidate.exists():
                    return candidate
        return None

    def _load_labels_for_image(self, image_path: Path) -> bool:
        label_path = self._find_label_file(image_path)
        if label_path is None:
            return False

        try:
            if label_path.suffix.lower() == ".csv":
                with label_path.open(newline="", encoding="utf-8") as f:
                    self.pins = [Pin(float(row["x"]), float(row["y"])) for row in csv.DictReader(f)]
                self.mask = TrainingMask(kind="none")
            else:
                payload = json.loads(label_path.read_text(encoding="utf-8"))
                self.pins = [Pin(float(p["x"]), float(p["y"])) for p in payload.get("pins", [])]
                mask_payload = payload.get("mask") or {"kind": "none"}
                self.mask = TrainingMask(
                    kind=mask_payload.get("kind", "none"),
                    x=float(mask_payload.get("x", 0.0)),
                    y=float(mask_payload.get("y", 0.0)),
                    width=float(mask_payload.get("width", 0.0)),
                    height=float(mask_payload.get("height", 0.0)),
                )
        except (ValueError, KeyError, OSError) as exc:
            self.status.showMessage(f"Could not read labels: {label_path.name} ({exc})", 4000)
            return False

        # Remember where labels live so training defaults to the same folder.
        self.detected_label_dir = label_path.parent
        self._refresh_label_dir_button()

        self.redraw_mask()
        self.redraw_pins()
        self.status.showMessage(f"Loaded {len(self.pins)} pin(s) from {label_path.name}", 4000)
        return True

    def open_image(self) -> None:
        file_name, _ = QFileDialog.getOpenFileName(
            self,
            "Open Plate Image",
            "",
            "Images (*.png *.jpg *.jpeg *.bmp *.tif *.tiff);;All Files (*)",
        )
        if not file_name:
            return

        image_path = Path(file_name)
        self.load_image_path(image_path)

        if self.image_folder is None or image_path.parent != self.image_folder:
            self.image_folder = image_path.parent
            self.load_image_folder(self.image_folder)
            for row, path in enumerate(self.image_paths):
                if path == image_path:
                    self.image_list.setCurrentRow(row)
                    break

    def fit_image(self) -> None:
        if self.pixmap_item is None:
            return
        self.view.fitInView(self.pixmap_item, Qt.KeepAspectRatio)

    def update_mask_from_rect(self, rect: QRectF) -> None:
        if self.pixmap_item is None:
            return

        if rect.width() < 2 or rect.height() < 2:
            return

        if self.rect_radio.isChecked():
            self.mask = TrainingMask("rectangle", rect.x(), rect.y(), rect.width(), rect.height())
        elif self.circle_radio.isChecked():
            self.mask = TrainingMask("circle", rect.x(), rect.y(), rect.width(), rect.height())
        else:
            return

        self.redraw_mask()
        self.dirty = True
        self._update_status()

    def redraw_mask(self) -> None:
        if self.mask_item is not None:
            self.scene.removeItem(self.mask_item)
            self.mask_item = None

        if self.mask.kind == "none":
            return

        rect = QRectF(self.mask.x, self.mask.y, self.mask.width, self.mask.height)
        pen = QPen(QColor(0, 180, 255), 3)
        brush = QBrush(QColor(0, 180, 255, 35))

        if self.mask.kind == "rectangle":
            self.mask_item = QGraphicsRectItem(rect)
        else:
            self.mask_item = QGraphicsEllipseItem(rect)

        self.mask_item.setPen(pen)
        self.mask_item.setBrush(brush)
        self.mask_item.setZValue(5)
        self.scene.addItem(self.mask_item)

    def clear_mask(self) -> None:
        self.mask = TrainingMask(kind="none")
        if self.mask_item is not None:
            self.scene.removeItem(self.mask_item)
            self.mask_item = None
        self.dirty = True
        self._update_status()

    def add_pin(self, point: QPointF) -> None:
        if self.pixmap_item is None:
            return

        image_rect = QRectF(self.pixmap_item.pixmap().rect())
        if not image_rect.contains(point):
            self.status.showMessage("Click ignored: outside image", 1500)
            return

        if not self.mask.contains(point):
            self.status.showMessage("Click ignored: outside training mask", 1500)
            return

        pin = Pin(point.x(), point.y())
        self.pins.append(pin)
        self._add_pin_item(pin)
        self.dirty = True
        self._update_status()

    def _add_pin_item(self, pin: Pin) -> None:
        radius = self.pin_radius_spin.value()
        item = QGraphicsEllipseItem(pin.x - radius, pin.y - radius, radius * 2, radius * 2)
        item.setPen(QPen(QColor(255, 255, 255), 2))
        item.setBrush(QBrush(QColor(255, 40, 40, 210)))
        item.setZValue(10)
        self.scene.addItem(item)
        self.pin_items.append(item)

    def redraw_pins(self) -> None:
        for item in self.pin_items:
            self.scene.removeItem(item)
        self.pin_items.clear()
        for pin in self.pins:
            self._add_pin_item(pin)

    def undo_pin(self) -> None:
        if not self.pins:
            return
        self.pins.pop()
        item = self.pin_items.pop()
        self.scene.removeItem(item)
        self.dirty = True
        self._update_status()

    def clear_pins(self) -> None:
        if not self.pins:
            return

        reply = QMessageBox.question(
            self,
            "Clear pins?",
            "Remove all colony pins from this image?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return

        self.pins.clear()
        for item in self.pin_items:
            self.scene.removeItem(item)
        self.pin_items.clear()
        self.dirty = True
        self._update_status()

    def save_labels(self) -> None:
        if self.image_path is None:
            QMessageBox.information(self, "No image", "Open a plate image before saving labels.")
            return

        default_path = self.image_path.with_suffix(".labels.json")
        file_name, _ = QFileDialog.getSaveFileName(
            self,
            "Save Labels",
            str(default_path),
            "JSON label file (*.json);;All Files (*)",
        )
        if not file_name:
            return

        json_path = Path(file_name)
        if json_path.suffix.lower() != ".json":
            json_path = json_path.with_suffix(".json")

        valid_pins = [pin for pin in self.pins if self.mask.contains(QPointF(pin.x, pin.y))]

        payload = {
            "image": str(self.image_path),
            "image_name": self.image_path.name,
            "image_width": self.pixmap_item.pixmap().width() if self.pixmap_item else None,
            "image_height": self.pixmap_item.pixmap().height() if self.pixmap_item else None,
            "mask": asdict(self.mask),
            "pins": [asdict(pin) for pin in valid_pins],
            "pin_count": len(valid_pins),
        }

        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        csv_path = json_path.with_suffix(".csv")
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["x", "y"])
            writer.writeheader()
            for pin in valid_pins:
                writer.writerow({"x": f"{pin.x:.3f}", "y": f"{pin.y:.3f}"})

        self.dirty = False
        self._update_status()

        QMessageBox.information(
            self,
            "Labels saved",
            f"Saved:\n{json_path}\n{csv_path}\n\nPins saved: {len(valid_pins)}",
        )

    def update_cursor_status(self, point: QPointF) -> None:
        self.coord_label.setText(f"x: {point.x():.1f}, y: {point.y():.1f}")

    def _update_status(self) -> None:
        self.count_label.setText(f"Pins: {len(self.pins)}")

        if self.mask.kind == "none":
            self.mask_label.setText("Mask: none")
        else:
            self.mask_label.setText(
                f"Mask: {self.mask.kind} "
                f"x={self.mask.x:.1f}, y={self.mask.y:.1f}, "
                f"w={self.mask.width:.1f}, h={self.mask.height:.1f}"
            )

        image_name = self.image_path.name if self.image_path else "No image loaded — use File > Open Folder"
        dirty_mark = "*" if self.dirty else ""
        self.status.showMessage(f"{dirty_mark}{image_name} | pins: {len(self.pins)} | mask: {self.mask.kind}")

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt override name
        if self.train_worker is not None and self.train_worker.isRunning():
            self.train_worker.request_stop()
            self.train_worker.wait(15000)  # let the current epoch finish, then exit
        super().closeEvent(event)


def main() -> None:
    app = QApplication(sys.argv)
    window = TrainingLabelerWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()