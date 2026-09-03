import {
  createEmptyManualOverrides,
  hasCompleteLaneBandWindow,
  isPerLaneBandMode,
  normalizeLaneBandWindows,
  normalizeManualOverrides
} from '../shared.js';

// Moving forward and back through the manual steps, including the rewind that has
// to undo whatever the per-lane band pass already recorded.

function createManualStepNavigation({
  runtime,
  deps,
  clearCanvasInteractionState,
  finishLaneDividers,
  getLaneBandProgress,
  getManualStep,
  renderManualProgress,
  renderOverrideStatus,
  updateLaneSegmentation
} = {}) {
  function onManualNextStep() {
    const step = getManualStep();
    if (step === 'dividers') {
      finishLaneDividers();
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
    if (step === 'dividers') {
      return;
    }
    if (step === 'ladder') {
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

  return {
    onManualNextStep,
    onManualPrevStep,
    onManualResetSteps
  };
}

export { createManualStepNavigation };
