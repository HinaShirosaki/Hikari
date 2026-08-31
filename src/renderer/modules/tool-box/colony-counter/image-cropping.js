import { escapeHtml } from '../common.js';
import { mergeFilesIntoInput } from '../../../lib/file-drop.js';
import { EMPTY_MASK, loadImageElementFromFile, loadImageElementFromSrc } from './canvas-utils.js';

// Image intake and the CropperJS session: load a plate photo, crop it, and
// restore the original. Owns the offscreen canvases holding source pixels.
function createColonyImageCropping({
  state,
  elements = {},
  canvases = {},
  resetViewport,
  renderPreviewCanvas,
  renderColonySummary,
  setColonyStatus,
  updateControlState
} = {}) {
  const colonyState = state;
  const {
    colonyImageInput,
    colonyCropMenu,
    colonyCropMenuBtn,
    colonyCropperImage,
    colonyCropperShell,
    colonySummary
  } = elements;
  const {
    colonySourceCanvas,
    colonySourceCtx,
    colonyOriginalCanvas,
    colonyOriginalCtx
  } = canvases;

  function closeColonyCropMenu() {
    if (colonyCropMenu) {
      colonyCropMenu.hidden = true;
    }
    colonyCropMenuBtn?.setAttribute('aria-expanded', 'false');
  }

  // Remove the cropper image source so the host element is fully reset.
  function clearCropperImage() {
    if (!colonyCropperImage) {
      return;
    }
    colonyCropperImage.removeAttribute('src');
  }

  // Tear down any active CropperJS instance and hide the crop UI.
  function destroyCropper() {
    if (colonyState.cropper) {
      colonyState.cropper.destroy();
      colonyState.cropper = null;
    }
    if (colonyCropperShell) {
      colonyCropperShell.hidden = true;
    }
    clearCropperImage();
    updateControlState();
  }

  // Remove all colony markers from the current image.
  function clearMarkers() {
    if (!colonyState.markers.length) {
      return;
    }
    colonyState.markers = [];
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('All colony markers cleared.');
    updateControlState();
  }

  // Clear markers, masks, and model run metadata when the loaded image or crop region changes.
  function clearMarkersForImageChange() {
    colonyState.markers = [];
    colonyState.mask = { ...EMPTY_MASK };
    colonyState.maskDraft = null;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    colonyState.lastCountSource = 'manual';
    colonyState.lastModelStats = null;
    renderColonySummary();
  }

  // Load a selected image file into both the original backing canvas and the editable source canvas.
  async function loadColonyImage(file) {
    if (!colonySourceCanvas || !colonySourceCtx || !colonyOriginalCtx) {
      return;
    }

    destroyCropper();
    const image = await loadImageElementFromFile(file);
    const width = Math.max(1, image.naturalWidth || image.width || 1);
    const height = Math.max(1, image.naturalHeight || image.height || 1);

    colonyOriginalCanvas.width = width;
    colonyOriginalCanvas.height = height;
    colonyOriginalCtx.clearRect(0, 0, width, height);
    colonyOriginalCtx.drawImage(image, 0, 0, width, height);

    colonySourceCanvas.width = width;
    colonySourceCanvas.height = height;
    colonySourceCtx.clearRect(0, 0, width, height);
    colonySourceCtx.drawImage(colonyOriginalCanvas, 0, 0, width, height);

    colonyState.imageName = file?.name || 'uploaded-image';
    colonyState.sourceWidth = width;
    colonyState.sourceHeight = height;
    colonyState.hasImage = true;

    clearMarkersForImageChange();
    resetViewport();
    renderPreviewCanvas();
    setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height}). Run auto count or click colonies to adjust.`);
    updateControlState();
  }

  // Load an image from either the picker or a drop gesture through the same pipeline.
  async function handleColonyImageFile(file, { syncFileInput = false } = {}) {
    if (!file) {
      return;
    }

    setColonyStatus('Loading image...');
    try {
      await loadColonyImage(file);
      if (syncFileInput) {
        mergeFilesIntoInput(colonyImageInput, [file], { append: false });
      }
    } catch (error) {
      const message = error?.message || 'Image load failed.';
      setColonyStatus(message, true);
      if (colonySummary) {
        colonySummary.innerHTML = `<p class="small-note">${escapeHtml(message)}</p>`;
      }
    }
  }

  // Enter crop mode by copying the current source canvas into the CropperJS host image.
  async function startCropMode() {
    if (!colonyState.hasImage || !colonySourceCanvas) {
      setColonyStatus('Load an image before cropping.', true);
      return;
    }

    if (typeof window.Cropper !== 'function') {
      setColonyStatus('CropperJS is unavailable. Ensure ./vendor/cropperjs/cropper.min.js is loaded.', true);
      return;
    }

    if (!colonyCropperImage || !colonyCropperShell) {
      setColonyStatus('Cropper host is unavailable in the UI.', true);
      return;
    }

    destroyCropper();
    colonyCropperShell.hidden = false;
    await loadImageElementFromSrc(colonyCropperImage, colonySourceCanvas.toDataURL('image/png'));
    colonyState.cropper = new window.Cropper(colonyCropperImage, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      responsive: true,
      background: false,
      checkCrossOrigin: false
    });
    setColonyStatus('Crop mode active. Apply crop to continue counting.');
    updateControlState();
  }

  // Replace the current source image with the cropper's selected region.
  function applyCrop() {
    if (!colonyState.cropper || !colonySourceCanvas || !colonySourceCtx) {
      return;
    }

    const croppedCanvas = colonyState.cropper.getCroppedCanvas({
      fillColor: '#ffffff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!croppedCanvas || !croppedCanvas.width || !croppedCanvas.height) {
      setColonyStatus('Crop failed. Try selecting a larger area.', true);
      return;
    }

    colonySourceCanvas.width = croppedCanvas.width;
    colonySourceCanvas.height = croppedCanvas.height;
    colonySourceCtx.clearRect(0, 0, croppedCanvas.width, croppedCanvas.height);
    colonySourceCtx.drawImage(croppedCanvas, 0, 0);

    colonyState.sourceWidth = croppedCanvas.width;
    colonyState.sourceHeight = croppedCanvas.height;

    clearMarkersForImageChange();
    resetViewport();
    destroyCropper();
    renderPreviewCanvas();
    setColonyStatus(`Crop applied (${croppedCanvas.width}x${croppedCanvas.height}). Run auto count or click colonies to recount.`);
    updateControlState();
  }

  // Restore the uncropped original image back into the active source canvas.
  function resetToOriginalImage() {
    if (!colonyState.hasImage || !colonyOriginalCanvas || !colonySourceCanvas || !colonySourceCtx) {
      return;
    }

    const width = colonyOriginalCanvas.width || 0;
    const height = colonyOriginalCanvas.height || 0;
    if (!width || !height) {
      return;
    }

    destroyCropper();
    colonySourceCanvas.width = width;
    colonySourceCanvas.height = height;
    colonySourceCtx.clearRect(0, 0, width, height);
    colonySourceCtx.drawImage(colonyOriginalCanvas, 0, 0);

    colonyState.sourceWidth = width;
    colonyState.sourceHeight = height;

    clearMarkersForImageChange();
    resetViewport();
    renderPreviewCanvas();
    setColonyStatus(`Restored full image (${width}x${height}). Run auto count or click colonies to count.`);
    updateControlState();
  }

  return {
    closeColonyCropMenu,
    clearCropperImage,
    destroyCropper,
    clearMarkers,
    clearMarkersForImageChange,
    loadColonyImage,
    handleColonyImageFile,
    startCropMode,
    applyCrop,
    resetToOriginalImage
  };
}

export { createColonyImageCropping };
