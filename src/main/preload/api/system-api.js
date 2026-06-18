'use strict';

const { SYSTEM } = require('../../../shared/ipc/channels');

const CHEMICAL_CLIPBOARD_FORMAT_HINTS = [
  'chemical',
  'chemdraw',
  'cambridge',
  'cambridgesoft',
  'perkinelmer',
  'revvity',
  'cdxml',
  'cdx',
  'molfile',
  'mdl',
  'sdf',
  'smiles',
  'inchi',
  'text/plain',
  'text/html'
];

const IMAGE_CLIPBOARD_FORMAT_HINTS = [
  'image/',
  'public.png',
  'public.jpeg',
  'public.jpg',
  'public.tiff',
  'public.tif',
  'public.pdf',
  'com.adobe.pdf',
  'portable document format',
  'enhanced metafile',
  'windows metafile'
];

const MAX_IMAGE_DATA_URL_LENGTH = 12_000_000;
const MAX_NATIVE_IMAGE_DIMENSION = 1600;

function createSystemApi(ipcRenderer, deps = {}) {
  return {
    openExternalUrl: (url) => ipcRenderer.invoke(SYSTEM.OPEN_EXTERNAL_URL, { url }),
    onAppCloseRequested: (handler) => {
      if (typeof handler !== 'function') {
        return () => {};
      }
      const listener = () => handler();
      ipcRenderer.on(SYSTEM.APP_CLOSE_REQUESTED, listener);
      return () => ipcRenderer.removeListener(SYSTEM.APP_CLOSE_REQUESTED, listener);
    },
    respondToAppClose: (action) => {
      ipcRenderer.send(SYSTEM.APP_CLOSE_RESPONSE, {
        action: String(action || '').trim()
      });
    },
    readChemicalClipboard: () => readChemicalClipboard(deps.clipboard, deps.nativeImage)
  };
}

function readChemicalClipboard(clipboard, nativeImage = null) {
  if (!clipboard) {
    return { ok: false, formats: [], candidates: [] };
  }

  const formats = safeAvailableFormats(clipboard);
  const candidates = [];
  addCandidate(candidates, 'text/plain', safeReadText(clipboard));
  addCandidate(candidates, 'text/html', safeReadHtml(clipboard));
  addImageCandidate(candidates, 'image/native', safeReadImageDataUrl(clipboard));

  formats
    .filter((format) => isPotentialChemicalFormat(format) || isPotentialImageFormat(format))
    .forEach((format) => {
      const buffer = safeReadBuffer(clipboard, format);
      if (isPotentialImageFormat(format)) {
        addImageCandidate(candidates, format, imageBufferToDataUrl(buffer, format, nativeImage));
      }
      if (isPotentialChemicalFormat(format)) {
        decodeClipboardBuffer(buffer, format).forEach((text) => {
          addCandidate(candidates, format, text);
        });
      }
    });

  return {
    ok: true,
    formats,
    candidates: dedupeCandidates(candidates)
  };
}

function safeAvailableFormats(clipboard) {
  try {
    return typeof clipboard.availableFormats === 'function' ? clipboard.availableFormats() : [];
  } catch {
    return [];
  }
}

function safeReadText(clipboard) {
  try {
    return typeof clipboard.readText === 'function' ? clipboard.readText() : '';
  } catch {
    return '';
  }
}

function safeReadHtml(clipboard) {
  try {
    return typeof clipboard.readHTML === 'function' ? clipboard.readHTML() : '';
  } catch {
    return '';
  }
}

function safeReadBuffer(clipboard, format) {
  try {
    return typeof clipboard.readBuffer === 'function' ? clipboard.readBuffer(format) : null;
  } catch {
    return null;
  }
}

function safeReadImageDataUrl(clipboard) {
  try {
    if (typeof clipboard.readImage !== 'function') {
      return '';
    }
    const image = clipboard.readImage();
    if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
      return '';
    }
    return nativeImageToDataUrl(image);
  } catch {
    return '';
  }
}

function imageBufferToDataUrl(buffer, format, nativeImage) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return '';
  }
  const lower = String(format || '').toLowerCase();
  if (lower.includes('svg')) {
    const svgText = normalizeClipboardText(buffer.toString('utf8'));
    if (/^\s*<svg[\s>]/i.test(svgText)) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    }
  }
  if (lower.includes('png')) {
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
  if (lower.includes('jpeg') || lower.includes('jpg')) {
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }
  try {
    const image = nativeImage?.createFromBuffer ? nativeImage.createFromBuffer(buffer) : null;
    const dataUrl = nativeImageToDataUrl(image);
    if (dataUrl) {
      return dataUrl;
    }
  } catch {
    // Some vector/PDF clipboard payloads cannot be converted by Electron nativeImage.
  }
  return '';
}

function nativeImageToDataUrl(image) {
  if (!image || (typeof image.isEmpty === 'function' && image.isEmpty()) || typeof image.toDataURL !== 'function') {
    return '';
  }

  const direct = image.toDataURL();
  if (direct && direct.length <= MAX_IMAGE_DATA_URL_LENGTH) {
    return direct;
  }

  try {
    if (typeof image.getSize !== 'function' || typeof image.resize !== 'function') {
      return direct || '';
    }
    const size = image.getSize();
    const width = Math.max(1, Number(size?.width) || 1);
    const height = Math.max(1, Number(size?.height) || 1);
    const largest = Math.max(width, height);
    if (largest <= MAX_NATIVE_IMAGE_DIMENSION) {
      return direct || '';
    }
    const scale = MAX_NATIVE_IMAGE_DIMENSION / largest;
    const resized = image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    });
    return resized && typeof resized.toDataURL === 'function' ? resized.toDataURL() : direct || '';
  } catch {
    return direct || '';
  }
}

function isPotentialChemicalFormat(format) {
  const lower = String(format || '').toLowerCase();
  return CHEMICAL_CLIPBOARD_FORMAT_HINTS.some((hint) => lower.includes(hint));
}

function isPotentialImageFormat(format) {
  const lower = String(format || '').toLowerCase();
  return IMAGE_CLIPBOARD_FORMAT_HINTS.some((hint) => lower.includes(hint));
}

function decodeClipboardBuffer(buffer, format) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return [];
  }

  const outputs = [];
  const first = buffer[0];
  const second = buffer[1];
  if (first === 0xFF && second === 0xFE) {
    outputs.push(buffer.slice(2).toString('utf16le'));
  } else if (first === 0xFE && second === 0xFF) {
    outputs.push(swapUtf16Buffer(buffer.slice(2)).toString('utf16le'));
  }

  outputs.push(buffer.toString('utf8'));
  if (looksLikeUtf16Le(buffer)) {
    outputs.push(buffer.toString('utf16le'));
  }
  if (isNativeChemicalBinaryFormat(format)) {
    outputs.push(buffer.toString('latin1'));
  }

  return Array.from(new Set(outputs.map((item) => normalizeClipboardText(item)).filter(Boolean)));
}

function isNativeChemicalBinaryFormat(format) {
  const lower = String(format || '').toLowerCase();
  return lower.includes('cdx')
    || lower.includes('chemdraw')
    || lower.includes('cambridge')
    || lower.includes('perkinelmer')
    || lower.includes('revvity');
}

function looksLikeUtf16Le(buffer) {
  const sampleLength = Math.min(buffer.length, 120);
  if (sampleLength < 4) {
    return false;
  }
  let oddNulls = 0;
  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0) {
      oddNulls += 1;
    }
  }
  return oddNulls >= Math.floor(sampleLength / 6);
}

function swapUtf16Buffer(buffer) {
  const swapped = Buffer.from(buffer);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const current = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = current;
  }
  return swapped;
}

function normalizeClipboardText(value) {
  const text = String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text || text.length > 2_000_000) {
    return '';
  }
  return text;
}

function addCandidate(candidates, format, text) {
  const normalized = normalizeClipboardText(text);
  if (!normalized) {
    return;
  }
  candidates.push({ format: String(format || '').trim(), text: normalized });
}

function addImageCandidate(candidates, format, imageDataUrl) {
  const normalized = normalizeImageDataUrl(imageDataUrl);
  if (!normalized) {
    return;
  }
  candidates.push({ format: String(format || '').trim(), imageDataUrl: normalized });
}

function normalizeImageDataUrl(value) {
  const text = String(value || '').trim();
  if (!/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(text)) {
    return '';
  }
  return text.length <= MAX_IMAGE_DATA_URL_LENGTH ? text : '';
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const payload = candidate.imageDataUrl || candidate.text;
    const key = `${candidate.format.toLowerCase()}::${payload}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

module.exports = {
  createSystemApi,
  readChemicalClipboard
};
