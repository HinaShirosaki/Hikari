import {
  LOCAL_UTIF_URL,
  MAX_IMAGE_DIMENSION
} from '../constants.js';
import { convertRgbaToGray } from '../analysis/image-processing.js';

let utifLoadPromise = null;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read image file.'));
    };
    image.src = url;
  });
}

function loadImageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to read saved gel image.'));
    image.src = source;
  });
}

function isTiffFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return name.endsWith('.tif') || name.endsWith('.tiff') || type.includes('tiff');
}

function isUtifReady() {
  return Boolean(window.UTIF && typeof window.UTIF.decode === 'function');
}

function loadUtifScript() {
  if (isUtifReady()) {
    return Promise.resolve(true);
  }

  if (utifLoadPromise) {
    return utifLoadPromise;
  }

  utifLoadPromise = new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll('script[src]')]
      .find((script) => String(script.src || '').includes('UTIF.js'));

    if (existing) {
      if (isUtifReady()) {
        resolve(true);
      } else {
        setTimeout(() => {
          if (isUtifReady()) {
            resolve(true);
          } else {
            reject(new Error('UTIF.js failed to initialize.'));
          }
        }, 200);
      }
      return;
    }

    const script = document.createElement('script');
    script.src = LOCAL_UTIF_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (isUtifReady()) {
        resolve(true);
      } else {
        reject(new Error(`UTIF loaded from ${LOCAL_UTIF_URL} but failed to initialize.`));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load UTIF.js from ${LOCAL_UTIF_URL}.`));
    document.head.append(script);
  }).finally(() => {
    if (!isUtifReady()) {
      utifLoadPromise = null;
    }
  });

  return utifLoadPromise;
}

async function decodeTiffFile(file) {
  await loadUtifScript();
  const buffer = await file.arrayBuffer();
  const ifds = window.UTIF.decode(buffer);
  if (!ifds || !ifds.length) {
    throw new Error('No TIFF pages were found in this file.');
  }

  const page = ifds[0];
  window.UTIF.decodeImage(buffer, page);
  const width = Number(page.width || page.t256 || 0);
  const height = Number(page.height || page.t257 || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Could not decode TIFF dimensions.');
  }

  const rgba = window.UTIF.toRGBA8(page);
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);

  return {
    name: file.name,
    width,
    height,
    imageData,
    tiffPageIndex: 1,
    tiffPageCount: ifds.length
  };
}

export function normalizeDecodedImage({ name, width, height, imageData, tiffPageIndex = null, tiffPageCount = null }) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(64, Math.round(width * scale));
  const targetHeight = Math.max(64, Math.round(height * scale));

  if (targetWidth === width && targetHeight === height) {
    return {
      name,
      width,
      height,
      imageData,
      gray: convertRgbaToGray(imageData),
      tiffPageIndex,
      tiffPageCount
    };
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.putImageData(imageData, 0, 0);

  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  const targetContext = targetCanvas.getContext('2d', { willReadFrequently: true });
  targetContext.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
  const resizedImageData = targetContext.getImageData(0, 0, targetWidth, targetHeight);

  return {
    name,
    width: targetWidth,
    height: targetHeight,
    imageData: resizedImageData,
    gray: convertRgbaToGray(resizedImageData),
    tiffPageIndex,
    tiffPageCount
  };
}

async function decodeImageFile(file) {
  if (isTiffFile(file)) {
    const decodedTiff = await decodeTiffFile(file);
    return normalizeDecodedImage(decodedTiff);
  }

  const image = await loadImageFromFile(file);
  const width = image.width;
  const height = image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  return normalizeDecodedImage({
    name: file.name,
    width,
    height,
    imageData
  });
}

async function decodeImageSource(source, name = 'saved-gel.png') {
  const normalizedSource = String(source || '').trim();
  if (!normalizedSource) {
    throw new Error('Saved gel image data is empty.');
  }

  const image = await loadImageFromSource(normalizedSource);
  const width = Number(image.naturalWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Could not decode saved gel image dimensions.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);

  return normalizeDecodedImage({
    name,
    width,
    height,
    imageData
  });
}

export {
  decodeImageFile,
  decodeImageSource,
  isTiffFile,
  isUtifReady,
  loadUtifScript
};
