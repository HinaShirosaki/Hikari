'use strict';

const path = require('node:path');
const { ensureObject } = require('../../../lib/normalize.js');
const { defaultCleanText, ensurePdfFileName } = require('./storage-paths.js');

function parseContentDispositionFileName(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  const utf8Match = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = text.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ? plainMatch[1] : '';
}

function inferPdfFileName(input = {}, responseUrl = '', headers = null) {
  const source = ensureObject(input);
  const directName = defaultCleanText(source.file_name || source.fileName || source.paper_file_name || source.paperFileName);
  if (directName) {
    return ensurePdfFileName(directName);
  }

  const contentDisposition = typeof headers?.get === 'function'
    ? parseContentDispositionFileName(headers.get('content-disposition'))
    : '';
  if (contentDisposition) {
    return ensurePdfFileName(contentDisposition);
  }

  const title = defaultCleanText(source.paper_title || source.paperTitle || source.title);
  if (title) {
    return ensurePdfFileName(`${title}.pdf`);
  }

  try {
    const parsed = new URL(responseUrl || source.paper_pdf_url || source.pdf_url || source.page_url || '');
    const baseName = path.basename(parsed.pathname || '') || 'paper.pdf';
    return ensurePdfFileName(baseName);
  } catch {
    return 'paper.pdf';
  }
}

function normalizeHeadersObject(headers) {
  const source = ensureObject(headers);
  const normalized = {};
  Object.entries(source).forEach(([key, value]) => {
    const name = defaultCleanText(key);
    const headerValue = defaultCleanText(value);
    if (name && headerValue) {
      normalized[name] = headerValue;
    }
  });
  return normalized;
}

function createDownloadError(message, extra = {}) {
  const error = new Error(defaultCleanText(message) || 'Paper download failed.');
  Object.assign(error, extra);
  return error;
}

function isExplicitFalse(value) {
  return value === false || String(value || '').trim().toLowerCase() === 'false';
}

function bufferLooksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

async function readResponseText(response) {
  if (typeof response?.text === 'function') {
    return String(await response.text());
  }
  if (typeof response?.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

async function readResponseBuffer(response, onChunk) {
  if (Buffer.isBuffer(response?.body)) {
    const chunk = response.body;
    await onChunk(chunk);
    return chunk;
  }

  if (typeof response?.arrayBuffer === 'function' && !response?.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    await onChunk(buffer);
    return buffer;
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      chunks.push(chunk);
      await onChunk(chunk);
    }
    return Buffer.concat(chunks);
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      chunks.push(chunk);
      await onChunk(chunk);
    }
    return Buffer.concat(chunks);
  }

  if (typeof response?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    await onChunk(buffer);
    return buffer;
  }

  throw createDownloadError('Response body was not readable.');
}

module.exports = {
  bufferLooksLikePdf,
  createDownloadError,
  inferPdfFileName,
  isExplicitFalse,
  normalizeHeadersObject,
  readResponseBuffer,
  readResponseText
};
