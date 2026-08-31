// Canvas primitives shared by the colony counter: pointer mapping, source
// copying, and image loading.
import { clampNumber } from '../common.js';

const EMPTY_MASK = Object.freeze({ kind: 'none', x: 0, y: 0, width: 0, height: 0 });

// Convert a pointer event into canvas pixel coordinates, accounting for CSS scaling and letterboxing.
function getCanvasPointerPosition(canvas, event) {
  if (!canvas || !event) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const canvasWidth = canvas.width || 0;
  const canvasHeight = canvas.height || 0;
  if (!canvasWidth || !canvasHeight) {
    return null;
  }

  const styles = window.getComputedStyle(canvas);
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  const contentWidth = Math.max(1, rect.width - borderLeft - borderRight);
  const contentHeight = Math.max(1, rect.height - borderTop - borderBottom);

  // Handle CSS fit/letterboxing by mapping only inside the actually drawn bitmap area.
  const fitScale = Math.min(contentWidth / canvasWidth, contentHeight / canvasHeight);
  const renderedWidth = canvasWidth * fitScale;
  const renderedHeight = canvasHeight * fitScale;
  const offsetX = (contentWidth - renderedWidth) / 2;
  const offsetY = (contentHeight - renderedHeight) / 2;

  const pointerX = event.clientX - rect.left - borderLeft - offsetX;
  const pointerY = event.clientY - rect.top - borderTop - offsetY;
  const clampedX = clampNumber(pointerX, 0, renderedWidth, 0);
  const clampedY = clampNumber(pointerY, 0, renderedHeight, 0);
  const x = clampedX * (canvasWidth / Math.max(1, renderedWidth));
  const y = clampedY * (canvasHeight / Math.max(1, renderedHeight));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

// Resize one canvas from another while optionally constraining the maximum display dimension.
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

// Clear an entire canvas if a 2D context is available.
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

// Load a browser File object into an Image element so it can be drawn onto canvases.
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

// Load a data URL into the cropper image host before initializing CropperJS.
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

export {
  EMPTY_MASK,
  getCanvasPointerPosition,
  setCanvasFromSource,
  clearCanvas,
  loadImageElementFromFile,
  loadImageElementFromSrc
};
