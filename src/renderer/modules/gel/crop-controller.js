import { createEmptyManualOverrides } from './shared.js';

const MIN_ROTATION_DEGREES = -180;
const MAX_ROTATION_DEGREES = 180;

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
  function renderRotationUi() {
    const value = formatRotationDegrees(runtime.cropRotationDegrees);
    if (elements.gelRotateAngleRange) {
      elements.gelRotateAngleRange.value = value;
    }
    if (elements.gelRotateAngleInput) {
      elements.gelRotateAngleInput.value = value;
    }
  }

  function destroyCropper() {
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
    renderRotationUi();
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
    renderRotationUi();
    return true;
  }

  function setCropUiState() {
    const isCropping = Boolean(runtime.cropperActive && runtime.cropperInstance);
    if (elements.gelStartCropBtn) {
      elements.gelStartCropBtn.disabled = !runtime.currentImage && !isCropping;
      elements.gelStartCropBtn.textContent = isCropping ? 'Apply Crop' : 'Start Crop';
      elements.gelStartCropBtn.classList.toggle('is-active', isCropping);
      elements.gelStartCropBtn.setAttribute('aria-pressed', isCropping ? 'true' : 'false');
    }
    if (elements.gelCancelCropBtn) {
      elements.gelCancelCropBtn.disabled = !isCropping;
    }
    if (elements.gelResetCropBtn) {
      elements.gelResetCropBtn.disabled = !runtime.originalImage;
    }
    if (elements.gelRotateAngleRange) {
      elements.gelRotateAngleRange.disabled = !isCropping;
    }
    if (elements.gelRotateAngleInput) {
      elements.gelRotateAngleInput.disabled = !isCropping;
    }
    if (elements.gelResetRotationBtn) {
      elements.gelResetRotationBtn.disabled = !isCropping || normalizeRotationDegrees(runtime.cropRotationDegrees) === 0;
    }
    renderRotationUi();
  }

  function setRotationDegrees(degrees) {
    if (!runtime.cropperActive || !runtime.cropperInstance) {
      deps.setStatus('Start crop mode first to rotate.');
      return;
    }
    const current = normalizeRotationDegrees(runtime.cropRotationDegrees);
    const next = normalizeRotationDegrees(degrees);
    if (typeof runtime.cropperInstance.rotateTo === 'function') {
      runtime.cropperInstance.rotateTo(next);
    } else if (typeof runtime.cropperInstance.rotate === 'function') {
      runtime.cropperInstance.rotate(next - current);
    } else {
      deps.setStatus('Cropper rotation is unavailable.');
      return;
    }
    runtime.cropRotationDegrees = next;
    renderRotationUi();
    setCropUiState();
    deps.setStatus(`Rotated to ${formatRotationDegrees(next)} deg. Adjust selection then Apply Crop.`);
  }

  function onRotationAngleInput(event) {
    setRotationDegrees(event?.target?.value);
  }

  function onResetRotation() {
    setRotationDegrees(0);
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
    deps.setStatus('Crop mode: adjust selection with Cropper.js, then click Apply Crop.');
  }

  function onCropAction() {
    if (runtime.cropperActive && runtime.cropperInstance) {
      onApplyCrop();
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
    onCropAction,
    onResetCrop,
    onResetRotation,
    onRotationAngleInput,
    onStartCrop,
    setCropUiState
  };
}
