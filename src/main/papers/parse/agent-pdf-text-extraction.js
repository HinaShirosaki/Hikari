'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { buildPdfMarkdownFromExtraction } = require('./pdf-to-md.js');
const { joinTextItems, stripRunningHeadersAndFooters } = require('./pdf-text-layout.js');
const { extractFiguresFromPdfDocument } = require('./pdf-figure-extraction.js');

const PDF_TEXT_EXTRACTION_ACTIONS = Object.freeze({
  EXTRACT: 'extract'
});

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_CHARS_PER_PAGE = 20000;
const DEFAULT_MAX_TOTAL_CHARS = 400000;
const DEFAULT_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; HikariPdfTextExtraction/1.0; +https://hikari.local)';
const DEFAULT_VENDOR_PDFJS_PATH = path.resolve(__dirname, '../../../../vendor/pdfjs/build/pdf.mjs');
const DEFAULT_VENDOR_PDFJS_ROOT = path.resolve(__dirname, '../../../../vendor/pdfjs');

class PdfTextDomMatrix {
  constructor(init) {
    const values = Array.isArray(init) || ArrayBuffer.isView(init)
      ? Array.from(init)
      : null;
    const source = values || ensureObject(init);
    this.a = numberOrDefault(values ? values[0] : source.a ?? source.m11, 1);
    this.b = numberOrDefault(values ? values[1] : source.b ?? source.m12, 0);
    this.c = numberOrDefault(values ? values[2] : source.c ?? source.m21, 0);
    this.d = numberOrDefault(values ? values[3] : source.d ?? source.m22, 1);
    this.e = numberOrDefault(values ? values[4] : source.e ?? source.m41, 0);
    this.f = numberOrDefault(values ? values[5] : source.f ?? source.m42, 0);
    this.is2D = true;
  }

  get m11() { return this.a; }
  set m11(value) { this.a = Number(value) || 0; }
  get m12() { return this.b; }
  set m12(value) { this.b = Number(value) || 0; }
  get m21() { return this.c; }
  set m21(value) { this.c = Number(value) || 0; }
  get m22() { return this.d; }
  set m22(value) { this.d = Number(value) || 0; }
  get m41() { return this.e; }
  set m41(value) { this.e = Number(value) || 0; }
  get m42() { return this.f; }
  set m42(value) { this.f = Number(value) || 0; }

  multiply(other) {
    return new PdfTextDomMatrix(this).multiplySelf(other);
  }

  multiplySelf(other) {
    const matrix = new PdfTextDomMatrix(other);
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;
    return this.#set(a, b, c, d, e, f);
  }

  preMultiplySelf(other) {
    const matrix = new PdfTextDomMatrix(other);
    const a = matrix.a * this.a + matrix.c * this.b;
    const b = matrix.b * this.a + matrix.d * this.b;
    const c = matrix.a * this.c + matrix.c * this.d;
    const d = matrix.b * this.c + matrix.d * this.d;
    const e = matrix.a * this.e + matrix.c * this.f + matrix.e;
    const f = matrix.b * this.e + matrix.d * this.f + matrix.f;
    return this.#set(a, b, c, d, e, f);
  }

  translate(tx = 0, ty = 0) {
    return new PdfTextDomMatrix(this).translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf([1, 0, 0, 1, numberOrDefault(tx, 0), numberOrDefault(ty, 0)]);
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new PdfTextDomMatrix(this).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf([numberOrDefault(scaleX, 1), 0, 0, numberOrDefault(scaleY, 1), 0, 0]);
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) {
      return this.#set(NaN, NaN, NaN, NaN, NaN, NaN);
    }
    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;
    return this.#set(a, b, c, d, e, f);
  }

  toFloat32Array() {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  toFloat64Array() {
    return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  #set(a, b, c, d, e, f) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }
}

function defaultCleanText(value, maxLength = 4000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  const numericMax = Number(maxLength);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readPdfMetadataValue(metadata, keys = []) {
  const source = ensureObject(metadata);
  for (const key of keys) {
    let value = '';
    try {
      value = typeof metadata?.get === 'function' ? metadata.get(key) : source[key];
    } catch {
      value = '';
    }
    const cleaned = defaultCleanText(value, 1000).trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return '';
}

function normalizeEmbeddedPdfMetadata(payload = {}) {
  const source = ensureObject(payload);
  const info = ensureObject(source.info);
  const metadata = source.metadata;
  return {
    title: readPdfMetadataValue(metadata, ['dc:title', 'citation_title', 'prism:title', 'title'])
      || defaultCleanText(info.Title, 320).trim(),
    author: readPdfMetadataValue(metadata, ['dc:creator', 'citation_author', 'author'])
      || defaultCleanText(info.Author, 1000).trim(),
    subject: readPdfMetadataValue(metadata, ['dc:description', 'description', 'subject'])
      || defaultCleanText(info.Subject, 2000).trim(),
    keywords: readPdfMetadataValue(metadata, ['pdf:keywords', 'keywords'])
      || defaultCleanText(info.Keywords, 2000).trim()
  };
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function installPdfJsNodePolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = PdfTextDomMatrix;
  }
  // pdf.js 4+ relies on the TC39 stage-3 `Map.prototype.getOrInsertComputed`,
  // which Node does not yet ship. Without this polyfill `getOperatorList()`
  // (and therefore figure extraction) throws on every call.
  if (typeof Map.prototype.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value(key, callbackfn) {
        if (this.has(key)) {
          return this.get(key);
        }
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true
    });
  }
}

function withTrailingSeparator(value) {
  const text = String(value || '');
  return text.endsWith(path.sep) ? text : `${text}${path.sep}`;
}

function normalizeInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, min), max);
}

function normalizeAction(value) {
  const normalized = defaultCleanText(value, 40).toLowerCase();
  if (!normalized) {
    return PDF_TEXT_EXTRACTION_ACTIONS.EXTRACT;
  }
  return Object.values(PDF_TEXT_EXTRACTION_ACTIONS).includes(normalized) ? normalized : '';
}

function bufferLooksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function decodeDataUrlToBuffer(rawDataUrl) {
  const text = String(rawDataUrl || '').trim();
  if (!text.startsWith('data:')) {
    return null;
  }
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) {
    return null;
  }
  const meta = text.slice(5, commaIndex);
  const payload = text.slice(commaIndex + 1);
  const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
  try {
    return isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  } catch {
    return null;
  }
}

function decodeBase64ToBuffer(rawBase64) {
  const text = String(rawBase64 || '').trim();
  if (!text) {
    return null;
  }
  try {
    return Buffer.from(text, 'base64');
  } catch {
    return null;
  }
}

function normalizePageRange(rawStart, rawEnd, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  const start = normalizeInteger(rawStart, 1, { min: 1, max: total });
  const end = normalizeInteger(rawEnd, total, { min: start, max: total });
  return { start, end };
}

function normalizeSectionLabel(rawLabel) {
  const text = String(rawLabel || '')
    .trim()
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/^[ivxlcdm]+\.\s+/, '')
    .replace(/[:.\-—]\s*$/, '')
    .trim();
  if (!text) {
    return '';
  }
  if (/^abstract\b/.test(text)) return 'abstract';
  if (/^(introduction|background)\b/.test(text)) return 'introduction';
  if (/^(materials?\s+and\s+methods?|methods?\s+and\s+materials|methods?|methodology|experimental(?:\s+(?:section|procedures?))?)\b/.test(text)) return 'methods';
  if (/^results?(?:\s+and\s+discussion)?\b/.test(text)) return 'results';
  if (/^(discussion|findings)\b/.test(text)) return 'discussion';
  if (/^(conclusions?|concluding\s+remarks|summary)\b/.test(text)) return 'conclusion';
  if (/^(references|bibliography|works\s+cited|literature\s+cited)\b/.test(text)) return 'references';
  if (/^acknowled?g(?:e)?ments?\b/.test(text)) return 'acknowledgments';
  if (/^funding\b/.test(text)) return 'funding';
  if (/^online\s+content\b/.test(text)) return 'online_content';
  if (/^reporting\s+summary\b/.test(text)) return 'reporting_summary';
  if (/^(competing\s+interests|conflicts?\s+of\s+interest|declarations?)\b/.test(text)) return 'declarations';
  if (/^(supplement(?:ary)?\s+(?:material|information)|supporting\s+information)\b/.test(text)) return 'supplementary';
  if (/^(appendix|appendices)\b/.test(text)) return 'appendix';
  if (/^author\s+(?:contributions?|information)\b/.test(text)) return 'author_contributions';
  if (/^(data|code)\s+availability\b/.test(text)) return 'data_availability';
  return '';
}

function formatDetectedHeadingLabel(label, normalizedLabel) {
  const canonicalLabels = {
    abstract: 'Abstract',
    introduction: 'Introduction',
    methods: 'Methods',
    results: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    references: 'References',
    acknowledgments: 'Acknowledgements',
    funding: 'Funding',
    online_content: 'Online content',
    reporting_summary: 'Reporting summary',
    declarations: 'Declarations',
    supplementary: 'Supplementary information',
    appendix: 'Appendix',
    author_contributions: 'Author contributions',
    data_availability: 'Data availability'
  };
  return canonicalLabels[normalizedLabel] || label;
}

function detectHeadingFromLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length > 180) {
    return null;
  }
  const stripped = trimmed
    .replace(/^[\d]+(?:\.[\d]+)*\.?\s+/, '')
    .replace(/^[ivxlcdm]+\.\s+/i, '')
    .replace(/[:.\-—]\s*$/, '')
    .trim();
  if (!stripped || stripped.length > 160) {
    return null;
  }
  if (/^[a-z]/.test(stripped)) {
    return null;
  }
  const normalizedLabel = normalizeSectionLabel(stripped);
  if (!normalizedLabel) {
    return null;
  }
  return {
    label: formatDetectedHeadingLabel(trimmed, normalizedLabel),
    normalized_label: normalizedLabel
  };
}

function detectHeadingsFromPages(pages) {
  const headings = [];
  pages.forEach((page) => {
    const pageNumber = Number(page?.page_number);
    if (!Number.isFinite(pageNumber)) {
      return;
    }
    String(page.text || '')
      .split('\n')
      .forEach((line, lineIndex) => {
        const heading = detectHeadingFromLine(line);
        if (!heading) {
          return;
        }
        headings.push({
          page_number: pageNumber,
          line_index: lineIndex,
          label: heading.label,
          normalized_label: heading.normalized_label
        });
      });
  });
  // Drop duplicate canonical headings on the same page, while preserving
  // repeated real sections such as main-text References and Methods References.
  const seen = new Set();
  return headings.filter((heading) => {
    const key = `${heading.normalized_label}:${heading.page_number}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectPageLinesBetween(pages, startPoint, endPoint) {
  const sectionLines = [];
  pages.forEach((page) => {
    const pageNumber = Number(page.page_number);
    if (pageNumber < startPoint.page_number || pageNumber > endPoint.page_number) {
      return;
    }
    const lines = String(page.text || '').split('\n');
    let startIndex = 0;
    let endIndex = lines.length;
    if (pageNumber === startPoint.page_number) {
      startIndex = Math.min(lines.length, Math.max(0, Number(startPoint.line_index) || 0));
    }
    if (pageNumber === endPoint.page_number) {
      endIndex = Math.min(lines.length, Math.max(startIndex, Number(endPoint.line_index) || 0));
    }
    for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line) {
        sectionLines.push(line);
      }
    }
  });
  return sectionLines;
}

function buildSectionsFromHeadings(pages, headings, maxCharsPerSection) {
  if (!Array.isArray(headings) || !headings.length) {
    return [];
  }
  const lastPageNumber = Number(pages[pages.length - 1]?.page_number) || 0;
  const sections = [];
  const firstPageNumber = Number(pages[0]?.page_number) || 1;
  const firstHeading = headings[0];
  const frontMatterLines = collectPageLinesBetween(
    pages,
    { page_number: firstPageNumber, line_index: 0 },
    { page_number: firstHeading.page_number, line_index: firstHeading.line_index }
  );
  if (frontMatterLines.length) {
    const text = frontMatterLines.join('\n');
    const limited = maxCharsPerSection > 0 && text.length > maxCharsPerSection
      ? text.slice(0, maxCharsPerSection)
      : text;
    sections.push({
      label: 'Front matter',
      normalized_label: 'front_matter',
      source: 'heuristic',
      start_page: firstPageNumber,
      end_page: firstHeading.page_number,
      character_count: limited.length,
      text: limited
    });
  }
  headings.forEach((current, index) => {
    const next = headings[index + 1] || null;
    const startPage = current.page_number;
    const endPage = next ? next.page_number : lastPageNumber;
    const sectionLines = collectPageLinesBetween(
      pages,
      { page_number: startPage, line_index: current.line_index + 1 },
      next
        ? { page_number: next.page_number, line_index: next.line_index }
        : { page_number: lastPageNumber, line_index: Number.MAX_SAFE_INTEGER }
    );
    const text = sectionLines.join('\n');
    const limited = maxCharsPerSection > 0 && text.length > maxCharsPerSection
      ? text.slice(0, maxCharsPerSection)
      : text;
    sections.push({
      label: current.label,
      normalized_label: current.normalized_label,
      source: 'heuristic',
      start_page: startPage,
      end_page: endPage,
      character_count: limited.length,
      text: limited
    });
  });
  return sections;
}

function createPdfTextExtractionRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const dynamicImport = typeof deps.importEsm === 'function'
    ? deps.importEsm
    : ((specifier) => import(specifier));
  const vendorPdfJsPath = cleanText(deps.vendorPdfJsPath, 4000) || DEFAULT_VENDOR_PDFJS_PATH;
  const vendorPdfJsRoot = cleanText(deps.vendorPdfJsRoot, 4000) || DEFAULT_VENDOR_PDFJS_ROOT;
  const providedPdfJs = deps.pdfJsLib && typeof deps.pdfJsLib === 'object' ? deps.pdfJsLib : null;

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

  async function extractText(input = {}) {
    const source = ensureObject(input);
    const action = normalizeAction(source.action);
    if (!action) {
      return {
        ok: false,
        status: 'error',
        error: 'action must be "extract".'
      };
    }

    const maxPages = normalizeInteger(source.max_pages || source.maxPages, DEFAULT_MAX_PAGES, { min: 1, max: 5000 });
    const maxCharsPerPage = normalizeInteger(
      source.max_chars_per_page || source.maxCharsPerPage,
      DEFAULT_MAX_CHARS_PER_PAGE,
      { min: 200, max: 200000 }
    );
    const maxTotalChars = normalizeInteger(
      source.max_total_chars || source.maxTotalChars,
      DEFAULT_MAX_TOTAL_CHARS,
      { min: 1000, max: 5000000 }
    );
    const maxCharsPerSection = normalizeInteger(
      source.max_chars_per_section || source.maxCharsPerSection,
      maxTotalChars,
      { min: 500, max: 1000000 }
    );
    const includePages = source.include_pages !== false && source.includePages !== false;
    const includeSections = source.include_sections !== false && source.includeSections !== false;
    const includeMarkdown = source.include_markdown === true
      || source.includeMarkdown === true
      || cleanText(source.output_format || source.outputFormat, 80).toLowerCase() === 'markdown';
    const figuresOutputDir = cleanText(source.figures_output_dir || source.figuresOutputDir, 4000);
    const figureMinDimension = normalizeInteger(
      source.figure_min_dimension || source.figureMinDimension,
      32,
      { min: 1, max: 10000 }
    );
    const figureMinPixels = normalizeInteger(
      source.figure_min_pixels || source.figureMinPixels,
      figureMinDimension * figureMinDimension,
      { min: 1, max: 100000000 }
    );

    let pdfBuffer;
    try {
      pdfBuffer = await readPdfBufferFromInput(source);
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200) || 'Failed to read PDF input.'
      };
    }

    if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.length) {
      return {
        ok: false,
        status: 'error',
        error: 'PDF input was empty.'
      };
    }
    if (!bufferLooksLikePdf(pdfBuffer)) {
      return {
        ok: false,
        status: 'error',
        error: 'Input does not start with the %PDF- header.'
      };
    }

    let pdfjsLib;
    try {
      pdfjsLib = await loadPdfJs();
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200) || 'Failed to load pdf.js runtime.'
      };
    }

    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'pdf.js runtime did not expose getDocument().'
      };
    }

    let pdfDocument = null;
    let loadingTask = null;
    try {
      loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        cMapUrl: withTrailingSeparator(path.join(vendorPdfJsRoot, 'web', 'cmaps')),
        standardFontDataUrl: withTrailingSeparator(path.join(vendorPdfJsRoot, 'web', 'standard_fonts')),
        wasmUrl: withTrailingSeparator(path.join(vendorPdfJsRoot, 'web', 'wasm')),
        useWorkerFetch: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        isEvalSupported: false
      });
      pdfDocument = await loadingTask.promise;
      let embeddedMetadata = {};
      if (typeof pdfDocument?.getMetadata === 'function') {
        try {
          embeddedMetadata = normalizeEmbeddedPdfMetadata(await pdfDocument.getMetadata());
        } catch {
          embeddedMetadata = {};
        }
      }

      const totalPages = Number(pdfDocument?.numPages) || 0;
      if (!totalPages) {
        const emptyResult = {
          ok: true,
          status: 'completed',
          page_count: 0,
          extracted_page_count: 0,
          total_characters: 0,
          truncated: false,
          embedded_metadata: embeddedMetadata,
          text: '',
          pages: includePages ? [] : undefined,
          sections: includeSections ? [] : undefined,
          sections_source: includeSections ? '' : undefined,
          summary: 'PDF contained no pages.'
        };
        if (includeMarkdown) {
          emptyResult.markdown = buildPdfMarkdownFromExtraction({
            metadata: source.metadata || source,
            extraction: emptyResult,
            extractedText: '',
            sourcePdfPath: source.file_path || source.filePath || source.path || ''
          });
        }
        return emptyResult;
      }

      const { start, end } = normalizePageRange(
        source.start_page || source.startPage,
        source.end_page || source.endPage,
        totalPages
      );
      const lastTargetPage = Math.min(end, start + maxPages - 1);

      const internalPages = [];
      const textChunks = [];
      let totalCharacters = 0;
      let truncatedByTotal = false;

      for (let pageNumber = start; pageNumber <= lastTargetPage; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const rawText = await extractPageText(page);
        const limitedText = rawText.length > maxCharsPerPage
          ? rawText.slice(0, maxCharsPerPage)
          : rawText;
        const remainingBudget = Math.max(0, maxTotalChars - totalCharacters);
        const finalText = limitedText.length > remainingBudget
          ? limitedText.slice(0, remainingBudget)
          : limitedText;
        if (finalText.length < limitedText.length) {
          truncatedByTotal = true;
        }
        internalPages.push({
          page_number: pageNumber,
          character_count: finalText.length,
          text: finalText
        });
        if (finalText) {
          textChunks.push(finalText);
        }
        totalCharacters += finalText.length;
        if (totalCharacters >= maxTotalChars) {
          truncatedByTotal = true;
          break;
        }
      }

      const truncatedByPageLimit = lastTargetPage < end;
      const cleanedPages = stripRunningHeadersAndFooters(internalPages);
      if (cleanedPages !== internalPages) {
        internalPages.length = 0;
        internalPages.push(...cleanedPages);
      }
      const fullText = internalPages
        .map((page) => String(page.text || ''))
        .filter(Boolean)
        .join('\n\n');

      let sections = [];
      let sectionsSource = '';
      if (includeSections) {
        try {
          const outlineSections = await buildSectionsFromOutline(
            pdfDocument,
            internalPages,
            totalPages,
            maxCharsPerSection
          );
          if (outlineSections.length) {
            sections = outlineSections;
            sectionsSource = 'outline';
          }
        } catch {
          // Fall through to heuristic detection.
        }
        if (!sections.length) {
          const headings = detectHeadingsFromPages(internalPages);
          if (headings.length) {
            sections = buildSectionsFromHeadings(internalPages, headings, maxCharsPerSection);
            sectionsSource = 'heuristic';
          }
        }
      }

      let figures;
      let figuresError = '';
      if (figuresOutputDir) {
        try {
          figures = await extractFiguresFromPdfDocument({
            pdfDocument,
            outputDir: figuresOutputDir,
            startPage: start,
            endPage: Math.min(lastTargetPage, end),
            minDimension: figureMinDimension,
            minPixels: figureMinPixels
          });
        } catch (error) {
          figures = [];
          figuresError = cleanText(error?.message || error, 1200) || 'Figure extraction failed.';
        }
      }

      const result = {
        ok: true,
        status: 'completed',
        page_count: totalPages,
        extracted_page_count: internalPages.length,
        start_page: start,
        end_page: Math.min(lastTargetPage, end),
        total_characters: totalCharacters,
        truncated: truncatedByTotal || truncatedByPageLimit,
        truncation_reason: truncatedByTotal
          ? 'max_total_chars'
          : (truncatedByPageLimit ? 'max_pages' : ''),
        embedded_metadata: embeddedMetadata,
        text: fullText,
        pages: includePages ? internalPages : undefined,
        sections: includeSections ? sections : undefined,
        sections_source: includeSections ? sectionsSource : undefined,
        figures: figuresOutputDir ? (figures || []) : undefined,
        figures_output_dir: figuresOutputDir || undefined,
        figures_error: figuresError || undefined,
        summary: internalPages.length || totalCharacters
          ? `Extracted text from ${internalPages.length} page(s) (${totalCharacters} characters)${sections.length ? `, ${sections.length} section(s) via ${sectionsSource}` : ''}${figures?.length ? `, ${figures.length} figure(s)` : ''}.`
          : 'No extractable text was found in the PDF.'
      };
      if (includeMarkdown) {
        result.markdown = buildPdfMarkdownFromExtraction({
          metadata: source.metadata || source,
          extraction: result,
          extractedText: fullText,
          sourcePdfPath: source.file_path || source.filePath || source.path || ''
        });
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200) || 'PDF text extraction failed.'
      };
    } finally {
      if (pdfDocument && typeof pdfDocument.destroy === 'function') {
        try {
          await pdfDocument.destroy();
        } catch {
          // Ignore destroy errors.
        }
      } else if (loadingTask && typeof loadingTask.destroy === 'function') {
        try {
          await loadingTask.destroy();
        } catch {
          // Ignore destroy errors.
        }
      }
    }
  }

  async function execute(input = {}) {
    const source = ensureObject(input);
    const action = normalizeAction(source.action);
    if (!action) {
      return {
        ok: false,
        status: 'error',
        error: 'action must be "extract".'
      };
    }
    return extractText(source);
  }

  return {
    PDF_TEXT_EXTRACTION_ACTIONS,
    extractText,
    execute
  };
}

module.exports = {
  PDF_TEXT_EXTRACTION_ACTIONS,
  normalizeSectionLabel,
  detectHeadingFromLine,
  detectHeadingsFromPages,
  buildSectionsFromHeadings,
  normalizeEmbeddedPdfMetadata,
  createPdfTextExtractionRuntime
};
