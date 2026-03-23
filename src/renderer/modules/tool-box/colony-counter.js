// Manual colony counter tool.
//
// Responsibilities:
// - load and display colony plate images on layered canvases
// - support crop, zoom, and pan interactions before manual counting
// - let users add or remove colony markers directly on the preview
// - keep a synchronized marker mask and manual count summary
import {
  clampNumber,
  escapeHtml
} from './common.js';

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

  const colonyImageInput = document.getElementById('colony-image-file');
  const colonyMaxSizeInput = document.getElementById('colony-max-size');
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
    colonySummary.innerHTML = '<p class="small-note">Load a plate image, then click each colony to count manually.</p>';
  }

  // Render the current manual colony count and interaction hints.
  function renderColonySummary() {
    if (!colonySummary) {
      return;
    }
    const count = colonyState.markers.length;
    colonySummary.innerHTML = `
      <p><strong>Manual colonies counted:</strong> ${count}</p>
      <p class="small-note">Left-click to add a marker. Right-click to remove the nearest marker. Scroll to zoom, then drag to pan.</p>
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

  // Draw numbered marker circles onto the visible preview canvas.
  function drawMarkers(ctx) {
    if (!ctx) {
      return;
    }

    const viewport = getViewport();
    if (!viewport) {
      return;
    }

    const radius = 7;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 99, 71, 0.95)';
    ctx.fillStyle = 'rgba(255, 245, 245, 0.95)';
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

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const label = String(index + 1);
      const labelX = Math.max(0, x + 8);
      const labelY = Math.max(0, y + 8);
      ctx.fillStyle = 'rgba(180, 20, 20, 0.95)';
      ctx.fillText(label, labelX, labelY);
      ctx.fillStyle = 'rgba(255, 245, 245, 0.95)';
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

    ctx.save();
    ctx.fillStyle = 'rgba(90, 230, 140, 0.95)';
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
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Render the currently visible image region, then overlay manual markers.
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
    drawMarkers(previewCtx);
    renderMarkerCanvas();
  }

  // Enable or disable buttons and cursors based on image availability, crop mode, and marker state.
  function updateControlState() {
    const hasImage = colonyState.hasImage;
    const cropActive = isCropModeActive();

    if (colonyStartCropBtn) {
      colonyStartCropBtn.disabled = !hasImage || cropActive;
    }
    if (colonyApplyCropBtn) {
      colonyApplyCropBtn.disabled = !cropActive;
    }
    if (colonyCancelCropBtn) {
      colonyCancelCropBtn.disabled = !cropActive;
    }
    if (colonyResetCropBtn) {
      colonyResetCropBtn.disabled = !hasImage || cropActive;
    }
    if (colonyClearMarkersBtn) {
      colonyClearMarkersBtn.disabled = !hasImage || cropActive || colonyState.markers.length === 0;
    }
    if (colonyRunBtn) {
      colonyRunBtn.disabled = !hasImage || cropActive;
    }
    if (colonyPreviewCanvas) {
      if (!hasImage || cropActive) {
        colonyPreviewCanvas.style.cursor = 'default';
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

  // Remove all manual colony markers from the current image.
  function clearMarkers() {
    if (!colonyState.markers.length) {
      return;
    }
    colonyState.markers = [];
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('All manual markers cleared.');
    updateControlState();
  }

  // Clear markers silently when the loaded image or crop region changes.
  function clearMarkersForImageChange() {
    colonyState.markers = [];
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
    setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height}). Click each colony to count.`);
    updateControlState();
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
    setColonyStatus('Crop mode active. Apply crop to continue manual counting.');
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
    setColonyStatus(`Crop applied (${croppedCanvas.width}x${croppedCanvas.height}). Click colonies to recount.`);
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
    setColonyStatus(`Restored full image (${width}x${height}). Click colonies to count.`);
    updateControlState();
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

    colonyState.markers.push(sourcePoint);
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Manual count: ${colonyState.markers.length}`);
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
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Manual count: ${colonyState.markers.length}`);
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

  // Finalize the current manual count into the status and summary display.
  function renderManualCountResult() {
    if (!colonyState.hasImage) {
      setColonyStatus('Load a plate image first.', true);
      return;
    }

    const count = colonyState.markers.length;
    setColonyStatus(`Manual colony count saved: ${count}`);
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
    setColonyStatus('Load an image, then click colonies to count manually.');
    updateControlState();
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
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    addManualMarkerFromCanvasPoint(point);
  }

  // Start a pan gesture when the user presses on a zoomed preview.
  function handlePreviewMouseDown(event) {
    if (!colonyState.hasImage || isCropModeActive() || event.button !== 0) {
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
    if (!colonyState.hasImage || isCropModeActive()) {
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
    if (!colonyState.hasImage || isCropModeActive()) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    removeNearestMarkerFromCanvasPoint(point);
  }

  syncDisplayInput();
  resetColonySummary();
  setColonyStatus('Load an image, then click colonies to count manually.');
  updateControlState();

  // Clamp the max-size display input so preview rendering stays within supported bounds.
  function syncDisplayInput() {
    if (!colonyMaxSizeInput) {
      return;
    }
    const value = Math.round(clampNumber(colonyMaxSizeInput.value, 300, 5000, 1600));
    colonyMaxSizeInput.value = String(value);
  }

  // Re-render the preview when the configured display size changes.
  colonyMaxSizeInput?.addEventListener('change', () => {
    syncDisplayInput();
    if (colonyState.hasImage) {
      renderPreviewCanvas();
    }
  });

  // Load a newly selected image file into the tool.
  colonyImageInput?.addEventListener('change', async () => {
    const file = colonyImageInput.files?.[0];
    if (!file) {
      return;
    }

    setColonyStatus('Loading image...');
    try {
      await loadColonyImage(file);
    } catch (error) {
      setColonyStatus(error.message || 'Failed to load image.', true);
      if (colonySummary) {
        colonySummary.innerHTML = `<p class="small-note">${escapeHtml(error.message || 'Image load failed.')}</p>`;
      }
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
  colonyPreviewCanvas?.addEventListener('mouseup', () => {
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
    finishPanning();
  });

  // Treat form submission as confirmation of the current manual count.
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
