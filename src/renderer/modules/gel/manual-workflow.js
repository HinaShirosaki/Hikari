import { buildLanesFromManualSegmentation } from './analysis-core.js';
import { detectLanes } from './auto-lanes.js';
import { getViewerToolLabel, renderViewerToolbar, updateStepClass } from './manual-ui.js';
import {
  clamp,
  countCompleteLaneBandWindows,
  createEmptyManualOverrides,
  getLaneBandWindow,
  hasCompleteLaneBandWindow,
  isPerLaneBandMode,
  normalizeLaneBandWindows,
  normalizeManualOverrides
} from './shared.js';

export function createManualWorkflowController({ runtime, elements, deps }) {
  function onViewerToolSelected(tool) {
    runtime.selectedViewerTool = runtime.selectedViewerTool === tool ? '' : tool;
    renderViewerToolbar(elements, runtime.selectedViewerTool, isPerLaneBandMode(runtime.manualOverrides?.laneSegmentation));
    const label = getViewerToolLabel(runtime.selectedViewerTool);
    if (label) {
      deps.setStatus(`${label} selected. Click the gel image to apply it.`);
      return;
    }
    deps.setStatus('Viewer tool cleared. Manual workflow will follow the current step.');
  }

  function getManualStep(overrides = normalizeManualOverrides(runtime.manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
    const hasLeft = Number.isFinite(segmentation.gelLeft);
    const hasRight = Number.isFinite(segmentation.gelRight);
    const dividerDone = Boolean(segmentation.dividerDone) || runtime.manualDividerConfirmed;
    if (!hasLeft) {
      return 'left';
    }
    if (!hasRight) {
      return 'right';
    }
    if (!dividerDone) {
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
    return runtime.selectedViewerTool || getManualStep();
  }

  function renderManualProgress() {
    if (elements.gelManualProgress) {
      elements.gelManualProgress.hidden = false;
    }

    const overrides = normalizeManualOverrides(runtime.manualOverrides);
    const activeStep = getManualStep(overrides);
    const dividerDone = Boolean(overrides.laneSegmentation?.dividerDone) || runtime.manualDividerConfirmed;
    const laneBandMode = isPerLaneBandMode(overrides.laneSegmentation);
    const laneBandProgress = getLaneBandProgress(overrides);
    const laneBandComplete = laneBandMode && laneBandProgress.totalLanes > 0 && laneBandProgress.completeCount >= laneBandProgress.totalLanes;

    if (elements.gelStepBandTop) {
      elements.gelStepBandTop.textContent = laneBandMode
        ? `6. Click top line of target band (${laneBandProgress.completeCount}/${laneBandProgress.totalLanes || '-'} lanes)`
        : '6. Click top line of target band';
    }
    if (elements.gelStepBandBottom) {
      const laneLabel = laneBandProgress.pendingBottomLaneIndex
        ? ` lane ${laneBandProgress.pendingBottomLaneIndex}`
        : '';
      elements.gelStepBandBottom.textContent = laneBandMode
        ? `7. Click bottom line of target band${laneLabel}`
        : '7. Click bottom line of target band';
    }

    updateStepClass(elements.gelStepLeft, activeStep === 'left' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelLeft) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepRight, activeStep === 'right' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelRight) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepDividers, activeStep === 'dividers' ? 'active' : (dividerDone ? 'done' : 'todo'));
    updateStepClass(elements.gelStepLadder, activeStep === 'ladder' ? 'active' : (Number.isFinite(overrides.ladderLane) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepLadderMw, activeStep === 'ladder-mw' ? 'active' : (Boolean(overrides.ladderBandsDone) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepBandTop, activeStep === 'band-top' ? 'active' : (laneBandMode ? (laneBandComplete ? 'done' : 'todo') : (Number.isFinite(overrides.laneSegmentation?.bandTop) ? 'done' : 'todo')));
    updateStepClass(elements.gelStepBandBottom, activeStep === 'band-bottom' ? 'active' : (laneBandMode ? (laneBandComplete ? 'done' : 'todo') : (Number.isFinite(overrides.laneSegmentation?.bandBottom) ? 'done' : 'todo')));
    updateStepClass(elements.gelStepQuantify, activeStep === 'quantify' ? 'active' : (Boolean(overrides.laneSegmentation?.quantifyConfirmed) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepBands, activeStep === 'bands' ? 'active' : ((overrides.addedBands?.length || 0) > 0 ? 'done' : 'todo'));

    if (elements.gelManualPrevBtn) {
      elements.gelManualPrevBtn.disabled = activeStep === 'left';
    }
    if (elements.gelManualNextBtn) {
      elements.gelManualNextBtn.disabled = !(activeStep === 'dividers' || activeStep === 'ladder-mw' || activeStep === 'quantify');
      if (activeStep === 'ladder-mw') {
        elements.gelManualNextBtn.textContent = 'Done Ladder MW';
      } else if (activeStep === 'quantify') {
        elements.gelManualNextBtn.textContent = 'Done Quantify';
      } else {
        elements.gelManualNextBtn.textContent = 'Done Dividers';
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

  function inferLaneIndexFromSegmentationX(x) {
    if (!runtime.currentImage) {
      return null;
    }
    const lanes = buildLanesFromManualSegmentation(normalizeManualOverrides(runtime.manualOverrides), runtime.currentImage.width);
    if (!lanes?.length) {
      return null;
    }
    const match = lanes.find((lane) => x >= lane.xStart && x <= lane.xEnd);
    if (match) {
      return match.index + 1;
    }
    let bestLane = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    lanes.forEach((lane) => {
      const distance = Math.abs(((lane.xStart + lane.xEnd) / 2) - x);
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
    return buildLanesFromManualSegmentation(overrides, runtime.currentImage.width) || [];
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
    updateLaneSegmentation({
      perLaneBandEnabled: Boolean(enabled),
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
      deps.setStatus('Divider step completed. Click a lane to set ladder lane.');
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
        deps.setStatus(`Ladder MW step skipped (${ladderCount} point${ladderCount === 1 ? '' : 's'}). MW calibration disabled. ${isPerLaneBandMode(normalized.laneSegmentation) ? 'Click the top line of the target band in each lane.' : 'Click the top line of target band.'}`);
      } else {
        deps.setStatus(isPerLaneBandMode(normalized.laneSegmentation)
          ? 'Ladder MW step completed. Click the top line of the target band in each lane.'
          : 'Ladder MW step completed. Click the top line of target band.');
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
      updateLaneSegmentation({ gelLeft: null });
      runtime.manualDividerConfirmed = false;
    } else if (step === 'dividers') {
      updateLaneSegmentation({ gelRight: null, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [] });
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
    runtime.selectedViewerTool = '';
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
    runtime.selectedViewerTool = '';
    runtime.currentReport = null;
    renderOverrideStatus();
    renderManualProgress();
    deps.renderCanvas();
    deps.renderReport();
    deps.setStatus('Manual workflow reset.');
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

  function onCanvasContextMenu(event) {
    if (!runtime.currentImage || runtime.cropperActive) {
      return;
    }
    const step = getCanvasInteractionStep();
    if (step !== 'ladder-mw') {
      return;
    }
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    const normalized = normalizeManualOverrides(runtime.manualOverrides);
    const laneIndex = inferLaneIndexFromSegmentationX(point.x);
    if (!laneIndex || laneIndex !== normalized.ladderLane) {
      deps.setStatus(`Right-click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
      return;
    }

    event.preventDefault();
    const existing = normalized.ladderBands.find((item) => Math.abs(item.pixelY - point.y) <= 8);
    const promptDefault = existing ? String(existing.mw) : (elements.gelLadderBandMwInput?.value || '');
    const raw = window.prompt(`MW for ladder band at y=${point.y} (kDa):`, promptDefault);
    if (raw === null) {
      return;
    }
    const mw = Number(String(raw).trim());
    if (!Number.isFinite(mw) || mw <= 0) {
      deps.setStatus('Invalid MW value. Right-click again and enter a positive number (kDa).');
      return;
    }
    upsertLadderBandMw(point.y, mw);
    if (elements.gelLadderBandMwInput) {
      elements.gelLadderBandMwInput.value = String(mw);
    }
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(`Added ladder calibration point: y=${point.y}, MW=${mw} kDa.`);
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
    if (step === 'left') {
      updateLaneSegmentation({ gelLeft: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [] });
      runtime.manualDividerConfirmed = false;
      resetDownstreamManualSelections();
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Manual step 1 complete: left border set at x=${point.x}.`);
      return;
    }
    if (step === 'right') {
      const left = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.gelLeft;
      if (!Number.isFinite(left) || point.x <= left + 2) {
        deps.setStatus('Right border must be to the right of left border.');
        return;
      }
      updateLaneSegmentation({ gelRight: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null, laneBandWindows: [] });
      runtime.manualDividerConfirmed = false;
      resetDownstreamManualSelections();
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Manual step 2 complete: right border set at x=${point.x}.`);
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
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
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
      deps.setStatus(`Manual step 4 complete: ladder lane set to ${laneIndex}.`);
      deps.onRunAnalysis();
      return;
    }
    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(runtime.manualOverrides);
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex || laneIndex !== normalized.ladderLane) {
        deps.setStatus(`Click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
        return;
      }
      const mw = Number(elements.gelLadderBandMwInput?.value);
      if (!Number.isFinite(mw) || mw <= 0) {
        deps.setStatus('Enter Ladder Band MW (kDa) before clicking the band.');
        return;
      }
      upsertLadderBandMw(point.y, mw);
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Added ladder calibration point: y=${point.y}, MW=${mw} kDa.`);
      deps.onRunAnalysis();
      return;
    }
    if (step === 'band-top') {
      if (isPerLaneBandMode(normalizeManualOverrides(runtime.manualOverrides).laneSegmentation)) {
        const laneIndex = inferLaneIndexFromSegmentationX(point.x);
        if (!laneIndex) {
          deps.setStatus('Click inside a lane to set a lane-specific top line.');
          return;
        }
        upsertLaneBandWindow(laneIndex, { bandTop: point.y, bandBottom: null });
        runtime.manualOverrides = {
          ...normalizeManualOverrides(runtime.manualOverrides),
          addedBands: []
        };
        renderOverrideStatus();
        deps.renderCanvas();
        deps.setStatus(`Lane ${laneIndex} top line set at y=${point.y}. Click the bottom line in lane ${laneIndex}.`);
        return;
      }
      updateLaneSegmentation({ bandTop: point.y, bandBottom: null, laneBandWindows: [], quantifyConfirmed: false });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Band top line set at y=${point.y}.`);
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
        const laneIndex = inferLaneIndexFromSegmentationX(point.x);
        if (laneIndex !== pendingLaneIndex) {
          deps.setStatus(`Click the bottom line in lane ${pendingLaneIndex} before starting another lane.`);
          return;
        }
        const window = getLaneBandWindow(normalized.laneSegmentation, pendingLaneIndex);
        const top = window?.bandTop;
        if (!Number.isFinite(top) || point.y <= top + 1) {
          deps.setStatus('Bottom line must be below top line.');
          return;
        }
        upsertLaneBandWindow(pendingLaneIndex, { bandBottom: point.y });
        runtime.manualOverrides = {
          ...normalizeManualOverrides(runtime.manualOverrides),
          addedBands: []
        };
        renderOverrideStatus();
        deps.renderCanvas();
        const nextProgress = getLaneBandProgress();
        if (nextProgress.totalLanes && nextProgress.completeCount >= nextProgress.totalLanes) {
          deps.setStatus(`Lane ${pendingLaneIndex} bottom line set at y=${point.y}. Per-lane intensities ready in the Quantify panel.`);
        } else {
          deps.setStatus(`Lane ${pendingLaneIndex} bottom line set at y=${point.y}. Click the top line in lane ${nextProgress.missingCompleteLaneIndex || 1}.`);
        }
        deps.onRunAnalysis();
        return;
      }
      const top = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.bandTop;
      if (!Number.isFinite(top) || point.y <= top + 1) {
        deps.setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: point.y, quantifyConfirmed: false });
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Band bottom line set at y=${point.y}. Per-lane intensities ready in the Quantify panel.`);
      deps.onRunAnalysis();
      return;
    }
    if (step === 'bands') {
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex) {
        deps.setStatus('No lane found at click position.');
        return;
      }
      appendBandOverride(laneIndex, point.y);
      renderOverrideStatus();
      deps.setStatus(`Band added in lane ${laneIndex} near y=${point.y}.`);
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
      laneBandWindows: []
    });
    resetDownstreamManualSelections();
    runtime.manualDividerConfirmed = false;
    renderOverrideStatus();
    deps.renderCanvas();
    deps.setStatus(`Auto-detected ${peakCount} lane(s). Review dividers and add any missing ones, then click Done Dividers.`);
  }

  function onResetManualOverrides() {
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.manualDividerConfirmed = false;
    runtime.selectedViewerTool = '';
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
