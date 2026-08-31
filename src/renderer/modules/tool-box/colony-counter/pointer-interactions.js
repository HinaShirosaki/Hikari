import { clampNumber } from '../common.js';
import { EMPTY_MASK, clearCanvas, getCanvasPointerPosition } from './canvas-utils.js';

// Every pointer gesture on the preview canvas: markers, mask drawing, zoom, and
// pan, plus the full-tool reset those handlers share.
function createColonyPointerInteractions({
  state,
  elements = {},
  canvases = {},
  viewport = {},
  isCropModeActive,
  destroyCropper,
  getCountedMarkers,
  renderPreviewCanvas,
  renderColonySummary,
  resetColonySummary,
  setColonyStatus,
  updateControlState
} = {}) {
  const colonyState = state;
  const { colonyImageInput, colonyPreviewCanvas } = elements;
  const {
    colonySourceCanvas,
    colonySourceCtx,
    colonyOriginalCanvas,
    colonyOriginalCtx
  } = canvases;
  const {
    hasActiveMask,
    normalizeMask,
    isSourcePointInsideMask,
    resetViewport,
    setViewport,
    getViewport,
    sourceToPreviewPoint,
    previewToSourcePoint,
    buildMaskFromSourcePoints
  } = viewport;

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


  return {
    addManualMarkerFromCanvasPoint,
    removeNearestMarkerFromCanvasPoint,
    zoomPreviewAtPoint,
    panPreviewByCanvasDelta,
    finishPanning,
    renderManualCountResult,
    resetColonyCounter,
    updateMaskDraftFromCanvasPoint,
    finishMaskDrawingFromCanvasPoint,
    handlePreviewClick,
    handlePreviewMouseDown,
    handlePreviewMouseMove,
    handlePreviewWheel,
    handlePreviewContextMenu
  };
}

export { createColonyPointerInteractions };
