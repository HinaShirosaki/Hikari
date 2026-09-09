import { decodeImageFile, decodeImageSource, isTiffFile, normalizeDecodedImage } from './image-io.js';
import { normalizeEnhancementSettings, preprocessWithJs } from '../analysis/image-processing.js';
import { createEmptyManualOverrides } from '../shared.js';

export function createImageController({ runtime, elements, deps }) {
  function setCurrentImage(nextImage) {
    runtime.currentImage = nextImage;
    runtime.imageRevision += 1;
    runtime.preprocessedCache = null;
    if (runtime.enhancementRerunTimer) {
      window.clearTimeout(runtime.enhancementRerunTimer);
      runtime.enhancementRerunTimer = null;
    }
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

  function readEnhancementSettingsFromUi() {
    return normalizeEnhancementSettings({
      denoiseStrength: elements.gelDenoiseStrengthInput?.value,
      contrastBoost: elements.gelContrastStrengthInput?.value
    });
  }

  function renderEnhancementValues() {
    const enhancement = readEnhancementSettingsFromUi();
    if (elements.gelDenoiseStrengthInput) {
      elements.gelDenoiseStrengthInput.value = String(enhancement.denoiseStrength);
    }
    if (elements.gelContrastStrengthInput) {
      elements.gelContrastStrengthInput.value = String(enhancement.contrastBoost);
    }
    if (elements.gelDenoiseStrengthValue) {
      elements.gelDenoiseStrengthValue.textContent = `${enhancement.denoiseStrength}%`;
    }
    if (elements.gelContrastStrengthValue) {
      elements.gelContrastStrengthValue.textContent = `${enhancement.contrastBoost}%`;
    }
  }

  function getPreprocessedImageForCurrentSettings() {
    if (!runtime.currentImage) {
      return null;
    }
    const enhancement = readEnhancementSettingsFromUi();
    const cache = runtime.preprocessedCache;
    if (
      cache
      && cache.imageRevision === runtime.imageRevision
      && cache.enhancement?.denoiseStrength === enhancement.denoiseStrength
      && cache.enhancement?.contrastBoost === enhancement.contrastBoost
    ) {
      return cache.result;
    }

    const result = preprocessWithJs(
      runtime.currentImage.gray,
      runtime.currentImage.width,
      runtime.currentImage.height,
      enhancement
    );
    runtime.preprocessedCache = {
      imageRevision: runtime.imageRevision,
      enhancement,
      result
    };
    return result;
  }

  function onEnhancementChanged() {
    renderEnhancementValues();
    runtime.preprocessedCache = null;
    if (runtime.currentImage) {
      deps.renderCanvas();
    }
    if (runtime.currentReport) {
      if (runtime.enhancementRerunTimer) {
        window.clearTimeout(runtime.enhancementRerunTimer);
      }
      runtime.enhancementRerunTimer = window.setTimeout(() => {
        runtime.enhancementRerunTimer = null;
        deps.onRunAnalysis();
      }, 140);
    }
  }

  async function loadImageFile(file) {
    if (!file) {
      return;
    }

    deps.setStatus('Loading gel image...');
    try {
      setCurrentImage(await decodeImageFile(file));
      runtime.originalImage = copyNormalizedImage(runtime.currentImage);
      runtime.cropApplied = false;
      runtime.currentReport = null;
      runtime.manualOverrides = createEmptyManualOverrides();
      runtime.manualDividerConfirmed = false;
      runtime.selectedViewerTool = '';
      deps.leaveCropMode();
      deps.renderOverrideStatus();
      deps.renderCanvas();
      if (isTiffFile(file)) {
        deps.setStatus(
          `Loaded ${file.name} page ${runtime.currentImage.tiffPageIndex || 1}/${runtime.currentImage.tiffPageCount || 1} (${runtime.currentImage.width}x${runtime.currentImage.height}) via TIFF decoder.`
        );
      } else {
        deps.setStatus(`Loaded ${file.name} (${runtime.currentImage.width}x${runtime.currentImage.height}).`);
      }
    } catch (error) {
      setCurrentImage(null);
      runtime.originalImage = null;
      runtime.cropApplied = false;
      runtime.currentReport = null;
      runtime.manualOverrides = createEmptyManualOverrides();
      runtime.manualDividerConfirmed = false;
      runtime.selectedViewerTool = '';
      deps.leaveCropMode();
      deps.renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(error instanceof Error ? error.message : 'Failed to load image.');
    }
  }

  async function onImageFileChange(event) {
    const file = event?.target?.files?.[0];
    if (event?.target) {
      event.target.value = '';
    }
    await loadImageFile(file);
  }

  function normalizeCurrentCanvasCrop(croppedCanvas) {
    const context = croppedCanvas.getContext('2d', { willReadFrequently: true });
    const croppedData = context.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    return normalizeDecodedImage({
      name: runtime.currentImage.name,
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      imageData: croppedData,
      tiffPageIndex: runtime.currentImage.tiffPageIndex,
      tiffPageCount: runtime.currentImage.tiffPageCount
    });
  }

  return {
    copyNormalizedImage,
    decodeImageSource,
    getPreprocessedImageForCurrentSettings,
    imageDataToDataUrl,
    loadImageFile,
    normalizeCurrentCanvasCrop,
    onEnhancementChanged,
    onImageFileChange,
    readEnhancementSettingsFromUi,
    renderEnhancementValues,
    setCurrentImage
  };
}
