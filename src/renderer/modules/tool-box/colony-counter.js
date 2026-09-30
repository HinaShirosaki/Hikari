// Colony counter tool.
//
// Responsibilities:
// - load and display colony plate images on layered canvases
// - support crop, mask, zoom, and pan interactions before counting
// - run the trained colony heatmap model and allow marker adjustments
// - present the annotated plate and count summary in a two-column workspace
import { clampNumber } from './common.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { showTransientNotice } from '../../lib/notify.js';
import { EMPTY_MASK, getCanvasPointerPosition } from './colony-counter/canvas-utils.js';
import { createColonyViewport } from './colony-counter/viewport.js';
import { createColonyPreviewRendering } from './colony-counter/preview-rendering.js';
import { createColonyImageCropping } from './colony-counter/image-cropping.js';
import { createColonyPointerInteractions } from './colony-counter/pointer-interactions.js';
import { createMaskAndModelCount } from './colony-counter/mask-and-model.js';
import { createColonyControlState } from './colony-counter/control-state.js';

export function initColonyCounterTool() {
  // Core DOM nodes for image loading, crop controls, canvases, and summary output.
  const colonyCounterForm = document.getElementById('colony-counter-form');
  if (!colonyCounterForm) {
    return;
  }

  const colonyCounterShell = document.querySelector('#tool-colony-counter-view .colony-counter-shell');
  const colonyImageInput = document.getElementById('colony-image-file');
  const colonyMaxSizeInput = document.getElementById('colony-max-size');
  const colonyModelThresholdInput = document.getElementById('colony-model-threshold');
  const colonyModelMinDistanceInput = document.getElementById('colony-model-min-distance');
  const colonyAutoCountBtn = document.getElementById('colony-auto-count-btn');
  const colonyMaskModeSelect = document.getElementById('colony-mask-mode');
  const colonyStartMaskBtn = document.getElementById('colony-start-mask-btn');
  const colonyClearMaskBtn = document.getElementById('colony-clear-mask-btn');
  const colonyRunBtn = document.getElementById('colony-run-btn');
  const colonyResetBtn = document.getElementById('colony-reset-btn');
  const colonyStartCropBtn = document.getElementById('colony-start-crop-btn');
  const colonyApplyCropBtn = document.getElementById('colony-apply-crop-btn');
  const colonyCancelCropBtn = document.getElementById('colony-cancel-crop-btn');
  const colonyResetCropBtn = document.getElementById('colony-reset-crop-btn');
  const colonyCropMenuBtn = document.getElementById('colony-crop-menu-btn');
  const colonyCropMenu = document.getElementById('colony-crop-menu');
  const colonyClearMarkersBtn = document.getElementById('colony-clear-markers-btn');
  const colonyStatus = document.getElementById('colony-status');
  const colonySummary = document.getElementById('colony-summary');
  const colonyPreviewCanvas = document.getElementById('colony-preview-canvas');
  const colonyCropperShell = document.getElementById('colony-cropper-shell');
  const colonyCropperImage = document.getElementById('colony-cropper-image');
  const colonySourceCanvas = document.getElementById('colony-source-canvas');

  // Offscreen/original canvases hold source pixels separately from the zoomed display canvases.
  const colonySourceCtx = colonySourceCanvas?.getContext('2d', { willReadFrequently: true }) || null;
  const colonyOriginalCanvas = document.createElement('canvas');
  const colonyOriginalCtx = colonyOriginalCanvas.getContext('2d', { willReadFrequently: true });

  // In-memory interaction state for the current image, cropper session, markers, and viewport.
  const colonyState = {
    imageName: '',
    sourceWidth: 0,
    sourceHeight: 0,
    hasImage: false,
    cropper: null,
    markers: [],
    mask: { ...EMPTY_MASK },
    maskDraft: null,
    isDrawingMask: false,
    maskStartPoint: null,
    lastCountSource: 'manual',
    lastModelStats: null,
    isModelRunning: false,
    zoom: 1,
    viewX: 0,
    viewY: 0,
    isPanning: false,
    panLastX: 0,
    panLastY: 0,
    panMoved: false,
    suppressNextClick: false
  };

  // Update the status line and optionally switch it into an error color.
  function setColonyStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!colonyStatus) {
      return;
    }
    colonyStatus.textContent = message;
    colonyStatus.classList.toggle('is-error', Boolean(isError));
  }

  // Clear results when the tool returns to its initial state.
  function resetColonySummary() {
    if (!colonySummary) {
      return;
    }
    colonySummary.textContent = '';
  }

  const {
    hasActiveMask,
    normalizeMask,
    isSourcePointInsideMask,
    resetViewport,
    setViewport,
    getViewport,
    sourceToPreviewPoint,
    previewToSourcePoint,
    sourceMaskToPreviewBox,
    drawMaskShapePath,
    buildMaskFromSourcePoints
  } = createColonyViewport({
    state: colonyState,
    getPreviewCanvas: () => colonyPreviewCanvas,
    getMaskMode: () => colonyMaskModeSelect?.value
  });

  function getCountedMarkers() {
    return colonyState.markers.filter((marker) => isSourcePointInsideMask(marker));
  }

  // Render the current colony count and interaction hints.
  function renderColonySummary() {
    if (!colonySummary) {
      return;
    }
    const countedMarkers = getCountedMarkers();
    const count = countedMarkers.length;
    const total = colonyState.markers.length;
    const hasMask = hasActiveMask();
    const label = colonyState.lastCountSource === 'model' ? 'Model colonies counted' : 'Colonies counted';
    const maskNote = hasMask && total !== count
      ? `<p class="small-note">${count} of ${total} marker${total === 1 ? '' : 's'} are inside the active mask.</p>`
      : '';
    colonySummary.innerHTML = `
      <p><strong>${label}:</strong> ${count}</p>
      ${maskNote}
    `;
  }

  // Check whether CropperJS is currently active on the loaded image.
  function isCropModeActive() {
    return Boolean(colonyState.cropper);
  }

  // Read and clamp display-related settings from the form inputs.
  function getDisplaySettings() {
    return {
      maxProcessSize: Math.round(clampNumber(colonyMaxSizeInput?.value, 300, 5000, 1600))
    };
  }

  function getModelSettings() {
    return {
      threshold: clampNumber(colonyModelThresholdInput?.value, 0.01, 0.99, 0.5),
      minDistance: Math.round(clampNumber(colonyModelMinDistanceInput?.value, 1, 50, 3))
    };
  }

  const { renderPreviewCanvas } = createColonyPreviewRendering({
    state: colonyState,
    colonyPreviewCanvas,
    colonySourceCanvas,
    getDisplaySettings,
    getViewport,
    sourceToPreviewPoint,
    sourceMaskToPreviewBox,
    isSourcePointInsideMask,
    drawMaskShapePath
  });


  const { updateControlState } = createColonyControlState({
    state: colonyState,
    elements: {
      colonyRunBtn,
      colonyAutoCountBtn,
      colonyStartMaskBtn,
      colonyClearMaskBtn,
      colonyClearMarkersBtn,
      colonyStartCropBtn,
      colonyApplyCropBtn,
      colonyCancelCropBtn,
      colonyResetCropBtn,
      colonyCropMenuBtn,
      colonyPreviewCanvas
    },
    isCropModeActive: () => isCropModeActive(),
    hasActiveMask,
    closeColonyCropMenu: () => closeColonyCropMenu()
  });

  const cropElements = {
    colonyImageInput,
    colonyCropMenu,
    colonyCropMenuBtn,
    colonyCropperImage,
    colonyCropperShell,
    colonySummary
  };
  const colonyCanvases = {
    colonySourceCanvas,
    colonySourceCtx,
    colonyOriginalCanvas,
    colonyOriginalCtx
  };
  const colonyViewport = {
    hasActiveMask,
    normalizeMask,
    isSourcePointInsideMask,
    resetViewport,
    setViewport,
    getViewport,
    sourceToPreviewPoint,
    previewToSourcePoint,
    buildMaskFromSourcePoints
  };

  const {
    closeColonyCropMenu,
    destroyCropper,
    clearMarkers,
    handleColonyImageFile,
    startCropMode,
    applyCrop,
    resetToOriginalImage
  } = createColonyImageCropping({
    state: colonyState,
    elements: cropElements,
    canvases: colonyCanvases,
    resetViewport,
    renderPreviewCanvas: () => renderPreviewCanvas(),
    renderColonySummary: () => renderColonySummary(),
    setColonyStatus: (message, isError) => setColonyStatus(message, isError),
    updateControlState: () => updateControlState()
  });

  const {
    finishPanning,
    finishMaskDrawingFromCanvasPoint,
    renderManualCountResult,
    resetColonyCounter,
    handlePreviewClick,
    handlePreviewMouseDown,
    handlePreviewMouseMove,
    handlePreviewWheel,
    handlePreviewContextMenu
  } = createColonyPointerInteractions({
    state: colonyState,
    elements: { colonyImageInput, colonyPreviewCanvas },
    canvases: colonyCanvases,
    viewport: colonyViewport,
    isCropModeActive: () => isCropModeActive(),
    destroyCropper: () => destroyCropper(),
    getCountedMarkers: () => getCountedMarkers(),
    renderPreviewCanvas: () => renderPreviewCanvas(),
    renderColonySummary: () => renderColonySummary(),
    resetColonySummary: () => resetColonySummary(),
    setColonyStatus: (message, isError) => setColonyStatus(message, isError),
    updateControlState: () => updateControlState()
  });

  const { startMaskDrawing, clearMask, runModelCount } = createMaskAndModelCount({
    state: colonyState,
    colonySourceCanvas,
    getModelSettings,
    isCropModeActive: () => isCropModeActive(),
    hasActiveMask,
    normalizeMask,
    renderPreviewCanvas: () => renderPreviewCanvas(),
    renderColonySummary: () => renderColonySummary(),
    setColonyStatus: (message, isError) => setColonyStatus(message, isError),
    updateControlState: () => updateControlState()
  });

  // Clamp the max-size display input so preview rendering stays within supported bounds.
  function syncDisplayInput() {
    if (!colonyMaxSizeInput) {
      return;
    }
    const value = Math.round(clampNumber(colonyMaxSizeInput.value, 300, 5000, 1600));
    colonyMaxSizeInput.value = String(value);
  }

  function syncModelInputs() {
    const settings = getModelSettings();
    if (colonyModelThresholdInput) {
      colonyModelThresholdInput.value = settings.threshold.toFixed(2);
    }
    if (colonyModelMinDistanceInput) {
      colonyModelMinDistanceInput.value = String(settings.minDistance);
    }
  }

  // Re-render the preview when the configured display size changes.
  colonyMaxSizeInput?.addEventListener('change', () => {
    syncDisplayInput();
    if (colonyState.hasImage) {
      renderPreviewCanvas();
    }
  });

  colonyModelThresholdInput?.addEventListener('change', () => {
    syncModelInputs();
  });

  colonyModelMinDistanceInput?.addEventListener('change', () => {
    syncModelInputs();
  });

  // Load a newly selected image file into the tool.
  colonyImageInput?.addEventListener('change', async () => {
    const file = colonyImageInput.files?.[0];
    await handleColonyImageFile(file);
  });

  bindFileDropTarget({
    target: colonyCounterShell || colonyCounterForm,
    accept: colonyImageInput?.getAttribute?.('accept') || 'image/*',
    onFiles: ([file]) => handleColonyImageFile(file, { syncFileInput: true }),
    onRejected: () => {
      setColonyStatus('Drop an image file to load a colony plate.', true);
    },
    onError: (error) => {
      setColonyStatus(String(error?.message || error || 'Failed to load the dropped colony image.'), true);
    }
  });

  colonyCropMenuBtn?.addEventListener('click', () => {
    if (!colonyCropMenu) {
      return;
    }
    const willOpen = colonyCropMenu.hidden;
    colonyCropMenu.hidden = !willOpen;
    colonyCropMenuBtn.setAttribute('aria-expanded', String(willOpen));
  });

  colonyCropMenu?.addEventListener('click', (event) => {
    if (event.target?.closest?.('.colony-crop-menu-option')) {
      closeColonyCropMenu();
    }
  });

  document.addEventListener('click', (event) => {
    if (colonyCropMenu?.hidden) {
      return;
    }
    if (colonyCropMenu.contains?.(event.target) || colonyCropMenuBtn?.contains?.(event.target)) {
      return;
    }
    closeColonyCropMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeColonyCropMenu();
    }
  });

  // Enter crop mode.
  colonyStartCropBtn?.addEventListener('click', async () => {
    try {
      await startCropMode();
    } catch (error) {
      setColonyStatus(error.message || 'Failed to start crop mode.', true);
      destroyCropper();
    }
  });

  // Apply the current crop selection.
  colonyApplyCropBtn?.addEventListener('click', () => {
    applyCrop();
  });

  // Exit crop mode without changing the current source image.
  colonyCancelCropBtn?.addEventListener('click', () => {
    destroyCropper();
    setColonyStatus('Crop cancelled.');
  });

  // Restore the original uncropped image.
  colonyResetCropBtn?.addEventListener('click', () => {
    resetToOriginalImage();
  });

  colonyAutoCountBtn?.addEventListener('click', async () => {
    await runModelCount();
  });

  colonyStartMaskBtn?.addEventListener('click', () => {
    startMaskDrawing();
  });

  colonyClearMaskBtn?.addEventListener('click', () => {
    clearMask();
  });

  // Count colonies with left-click on the preview.
  colonyPreviewCanvas?.addEventListener('click', (event) => {
    handlePreviewClick(event);
  });

  // Begin panning on mouse down when zoomed in.
  colonyPreviewCanvas?.addEventListener('mousedown', (event) => {
    handlePreviewMouseDown(event);
  });

  // Continue panning while the pointer moves.
  colonyPreviewCanvas?.addEventListener('mousemove', (event) => {
    handlePreviewMouseMove(event);
  });

  // Finish panning when the mouse button is released over the preview.
  colonyPreviewCanvas?.addEventListener('mouseup', (event) => {
    if (colonyState.isDrawingMask) {
      const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
      finishMaskDrawingFromCanvasPoint(point);
      return;
    }
    finishPanning();
  });

  // Finish panning when the pointer leaves the preview canvas.
  colonyPreviewCanvas?.addEventListener('mouseleave', () => {
    finishPanning();
  });

  // Zoom with the mouse wheel.
  colonyPreviewCanvas?.addEventListener('wheel', (event) => {
    handlePreviewWheel(event);
  }, { passive: false });

  // Remove markers with right-click.
  colonyPreviewCanvas?.addEventListener('contextmenu', (event) => {
    handlePreviewContextMenu(event);
  });

  // Ensure pan state is cleared even if the mouse is released outside the canvas.
  window.addEventListener('mouseup', () => {
    if (colonyState.isDrawingMask && colonyState.maskDraft) {
      finishMaskDrawingFromCanvasPoint(null);
      return;
    }
    finishPanning();
  });

  // Treat form submission as confirmation of the current count.
  colonyCounterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderManualCountResult();
  });

  // Clear all current markers.
  colonyClearMarkersBtn?.addEventListener('click', () => {
    clearMarkers();
  });

  // Fully reset the tool.
  colonyResetBtn?.addEventListener('click', () => {
    resetColonyCounter();
  });

  syncDisplayInput();
  syncModelInputs();
  resetColonySummary();
  setColonyStatus('Choose or drop an image, then run auto count or click colonies manually.');
  updateControlState();
}
