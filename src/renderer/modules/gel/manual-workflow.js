import { buildLanesFromManualSegmentation } from './analysis-core.js';
import { detectLanes } from './auto-lanes.js';
import { getViewerToolLabel, renderViewerToolbar, updateStepClass } from './manual-ui.js';
import { clamp, createEmptyManualOverrides, normalizeManualOverrides } from './shared.js';

export function createManualWorkflowController({ runtime, elements, deps }) {
  function onViewerToolSelected(tool) {
    runtime.selectedViewerTool = runtime.selectedViewerTool === tool ? '' : tool;
    renderViewerToolbar(elements, runtime.selectedViewerTool);
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
    if (!Number.isFinite(segmentation.bandTop)) {
      return 'band-top';
    }
    if (!Number.isFinite(segmentation.bandBottom)) {
      return 'band-bottom';
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
    updateStepClass(elements.gelStepLeft, activeStep === 'left' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelLeft) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepRight, activeStep === 'right' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelRight) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepDividers, activeStep === 'dividers' ? 'active' : (dividerDone ? 'done' : 'todo'));
    updateStepClass(elements.gelStepLadder, activeStep === 'ladder' ? 'active' : (Number.isFinite(overrides.ladderLane) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepLadderMw, activeStep === 'ladder-mw' ? 'active' : (Boolean(overrides.ladderBandsDone) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepBandTop, activeStep === 'band-top' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandTop) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepBandBottom, activeStep === 'band-bottom' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandBottom) ? 'done' : 'todo'));
    updateStepClass(elements.gelStepBands, activeStep === 'bands' ? 'active' : ((overrides.addedBands?.length || 0) > 0 ? 'done' : 'todo'));

    if (elements.gelManualPrevBtn) {
      elements.gelManualPrevBtn.disabled = activeStep === 'left';
    }
    if (elements.gelManualNextBtn) {
      elements.gelManualNextBtn.disabled = !(activeStep === 'dividers' || activeStep === 'ladder-mw');
      elements.gelManualNextBtn.textContent = activeStep === 'ladder-mw' ? 'Done Ladder MW' : 'Done Dividers';
    }
    renderViewerToolbar(elements, runtime.selectedViewerTool);
  }

  function renderOverrideStatus() {
    if (!elements.gelOverrideStatus) {
      return;
    }
    const summary = normalizeManualOverrides(runtime.manualOverrides);
    const parts = [
      `gel ${summary.laneSegmentation?.gelLeft ?? '-'}-${summary.laneSegmentation?.gelRight ?? '-'}`,
      `div ${summary.laneSegmentation?.dividers?.length || 0}`,
      `bandY ${summary.laneSegmentation?.bandTop ?? '-'}-${summary.laneSegmentation?.bandBottom ?? '-'}`,
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
      bandBottom: null
    };
    const next = {
      gelLeft: current.gelLeft,
      gelRight: current.gelRight,
      dividers: Array.isArray(current.dividers) ? current.dividers.slice() : [],
      dividerDone: Boolean(current.dividerDone),
      bandTop: Number.isFinite(current.bandTop) ? current.bandTop : null,
      bandBottom: Number.isFinite(current.bandBottom) ? current.bandBottom : null,
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
      if ((normalized.ladderBands?.length || 0) < 2) {
        deps.setStatus('Add at least 2 ladder MW points before continuing.');
        return;
      }
      runtime.manualOverrides = {
        ...normalized,
        ladderBandsDone: true
      };
      renderOverrideStatus();
      deps.setStatus('Ladder MW step completed. Click the top line of target band.');
      deps.onRunAnalysis();
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
      updateLaneSegmentation({ gelRight: null, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      runtime.manualDividerConfirmed = false;
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder') {
      updateLaneSegmentation({ dividerDone: false, bandTop: null, bandBottom: null });
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
    } else if (step === 'band-top') {
      runtime.manualOverrides = {
        ...normalized,
        ladderBandsDone: false
      };
    } else if (step === 'band-bottom') {
      updateLaneSegmentation({ bandTop: null, bandBottom: null });
      runtime.manualOverrides = {
        ...normalizeManualOverrides(runtime.manualOverrides),
        addedBands: []
      };
    } else {
      updateLaneSegmentation({ bandBottom: null });
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
      dividers: [...(segmentation.dividers || []), divider]
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
      updateLaneSegmentation({ gelLeft: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
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
      updateLaneSegmentation({ gelRight: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
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
      updateLaneSegmentation({ bandTop: point.y, bandBottom: null });
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
      const top = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation?.bandTop;
      if (!Number.isFinite(top) || point.y <= top + 1) {
        deps.setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: point.y });
      renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(`Band bottom line set at y=${point.y}. Target band region applied to all lanes.`);
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
      bandBottom: segmentation.bandBottom
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
    onManualNextStep,
    onManualPrevStep,
    onManualResetSteps,
    onResetManualOverrides,
    onViewerToolSelected,
    renderManualProgress,
    renderOverrideStatus,
    renderViewerToolbar: () => renderViewerToolbar(elements, runtime.selectedViewerTool)
  };
}
