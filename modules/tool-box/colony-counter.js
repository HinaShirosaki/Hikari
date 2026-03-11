import {
  clampNumber,
  escapeHtml,
  toNumber
} from './common.js';

const OPENCV_ASSET_BASE_URL = './vendor/opencv/';
const OPENCV_LOCAL_URL = `${OPENCV_ASSET_BASE_URL}opencv.js`;
const OPENCV_WASM_LOCAL_URL = `${OPENCV_ASSET_BASE_URL}opencv.wasm`;
const OPENCV_SCRIPT_SELECTOR = 'script[data-opencv-loader="true"]';
let openCvLoadPromise = null;
const OPEN_CV_PROGRESS_STATES = {
  idle: 'idle',
  loadingScript: 'loading-script',
  scriptLoaded: 'script-loaded',
  initializing: 'initializing',
  ready: 'ready',
  error: 'error'
};
const openCvProgressListeners = new Set();
let openCvProgressState = {
  phase: OPEN_CV_PROGRESS_STATES.idle,
  progress: 0,
  message: '',
  elapsedMs: 0,
  timeoutMs: 0
};

function isOpenCvApiReady() {
  const cvRef = window.cv;
  return Boolean(cvRef && typeof cvRef.Mat === 'function' && typeof cvRef.imread === 'function');
}

function resolveOpenCvAssetUrl(path) {
  const normalizedPath = String(path || '').replace(/^\.\//, '');
  let relativePath = OPENCV_ASSET_BASE_URL;
  if (!normalizedPath) {
    relativePath = OPENCV_ASSET_BASE_URL;
  } else if (normalizedPath.endsWith('.wasm')) {
    relativePath = OPENCV_WASM_LOCAL_URL;
  } else if (normalizedPath === 'opencv.js') {
    relativePath = OPENCV_LOCAL_URL;
  } else {
    relativePath = `${OPENCV_ASSET_BASE_URL}${normalizedPath}`;
  }
  try {
    return new URL(relativePath, window.location.href).toString();
  } catch {
    return relativePath;
  }
}

function ensureOpenCvModuleConfig() {
  if (isOpenCvApiReady()) {
    return;
  }
  const cvRef = window.cv;
  if (!cvRef) {
    return;
  }
  if (typeof cvRef === 'function') {
    return;
  }
  if (typeof cvRef !== 'object') {
    return;
  }
  cvRef.locateFile = (path) => resolveOpenCvAssetUrl(path);
}

function tryInitializeOpenCvFactory(callbacks = {}) {
  const cvRef = window.cv;
  if (typeof cvRef !== 'function' || isOpenCvApiReady()) {
    return null;
  }
  if (cvRef.__opencvFactoryInitialized) {
    return typeof window.cv === 'object' ? window.cv : null;
  }
  cvRef.__opencvFactoryInitialized = true;
  const onRuntimeInitialized = typeof callbacks.onRuntimeInitialized === 'function' ? callbacks.onRuntimeInitialized : null;
  const onAbort = typeof callbacks.onAbort === 'function' ? callbacks.onAbort : null;
  const onErrorLog = typeof callbacks.onErrorLog === 'function' ? callbacks.onErrorLog : null;
  const moduleConfig = {
    locateFile: (path) => resolveOpenCvAssetUrl(path)
  };
  if (onRuntimeInitialized) {
    moduleConfig.onRuntimeInitialized = onRuntimeInitialized;
  }
  if (onAbort) {
    moduleConfig.onAbort = onAbort;
  }
  if (onErrorLog) {
    moduleConfig.printErr = onErrorLog;
  }
  const moduleInstance = cvRef(moduleConfig);
  if (moduleInstance && typeof moduleInstance === 'object') {
    window.cv = moduleInstance;
  }
  return moduleInstance || null;
}

function publishOpenCvProgress(partialState = {}) {
  const nextState = {
    ...openCvProgressState,
    ...partialState
  };
  const changed = nextState.phase !== openCvProgressState.phase
    || nextState.progress !== openCvProgressState.progress
    || nextState.message !== openCvProgressState.message
    || nextState.elapsedMs !== openCvProgressState.elapsedMs
    || nextState.timeoutMs !== openCvProgressState.timeoutMs;
  if (!changed) {
    return;
  }
  openCvProgressState = nextState;
  openCvProgressListeners.forEach((listener) => {
    try {
      listener(openCvProgressState);
    } catch {
      // Ignore listener failures so the loader keeps working.
    }
  });
}

function subscribeOpenCvProgress(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  openCvProgressListeners.add(listener);
  try {
    listener(openCvProgressState);
  } catch {
    // Ignore listener failures.
  }
  return () => {
    openCvProgressListeners.delete(listener);
  };
}

function resetOpenCvLoaderArtifacts() {
  openCvLoadPromise = null;
  const script = document.querySelector(OPENCV_SCRIPT_SELECTOR);
  if (script) {
    script.remove();
  }
  if (!isOpenCvApiReady()) {
    try {
      delete window.cv;
    } catch {
      window.cv = undefined;
    }
  }
  publishOpenCvProgress({
    phase: OPEN_CV_PROGRESS_STATES.idle,
    progress: 0,
    message: '',
    elapsedMs: 0,
    timeoutMs: 0
  });
}

function ensureOpenCvReady(timeoutMs = 30000, options = {}) {
  const resolvedTimeoutMs = Math.max(1000, Math.round(Number(timeoutMs) || 30000));
  const forceReload = Boolean(options?.forceReload);
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const unsubscribeProgress = onProgress ? subscribeOpenCvProgress(onProgress) : null;
  const settle = (promise) => {
    if (!unsubscribeProgress) {
      return promise;
    }
    return promise.finally(() => {
      unsubscribeProgress();
    });
  };

  if (forceReload) {
    resetOpenCvLoaderArtifacts();
  }

  ensureOpenCvModuleConfig();

  if (isOpenCvApiReady()) {
    publishOpenCvProgress({
      phase: OPEN_CV_PROGRESS_STATES.ready,
      progress: 100,
      message: 'OpenCV runtime ready.',
      elapsedMs: 0,
      timeoutMs: resolvedTimeoutMs
    });
    return settle(Promise.resolve(window.cv));
  }

  if (openCvLoadPromise) {
    publishOpenCvProgress({ timeoutMs: resolvedTimeoutMs });
    return settle(openCvLoadPromise);
  }

  openCvLoadPromise = new Promise((resolve, reject) => {
    const loadStartedAt = Date.now();
    const scriptVariants = [
      {
        key: 'fast',
        scriptPath: 'opencv.js',
        label: 'fast OpenCV runtime',
        timeoutMs: resolvedTimeoutMs
      },
      {
        key: 'compat',
        scriptPath: 'opencv-inline.js',
        label: 'compatibility OpenCV runtime',
        timeoutMs: Math.max(resolvedTimeoutMs, 120000)
      }
    ];
    let activeVariantIndex = 0;
    let settled = false;
    let timeoutId = null;
    let pollId = null;
    let runtimeAttached = false;
    let scriptLoaded = false;
    let stageStartedAt = Date.now();
    let lastRuntimeErrorMessage = '';

    function activeVariant() {
      return scriptVariants[Math.min(activeVariantIndex, scriptVariants.length - 1)];
    }

    function activeScriptUrl() {
      return resolveOpenCvAssetUrl(activeVariant().scriptPath);
    }

    function rememberRuntimeError(errorLike) {
      if (!errorLike) {
        return;
      }
      let message = '';
      if (typeof errorLike === 'string') {
        message = errorLike.trim();
      } else if (typeof errorLike?.message === 'string') {
        message = errorLike.message.trim();
      } else {
        message = String(errorLike).trim();
      }
      if (!message) {
        return;
      }
      lastRuntimeErrorMessage = message;
    }

    function resetRuntimeStateForNextAttempt() {
      runtimeAttached = false;
      scriptLoaded = false;
      if (!isOpenCvApiReady()) {
        try {
          delete window.cv;
        } catch {
          window.cv = undefined;
        }
      }
    }

    function buildPendingProgress() {
      const elapsedMs = Date.now() - loadStartedAt;
      const stageElapsedMs = Date.now() - stageStartedAt;
      const stageTimeoutMs = activeVariant().timeoutMs;
      const progressStart = scriptLoaded ? 45 : 5;
      const progressCap = scriptLoaded ? 92 : 42;
      const ratio = Math.min(1, stageElapsedMs / stageTimeoutMs);
      const progress = Math.round(progressStart + ((progressCap - progressStart) * ratio));
      return {
        elapsedMs,
        progress,
        timeoutMs: stageTimeoutMs
      };
    }

    function updatePendingProgress() {
      const { elapsedMs, progress, timeoutMs } = buildPendingProgress();
      publishOpenCvProgress({
        phase: scriptLoaded ? OPEN_CV_PROGRESS_STATES.initializing : OPEN_CV_PROGRESS_STATES.loadingScript,
        progress,
        message: scriptLoaded ? 'Initializing OpenCV runtime...' : 'Loading OpenCV script...',
        elapsedMs,
        timeoutMs
      });
    }

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
        publishOpenCvProgress({
          phase: OPEN_CV_PROGRESS_STATES.error,
          progress: Math.max(5, Math.round(openCvProgressState.progress)),
          message: error.message || 'OpenCV runtime failed to load.',
          elapsedMs: Date.now() - loadStartedAt,
          timeoutMs: activeVariant().timeoutMs
        });
        openCvLoadPromise = null;
        reject(error);
        return;
      }
      publishOpenCvProgress({
        phase: OPEN_CV_PROGRESS_STATES.ready,
        progress: 100,
        message: 'OpenCV runtime ready.',
        elapsedMs: Date.now() - loadStartedAt,
        timeoutMs: activeVariant().timeoutMs
      });
      resolve(result);
    }

    function resolveIfReady() {
      if (isOpenCvApiReady()) {
        done(null, window.cv);
        return true;
      }
      return false;
    }

    function armStageTimeout() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (switchToFallback(`Timed out while loading ${activeVariant().label}.`)) {
          return;
        }
        if (lastRuntimeErrorMessage) {
          done(new Error(`Timed out while loading OpenCV: ${lastRuntimeErrorMessage}`));
          return;
        }
        done(new Error('Timed out while loading OpenCV. Click Retry OpenCV.'));
      }, activeVariant().timeoutMs);
    }

    function attachRuntimeHandler() {
      if (runtimeAttached) {
        return true;
      }
      let maybeModule = null;
      try {
        maybeModule = tryInitializeOpenCvFactory({
          onRuntimeInitialized: () => {
            if (!resolveIfReady()) {
              done(new Error('OpenCV runtime initialized, but API is unavailable.'));
            }
          },
          onAbort: (reason) => {
            rememberRuntimeError(reason);
            if (switchToFallback(`OpenCV runtime aborted: ${lastRuntimeErrorMessage || 'unknown error'}`)) {
              return;
            }
            done(new Error(`OpenCV runtime aborted: ${lastRuntimeErrorMessage || 'unknown error'}`));
          },
          onErrorLog: (text) => {
            if (typeof text !== 'string') {
              return;
            }
            if (/abort|error|fail|wasm|exception/i.test(text)) {
              rememberRuntimeError(text);
            }
          }
        });
      } catch (error) {
        rememberRuntimeError(error);
        if (switchToFallback(error?.message || 'Failed to initialize OpenCV runtime.')) {
          return false;
        }
        done(new Error(error?.message || 'Failed to initialize OpenCV runtime.'));
        return false;
      }
      const cvRef = window.cv;
      if (!cvRef || typeof cvRef === 'function') {
        return false;
      }
      runtimeAttached = true;

      if (maybeModule?.ready && typeof maybeModule.ready.then === 'function') {
        publishOpenCvProgress({
          phase: OPEN_CV_PROGRESS_STATES.initializing,
          progress: 72,
          message: 'Initializing OpenCV runtime...',
          elapsedMs: Date.now() - loadStartedAt,
          timeoutMs: activeVariant().timeoutMs
        });
        maybeModule.ready
          .then(() => {
            if (!resolveIfReady()) {
              done(new Error('OpenCV ready promise resolved, but API is unavailable.'));
            }
          })
          .catch((error) => {
            rememberRuntimeError(error);
            if (switchToFallback(error?.message || 'OpenCV runtime ready promise rejected.')) {
              return;
            }
            done(new Error(error?.message || 'OpenCV runtime ready promise rejected.'));
          });
      }

      if (typeof cvRef.then === 'function') {
        publishOpenCvProgress({
          phase: OPEN_CV_PROGRESS_STATES.initializing,
          progress: 70,
          message: 'Initializing OpenCV runtime...',
          elapsedMs: Date.now() - loadStartedAt,
          timeoutMs: activeVariant().timeoutMs
        });
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
            rememberRuntimeError(error);
            if (switchToFallback(error?.message || 'Failed to initialize OpenCV runtime.')) {
              return;
            }
            done(new Error(error?.message || 'Failed to initialize OpenCV runtime.'));
          });
        return true;
      }

      if (cvRef.ready && typeof cvRef.ready.then === 'function') {
        publishOpenCvProgress({
          phase: OPEN_CV_PROGRESS_STATES.initializing,
          progress: 72,
          message: 'Initializing OpenCV runtime...',
          elapsedMs: Date.now() - loadStartedAt,
          timeoutMs: activeVariant().timeoutMs
        });
        cvRef.ready
          .then(() => {
            if (!resolveIfReady()) {
              done(new Error('OpenCV ready promise resolved, but API is unavailable.'));
            }
          })
          .catch((error) => {
            rememberRuntimeError(error);
            if (switchToFallback(error?.message || 'OpenCV runtime ready promise rejected.')) {
              return;
            }
            done(new Error(error?.message || 'OpenCV runtime ready promise rejected.'));
          });
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
      updatePendingProgress();
      pollId = setTimeout(pollForRuntime, 120);
    }

    function injectScriptForActiveVariant() {
      const script = document.createElement('script');
      script.src = activeScriptUrl();
      script.async = true;
      script.defer = true;
      script.dataset.opencvLoader = 'true';
      script.dataset.opencvLoadState = 'loading';
      script.dataset.opencvVariant = activeVariant().key;
      script.addEventListener('error', () => {
        script.dataset.opencvLoadState = 'error';
        if (switchToFallback(`Failed to load ${activeVariant().label} script.`)) {
          return;
        }
        done(new Error('Failed to load local OpenCV script. Click Retry OpenCV.'));
      });
      script.addEventListener('load', () => {
        scriptLoaded = true;
        script.dataset.opencvLoadState = 'loaded';
        publishOpenCvProgress({
          phase: OPEN_CV_PROGRESS_STATES.scriptLoaded,
          progress: 45,
          message: 'OpenCV script loaded. Initializing runtime...',
          elapsedMs: Date.now() - loadStartedAt,
          timeoutMs: activeVariant().timeoutMs
        });
        attachRuntimeHandler();
        resolveIfReady();
      });
      document.body.appendChild(script);
    }

    function switchToFallback(reason) {
      if (settled) {
        return false;
      }
      if (activeVariantIndex >= scriptVariants.length - 1) {
        return false;
      }
      rememberRuntimeError(reason);
      const previousVariant = activeVariant();
      activeVariantIndex += 1;
      const nextVariant = activeVariant();
      const existingScript = document.querySelector(OPENCV_SCRIPT_SELECTOR);
      if (existingScript) {
        existingScript.remove();
      }
      resetRuntimeStateForNextAttempt();
      stageStartedAt = Date.now();
      publishOpenCvProgress({
        phase: OPEN_CV_PROGRESS_STATES.loadingScript,
        progress: 5,
        message: `Switching to ${nextVariant.label}...`,
        elapsedMs: Date.now() - loadStartedAt,
        timeoutMs: nextVariant.timeoutMs
      });
      armStageTimeout();
      injectScriptForActiveVariant();
      if (previousVariant.key !== nextVariant.key) {
        attachRuntimeHandler();
      }
      return true;
    }

    const existingScript = document.querySelector(OPENCV_SCRIPT_SELECTOR);
    if (existingScript) {
      existingScript.remove();
    }
    resetRuntimeStateForNextAttempt();
    stageStartedAt = Date.now();

    publishOpenCvProgress({
      phase: OPEN_CV_PROGRESS_STATES.loadingScript,
      progress: 5,
      message: 'Loading OpenCV script...',
      elapsedMs: 0,
      timeoutMs: activeVariant().timeoutMs
    });

    armStageTimeout();
    ensureOpenCvModuleConfig();
    injectScriptForActiveVariant();
    attachRuntimeHandler();
    pollForRuntime();
  });

  return settle(openCvLoadPromise);
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
  const colonyLoadOpenCvBtn = document.getElementById('colony-load-opencv-btn');
  const colonyRunBtn = document.getElementById('colony-run-btn');
  const colonyResetBtn = document.getElementById('colony-reset-btn');
  const colonyStartCropBtn = document.getElementById('colony-start-crop-btn');
  const colonyApplyCropBtn = document.getElementById('colony-apply-crop-btn');
  const colonyCancelCropBtn = document.getElementById('colony-cancel-crop-btn');
  const colonyResetCropBtn = document.getElementById('colony-reset-crop-btn');
  const colonyStatus = document.getElementById('colony-status');
  const colonyOpenCvLoader = document.getElementById('colony-opencv-loader');
  const colonyOpenCvProgressFill = document.getElementById('colony-opencv-progress-fill');
  const colonyOpenCvProgressText = document.getElementById('colony-opencv-progress-text');
  const colonyOpenCvRetryBtn = document.getElementById('colony-opencv-retry-btn');
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

  function formatOpenCvElapsed(msValue) {
    const ms = Math.max(0, Number(msValue) || 0);
    return `${Math.round(ms / 1000)}s`;
  }

  function renderOpenCvLoadUi(progressState) {
    if (!colonyOpenCvLoader || !colonyOpenCvProgressFill || !colonyOpenCvProgressText) {
      return;
    }

    const phase = progressState?.phase || OPEN_CV_PROGRESS_STATES.idle;
    const isBusy = phase === OPEN_CV_PROGRESS_STATES.loadingScript
      || phase === OPEN_CV_PROGRESS_STATES.scriptLoaded
      || phase === OPEN_CV_PROGRESS_STATES.initializing;
    const isError = phase === OPEN_CV_PROGRESS_STATES.error;
    const showLoader = isBusy || isError;

    colonyOpenCvLoader.hidden = !showLoader;
    colonyOpenCvLoader.classList.toggle('is-error', isError);

    if (!showLoader) {
      colonyOpenCvProgressFill.style.width = '0%';
      colonyOpenCvProgressText.style.color = '';
      if (colonyOpenCvRetryBtn) {
        colonyOpenCvRetryBtn.hidden = true;
      }
      if (colonyLoadOpenCvBtn) {
        if (phase === OPEN_CV_PROGRESS_STATES.ready) {
          colonyLoadOpenCvBtn.disabled = true;
          colonyLoadOpenCvBtn.textContent = 'OpenCV Loaded';
        } else {
          colonyLoadOpenCvBtn.disabled = false;
          colonyLoadOpenCvBtn.textContent = 'Load OpenCV';
        }
      }
      updateCropControlState();
      return;
    }

    const progress = clampNumber(progressState?.progress, 0, 100, 0);
    colonyOpenCvProgressFill.style.width = `${Math.round(progress)}%`;

    const statusText = String(progressState?.message || 'Preparing OpenCV runtime...');
    if (isBusy) {
      const elapsedText = formatOpenCvElapsed(progressState?.elapsedMs);
      const timeoutText = formatOpenCvElapsed(progressState?.timeoutMs);
      colonyOpenCvProgressText.textContent = `${statusText} (${elapsedText}/${timeoutText})`;
    } else {
      colonyOpenCvProgressText.textContent = statusText;
    }
    colonyOpenCvProgressText.style.color = isError ? 'var(--danger)' : '';

    if (colonyOpenCvRetryBtn) {
      colonyOpenCvRetryBtn.hidden = !isError;
      colonyOpenCvRetryBtn.disabled = false;
    }

    if (colonyLoadOpenCvBtn) {
      if (isBusy) {
        colonyLoadOpenCvBtn.disabled = true;
        colonyLoadOpenCvBtn.textContent = 'Loading OpenCV...';
      } else if (phase === OPEN_CV_PROGRESS_STATES.ready) {
        colonyLoadOpenCvBtn.disabled = true;
        colonyLoadOpenCvBtn.textContent = 'OpenCV Loaded';
      } else {
        colonyLoadOpenCvBtn.disabled = false;
        colonyLoadOpenCvBtn.textContent = 'Load OpenCV';
      }
    }
    updateCropControlState();
  }

  function isCropModeActive() {
    return Boolean(colonyState.cropper);
  }

  function updateCropControlState() {
    const hasImage = colonyState.hasImage;
    const cropActive = isCropModeActive();
    const openCvReady = isOpenCvApiReady();
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
      colonyRunBtn.disabled = !hasImage || cropActive || !openCvReady;
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
    if (isOpenCvApiReady()) {
      setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height})`);
    } else {
      setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height}). Click Load OpenCV.`);
    }
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

  async function loadOpenCvRuntime(forceReload = false) {
    if (isOpenCvApiReady() && !forceReload) {
      setColonyStatus(colonyState.hasImage ? 'OpenCV ready. You can run counting.' : 'OpenCV ready. Load an image to begin.');
      updateCropControlState();
      return;
    }
    setColonyStatus(forceReload ? 'Retrying OpenCV runtime load...' : 'Loading OpenCV runtime...');
    try {
      await ensureOpenCvReady(45000, { forceReload });
      setColonyStatus(colonyState.hasImage ? 'OpenCV ready. You can run counting.' : 'OpenCV ready. Load an image to begin.');
    } catch (error) {
      setColonyStatus(`OpenCV preload failed: ${error.message || error}`, true);
    } finally {
      updateCropControlState();
    }
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
    if (!isOpenCvApiReady()) {
      setColonyStatus('OpenCV is not loaded. Click Load OpenCV first.', true);
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
    setColonyStatus('Running colony detection...');

    let src = null;
    let gray = null;
    let smoothed = null;
    let mask = null;
    let kernel = null;
    let contours = null;
    let hierarchy = null;
    let annotated = null;

    try {
      const cvRef = await ensureOpenCvReady(45000);
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
    setColonyStatus('Load OpenCV, then load an image to begin.');
    updateCropControlState();
  }

  syncColonyThresholdMode();
  resetColonySummary();
  setColonyStatus('Load OpenCV, then load an image to begin.');
  updateCropControlState();
  subscribeOpenCvProgress((progressState) => {
    renderOpenCvLoadUi(progressState);
  });

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

  colonyLoadOpenCvBtn?.addEventListener('click', async () => {
    await loadOpenCvRuntime(false);
  });

  colonyOpenCvRetryBtn?.addEventListener('click', async () => {
    colonyOpenCvRetryBtn.disabled = true;
    try {
      await loadOpenCvRuntime(true);
    } finally {
      colonyOpenCvRetryBtn.disabled = false;
    }
  });

  colonyResetBtn?.addEventListener('click', () => {
    resetColonyCounter();
  });
}
