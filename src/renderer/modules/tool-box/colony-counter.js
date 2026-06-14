// Colony counter tool.
//
// Responsibilities:
// - load and display colony plate images on layered canvases
// - support crop, mask, zoom, and pan interactions before counting
// - run the trained colony heatmap model and allow marker adjustments
// - keep a synchronized marker/mask canvas and count summary
import {
  clampNumber,
  escapeHtml
} from './common.js';
import {
  bindFileDropTarget,
  mergeFilesIntoInput
} from '../file-drop.js';
import {
  countColoniesWithModel
} from './colony-counter-model.js';

const EMPTY_MASK = Object.freeze({ kind: 'none', x: 0, y: 0, width: 0, height: 0 });

// Convert a pointer event into canvas pixel coordinates, accounting for CSS scaling and letterboxing.
function getCanvasPointerPosition(canvas, event) {
  if (!canvas || !event) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const canvasWidth = canvas.width || 0;
  const canvasHeight = canvas.height || 0;
  if (!canvasWidth || !canvasHeight) {
    return null;
  }

  const styles = window.getComputedStyle(canvas);
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  const contentWidth = Math.max(1, rect.width - borderLeft - borderRight);
  const contentHeight = Math.max(1, rect.height - borderTop - borderBottom);

  // Handle CSS fit/letterboxing by mapping only inside the actually drawn bitmap area.
  const fitScale = Math.min(contentWidth / canvasWidth, contentHeight / canvasHeight);
  const renderedWidth = canvasWidth * fitScale;
  const renderedHeight = canvasHeight * fitScale;
  const offsetX = (contentWidth - renderedWidth) / 2;
  const offsetY = (contentHeight - renderedHeight) / 2;

  const pointerX = event.clientX - rect.left - borderLeft - offsetX;
  const pointerY = event.clientY - rect.top - borderTop - offsetY;
  const clampedX = clampNumber(pointerX, 0, renderedWidth, 0);
  const clampedY = clampNumber(pointerY, 0, renderedHeight, 0);
  const x = clampedX * (canvasWidth / Math.max(1, renderedWidth));
  const y = clampedY * (canvasHeight / Math.max(1, renderedHeight));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

// Resize one canvas from another while optionally constraining the maximum display dimension.
function setCanvasFromSource(targetCanvas, sourceCanvas, maxDimension = 0) {
  if (!targetCanvas || !sourceCanvas) {
    return { width: 0, height: 0, scale: 1 };
  }

  const sourceWidth = sourceCanvas.width || 0;
  const sourceHeight = sourceCanvas.height || 0;
  if (!sourceWidth || !sourceHeight) {
    targetCanvas.width = 0;
    targetCanvas.height = 0;
    return { width: 0, height: 0, scale: 1 };
  }

  const maxSide = Math.max(1, Number(maxDimension) || 0);
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight)) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  targetCanvas.width = width;
  targetCanvas.height = height;

  const ctx = targetCanvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
  }

  return { width, height, scale };
}

// Clear an entire canvas if a 2D context is available.
function clearCanvas(canvas) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Load a browser File object into an Image element so it can be drawn onto canvases.
function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No image file selected.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load selected image.'));
    };
    image.src = url;
  });
}

// Load a data URL into the cropper image host before initializing CropperJS.
function loadImageElementFromSrc(imgElement, src) {
  return new Promise((resolve, reject) => {
    if (!imgElement) {
      reject(new Error('Cropper image host is unavailable.'));
      return;
    }
    imgElement.onload = () => resolve();
    imgElement.onerror = () => reject(new Error('Failed to prepare image for cropper.'));
    imgElement.src = src;
  });
}

// Initialize the colony counter tool and wire it to the toolbox UI.
export function initColonyCounterTool() {
  // Core DOM nodes for image loading, crop controls, canvases, and summary output.
  const colonyCounterForm = document.getElementById('colony-counter-form');
  if (!colonyCounterForm) {
    return;
  }

  const colonyCounterShell = document.querySelector('#tool-colony-counter-view .colony-counter-shell');
  const colonyImageInput = document.getElementById('colony-image-file');
  const colonyMaxSizeInput = document.getElementById('colony-max-size');
  const colonyModelThresholdInput = document.getElementById('colony-model-threshold');
  const colonyModelMinDistanceInput = document.getElementById('colony-model-min-distance');
  const colonyAutoCountBtn = document.getElementById('colony-auto-count-btn');
  const colonyMaskModeSelect = document.getElementById('colony-mask-mode');
  const colonyStartMaskBtn = document.getElementById('colony-start-mask-btn');
  const colonyClearMaskBtn = document.getElementById('colony-clear-mask-btn');
  const colonyRunBtn = document.getElementById('colony-run-btn');
  const colonyResetBtn = document.getElementById('colony-reset-btn');
  const colonyStartCropBtn = document.getElementById('colony-start-crop-btn');
  const colonyApplyCropBtn = document.getElementById('colony-apply-crop-btn');
  const colonyCancelCropBtn = document.getElementById('colony-cancel-crop-btn');
  const colonyResetCropBtn = document.getElementById('colony-reset-crop-btn');
  const colonyClearMarkersBtn = document.getElementById('colony-clear-markers-btn');
  const colonyStatus = document.getElementById('colony-status');
  const colonySummary = document.getElementById('colony-summary');
  const colonyPreviewCanvas = document.getElementById('colony-preview-canvas');
  const colonyMaskCanvas = document.getElementById('colony-mask-canvas');
  const colonyCropperShell = document.getElementById('colony-cropper-shell');
  const colonyCropperImage = document.getElementById('colony-cropper-image');
  const colonySourceCanvas = document.getElementById('colony-source-canvas');

  // Offscreen/original canvases hold source pixels separately from the zoomed display canvases.
  const colonySourceCtx = colonySourceCanvas?.getContext('2d', { willReadFrequently: true }) || null;
  const colonyOriginalCanvas = document.createElement('canvas');
  const colonyOriginalCtx = colonyOriginalCanvas.getContext('2d', { willReadFrequently: true });

  // In-memory interaction state for the current image, cropper session, markers, and viewport.
  const colonyState = {
    imageName: '',
    sourceWidth: 0,
    sourceHeight: 0,
    hasImage: false,
    cropper: null,
    markers: [],
    mask: { ...EMPTY_MASK },
    maskDraft: null,
    isDrawingMask: false,
    maskStartPoint: null,
    lastCountSource: 'manual',
    lastModelStats: null,
    isModelRunning: false,
    zoom: 1,
    viewX: 0,
    viewY: 0,
    isPanning: false,
    panLastX: 0,
    panLastY: 0,
    panMoved: false,
    suppressNextClick: false
  };

  // Update the status line and optionally switch it into an error color.
  function setColonyStatus(message, isError = false) {
    if (!colonyStatus) {
      return;
    }
    colonyStatus.textContent = message;
    colonyStatus.style.color = isError ? 'var(--danger)' : '';
  }

  // Restore the summary panel to its default instructional text.
  function resetColonySummary() {
    if (!colonySummary) {
      return;
    }
    colonySummary.innerHTML = '<p class="small-note">Choose or drop a plate image, then run auto count or click colonies manually.</p>';
  }

  function hasActiveMask(mask = colonyState.mask) {
    return Boolean(mask && mask.kind && mask.kind !== 'none' && Math.abs(mask.width) > 1 && Math.abs(mask.height) > 1);
  }

  function normalizeMask(mask) {
    if (!mask || mask.kind === 'none') {
      return { ...EMPTY_MASK };
    }

    return {
      kind: mask.kind === 'circle' ? 'circle' : 'rectangle',
      x: Math.min(mask.x, mask.x + mask.width),
      y: Math.min(mask.y, mask.y + mask.height),
      width: Math.abs(mask.width),
      height: Math.abs(mask.height)
    };
  }

  function isSourcePointInsideMask(sourcePoint, mask = colonyState.mask) {
    if (!sourcePoint || !hasActiveMask(mask)) {
      return true;
    }

    const normalized = normalizeMask(mask);
    const x0 = normalized.x;
    const y0 = normalized.y;
    const x1 = normalized.x + normalized.width;
    const y1 = normalized.y + normalized.height;

    if (normalized.kind === 'rectangle') {
      return sourcePoint.x >= x0 && sourcePoint.x <= x1 && sourcePoint.y >= y0 && sourcePoint.y <= y1;
    }

    const rx = normalized.width / 2;
    const ry = normalized.height / 2;
    if (rx <= 0 || ry <= 0) {
      return false;
    }
    const cx = normalized.x + rx;
    const cy = normalized.y + ry;
    const dx = (sourcePoint.x - cx) / rx;
    const dy = (sourcePoint.y - cy) / ry;
    return ((dx * dx) + (dy * dy)) <= 1;
  }

  function getCountedMarkers() {
    return colonyState.markers.filter((marker) => isSourcePointInsideMask(marker));
  }

  // Render the current colony count and interaction hints.
  function renderColonySummary() {
    if (!colonySummary) {
      return;
    }
    const countedMarkers = getCountedMarkers();
    const count = countedMarkers.length;
    const total = colonyState.markers.length;
    const hasMask = hasActiveMask();
    const label = colonyState.lastCountSource === 'model' ? 'Model colonies counted' : 'Colonies counted';
    const maskNote = hasMask && total !== count
      ? `<p class="small-note">${count} of ${total} marker${total === 1 ? '' : 's'} are inside the active mask.</p>`
      : '';
    const modelNote = colonyState.lastModelStats
      ? `<p class="small-note">Model threshold ${colonyState.lastModelStats.threshold.toFixed(2)}, min distance ${colonyState.lastModelStats.minDistance}px, ${Math.round(colonyState.lastModelStats.elapsedMs).toLocaleString()} ms.</p>`
      : '';
    colonySummary.innerHTML = `
      <p><strong>${label}:</strong> ${count}</p>
      ${maskNote}
      ${modelNote}
      <p class="small-note">Left-click to add a marker. Right-click to remove the nearest marker. Draw a mask to count only colonies inside it.</p>
    `;
  }

  // Check whether CropperJS is currently active on the loaded image.
  function isCropModeActive() {
    return Boolean(colonyState.cropper);
  }

  // Read and clamp display-related settings from the form inputs.
  function getDisplaySettings() {
    return {
      maxProcessSize: Math.round(clampNumber(colonyMaxSizeInput?.value, 300, 5000, 1600))
    };
  }

  function getModelSettings() {
    return {
      threshold: clampNumber(colonyModelThresholdInput?.value, 0.01, 0.99, 0.5),
      minDistance: Math.round(clampNumber(colonyModelMinDistanceInput?.value, 1, 50, 3))
    };
  }

  // Reset zoom and pan state back to the full-image view.
  function resetViewport() {
    colonyState.zoom = 1;
    colonyState.viewX = 0;
    colonyState.viewY = 0;
    colonyState.isPanning = false;
    colonyState.panLastX = 0;
    colonyState.panLastY = 0;
    colonyState.panMoved = false;
    colonyState.suppressNextClick = false;
  }

  // Apply a new viewport while clamping zoom and pan to the image bounds.
  function setViewport(nextState = {}) {
    const sourceWidth = colonyState.sourceWidth || 0;
    const sourceHeight = colonyState.sourceHeight || 0;
    if (!sourceWidth || !sourceHeight) {
      resetViewport();
      return;
    }

    const zoom = clampNumber(nextState.zoom ?? colonyState.zoom, 1, 12, 1);
    const viewWidth = sourceWidth / zoom;
    const viewHeight = sourceHeight / zoom;
    const maxX = Math.max(0, sourceWidth - viewWidth);
    const maxY = Math.max(0, sourceHeight - viewHeight);
    const nextX = clampNumber(nextState.x ?? colonyState.viewX, 0, maxX, 0);
    const nextY = clampNumber(nextState.y ?? colonyState.viewY, 0, maxY, 0);

    colonyState.zoom = zoom;
    colonyState.viewX = nextX;
    colonyState.viewY = nextY;
  }

  // Compute the current visible source rectangle and preview-canvas geometry.
  function getViewport() {
    const sourceWidth = colonyState.sourceWidth || 0;
    const sourceHeight = colonyState.sourceHeight || 0;
    const previewWidth = colonyPreviewCanvas?.width || 0;
    const previewHeight = colonyPreviewCanvas?.height || 0;
    if (!sourceWidth || !sourceHeight || !previewWidth || !previewHeight) {
      return null;
    }

    const zoom = clampNumber(colonyState.zoom, 1, 12, 1);
    const viewWidth = sourceWidth / zoom;
    const viewHeight = sourceHeight / zoom;
    const maxX = Math.max(0, sourceWidth - viewWidth);
    const maxY = Math.max(0, sourceHeight - viewHeight);
    const x = clampNumber(colonyState.viewX, 0, maxX, 0);
    const y = clampNumber(colonyState.viewY, 0, maxY, 0);

    return {
      sourceWidth,
      sourceHeight,
      previewWidth,
      previewHeight,
      zoom,
      viewWidth,
      viewHeight,
      x,
      y
    };
  }

  // Map a marker from source-image coordinates into the currently visible preview canvas.
  function sourceToPreviewPoint(sourcePoint) {
    const viewport = getViewport();
    if (!sourcePoint || !viewport) {
      return null;
    }
    return {
      x: ((sourcePoint.x - viewport.x) / viewport.viewWidth) * viewport.previewWidth,
      y: ((sourcePoint.y - viewport.y) / viewport.viewHeight) * viewport.previewHeight
    };
  }

  // Map a click on the preview canvas back into source-image coordinates.
  function previewToSourcePoint(previewPoint) {
    const viewport = getViewport();
    if (!previewPoint || !viewport) {
      return null;
    }
    return {
      x: clampNumber(
        viewport.x + ((previewPoint.x / viewport.previewWidth) * viewport.viewWidth),
        0,
        Math.max(0, viewport.sourceWidth - 1),
        0
      ),
      y: clampNumber(
        viewport.y + ((previewPoint.y / viewport.previewHeight) * viewport.viewHeight),
        0,
        Math.max(0, viewport.sourceHeight - 1),
        0
      )
    };
  }

  function sourceMaskToPreviewBox(mask) {
    if (!hasActiveMask(mask)) {
      return null;
    }

    const normalized = normalizeMask(mask);
    const topLeft = sourceToPreviewPoint({ x: normalized.x, y: normalized.y });
    const bottomRight = sourceToPreviewPoint({
      x: normalized.x + normalized.width,
      y: normalized.y + normalized.height
    });
    if (!topLeft || !bottomRight) {
      return null;
    }

    return {
      kind: normalized.kind,
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    };
  }

  function drawMaskShapePath(ctx, previewMask) {
    if (!ctx || !previewMask) {
      return;
    }

    if (previewMask.kind === 'circle') {
      ctx.ellipse(
        previewMask.x + (previewMask.width / 2),
        previewMask.y + (previewMask.height / 2),
        Math.abs(previewMask.width) / 2,
        Math.abs(previewMask.height) / 2,
        0,
        0,
        Math.PI * 2
      );
      return;
    }

    ctx.rect(previewMask.x, previewMask.y, previewMask.width, previewMask.height);
  }

  function drawMaskOverlay(ctx) {
    if (!ctx) {
      return;
    }

    const viewport = getViewport();
    const mask = colonyState.maskDraft || colonyState.mask;
    const previewMask = sourceMaskToPreviewBox(mask);
    if (!viewport || !previewMask) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, viewport.previewWidth, viewport.previewHeight);
    drawMaskShapePath(ctx, previewMask);
    ctx.fillStyle = 'rgba(5, 12, 24, 0.36)';
    ctx.fill('evenodd');

    ctx.beginPath();
    drawMaskShapePath(ctx, previewMask);
    ctx.fillStyle = colonyState.maskDraft ? 'rgba(45, 156, 219, 0.12)' : 'rgba(45, 156, 219, 0.08)';
    ctx.strokeStyle = colonyState.maskDraft ? 'rgba(47, 128, 237, 0.95)' : 'rgba(47, 128, 237, 0.82)';
    ctx.lineWidth = 3;
    ctx.setLineDash(colonyState.maskDraft ? [8, 6] : []);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Draw numbered marker circles onto the visible preview canvas.
  function drawMarkers(ctx) {
    if (!ctx) {
      return;
    }

    const viewport = getViewport();
    if (!viewport) {
      return;
    }

    const showLabels = colonyState.lastCountSource !== 'model' && colonyState.markers.length <= 120;
    const radius = colonyState.lastCountSource === 'model' ? 5 : 7;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = '600 12px "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';

    colonyState.markers.forEach((marker, index) => {
      const previewPoint = sourceToPreviewPoint(marker);
      if (!previewPoint) {
        return;
      }
      const x = previewPoint.x;
      const y = previewPoint.y;
      if (x < -radius || y < -radius || x > (viewport.previewWidth + radius) || y > (viewport.previewHeight + radius)) {
        return;
      }

      const counted = isSourcePointInsideMask(marker);
      ctx.strokeStyle = counted ? 'rgba(255, 99, 71, 0.95)' : 'rgba(115, 126, 145, 0.75)';
      ctx.fillStyle = counted ? 'rgba(255, 245, 245, 0.95)' : 'rgba(232, 236, 243, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (!showLabels) {
        return;
      }

      const label = String(index + 1);
      const labelX = Math.max(0, x + 8);
      const labelY = Math.max(0, y + 8);
      ctx.fillStyle = counted ? 'rgba(180, 20, 20, 0.95)' : 'rgba(90, 101, 120, 0.85)';
      ctx.fillText(label, labelX, labelY);
    });

    ctx.restore();
  }

  // Render the simplified marker-only mask canvas used alongside the preview.
  function renderMarkerCanvas() {
    if (!colonyMaskCanvas) {
      return;
    }

    const previewWidth = colonyPreviewCanvas?.width || 0;
    const previewHeight = colonyPreviewCanvas?.height || 0;
    if (!previewWidth || !previewHeight) {
      clearCanvas(colonyMaskCanvas);
      return;
    }

    colonyMaskCanvas.width = previewWidth;
    colonyMaskCanvas.height = previewHeight;
    const ctx = colonyMaskCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, previewWidth, previewHeight);
    ctx.fillStyle = '#101827';
    ctx.fillRect(0, 0, previewWidth, previewHeight);

    const previewMask = sourceMaskToPreviewBox(colonyState.maskDraft || colonyState.mask);
    if (previewMask) {
      ctx.save();
      ctx.beginPath();
      drawMaskShapePath(ctx, previewMask);
      ctx.fillStyle = 'rgba(47, 128, 237, 0.22)';
      ctx.strokeStyle = 'rgba(125, 184, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    colonyState.markers.forEach((marker) => {
      const previewPoint = sourceToPreviewPoint(marker);
      if (!previewPoint) {
        return;
      }
      const x = previewPoint.x;
      const y = previewPoint.y;
      const radius = 5;
      if (x < -radius || y < -radius || x > (previewWidth + radius) || y > (previewHeight + radius)) {
        return;
      }
      ctx.fillStyle = isSourcePointInsideMask(marker) ? 'rgba(90, 230, 140, 0.95)' : 'rgba(140, 150, 165, 0.55)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Render the currently visible image region, then overlay mask and markers.
  function renderPreviewCanvas() {
    if (!colonyPreviewCanvas || !colonySourceCanvas) {
      return;
    }

    const settings = getDisplaySettings();
    const { width, height } = setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);

    if (!width || !height) {
      clearCanvas(colonyMaskCanvas);
      return;
    }

    const previewCtx = colonyPreviewCanvas.getContext('2d');
    const viewport = getViewport();
    if (!previewCtx || !viewport) {
      return;
    }
    previewCtx.clearRect(0, 0, width, height);
    previewCtx.drawImage(
      colonySourceCanvas,
      viewport.x,
      viewport.y,
      viewport.viewWidth,
      viewport.viewHeight,
      0,
      0,
      width,
      height
    );
    drawMaskOverlay(previewCtx);
    drawMarkers(previewCtx);
    renderMarkerCanvas();
  }

  // Enable or disable buttons and cursors based on image availability, crop mode, and marker state.
  function updateControlState() {
    const hasImage = colonyState.hasImage;
    const cropActive = isCropModeActive();
    const busy = colonyState.isModelRunning;
    const drawingMask = colonyState.isDrawingMask;

    if (colonyStartCropBtn) {
      colonyStartCropBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyApplyCropBtn) {
      colonyApplyCropBtn.disabled = !cropActive || busy || drawingMask;
    }
    if (colonyCancelCropBtn) {
      colonyCancelCropBtn.disabled = !cropActive || busy || drawingMask;
    }
    if (colonyResetCropBtn) {
      colonyResetCropBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyAutoCountBtn) {
      colonyAutoCountBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyStartMaskBtn) {
      colonyStartMaskBtn.disabled = !hasImage || cropActive || busy;
      colonyStartMaskBtn.textContent = drawingMask ? 'Cancel Mask' : 'Draw Mask';
    }
    if (colonyClearMaskBtn) {
      colonyClearMaskBtn.disabled = !hasImage || cropActive || busy || drawingMask || !hasActiveMask();
    }
    if (colonyClearMarkersBtn) {
      colonyClearMarkersBtn.disabled = !hasImage || cropActive || busy || drawingMask || colonyState.markers.length === 0;
    }
    if (colonyRunBtn) {
      colonyRunBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyPreviewCanvas) {
      if (!hasImage || cropActive) {
        colonyPreviewCanvas.style.cursor = 'default';
      } else if (drawingMask) {
        colonyPreviewCanvas.style.cursor = 'crosshair';
      } else if (colonyState.isPanning) {
        colonyPreviewCanvas.style.cursor = 'grabbing';
      } else if (colonyState.zoom > 1.001) {
        colonyPreviewCanvas.style.cursor = 'grab';
      } else {
        colonyPreviewCanvas.style.cursor = 'crosshair';
      }
    }
  }

  // Remove the cropper image source so the host element is fully reset.
  function clearCropperImage() {
    if (!colonyCropperImage) {
      return;
    }
    colonyCropperImage.removeAttribute('src');
  }

  // Tear down any active CropperJS instance and hide the crop UI.
  function destroyCropper() {
    if (colonyState.cropper) {
      colonyState.cropper.destroy();
      colonyState.cropper = null;
    }
    if (colonyCropperShell) {
      colonyCropperShell.hidden = true;
    }
    clearCropperImage();
    updateControlState();
  }

  // Remove all colony markers from the current image.
  function clearMarkers() {
    if (!colonyState.markers.length) {
      return;
    }
    colonyState.markers = [];
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('All colony markers cleared.');
    updateControlState();
  }

  // Clear markers, masks, and model run metadata when the loaded image or crop region changes.
  function clearMarkersForImageChange() {
    colonyState.markers = [];
    colonyState.mask = { ...EMPTY_MASK };
    colonyState.maskDraft = null;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderColonySummary();
  }

  // Load a selected image file into both the original backing canvas and the editable source canvas.
  async function loadColonyImage(file) {
    if (!colonySourceCanvas || !colonySourceCtx || !colonyOriginalCtx) {
      return;
    }

    destroyCropper();
    const image = await loadImageElementFromFile(file);
    const width = Math.max(1, image.naturalWidth || image.width || 1);
    const height = Math.max(1, image.naturalHeight || image.height || 1);

    colonyOriginalCanvas.width = width;
    colonyOriginalCanvas.height = height;
    colonyOriginalCtx.clearRect(0, 0, width, height);
    colonyOriginalCtx.drawImage(image, 0, 0, width, height);

    colonySourceCanvas.width = width;
    colonySourceCanvas.height = height;
    colonySourceCtx.clearRect(0, 0, width, height);
    colonySourceCtx.drawImage(colonyOriginalCanvas, 0, 0, width, height);

    colonyState.imageName = file?.name || 'uploaded-image';
    colonyState.sourceWidth = width;
    colonyState.sourceHeight = height;
    colonyState.hasImage = true;

    clearMarkersForImageChange();
    resetViewport();
    renderPreviewCanvas();
    setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height}). Run auto count or click colonies to adjust.`);
    updateControlState();
  }

  // Load an image from either the picker or a drop gesture through the same pipeline.
  async function handleColonyImageFile(file, { syncFileInput = false } = {}) {
    if (!file) {
      return;
    }

    setColonyStatus('Loading image...');
    try {
      await loadColonyImage(file);
      if (syncFileInput) {
        mergeFilesIntoInput(colonyImageInput, [file], { append: false });
      }
    } catch (error) {
      const message = error?.message || 'Image load failed.';
      setColonyStatus(message, true);
      if (colonySummary) {
        colonySummary.innerHTML = `<p class="small-note">${escapeHtml(message)}</p>`;
      }
    }
  }

  // Enter crop mode by copying the current source canvas into the CropperJS host image.
  async function startCropMode() {
    if (!colonyState.hasImage || !colonySourceCanvas) {
      setColonyStatus('Load an image before cropping.', true);
      return;
    }

    if (typeof window.Cropper !== 'function') {
      setColonyStatus('CropperJS is unavailable. Ensure ./vendor/cropperjs/cropper.min.js is loaded.', true);
      return;
    }

    if (!colonyCropperImage || !colonyCropperShell) {
      setColonyStatus('Cropper host is unavailable in the UI.', true);
      return;
    }

    destroyCropper();
    colonyCropperShell.hidden = false;
    await loadImageElementFromSrc(colonyCropperImage, colonySourceCanvas.toDataURL('image/png'));
    colonyState.cropper = new window.Cropper(colonyCropperImage, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      responsive: true,
      background: false,
      checkCrossOrigin: false
    });
    setColonyStatus('Crop mode active. Apply crop to continue counting.');
    updateControlState();
  }

  // Replace the current source image with the cropper's selected region.
  function applyCrop() {
    if (!colonyState.cropper || !colonySourceCanvas || !colonySourceCtx) {
      return;
    }

    const croppedCanvas = colonyState.cropper.getCroppedCanvas({
      fillColor: '#ffffff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!croppedCanvas || !croppedCanvas.width || !croppedCanvas.height) {
      setColonyStatus('Crop failed. Try selecting a larger area.', true);
      return;
    }

    colonySourceCanvas.width = croppedCanvas.width;
    colonySourceCanvas.height = croppedCanvas.height;
    colonySourceCtx.clearRect(0, 0, croppedCanvas.width, croppedCanvas.height);
    colonySourceCtx.drawImage(croppedCanvas, 0, 0);

    colonyState.sourceWidth = croppedCanvas.width;
    colonyState.sourceHeight = croppedCanvas.height;

    clearMarkersForImageChange();
    resetViewport();
    destroyCropper();
    renderPreviewCanvas();
    setColonyStatus(`Crop applied (${croppedCanvas.width}x${croppedCanvas.height}). Run auto count or click colonies to recount.`);
    updateControlState();
  }

  // Restore the uncropped original image back into the active source canvas.
  function resetToOriginalImage() {
    if (!colonyState.hasImage || !colonyOriginalCanvas || !colonySourceCanvas || !colonySourceCtx) {
      return;
    }

    const width = colonyOriginalCanvas.width || 0;
    const height = colonyOriginalCanvas.height || 0;
    if (!width || !height) {
      return;
    }

    destroyCropper();
    colonySourceCanvas.width = width;
    colonySourceCanvas.height = height;
    colonySourceCtx.clearRect(0, 0, width, height);
    colonySourceCtx.drawImage(colonyOriginalCanvas, 0, 0);

    colonyState.sourceWidth = width;
    colonyState.sourceHeight = height;

    clearMarkersForImageChange();
    resetViewport();
    renderPreviewCanvas();
    setColonyStatus(`Restored full image (${width}x${height}). Run auto count or click colonies to count.`);
    updateControlState();
  }

  function startMaskDrawing() {
    if (!colonyState.hasImage) {
      setColonyStatus('Load an image before drawing a mask.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before drawing a mask.', true);
      return;
    }
    if (colonyState.isDrawingMask) {
      colonyState.isDrawingMask = false;
      colonyState.maskDraft = null;
      colonyState.maskStartPoint = null;
      renderPreviewCanvas();
      setColonyStatus('Mask drawing cancelled.');
      updateControlState();
      return;
    }

    colonyState.isDrawingMask = true;
    colonyState.maskDraft = null;
    colonyState.maskStartPoint = null;
    setColonyStatus('Drag on the plate preview to draw the count mask.');
    updateControlState();
  }

  function clearMask() {
    if (!hasActiveMask() && !colonyState.maskDraft) {
      return;
    }
    colonyState.mask = { ...EMPTY_MASK };
    colonyState.maskDraft = null;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('Mask cleared. Counts now include the full plate image.');
    updateControlState();
  }

  function buildMaskFromSourcePoints(startPoint, endPoint) {
    if (!startPoint || !endPoint) {
      return null;
    }

    const kind = colonyMaskModeSelect?.value === 'circle' ? 'circle' : 'rectangle';
    return normalizeMask({
      kind,
      x: startPoint.x,
      y: startPoint.y,
      width: endPoint.x - startPoint.x,
      height: endPoint.y - startPoint.y
    });
  }

  async function runModelCount() {
    if (!colonyState.hasImage || !colonySourceCanvas) {
      setColonyStatus('Load a plate image before running auto count.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before running auto count.', true);
      return;
    }
    if (colonyState.isDrawingMask) {
      setColonyStatus('Finish or cancel mask drawing before running auto count.', true);
      return;
    }

    const settings = getModelSettings();
    colonyState.isModelRunning = true;
    updateControlState();
    setColonyStatus('Loading colony model and counting...');

    try {
      const result = await countColoniesWithModel(colonySourceCanvas, {
        ...settings,
        mask: colonyState.mask
      });

      colonyState.markers = result.colonies.map((colony) => ({
        x: colony.x,
        y: colony.y,
        source: 'model',
        score: colony.score
      }));
      colonyState.lastCountSource = 'model';
      colonyState.lastModelStats = {
        threshold: result.threshold,
        minDistance: result.minDistance,
        elapsedMs: result.elapsedMs,
        totalPeaks: result.totalPeaks
      };

      renderPreviewCanvas();
      renderColonySummary();
      const maskText = hasActiveMask() ? ` inside mask (${result.totalPeaks} total plate peak${result.totalPeaks === 1 ? '' : 's'})` : '';
      setColonyStatus(`Auto count: ${colonyState.markers.length} colon${colonyState.markers.length === 1 ? 'y' : 'ies'}${maskText}.`);
    } catch (error) {
      setColonyStatus(error?.message || 'Auto count failed.', true);
      console.error('Colony auto count failed:', error);
    } finally {
      colonyState.isModelRunning = false;
      updateControlState();
    }
  }

  // Add a marker at the clicked colony unless one already exists nearby.
  function addManualMarkerFromCanvasPoint(point) {
    if (!point || !colonyState.hasImage) {
      return;
    }

    const sourcePoint = previewToSourcePoint(point);
    if (!sourcePoint) {
      return;
    }

    if (!isSourcePointInsideMask(sourcePoint)) {
      setColonyStatus('That point is outside the active mask. Clear or redraw the mask to count it.');
      return;
    }

    const mergeThresholdPx = 10;
    const hasNearbyMarker = colonyState.markers.some((marker) => {
      const markerPreviewPoint = sourceToPreviewPoint(marker);
      if (!markerPreviewPoint) {
        return false;
      }
      const dx = markerPreviewPoint.x - point.x;
      const dy = markerPreviewPoint.y - point.y;
      return ((dx * dx) + (dy * dy)) <= (mergeThresholdPx * mergeThresholdPx);
    });

    if (hasNearbyMarker) {
      setColonyStatus('Marker already exists near that colony. Right-click to remove if needed.');
      return;
    }

    colonyState.markers.push({
      ...sourcePoint,
      source: 'manual'
    });
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Count: ${getCountedMarkers().length}`);
    updateControlState();
  }

  // Remove the nearest marker when the user right-clicks close enough to it.
  function removeNearestMarkerFromCanvasPoint(point) {
    if (!point || !colonyState.markers.length) {
      return;
    }

    let nearestIndex = -1;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    for (let index = 0; index < colonyState.markers.length; index += 1) {
      const marker = colonyState.markers[index];
      const markerPreviewPoint = sourceToPreviewPoint(marker);
      if (!markerPreviewPoint) {
        continue;
      }
      const dx = markerPreviewPoint.x - point.x;
      const dy = markerPreviewPoint.y - point.y;
      const distanceSq = (dx * dx) + (dy * dy);
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestIndex = index;
      }
    }

    if (nearestIndex < 0) {
      return;
    }

    const removalThresholdPx = 16;
    if (nearestDistanceSq > (removalThresholdPx * removalThresholdPx)) {
      setColonyStatus('No marker near that point. Right-click closer to the marker to remove it.');
      return;
    }

    colonyState.markers.splice(nearestIndex, 1);
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Count: ${getCountedMarkers().length}`);
    updateControlState();
  }

  // Zoom around the pointer location while preserving the anchored source point under the cursor.
  function zoomPreviewAtPoint(point, requestedZoom) {
    const viewport = getViewport();
    if (!viewport || !point) {
      return;
    }
    const sourceAnchor = previewToSourcePoint(point);
    if (!sourceAnchor) {
      return;
    }

    const zoom = clampNumber(requestedZoom, 1, 12, 1);
    if (Math.abs(zoom - viewport.zoom) < 0.0001) {
      return;
    }

    const nextViewWidth = viewport.sourceWidth / zoom;
    const nextViewHeight = viewport.sourceHeight / zoom;
    const anchorRatioX = clampNumber(point.x / Math.max(1, viewport.previewWidth), 0, 1, 0.5);
    const anchorRatioY = clampNumber(point.y / Math.max(1, viewport.previewHeight), 0, 1, 0.5);
    const nextX = sourceAnchor.x - (anchorRatioX * nextViewWidth);
    const nextY = sourceAnchor.y - (anchorRatioY * nextViewHeight);

    setViewport({
      zoom,
      x: nextX,
      y: nextY
    });
    renderPreviewCanvas();
    updateControlState();
  }

  // Pan the viewport in source-image space using preview-canvas drag deltas.
  function panPreviewByCanvasDelta(deltaX, deltaY) {
    const viewport = getViewport();
    if (!viewport || viewport.zoom <= 1.001) {
      return;
    }

    const sourcePerCanvasX = viewport.viewWidth / Math.max(1, viewport.previewWidth);
    const sourcePerCanvasY = viewport.viewHeight / Math.max(1, viewport.previewHeight);
    const nextX = viewport.x - (deltaX * sourcePerCanvasX);
    const nextY = viewport.y - (deltaY * sourcePerCanvasY);

    setViewport({ x: nextX, y: nextY });
    renderPreviewCanvas();
  }

  // End an active pan gesture and suppress the follow-up click when a drag occurred.
  function finishPanning() {
    if (!colonyState.isPanning) {
      return;
    }
    colonyState.isPanning = false;
    if (colonyState.panMoved) {
      colonyState.suppressNextClick = true;
    }
    colonyState.panMoved = false;
    updateControlState();
  }

  // Finalize the current count into the status and summary display.
  function renderManualCountResult() {
    if (!colonyState.hasImage) {
      setColonyStatus('Load a plate image first.', true);
      return;
    }

    const count = getCountedMarkers().length;
    setColonyStatus(`Colony count saved: ${count}`);
    renderColonySummary();
  }

  // Fully reset the tool state, canvases, cropper, inputs, and marker list.
  function resetColonyCounter() {
    destroyCropper();
    colonyState.imageName = '';
    colonyState.sourceWidth = 0;
    colonyState.sourceHeight = 0;
    colonyState.hasImage = false;
    colonyState.markers = [];
    colonyState.mask = { ...EMPTY_MASK };
    colonyState.maskDraft = null;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    colonyState.isModelRunning = false;
    resetViewport();

    if (colonyImageInput) {
      colonyImageInput.value = '';
    }
    if (colonyOriginalCtx) {
      colonyOriginalCtx.clearRect(0, 0, colonyOriginalCanvas.width, colonyOriginalCanvas.height);
    }
    colonyOriginalCanvas.width = 0;
    colonyOriginalCanvas.height = 0;

    if (colonySourceCtx && colonySourceCanvas) {
      colonySourceCtx.clearRect(0, 0, colonySourceCanvas.width, colonySourceCanvas.height);
      colonySourceCanvas.width = 0;
      colonySourceCanvas.height = 0;
    }

    clearCanvas(colonyPreviewCanvas);
    clearCanvas(colonyMaskCanvas);
    resetColonySummary();
    setColonyStatus('Choose or drop an image, then run auto count or click colonies manually.');
    updateControlState();
  }

  function updateMaskDraftFromCanvasPoint(point) {
    if (!colonyState.isDrawingMask || !colonyState.maskStartPoint || !point) {
      return;
    }

    const sourcePoint = previewToSourcePoint(point);
    if (!sourcePoint) {
      return;
    }

    colonyState.maskDraft = buildMaskFromSourcePoints(colonyState.maskStartPoint, sourcePoint);
    renderPreviewCanvas();
  }

  function finishMaskDrawingFromCanvasPoint(point) {
    if (!colonyState.isDrawingMask) {
      return false;
    }

    if (point) {
      updateMaskDraftFromCanvasPoint(point);
    }

    const draft = colonyState.maskDraft;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    colonyState.maskDraft = null;
    colonyState.suppressNextClick = true;

    if (!hasActiveMask(draft)) {
      renderPreviewCanvas();
      setColonyStatus('Mask was too small. Drag a wider region to count under a mask.', true);
      updateControlState();
      return true;
    }

    colonyState.mask = normalizeMask(draft);
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('Mask applied. Counts now include colonies inside the mask only.');
    updateControlState();
    return true;
  }

  // Handle left-click counting on the preview canvas when crop mode is inactive.
  function handlePreviewClick(event) {
    if (colonyState.suppressNextClick) {
      colonyState.suppressNextClick = false;
      return;
    }
    if (!colonyState.hasImage) {
      setColonyStatus('Load an image before counting.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before counting.', true);
      return;
    }
    if (colonyState.isDrawingMask) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    addManualMarkerFromCanvasPoint(point);
  }

  // Start a pan gesture when the user presses on a zoomed preview.
  function handlePreviewMouseDown(event) {
    if (!colonyState.hasImage || isCropModeActive() || event.button !== 0) {
      return;
    }
    if (colonyState.isDrawingMask) {
      const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
      const sourcePoint = previewToSourcePoint(point);
      if (sourcePoint) {
        colonyState.maskStartPoint = sourcePoint;
        colonyState.maskDraft = buildMaskFromSourcePoints(sourcePoint, sourcePoint);
        renderPreviewCanvas();
      }
      event.preventDefault();
      return;
    }
    if (colonyState.zoom <= 1.001) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    if (!point) {
      return;
    }
    colonyState.isPanning = true;
    colonyState.panLastX = point.x;
    colonyState.panLastY = point.y;
    colonyState.panMoved = false;
    updateControlState();
    event.preventDefault();
  }

  // Continue an active pan gesture as the pointer moves across the preview.
  function handlePreviewMouseMove(event) {
    if (colonyState.isDrawingMask) {
      const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
      updateMaskDraftFromCanvasPoint(point);
      event.preventDefault();
      return;
    }

    if (!colonyState.isPanning) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    if (!point) {
      return;
    }
    const deltaX = point.x - colonyState.panLastX;
    const deltaY = point.y - colonyState.panLastY;
    colonyState.panLastX = point.x;
    colonyState.panLastY = point.y;
    if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
      colonyState.panMoved = true;
      panPreviewByCanvasDelta(deltaX, deltaY);
    }
    event.preventDefault();
  }

  // Zoom in or out around the wheel pointer position.
  function handlePreviewWheel(event) {
    if (!colonyState.hasImage || isCropModeActive() || colonyState.isDrawingMask) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    if (!point) {
      return;
    }
    const viewport = getViewport();
    if (!viewport) {
      return;
    }
    const zoomFactor = Math.exp(-(Number(event.deltaY) || 0) * 0.0015);
    zoomPreviewAtPoint(point, viewport.zoom * zoomFactor);
    event.preventDefault();
  }

  // Use right-click on the preview canvas to remove the nearest marker.
  function handlePreviewContextMenu(event) {
    event.preventDefault();
    if (!colonyState.hasImage || isCropModeActive() || colonyState.isDrawingMask) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    removeNearestMarkerFromCanvasPoint(point);
  }

  syncDisplayInput();
  syncModelInputs();
  resetColonySummary();
  setColonyStatus('Choose or drop an image, then run auto count or click colonies manually.');
  updateControlState();

  // Clamp the max-size display input so preview rendering stays within supported bounds.
  function syncDisplayInput() {
    if (!colonyMaxSizeInput) {
      return;
    }
    const value = Math.round(clampNumber(colonyMaxSizeInput.value, 300, 5000, 1600));
    colonyMaxSizeInput.value = String(value);
  }

  function syncModelInputs() {
    const settings = getModelSettings();
    if (colonyModelThresholdInput) {
      colonyModelThresholdInput.value = settings.threshold.toFixed(2);
    }
    if (colonyModelMinDistanceInput) {
      colonyModelMinDistanceInput.value = String(settings.minDistance);
    }
  }

  // Re-render the preview when the configured display size changes.
  colonyMaxSizeInput?.addEventListener('change', () => {
    syncDisplayInput();
    if (colonyState.hasImage) {
      renderPreviewCanvas();
    }
  });

  colonyModelThresholdInput?.addEventListener('change', () => {
    syncModelInputs();
  });

  colonyModelMinDistanceInput?.addEventListener('change', () => {
    syncModelInputs();
  });

  // Load a newly selected image file into the tool.
  colonyImageInput?.addEventListener('change', async () => {
    const file = colonyImageInput.files?.[0];
    await handleColonyImageFile(file);
  });

  bindFileDropTarget({
    target: colonyCounterShell || colonyCounterForm,
    accept: colonyImageInput?.getAttribute?.('accept') || 'image/*',
    onFiles: ([file]) => handleColonyImageFile(file, { syncFileInput: true }),
    onRejected: () => {
      setColonyStatus('Drop an image file to load a colony plate.', true);
    },
    onError: (error) => {
      setColonyStatus(String(error?.message || error || 'Failed to load the dropped colony image.'), true);
    }
  });

  // Enter crop mode.
  colonyStartCropBtn?.addEventListener('click', async () => {
    try {
      await startCropMode();
    } catch (error) {
      setColonyStatus(error.message || 'Failed to start crop mode.', true);
      destroyCropper();
    }
  });

  // Apply the current crop selection.
  colonyApplyCropBtn?.addEventListener('click', () => {
    applyCrop();
  });

  // Exit crop mode without changing the current source image.
  colonyCancelCropBtn?.addEventListener('click', () => {
    destroyCropper();
    setColonyStatus('Crop cancelled.');
  });

  // Restore the original uncropped image.
  colonyResetCropBtn?.addEventListener('click', () => {
    resetToOriginalImage();
  });

  colonyAutoCountBtn?.addEventListener('click', async () => {
    await runModelCount();
  });

  colonyStartMaskBtn?.addEventListener('click', () => {
    startMaskDrawing();
  });

  colonyClearMaskBtn?.addEventListener('click', () => {
    clearMask();
  });

  // Count colonies with left-click on the preview.
  colonyPreviewCanvas?.addEventListener('click', (event) => {
    handlePreviewClick(event);
  });

  // Begin panning on mouse down when zoomed in.
  colonyPreviewCanvas?.addEventListener('mousedown', (event) => {
    handlePreviewMouseDown(event);
  });

  // Continue panning while the pointer moves.
  colonyPreviewCanvas?.addEventListener('mousemove', (event) => {
    handlePreviewMouseMove(event);
  });

  // Finish panning when the mouse button is released over the preview.
  colonyPreviewCanvas?.addEventListener('mouseup', (event) => {
    if (colonyState.isDrawingMask) {
      const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
      finishMaskDrawingFromCanvasPoint(point);
      return;
    }
    finishPanning();
  });

  // Finish panning when the pointer leaves the preview canvas.
  colonyPreviewCanvas?.addEventListener('mouseleave', () => {
    finishPanning();
  });

  // Zoom with the mouse wheel.
  colonyPreviewCanvas?.addEventListener('wheel', (event) => {
    handlePreviewWheel(event);
  }, { passive: false });

  // Remove markers with right-click.
  colonyPreviewCanvas?.addEventListener('contextmenu', (event) => {
    handlePreviewContextMenu(event);
  });

  // Ensure pan state is cleared even if the mouse is released outside the canvas.
  window.addEventListener('mouseup', () => {
    if (colonyState.isDrawingMask && colonyState.maskDraft) {
      finishMaskDrawingFromCanvasPoint(null);
      return;
    }
    finishPanning();
  });

  // Treat form submission as confirmation of the current count.
  colonyCounterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderManualCountResult();
  });

  // Clear all current markers.
  colonyClearMarkersBtn?.addEventListener('click', () => {
    clearMarkers();
  });

  // Fully reset the tool.
  colonyResetBtn?.addEventListener('click', () => {
    resetColonyCounter();
  });
}
