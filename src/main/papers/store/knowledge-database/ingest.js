'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { createReviewJournalSkipResult } = require('../../shared/review-paper-filter.js');
const { ensureObject } = require('../../../lib/normalize.js');
const { buildExtractedTextFile } = require('../../parse/pdf-to-md.js');
const {
  KNOWLEDGE_BASE_FOLDER_NAME,
  buildKnowledgeDatabasePaths,
  buildRelativePath,
  ensurePathWithinRoot,
  normalizeDoi,
  resolveStoragePath
} = require('../paper-knowledge-paths.js');
const {
  looksLikePdfBuffer,
  sha256Buffer
} = require('../paper-knowledge-store.js');
const { FIGURE_STAGING_FOLDER_NAME, normalizeMarkdown } = require('./helpers.js');

// The whole write path for one PDF: validate, store, extract text and figures,
// generate markdown, index it, and hand it to intake.
function createPaperIngest({
  cleanText,
  now,
  pdfTextExtractionRuntime,
  runPaperIntake,
  reconcileFiguresDir,
  normalizeMetadata,
  generateKnowledgeMarkdown,
  upsertKnowledgeIndex
} = {}) {
  async function ingestPaperPdf(input = {}) {
    const source = ensureObject(input);
    const storagePath = resolveStoragePath(source, cleanText);
    if (!storagePath) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper knowledge ingestion requires storage_path.'
      };
    }
    const rawFilePath = cleanText(source.file_path || source.filePath || source.path, 4000);
    if (!rawFilePath) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper knowledge ingestion requires file_path.'
      };
    }
    const resolvedStoragePath = path.resolve(storagePath);
    let resolvedFilePath = '';
    try {
      resolvedFilePath = ensurePathWithinRoot(resolvedStoragePath, rawFilePath);
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200)
      };
    }

    const reviewJournalSkip = createReviewJournalSkipResult(
      source.journal || source.paper_journal || source.paperJournal
    );
    if (reviewJournalSkip) {
      return reviewJournalSkip;
    }

    let pdfBuffer = null;
    try {
      pdfBuffer = await fsPromises.readFile(resolvedFilePath);
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200) || 'Failed to read paper PDF.'
      };
    }
    if (!looksLikePdfBuffer(pdfBuffer)) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper knowledge ingestion requires a PDF file.'
      };
    }

    if (!pdfTextExtractionRuntime || typeof pdfTextExtractionRuntime.extractText !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'PDF text extraction runtime is not configured.'
      };
    }

    const pdfSha256 = sha256Buffer(pdfBuffer);
    // Figures are extracted before the canonical title is known, so stage them
    // under a content-addressed scratch folder OUTSIDE papers.md. A title-derived
    // provisional folder can collide with a different paper's real folder, and
    // reconcileFiguresDir would then rm/rename that paper's figures away.
    const provisionalFiguresDir = path.join(
      resolvedStoragePath,
      KNOWLEDGE_BASE_FOLDER_NAME,
      FIGURE_STAGING_FOLDER_NAME,
      `paper-${String(pdfSha256).slice(0, 16)}`
    );
    const figuresEnabled = source.extract_figures !== false && source.extractFigures !== false;
    const extraction = await pdfTextExtractionRuntime.extractText({
      action: 'extract',
      file_path: resolvedFilePath,
      include_pages: true,
      include_sections: true,
      max_pages: Number(source.max_pages || source.maxPages) || 300,
      max_total_chars: Number(source.max_total_chars || source.maxTotalChars) || 500000,
      figures_output_dir: figuresEnabled ? provisionalFiguresDir : '',
      figure_min_dimension: Number(source.figure_min_dimension || source.figureMinDimension) || undefined,
      figure_min_pixels: Number(source.figure_min_pixels || source.figureMinPixels) || undefined
    }).catch((error) => ({
      ok: false,
      status: 'error',
      error: cleanText(error?.message || error, 1200)
    }));
    const extractionStatus = extraction?.ok === true ? 'ready' : 'failed';
    const metadata = {
      ...normalizeMetadata(source, extraction, pdfSha256),
      linked_type: cleanText(source.linked_type || source.linkedType, 80),
      linked_name: cleanText(source.linked_name || source.linkedName, 220)
    };
    const explicitDoi = normalizeDoi(source.doi || source.paper_doi || source.paperDoi);
    // The folder is the paper's identity, so it stays keyed on the title the
    // caller supplied. Letting embedded PDF metadata move it would re-home an
    // already-ingested paper and defeat title-based dedup.
    const identityTitle = cleanText(source.title || source.paper_title || source.paperTitle, 320)
      || metadata.title;
    const paths = buildKnowledgeDatabasePaths({
      storagePath: resolvedStoragePath,
      doi: explicitDoi,
      title: identityTitle,
      markdownTitle: metadata.title,
      pdfSha256
    });

    const extractedText = extraction?.ok === true ? buildExtractedTextFile(extraction) : '';
    await fsPromises.mkdir(paths.paper_folder_path, { recursive: true });
    await fsPromises.writeFile(paths.extracted_text_path, extractedText, 'utf8');

    const figureDescriptors = await reconcileFiguresDir({
      provisionalDir: provisionalFiguresDir,
      canonicalDir: paths.figures_path,
      paperFolderPath: paths.paper_folder_path,
      figures: Array.isArray(extraction?.figures) ? extraction.figures : []
    });

    const markdownResult = extraction?.ok === true
      ? await generateKnowledgeMarkdown({
        ...source,
        metadata,
        extraction,
        extractedText,
        figures: figureDescriptors,
        source_pdf_relative_path: buildRelativePath(resolvedStoragePath, resolvedFilePath),
        allowFallbackMarkdown: source.allow_fallback_markdown !== false && source.allowFallbackMarkdown !== false
      })
      : {
        ok: false,
        status: 'failed',
        method: '',
        error: cleanText(extraction?.error, 1200) || 'PDF text extraction failed.'
      };
    const wikiStatus = markdownResult?.ok === true ? 'ready' : 'failed';
    if (markdownResult?.markdown) {
      await fsPromises.writeFile(paths.markdown_path, `${normalizeMarkdown(markdownResult.markdown)}\n`, 'utf8');
    }

    const nowIso = now();
    const figuresRelativeDir = figureDescriptors.length
      ? buildRelativePath(resolvedStoragePath, paths.figures_path)
      : '';
    const meta = {
      version: 1,
      title: metadata.title,
      doi: metadata.doi,
      authors: metadata.authors,
      journal: metadata.journal,
      year: metadata.year,
      url: metadata.url,
      pdf_sha256: metadata.pdf_sha256,
      source_pdf_path: buildRelativePath(resolvedStoragePath, resolvedFilePath),
      extraction_status: extractionStatus,
      wiki_status: wikiStatus,
      wiki_generation_method: markdownResult?.method || '',
      extracted_text_path: buildRelativePath(resolvedStoragePath, paths.extracted_text_path),
      markdown_file_name: paths.markdown_file_name,
      markdown_path: buildRelativePath(resolvedStoragePath, paths.markdown_path),
      sqlite_path: buildRelativePath(resolvedStoragePath, paths.sqlite_path),
      figures_path: figuresRelativeDir,
      figure_count: figureDescriptors.length,
      figures: figureDescriptors.map((figure) => ({
        page_number: figure.page_number,
        image_index: figure.image_index,
        file_name: figure.file_name,
        relative_path: figuresRelativeDir
          ? `${figuresRelativeDir}/${figure.file_name}`
          : `figures/${figure.file_name}`,
        width: figure.width,
        height: figure.height,
        kind: figure.kind || 0,
        byte_length: figure.byte_length || 0
      })),
      figures_error: cleanText(extraction?.figures_error, 1200),
      updated_at: nowIso,
      error: cleanText(markdownResult?.error || extraction?.error, 1200),
      warning: cleanText(markdownResult?.warning, 1200)
    };
    const indexResult = await upsertKnowledgeIndex({
      paths, metadata, meta, filePath: resolvedFilePath, nowIso
    });

    const paperIntake = wikiStatus === 'ready'
      ? await runPaperIntake({
        source,
        storagePath: resolvedStoragePath,
        paperFolderName: paths.paper_folder_name,
        metadata
      })
      : null;

    return {
      ok: wikiStatus === 'ready',
      status: wikiStatus,
      paper_id: indexResult.paper_id,
      title: metadata.title,
      doi: metadata.doi,
      pdf_sha256: metadata.pdf_sha256,
      knowledge_folder_path: paths.paper_folder_path,
      knowledge_folder_relative_path: buildRelativePath(resolvedStoragePath, paths.paper_folder_path),
      markdown_path: paths.markdown_path,
      markdown_relative_path: buildRelativePath(resolvedStoragePath, paths.markdown_path),
      extracted_text_path: paths.extracted_text_path,
      extracted_text_relative_path: buildRelativePath(resolvedStoragePath, paths.extracted_text_path),
      meta_path: paths.meta_path,
      meta_relative_path: buildRelativePath(resolvedStoragePath, paths.meta_path),
      sqlite_path: paths.sqlite_path,
      sqlite_relative_path: buildRelativePath(resolvedStoragePath, paths.sqlite_path),
      source_pdf_path: resolvedFilePath,
      source_pdf_relative_path: buildRelativePath(resolvedStoragePath, resolvedFilePath),
      figures_path: figureDescriptors.length ? paths.figures_path : '',
      figures_relative_path: figuresRelativeDir,
      figure_count: figureDescriptors.length,
      figures: meta.figures,
      extraction_status: extractionStatus,
      wiki_generation_method: markdownResult?.method || '',
      paper_intake: paperIntake,
      paper_intake_status: paperIntake?.status || (wikiStatus === 'ready' ? 'skipped' : ''),
      paper_intake_error: cleanText(paperIntake?.error, 1200),
      error: cleanText(markdownResult?.error || extraction?.error, 1200),
      warning: cleanText(markdownResult?.warning, 1200),
      summary: wikiStatus === 'ready'
        ? `Wrote paper knowledge markdown to ${buildRelativePath(resolvedStoragePath, paths.markdown_path)}${figureDescriptors.length ? ` with ${figureDescriptors.length} figure(s)` : ''}.`
        : (cleanText(markdownResult?.error || extraction?.error, 600) || 'Paper knowledge ingestion failed.')
    };
  }

  return {
    ingestPaperPdf
  };
}

module.exports = { createPaperIngest };
