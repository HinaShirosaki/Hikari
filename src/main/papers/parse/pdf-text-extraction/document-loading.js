'use strict';

const fsPromises = require('node:fs/promises');
const { Buffer } = require('node:buffer');

const { joinTextItems } = require('../pdf-text-layout.js');
const { ensureObject } = require('../../../lib/normalize.js');
const { DEFAULT_FETCH_ACCEPT, DEFAULT_USER_AGENT } = require('./constants.js');
const { decodeBase64ToBuffer, decodeDataUrlToBuffer } = require('./input-normalizing.js');
const { installPdfJsNodePolyfills } = require('./pdfjs-polyfills.js');
const { normalizeSectionLabel } = require('./sections.js');

// Loading pdf.js (vendored or injected), turning an input into a PDF buffer,
// and the per-page/outline reads the extractor runs on top of it.
function createPdfDocumentLoading({
  cleanText,
  fetchImpl,
  dynamicImport,
  vendorPdfJsPath,
  providedPdfJs
} = {}) {
  let pdfJsModulePromise = null;

  async function loadPdfJs() {
    if (providedPdfJs) {
      return providedPdfJs;
    }
    installPdfJsNodePolyfills();
    if (!pdfJsModulePromise) {
      const moduleUrl = vendorPdfJsPath.startsWith('file:')
        ? vendorPdfJsPath
        : `file://${vendorPdfJsPath}`;
      pdfJsModulePromise = Promise.resolve(dynamicImport(moduleUrl)).catch((error) => {
        pdfJsModulePromise = null;
        throw error;
      });
    }
    return pdfJsModulePromise;
  }

  async function readPdfBufferFromInput(input = {}) {
    const source = ensureObject(input);

    const directBuffer = Buffer.isBuffer(source.buffer) ? source.buffer : null;
    if (directBuffer) {
      return directBuffer;
    }

    if (source.uint8 instanceof Uint8Array) {
      return Buffer.from(source.uint8);
    }

    const dataUrl = cleanText(source.pdf_data_url || source.pdfDataUrl || source.data_url || source.dataUrl, 0);
    if (dataUrl) {
      const buffer = decodeDataUrlToBuffer(dataUrl);
      if (buffer && buffer.length) {
        return buffer;
      }
    }

    const base64 = cleanText(source.pdf_base64 || source.pdfBase64 || source.base64, 0);
    if (base64) {
      const buffer = decodeBase64ToBuffer(base64);
      if (buffer && buffer.length) {
        return buffer;
      }
    }

    const filePath = cleanText(source.file_path || source.filePath || source.path, 4000);
    if (filePath) {
      return fsPromises.readFile(filePath);
    }

    const url = cleanText(source.pdf_url || source.pdfUrl || source.url, 4000);
    if (url) {
      if (!fetchImpl) {
        throw new Error('PDF text extraction requires fetch support to download a remote PDF.');
      }
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: DEFAULT_FETCH_ACCEPT,
          'User-Agent': DEFAULT_USER_AGENT
        }
      });
      const status = Number(response?.status) || 0;
      if (!response?.ok) {
        throw new Error(`Failed to fetch PDF (${status || 'request failed'}).`);
      }
      if (typeof response.arrayBuffer !== 'function') {
        throw new Error('Fetched PDF response did not expose an arrayBuffer reader.');
      }
      return Buffer.from(await response.arrayBuffer());
    }

    throw new Error('PDF text extraction requires file_path, pdf_url, pdf_data_url, pdf_base64, or buffer input.');
  }

  async function flattenPdfOutline(pdfDocument, items, depth, results) {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      let pageIndex = null;
      try {
        let dest = item?.dest;
        if (typeof dest === 'string' && typeof pdfDocument.getDestination === 'function') {
          dest = await pdfDocument.getDestination(dest);
        }
        if (Array.isArray(dest) && dest.length && typeof pdfDocument.getPageIndex === 'function') {
          pageIndex = await pdfDocument.getPageIndex(dest[0]);
        }
      } catch {
        pageIndex = null;
      }
      if (Number.isInteger(pageIndex) && pageIndex >= 0) {
        results.push({
          depth,
          title: cleanText(item?.title, 240),
          page_number: pageIndex + 1
        });
      }
      if (Array.isArray(item?.items) && item.items.length) {
        await flattenPdfOutline(pdfDocument, item.items, depth + 1, results);
      }
    }
  }

  async function buildSectionsFromOutline(pdfDocument, pages, totalPages, maxCharsPerSection) {
    if (!pdfDocument || typeof pdfDocument.getOutline !== 'function') {
      return [];
    }
    let outline = null;
    try {
      outline = await pdfDocument.getOutline();
    } catch {
      return [];
    }
    if (!Array.isArray(outline) || !outline.length) {
      return [];
    }
    const flat = [];
    await flattenPdfOutline(pdfDocument, outline, 0, flat);
    if (!flat.length) {
      return [];
    }
    flat.sort((left, right) => left.page_number - right.page_number);
    const minDepth = flat.reduce((acc, entry) => Math.min(acc, entry.depth), flat[0].depth);
    const topLevel = flat.filter((entry) => entry.depth === minDepth && entry.title);
    if (topLevel.length < 2) {
      return [];
    }
    const sections = [];
    topLevel.forEach((entry, index) => {
      const next = topLevel[index + 1] || null;
      const startPage = entry.page_number;
      const endPage = next ? Math.max(next.page_number - 1, startPage) : totalPages;
      const text = pages
        .filter((page) => page.page_number >= startPage && page.page_number <= endPage)
        .map((page) => String(page.text || ''))
        .filter(Boolean)
        .join('\n\n');
      const limited = maxCharsPerSection > 0 && text.length > maxCharsPerSection
        ? text.slice(0, maxCharsPerSection)
        : text;
      sections.push({
        label: entry.title,
        normalized_label: normalizeSectionLabel(entry.title),
        source: 'outline',
        depth: entry.depth,
        start_page: startPage,
        end_page: endPage,
        character_count: limited.length,
        text: limited
      });
    });
    return sections;
  }

  async function extractPageText(page) {
    if (!page || typeof page.getTextContent !== 'function') {
      return '';
    }
    try {
      const textContent = await page.getTextContent();
      const text = joinTextItems(textContent?.items);
      return text;
    } finally {
      if (typeof page.cleanup === 'function') {
        try {
          page.cleanup();
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  }

  return {
    loadPdfJs,
    readPdfBufferFromInput,
    flattenPdfOutline,
    buildSectionsFromOutline,
    extractPageText
  };
}

module.exports = { createPdfDocumentLoading };
