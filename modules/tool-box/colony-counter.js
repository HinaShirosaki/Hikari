import {
  clampNumber,
  escapeHtml
} from './common.js';

function getCanvasPointerPosition(canvas, event) {
  if (!canvas || !event) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
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

export function initColonyCounterTool() {
  const colonyCounterForm = document.getElementById('colony-counter-form');
  if (!colonyCounterForm) {
    return;
  }

  const colonyImageInput = document.getElementById('colony-image-file');
  const colonyMaxSizeInput = document.getElementById('colony-max-size');
  const colonyRunBtn = document.getElementById('colony-run-btn');
  const colonyResetBtn = document.getElementById('colony-reset-btn');
  const colonyStartCropBtn = document.getElementById('colony-start-crop-btn');
  const colonyApplyCropBtn = document.getElementById('colony-apply-crop-btn');
  const colonyCancelCropBtn = document.getElementById('colony-cancel-crop-btn');
  const colonyResetCropBtn = document.getElementById('colony-reset-crop-btn');
  const colonyClearMarkersBtn = document.getElementById('colony-clear-markers-btn');
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

  const colonyState = {
    imageName: '',
    sourceWidth: 0,
    sourceHeight: 0,
    hasImage: false,
    cropper: null,
    previewScale: 1,
    markers: []
  };

  function setColonyStatus(message, isError = false) {
    if (!colonyStatus) {
      return;
    }
    colonyStatus.textContent = message;
    colonyStatus.style.color = isError ? 'var(--danger)' : '';
  }

  function resetColonySummary() {
    if (!colonySummary) {
      return;
    }
    colonySummary.innerHTML = '<p class="small-note">Load a plate image, then click each colony to count manually.</p>';
  }

  function renderColonySummary() {
    if (!colonySummary) {
      return;
    }
    const count = colonyState.markers.length;
    colonySummary.innerHTML = `
      <p><strong>Manual colonies counted:</strong> ${count}</p>
      <p class="small-note">Left-click to add a marker. Right-click to remove the nearest marker.</p>
    `;
  }

  function isCropModeActive() {
    return Boolean(colonyState.cropper);
  }

  function getDisplaySettings() {
    return {
      maxProcessSize: Math.round(clampNumber(colonyMaxSizeInput?.value, 300, 5000, 1600))
    };
  }

  function drawMarkers(ctx, scale) {
    if (!ctx || !Number.isFinite(scale) || scale <= 0) {
      return;
    }

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 99, 71, 0.95)';
    ctx.fillStyle = 'rgba(255, 245, 245, 0.95)';
    ctx.font = '600 12px "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';

    colonyState.markers.forEach((marker, index) => {
      const x = marker.x * scale;
      const y = marker.y * scale;
      const radius = Math.max(4, Math.round(7 * Math.max(0.7, scale)));

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const label = String(index + 1);
      const labelX = Math.max(0, x + 8);
      const labelY = Math.max(0, y + 8);
      ctx.fillStyle = 'rgba(180, 20, 20, 0.95)';
      ctx.fillText(label, labelX, labelY);
      ctx.fillStyle = 'rgba(255, 245, 245, 0.95)';
    });

    ctx.restore();
  }

  function renderMarkerCanvas() {
    if (!colonyMaskCanvas) {
      return;
    }

    const previewWidth = colonyPreviewCanvas?.width || 0;
    const previewHeight = colonyPreviewCanvas?.height || 0;
    if (!previewWidth || !previewHeight) {
      clearCanvas(colonyMaskCanvas);
      return;
    }

    colonyMaskCanvas.width = previewWidth;
    colonyMaskCanvas.height = previewHeight;
    const ctx = colonyMaskCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, previewWidth, previewHeight);
    ctx.fillStyle = '#101827';
    ctx.fillRect(0, 0, previewWidth, previewHeight);

    ctx.save();
    ctx.fillStyle = 'rgba(90, 230, 140, 0.95)';
    colonyState.markers.forEach((marker) => {
      const x = marker.x * colonyState.previewScale;
      const y = marker.y * colonyState.previewScale;
      const radius = Math.max(3, Math.round(5 * Math.max(0.7, colonyState.previewScale)));
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function renderPreviewCanvas() {
    if (!colonyPreviewCanvas || !colonySourceCanvas) {
      return;
    }

    const settings = getDisplaySettings();
    const { width, height, scale } = setCanvasFromSource(colonyPreviewCanvas, colonySourceCanvas, settings.maxProcessSize);
    colonyState.previewScale = scale;

    if (!width || !height) {
      clearCanvas(colonyMaskCanvas);
      return;
    }

    const previewCtx = colonyPreviewCanvas.getContext('2d');
    drawMarkers(previewCtx, scale);
    renderMarkerCanvas();
  }

  function updateControlState() {
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
    if (colonyClearMarkersBtn) {
      colonyClearMarkersBtn.disabled = !hasImage || cropActive || colonyState.markers.length === 0;
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
    updateControlState();
  }

  function clearMarkers() {
    if (!colonyState.markers.length) {
      return;
    }
    colonyState.markers = [];
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('All manual markers cleared.');
    updateControlState();
  }

  function clearMarkersForImageChange() {
    colonyState.markers = [];
    renderColonySummary();
  }

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
    renderPreviewCanvas();
    setColonyStatus(`Loaded ${colonyState.imageName} (${width}x${height}). Click each colony to count.`);
    updateControlState();
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
    setColonyStatus('Crop mode active. Apply crop to continue manual counting.');
    updateControlState();
  }

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
    destroyCropper();
    renderPreviewCanvas();
    setColonyStatus(`Crop applied (${croppedCanvas.width}x${croppedCanvas.height}). Click colonies to recount.`);
    updateControlState();
  }

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
    renderPreviewCanvas();
    setColonyStatus(`Restored full image (${width}x${height}). Click colonies to count.`);
    updateControlState();
  }

  function addManualMarkerFromCanvasPoint(point) {
    if (!point || !colonyState.hasImage) {
      return;
    }

    const scale = Math.max(0.0001, colonyState.previewScale || 1);
    const sourceX = clampNumber(point.x / scale, 0, Math.max(0, colonyState.sourceWidth - 1), 0);
    const sourceY = clampNumber(point.y / scale, 0, Math.max(0, colonyState.sourceHeight - 1), 0);

    const mergeThresholdSource = 10 / scale;
    const hasNearbyMarker = colonyState.markers.some((marker) => {
      const dx = marker.x - sourceX;
      const dy = marker.y - sourceY;
      return ((dx * dx) + (dy * dy)) <= (mergeThresholdSource * mergeThresholdSource);
    });

    if (hasNearbyMarker) {
      setColonyStatus('Marker already exists near that colony. Right-click to remove if needed.');
      return;
    }

    colonyState.markers.push({ x: sourceX, y: sourceY });
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Manual count: ${colonyState.markers.length}`);
    updateControlState();
  }

  function removeNearestMarkerFromCanvasPoint(point) {
    if (!point || !colonyState.markers.length) {
      return;
    }

    const scale = Math.max(0.0001, colonyState.previewScale || 1);
    const sourceX = clampNumber(point.x / scale, 0, Math.max(0, colonyState.sourceWidth - 1), 0);
    const sourceY = clampNumber(point.y / scale, 0, Math.max(0, colonyState.sourceHeight - 1), 0);

    let nearestIndex = -1;
    let nearestDistanceSq = Number.POSITIVE_INFINITY;
    for (let index = 0; index < colonyState.markers.length; index += 1) {
      const marker = colonyState.markers[index];
      const dx = marker.x - sourceX;
      const dy = marker.y - sourceY;
      const distanceSq = (dx * dx) + (dy * dy);
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestIndex = index;
      }
    }

    if (nearestIndex < 0) {
      return;
    }

    const removalThresholdSource = 16 / scale;
    if (nearestDistanceSq > (removalThresholdSource * removalThresholdSource)) {
      setColonyStatus('No marker near that point. Right-click closer to the marker to remove it.');
      return;
    }

    colonyState.markers.splice(nearestIndex, 1);
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus(`Manual count: ${colonyState.markers.length}`);
    updateControlState();
  }

  function renderManualCountResult() {
    if (!colonyState.hasImage) {
      setColonyStatus('Load a plate image first.', true);
      return;
    }

    const count = colonyState.markers.length;
    setColonyStatus(`Manual colony count saved: ${count}`);
    renderColonySummary();
  }

  function resetColonyCounter() {
    destroyCropper();
    colonyState.imageName = '';
    colonyState.sourceWidth = 0;
    colonyState.sourceHeight = 0;
    colonyState.hasImage = false;
    colonyState.previewScale = 1;
    colonyState.markers = [];

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
    setColonyStatus('Load an image, then click colonies to count manually.');
    updateControlState();
  }

  function handlePreviewClick(event) {
    if (!colonyState.hasImage) {
      setColonyStatus('Load an image before counting.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before counting.', true);
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    addManualMarkerFromCanvasPoint(point);
  }

  function handlePreviewContextMenu(event) {
    event.preventDefault();
    if (!colonyState.hasImage || isCropModeActive()) {
      return;
    }
    const point = getCanvasPointerPosition(colonyPreviewCanvas, event);
    removeNearestMarkerFromCanvasPoint(point);
  }

  syncDisplayInput();
  resetColonySummary();
  setColonyStatus('Load an image, then click colonies to count manually.');
  updateControlState();

  function syncDisplayInput() {
    if (!colonyMaxSizeInput) {
      return;
    }
    const value = Math.round(clampNumber(colonyMaxSizeInput.value, 300, 5000, 1600));
    colonyMaxSizeInput.value = String(value);
  }

  colonyMaxSizeInput?.addEventListener('change', () => {
    syncDisplayInput();
    if (colonyState.hasImage) {
      renderPreviewCanvas();
    }
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
      if (colonySummary) {
        colonySummary.innerHTML = `<p class="small-note">${escapeHtml(error.message || 'Image load failed.')}</p>`;
      }
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

  colonyPreviewCanvas?.addEventListener('click', (event) => {
    handlePreviewClick(event);
  });

  colonyPreviewCanvas?.addEventListener('contextmenu', (event) => {
    handlePreviewContextMenu(event);
  });

  colonyCounterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderManualCountResult();
  });

  colonyClearMarkersBtn?.addEventListener('click', () => {
    clearMarkers();
  });

  colonyResetBtn?.addEventListener('click', () => {
    resetColonyCounter();
  });
}
