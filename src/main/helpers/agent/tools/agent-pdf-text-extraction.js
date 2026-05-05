'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const PDF_TEXT_EXTRACTION_ACTIONS = Object.freeze({
  EXTRACT: 'extract'
});

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_CHARS_PER_PAGE = 20000;
const DEFAULT_MAX_TOTAL_CHARS = 400000;
const DEFAULT_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; HikariPdfTextExtraction/1.0; +https://hikari.local)';
const DEFAULT_VENDOR_PDFJS_PATH = path.resolve(__dirname, '../../../../../vendor/pdfjs/build/pdf.mjs');

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

function joinTextItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return '';
  }
  const lines = [];
  let currentLine = '';
  items.forEach((item) => {
    if (!item) {
      return;
    }
    const str = typeof item.str === 'string' ? item.str : '';
    if (str) {
      currentLine = currentLine ? `${currentLine}${str}` : str;
    }
    if (item.hasEOL) {
      lines.push(currentLine);
      currentLine = '';
    } else if (str && !str.endsWith(' ')) {
      currentLine = `${currentLine} `;
    }
  });
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
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
  if (/^(competing\s+interests|conflicts?\s+of\s+interest|declarations?)\b/.test(text)) return 'declarations';
  if (/^(supplement(?:ary)?(?:\s+(?:material|information|data|figures?|tables?))?|supporting\s+information)\b/.test(text)) return 'supplementary';
  if (/^(appendix|appendices)\b/.test(text)) return 'appendix';
  if (/^author\s+(?:contributions?|information)\b/.test(text)) return 'author_contributions';
  if (/^(data|code)\s+availability\b/.test(text)) return 'data_availability';
  return '';
}

function detectHeadingFromLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length > 80) {
    return null;
  }
  const stripped = trimmed
    .replace(/^[\d]+(?:\.[\d]+)*\.?\s+/, '')
    .replace(/^[ivxlcdm]+\.\s+/i, '')
    .replace(/[:.\-—]\s*$/, '')
    .trim();
  if (!stripped || stripped.length > 60) {
    return null;
  }
  const normalizedLabel = normalizeSectionLabel(stripped);
  if (!normalizedLabel) {
    return null;
  }
  return {
    label: trimmed,
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
  // Drop duplicate canonical headings — keep the first occurrence.
  const seen = new Set();
  return headings.filter((heading) => {
    if (seen.has(heading.normalized_label)) {
      return false;
    }
    seen.add(heading.normalized_label);
    return true;
  });
}

function buildSectionsFromHeadings(pages, headings, maxCharsPerSection) {
  if (!Array.isArray(headings) || !headings.length) {
    return [];
  }
  const lastPageNumber = Number(pages[pages.length - 1]?.page_number) || 0;
  const sections = [];
  headings.forEach((current, index) => {
    const next = headings[index + 1] || null;
    const startPage = current.page_number;
    const endPage = next ? next.page_number : lastPageNumber;
    const sectionLines = [];
    pages.forEach((page) => {
      const pageNumber = Number(page.page_number);
      if (pageNumber < startPage || pageNumber > endPage) {
        return;
      }
      const lines = String(page.text || '').split('\n');
      let startIndex = 0;
      let endIndex = lines.length;
      if (pageNumber === current.page_number) {
        startIndex = current.line_index + 1;
      }
      if (next && pageNumber === next.page_number) {
        endIndex = next.line_index;
      }
      for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
        const line = lines[lineIndex];
        if (line) {
          sectionLines.push(line);
        }
      }
    });
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
  const providedPdfJs = deps.pdfJsLib && typeof deps.pdfJsLib === 'object' ? deps.pdfJsLib : null;

  let pdfJsModulePromise = null;

  async function loadPdfJs() {
    if (providedPdfJs) {
      return providedPdfJs;
    }
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
    if (!topLevel.length) {
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
      maxCharsPerPage * 4,
      { min: 500, max: 1000000 }
    );
    const includePages = source.include_pages !== false && source.includePages !== false;
    const includeSections = source.include_sections !== false && source.includeSections !== false;

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
        useWorkerFetch: false,
        disableFontFace: true,
        isEvalSupported: false
      });
      pdfDocument = await loadingTask.promise;

      const totalPages = Number(pdfDocument?.numPages) || 0;
      if (!totalPages) {
        return {
          ok: true,
          status: 'completed',
          page_count: 0,
          extracted_page_count: 0,
          total_characters: 0,
          truncated: false,
          text: '',
          pages: includePages ? [] : undefined,
          sections: includeSections ? [] : undefined,
          sections_source: includeSections ? '' : undefined,
          summary: 'PDF contained no pages.'
        };
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
      const fullText = textChunks.join('\n\n');

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

      return {
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
        text: fullText,
        pages: includePages ? internalPages : undefined,
        sections: includeSections ? sections : undefined,
        sections_source: includeSections ? sectionsSource : undefined,
        summary: internalPages.length || totalCharacters
          ? `Extracted text from ${internalPages.length} page(s) (${totalCharacters} characters)${sections.length ? `, ${sections.length} section(s) via ${sectionsSource}` : ''}.`
          : 'No extractable text was found in the PDF.'
      };
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
  createPdfTextExtractionRuntime
};
