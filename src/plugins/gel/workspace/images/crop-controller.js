import { createEmptyManualOverrides } from '../shared.js';

const MIN_ROTATION_DEGREES = -180;
const MAX_ROTATION_DEGREES = 180;
const ROTATION_DRAG_DEGREES_PER_PIXEL = 0.25;
const CROP_BORDER_SELECTOR = '.cropper-line, .cropper-point';
// Keep in sync with --gel-crop-handle-margin in gel-view.css: the shell shrinks by
// this much while cropping, and minContainer* must not push the container back out.
const CROP_HANDLE_MARGIN_PX = 12;

function normalizeRotationDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const rounded = Math.round(numeric * 10) / 10;
  return Math.min(MAX_ROTATION_DEGREES, Math.max(MIN_ROTATION_DEGREES, rounded));
}

function formatRotationDegrees(value) {
  const normalized = normalizeRotationDegrees(value);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

function wrapDegrees(value) {
  if (value < MIN_ROTATION_DEGREES) return value + 360;
  if (value > MAX_ROTATION_DEGREES) return value - 360;
  return value;
}

// Cropper.getData() is in the source image's natural pixels.
function coversWholeImage(data, image) {
  return Math.abs(wrapDegrees(Number(data?.rotate) || 0)) < 0.05
    && data.x <= 0.5 && data.y <= 0.5
    && data.width >= image.width - 1 && data.height >= image.height - 1;
}

export function createCropController({ runtime, elements, deps }) {
  function clearRotationDrag() {
    const drag = runtime.cropRotationDrag;
    drag?.container?.classList?.remove('is-gel-rotating');
    if (drag?.captureTarget && Number.isFinite(drag.pointerId)) {
      try {
        drag.captureTarget.releasePointerCapture?.(drag.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    runtime.cropRotationDrag = null;
  }

  function destroyCropper() {
    clearRotationDrag();
    if (runtime.cropperInstance && typeof runtime.cropperInstance.destroy === 'function') {
      runtime.cropperInstance.destroy();
    }
    runtime.cropperInstance = null;
    runtime.cropperActive = false;
    if (elements.gelCropperImage) {
      elements.gelCropperImage.classList.remove('is-active');
      elements.gelCropperImage.style.display = 'none';
      elements.gelCropperImage.style.width = '';
      elements.gelCropperImage.style.height = '';
      elements.gelCropperImage.style.maxWidth = '';
      elements.gelCropperImage.removeAttribute('src');
    }
    if (elements.gelCanvas) {
      elements.gelCanvas.hidden = false;
      elements.gelCanvas.style.display = 'block';
    }
    runtime.cropDisplaySize = null;
    runtime.cropRotationDegrees = 0;
    runtime.cropSource = null;
  }

  function captureCurrentGelDisplaySize() {
    const canvasRect = elements.gelCanvas?.getBoundingClientRect();
    if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
      return {
        width: Math.round(canvasRect.width),
        height: Math.round(canvasRect.height)
      };
    }
    const shell = elements.gelCanvas?.closest('.gel-canvas-shell');
    const shellRect = shell?.getBoundingClientRect();
    if (shellRect && shellRect.width > 0) {
      return {
        width: Math.round(shellRect.width),
        height: Math.max(320, Math.round((shellRect.width * (runtime.currentImage?.height || 1)) / Math.max(1, runtime.currentImage?.width || 1)))
      };
    }
    return null;
  }

  // The cropper shows either the current image or, after Reset, the uncropped
  // original; Done crops whichever it is showing.
  function showCropperForImage(image) {
    if (!image || !elements.gelCropperImage || !window.Cropper) {
      return false;
    }
    destroyCropper();
    runtime.cropDisplaySize = captureCurrentGelDisplaySize();
    runtime.cropSource = image;
    elements.gelCropperImage.src = deps.imageDataToDataUrl(image.imageData);
    elements.gelCropperImage.classList.add('is-active');
    if (runtime.cropDisplaySize) {
      elements.gelCropperImage.style.width = `${runtime.cropDisplaySize.width}px`;
      elements.gelCropperImage.style.height = `${runtime.cropDisplaySize.height}px`;
      elements.gelCropperImage.style.maxWidth = 'none';
    } else {
      elements.gelCropperImage.style.width = '100%';
      elements.gelCropperImage.style.height = 'auto';
      elements.gelCropperImage.style.maxWidth = '100%';
    }
    if (elements.gelCanvas) {
      elements.gelCanvas.hidden = true;
      elements.gelCanvas.style.display = 'none';
    }
    runtime.cropperInstance = new window.Cropper(elements.gelCropperImage, {
      // Keep the source-pixel scale fixed while rotating. Mode 1 zooms in to
      // cover the crop box near a quarter turn, then retains that larger scale.
      viewMode: 0,
      autoCropArea: 1,
      responsive: true,
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: true,
      minContainerWidth: Math.max(1, (runtime.cropDisplaySize?.width || 200) - 2 * CROP_HANDLE_MARGIN_PX),
      minContainerHeight: Math.max(1, (runtime.cropDisplaySize?.height || 200) - 2 * CROP_HANDLE_MARGIN_PX)
    });
    runtime.cropperActive = true;
    runtime.cropRotationDegrees = 0;
    return true;
  }

  function setCropUiState() {
    const isCropping = Boolean(runtime.cropperActive && runtime.cropperInstance);
    if (elements.gelCropModeBtn) {
      const cropModeLabel = isCropping ? 'Cancel crop' : 'Start crop';
      elements.gelCropModeBtn.disabled = !runtime.currentImage && !isCropping;
      elements.gelCropModeBtn.classList.toggle('is-active', isCropping);
      elements.gelCropModeBtn.setAttribute('aria-label', cropModeLabel);
      elements.gelCropModeBtn.setAttribute('aria-pressed', isCropping ? 'true' : 'false');
      elements.gelCropModeBtn.setAttribute('title', cropModeLabel);
      deps.bindCropModeLabel?.(elements.gelCropModeBtn, cropModeLabel);
    }
    // While cropping, the crop bar takes over the viewer toolbar, as in photo editors.
    if (elements.gelCropBar) {
      elements.gelCropBar.hidden = !isCropping;
      elements.gelCropBar.parentElement?.classList?.toggle('is-cropping', isCropping);
    }
    if (elements.gelApplyCropBtn) {
      elements.gelApplyCropBtn.disabled = !isCropping;
    }
    syncAngleInput();
  }

  // The slider straightens within ±45°; quarter turns come from the rotate button.
  function syncAngleInput() {
    const total = normalizeRotationDegrees(runtime.cropRotationDegrees);
    const straighten = normalizeRotationDegrees(total - Math.round(total / 90) * 90);
    if (elements.gelCropAngleInput) {
      elements.gelCropAngleInput.value = String(straighten);
    }
    if (elements.gelCropAngleValue) {
      elements.gelCropAngleValue.textContent = `${formatRotationDegrees(straighten)}°`;
    }
  }

  function setRotationDegrees(degrees) {
    if (!runtime.cropperActive || !runtime.cropperInstance) {
      return false;
    }
    const current = normalizeRotationDegrees(runtime.cropRotationDegrees);
    const next = normalizeRotationDegrees(degrees);
    if (typeof runtime.cropperInstance.rotateTo === 'function') {
      runtime.cropperInstance.rotateTo(next);
    } else if (typeof runtime.cropperInstance.rotate === 'function') {
      runtime.cropperInstance.rotate(next - current);
    } else {
      return false;
    }
    runtime.cropRotationDegrees = next;
    syncAngleInput();
    return true;
  }

  function onAngleInput(event) {
    const quarterTurns = Math.round(normalizeRotationDegrees(runtime.cropRotationDegrees) / 90) * 90;
    setRotationDegrees(wrapDegrees(quarterTurns + (Number(event?.target?.value) || 0)));
  }

  function onRotateQuarter() {
    setRotationDegrees(wrapDegrees(normalizeRotationDegrees(runtime.cropRotationDegrees) - 90));
  }

  function onRotationDragStart(event) {
    if (
      !runtime.cropperActive
      || !runtime.cropperInstance
      || event?.isPrimary === false
      || (Number.isFinite(event?.button) && event.button !== 0)
      || event?.target?.closest?.(CROP_BORDER_SELECTOR)
    ) {
      return;
    }
    const container = event?.target?.closest?.('.cropper-container');
    if (!container || !Number.isFinite(event?.clientX)) {
      return;
    }
    clearRotationDrag();
    runtime.cropRotationDrag = {
      captureTarget: event.currentTarget || null,
      container,
      pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
      startDegrees: normalizeRotationDegrees(runtime.cropRotationDegrees),
      startX: event.clientX
    };
    container.classList?.add('is-gel-rotating');
    if (Number.isFinite(event.pointerId)) {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  }

  function onRotationDragMove(event) {
    const drag = runtime.cropRotationDrag;
    if (
      !drag
      || !Number.isFinite(event?.clientX)
      || (Number.isFinite(drag.pointerId) && event.pointerId !== drag.pointerId)
    ) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    setRotationDegrees(drag.startDegrees + (deltaX * ROTATION_DRAG_DEGREES_PER_PIXEL));
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function onRotationDragEnd(event) {
    const drag = runtime.cropRotationDrag;
    if (!drag || (Number.isFinite(drag.pointerId) && event?.pointerId !== drag.pointerId)) {
      return;
    }
    clearRotationDrag();
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  function leaveCropMode() {
    destroyCropper();
    setCropUiState();
  }

  function enterCropMode(image = runtime.currentImage) {
    if (!window.Cropper) {
      deps.setStatus('Cropper.js is not loaded.');
      return false;
    }
    const started = showCropperForImage(image);
    setCropUiState();
    if (started) {
      // Re-render so the viewer drops its fitted height and the cropper owns the box.
      deps.renderCanvas();
    }
    return started;
  }

  function resetAfterCropMutation() {
    runtime.currentReport = null;
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.selectedViewerTool = '';
    deps.renderOverrideStatus();
  }

  function onStartCrop() {
    if (!runtime.currentImage) {
      deps.setStatus('Load a gel image before cropping.');
      return;
    }
    const started = enterCropMode();
    if (!started) {
      deps.setStatus('Failed to start crop mode.');
      return;
    }
    deps.setStatus('Drag the edges to crop. Enter applies, Esc cancels.');
  }

  function onCropModeAction() {
    if (runtime.cropperActive && runtime.cropperInstance) {
      onCancelCrop();
      return;
    }
    onStartCrop();
  }

  function onCancelCrop() {
    if (!runtime.cropperActive) {
      return;
    }
    leaveCropMode();
    deps.renderCanvas();
    deps.setStatus('');
  }

  function onApplyCrop() {
    if (!runtime.currentImage) {
      deps.setStatus('Load a gel image before cropping.');
      return;
    }
    if (!runtime.cropperInstance) {
      deps.setStatus('Start crop mode first.');
      return;
    }
    const source = runtime.cropSource || runtime.currentImage;
    const cropData = runtime.cropperInstance.getData();
    if (coversWholeImage(cropData, source)) {
      // An untouched box changes nothing and keeps the lanes; after Reset it
      // undoes the earlier crop exactly, without resampling the original.
      const uncrop = source === runtime.originalImage && runtime.cropApplied;
      if (uncrop) {
        deps.setCurrentImage(deps.copyNormalizedImage(runtime.originalImage));
        runtime.cropApplied = false;
        resetAfterCropMutation();
      }
      leaveCropMode();
      deps.renderCanvas();
      deps.setStatus('');
      return;
    }
    // No min size: cropGray replays an unscaled crop, and the check below
    // rejects a small one anyway.
    const croppedCanvas = runtime.cropperInstance.getCroppedCanvas({ fillColor: '#000' });
    if (!croppedCanvas || croppedCanvas.width < 12 || croppedCanvas.height < 12) {
      deps.setStatus('Select a larger crop area first.');
      return;
    }
    deps.setCurrentImage(deps.normalizeCurrentCanvasCrop(croppedCanvas, cropData, source));
    runtime.cropApplied = true;
    resetAfterCropMutation();
    leaveCropMode();
    deps.renderCanvas();
    deps.setStatus('');
  }

  // As in photo editors, Reset lives in crop mode: back to the full original
  // with no rotation. Nothing changes until Done.
  function onResetCrop() {
    if (!runtime.cropperActive || !runtime.cropperInstance) {
      return;
    }
    if (runtime.cropApplied && runtime.originalImage && runtime.cropSource !== runtime.originalImage) {
      enterCropMode(runtime.originalImage);
      return;
    }
    runtime.cropperInstance.reset?.();
    runtime.cropRotationDegrees = 0;
    syncAngleInput();
  }

  return {
    enterCropMode,
    leaveCropMode,
    onAngleInput,
    onApplyCrop,
    onCancelCrop,
    onCropModeAction,
    onResetCrop,
    onRotateQuarter,
    onRotationDragEnd,
    onRotationDragMove,
    onRotationDragStart,
    onStartCrop,
    setCropUiState
  };
}
