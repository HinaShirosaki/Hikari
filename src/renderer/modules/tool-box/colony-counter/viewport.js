import { clampNumber } from '../../../lib/numbers.js';
import { EMPTY_MASK } from './canvas-utils.js';

// Zoom/pan state plus the source <-> preview coordinate math and mask geometry.
// Bound to one image's state object and its preview canvas.
function createColonyViewport({
  state,
  getPreviewCanvas = () => null,
  getMaskMode = () => 'rect'
} = {}) {
  const colonyState = state;

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
    const previewWidth = getPreviewCanvas()?.width || 0;
    const previewHeight = getPreviewCanvas()?.height || 0;
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

  function buildMaskFromSourcePoints(startPoint, endPoint) {
    if (!startPoint || !endPoint) {
      return null;
    }

    const kind = getMaskMode() === 'circle' ? 'circle' : 'rectangle';
    return normalizeMask({
      kind,
      x: startPoint.x,
      y: startPoint.y,
      width: endPoint.x - startPoint.x,
      height: endPoint.y - startPoint.y
    });
  }

  return {
    hasActiveMask,
    normalizeMask,
    isSourcePointInsideMask,
    resetViewport,
    setViewport,
    getViewport,
    sourceToPreviewPoint,
    previewToSourcePoint,
    sourceMaskToPreviewBox,
    drawMaskShapePath,
    buildMaskFromSourcePoints
  };
}

export { createColonyViewport };
