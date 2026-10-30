import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { buildLanesFromManualSegmentation } from '../analysis/analysis-core.js';
import { detectLanes } from '../analysis/auto-lanes.js';
import { getViewerToolLabel, renderViewerToolbar } from './manual-ui.js';
import { createManualCanvasInteraction } from './canvas-interaction.js';
import { createManualLaneShapes } from './lane-shapes.js';
import { createManualLadderBands } from './ladder-bands.js';
import { createLadderMwEditor } from './ladder-mw-editor.js';
import { createDividerMenu } from './divider-menu.js';
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
  const dividerMenu = createDividerMenu({ runtime, elements, onRemove: removeLaneDivider });
  const ladderMwEditor = createLadderMwEditor({
    runtime,
    elements,
    onSet: (rowY, mw) => {
      upsertLadderBandMw(rowY, mw);
      renderOverrideStatus();
      deps.renderCanvas();
      deps.onRunAnalysis();
      deps.setStatus('');
    }
  });
  function clearCanvasInteractionState({ clearTool = true } = {}) {
    dividerMenu.close();
    ladderMwEditor.close();
    if (clearTool) {
      runtime.selectedViewerTool = '';
    }
    runtime.laneVertexDrag = null;
    runtime.suppressNextLaneVertexClick = false;
    runtime.laneDividerDrag = null;
    runtime.suppressNextLaneDividerClick = false;
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
      updateLaneSegmentation({ dividerDone: false });
    }
    renderManualProgress();
    deps.renderCanvas();
    const label = getViewerToolLabel(runtime.selectedViewerTool);
    if (label) {
      if (runtime.selectedViewerTool === 'dividers') {
        deps.setStatus(i18nUi.text("Click to add lane boundaries, or drag an existing divider to move it. The outermost dividers mark the gel edges."));
        return;
      }
      if (runtime.selectedViewerTool === 'lane-vertices') {
        deps.setStatus(i18nUi.text("Drag a lane’s corner handles to correct tilt."));
        return;
      }
      if (runtime.selectedViewerTool === 'ladder-mw') {
        deps.setStatus(i18nUi.text("Click a band in the ladder lane to enter its MW; drag a label to move it."));
        return;
      }
      deps.setStatus(i18nUi.text("{p0}: click the gel.", { p0: label }));
      return;
    }
    deps.setStatus('');
  }

  const {
    getLaneBandProgress,
    renderManualProgress,
    renderOverrideStatus
  } = createManualProgress({
    runtime,
    elements,
    deps: { ...deps, syncLadderMwEditor: () => { ladderMwEditor.sync(); dividerMenu.sync(); } },
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
      bandBottom: null
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
      deps.setStatus(i18nUi.text("Add at least two lane dividers to define the gel edges before finishing."));
      return false;
    }
    updateLaneSegmentation({ dividerDone: true });
    clearCanvasTool('dividers');
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(i18nUi.text("Lanes set. Next: Ladder or Bands."));
    return true;
  }

  const {
    findLadderBandNearPoint,
    isPointInLadderLane,
    moveLadderBand,
    onDetectLadderBands,
    upsertLadderBandMw
  } = createManualLadderBands({
    runtime,
    elements,
    deps,
    getRectifiedLaneRowFromPoint: (...args) => getRectifiedLaneRowFromPoint(...args),
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
      laneVertices: []
    });
    runtime.currentReport = null;
    return true;
  }

  function removeLaneDivider(x) {
    if (!runtime.currentImage || runtime.cropperActive || runtime.selectedViewerTool !== 'dividers') return;
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = normalized.laneSegmentation;
    const boundaries = [...new Set([segmentation.gelLeft, ...segmentation.dividers, segmentation.gelRight]
      .filter(Number.isFinite))].sort((a, b) => a - b);
    if (!boundaries.includes(x)) return;
    const remaining = boundaries.filter(value => value !== x);
    updateLaneSegmentation({
      gelLeft: remaining[0] ?? null,
      gelRight: remaining.length > 1 ? remaining[remaining.length - 1] : null,
      dividers: remaining.length > 2 ? remaining.slice(1, -1) : [],
      dividerDone: false, laneVertices: [], laneBandWindows: []
    });
    resetDownstreamManualSelections();
    runtime.manualOverrides.peakIntegrations = [];
    runtime.currentReport = null;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus('');
  }

  function moveLaneDivider(from, x) {
    if (!runtime.currentImage || runtime.cropperActive || runtime.selectedViewerTool !== 'dividers' || !Number.isFinite(x)) return null;
    const segmentation = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation;
    const boundaries = [...new Set([segmentation.gelLeft, ...segmentation.dividers, segmentation.gelRight]
      .filter(Number.isFinite))].sort((a, b) => a - b);
    const index = boundaries.indexOf(from);
    if (index < 0) return null;
    const position = clamp(Math.round(x), index ? boundaries[index - 1] + 1 : 0,
      index < boundaries.length - 1 ? boundaries[index + 1] - 1 : runtime.currentImage.width - 1);
    if (position === from) return from;
    boundaries[index] = position;
    updateLaneSegmentation({
      gelLeft: boundaries[0], gelRight: boundaries.length > 1 ? boundaries[boundaries.length - 1] : null,
      dividers: boundaries.length > 2 ? boundaries.slice(1, -1) : [],
      dividerDone: false, laneVertices: [], laneBandWindows: []
    });
    resetDownstreamManualSelections();
    runtime.manualOverrides.peakIntegrations = [];
    runtime.currentReport = null;
    return position;
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
    clearCanvasTool: (...args) => clearCanvasTool(...args),
    findLadderBandNearPoint: (...args) => findLadderBandNearPoint(...args),
    isPointInLadderLane: (...args) => isPointInLadderLane(...args),
    getLaneBandProgress: (...args) => getLaneBandProgress(...args),
    getRectifiedLaneRowFromPoint: (...args) => getRectifiedLaneRowFromPoint(...args),
    inferLaneIndexFromSegmentationPoint: (...args) => inferLaneIndexFromSegmentationPoint(...args),
    moveLadderBand: (...args) => moveLadderBand(...args),
    moveLaneDivider,
    renderOverrideStatus: (...args) => renderOverrideStatus(...args),
    updateLaneSegmentation: (...args) => updateLaneSegmentation(...args),
    updateLaneVertexFromPoint: (...args) => updateLaneVertexFromPoint(...args),
    openLadderMwEditor: ladderMwEditor.open,
    upsertLaneBandWindow: (...args) => upsertLaneBandWindow(...args)
  });







  function onAutoDetectLanes() {
    if (!runtime.currentImage?.gray) {
      deps.setStatus(i18nUi.text("Load a gel image before auto-detecting lanes."));
      return;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const segmentation = normalized.laneSegmentation || {};
    const rawCount = Number(elements.gelExpectedLaneCountInput?.value);
    const expectedLaneCount = Number.isFinite(rawCount) && rawCount >= 2 ? Math.min(40, Math.floor(rawCount)) : null;
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
      deps.setStatus(i18nUi.text("Auto-detection found no clear lanes (at least two are required). Adjust the image crop or set lane dividers manually."));
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
    runtime.currentReport = null;
    runtime.laneProfileHoverY = null;
    resetDownstreamManualSelections();
    clearCanvasInteractionState();
    runtime.selectedViewerTool = 'dividers';
    renderOverrideStatus();
    deps.renderCanvas();
    const inferred = result.inferredPeaks.length;
    const inferredLaneNumbers = result.inferredPeaks.map((peak) => result.peaks.indexOf(peak) + 1).join(', ');
    const inferenceNote = inferred
      ? ` Lane(s) ${inferredLaneNumbers} inferred as blank from spacing; verify their positions.` : '';
    const countNote = result.countMismatch
      ? ` Expected ${expectedLaneCount}; found ${peakCount}. Add missing boundaries or correct the expected count.` : '';
    deps.setStatus(i18nUi.text("Auto-detected {p0} lane(s).{p1}{p2} Check the dividers, then click Finish dividers.", { p0: peakCount, p1: inferenceNote, p2: countNote }));
  }

  function onResetManualOverrides() {
    runtime.manualOverrides = createEmptyManualOverrides();
    clearCanvasInteractionState();
    runtime.currentReport = null;
    renderOverrideStatus();
    // Analysis needs lane dividers, so there is nothing to re-run until they are set again.
    deps.renderCanvas();
    deps.setStatus('');
  }

  return {
    destroy() { dividerMenu.destroy(); ladderMwEditor.destroy(); },
    onAutoDetectLanes,
    onCanvasClick,
    onDetectLadderBands,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onLaneBandModeToggle,
    onResetManualOverrides,
    onViewerToolSelected,
    renderManualProgress,
    renderOverrideStatus,
    renderViewerToolbar: () => renderViewerToolbar(elements, runtime.selectedViewerTool, isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation))
  };
}
