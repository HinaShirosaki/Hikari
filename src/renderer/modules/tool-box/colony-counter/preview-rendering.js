import { setCanvasFromSource } from './canvas-utils.js';

// Draws the zoomed source image, the mask overlay, and the colony markers onto
// the preview canvas.
function createColonyPreviewRendering({
  state,
  colonyPreviewCanvas,
  colonySourceCanvas,
  getDisplaySettings,
  getViewport,
  sourceToPreviewPoint,
  sourceMaskToPreviewBox,
  isSourcePointInsideMask,
  drawMaskShapePath
} = {}) {
  const colonyState = state;

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

  // Render the currently visible image region, then overlay mask and markers.
  function renderPreviewCanvas() {
    if (!colonyPreviewCanvas || !colonySourceCanvas) {
      return;
    }

    const settings = getDisplaySettings();
    const { width, height } = setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);

    if (!width || !height) {
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
  }

  return { drawMaskOverlay, drawMarkers, renderPreviewCanvas };
}

export { createColonyPreviewRendering };
