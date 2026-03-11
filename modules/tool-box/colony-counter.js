import {
  clampNumber,
  escapeHtml,
  toNumber
} from './common.js';

const OPENCV_LOCAL_URL = './vendor/opencv/opencv.js';
const OPENCV_SCRIPT_SELECTOR = 'script[data-opencv-loader="true"]';
let openCvLoadPromise = null;

function isOpenCvApiReady() {
  const cvRef = window.cv;
  return Boolean(cvRef && typeof cvRef.Mat === 'function' && typeof cvRef.imread === 'function');
}

function ensureOpenCvReady(timeoutMs = 30000) {
  if (isOpenCvApiReady()) {
    return Promise.resolve(window.cv);
  }

  if (openCvLoadPromise) {
    return openCvLoadPromise;
  }

  openCvLoadPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let pollId = null;
    let runtimeAttached = false;

    function done(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (pollId) {
        clearTimeout(pollId);
      }
      if (error) {
        openCvLoadPromise = null;
        reject(error);
        return;
      }
      resolve(result);
    }

    function resolveIfReady() {
      if (isOpenCvApiReady()) {
        done(null, window.cv);
        return true;
      }
      return false;
    }

    function attachRuntimeHandler() {
      if (runtimeAttached) {
        return true;
      }
      const cvRef = window.cv;
      if (!cvRef) {
        return false;
      }
      runtimeAttached = true;

      if (typeof cvRef.then === 'function') {
        cvRef
          .then((resolvedCv) => {
            if (resolvedCv) {
              window.cv = resolvedCv;
            }
            if (!resolveIfReady()) {
              done(new Error('OpenCV loaded, but runtime API is unavailable.'));
            }
          })
          .catch((error) => {
            done(new Error(error?.message || 'Failed to initialize OpenCV runtime.'));
          });
        return true;
      }

      if (resolveIfReady()) {
        return true;
      }

      const previous = cvRef.onRuntimeInitialized;
      cvRef.onRuntimeInitialized = () => {
        try {
          if (typeof previous === 'function') {
            previous();
          }
        } catch {
          // Ignore errors from chained handlers.
        }

        if (!resolveIfReady()) {
          done(new Error('OpenCV runtime initialized, but API is unavailable.'));
        }
      };
      return true;
    }

    function pollForRuntime() {
      if (resolveIfReady()) {
        return;
      }
      attachRuntimeHandler();
      pollId = setTimeout(pollForRuntime, 120);
    }

    timeoutId = setTimeout(() => {
      done(new Error('Timed out while loading OpenCV.'));
    }, Math.max(1000, timeoutMs));

    let script = document.querySelector(OPENCV_SCRIPT_SELECTOR);
    if (script?.dataset.opencvLoadState === 'error') {
      script.remove();
      script = null;
    }

    if (!script) {
      const script = document.createElement('script');
      script.src = OPENCV_LOCAL_URL;
      script.async = true;
      script.defer = true;
      script.dataset.opencvLoader = 'true';
      script.dataset.opencvLoadState = 'loading';
      script.addEventListener('error', () => {
        script.dataset.opencvLoadState = 'error';
        done(new Error('Failed to load local OpenCV script.'));
      });
      script.addEventListener('load', () => {
        script.dataset.opencvLoadState = 'loaded';
        attachRuntimeHandler();
        resolveIfReady();
      });
      document.body.appendChild(script);
    } else {
      script.addEventListener('error', () => {
        script.dataset.opencvLoadState = 'error';
        done(new Error('Failed to load local OpenCV script.'));
      }, { once: true });
      script.addEventListener('load', () => {
        script.dataset.opencvLoadState = 'loaded';
        attachRuntimeHandler();
        resolveIfReady();
      }, { once: true });
    }

    attachRuntimeHandler();
    pollForRuntime();
  });

  return openCvLoadPromise;
}

export function initColonyCounterTool() {
  const colonyCounterForm = document.getElementById('colony-counter-form');
  if (!colonyCounterForm) {
    return;
  }

  const colonyImageInput = document.getElementById('colony-image-file');
  const colonyThresholdModeSelect = document.getElementById('colony-threshold-mode');
  const colonyThresholdValueInput = document.getElementById('colony-threshold-value');
  const colonyDarkObjectsToggle = document.getElementById('colony-dark-objects');
  const colonyBlurSigmaInput = document.getElementById('colony-blur-sigma');
  const colonyKernelSizeInput = document.getElementById('colony-kernel-size');
  const colonyMinAreaInput = document.getElementById('colony-min-area');
  const colonyMaxAreaInput = document.getElementById('colony-max-area');
  const colonyMinCircularityInput = document.getElementById('colony-min-circularity');
  const colonyMaxSizeInput = document.getElementById('colony-max-size');
  const colonyRunBtn = document.getElementById('colony-run-btn');
  const colonyResetBtn = document.getElementById('colony-reset-btn');
  const colonyStartCropBtn = document.getElementById('colony-start-crop-btn');
  const colonyApplyCropBtn = document.getElementById('colony-apply-crop-btn');
  const colonyCancelCropBtn = document.getElementById('colony-cancel-crop-btn');
  const colonyResetCropBtn = document.getElementById('colony-reset-crop-btn');
  const colonyStatus = document.getElementById('colony-status');
  const colonySummary = document.getElementById('colony-summary');
  const colonyPreviewCanvas = document.getElementById('colony-preview-canvas');
  const colonyMaskCanvas = document.getElementById('colony-mask-canvas');
  const colonyCropperShell = document.getElementById('colony-cropper-shell');
  const colonyCropperImage = document.getElementById('colony-cropper-image');
  const colonySourceCanvas = document.getElementById('colony-source-canvas');
  const colonySourceCtx = colonySourceCanvas?.getContext('2d', { willReadFrequently: true }) || null;
  const colonyOriginalCanvas = document.createElement('canvas');
  const colonyOriginalCtx = colonyOriginalCanvas.getContext('2d', { willReadFrequently: true });
  const colonyWorkingCanvas = document.createElement('canvas');
  const colonyWorkingCtx = colonyWorkingCanvas.getContext('2d', { willReadFrequently: true });

  const colonyState = {
    imageName: '',
    sourceWidth: 0,
    sourceHeight: 0,
    hasImage: false,
    cropper: null
  };

  function setColonyStatus(message, isError = false) {
    if (!colonyStatus) {
      return;
    }
    colonyStatus.textContent = message;
    colonyStatus.style.color = isError ? 'var(--danger)' : '';
  }

  function isCropModeActive() {
    return Boolean(colonyState.cropper);
  }

  function updateCropControlState() {
    const hasImage = colonyState.hasImage;
    const cropActive = isCropModeActive();
    if (colonyStartCropBtn) {
      colonyStartCropBtn.disabled = !hasImage || cropActive;
    }
    if (colonyApplyCropBtn) {
      colonyApplyCropBtn.disabled = !cropActive;
    }
    if (colonyCancelCropBtn) {
      colonyCancelCropBtn.disabled = !cropActive;
    }
    if (colonyResetCropBtn) {
      colonyResetCropBtn.disabled = !hasImage || cropActive;
    }
    if (colonyRunBtn) {
      colonyRunBtn.disabled = !hasImage || cropActive;
    }
  }

  function clearCropperImage() {
    if (!colonyCropperImage) {
      return;
    }
    colonyCropperImage.removeAttribute('src');
  }

  function destroyCropper() {
    if (colonyState.cropper) {
      colonyState.cropper.destroy();
      colonyState.cropper = null;
    }
    if (colonyCropperShell) {
      colonyCropperShell.hidden = true;
    }
    clearCropperImage();
    updateCropControlState();
  }

  function loadImageElementFromSrc(imgElement, src) {
    return new Promise((resolve, reject) => {
      if (!imgElement) {
        reject(new Error('Cropper image host is unavailable.'));
        return;
      }
      imgElement.onload = () => resolve();
      imgElement.onerror = () => reject(new Error('Failed to prepare image for cropper.'));
      imgElement.src = src;
    });
  }

  function setCanvasFromSource(targetCanvas, sourceCanvas, maxDimension = 0) {
    if (!targetCanvas || !sourceCanvas) {
      return { width: 0, height: 0, scale: 1 };
    }

    const sourceWidth = sourceCanvas.width || 0;
    const sourceHeight = sourceCanvas.height || 0;
    if (!sourceWidth || !sourceHeight) {
      targetCanvas.width = 0;
      targetCanvas.height = 0;
      return { width: 0, height: 0, scale: 1 };
    }

    const maxSide = Math.max(1, Number(maxDimension) || 0);
    const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight)) : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    targetCanvas.width = width;
    targetCanvas.height = height;
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
    }

    return { width, height, scale };
  }

  function clearCanvas(canvas) {
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function resetColonySummary() {
    if (!colonySummary) {
      return;
    }
    colonySummary.innerHTML = '<p class="small-note">Load a plate image and run counting.</p>';
  }

  function syncColonyThresholdMode() {
    if (!colonyThresholdModeSelect || !colonyThresholdValueInput) {
      return;
    }
    const manualMode = colonyThresholdModeSelect.value === 'manual';
    colonyThresholdValueInput.disabled = !manualMode;
  }

  function normalizeOddKernelSize(value) {
    const parsed = Math.max(0, Math.round(Number(value) || 0));
    if (parsed <= 1) {
      return parsed;
    }
    return parsed % 2 === 0 ? parsed + 1 : parsed;
  }

  function getColonySettings() {
    const thresholdMode = colonyThresholdModeSelect?.value === 'manual' ? 'manual' : 'otsu';
    const manualThreshold = Math.round(clampNumber(colonyThresholdValueInput?.value, 0, 255, 135));
    const blurSigma = clampNumber(colonyBlurSigmaInput?.value, 0, 12, 1.2);
    const kernelSize = normalizeOddKernelSize(colonyKernelSizeInput?.value);
    const minArea = Math.max(1, Math.round(toNumber(colonyMinAreaInput?.value || 30)));
    const maxAreaRaw = Math.max(minArea, Math.round(toNumber(colonyMaxAreaInput?.value || 10000)));
    const minCircularity = clampNumber(colonyMinCircularityInput?.value, 0, 1, 0.35);
    const maxProcessSize = Math.round(clampNumber(colonyMaxSizeInput?.value, 300, 4000, 1400));
    const darkObjects = Boolean(colonyDarkObjectsToggle?.checked);

    return {
      thresholdMode,
      manualThreshold,
      blurSigma,
      kernelSize,
      minArea,
      maxArea: maxAreaRaw,
      minCircularity,
      maxProcessSize,
      darkObjects
    };
  }

  function loadImageElementFromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No image file selected.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load selected image.'));
      };
      image.src = url;
    });
  }

  async function loadColonyImage(file) {
    if (!colonySourceCanvas || !colonySourceCtx || !colonyPreviewCanvas || !colonyOriginalCtx) {
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

    const settings = getColonySettings();
    setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);
    clearCanvas(colonyMaskCanvas);
    resetColonySummary();
    setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height})`);
    updateCropControlState();
  }

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
    setColonyStatus('Crop mode active. Adjust region and click Apply Crop.');
    updateCropControlState();
  }

  function applyCrop() {
    if (!colonyState.cropper || !colonySourceCanvas || !colonySourceCtx || !colonyPreviewCanvas) {
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

    const settings = getColonySettings();
    setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);
    clearCanvas(colonyMaskCanvas);
    resetColonySummary();
    destroyCropper();
    setColonyStatus(`Crop applied (${croppedCanvas.width}x${croppedCanvas.height}). Re-run counting.`);
    updateCropControlState();
  }

  function resetToOriginalImage() {
    if (!colonyState.hasImage || !colonyOriginalCanvas || !colonyOriginalCtx || !colonySourceCanvas || !colonySourceCtx || !colonyPreviewCanvas) {
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

    const settings = getColonySettings();
    setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);
    clearCanvas(colonyMaskCanvas);
    resetColonySummary();
    setColonyStatus(`Restored full image (${width}x${height}).`);
    updateCropControlState();
  }

  function prewarmOpenCvRuntime() {
    if (!colonyState.hasImage) {
      setColonyStatus('Preparing OpenCV runtime...');
    }
    ensureOpenCvReady(45000)
      .then(() => {
        if (!colonyState.hasImage && !isCropModeActive()) {
          setColonyStatus('OpenCV ready. Load an image to begin.');
        }
      })
      .catch((error) => {
        if (!colonyState.hasImage) {
          setColonyStatus(`OpenCV preload failed: ${error.message || error}`, true);
        }
      });
  }

  async function renderColonyCounting() {
    if (!colonyState.hasImage || !colonySourceCanvas || !colonyPreviewCanvas || !colonyMaskCanvas || !colonyWorkingCanvas || !colonyWorkingCtx) {
      setColonyStatus('Choose an image before running colony counting.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before counting.', true);
      return;
    }

    const settings = getColonySettings();
    const { width: workWidth, height: workHeight, scale } = setCanvasFromSource(
      colonyWorkingCanvas,
      colonySourceCanvas,
      settings.maxProcessSize
    );

    if (!workWidth || !workHeight) {
      setColonyStatus('Image is empty after resize. Try another file.', true);
      return;
    }

    colonyRunBtn?.setAttribute('disabled', 'true');
    setColonyStatus('Loading OpenCV runtime...');

    let src = null;
    let gray = null;
    let smoothed = null;
    let mask = null;
    let kernel = null;
    let contours = null;
    let hierarchy = null;
    let annotated = null;

    try {
      const cvRef = await ensureOpenCvReady();
      setColonyStatus('Detecting colonies...');

      src = cvRef.imread(colonyWorkingCanvas);
      gray = new cvRef.Mat();
      cvRef.cvtColor(src, gray, cvRef.COLOR_RGBA2GRAY);

      smoothed = new cvRef.Mat();
      if (settings.blurSigma > 0) {
        cvRef.GaussianBlur(
          gray,
          smoothed,
          new cvRef.Size(0, 0),
          settings.blurSigma,
          settings.blurSigma,
          cvRef.BORDER_DEFAULT
        );
      } else {
        gray.copyTo(smoothed);
      }

      mask = new cvRef.Mat();
      const thresholdTypeBase = settings.darkObjects ? cvRef.THRESH_BINARY_INV : cvRef.THRESH_BINARY;
      const thresholdType = settings.thresholdMode === 'manual'
        ? thresholdTypeBase
        : (thresholdTypeBase | cvRef.THRESH_OTSU);
      const thresholdValue = settings.thresholdMode === 'manual' ? settings.manualThreshold : 0;
      const usedThreshold = cvRef.threshold(smoothed, mask, thresholdValue, 255, thresholdType);

      if (settings.kernelSize > 1) {
        kernel = cvRef.getStructuringElement(
          cvRef.MORPH_ELLIPSE,
          new cvRef.Size(settings.kernelSize, settings.kernelSize)
        );
        cvRef.morphologyEx(mask, mask, cvRef.MORPH_OPEN, kernel);
        cvRef.morphologyEx(mask, mask, cvRef.MORPH_CLOSE, kernel);
      }

      contours = new cvRef.MatVector();
      hierarchy = new cvRef.Mat();
      cvRef.findContours(mask, contours, hierarchy, cvRef.RETR_EXTERNAL, cvRef.CHAIN_APPROX_SIMPLE);

      annotated = src.clone();

      const colonyRows = [];
      let totalArea = 0;

      for (let contourIndex = 0; contourIndex < contours.size(); contourIndex += 1) {
        const contour = contours.get(contourIndex);
        try {
          const area = cvRef.contourArea(contour, false);
          if (!Number.isFinite(area) || area < settings.minArea || area > settings.maxArea) {
            continue;
          }

          const perimeter = cvRef.arcLength(contour, true);
          const circularity = perimeter > 0
            ? (4 * Math.PI * area) / (perimeter * perimeter)
            : 0;
          if (circularity < settings.minCircularity) {
            continue;
          }

          const moments = cvRef.moments(contour);
          const centerX = moments.m00 !== 0 ? Math.round(moments.m10 / moments.m00) : 0;
          const centerY = moments.m00 !== 0 ? Math.round(moments.m01 / moments.m00) : 0;

          totalArea += area;
          colonyRows.push({
            contourIndex,
            area,
            circularity,
            centerX,
            centerY
          });
        } finally {
          contour.delete();
        }
      }

      colonyRows.forEach((row, displayIndex) => {
        cvRef.drawContours(
          annotated,
          contours,
          row.contourIndex,
          new cvRef.Scalar(70, 220, 80, 255),
          2,
          cvRef.LINE_8,
          hierarchy,
          0
        );
        cvRef.putText(
          annotated,
          String(displayIndex + 1),
          new cvRef.Point(Math.max(0, row.centerX + 4), Math.max(12, row.centerY - 4)),
          cvRef.FONT_HERSHEY_SIMPLEX,
          0.42,
          new cvRef.Scalar(255, 120, 120, 255),
          1,
          cvRef.LINE_AA
        );
      });

      cvRef.imshow(colonyPreviewCanvas, annotated);
      cvRef.imshow(colonyMaskCanvas, mask);

      const colonyCount = colonyRows.length;
      const imageArea = workWidth * workHeight;
      const coveragePct = imageArea > 0 ? (totalArea / imageArea) * 100 : 0;
      const meanArea = colonyCount > 0 ? (totalArea / colonyCount) : 0;
      const scaleLabel = scale < 0.999 ? ` (scaled ${Math.round(scale * 100)}%)` : '';

      if (colonySummary) {
        colonySummary.innerHTML = `
          <p><strong>Colonies detected:</strong> ${colonyCount}</p>
          <p><strong>Mean colony area:</strong> ${meanArea.toFixed(1)} px^2</p>
          <p><strong>Total colony area:</strong> ${totalArea.toFixed(1)} px^2</p>
          <p><strong>Coverage:</strong> ${coveragePct.toFixed(2)}%</p>
          <p><strong>Contours found:</strong> ${contours.size()}</p>
          <p><strong>Threshold used:</strong> ${usedThreshold.toFixed(1)} (${settings.thresholdMode})</p>
          <p class="small-note">Processed image: ${workWidth}x${workHeight}${scaleLabel}</p>
        `;
      }

      setColonyStatus(`Completed: ${colonyCount} colonies detected.`);
    } catch (error) {
      setColonyStatus(error.message || 'Failed to count colonies.', true);
      if (colonySummary) {
        colonySummary.innerHTML = `<p class="small-note">${escapeHtml(error.message || 'Colony counting failed.')}</p>`;
      }
    } finally {
      updateCropControlState();
      if (annotated) {
        annotated.delete();
      }
      if (hierarchy) {
        hierarchy.delete();
      }
      if (contours) {
        contours.delete();
      }
      if (kernel) {
        kernel.delete();
      }
      if (mask) {
        mask.delete();
      }
      if (smoothed) {
        smoothed.delete();
      }
      if (gray) {
        gray.delete();
      }
      if (src) {
        src.delete();
      }
    }
  }

  function resetColonyCounter() {
    destroyCropper();
    colonyState.imageName = '';
    colonyState.sourceWidth = 0;
    colonyState.sourceHeight = 0;
    colonyState.hasImage = false;
    if (colonyImageInput) {
      colonyImageInput.value = '';
    }
    if (colonyOriginalCtx) {
      colonyOriginalCtx.clearRect(0, 0, colonyOriginalCanvas.width, colonyOriginalCanvas.height);
    }
    colonyOriginalCanvas.width = 0;
    colonyOriginalCanvas.height = 0;
    if (colonySourceCtx && colonySourceCanvas) {
      colonySourceCtx.clearRect(0, 0, colonySourceCanvas.width, colonySourceCanvas.height);
      colonySourceCanvas.width = 0;
      colonySourceCanvas.height = 0;
    }
    clearCanvas(colonyPreviewCanvas);
    clearCanvas(colonyMaskCanvas);
    resetColonySummary();
    setColonyStatus('Load an image to begin.');
    updateCropControlState();
  }

  syncColonyThresholdMode();
  resetColonySummary();
  setColonyStatus('Load an image to begin.');
  updateCropControlState();
  prewarmOpenCvRuntime();

  colonyThresholdModeSelect?.addEventListener('change', () => {
    syncColonyThresholdMode();
  });

  colonyImageInput?.addEventListener('change', async () => {
    const file = colonyImageInput.files?.[0];
    if (!file) {
      return;
    }
    setColonyStatus('Loading image...');
    try {
      await loadColonyImage(file);
    } catch (error) {
      setColonyStatus(error.message || 'Failed to load image.', true);
    }
  });

  colonyStartCropBtn?.addEventListener('click', async () => {
    try {
      await startCropMode();
    } catch (error) {
      setColonyStatus(error.message || 'Failed to start crop mode.', true);
      destroyCropper();
    }
  });

  colonyApplyCropBtn?.addEventListener('click', () => {
    applyCrop();
  });

  colonyCancelCropBtn?.addEventListener('click', () => {
    destroyCropper();
    setColonyStatus('Crop cancelled.');
  });

  colonyResetCropBtn?.addEventListener('click', () => {
    resetToOriginalImage();
  });

  colonyCounterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await renderColonyCounting();
  });

  colonyResetBtn?.addEventListener('click', () => {
    resetColonyCounter();
  });
}
