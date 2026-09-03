import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { detectLanes } from '../analysis/auto-lanes.js';
import { getViewerToolLabel, renderViewerToolbar } from './manual-ui.js';
import { createManualCanvasInteraction } from './canvas-interaction.js';
import { createManualStepNavigation } from './step-navigation.js';
import { createManualLaneShapes } from './lane-shapes.js';
import { createManualLadderBands } from './ladder-bands.js';
import { createManualProgress } from './manual-progress.js';
import {
  clamp,
  createEmptyManualOverrides,
  isPerLaneBandMode,
  laneContainsPoint,
  lanePointToRectifiedRow,
  normalizeLaneBandWindows,
  normalizeLaneVertices,
  normalizeManualOverrides
} from '../shared.js';


export function createManualWorkflowController({ runtime, elements, deps }) {
  function clearCanvasInteractionState({ clearTool = true } = {}) {
    if (clearTool) {
      runtime.selectedViewerTool = '';
    }
    runtime.laneVertexDrag = null;
    runtime.suppressNextLaneVertexClick = false;
    runtime.ladderBandDrag = null;
    runtime.suppressNextLadderBandClick = false;
  }

  function clearCanvasTool(tool) {
    if (runtime.selectedViewerTool === tool) {
      clearCanvasInteractionState();
    }
  }

  function onViewerToolSelected(tool) {
    const selectedTool = runtime.selectedViewerTool;
    if (selectedTool === 'dividers') {
      if (!finishLaneDividers()) {
        return;
      }
      if (tool === 'dividers') {
        return;
      }
    }
    clearCanvasInteractionState({ clearTool: false });
    runtime.selectedViewerTool = runtime.selectedViewerTool === tool ? '' : tool;
    if (runtime.selectedViewerTool === 'dividers') {
      runtime.manualDividerConfirmed = false;
      updateLaneSegmentation({ dividerDone: false });
    }
    renderManualProgress();
    const label = getViewerToolLabel(runtime.selectedViewerTool);
    if (label) {
      if (runtime.selectedViewerTool === 'dividers') {
        deps.setStatus('Set lane dividers selected. Click every lane boundary; the outermost lines define the gel edges.');
        return;
      }
      if (runtime.selectedViewerTool === 'lane-vertices') {
        deps.setStatus('Adjust lane vertices selected. Drag one of the four corner handles for a lane.');
        return;
      }
      deps.setStatus(`${label} selected. Click the gel image to apply it.`);
      return;
    }
    deps.setStatus('Viewer tool cleared. Gel tools will follow the current selection.');
  }

  const {
    getCanvasInteractionStep,
    getLaneBandProgress,
    getManualStep,
    renderManualProgress,
    renderOverrideStatus
  } = createManualProgress({
    runtime,
    elements,
    deps,
    getSegmentationLanes: (...args) => getSegmentationLanes(...args)
  });







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

  function finishLaneDividers() {
    const segmentation = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation || {};
    if (
      !Number.isFinite(segmentation.gelLeft)
      || !Number.isFinite(segmentation.gelRight)
      || segmentation.gelRight <= segmentation.gelLeft + 2
    ) {
      deps.setStatus('Add at least two lane dividers to define the gel edges before finishing.');
      return false;
    }
    runtime.manualDividerConfirmed = true;
    updateLaneSegmentation({ dividerDone: true });
    clearCanvasTool('dividers');
    renderOverrideStatus();
    deps.setStatus('Lane dividers finished. Click a lane to set the ladder lane.');
    return true;
  }

  const {
    findLadderBandNearPoint,
    moveLadderBand,
    onDetectLadderBands,
    upsertLadderBandMw
  } = createManualLadderBands({
    runtime,
    elements,
    deps,
    getRectifiedLaneRowFromPoint: (...args) => getRectifiedLaneRowFromPoint(...args),
    inferLaneIndexFromSegmentationPoint: (...args) => inferLaneIndexFromSegmentationPoint(...args),
    renderOverrideStatus: (...args) => renderOverrideStatus(...args)
  });






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


  const {
    onLaneBandModeToggle,
    updateLaneVertexFromPoint,
    upsertLaneBandWindow
  } = createManualLaneShapes({
    runtime,
    deps,
    clearCanvasInteractionState: (...args) => clearCanvasInteractionState(...args),
    getLaneBandProgress: (...args) => getLaneBandProgress(...args),
    getSegmentationLanes: (...args) => getSegmentationLanes(...args),
    renderOverrideStatus: (...args) => renderOverrideStatus(...args),
    updateLaneSegmentation: (...args) => updateLaneSegmentation(...args)
  });







  const {
    onManualNextStep,
    onManualPrevStep,
    onManualResetSteps
  } = createManualStepNavigation({
    runtime,
    deps,
    clearCanvasInteractionState: (...args) => clearCanvasInteractionState(...args),
    finishLaneDividers: (...args) => finishLaneDividers(...args),
    getLaneBandProgress: (...args) => getLaneBandProgress(...args),
    getManualStep: (...args) => getManualStep(...args),
    renderManualProgress: (...args) => renderManualProgress(...args),
    renderOverrideStatus: (...args) => renderOverrideStatus(...args),
    updateLaneSegmentation: (...args) => updateLaneSegmentation(...args)
  });





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
    const existingBoundaries = [
      segmentation.gelLeft,
      ...(Array.isArray(segmentation.dividers) ? segmentation.dividers : []),
      segmentation.gelRight
    ]
      .filter(Number.isFinite)
      .map((value) => clamp(Math.floor(value), 0, Math.max(0, runtime.currentImage.width - 1)))
      .sort((a, b) => a - b)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]);
    if (existingBoundaries.includes(divider)) {
      return false;
    }
    const boundaries = [...existingBoundaries, divider].sort((a, b) => a - b);
    updateLaneSegmentation({
      gelLeft: boundaries[0],
      gelRight: boundaries.length > 1 ? boundaries[boundaries.length - 1] : null,
      dividers: boundaries.length > 2 ? boundaries.slice(1, -1) : [],
      dividerDone: false,
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

  const {
    onCanvasClick,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    resetDownstreamManualSelections
  } = createManualCanvasInteraction({
    runtime,
    elements,
    deps,
    addLaneDivider: (...args) => addLaneDivider(...args),
    appendBandOverride: (...args) => appendBandOverride(...args),
    clearCanvasTool: (...args) => clearCanvasTool(...args),
    findLadderBandNearPoint: (...args) => findLadderBandNearPoint(...args),
    getCanvasInteractionStep: (...args) => getCanvasInteractionStep(...args),
    getLaneBandProgress: (...args) => getLaneBandProgress(...args),
    getRectifiedLaneRowFromPoint: (...args) => getRectifiedLaneRowFromPoint(...args),
    inferLaneIndexFromSegmentationPoint: (...args) => inferLaneIndexFromSegmentationPoint(...args),
    moveLadderBand: (...args) => moveLadderBand(...args),
    renderOverrideStatus: (...args) => renderOverrideStatus(...args),
    updateLaneSegmentation: (...args) => updateLaneSegmentation(...args),
    updateLaneVertexFromPoint: (...args) => updateLaneVertexFromPoint(...args),
    upsertLadderBandMw: (...args) => upsertLadderBandMw(...args),
    upsertLaneBandWindow: (...args) => upsertLaneBandWindow(...args)
  });







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
      deps.setStatus('Auto-detection found no clear lanes. Adjust the lane dividers or contrast and try again.');
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
    runtime.selectedViewerTool = 'dividers';
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(`Auto-detected ${peakCount} lane(s). Review the boundaries, add any missing ones, then click Lane dividers again to finish.`);
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
    onDetectLadderBands,
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
