import {
  LOCAL_UTIF_URL,
  MAX_IMAGE_DIMENSION
} from '../constants.js';
import { convertRgbaToGray } from '../analysis/image-processing.js';
import { clamp, sampleArrayValue } from '../shared.js';

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

// toRGBA8 keeps only the high byte of a 16-bit sample, which leaves a faint
// chemiluminescence band a handful of grey levels. Single-channel 16-bit
// pages are read straight off the decoded data instead (UTIF has already
// swapped big-endian files to little-endian).
function readTiffGray16(page, width, height) {
  const photometric = page.t262?.[0];
  const samples = page.t277?.[0] ?? page.t258?.length ?? 1;
  const data = page.data;
  if (page.t258?.[0] !== 16 || samples !== 1 || (photometric !== 0 && photometric !== 1)
    || !data || data.length < width * height * 2) {
    return null;
  }
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const value = (data[2 * index] | (data[(2 * index) + 1] << 8)) / 65535;
    gray[index] = photometric === 0 ? 1 - value : value;
  }
  return gray;
}

// Area-average resize of the grey image, so a band's summed signal shrinks with
// the pixel count instead of being re-quantized by the canvas.
function resizeGray(gray, width, height, targetWidth, targetHeight) {
  const out = new Float32Array(targetWidth * targetHeight);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = Math.floor((ty * height) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = Math.floor((tx * width) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / targetWidth));
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += gray[(y * width) + x];
        }
      }
      out[(ty * targetWidth) + tx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// The crop Cropper.js draws, replayed on the float grey image. Its crop box
// sits in the rotated image's bounding box, so each output pixel is rotated
// back into the source and sampled bilinearly; outside the source is black,
// as Cropper fills it. Assumes an unscaled crop (no min/max output size).
export function cropGray(gray, width, height, crop, outWidth, outHeight) {
  const radians = ((Number(crop.rotate) || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const boxWidth = Math.abs(width * cos) + Math.abs(height * sin);
  const boxHeight = Math.abs(width * sin) + Math.abs(height * cos);
  const left = Math.floor(crop.x) - (boxWidth / 2);
  const top = Math.floor(crop.y) - (boxHeight / 2);
  const out = new Float32Array(outWidth * outHeight);
  for (let v = 0; v < outHeight; v += 1) {
    for (let u = 0; u < outWidth; u += 1) {
      const dx = left + u + 0.5;
      const dy = top + v + 0.5;
      const sx = (cos * dx) + (sin * dy) + (width / 2);
      const sy = (cos * dy) - (sin * dx) + (height / 2);
      if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) {
        out[(v * outWidth) + u] = sampleArrayValue(gray, width, height, sx - 0.5, sy - 0.5);
      }
    }
  }
  return out;
}

// A 16-bit image is saved beside the 8-bit source.png as an uncompressed
// 16-bit TIFF whose ImageDescription fingerprints that PNG. Reopening the
// record restores full precision, and a sidecar left by an older save of a
// different image never matches.
const SOURCE_GRAY16_TAG = 'hikari-gel-source-png-fnv1a:';

function fingerprintBase64(dataBase64) {
  const binary = atob(String(dataBase64 || ''));
  let hash = 0x811c9dc5;
  for (let index = 0; index < binary.length; index += 1) {
    hash = Math.imul(hash ^ binary.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function encodeSourceGray16(image, sourcePngBase64) {
  const { gray, width, height } = image;
  const text = `${SOURCE_GRAY16_TAG}${fingerprintBase64(sourcePngBase64)}\0`;
  const pixelBytes = width * height * 2;
  const entries = [[256, 3, width], [257, 3, height], [258, 3, 16], [259, 3, 1], [262, 3, 1],
    [270, 2, text.length], [273, 4, 8], [277, 3, 1], [278, 3, height], [279, 4, pixelBytes]];
  const ifdOffset = 8 + pixelBytes;
  const textOffset = ifdOffset + 2 + (entries.length * 12) + 4;
  const bytes = new Uint8Array(textOffset + text.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  for (let index = 0; index < gray.length; index += 1) {
    view.setUint16(8 + (2 * index), Math.round(clamp(gray[index], 0, 1) * 65535), true);
  }
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach(([tag, type, value], index) => {
    const offset = ifdOffset + 2 + (index * 12);
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, type === 2 ? value : 1, true);
    if (type === 3) {
      view.setUint16(offset + 8, value, true);
    } else {
      view.setUint32(offset + 8, type === 2 ? textOffset : value, true);
    }
  });
  bytes.set(new TextEncoder().encode(text), textOffset);
  return bytes;
}

// `image` decoded from source.png gets the sidecar's 16-bit grey when the
// sidecar was saved with that exact PNG; otherwise it comes back unchanged.
export async function applySourceGray16(image, sidecarBase64, sourcePngBase64) {
  await loadUtifScript();
  const { buffer } = Uint8Array.from(atob(sidecarBase64), char => char.charCodeAt(0));
  const [page] = window.UTIF.decode(buffer) || [];
  if (!page || page.t270?.[0] !== `${SOURCE_GRAY16_TAG}${fingerprintBase64(sourcePngBase64)}`
    || Number(page.t256) !== image.width || Number(page.t257) !== image.height) {
    return image;
  }
  window.UTIF.decodeImage(buffer, page);
  const gray = readTiffGray16(page, image.width, image.height);
  return gray ? { ...image, gray, grayBitDepth: 16 } : image;
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
  const gray = readTiffGray16(page, width, height);

  return {
    name: file.name,
    width,
    height,
    imageData,
    gray,
    grayBitDepth: gray ? 16 : 8,
    tiffPageIndex: 1,
    tiffPageCount: ifds.length
  };
}

// `gray` is a float grey image to use instead of one read from imageData's 8
// bits; `grayBitDepth` 16 marks it as carrying a 16-bit TIFF's precision.
export function normalizeDecodedImage({
  name, width, height, imageData, gray = null, grayBitDepth = 8, tiffPageIndex = null, tiffPageCount = null
}) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(64, Math.round(width * scale));
  const targetHeight = Math.max(64, Math.round(height * scale));

  if (targetWidth === width && targetHeight === height) {
    return {
      name,
      width,
      height,
      imageData,
      gray: gray || convertRgbaToGray(imageData),
      grayBitDepth,
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
    gray: gray
      ? resizeGray(gray, width, height, targetWidth, targetHeight)
      : convertRgbaToGray(resizedImageData),
    grayBitDepth,
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
