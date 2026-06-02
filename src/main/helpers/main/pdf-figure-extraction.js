'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { Buffer } = require('node:buffer');

const OPS_PAINT_IMAGE_MASK_X_OBJECT = 83;
const OPS_PAINT_IMAGE_X_OBJECT = 85;
const OPS_PAINT_INLINE_IMAGE_X_OBJECT = 86;
const OPS_PAINT_IMAGE_X_OBJECT_REPEAT = 88;

const IMAGE_KIND_GRAYSCALE_1BPP = 1;
const IMAGE_KIND_RGB_24BPP = 2;
const IMAGE_KIND_RGBA_32BPP = 3;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng({ width, height, channels, pixels } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('encodePng requires positive integer width/height.');
  }
  if (channels !== 1 && channels !== 3 && channels !== 4) {
    throw new Error(`encodePng supports 1, 3, or 4 channels (got ${channels}).`);
  }
  const bytesPerRow = width * channels;
  const expected = bytesPerRow * height;
  if (!pixels || pixels.length !== expected) {
    throw new Error(`encodePng pixel buffer length mismatch (${pixels?.length || 0} vs ${expected}).`);
  }
  const colorType = channels === 4 ? 6 : (channels === 3 ? 2 : 0);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(colorType, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const filtered = Buffer.alloc(expected + height);
  const pixelBuf = Buffer.isBuffer(pixels) ? pixels : Buffer.from(pixels);
  for (let y = 0; y < height; y += 1) {
    const dstOffset = y * (bytesPerRow + 1);
    filtered[dstOffset] = 0;
    pixelBuf.copy(filtered, dstOffset + 1, y * bytesPerRow, (y + 1) * bytesPerRow);
  }
  const idat = zlib.deflateSync(filtered);
  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', idat),
    buildChunk('IEND', Buffer.alloc(0))
  ]);
}

function toBufferView(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data.byteLength === 'number') {
    return Buffer.from(new Uint8Array(data));
  }
  return Buffer.alloc(0);
}

function unpackGrayscale1bppToGray8(packed, width, height) {
  const srcRowBytes = (width + 7) >> 3;
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcRowOffset = y * srcRowBytes;
    const dstRowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const byte = packed[srcRowOffset + (x >> 3)] || 0;
      const bit = byte & (0x80 >> (x & 7));
      out[dstRowOffset + x] = bit ? 0xFF : 0x00;
    }
  }
  return out;
}

function convertPdfJsImageToPng(imageData) {
  if (!imageData || typeof imageData !== 'object') {
    return null;
  }
  const width = Number(imageData.width) || 0;
  const height = Number(imageData.height) || 0;
  if (!width || !height) {
    return null;
  }
  const data = toBufferView(imageData.data);
  if (!data.length) {
    return null;
  }
  if (imageData.kind === IMAGE_KIND_RGBA_32BPP) {
    return { width, height, channels: 4, pixels: data };
  }
  if (imageData.kind === IMAGE_KIND_RGB_24BPP) {
    return { width, height, channels: 3, pixels: data };
  }
  if (imageData.kind === IMAGE_KIND_GRAYSCALE_1BPP) {
    const pixels = unpackGrayscale1bppToGray8(data, width, height);
    return { width, height, channels: 1, pixels };
  }
  return null;
}

function getImageObjectStore(page, objId) {
  return String(objId).startsWith('g_') ? page.commonObjs : page.objs;
}

function getImageObjectAsync(page, objId) {
  return new Promise((resolve) => {
    const store = getImageObjectStore(page, objId);
    if (!store || typeof store.get !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value || null);
    };
    try {
      store.get(String(objId), (data) => settle(data));
    } catch {
      settle(null);
    }
  });
}

async function extractFiguresFromPage({
  page,
  pageNumber,
  outputDir,
  namePrefix = `page-${pageNumber}`,
  minDimension = 32,
  minPixels = 32 * 32,
  skipDuplicateObjIds = true,
  writeFile = (filePath, buffer) => fsPromises.writeFile(filePath, buffer)
} = {}) {
  if (!page || typeof page.getOperatorList !== 'function') {
    return [];
  }
  const opList = await page.getOperatorList();
  const fnArray = Array.isArray(opList?.fnArray) ? opList.fnArray : [];
  const argsArray = Array.isArray(opList?.argsArray) ? opList.argsArray : [];
  if (!fnArray.length) {
    return [];
  }
  const seenObjIds = new Set();
  const figures = [];
  let imageIndex = 0;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i] || [];
    let imageData = null;
    let objId = '';
    if (fn === OPS_PAINT_IMAGE_X_OBJECT || fn === OPS_PAINT_IMAGE_X_OBJECT_REPEAT) {
      objId = String(args[0] || '');
      if (!objId) {
        continue;
      }
      if (skipDuplicateObjIds && seenObjIds.has(objId)) {
        continue;
      }
      imageData = await getImageObjectAsync(page, objId);
    } else if (fn === OPS_PAINT_INLINE_IMAGE_X_OBJECT) {
      imageData = args[0];
    } else if (fn === OPS_PAINT_IMAGE_MASK_X_OBJECT) {
      // Skip pure masks for now — they're shape stencils, not standalone figures.
      continue;
    } else {
      continue;
    }
    const converted = convertPdfJsImageToPng(imageData);
    if (!converted) {
      continue;
    }
    const { width, height } = converted;
    if (width < minDimension || height < minDimension || width * height < minPixels) {
      continue;
    }
    let pngBuffer;
    try {
      pngBuffer = encodePng(converted);
    } catch {
      continue;
    }
    imageIndex += 1;
    const fileName = `${namePrefix}-img-${imageIndex}.png`;
    const filePath = path.join(outputDir, fileName);
    try {
      await writeFile(filePath, pngBuffer);
    } catch {
      continue;
    }
    if (objId) {
      seenObjIds.add(objId);
    }
    figures.push({
      page_number: pageNumber,
      image_index: imageIndex,
      file_name: fileName,
      file_path: filePath,
      width,
      height,
      channels: converted.channels,
      kind: imageData?.kind || 0,
      byte_length: pngBuffer.length,
      obj_id: objId || ''
    });
  }
  return figures;
}

async function extractFiguresFromPdfDocument({
  pdfDocument,
  outputDir,
  startPage = 1,
  endPage,
  minDimension = 32,
  minPixels = 32 * 32,
  maxPages,
  cleanupExisting = true
} = {}) {
  if (!pdfDocument || typeof pdfDocument.getPage !== 'function' || !outputDir) {
    return [];
  }
  const totalPages = Number(pdfDocument.numPages) || 0;
  if (!totalPages) {
    return [];
  }
  const firstPage = Math.max(1, Math.floor(startPage) || 1);
  const lastRequested = Number.isFinite(endPage) && endPage > 0
    ? Math.min(Math.floor(endPage), totalPages)
    : totalPages;
  const pageBudget = Number.isFinite(maxPages) && maxPages > 0
    ? Math.min(Math.floor(maxPages), lastRequested - firstPage + 1)
    : (lastRequested - firstPage + 1);
  const lastPage = firstPage + pageBudget - 1;

  await fsPromises.mkdir(outputDir, { recursive: true });
  if (cleanupExisting) {
    try {
      const existing = await fsPromises.readdir(outputDir);
      await Promise.all(existing
        .filter((name) => /\.png$/i.test(name))
        .map((name) => fsPromises.unlink(path.join(outputDir, name)).catch(() => null)));
    } catch {
      // ignore directory read errors
    }
  }

  const allFigures = [];
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
    let page;
    try {
      page = await pdfDocument.getPage(pageNumber);
    } catch {
      continue;
    }
    try {
      const figures = await extractFiguresFromPage({
        page,
        pageNumber,
        outputDir,
        minDimension,
        minPixels
      });
      allFigures.push(...figures);
    } finally {
      if (page && typeof page.cleanup === 'function') {
        try {
          page.cleanup();
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
  return allFigures;
}

module.exports = {
  OPS_PAINT_IMAGE_MASK_X_OBJECT,
  OPS_PAINT_IMAGE_X_OBJECT,
  OPS_PAINT_INLINE_IMAGE_X_OBJECT,
  OPS_PAINT_IMAGE_X_OBJECT_REPEAT,
  IMAGE_KIND_GRAYSCALE_1BPP,
  IMAGE_KIND_RGB_24BPP,
  IMAGE_KIND_RGBA_32BPP,
  encodePng,
  convertPdfJsImageToPng,
  unpackGrayscale1bppToGray8,
  extractFiguresFromPage,
  extractFiguresFromPdfDocument
};
