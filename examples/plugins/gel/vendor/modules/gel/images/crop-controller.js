import { createEmptyManualOverrides } from '../shared.js';

const MIN_ROTATION_DEGREES = -180;
const MAX_ROTATION_DEGREES = 180;
const ROTATION_DRAG_DEGREES_PER_PIXEL = 0.25;
const CROP_BORDER_SELECTOR = '.cropper-line, .cropper-point';

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

  function showCropperForCurrentImage() {
    if (!runtime.currentImage || !elements.gelCropperImage || !window.Cropper) {
      return false;
    }
    destroyCropper();
    runtime.cropDisplaySize = captureCurrentGelDisplaySize();
    elements.gelCropperImage.src = deps.imageDataToDataUrl(runtime.currentImage.imageData);
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
      viewMode: 1,
      autoCropArea: 1,
      responsive: true,
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: true,
      minContainerWidth: runtime.cropDisplaySize?.width || 200,
      minContainerHeight: runtime.cropDisplaySize?.height || 200
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
    }
    if (elements.gelApplyCropBtn) {
      elements.gelApplyCropBtn.disabled = !isCropping;
      elements.gelApplyCropBtn.hidden = !isCropping;
    }
    if (elements.gelResetCropBtn) {
      elements.gelResetCropBtn.disabled = !runtime.originalImage;
    }
  }

  function setRotationDegrees(degrees, { announce = true } = {}) {
    if (!runtime.cropperActive || !runtime.cropperInstance) {
      if (announce) {
        deps.setStatus('Start crop mode first to rotate.');
      }
      return false;
    }
    const current = normalizeRotationDegrees(runtime.cropRotationDegrees);
    const next = normalizeRotationDegrees(degrees);
    if (typeof runtime.cropperInstance.rotateTo === 'function') {
      runtime.cropperInstance.rotateTo(next);
    } else if (typeof runtime.cropperInstance.rotate === 'function') {
      runtime.cropperInstance.rotate(next - current);
    } else {
      if (announce) {
        deps.setStatus('Cropper rotation is unavailable.');
      }
      return false;
    }
    runtime.cropRotationDegrees = next;
    if (announce) {
      deps.setStatus(`Rotated to ${formatRotationDegrees(next)} deg. Adjust selection then Apply Crop.`);
    }
    return true;
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
      moved: false,
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
    if (Math.abs(deltaX) >= 1) {
      drag.moved = true;
    }
    setRotationDegrees(
      drag.startDegrees + (deltaX * ROTATION_DRAG_DEGREES_PER_PIXEL),
      { announce: false }
    );
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function onRotationDragEnd(event) {
    const drag = runtime.cropRotationDrag;
    if (!drag || (Number.isFinite(drag.pointerId) && event?.pointerId !== drag.pointerId)) {
      return;
    }
    const moved = drag.moved;
    clearRotationDrag();
    if (moved) {
      deps.setStatus(`Rotated to ${formatRotationDegrees(runtime.cropRotationDegrees)} deg. Adjust selection then Apply Crop.`);
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  function leaveCropMode() {
    destroyCropper();
    setCropUiState();
  }

  function enterCropMode() {
    if (!window.Cropper) {
      deps.setStatus('Cropper.js is not loaded.');
      return false;
    }
    const started = showCropperForCurrentImage();
    setCropUiState();
    return started;
  }

  function resetAfterCropMutation() {
    runtime.currentReport = null;
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.manualDividerConfirmed = false;
    runtime.selectedViewerTool = '';
    deps.renderOverrideStatus();
    deps.renderReport();
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
    deps.setStatus('Crop mode: drag away from the crop border to rotate, drag the border to resize, then click Apply Crop.');
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
    deps.setStatus('Crop cancelled.');
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
    const croppedCanvas = runtime.cropperInstance.getCroppedCanvas({
      minWidth: 12,
      minHeight: 12,
      fillColor: '#000'
    });
    if (!croppedCanvas || croppedCanvas.width < 12 || croppedCanvas.height < 12) {
      deps.setStatus('Select a larger crop area first.');
      return;
    }
    deps.setCurrentImage(deps.normalizeCurrentCanvasCrop(croppedCanvas));
    runtime.cropApplied = true;
    resetAfterCropMutation();
    leaveCropMode();
    deps.renderCanvas();
    deps.setStatus(`Crop applied: ${runtime.currentImage.width}x${runtime.currentImage.height}. Ready to analyze.`);
  }

  function onResetCrop() {
    if (!runtime.originalImage) {
      deps.setStatus('No original image available to reset.');
      return;
    }
    deps.setCurrentImage(deps.copyNormalizedImage(runtime.originalImage));
    runtime.cropApplied = false;
    resetAfterCropMutation();
    leaveCropMode();
    deps.renderCanvas();
    deps.setStatus('Restored full image. Crop the gel before analysis.');
  }

  return {
    enterCropMode,
    leaveCropMode,
    onApplyCrop,
    onCancelCrop,
    onCropModeAction,
    onResetCrop,
    onRotationDragEnd,
    onRotationDragMove,
    onRotationDragStart,
    onStartCrop,
    setCropUiState
  };
}
