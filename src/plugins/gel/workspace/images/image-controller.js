import { createPresentation } from "../../i18n.mjs";
const i18nUi = createPresentation("gel");
import { cropGray, decodeImageFile, decodeImageSource, isTiffFile, normalizeDecodedImage } from './image-io.js';
import { normalizeEnhancementSettings } from '../analysis/image-processing.js';
import { createBackgroundPreprocessor } from '../analysis/background-processing.js';
import { createEmptyManualOverrides } from '../shared.js';

export function createImageController({ runtime, elements, deps }) {
  const processor = deps.processor || createBackgroundPreprocessor();
  let disposed = false;
  let generation = 0;
  let preparing = null;
  const stage = elements.gelViewerStage;
  const notice = stage?.ownerDocument?.createElement('div');
  if (notice) {
    notice.className = 'gel-processing-notice'; i18nUi.setText(notice, i18nUi.message("Processing…"));
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    notice.hidden = true; stage.append(notice);
  }
  function showProcessing(busy) {
    const visible = busy && runtime.viewerMode === 'processed';
    if (notice) notice.hidden = !visible;
    stage?.setAttribute('aria-busy', String(visible));
  }
  let previewFrame = null;
  function cancelPreview() {
    if (previewFrame !== null) window.cancelAnimationFrame(previewFrame);
    previewFrame = null;
  }
  function setCurrentImage(nextImage) {
    cancelPreview(); generation++; preparing = null; showProcessing(false);
    runtime.currentImage = nextImage;
    runtime.imageRevision += 1;
    runtime.preprocessedCache = null;
    if (runtime.enhancementRerunTimer) {
      window.clearTimeout(runtime.enhancementRerunTimer);
      runtime.enhancementRerunTimer = null;
    }
    if (nextImage) void prepareCurrentImage().catch(() => {});
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
      i18nUi.setText(elements.gelDenoiseStrengthValue, `${enhancement.denoiseStrength}%`);
    }
    if (elements.gelContrastStrengthValue) {
      i18nUi.setText(elements.gelContrastStrengthValue, `${enhancement.contrastBoost}%`);
    }
  }

  function isCurrent(image, enhancement, revision) {
    return !disposed && runtime.currentImage === image && runtime.imageRevision === revision
      && JSON.stringify(readEnhancementSettingsFromUi()) === JSON.stringify(enhancement);
  }
  function prepareCurrentImage() {
    if (!runtime.currentImage || disposed) return Promise.resolve(null);
    const image = runtime.currentImage, revision = runtime.imageRevision;
    const enhancement = readEnhancementSettingsFromUi();
    const key = JSON.stringify([generation, enhancement]);
    const cached = processor.peek(image.gray, image.width, image.height, enhancement);
    if (cached) {
      runtime.preprocessedCache = { imageRevision: revision, enhancement, result: cached };
      showProcessing(false); return Promise.resolve(cached);
    }
    showProcessing(true);
    if (preparing?.key === key) return preparing.promise;
    const task = { key };
    task.promise = processor.request(image.gray, image.width, image.height, enhancement).then(result => {
      if (!result || !isCurrent(image, enhancement, revision)) return null;
      runtime.preprocessedCache = { imageRevision: revision, enhancement, result };
      showProcessing(false);
      deps.renderCanvas();
      return result;
    }).catch(error => {
      if (isCurrent(image, enhancement, revision)) { showProcessing(false); deps.setStatus?.(error.message); }
      throw error;
    }).finally(() => { if (preparing === task) preparing = null; });
    preparing = task;
    return task.promise;
  }
  function getPreprocessedImageForCurrentSettings() {
    if (!runtime.currentImage) return null;
    const enhancement = readEnhancementSettingsFromUi(), image = runtime.currentImage;
    const result = processor.peek(image.gray, image.width, image.height, enhancement);
    if (result) { showProcessing(false); return result; }
    void prepareCurrentImage().catch(() => {});
    // Keep the last preview while a slider update runs. Analysis and export
    // await prepareCurrentImage and can never consume this display placeholder.
    return runtime.preprocessedCache?.imageRevision === runtime.imageRevision ? runtime.preprocessedCache.result : null;
  }

  function onEnhancementChanged() {
    renderEnhancementValues();
    if (runtime.currentImage && previewFrame === null) {
      // Multiple slider events before the next frame need only the final value.
      previewFrame = window.requestAnimationFrame(() => {
        previewFrame = null;
        deps.renderCanvas();
      });
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

    deps.setStatus(i18nUi.text("Loading gel image..."));
    try {
      setCurrentImage(await decodeImageFile(file));
      runtime.originalImage = copyNormalizedImage(runtime.currentImage);
      // The decoded image is downscaled and re-encoded on save; the File itself
      // is what gets written next to it, byte for byte.
      runtime.originalFile = file;
      runtime.cropApplied = false;
      runtime.currentReport = null;
      runtime.manualOverrides = createEmptyManualOverrides();
      runtime.selectedViewerTool = '';
      deps.leaveCropMode();
      deps.renderOverrideStatus();
      deps.renderCanvas();
      const pages = isTiffFile(file) ? runtime.currentImage.tiffPageCount || 1 : 1;
      // Only a multi-page TIFF needs saying which page was loaded.
      deps.setStatus(((pages > 1 ? i18nUi.text("Loaded page {p0} of {p1}.", { p0: runtime.currentImage.tiffPageIndex || 1, p1: pages }) : '')));
    } catch (error) {
      setCurrentImage(null);
      runtime.originalImage = null;
      runtime.originalFile = null;
      runtime.cropApplied = false;
      runtime.currentReport = null;
      runtime.manualOverrides = createEmptyManualOverrides();
      runtime.selectedViewerTool = '';
      deps.leaveCropMode();
      deps.renderOverrideStatus();
      deps.renderCanvas();
      deps.setStatus(((error instanceof Error ? error.message : i18nUi.text("Failed to load image."))));
    }
  }

  async function onImageFileChange(event) {
    const file = event?.target?.files?.[0];
    if (event?.target) {
      event.target.value = '';
    }
    await loadImageFile(file);
  }

  // The canvas crop is 8-bit; the grey image is cropped from the current float
  // one with the same geometry so a 16-bit TIFF keeps its precision.
  // source is the image the cropper showed: the current one, or the original after Reset.
  function normalizeCurrentCanvasCrop(croppedCanvas, cropData, source = runtime.currentImage) {
    const context = croppedCanvas.getContext('2d', { willReadFrequently: true });
    const croppedData = context.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    const { gray, width, height } = source;
    return normalizeDecodedImage({
      name: source.name,
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      imageData: croppedData,
      gray: cropGray(gray, width, height, cropData, croppedCanvas.width, croppedCanvas.height),
      grayBitDepth: source.grayBitDepth,
      tiffPageIndex: source.tiffPageIndex,
      tiffPageCount: source.tiffPageCount
    });
  }

  return {
    updateProcessingNotice: () => showProcessing(Boolean(preparing)),
    prepareCurrentImage,
    prepareImage: processor.request,
    peekProcessedImage: processor.peek,
    getProcessingStats: processor.getStats,
    destroy() { disposed = true; generation++; cancelPreview(); processor.destroy(); notice?.remove(); stage?.removeAttribute('aria-busy'); },
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
