import {
  countCompleteLaneBandWindows,
  hasCompleteLaneBandWindow,
  isPerLaneBandMode,
  normalizeLaneBandWindows,
  normalizeManualOverrides
} from '../shared.js';
import { renderViewerToolbar } from './manual-ui.js';

// Which manual step the workflow is on, how far the per-lane band pass has got,
// and the progress and status copy both are reported through.

function createManualProgress({
  runtime,
  elements,
  deps,
  getSegmentationLanes
} = {}) {
  function getManualStep(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
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
    const manualStep = laneBandStep || getManualStep();
    return manualStep === 'dividers' ? '' : manualStep;
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
    const hasLaneBoundaries = Number.isFinite(segmentation.gelLeft)
      && Number.isFinite(segmentation.gelRight)
      && segmentation.gelRight > segmentation.gelLeft + 2;
    if (!hasLaneBoundaries) {
      return false;
    }
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
      const showsCompletionAction = activeStep === 'ladder-mw' || activeStep === 'quantify';
      elements.gelManualNextBtn.hidden = !showsCompletionAction;
      elements.gelManualNextBtn.disabled = !showsCompletionAction;
      if (activeStep === 'ladder-mw') {
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
    getCanvasInteractionStep,
    getLaneBandProgress,
    getManualStep,
    renderManualProgress,
    renderOverrideStatus
  };
}

export { createManualProgress };
