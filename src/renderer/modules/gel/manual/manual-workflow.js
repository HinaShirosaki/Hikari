import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { detectLanes } from '../analysis/auto-lanes.js';
import { getViewerToolLabel, renderViewerToolbar } from './manual-ui.js';
import {
  clamp,
  countCompleteLaneBandWindows,
  createEmptyManualOverrides,
  getLaneVerticesForLane,
  getLaneVertexArray,
  getLaneBandWindow,
  hasCompleteLaneBandWindow,
  isPerLaneBandMode,
  laneContainsPoint,
  lanePointToRectifiedRow,
  normalizeLaneBandWindows,
  normalizeLaneVertices,
  normalizeManualOverrides
} from '../shared.js';

const LANE_VERTEX_KEYS = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
const LANE_VERTEX_LABELS = Object.freeze({
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomRight: 'bottom-right',
  bottomLeft: 'bottom-left'
});
const GLUED_LANE_VERTEX = Object.freeze({
  topLeft: { laneOffset: -1, vertexKey: 'topRight' },
  bottomLeft: { laneOffset: -1, vertexKey: 'bottomRight' },
  topRight: { laneOffset: 1, vertexKey: 'topLeft' },
  bottomRight: { laneOffset: 1, vertexKey: 'bottomLeft' }
});

export function createManualWorkflowController({ runtime, elements, deps }) {
  function clearCanvasInteractionState({ clearTool = true } = {}) {
    if (clearTool) {
      runtime.selectedViewerTool = '';
    }
    runtime.laneVertexDrag = null;
    runtime.suppressNextLaneVertexClick = false;
  }

  function clearCanvasTool(tool) {
    if (runtime.selectedViewerTool === tool) {
      clearCanvasInteractionState();
    }
  }

  function onViewerToolSelected(tool) {
    clearCanvasInteractionState({ clearTool: false });
    runtime.selectedViewerTool = runtime.selectedViewerTool === tool ? '' : tool;
    renderViewerToolbar(elements, runtime.selectedViewerTool, isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation));
    const label = getViewerToolLabel(runtime.selectedViewerTool);
    if (label) {
      if (runtime.selectedViewerTool === 'lane-vertices') {
        deps.setStatus('Adjust lane vertices selected. Drag one of the four corner handles for a lane.');
        return;
      }
      deps.setStatus(`${label} selected. Click the gel image to apply it.`);
      return;
    }
    deps.setStatus('Viewer tool cleared. Gel tools will follow the current selection.');
  }

  function getManualStep(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
    const hasLeft = Number.isFinite(segmentation.gelLeft);
    const hasRight = Number.isFinite(segmentation.gelRight);
    if (!hasLeft) {
      return 'left';
    }
    if (!hasRight) {
      return 'right';
    }
    if (!hasEffectiveDividerLayout(overrides)) {
      return 'dividers';
    }
    if (!Number.isFinite(overrides.ladderLane) || overrides.ladderLane < 1) {
      return 'ladder';
    }
    if (!Boolean(overrides.ladderBandsDone)) {
      return 'ladder-mw';
    }
    if (isPerLaneBandMode(segmentation)) {
      const progress = getLaneBandProgress(overrides);
      if (progress.pendingBottomLaneIndex) {
        return 'band-bottom';
      }
      if (!progress.totalLanes || progress.completeCount < progress.totalLanes) {
        return 'band-top';
      }
      if (!Boolean(segmentation.quantifyConfirmed)) {
        return 'quantify';
      }
      return 'bands';
    }
    if (!Number.isFinite(segmentation.bandTop)) {
      return 'band-top';
    }
    if (!Number.isFinite(segmentation.bandBottom)) {
      return 'band-bottom';
    }
    if (!Boolean(segmentation.quantifyConfirmed)) {
      return 'quantify';
    }
    return 'bands';
  }

  function getCanvasInteractionStep() {
    if (runtime.selectedViewerTool) {
      return runtime.selectedViewerTool;
    }
    const laneBandStep = getLaneBandInteractionStep();
    return laneBandStep || getManualStep();
  }

  function getLaneBandInteractionStep(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    if (!isPerLaneBandMode(overrides.laneSegmentation)) {
      return null;
    }
    const progress = getLaneBandProgress(overrides);
    if (!progress.totalLanes) {
      return null;
    }
    if (progress.pendingBottomLaneIndex) {
      return 'band-bottom';
    }
    if (progress.completeCount < progress.totalLanes) {
      return 'band-top';
    }
    return null;
  }

  function hasEffectiveDividerLayout(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
    if (Boolean(segmentation.dividerDone) || runtime.manualDividerConfirmed) {
      return true;
    }
    return isPerLaneBandMode(segmentation) && getSegmentationLanes(overrides).length > 0;
  }

  function renderManualProgress() {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const activeStep = getManualStep(overrides);
    const laneBandMode = isPerLaneBandMode(overrides.laneSegmentation);

    if (elements.gelManualNextBtn) {
      elements.gelManualNextBtn.disabled = !(activeStep === 'dividers' || activeStep === 'ladder-mw' || activeStep === 'quantify');
      if (activeStep === 'dividers') {
        elements.gelManualNextBtn.textContent = 'Done Dividers';
      } else if (activeStep === 'ladder-mw') {
        elements.gelManualNextBtn.textContent = 'Done Ladder MW';
      } else if (activeStep === 'quantify') {
        elements.gelManualNextBtn.textContent = 'Done Quantify';
      } else {
        elements.gelManualNextBtn.textContent = 'Done';
      }
    }
    renderViewerToolbar(elements, runtime.selectedViewerTool, laneBandMode);
  }

  function renderOverrideStatus() {
    if (!elements.gelOverrideStatus) {
      return;
    }
    const summary = normalizeManualOverrides(runtime.manualOverrides);
    const laneBandMode = isPerLaneBandMode(summary.laneSegmentation);
    const laneBandProgress = getLaneBandProgress(summary);
    const parts = [
      `gel ${summary.laneSegmentation?.gelLeft ?? '-'}-${summary.laneSegmentation?.gelRight ?? '-'}`,
      `div ${summary.laneSegmentation?.dividers?.length || 0}`,
      laneBandMode
        ? `bandY lanes ${countCompleteLaneBandWindows(summary.laneSegmentation)}/${laneBandProgress.totalLanes || '-'}`
        : `bandY ${summary.laneSegmentation?.bandTop ?? '-'}-${summary.laneSegmentation?.bandBottom ?? '-'}`,
      `tilt ${summary.laneSegmentation?.laneVertices?.length || 0}`,
      `add ${summary.addedBands.length}`,
      `ladderMW ${summary.ladderBands?.length || 0}`,
      `ladder ${summary.ladderLane || '-'}`
    ];
    elements.gelOverrideStatus.textContent = `Manual overrides: ${parts.join(' | ')}`;
    renderManualProgress();
    deps.renderLaneTable?.();
  }

  function updateLaneSegmentation(patch) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const current = normalized.laneSegmentation || {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null,
      quantifyConfirmed: false
    };
    const next = {
      gelLeft: current.gelLeft,
      gelRight: current.gelRight,
      dividers: Array.isArray(current.dividers) ? current.dividers.slice() : [],
      dividerDone: Boolean(current.dividerDone),
      bandTop: Number.isFinite(current.bandTop) ? current.bandTop : null,
      bandBottom: Number.isFinite(current.bandBottom) ? current.bandBottom : null,
      perLaneBandEnabled: isPerLaneBandMode(current),
      laneBandWindows: normalizeLaneBandWindows(current.laneBandWindows),
      laneVertices: normalizeLaneVertices(current.laneVertices),
      quantifyConfirmed: Boolean(current.quantifyConfirmed),
      ...patch
    };
    next.dividers = next.dividers
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]);
    const rawBandTop = next.bandTop;
    const rawBandBottom = next.bandBottom;
    next.bandTop = (rawBandTop === null || rawBandTop === undefined || rawBandTop === '')
      ? null
      : (Number.isFinite(Number(rawBandTop)) ? Math.max(0, Math.floor(Number(rawBandTop))) : null);
    next.bandBottom = (rawBandBottom === null || rawBandBottom === undefined || rawBandBottom === '')
      ? null
      : (Number.isFinite(Number(rawBandBottom)) ? Math.max(0, Math.floor(Number(rawBandBottom))) : null);
    next.perLaneBandEnabled = Boolean(next.perLaneBandEnabled);
    next.laneBandWindows = normalizeLaneBandWindows(next.laneBandWindows);
    next.laneVertices = normalizeLaneVertices(next.laneVertices);
    runtime.manualOverrides = {
      ...normalized,
      laneSegmentation: next
    };
  }

  function upsertLadderBandMw(pixelY, mw) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const points = normalized.ladderBands
      .filter((item) => Math.abs(item.pixelY - pixelY) > 8);
    points.push({
      pixelY: clamp(Math.round(pixelY), 0, Math.max(0, runtime.currentImage.height - 1)),
      mw
    });
    points.sort((a, b) => a.pixelY - b.pixelY);
    runtime.manualOverrides = {
      ...normalized,
      ladderBands: points
    };
  }

  function inferLaneIndexFromSegmentationPoint(pointOrX, y = null) {
    if (!runtime.currentImage) {
      return null;
    }
    const point = typeof pointOrX === 'object'
      ? pointOrX
      : { x: pointOrX, y: Number.isFinite(y) ? y : Math.floor(runtime.currentImage.height / 2) };
    const lanes = getSegmentationLanes();
    if (!lanes?.length) {
      return null;
    }
    const match = lanes.find((lane) => laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width))
      || lanes.find((lane) => point.x >= lane.xStart && point.x <= lane.xEnd);
    if (match) {
      return match.index + 1;
    }
    let bestLane = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    lanes.forEach((lane) => {
      const distance = Math.abs(((lane.xStart + lane.xEnd) / 2) - point.x);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLane = lane;
      }
    });
    return bestLane ? bestLane.index + 1 : null;
  }

  function getSegmentationLanes(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    if (!runtime.currentImage) {
      return [];
    }
    return buildLanesFromManualSegmentation(
      overrides,
      runtime.currentImage.width,
      runtime.currentImage.height
    ) || [];
  }

  function getRectifiedLaneRowFromPoint(point, laneIndex = null) {
    if (!runtime.currentImage || !point) {
      return null;
    }
    const lanes = getSegmentationLanes();
    const lane = Number.isFinite(laneIndex)
      ? lanes.find((item) => item.index + 1 === laneIndex)
      : lanes.find((item) => laneContainsPoint(item, point.x, point.y, runtime.currentImage.width));
    const row = lane
      ? lanePointToRectifiedRow(lane, point, runtime.currentImage.height)
      : point.y;
    return clamp(Math.round(row), 0, runtime.currentImage.height - 1);
  }

  function getLaneBandProgress(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const normalized = normalizeManualOverrides(overrides);
    const segmentation = normalized.laneSegmentation || {};
    const lanes = getSegmentationLanes(normalized);
    const validLaneIndexes = new Set(lanes.map((lane) => lane.index + 1));
    const windows = normalizeLaneBandWindows(segmentation.laneBandWindows)
      .filter((window) => validLaneIndexes.has(window.laneIndex));
    const laneWindowByIndex = new Map(windows.map((window) => [window.laneIndex, window]));
    const pendingBottomLane = lanes.find((lane) => {
      const laneIndex = lane.index + 1;
      const window = laneWindowByIndex.get(laneIndex);
      return Number.isFinite(window?.bandTop) && !Number.isFinite(window?.bandBottom);
    });
    const missingCompleteLane = lanes.find((lane) => {
      const laneIndex = lane.index + 1;
      return !hasCompleteLaneBandWindow(laneWindowByIndex.get(laneIndex));
    });

    return {
      completeCount: lanes.filter((lane) => hasCompleteLaneBandWindow(laneWindowByIndex.get(lane.index + 1))).length,
      missingCompleteLaneIndex: missingCompleteLane ? missingCompleteLane.index + 1 : null,
      pendingBottomLaneIndex: pendingBottomLane ? pendingBottomLane.index + 1 : null,
      totalLanes: lanes.length,
      windows
    };
  }

  function findLaneVertexTarget(point) {
    const lanes = getSegmentationLanes();
    if (!lanes.length || !runtime.currentImage) {
      return null;
    }
    const handleRadius = Math.max(8, Math.round(Math.min(runtime.currentImage.width, runtime.currentImage.height) / 50));
    const containingLane = lanes.find((lane) =>
      laneContainsPoint(lane, point.x, point.y, runtime.currentImage.width)
    );
    let best = null;
    lanes.forEach((lane) => {
      const laneIndex = lane.index + 1;
      const points = getLaneVertexArray(lane);
      points.forEach((vertex, vertexIndex) => {
        const dx = vertex.x - point.x;
        const dy = vertex.y - point.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!best || distance < best.distance) {
          best = {
            laneIndex,
            lane,
            vertexKey: LANE_VERTEX_KEYS[vertexIndex],
            distance
          };
        }
      });
    });

    if (best && best.distance <= handleRadius) {
      return best;
    }
    if (containingLane) {
      const laneIndex = containingLane.index + 1;
      const points = getLaneVertexArray(containingLane);
      return points.reduce((closest, vertex, vertexIndex) => {
        const dx = vertex.x - point.x;
        const dy = vertex.y - point.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!closest || distance < closest.distance) {
          return {
            laneIndex,
            lane: containingLane,
            vertexKey: LANE_VERTEX_KEYS[vertexIndex],
            distance
          };
        }
        return closest;
      }, null);
    }
    return null;
  }

  function updateLaneVertex(laneIndex, vertexKey, point) {
    if (!runtime.currentImage || !LANE_VERTEX_KEYS.includes(vertexKey)) {
      return false;
    }
    const lanes = getSegmentationLanes();
    const laneByIndex = new Map(lanes.map((item) => [item.index + 1, item]));
    if (!laneByIndex.has(laneIndex)) {
      return false;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const maxVertexY = Math.max(0, runtime.currentImage.height - 1);
    const getLockedVertexY = (targetVertexKey) => targetVertexKey.startsWith('bottom') ? maxVertexY : 0;
    const pointOnImage = {
      x: clamp(Math.round(point.x), 0, runtime.currentImage.width - 1),
      y: getLockedVertexY(vertexKey)
    };
    const lockVertexRows = (vertices) => ({
      topLeft: { ...vertices.topLeft, y: getLockedVertexY('topLeft') },
      topRight: { ...vertices.topRight, y: getLockedVertexY('topRight') },
      bottomRight: { ...vertices.bottomRight, y: getLockedVertexY('bottomRight') },
      bottomLeft: { ...vertices.bottomLeft, y: getLockedVertexY('bottomLeft') }
    });
    const verticesByLane = new Map(
      normalizeLaneVertices(normalized.laneSegmentation?.laneVertices)
        .map((item) => [item.laneIndex, item])
    );
    const writeVertex = (targetLaneIndex, targetVertexKey, targetPoint) => {
      const targetLane = laneByIndex.get(targetLaneIndex);
      if (!targetLane) {
        return false;
      }
      const currentVertices = verticesByLane.get(targetLaneIndex) || getLaneVerticesForLane(
        normalized.laneSegmentation,
        targetLaneIndex,
        targetLane,
        runtime.currentImage.width,
        runtime.currentImage.height
      );
      const rowLockedVertices = lockVertexRows(currentVertices);
      verticesByLane.set(targetLaneIndex, {
        laneIndex: targetLaneIndex,
        ...rowLockedVertices,
        [targetVertexKey]: {
          x: targetPoint.x,
          y: getLockedVertexY(targetVertexKey)
        }
      });
      return true;
    };
    writeVertex(laneIndex, vertexKey, pointOnImage);
    const glued = GLUED_LANE_VERTEX[vertexKey];
    if (glued) {
      writeVertex(laneIndex + glued.laneOffset, glued.vertexKey, pointOnImage);
    }
    const laneVertices = [...verticesByLane.values()]
      .sort((a, b) => a.laneIndex - b.laneIndex);
    updateLaneSegmentation({
      laneVertices,
      quantifyConfirmed: false
    });
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      addedBands: []
    };
    runtime.currentReport = null;
    return true;
  }

  function updateLaneVertexFromPoint(point, target = null) {
    const nextTarget = target || findLaneVertexTarget(point);
    if (!nextTarget) {
      deps.setStatus('Set lane dividers first, then click near a lane corner to adjust tilt.');
      return null;
    }
    const changed = updateLaneVertex(nextTarget.laneIndex, nextTarget.vertexKey, point);
    return changed ? nextTarget : null;
  }

  function upsertLaneBandWindow(laneIndex, patch) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const windows = normalizeLaneBandWindows(normalized.laneSegmentation?.laneBandWindows);
    const existing = windows.find((window) => window.laneIndex === laneIndex) || {
      laneIndex,
      bandTop: null,
      bandBottom: null
    };
    const nextWindow = {
      ...existing,
      ...patch,
      laneIndex
    };
    updateLaneSegmentation({
      laneBandWindows: [
        ...windows.filter((window) => window.laneIndex !== laneIndex),
        nextWindow
      ],
      quantifyConfirmed: false
    });
  }

  function setLaneBandMode(enabled) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    clearCanvasInteractionState();
    const lanesReady = Boolean(enabled) && getSegmentationLanes(normalized).length > 0;
    if (lanesReady) {
      runtime.manualDividerConfirmed = true;
    }
    updateLaneSegmentation({
      perLaneBandEnabled: Boolean(enabled),
      dividerDone: lanesReady ? true : normalized.laneSegmentation?.dividerDone,
      quantifyConfirmed: false
    });
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      addedBands: []
    };
    runtime.currentReport = null;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.renderReport();
    const nextMode = isPerLaneBandMode(runtime.manualOverrides.laneSegmentation);
    if (nextMode) {
      const progress = getLaneBandProgress();
      deps.setStatus(progress.totalLanes
        ? `Lane-by-lane target band enabled. Click the top line in lane ${progress.missingCompleteLaneIndex || 1}.`
        : 'Lane-by-lane target band enabled. Finish lane dividers before setting target bands.');
      return;
    }
    deps.setStatus('Lane-by-lane target band disabled. Top and bottom lines will apply to every lane.');
    if (
      runtime.currentImage
      && Number.isFinite(normalized.laneSegmentation?.bandTop)
      && Number.isFinite(normalized.laneSegmentation?.bandBottom)
    ) {
      deps.onRunAnalysis();
    }
  }

  function onLaneBandModeToggle() {
    setLaneBandMode(!isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation));
  }

  function onManualNextStep() {
    const step = getManualStep();
    const segmentation = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation || {};
    if (step === 'dividers') {
      if (!Number.isFinite(segmentation.gelLeft) || !Number.isFinite(segmentation.gelRight)) {
        deps.setStatus('Set left and right borders before finishing dividers.');
        return;
      }
      runtime.manualDividerConfirmed = true;
      updateLaneSegmentation({ dividerDone: true });
      renderOverrideStatus();
      deps.setStatus('Dividers confirmed. Click a lane to set ladder lane.');
      return;
    }

    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(runtime.manualOverrides);
      const ladderCount = normalized.ladderBands?.length || 0;
      runtime.manualOverrides = {
        ...normalized,
        ladderBandsDone: true
      };
      renderOverrideStatus();
      if (ladderCount < 2) {
        deps.setStatus(`Ladder MW skipped (${ladderCount} point${ladderCount === 1 ? '' : 's'}). MW calibration disabled. ${isPerLaneBandMode(normalized.laneSegmentation) ? 'Click the top line of the target band in each lane.' : 'Click the top line of target band.'}`);
      } else {
        deps.setStatus(isPerLaneBandMode(normalized.laneSegmentation)
          ? 'Ladder MW completed. Click the top line of the target band in each lane.'
          : 'Ladder MW completed. Click the top line of target band.');
      }
      deps.onRunAnalysis();
      return;
    }

    if (step === 'quantify') {
      updateLaneSegmentation({ quantifyConfirmed: true });
      renderOverrideStatus();
      deps.setStatus('Quantification confirmed. (Optional) click additional band points in lanes.');
    }
  }

  function onManualPrevStep() {
    const step = getManualStep();
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    if (step === 'left') {
      return;
    }
    if (step === 'right') {
      updateLaneSegmentation({ gelLeft: null, laneVertices: [] });
      runtime.manualDividerConfirmed = false;
    } else if (step === 'dividers') {
      updateLaneSegmentation({ gelRight: null, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [], laneVertices: [] });
      runtime.manualDividerConfirmed = false;
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder') {
      updateLaneSegmentation({ dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [] });
      runtime.manualDividerConfirmed = false;
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder-mw') {
      runtime.manualOverrides = {
        ...normalized,
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (isPerLaneBandMode(normalized.laneSegmentation) && (step === 'band-top' || step === 'band-bottom' || step === 'quantify' || step === 'bands')) {
      rewindPerLaneBandStep(step, normalized);
    } else if (step === 'band-top') {
      runtime.manualOverrides = {
        ...normalized,
        ladderBandsDone: false
      };
    } else if (step === 'band-bottom') {
      updateLaneSegmentation({ bandTop: null, bandBottom: null, quantifyConfirmed: false });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
    } else if (step === 'quantify') {
      updateLaneSegmentation({ bandBottom: null, quantifyConfirmed: false });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
    } else {
      updateLaneSegmentation({ quantifyConfirmed: false });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
    }
    clearCanvasInteractionState();
    runtime.currentReport = null;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.renderReport();
    deps.setStatus('Moved back to previous step.');
  }

  function rewindPerLaneBandStep(step, normalized) {
    const progress = getLaneBandProgress(normalized);
    const windows = normalizeLaneBandWindows(normalized.laneSegmentation?.laneBandWindows);
    const completedWindows = progress.windows
      .filter(hasCompleteLaneBandWindow)
      .sort((a, b) => a.laneIndex - b.laneIndex);

    if (step === 'band-bottom' && progress.pendingBottomLaneIndex) {
      updateLaneSegmentation({
        laneBandWindows: windows.filter((window) => window.laneIndex !== progress.pendingBottomLaneIndex),
        quantifyConfirmed: false
      });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      return;
    }

    if (step === 'band-top') {
      const lastComplete = completedWindows[completedWindows.length - 1];
      if (!lastComplete) {
        runtime.manualOverrides = {
          ...normalized,
          ladderBandsDone: false,
          addedBands: []
        };
        return;
      }
      updateLaneSegmentation({
        laneBandWindows: windows.map((window) => (
          window.laneIndex === lastComplete.laneIndex
            ? { ...window, bandBottom: null }
            : window
        )),
        quantifyConfirmed: false
      });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      return;
    }

    if (step === 'quantify') {
      const lastComplete = completedWindows[completedWindows.length - 1];
      updateLaneSegmentation({
        laneBandWindows: lastComplete
          ? windows.map((window) => (
            window.laneIndex === lastComplete.laneIndex
              ? { ...window, bandBottom: null }
              : window
          ))
          : windows,
        quantifyConfirmed: false
      });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      return;
    }

    updateLaneSegmentation({ quantifyConfirmed: false });
    runtime.manualOverrides = {
      ...normalizeManualOverrides(runtime.manualOverrides),
      addedBands: []
    };
  }

  function onManualResetSteps() {
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.manualDividerConfirmed = false;
    clearCanvasInteractionState();
    runtime.currentReport = null;
    renderOverrideStatus();
    renderManualProgress();
    deps.renderCanvas();
    deps.renderReport();
    deps.setStatus('Gel tool selections reset.');
  }

  function addLaneDivider(x) {
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = normalized.laneSegmentation || {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null
    };
    const divider = clamp(Math.floor(x), 0, Math.max(0, runtime.currentImage.width - 1));
    const gelLeft = Number.isFinite(segmentation.gelLeft) ? segmentation.gelLeft : null;
    const gelRight = Number.isFinite(segmentation.gelRight) ? segmentation.gelRight : null;
    if (Number.isFinite(gelLeft) && divider <= gelLeft + 1) {
      return false;
    }
    if (Number.isFinite(gelRight) && divider >= gelRight - 1) {
      return false;
    }
    updateLaneSegmentation({
      dividers: [...(segmentation.dividers || []), divider],
      laneBandWindows: [],
      laneVertices: [],
      quantifyConfirmed: false
    });
    return true;
  }

  function appendBandOverride(laneIndex, pixelY) {
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const current = overrides.addedBands
      .filter((item) => !(item.laneIndex === laneIndex && Math.abs(item.pixelY - pixelY) <= 8));
    current.push({ laneIndex, pixelY });
    runtime.manualOverrides = {
      ...overrides,
      addedBands: current
    };
  }

  function promptForLadderBandMw(rowY, normalized) {
    const promptHost = typeof window !== 'undefined' ? window : null;
    if (!promptHost?.prompt) {
      deps.setStatus('Ladder MW prompt is unavailable in this environment.');
      return null;
    }
    const existing = normalized.ladderBands.find((item) => Math.abs(item.pixelY - rowY) <= 8);
    const promptDefault = existing ? String(existing.mw) : (elements.gelLadderBandMwInput?.value || '');
    const raw = promptHost.prompt(`MW for ladder band at row=${rowY} (kDa):`, promptDefault);
    if (raw === null) {
      return null;
    }
    const mw = Number(String(raw).trim());
    if (!Number.isFinite(mw) || mw <= 0) {
      deps.setStatus('Invalid MW value. Right-click again and enter a positive number (kDa).');
      return null;
    }
    return mw;
  }

  function onCanvasContextMenu(event) {
    if (!runtime.currentImage || runtime.cropperActive) {
      return;
    }
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    if (!Number.isFinite(normalized.ladderLane) || normalized.ladderLane < 1) {
      event.preventDefault?.();
      deps.setStatus('Set the ladder lane before assigning ladder MW.');
      return;
    }
    const laneIndex = inferLaneIndexFromSegmentationPoint(point);
    event.preventDefault?.();
    if (!laneIndex || laneIndex !== normalized.ladderLane) {
      deps.setStatus(`Right-click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
      return;
    }

    const rowY = getRectifiedLaneRowFromPoint(point, laneIndex);
    const mw = promptForLadderBandMw(rowY, normalized);
    if (!Number.isFinite(mw)) {
      return;
    }
    upsertLadderBandMw(rowY, mw);
    if (elements.gelLadderBandMwInput) {
      elements.gelLadderBandMwInput.value = String(mw);
    }
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(`Added ladder calibration point: row=${rowY}, MW=${mw} kDa.`);
    deps.onRunAnalysis();
  }

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
    if (!runtime.currentImage || runtime.cropperActive || getCanvasInteractionStep() !== 'lane-vertices') {
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
    deps.renderReport();
    deps.setStatus(`Lane ${target.laneIndex} ${LANE_VERTEX_LABELS[target.vertexKey]} vertex selected.`);
    event.preventDefault?.();
  }

  function onCanvasMouseMove(event) {
    if (!runtime.currentImage || runtime.cropperActive || !runtime.laneVertexDrag) {
      return;
    }
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    updateLaneVertexFromPoint(point, runtime.laneVertexDrag);
    renderOverrideStatus();
    deps.renderCanvas();
    deps.renderReport();
    event.preventDefault?.();
  }

  function onCanvasMouseUp(event) {
    if (!runtime.currentImage || !runtime.laneVertexDrag) {
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
    deps.renderReport();
    deps.setStatus(`Lane ${target.laneIndex} ${LANE_VERTEX_LABELS[target.vertexKey]} vertex updated.`);
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
      deps.setStatus('Finish crop mode first: Apply Crop or Cancel Crop.');
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
      deps.renderReport();
      deps.setStatus(`Lane ${target.laneIndex} ${LANE_VERTEX_LABELS[target.vertexKey]} vertex updated.`);
      deps.onRunAnalysis();
      return;
    }
    if (step === 'left') {
      updateLaneSegmentation({ gelLeft: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [], laneVertices: [] });
      runtime.manualDividerConfirmed = false;
      resetDownstreamManualSelections();
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Left border set at x=${point.x}.`);
      return;
    }
    if (step === 'right') {
      const left = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.gelLeft;
      if (!Number.isFinite(left) || point.x <= left + 2) {
        deps.setStatus('Right border must be to the right of left border.');
        return;
      }
      updateLaneSegmentation({ gelRight: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [], laneVertices: [] });
      runtime.manualDividerConfirmed = false;
      resetDownstreamManualSelections();
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Right border set at x=${point.x}.`);
      return;
    }
    if (step === 'dividers') {
      const added = addLaneDivider(point.x);
      renderOverrideStatus();
      deps.renderCanvas();
      if (!added) {
        deps.setStatus('Divider must be between left and right borders.');
        return;
      }
      deps.setStatus(`Divider added at x=${point.x}. Add more, then click Done Dividers.`);
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
      deps.setStatus(`Ladder lane set to ${laneIndex}.`);
      deps.onRunAnalysis();
      return;
    }
    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(runtime.manualOverrides);
      const laneIndex = inferLaneIndexFromSegmentationPoint(point);
      if (!laneIndex || laneIndex !== normalized.ladderLane) {
        deps.setStatus(`Click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
        return;
      }
      const mw = Number(elements.gelLadderBandMwInput?.value);
      if (!Number.isFinite(mw) || mw <= 0) {
        deps.setStatus('Enter Ladder Band MW (kDa) before clicking the band.');
        return;
      }
      const rowY = getRectifiedLaneRowFromPoint(point, laneIndex);
      upsertLadderBandMw(rowY, mw);
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Added ladder calibration point: row=${rowY}, MW=${mw} kDa.`);
      deps.onRunAnalysis();
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
        deps.setStatus(`Lane ${laneIndex} top line set at row=${rowY}. Click the bottom line in lane ${laneIndex}.`);
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
      deps.setStatus(`Band top line set at row=${rowY}.`);
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
          deps.setStatus(`Lane ${pendingLaneIndex} bottom line set at row=${rowY}. Per-lane intensities ready in the Quantify panel.`);
        } else {
          deps.setStatus(`Lane ${pendingLaneIndex} bottom line set at row=${rowY}. Click the top line in lane ${nextProgress.missingCompleteLaneIndex || 1}.`);
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
      deps.setStatus(`Band bottom line set at row=${rowY}. Per-lane intensities ready in the Quantify panel.`);
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
      deps.setStatus(`Band added in lane ${laneIndex} near row=${rowY}.`);
      deps.onRunAnalysis();
    }
  }

  function onAutoDetectLanes() {
    if (!runtime.currentImage?.gray) {
      deps.setStatus('Load a gel image before auto-detecting lanes.');
      return;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = normalized.laneSegmentation || {};
    const rawCount = Number(elements.gelExpectedLaneCountInput?.value);
    const expectedLaneCount = Number.isFinite(rawCount) && rawCount >= 2 ? Math.floor(rawCount) : null;
    const result = detectLanes({
      gray: runtime.currentImage.gray,
      width: runtime.currentImage.width,
      height: runtime.currentImage.height,
      yStart: Number.isFinite(segmentation.bandTop) ? segmentation.bandTop : null,
      yEnd: Number.isFinite(segmentation.bandBottom) ? segmentation.bandBottom : null,
      gelLeft: segmentation.gelLeft,
      gelRight: segmentation.gelRight,
      expectedLaneCount
    });
    const peakCount = result?.peaks?.length ?? 0;
    if (!result || peakCount < 2) {
      deps.setStatus('Auto-detection found no clear lanes. Adjust borders or contrast and try again.');
      return;
    }
    updateLaneSegmentation({
      gelLeft: result.gelLeft,
      gelRight: result.gelRight,
      dividers: result.dividers,
      dividerDone: false,
      bandTop: segmentation.bandTop,
      bandBottom: segmentation.bandBottom,
      laneBandWindows: [],
      laneVertices: []
    });
    resetDownstreamManualSelections();
    runtime.manualDividerConfirmed = false;
    clearCanvasInteractionState();
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(`Auto-detected ${peakCount} lane(s). Review dividers and add any missing ones, then click Done Dividers.`);
  }

  function onResetManualOverrides() {
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.manualDividerConfirmed = false;
    clearCanvasInteractionState();
    runtime.currentReport = null;
    renderOverrideStatus();
    deps.renderReport();
    deps.setStatus('Manual overrides cleared.');
    if (runtime.currentImage) {
      deps.onRunAnalysis();
    } else {
      deps.renderCanvas();
    }
  }

  return {
    getManualStep,
    onAutoDetectLanes,
    onCanvasClick,
    onCanvasContextMenu,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onLaneBandModeToggle,
    onManualNextStep,
    onManualPrevStep,
    onManualResetSteps,
    onResetManualOverrides,
    onViewerToolSelected,
    renderManualProgress,
    renderOverrideStatus,
    renderViewerToolbar: () => renderViewerToolbar(elements, runtime.selectedViewerTool, isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation))
  };
}
