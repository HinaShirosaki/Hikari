import {
  clamp,
  getLaneBandWindow,
  isPerLaneBandMode,
  normalizeManualOverrides
} from '../shared.js';
import { findLaneDividerNearPointer } from './divider-target.js';

// Pointer work on the gel canvas: dragging a lane corner or a ladder band, and
// what a click means for whichever manual tool is pressed. With no tool pressed
// a click does nothing.

function createManualCanvasInteraction({
  runtime,
  elements,
  deps,
  addLaneDivider,
  clearCanvasTool,
  findLadderBandNearPoint,
  getLaneBandProgress,
  getRectifiedLaneRowFromPoint,
  inferLaneIndexFromSegmentationPoint,
  isPointInLadderLane,
  moveLadderBand,
  moveLaneDivider,
  renderOverrideStatus,
  updateLaneSegmentation,
  updateLaneVertexFromPoint,
  openLadderMwEditor,
  upsertLaneBandWindow
} = {}) {
  function getCanvasPoint(event) {
    const rect = elements.gelCanvas?.getBoundingClientRect();
    if (!rect || !runtime.currentImage) {
      return null;
    }
    const x = ((event.clientX - rect.left) / rect.width) * runtime.currentImage.width;
    const y = ((event.clientY - rect.top) / rect.height) * runtime.currentImage.height;
    return {
      x: clamp(Math.round(x), 0, runtime.currentImage.width - 1),
      y: clamp(Math.round(y), 0, runtime.currentImage.height - 1)
    };
  }

  function onCanvasMouseDown(event) {
    if (!runtime.currentImage || runtime.cropperActive || (event.button !== undefined && event.button !== 0)) {
      return;
    }
    const step = runtime.selectedViewerTool;
    if (step === 'dividers') {
      if (event.ctrlKey) return;
      runtime.suppressNextLaneDividerClick = false;
      const x = findLaneDividerNearPointer({ runtime, canvas: elements.gelCanvas, event });
      if (x === null) return;
      runtime.laneDividerDrag = { x, startX: x, clientX: event.clientX, image: runtime.currentImage, moved: false };
      event.preventDefault?.();
      return;
    }
    if (step === 'ladder-mw') {
      const point = getCanvasPoint(event);
      const grabbed = point && findLadderBandNearPoint(point, normalizeManualOverrides(runtime.manualOverrides));
      if (grabbed) {
        runtime.ladderBandDrag = { mw: grabbed.mw, clientX: event.clientX, clientY: event.clientY, moved: false };
        event.preventDefault?.();
      }
      return;
    }
    if (step !== 'lane-vertices') {
      return;
    }
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    const target = updateLaneVertexFromPoint(point);
    if (!target) {
      return;
    }
    runtime.laneVertexDrag = {
      laneIndex: target.laneIndex,
      vertexKey: target.vertexKey
    };
    runtime.suppressNextLaneVertexClick = true;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus('');
    event.preventDefault?.();
  }

  function onCanvasMouseMove(event) {
    if (!runtime.currentImage || runtime.cropperActive) {
      return;
    }
    if (runtime.laneDividerDrag) {
      updateDividerDrag(event);
      return;
    }
    if (runtime.ladderBandDrag) {
      const drag = runtime.ladderBandDrag;
      if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) {
        return;
      }
      const dragPoint = getCanvasPoint(event);
      if (dragPoint) {
        drag.moved = true;
        runtime.suppressNextLadderBandClick = true;
        moveLadderBand(runtime.ladderBandDrag.mw, dragPoint);
        renderOverrideStatus();
        deps.renderCanvas();
        event.preventDefault?.();
      }
      return;
    }
    if (!runtime.laneVertexDrag) {
      return;
    }
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    updateLaneVertexFromPoint(point, runtime.laneVertexDrag);
    renderOverrideStatus();
    deps.renderCanvas();
    event.preventDefault?.();
  }

  function onCanvasMouseUp(event) {
    if (!runtime.currentImage) {
      return;
    }
    if (runtime.laneDividerDrag) {
      updateDividerDrag(event);
      const drag = runtime.laneDividerDrag;
      runtime.laneDividerDrag = null;
      if (!drag) return;
      const bounds = elements.gelCanvas.getBoundingClientRect();
      runtime.suppressNextLaneDividerClick = event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      if (drag.moved) {
        renderOverrideStatus(); deps.renderCanvas(); deps.setStatus('');
      }
      event.preventDefault?.();
      return;
    }
    if (runtime.ladderBandDrag) {
      if (!runtime.ladderBandDrag.moved) {
        runtime.ladderBandDrag = null;
        return;
      }
      const point = getCanvasPoint(event);
      const { mw } = runtime.ladderBandDrag;
      if (point) moveLadderBand(mw, point);
      runtime.ladderBandDrag = null;
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('');
      deps.onRunAnalysis();
      event.preventDefault?.();
      return;
    }
    if (!runtime.laneVertexDrag) {
      return;
    }
    const point = getCanvasPoint(event);
    const target = runtime.laneVertexDrag;
    if (point) {
      updateLaneVertexFromPoint(point, target);
    }
    runtime.laneVertexDrag = null;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus('');
    deps.onRunAnalysis();
    event.preventDefault?.();
  }

  function updateDividerDrag(event) {
    const drag = runtime.laneDividerDrag;
    if (runtime.selectedViewerTool !== 'dividers' || runtime.currentImage !== drag.image || runtime.cropperActive) {
      runtime.laneDividerDrag = null; return;
    }
    if (!drag.moved && Math.abs(event.clientX - drag.clientX) < 3) return;
    const width = elements.gelCanvas.getBoundingClientRect().width;
    if (!width) return;
    const position = moveLaneDivider(drag.x, drag.startX + (event.clientX - drag.clientX) / width * runtime.currentImage.width);
    if (!Number.isFinite(position) || position === drag.x) return;
    drag.x = position; drag.moved = true;
    renderOverrideStatus(); deps.renderCanvas();
    event.preventDefault?.();
  }

  function resetDownstreamManualSelections() {
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      ladderLane: null,
      ladderBands: [],
      addedBands: []
    };
  }

  function onCanvasClick(event) {
    if ((event.button !== undefined && event.button !== 0) || event.ctrlKey) return;
    if (!runtime.currentImage) {
      return;
    }
    if (runtime.cropperActive) {
      deps.setStatus('Finish cropping first: Done or Cancel.');
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    const step = runtime.selectedViewerTool;
    if (step === 'lane-vertices') {
      if (runtime.suppressNextLaneVertexClick) {
        runtime.suppressNextLaneVertexClick = false;
        return;
      }
      const target = updateLaneVertexFromPoint(point);
      if (!target) {
        return;
      }
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('');
      deps.onRunAnalysis();
      return;
    }
    if (step === 'dividers') {
      if (runtime.suppressNextLaneDividerClick) { runtime.suppressNextLaneDividerClick = false; return; }
      const added = addLaneDivider(point.x);
      if (!added) {
        deps.setStatus('A lane divider already exists at that position.');
        return;
      }
      resetDownstreamManualSelections();
      renderOverrideStatus();
      deps.renderCanvas();
      const segmentation = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation || {};
      if (!Number.isFinite(segmentation.gelRight)) {
        deps.setStatus('Add at least one more divider to mark the gel edges.');
        return;
      }
      deps.setStatus('');
      return;
    }
    if (step === 'ladder') {
      const laneIndex = inferLaneIndexFromSegmentationPoint(point);
      if (!laneIndex) {
        deps.setStatus('No lane found at click position.');
        return;
      }
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        ladderLane: laneIndex,
        ladderBands: [],
        addedBands: []
      };
      clearCanvasTool('ladder');
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('Detect the ladder, or use Set MW to label its bands.');
      deps.onRunAnalysis();
      return;
    }
    if (step === 'ladder-mw') {
      if (runtime.suppressNextLadderBandClick) {
        runtime.suppressNextLadderBandClick = false;
        return;
      }
      const normalized = normalizeManualOverrides(runtime.manualOverrides);
      if (!isPointInLadderLane(point, normalized)) {
        deps.setStatus(`Click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
        return;
      }
      const existing = findLadderBandNearPoint(point, normalized);
      const rowY = existing?.pixelY ?? getRectifiedLaneRowFromPoint(point, normalized.ladderLane);
      openLadderMwEditor({ rowY, mw: existing?.mw, clientX: event.clientX, clientY: event.clientY });
      return;
    }
    if (step === 'band-top') {
      if (isPerLaneBandMode(normalizeManualOverrides(runtime.manualOverrides).laneSegmentation)) {
        const laneIndex = inferLaneIndexFromSegmentationPoint(point);
        if (!laneIndex) {
          deps.setStatus('Click inside a lane to set a lane-specific top line.');
          return;
        }
        const rowY = getRectifiedLaneRowFromPoint(point, laneIndex);
        upsertLaneBandWindow(laneIndex, { bandTop: rowY, bandBottom: null });
        runtime.manualOverrides = {
          ...normalizeManualOverrides(runtime.manualOverrides),
          addedBands: []
        };
        runtime.selectedViewerTool = 'band-bottom';
        renderOverrideStatus();
        deps.renderCanvas();
        deps.setStatus(`Click the bottom edge in lane ${laneIndex}.`);
        return;
      }
      const rowY = getRectifiedLaneRowFromPoint(point);
      updateLaneSegmentation({ bandTop: rowY, bandBottom: null, laneBandWindows: [] });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      // The bottom edge is the only thing left to click, so Bottom takes over.
      runtime.selectedViewerTool = 'band-bottom';
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('Click the bottom edge of the band.');
      return;
    }
    if (step === 'band-bottom') {
      const normalized = normalizeManualOverrides(runtime.manualOverrides);
      if (isPerLaneBandMode(normalized.laneSegmentation)) {
        const progress = getLaneBandProgress(normalized);
        const pendingLaneIndex = progress.pendingBottomLaneIndex;
        if (!pendingLaneIndex) {
          deps.setStatus('Click a lane top line before setting a lane bottom line.');
          return;
        }
        const laneIndex = inferLaneIndexFromSegmentationPoint(point);
        if (laneIndex !== pendingLaneIndex) {
          deps.setStatus(`Click the bottom line in lane ${pendingLaneIndex} before starting another lane.`);
          return;
        }
        const rowY = getRectifiedLaneRowFromPoint(point, laneIndex);
        const window = getLaneBandWindow(normalized.laneSegmentation, pendingLaneIndex);
        const top = window?.bandTop;
        if (!Number.isFinite(top) || rowY <= top + 1) {
          deps.setStatus('Bottom line must be below top line.');
          return;
        }
        upsertLaneBandWindow(pendingLaneIndex, { bandBottom: rowY });
        runtime.manualOverrides = {
          ...normalizeManualOverrides(runtime.manualOverrides),
          addedBands: []
        };
        const nextProgress = getLaneBandProgress();
        const allLanesSet = nextProgress.totalLanes && nextProgress.completeCount >= nextProgress.totalLanes;
        // Per lane, Top comes back for the next lane until every lane has a window.
        if (allLanesSet) {
          clearCanvasTool('band-bottom');
        } else {
          runtime.selectedViewerTool = 'band-top';
        }
        renderOverrideStatus();
        deps.renderCanvas();
        deps.setStatus(allLanesSet ? '' : `Click the top edge in lane ${nextProgress.missingCompleteLaneIndex || 1}.`);
        deps.onRunAnalysis();
        return;
      }
      const top = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.bandTop;
      const rowY = getRectifiedLaneRowFromPoint(point);
      if (!Number.isFinite(top) || rowY <= top + 1) {
        deps.setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: rowY });
      clearCanvasTool('band-bottom');
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('');
      deps.onRunAnalysis();
    }
  }

  return {
    onCanvasClick,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    resetDownstreamManualSelections
  };
}

export { createManualCanvasInteraction };
