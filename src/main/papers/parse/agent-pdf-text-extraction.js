'use strict';

const path = require('node:path');
const { Buffer } = require('node:buffer');
const { buildPdfMarkdownFromExtraction } = require('./pdf-to-md.js');
const { stripRunningHeadersAndFooters } = require('./pdf-text-layout.js');
const { extractFiguresFromPdfDocument } = require('./pdf-figure-extraction.js');
const { ensureObject } = require('../../lib/normalize.js');

const DEFAULT_VENDOR_PDFJS_PATH = path.resolve(__dirname, '../../../../vendor/pdfjs/build/pdf.mjs');
const DEFAULT_VENDOR_PDFJS_ROOT = path.resolve(__dirname, '../../../../vendor/pdfjs');
const {
  DEFAULT_MAX_CHARS_PER_PAGE,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_TOTAL_CHARS,
  PDF_TEXT_EXTRACTION_ACTIONS
} = require('./pdf-text-extraction/constants.js');
const {
  bufferLooksLikePdf,
  normalizeAction,
  normalizeInteger,
  normalizePageRange,
  withTrailingSeparator
} = require('./pdf-text-extraction/input-normalizing.js');
const { defaultCleanText, normalizeEmbeddedPdfMetadata } = require('./pdf-text-extraction/pdf-metadata.js');
const { buildSectionsFromHeadings, detectHeadingFromLine, detectHeadingsFromPages, normalizeSectionLabel } = require('./pdf-text-extraction/sections.js');
const { createPdfDocumentLoading } = require('./pdf-text-extraction/document-loading.js');

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



  const {
    loadPdfJs,
    readPdfBufferFromInput,
    buildSectionsFromOutline,
    extractPageText
  } = createPdfDocumentLoading({
    cleanText,
    fetchImpl,
    dynamicImport,
    vendorPdfJsPath,
    providedPdfJs
  });

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
