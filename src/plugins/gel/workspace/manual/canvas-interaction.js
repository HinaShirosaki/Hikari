import {
  clamp,
  getLaneBandWindow,
  isPerLaneBandMode,
  normalizeManualOverrides
} from '../shared.js';

// Pointer work on the gel canvas: dragging a lane corner or a ladder band, and
// what a plain click means for whichever manual tool is armed.

function createManualCanvasInteraction({
  runtime,
  elements,
  deps,
  addLaneDivider,
  appendBandOverride,
  clearCanvasTool,
  findLadderBandNearPoint,
  getCanvasInteractionStep,
  getLaneBandProgress,
  getRectifiedLaneRowFromPoint,
  inferLaneIndexFromSegmentationPoint,
  isPointInLadderLane,
  moveLadderBand,
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
    const step = getCanvasInteractionStep();
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

  function resetDownstreamManualSelections() {
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      ladderLane: null,
      ladderBands: [],
      ladderBandsDone: false,
      addedBands: []
    };
  }

  function onCanvasClick(event) {
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

    const step = getCanvasInteractionStep();
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
      const added = addLaneDivider(point.x);
      if (!added) {
        deps.setStatus('A lane divider already exists at that position.');
        return;
      }
      runtime.manualDividerConfirmed = false;
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
        ladderBandsDone: false,
        addedBands: []
      };
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
        clearCanvasTool('band-top');
        renderOverrideStatus();
        deps.renderCanvas();
        deps.setStatus(`Click the bottom edge in lane ${laneIndex}.`);
        return;
      }
      const rowY = getRectifiedLaneRowFromPoint(point);
      updateLaneSegmentation({ bandTop: rowY, bandBottom: null, laneBandWindows: [], quantifyConfirmed: false });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      clearCanvasTool('band-top');
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
        clearCanvasTool('band-bottom');
        renderOverrideStatus();
        deps.renderCanvas();
        const nextProgress = getLaneBandProgress();
        if (nextProgress.totalLanes && nextProgress.completeCount >= nextProgress.totalLanes) {
          deps.setStatus('');
        } else {
          deps.setStatus(`Click the top edge in lane ${nextProgress.missingCompleteLaneIndex || 1}.`);
        }
        deps.onRunAnalysis();
        return;
      }
      const top = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.bandTop;
      const rowY = getRectifiedLaneRowFromPoint(point);
      if (!Number.isFinite(top) || rowY <= top + 1) {
        deps.setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: rowY, quantifyConfirmed: false });
      clearCanvasTool('band-bottom');
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus('');
      deps.onRunAnalysis();
      return;
    }
    if (step === 'bands') {
      const laneIndex = inferLaneIndexFromSegmentationPoint(point);
      if (!laneIndex) {
        deps.setStatus('No lane found at click position.');
        return;
      }
      const rowY = getRectifiedLaneRowFromPoint(point, laneIndex);
      appendBandOverride(laneIndex, rowY);
      renderOverrideStatus();
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
