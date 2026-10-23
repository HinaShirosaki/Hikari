import {
  countCompleteLaneBandWindows,
  hasCompleteLaneBandWindow,
  isPerLaneBandMode,
  normalizeLaneBandWindows,
  normalizeManualOverrides
} from '../shared.js';
import { renderViewerToolbar } from './manual-ui.js';

// How far the per-lane band pass has got, and the tool state and status copy
// it is reported through.

function createManualProgress({
  runtime,
  elements,
  deps,
  getSegmentationLanes
} = {}) {
  function renderManualProgress() {
    deps.syncLadderMwEditor?.();
    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    // Ladder tools act on the ladder lane, so they wait until one is picked.
    for (const button of [elements.gelDetectLadderBtn, elements.gelToolLadderMwBtn]) {
      if (button) button.disabled = !overrides.ladderLane;
    }
    renderViewerToolbar(elements, runtime.selectedViewerTool, isPerLaneBandMode(overrides.laneSegmentation));
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

  return {
    getLaneBandProgress,
    renderManualProgress,
    renderOverrideStatus
  };
}

export { createManualProgress };
