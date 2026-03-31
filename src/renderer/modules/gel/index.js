import { analyzeGelImage, buildLanesFromManualSegmentation } from './analysis-core.js';
import { DEFAULT_LADDER_STANDARDS } from './constants.js';
import { getGelElements } from './dom.js';
import { createBandsCsv, downloadTextFile } from './export.js';
import { decodeImageFile, isTiffFile, normalizeDecodedImage } from './image-io.js';
import { normalizeEnhancementSettings, preprocessWithJs } from './image-processing.js';
import {
  clamp,
  createEmptyManualOverrides,
  mean,
  normalizeManualOverrides,
  round,
  safeFilePart
} from './shared.js';

export function initGelAnalysis({ state, persist, createId, safeText, onGelAnalysesChanged }) {
  const {
    gelForm,
    gelIdInput,
    gelNameInput,
    gelProjectInput,
    gelNotebookEntryInput,
    gelTypeInput,
    gelImageFileInput,
    gelLadderLaneInput,
    gelLadderBandMwInput,
    gelNormalizationInput,
    gelDenoiseStrengthInput,
    gelDenoiseStrengthValue,
    gelContrastStrengthInput,
    gelContrastStrengthValue,
    gelResetOverridesBtn,
    gelStartCropBtn,
    gelApplyCropBtn,
    gelCancelCropBtn,
    gelResetCropBtn,
    gelOverrideStatus,
    gelStatus,
    gelRunBtn,
    gelCancelBtn,
    gelExportJsonBtn,
    gelExportCsvBtn,
    gelToolLeftBorderBtn,
    gelToolRightBorderBtn,
    gelToolDividersBtn,
    gelToolLadderLaneBtn,
    gelCanvas,
    gelCropperImage,
    gelReportSummary,
    gelReportJson,
    gelSearchInput,
    gelList,
    gelManualProgress,
    gelStepLeft,
    gelStepRight,
    gelStepDividers,
    gelStepLadder,
    gelStepLadderMw,
    gelStepBandTop,
    gelStepBandBottom,
    gelStepBands,
    gelManualPrevBtn,
    gelManualNextBtn,
    gelManualResetBtn
  } = getGelElements(document);

  let currentImage = null;
  let originalImage = null;
  let currentReport = null;
  let manualOverrides = createEmptyManualOverrides();
  let cropApplied = false;
  let cropperInstance = null;
  let cropperActive = false;
  let cropDisplaySize = null;
  let manualDividerConfirmed = false;
  let selectedViewerTool = '';
  let imageRevision = 0;
  let preprocessedCache = null;
  let enhancementRerunTimer = null;

  gelProjectInput?.addEventListener('change', renderNotebookOptions);
  gelImageFileInput?.addEventListener('change', onImageFileChange);
  gelDenoiseStrengthInput?.addEventListener('input', onEnhancementChanged);
  gelContrastStrengthInput?.addEventListener('input', onEnhancementChanged);
  gelRunBtn?.addEventListener('click', onRunAnalysis);
  gelResetOverridesBtn?.addEventListener('click', onResetManualOverrides);
  gelStartCropBtn?.addEventListener('click', onStartCrop);
  gelApplyCropBtn?.addEventListener('click', onApplyCrop);
  gelCancelCropBtn?.addEventListener('click', onCancelCrop);
  gelResetCropBtn?.addEventListener('click', onResetCrop);
  gelCanvas?.addEventListener('click', onCanvasClick);
  gelCancelBtn?.addEventListener('click', resetForm);
  gelExportJsonBtn?.addEventListener('click', onExportJson);
  gelExportCsvBtn?.addEventListener('click', onExportCsv);
  gelToolLeftBorderBtn?.addEventListener('click', () => onViewerToolSelected('left'));
  gelToolRightBorderBtn?.addEventListener('click', () => onViewerToolSelected('right'));
  gelToolDividersBtn?.addEventListener('click', () => onViewerToolSelected('dividers'));
  gelToolLadderLaneBtn?.addEventListener('click', () => onViewerToolSelected('ladder'));
  gelForm?.addEventListener('submit', onSaveAnalysis);
  gelSearchInput?.addEventListener('input', renderList);
  gelList?.addEventListener('click', onListClick);
  gelManualPrevBtn?.addEventListener('click', onManualPrevStep);
  gelManualNextBtn?.addEventListener('click', onManualNextStep);
  gelManualResetBtn?.addEventListener('click', onManualResetSteps);

  function ensureState() {
    if (!Array.isArray(state.gelAnalyses)) {
      state.gelAnalyses = [];
    }
  }

  function setStatus(message) {
    if (gelStatus) {
      gelStatus.textContent = message || '';
    }
  }

  function getViewerToolLabel(tool = selectedViewerTool) {
    if (tool === 'left') {
      return 'Set left border';
    }
    if (tool === 'right') {
      return 'Set right border';
    }
    if (tool === 'dividers') {
      return 'Set dividers';
    }
    if (tool === 'ladder') {
      return 'Set ladder lane';
    }
    return '';
  }

  function renderViewerToolbar() {
    gelToolLeftBorderBtn?.classList.toggle('is-active', selectedViewerTool === 'left');
    gelToolRightBorderBtn?.classList.toggle('is-active', selectedViewerTool === 'right');
    gelToolDividersBtn?.classList.toggle('is-active', selectedViewerTool === 'dividers');
    gelToolLadderLaneBtn?.classList.toggle('is-active', selectedViewerTool === 'ladder');
  }

  function onViewerToolSelected(tool) {
    selectedViewerTool = selectedViewerTool === tool ? '' : tool;
    renderViewerToolbar();
    const label = getViewerToolLabel();
    if (label) {
      setStatus(`${label} selected. Click the gel image to apply it.`);
      return;
    }
    setStatus('Viewer tool cleared. Manual workflow will follow the current step.');
  }

  function setCurrentImage(nextImage) {
    currentImage = nextImage;
    imageRevision += 1;
    preprocessedCache = null;
    if (enhancementRerunTimer) {
      window.clearTimeout(enhancementRerunTimer);
      enhancementRerunTimer = null;
    }
  }

  function readEnhancementSettingsFromUi() {
    return normalizeEnhancementSettings({
      denoiseStrength: gelDenoiseStrengthInput?.value,
      contrastBoost: gelContrastStrengthInput?.value
    });
  }

  function renderEnhancementValues() {
    const enhancement = readEnhancementSettingsFromUi();
    if (gelDenoiseStrengthInput) {
      gelDenoiseStrengthInput.value = String(enhancement.denoiseStrength);
    }
    if (gelContrastStrengthInput) {
      gelContrastStrengthInput.value = String(enhancement.contrastBoost);
    }
    if (gelDenoiseStrengthValue) {
      gelDenoiseStrengthValue.textContent = `${enhancement.denoiseStrength}%`;
    }
    if (gelContrastStrengthValue) {
      gelContrastStrengthValue.textContent = `${enhancement.contrastBoost}%`;
    }
  }

  function getPreprocessedImageForCurrentSettings() {
    if (!currentImage) {
      return null;
    }
    const enhancement = readEnhancementSettingsFromUi();
    const cache = preprocessedCache;
    if (
      cache
      && cache.imageRevision === imageRevision
      && cache.enhancement?.denoiseStrength === enhancement.denoiseStrength
      && cache.enhancement?.contrastBoost === enhancement.contrastBoost
    ) {
      return cache.result;
    }

    const result = preprocessWithJs(
      currentImage.gray,
      currentImage.width,
      currentImage.height,
      enhancement
    );
    preprocessedCache = {
      imageRevision,
      enhancement,
      result
    };
    return result;
  }

  function onEnhancementChanged() {
    renderEnhancementValues();
    preprocessedCache = null;
    if (currentImage) {
      renderCanvas();
    }
    if (currentReport) {
      if (enhancementRerunTimer) {
        window.clearTimeout(enhancementRerunTimer);
      }
      enhancementRerunTimer = window.setTimeout(() => {
        enhancementRerunTimer = null;
        onRunAnalysis();
      }, 140);
    }
  }

  function getManualStep(overrides = normalizeManualOverrides(manualOverrides)) {
    const segmentation = overrides.laneSegmentation || {};
    const hasLeft = Number.isFinite(segmentation.gelLeft);
    const hasRight = Number.isFinite(segmentation.gelRight);
    const dividerDone = Boolean(segmentation.dividerDone) || manualDividerConfirmed;
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
    if (selectedViewerTool) {
      return selectedViewerTool;
    }
    return getManualStep();
  }

  function updateStepClass(element, state) {
    if (!element) {
      return;
    }
    element.classList.toggle('is-active', state === 'active');
    element.classList.toggle('is-done', state === 'done');
  }

  function renderManualProgress() {
    if (gelManualProgress) {
      gelManualProgress.hidden = false;
    }

    const overrides = normalizeManualOverrides(manualOverrides);
    const activeStep = getManualStep(overrides);
    const dividerDone = Boolean(overrides.laneSegmentation?.dividerDone) || manualDividerConfirmed;
    updateStepClass(gelStepLeft, activeStep === 'left' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelLeft) ? 'done' : 'todo'));
    updateStepClass(gelStepRight, activeStep === 'right' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.gelRight) ? 'done' : 'todo'));
    updateStepClass(gelStepDividers, activeStep === 'dividers' ? 'active' : (dividerDone ? 'done' : 'todo'));
    updateStepClass(gelStepLadder, activeStep === 'ladder' ? 'active' : (Number.isFinite(overrides.ladderLane) ? 'done' : 'todo'));
    updateStepClass(gelStepLadderMw, activeStep === 'ladder-mw' ? 'active' : (Boolean(overrides.ladderBandsDone) ? 'done' : 'todo'));
    updateStepClass(gelStepBandTop, activeStep === 'band-top' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandTop) ? 'done' : 'todo'));
    updateStepClass(gelStepBandBottom, activeStep === 'band-bottom' ? 'active' : (Number.isFinite(overrides.laneSegmentation?.bandBottom) ? 'done' : 'todo'));
    updateStepClass(gelStepBands, activeStep === 'bands' ? 'active' : ((overrides.addedBands?.length || 0) > 0 ? 'done' : 'todo'));

    if (gelManualPrevBtn) {
      gelManualPrevBtn.disabled = activeStep === 'left';
    }
    if (gelManualNextBtn) {
      gelManualNextBtn.disabled = !(activeStep === 'dividers' || activeStep === 'ladder-mw');
      gelManualNextBtn.textContent = activeStep === 'ladder-mw' ? 'Done Ladder MW' : 'Done Dividers';
    }
    renderViewerToolbar();
  }

  function copyNormalizedImage(image) {
    if (!image) {
      return null;
    }
    return {
      ...image,
      imageData: new ImageData(new Uint8ClampedArray(image.imageData.data), image.width, image.height),
      gray: new Float32Array(image.gray)
    };
  }

  function imageDataToDataUrl(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function destroyCropper() {
    if (cropperInstance && typeof cropperInstance.destroy === 'function') {
      cropperInstance.destroy();
    }
    cropperInstance = null;
    cropperActive = false;
    if (gelCropperImage) {
      gelCropperImage.classList.remove('is-active');
      gelCropperImage.style.display = 'none';
      gelCropperImage.style.width = '';
      gelCropperImage.style.height = '';
      gelCropperImage.style.maxWidth = '';
      gelCropperImage.removeAttribute('src');
    }
    if (gelCanvas) {
      gelCanvas.hidden = false;
      gelCanvas.style.display = 'block';
    }
    cropDisplaySize = null;
  }

  function captureCurrentGelDisplaySize() {
    const canvasRect = gelCanvas?.getBoundingClientRect();
    if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
      return {
        width: Math.round(canvasRect.width),
        height: Math.round(canvasRect.height)
      };
    }
    const shell = gelCanvas?.closest('.gel-canvas-shell');
    const shellRect = shell?.getBoundingClientRect();
    if (shellRect && shellRect.width > 0) {
      return {
        width: Math.round(shellRect.width),
        height: Math.max(320, Math.round((shellRect.width * (currentImage?.height || 1)) / Math.max(1, currentImage?.width || 1)))
      };
    }
    return null;
  }

  function showCropperForCurrentImage() {
    if (!currentImage || !gelCropperImage || !window.Cropper) {
      return false;
    }
    destroyCropper();
    cropDisplaySize = captureCurrentGelDisplaySize();
    gelCropperImage.src = imageDataToDataUrl(currentImage.imageData);
    gelCropperImage.classList.add('is-active');
    if (cropDisplaySize) {
      gelCropperImage.style.width = `${cropDisplaySize.width}px`;
      gelCropperImage.style.height = `${cropDisplaySize.height}px`;
      gelCropperImage.style.maxWidth = 'none';
    } else {
      gelCropperImage.style.width = '100%';
      gelCropperImage.style.height = 'auto';
      gelCropperImage.style.maxWidth = '100%';
    }
    if (gelCanvas) {
      gelCanvas.hidden = true;
      gelCanvas.style.display = 'none';
    }
    cropperInstance = new window.Cropper(gelCropperImage, {
      viewMode: 1,
      autoCropArea: 1,
      responsive: true,
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      minContainerWidth: cropDisplaySize?.width || 200,
      minContainerHeight: cropDisplaySize?.height || 200
    });
    cropperActive = true;
    return true;
  }

  function setCropUiState() {
    if (gelApplyCropBtn) {
      gelApplyCropBtn.disabled = !cropperActive || !cropperInstance;
    }
    if (gelCancelCropBtn) {
      gelCancelCropBtn.disabled = !cropperActive;
    }
  }

  function leaveCropMode() {
    destroyCropper();
    setCropUiState();
  }

  function enterCropMode() {
    if (!window.Cropper) {
      setStatus('Cropper.js is not loaded.');
      return false;
    }
    const started = showCropperForCurrentImage();
    setCropUiState();
    return started;
  }

  function renderOverrideStatus() {
    if (!gelOverrideStatus) {
      return;
    }
    const summary = normalizeManualOverrides(manualOverrides);
    const parts = [
      `gel ${summary.laneSegmentation?.gelLeft ?? '-'}-${summary.laneSegmentation?.gelRight ?? '-'}`,
      `div ${summary.laneSegmentation?.dividers?.length || 0}`,
      `bandY ${summary.laneSegmentation?.bandTop ?? '-'}-${summary.laneSegmentation?.bandBottom ?? '-'}`,
      `add ${summary.addedBands.length}`,
      `ladderMW ${summary.ladderBands?.length || 0}`,
      `ladder ${summary.ladderLane || '-'}`
    ];
    gelOverrideStatus.textContent = `Manual overrides: ${parts.join(' | ')}`;
    renderManualProgress();
  }

  function readParams() {
    const rawType = gelTypeInput?.value;
    const analysisType = rawType === 'western' || rawType === 'agarose' ? rawType : 'sds-page';
    const enhancement = readEnhancementSettingsFromUi();

    return {
      analysisType,
      analysisMode: 'manual',
      ladderStandards: DEFAULT_LADDER_STANDARDS.slice(),
      ladderLane: clamp(Math.floor(Number(gelLadderLaneInput?.value) || 1), 1, 999),
      normalization: gelNormalizationInput?.value === 'total-lane'
        ? gelNormalizationInput.value
        : 'none',
      cropApplied,
      tiffPage: Number.isFinite(currentImage?.tiffPageIndex) ? currentImage.tiffPageIndex : null,
      tiffPageCount: Number.isFinite(currentImage?.tiffPageCount) ? currentImage.tiffPageCount : null,
      enhancement,
      manualOverrides: normalizeManualOverrides(manualOverrides)
    };
  }

  function renderProjectOptions() {
    if (!gelProjectInput) {
      return;
    }
    const selected = gelProjectInput.value;
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    gelProjectInput.innerHTML = options.join('');
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      gelProjectInput.value = selected;
    }
  }

  function notebookLabel(entry) {
    const typeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
    return `${typeLabel}: ${entry.protocolName || '-'} (${updated})`;
  }

  function formatAnalysisTypeLabel(type) {
    if (type === 'western') {
      return 'Western Blot';
    }
    if (type === 'agarose') {
      return 'DNA/RNA Agarose';
    }
    return 'SDS-PAGE';
  }

  function renderNotebookOptions() {
    if (!gelNotebookEntryInput) {
      return;
    }

    const selected = gelNotebookEntryInput.value;
    const projectId = gelProjectInput?.value || '';
    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

    const options = ['<option value="">Not linked</option>'];
    entries.forEach((entry) => {
      options.push(`<option value="${entry.id}">${safeText(notebookLabel(entry))}</option>`);
    });

    gelNotebookEntryInput.innerHTML = options.join('');

    if (selected && entries.some((entry) => entry.id === selected)) {
      gelNotebookEntryInput.value = selected;
    }
  }

  function onResetManualOverrides() {
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    selectedViewerTool = '';
    currentReport = null;
    renderOverrideStatus();
    renderReport();
    setStatus('Manual overrides cleared.');
    if (currentImage) {
      onRunAnalysis();
    } else {
      renderCanvas();
    }
  }

  function onStartCrop() {
    if (!currentImage) {
      setStatus('Load a gel image before cropping.');
      return;
    }
    const started = enterCropMode();
    if (!started) {
      setStatus('Failed to start crop mode.');
      return;
    }
    setStatus('Crop mode: adjust selection with Cropper.js, then click Apply Crop.');
  }

  function onCancelCrop() {
    if (!cropperActive) {
      return;
    }
    leaveCropMode();
    renderCanvas();
    setStatus('Crop cancelled.');
  }

  function onApplyCrop() {
    if (!currentImage) {
      setStatus('Load a gel image before cropping.');
      return;
    }
    if (!cropperInstance) {
      setStatus('Start crop mode first.');
      return;
    }
    const croppedCanvas = cropperInstance.getCroppedCanvas({
      minWidth: 12,
      minHeight: 12,
      fillColor: '#000'
    });
    if (!croppedCanvas || croppedCanvas.width < 12 || croppedCanvas.height < 12) {
      setStatus('Select a larger crop area first.');
      return;
    }
    const context = croppedCanvas.getContext('2d', { willReadFrequently: true });
    const croppedData = context.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    setCurrentImage(normalizeDecodedImage({
      name: currentImage.name,
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      imageData: croppedData,
      tiffPageIndex: currentImage.tiffPageIndex,
      tiffPageCount: currentImage.tiffPageCount
    }));
    cropApplied = true;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    selectedViewerTool = '';
    renderOverrideStatus();
    renderReport();
    leaveCropMode();
    renderCanvas();
    setStatus(`Crop applied: ${currentImage.width}x${currentImage.height}. Ready to analyze.`);
  }

  function onResetCrop() {
    if (!originalImage) {
      setStatus('No original image available to reset.');
      return;
    }
    setCurrentImage(copyNormalizedImage(originalImage));
    cropApplied = false;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    selectedViewerTool = '';
    renderOverrideStatus();
    renderReport();
    leaveCropMode();
    renderCanvas();
    setStatus('Restored full image. Crop the gel before analysis.');
  }

  function getCanvasPoint(event) {
    const rect = gelCanvas?.getBoundingClientRect();
    if (!rect || !currentImage) {
      return null;
    }
    const x = ((event.clientX - rect.left) / rect.width) * currentImage.width;
    const y = ((event.clientY - rect.top) / rect.height) * currentImage.height;
    return {
      x: clamp(Math.round(x), 0, currentImage.width - 1),
      y: clamp(Math.round(y), 0, currentImage.height - 1)
    };
  }

  function updateLaneSegmentation(patch) {
    const normalized = normalizeManualOverrides(manualOverrides);
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
    manualOverrides = {
      ...normalized,
      laneSegmentation: next
    };
  }

  function upsertLadderBandMw(pixelY, mw) {
    const normalized = normalizeManualOverrides(manualOverrides);
    const points = normalized.ladderBands
      .filter((item) => Math.abs(item.pixelY - pixelY) > 8);
    points.push({
      pixelY: clamp(Math.round(pixelY), 0, Math.max(0, currentImage.height - 1)),
      mw
    });
    points.sort((a, b) => a.pixelY - b.pixelY);
    manualOverrides = {
      ...normalized,
      ladderBands: points
    };
  }

  function inferLaneIndexFromSegmentationX(x) {
    if (!currentImage) {
      return null;
    }
    const lanes = buildLanesFromManualSegmentation(normalizeManualOverrides(manualOverrides), currentImage.width);
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
    const segmentation = normalizeManualOverrides(manualOverrides).laneSegmentation || {};
    if (step === 'dividers') {
      if (!Number.isFinite(segmentation.gelLeft) || !Number.isFinite(segmentation.gelRight)) {
        setStatus('Set left and right borders before finishing dividers.');
        return;
      }
      manualDividerConfirmed = true;
      updateLaneSegmentation({ dividerDone: true });
      renderOverrideStatus();
      setStatus('Divider step completed. Click a lane to set ladder lane.');
      return;
    }

    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(manualOverrides);
      if ((normalized.ladderBands?.length || 0) < 2) {
        setStatus('Add at least 2 ladder MW points before continuing.');
        return;
      }
      manualOverrides = {
        ...normalized,
        ladderBandsDone: true
      };
      renderOverrideStatus();
      setStatus('Ladder MW step completed. Click the top line of target band.');
      onRunAnalysis();
    }
  }

  function onManualPrevStep() {
    const step = getManualStep();
    const normalized = normalizeManualOverrides(manualOverrides);
    if (step === 'left') {
      return;
    }
    if (step === 'right') {
      updateLaneSegmentation({ gelLeft: null });
      manualDividerConfirmed = false;
    } else if (step === 'dividers') {
      updateLaneSegmentation({ gelRight: null, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder') {
      updateLaneSegmentation({ dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'ladder-mw') {
      manualOverrides = {
        ...normalized,
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
    } else if (step === 'band-top') {
      manualOverrides = {
        ...normalized,
        ladderBandsDone: false
      };
    } else if (step === 'band-bottom') {
      updateLaneSegmentation({ bandTop: null, bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
    } else {
      updateLaneSegmentation({ bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
    }
    selectedViewerTool = '';
    currentReport = null;
    renderOverrideStatus();
    renderCanvas();
    renderReport();
    setStatus('Moved back to previous step.');
  }

  function onManualResetSteps() {
    manualOverrides = createEmptyManualOverrides();
    manualDividerConfirmed = false;
    selectedViewerTool = '';
    currentReport = null;
    renderOverrideStatus();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('Manual workflow reset.');
  }

  function addLaneDivider(x) {
    const normalized = normalizeManualOverrides(manualOverrides);
    const segmentation = normalized.laneSegmentation || {
      gelLeft: null,
      gelRight: null,
      dividers: [],
      dividerDone: false,
      bandTop: null,
      bandBottom: null
    };
    const divider = clamp(Math.floor(x), 0, Math.max(0, currentImage.width - 1));
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
    const overrides = normalizeManualOverrides(manualOverrides);
    const current = overrides.addedBands
      .filter((item) => !(item.laneIndex === laneIndex && Math.abs(item.pixelY - pixelY) <= 8));
    current.push({ laneIndex, pixelY });
    manualOverrides = {
      ...overrides,
      addedBands: current
    };
  }

  function onCanvasClick(event) {
    if (!currentImage) {
      return;
    }
    if (cropperActive) {
      setStatus('Finish crop mode first: Apply Crop or Cancel Crop.');
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    const step = getCanvasInteractionStep();
    if (step === 'left') {
      updateLaneSegmentation({ gelLeft: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 1 complete: left border set at x=${point.x}.`);
      return;
    }
    if (step === 'right') {
      const left = normalizeManualOverrides(manualOverrides).laneSegmentation?.gelLeft;
      if (!Number.isFinite(left) || point.x <= left + 2) {
        setStatus('Right border must be to the right of left border.');
        return;
      }
      updateLaneSegmentation({ gelRight: point.x, dividers: [], dividerDone: false, bandTop: null, bandBottom: null });
      manualDividerConfirmed = false;
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: null,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 2 complete: right border set at x=${point.x}.`);
      return;
    }
    if (step === 'dividers') {
      const added = addLaneDivider(point.x);
      renderOverrideStatus();
      renderCanvas();
      if (!added) {
        setStatus('Divider must be between left and right borders.');
        return;
      }
      setStatus(`Divider added at x=${point.x}. Add more, then click Done Dividers.`);
      return;
    }
    if (step === 'ladder') {
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex) {
        setStatus('No lane found at click position.');
        return;
      }
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        ladderLane: laneIndex,
        ladderBands: [],
        ladderBandsDone: false,
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Manual step 4 complete: ladder lane set to ${laneIndex}.`);
      onRunAnalysis();
      return;
    }
    if (step === 'ladder-mw') {
      const normalized = normalizeManualOverrides(manualOverrides);
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex || laneIndex !== normalized.ladderLane) {
        setStatus(`Click inside the ladder lane (${normalized.ladderLane || '-'}) to set ladder MW.`);
        return;
      }
      const mw = Number(gelLadderBandMwInput?.value);
      if (!Number.isFinite(mw) || mw <= 0) {
        setStatus('Enter Ladder Band MW (kDa) before clicking the band.');
        return;
      }
      upsertLadderBandMw(point.y, mw);
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Added ladder calibration point: y=${point.y}, MW=${mw} kDa.`);
      onRunAnalysis();
      return;
    }
    if (step === 'band-top') {
      updateLaneSegmentation({ bandTop: point.y, bandBottom: null });
      manualOverrides = {
        ...normalizeManualOverrides(manualOverrides),
        addedBands: []
      };
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Band top line set at y=${point.y}.`);
      return;
    }
    if (step === 'band-bottom') {
      const top = normalizeManualOverrides(manualOverrides).laneSegmentation?.bandTop;
      if (!Number.isFinite(top) || point.y <= top + 1) {
        setStatus('Bottom line must be below top line.');
        return;
      }
      updateLaneSegmentation({ bandBottom: point.y });
      renderOverrideStatus();
      renderCanvas();
      setStatus(`Band bottom line set at y=${point.y}. Target band region applied to all lanes.`);
      onRunAnalysis();
      return;
    }
    if (step === 'bands') {
      const laneIndex = inferLaneIndexFromSegmentationX(point.x);
      if (!laneIndex) {
        setStatus('No lane found at click position.');
        return;
      }
      appendBandOverride(laneIndex, point.y);
      renderOverrideStatus();
      setStatus(`Band added in lane ${laneIndex} near y=${point.y}.`);
      onRunAnalysis();
      return;
    }
  }

  async function onImageFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }

    setStatus('Loading gel image...');
    try {
      setCurrentImage(await decodeImageFile(file));
      originalImage = copyNormalizedImage(currentImage);
      cropApplied = false;
      currentReport = null;
      manualOverrides = createEmptyManualOverrides();
      manualDividerConfirmed = false;
      selectedViewerTool = '';
      leaveCropMode();
      renderOverrideStatus();
      renderCanvas();
      renderReport();
      if (isTiffFile(file)) {
        setStatus(
          `Loaded ${file.name} page ${currentImage.tiffPageIndex || 1}/${currentImage.tiffPageCount || 1} (${currentImage.width}x${currentImage.height}) via TIFF decoder.`
        );
      } else {
        setStatus(`Loaded ${file.name} (${currentImage.width}x${currentImage.height}).`);
      }
    } catch (error) {
      setCurrentImage(null);
      originalImage = null;
      cropApplied = false;
      currentReport = null;
      manualOverrides = createEmptyManualOverrides();
      manualDividerConfirmed = false;
      selectedViewerTool = '';
      leaveCropMode();
      renderOverrideStatus();
      renderCanvas();
      renderReport();
      setStatus(error instanceof Error ? error.message : 'Failed to load image.');
    }
  }

  function renderCanvas() {
    if (!gelCanvas) {
      return;
    }

    const context = gelCanvas.getContext('2d');
    if (!currentImage || !context) {
      gelCanvas.width = 1;
      gelCanvas.height = 1;
      context?.clearRect(0, 0, 1, 1);
      return;
    }

    gelCanvas.width = currentImage.width;
    gelCanvas.height = currentImage.height;
    const preprocessed = getPreprocessedImageForCurrentSettings();
    const baseImageData = preprocessed?.previewImageData || currentImage.imageData;
    context.putImageData(baseImageData, 0, 0);

    const overrides = normalizeManualOverrides(manualOverrides);
    const segmentation = overrides.laneSegmentation || {};
    const segmentationLanes = buildLanesFromManualSegmentation(overrides, currentImage.width) || [];
    if (
      Number.isFinite(segmentation.gelLeft) ||
      Number.isFinite(segmentation.gelRight) ||
      (Array.isArray(segmentation.dividers) && segmentation.dividers.length)
    ) {
      context.save();
      context.lineWidth = 1.4;
      if (Number.isFinite(segmentation.gelLeft)) {
        const x = clamp(segmentation.gelLeft, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      }
      if (Number.isFinite(segmentation.gelRight)) {
        const x = clamp(segmentation.gelRight, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 214, 10, 0.95)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      }
      (Array.isArray(segmentation.dividers) ? segmentation.dividers : []).forEach((divider) => {
        const x = clamp(divider, 0, currentImage.width - 1);
        context.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, currentImage.height);
        context.stroke();
      });

      if (Number.isFinite(segmentation.bandTop)) {
        const y = clamp(segmentation.bandTop, 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
      }
      if (Number.isFinite(segmentation.bandBottom)) {
        const y = clamp(segmentation.bandBottom, 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
      }

      if (Number.isFinite(segmentation.bandTop) && Number.isFinite(segmentation.bandBottom) && segmentationLanes.length) {
        const top = clamp(Math.min(segmentation.bandTop, segmentation.bandBottom), 0, currentImage.height - 1);
        const bottom = clamp(Math.max(segmentation.bandTop, segmentation.bandBottom), top + 1, currentImage.height - 1);
        segmentationLanes.forEach((lane) => {
          context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
          context.lineWidth = 1.2;
          context.strokeRect(
            lane.xStart + 0.5,
            top + 0.5,
            Math.max(1, lane.xEnd - lane.xStart),
            Math.max(1, bottom - top)
          );
        });
      }

      if (Number.isFinite(overrides.ladderLane) && segmentationLanes.length) {
        const ladder = segmentationLanes.find((lane) => lane.index + 1 === overrides.ladderLane);
        if (ladder) {
          context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
          context.lineWidth = 2.2;
          context.strokeRect(
            ladder.xStart + 0.5,
            0.5,
            Math.max(1, ladder.xEnd - ladder.xStart),
            currentImage.height - 1
          );
        }
      }

      (Array.isArray(overrides.ladderBands) ? overrides.ladderBands : []).forEach((item) => {
        const y = clamp(Math.round(item.pixelY), 0, currentImage.height - 1);
        context.strokeStyle = 'rgba(255, 197, 61, 0.98)';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(currentImage.width, y + 0.5);
        context.stroke();
        context.fillStyle = 'rgba(255, 197, 61, 0.98)';
        context.font = '11px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(`${round(item.mw, 1)}kDa`, 4, Math.max(10, y - 3));
      });
      context.restore();
    }

    if (currentReport?.lanes?.length) {
      currentReport.lanes.forEach((lane) => {
        const isLadder = (overrides.ladderLane === lane.laneIndex)
          || (currentReport.calibration?.ladderLane === lane.laneIndex);
        context.strokeStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.9)';
        context.lineWidth = isLadder ? 2.2 : 1.6;
        context.strokeRect(
          lane.xStart + 0.5,
          0.5,
          Math.max(1, lane.xEnd - lane.xStart),
          currentImage.height - 1
        );

        context.fillStyle = isLadder ? 'rgba(255, 197, 61, 0.95)' : 'rgba(46, 173, 255, 0.95)';
        context.font = '12px "SF Pro Text", "Segoe UI", sans-serif';
        context.fillText(String(lane.laneIndex), lane.xStart + 2, 12);

        lane.bands.forEach((band) => {
          context.strokeStyle = band.manual ? 'rgba(34, 197, 94, 0.98)' : 'rgba(255, 99, 132, 0.95)';
          context.lineWidth = 1.3;
          context.beginPath();
          context.moveTo(lane.xStart, band.pixelY + 0.5);
          context.lineTo(lane.xEnd, band.pixelY + 0.5);
          context.stroke();

          if (Number.isFinite(band.estimatedMw)) {
            context.fillStyle = band.manualMw ? 'rgba(34, 197, 94, 0.95)' : 'rgba(255, 99, 132, 0.92)';
            context.fillText(`${round(band.estimatedMw, 1)}kDa`, lane.xEnd + 3, band.pixelY - 1);
          }
        });
      });
    }

  }

  function renderReport() {
    if (!gelReportSummary || !gelReportJson) {
      return;
    }

    if (!currentReport) {
      gelReportSummary.innerHTML = '<p class="small-note">No analysis report yet.</p>';
      gelReportJson.textContent = '';
      return;
    }

    const totalBands = (currentReport.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
    const targetIntensities = (currentReport.lanes || [])
      .map((lane) => Number(lane.targetBandIntensity))
      .filter((value) => Number.isFinite(value));
    const averageTargetIntensity = targetIntensities.length
      ? round(mean(targetIntensities), 4)
      : null;
    const calibrationText = currentReport.calibration?.ok
      ? `R^2 ${currentReport.calibration.r2}`
      : 'Not calibrated';
    const enhancementText = `${currentReport.preprocessing?.denoiseStrength ?? '-'}% denoise / ${currentReport.preprocessing?.contrastBoost ?? '-'}% contrast`;
    const tiffPageText = currentReport.image?.tiffPageCount
      ? `${currentReport.image.tiffPage}/${currentReport.image.tiffPageCount}`
      : '-';
    const manualSummary = currentReport.preprocessing?.manualOverridesSummary || {};
    const manualText = [
      `gelL:${manualSummary.laneSegmentationLeft ?? '-'}`,
      `gelR:${manualSummary.laneSegmentationRight ?? '-'}`,
      `div:${manualSummary.laneSegmentationDividers || 0}`,
      `top:${manualSummary.laneSegmentationBandTop ?? '-'}`,
      `bottom:${manualSummary.laneSegmentationBandBottom ?? '-'}`,
      `add:${manualSummary.addedBands || 0}`,
      `ladder:${manualSummary.ladderLaneOverride || '-'}`,
      `ladderMW:${manualSummary.ladderBands || 0}`
    ].join(' ');

    gelReportSummary.innerHTML = `
      <article class="card">
        <h3>${safeText(formatAnalysisTypeLabel(currentReport.analysisType))}</h3>
        <p><strong>Lanes:</strong> ${safeText(String(currentReport.lanes?.length || 0))}</p>
        <p><strong>Total Bands:</strong> ${safeText(String(totalBands))}</p>
        <p><strong>TIFF Page:</strong> ${safeText(String(tiffPageText))}</p>
        <p><strong>Calibration:</strong> ${safeText(calibrationText)}</p>
        <p><strong>Enhancement:</strong> ${safeText(enhancementText)}</p>
        <p><strong>Avg Target Intensity:</strong> ${safeText(String(averageTargetIntensity ?? '-'))}</p>
        <p><strong>Confidence:</strong> ${safeText(currentReport.confidence?.label || '-')} (${safeText(String(currentReport.confidence?.score ?? '-'))})</p>
      </article>
      <article class="card">
        <h3>Overrides</h3>
        <p>${safeText(manualText)}</p>
      </article>
      <article class="card">
        <h3>Warnings</h3>
        <p>${safeText((currentReport.warnings || []).join(' | ') || 'None')}</p>
      </article>
    `;

    gelReportJson.textContent = JSON.stringify(currentReport, null, 2);
  }

  async function onRunAnalysis() {
    if (!currentImage) {
      setStatus('Load a gel image before running analysis.');
      return;
    }

    try {
      const params = readParams();
      const preprocessed = getPreprocessedImageForCurrentSettings();
      setStatus('Running gel analysis pipeline...');
      const result = analyzeGelImage({
        gray: currentImage.gray,
        imageName: currentImage.name,
        width: currentImage.width,
        height: currentImage.height,
        params,
        preprocessed
      });
      currentReport = result.report;
      renderCanvas();
      renderReport();
      renderOverrideStatus();
      setStatus(`Analysis complete: ${currentReport.lanes.length} lane(s), ${currentReport.bandGroups.length} group(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }

  function buildRecordFromCurrentReport(existingId = '') {
    const project = (state.projects || []).find((item) => item.id === gelProjectInput?.value);
    const notebookEntry = (state.notebookEntries || []).find((entry) => entry.id === gelNotebookEntryInput?.value);

    return {
      id: existingId || createId(),
      name: gelNameInput?.value.trim() || `Gel-${Date.now()}`,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notebookEntryId: gelNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      imageName: currentReport?.image?.name || '',
      analysisType: currentReport?.analysisType || (gelTypeInput?.value || 'sds-page'),
      parameters: currentReport?.parameters || readParams(),
      manualOverrides: normalizeManualOverrides(manualOverrides),
      report: currentReport,
      updatedAt: new Date().toISOString()
    };
  }

  function onSaveAnalysis(event) {
    event.preventDefault();
    ensureState();

    if (!currentReport) {
      setStatus('Run analysis before saving.');
      return;
    }

    const name = gelNameInput?.value.trim() || '';
    if (!name) {
      setStatus('Analysis name is required.');
      return;
    }

    const editingId = gelIdInput?.value || '';
    const existing = state.gelAnalyses.find((item) => item.id === editingId);
    const record = buildRecordFromCurrentReport(existing?.id || '');
    record.name = name;

    const index = state.gelAnalyses.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.gelAnalyses[index] = record;
    } else {
      state.gelAnalyses.push(record);
    }

    persist();
    renderList();
    if (typeof onGelAnalysesChanged === 'function') {
      onGelAnalysesChanged();
    }
    setStatus(`Saved analysis: ${record.name}.`);
  }

  function onExportJson() {
    if (!currentReport) {
      setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(gelNameInput?.value, 'gel-analysis')}.json`;
    downloadTextFile({
      content: `${JSON.stringify(currentReport, null, 2)}\n`,
      fileName,
      mimeType: 'application/json;charset=utf-8;'
    });
    setStatus(`Exported ${fileName}.`);
  }

  function onExportCsv() {
    if (!currentReport) {
      setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(gelNameInput?.value, 'gel-analysis')}.csv`;
    downloadTextFile({
      content: createBandsCsv(currentReport),
      fileName,
      mimeType: 'text/csv;charset=utf-8;'
    });
    setStatus(`Exported ${fileName}.`);
  }

  function resetForm() {
    gelIdInput.value = '';
    gelForm.reset();
    gelTypeInput.value = 'sds-page';
    gelLadderLaneInput.value = '1';
    gelNormalizationInput.value = 'none';
    if (gelDenoiseStrengthInput) {
      gelDenoiseStrengthInput.value = '35';
    }
    if (gelContrastStrengthInput) {
      gelContrastStrengthInput.value = '100';
    }
    renderEnhancementValues();

    setCurrentImage(null);
    originalImage = null;
    currentReport = null;
    manualOverrides = createEmptyManualOverrides();
    cropApplied = false;
    leaveCropMode();
    manualDividerConfirmed = false;
    selectedViewerTool = '';

    renderProjectOptions();
    renderNotebookOptions();
    renderOverrideStatus();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('');
  }

  function fillFromRecord(record) {
    gelIdInput.value = record.id;
    gelNameInput.value = record.name || '';
    gelProjectInput.value = record.projectId || '';
    renderProjectOptions();
    gelProjectInput.value = record.projectId || '';
    renderNotebookOptions();
    gelNotebookEntryInput.value = record.notebookEntryId || '';

    const parameters = record.parameters || {};
    gelTypeInput.value = record.analysisType === 'western' || record.analysisType === 'agarose'
      ? record.analysisType
      : 'sds-page';
    gelLadderLaneInput.value = String(parameters.ladderLane || 1);
    gelNormalizationInput.value = parameters.normalization || 'none';
    const enhancement = normalizeEnhancementSettings(parameters.enhancement || {});
    if (gelDenoiseStrengthInput) {
      gelDenoiseStrengthInput.value = String(enhancement.denoiseStrength);
    }
    if (gelContrastStrengthInput) {
      gelContrastStrengthInput.value = String(enhancement.contrastBoost);
    }
    renderEnhancementValues();
    manualOverrides = normalizeManualOverrides(record.manualOverrides || parameters.manualOverrides);
    manualDividerConfirmed = Boolean(manualOverrides.laneSegmentation?.dividerDone);
    selectedViewerTool = '';
    renderOverrideStatus();

    currentReport = record.report || null;
    setCurrentImage(null);
    originalImage = null;
    cropApplied = false;
    leaveCropMode();
    renderManualProgress();
    renderCanvas();
    renderReport();
    setStatus('Loaded saved report. Upload original image to view overlay.');
  }

  function deleteRecord(recordId) {
    state.gelAnalyses = (state.gelAnalyses || []).filter((item) => item.id !== recordId);
    persist();
    renderList();
    if (typeof onGelAnalysesChanged === 'function') {
      onGelAnalysesChanged();
    }
    if (gelIdInput?.value === recordId) {
      resetForm();
    }
  }

  function onListClick(event) {
    const editBtn = event.target.closest('[data-gel-edit]');
    if (editBtn) {
      const record = (state.gelAnalyses || []).find((item) => item.id === editBtn.dataset.gelEdit);
      if (record) {
        fillFromRecord(record);
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-gel-delete]');
    if (deleteBtn) {
      deleteRecord(deleteBtn.dataset.gelDelete);
    }
  }

  function matchesSearch(record, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      record.name,
      record.projectName,
      record.notebookEntryProtocolName,
      record.analysisType,
      record.imageName,
      record.updatedAt
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(gelSearchInput?.value || '').trim().toLowerCase();
    const rows = (state.gelAnalyses || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
      .filter((record) => matchesSearch(record, term));

    if (!rows.length) {
      gelList.innerHTML = '<p class="small-note">No gel analyses saved.</p>';
      return;
    }

    gelList.innerHTML = rows.map((record) => {
      const confidence = record.report?.confidence || { label: '-', score: '-' };
      const laneCount = record.report?.lanes?.length || 0;
      const bandCount = (record.report?.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
      const overrideCount = (() => {
        const summary = record.report?.preprocessing?.manualOverridesSummary;
        if (summary) {
          return (summary.laneSegmentationDividers || 0)
            + (Number.isFinite(summary.laneSegmentationLeft) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationRight) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandTop) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandBottom) ? 1 : 0)
            + (summary.addedBands || 0)
            + (summary.ladderBands || 0)
            + (Number.isFinite(summary.ladderLaneOverride) ? 1 : 0);
        }
        const manual = normalizeManualOverrides(record.manualOverrides || {});
        const segmentationCount = (Number.isFinite(manual.laneSegmentation?.gelLeft) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.gelRight) ? 1 : 0)
          + (manual.laneSegmentation?.dividers?.length || 0)
          + (Number.isFinite(manual.laneSegmentation?.bandTop) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.bandBottom) ? 1 : 0)
          + (Number.isFinite(manual.ladderLane) ? 1 : 0);
        return manual.addedBands.length + (manual.ladderBands?.length || 0) + segmentationCount;
      })();
      return `
        <article class="card">
          <h3>${safeText(record.name || record.id)}</h3>
          <p><strong>Type:</strong> ${safeText(formatAnalysisTypeLabel(record.analysisType))}</p>
          <p><strong>Project:</strong> ${safeText(record.projectName || '-')}</p>
          <p><strong>Notebook:</strong> ${safeText(record.notebookEntryProtocolName || '-')}</p>
          <p><strong>Image:</strong> ${safeText(record.imageName || '-')}</p>
          <p><strong>Lanes/Bands:</strong> ${safeText(`${laneCount} / ${bandCount}`)}</p>
          <p><strong>Overrides:</strong> ${safeText(String(overrideCount))}</p>
          <p><strong>Confidence:</strong> ${safeText(String(confidence.label || '-'))} (${safeText(String(confidence.score ?? '-'))})</p>
          <p><strong>Updated:</strong> ${safeText(new Date(record.updatedAt || '').toLocaleString() || '-')}</p>
          <div class="card-actions">
            <button type="button" class="ghost-btn" data-gel-edit="${record.id}">Edit</button>
            <button type="button" class="danger-btn" data-gel-delete="${record.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function render() {
    ensureState();
    renderEnhancementValues();
    renderProjectOptions();
    renderNotebookOptions();
    setCropUiState();
    renderOverrideStatus();
    renderManualProgress();
    renderViewerToolbar();
    renderReport();
    renderList();
    if (!currentImage) {
      renderCanvas();
    }
  }

  return {
    render,
    renderProjectOptions,
    renderNotebookOptions,
    renderList
  };
}
