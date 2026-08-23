'use strict';

const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { normalizePmid, normalizePmcid } = require('../identity/paper-identity.js');
const { createIntakePipeline } = require('./intake/intake-pipeline.js');
const { createReviewJournalSkipResult } = require('../shared/review-paper-filter.js');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const {
  buildExtractedTextFile,
  buildPdfMarkdownFromExtraction
} = require('../parse/pdf-to-md.js');
const {
  KNOWLEDGE_BASE_FOLDER_NAME,
  KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
  KNOWLEDGE_DATABASE_FOLDER_NAME,
  KNOWLEDGE_PAPERS_FOLDER_NAME,
  LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
  LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_INDEX_FILE_NAME,
  KNOWLEDGE_JSON_INDEX_FILE_NAME,
  normalizeDoi,
  extractDoiFromText,
  normalizeYear,
  buildKnowledgePaperSlug,
  buildKnowledgeMarkdownFileName,
  isLikelyJunkPdfTitle,
  ensurePathWithinRoot,
  buildRelativePath,
  resolveRelativeStoragePath,
  resolveStoragePath,
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  getPaperScope
} = require('./paper-knowledge-paths.js');
const {
  looksLikePdfBuffer,
  sha256Buffer,
  queryRows,
  runStatement,
  migratePaperColumns,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  findExistingPaperRow,
  buildPaperId,
  writeJsonFile,
  pathExists,
  updateJsonIndex,
  chooseLocation
} = require('./paper-knowledge-store.js');

const DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT = 120000;
// Scratch area for figures extracted before the paper's canonical folder is
// known. Lives beside papers.md so listPaperIds() never enumerates it.
const FIGURE_STAGING_FOLDER_NAME = '.figures-staging';

function asArrayDefault(value) {
  return Array.isArray(value) ? value : [];
}

function limitText(value, maxLength = 4000) {
  const text = String(value || '');
  const numericMax = Number(maxLength);
  if (!text || !Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function isExplicitFalse(value) {
  if (value === false) {
    return true;
  }
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
}

function guessTitleFromText(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.length >= 6 && line.length <= 220);
  return lines[0] || '';
}

function buildMarkdownRewritePrompt({ metadata = {}, extraction = {}, extractedText = '', figures = [], maxPromptChars = DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT } = {}) {
  const promptText = limitText(extractedText, maxPromptChars);
  const sectionSummary = asArrayDefault(extraction.sections)
    .slice(0, 24)
    .map((section) => ({
      label: section?.label || section?.normalized_label || '',
      start_page: section?.start_page || section?.page_number || null,
      end_page: section?.end_page || section?.page_number || null
    }));
  const figureSummary = asArrayDefault(figures)
    .map((figure) => ({
      page_number: figure?.page_number || null,
      relative_path: figure?.relative_path || `figures/${figure?.file_name || ''}`,
      width: figure?.width || null,
      height: figure?.height || null
    }))
    .filter((figure) => figure.relative_path && figure.relative_path !== 'figures/');
  return [
    'Rewrite this scientific paper into dense wiki-form Markdown for a future LLM reader.',
    'Use only the extracted paper text. Do not add outside knowledge.',
    'Make every important claim traceable to a page using citations like `(p. 4)` or `(pp. 4-5)`.',
    'Keep it self-contained, concise, and link-ready. Use `[[doi]]` only for clearly named related papers already present in the text.',
    figureSummary.length
      ? 'Embed extracted figures inline near their captions using `![Figure on page N](relative_path)`; only use the relative paths listed in "Available figures JSON".'
      : '',
    'Return Markdown only with this skeleton:',
    '# <Title>',
    '**Authors:** ...   **Year:** ...   **DOI:** ...',
    '## TL;DR',
    '## Background',
    '## Methods',
    '## Key results',
    '## Figures & tables',
    '## Limitations',
    '## How it relates',
    '## Verbatim quotes',
    '',
    `Metadata JSON:\n${JSON.stringify(metadata, null, 2)}`,
    `Detected sections JSON:\n${JSON.stringify(sectionSummary, null, 2)}`,
    figureSummary.length ? `Available figures JSON:\n${JSON.stringify(figureSummary, null, 2)}` : '',
    `Extracted text with page markers:\n${promptText}`
  ].filter(Boolean).join('\n\n');
}

function extractLlmText(result = {}) {
  if (typeof result === 'string') {
    return result;
  }
  const source = ensureObject(result);
  return String(source.text || source.assistant_message || source.message || source.output_text || '').trim();
}

function normalizeMarkdown(markdown = '') {
  const text = String(markdown || '').trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return text;
}

function createPaperKnowledgeDatabaseRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    requestAssistantText
  } = createAgentLlmRuntimeHelpers(deps);
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const pdfTextExtractionRuntime = deps.pdfTextExtractionRuntime && typeof deps.pdfTextExtractionRuntime === 'object'
    ? deps.pdfTextExtractionRuntime
    : null;
  const paperWikiChunkerRuntime = deps.paperWikiChunkerRuntime && typeof deps.paperWikiChunkerRuntime === 'object'
    ? deps.paperWikiChunkerRuntime
    : null;
  const injectedPaperIntakePipeline = deps.paperIntakePipeline
    && typeof deps.paperIntakePipeline.runIntakeForPaper === 'function'
    ? deps.paperIntakePipeline
    : null;

  async function runPaperIntake({ source = {}, storagePath = '', paperFolderName = '', metadata = {} } = {}) {
    if (!paperFolderName || isExplicitFalse(source.paper_intake) || isExplicitFalse(source.paperIntake)) {
      return null;
    }
    const pipeline = injectedPaperIntakePipeline || createIntakePipeline({
      ...deps,
      workspacePath: storagePath,
      fs: fsPromises
    });
    if (!pipeline || typeof pipeline.runIntakeForPaper !== 'function') {
      return {
        ok: false,
        status: 'executor_unavailable',
        error: 'Paper intake pipeline is unavailable.'
      };
    }
    return pipeline.runIntakeForPaper({
      paperId: paperFolderName,
      title: metadata.title,
      doi: metadata.doi,
      traceContext: source.traceContext || null
    }).catch((error) => ({
      ok: false,
      status: 'failed',
      error: cleanText(error?.message || error, 1200) || 'Paper intake pipeline failed.'
    }));
  }

  async function reconcileFiguresDir({ provisionalDir, canonicalDir, paperFolderPath, figures } = {}) {
    const descriptors = Array.isArray(figures) ? figures : [];
    if (!descriptors.length || !canonicalDir) {
      return descriptors.map((figure) => ({ ...figure }));
    }
    let activeDir = canonicalDir;
    if (provisionalDir && provisionalDir !== canonicalDir) {
      try {
        await fsPromises.mkdir(paperFolderPath, { recursive: true });
        try {
          await fsPromises.rm(canonicalDir, { recursive: true, force: true });
        } catch {
          // ignore — target may not exist
        }
        await fsPromises.rename(provisionalDir, canonicalDir);
      } catch {
        // If rename fails, keep figures where they landed.
        activeDir = provisionalDir;
      }
    }
    return descriptors.map((figure) => {
      const fileName = figure?.file_name || '';
      return {
        ...figure,
        file_path: fileName ? path.join(activeDir, fileName) : (figure?.file_path || '')
      };
    });
  }

  function normalizeMetadata(input = {}, extraction = {}, pdfSha256 = '') {
    const source = ensureObject(input);
    const embeddedMetadata = ensureObject(extraction.embedded_metadata || extraction.embeddedMetadata);
    const extractedText = String(extraction.text || '');
    const doi = normalizeDoi(
      source.doi
      || source.paper_doi
      || source.paperDoi
      || extractDoiFromText(extractedText)
    );
    const authors = asArray(source.authors || source.paper_authors || source.paperAuthors)
      .map((author) => cleanText(typeof author === 'string' ? author : (author?.name || author?.family || ''), 240))
      .filter(Boolean)
      .slice(0, 80);
    const embeddedTitle = isLikelyJunkPdfTitle(embeddedMetadata.title) ? '' : embeddedMetadata.title;
    const title = cleanText(
      embeddedTitle
      || source.title
      || source.paper_title
      || source.paperTitle
      || source.file_name
      || guessTitleFromText(extractedText),
      320
    );
    return {
      doi,
      pmid: normalizePmid(source.pmid || source.paper_pmid || source.paperPmid),
      pmcid: normalizePmcid(source.pmcid || source.paper_pmcid || source.paperPmcid),
      title,
      abstract: cleanText(source.abstract || source.paper_abstract || source.paperAbstract, 12000),
      authors,
      journal: cleanText(source.journal || source.paper_journal || source.paperJournal, 320),
      year: normalizeYear(source.year || source.published_at || source.publishedAt || source.date),
      url: cleanText(source.url || source.page_url || source.pageUrl || source.paper_url || source.paperUrl, 2000),
      pdf_sha256: pdfSha256,
      source: cleanText(source.source, 80) || 'agent',
      notes: cleanText(source.notes, 4000)
    };
  }

  async function generateKnowledgeMarkdown(input = {}) {
    const source = ensureObject(input);
    const metadata = ensureObject(source.metadata);
    const extraction = ensureObject(source.extraction);
    const extractedText = String(source.extractedText || '');
    if (source.use_llm_rewrite === false || source.useLlmRewrite === false) {
      return {
        ok: true,
        status: 'ready',
        method: 'pdf-to-md',
        markdown: buildPdfMarkdownFromExtraction({
          metadata,
          extraction,
          extractedText,
          figures: asArrayDefault(source.figures),
          sourcePdfPath: source.file_path || source.filePath || source.path || '',
          sourcePdfRelativePath: source.source_pdf_relative_path || source.sourcePdfRelativePath || '',
          transformedAt: now(),
          includePages: false
        })
      };
    }
    const figures = asArrayDefault(source.figures);
    const prompt = buildMarkdownRewritePrompt({
      metadata,
      extraction,
      extractedText,
      figures,
      maxPromptChars: Number(source.maxPromptChars) || DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT
    });

    const llmResult = await requestAssistantText({
      source: ensureObject(source.llmSource || source.source),
      provider: cleanText(source.provider, 80),
      endpoint: cleanText(source.endpoint, 2000),
      apiKey: cleanText(source.apiKey, 400),
      model: cleanText(source.model, 120),
      stage: 'paper_knowledge_wiki_rewrite',
      systemPrompt: [
        'You create LLM-facing scientific-paper knowledge notes.',
        'Return Markdown only. Stay faithful to the supplied extracted text.'
      ].join(' '),
      userPrompt: prompt,
      traceContext: source.traceContext || null,
      defaultError: 'Paper knowledge rewrite provider is not configured.'
    }).catch((error) => ({
      ok: false,
      error: cleanText(error?.message || error, 1200)
    }));

    const markdown = normalizeMarkdown(extractLlmText(llmResult));
    if (llmResult?.ok === true && markdown) {
      return {
        ok: true,
        status: 'ready',
        method: 'llm',
        markdown
      };
    }

    if (source.allowFallbackMarkdown === false) {
      return {
        ok: false,
        status: 'failed',
        method: 'llm',
        error: cleanText(llmResult?.error, 1200) || 'Paper knowledge rewrite failed.'
      };
    }

    return {
      ok: true,
      status: 'ready',
      method: 'pdf-to-md-fallback',
      markdown: buildPdfMarkdownFromExtraction({
        metadata,
        extraction,
        extractedText,
        figures,
        sourcePdfPath: source.file_path || source.filePath || source.path || '',
        sourcePdfRelativePath: source.source_pdf_relative_path || source.sourcePdfRelativePath || '',
        transformedAt: now(),
        includePages: false
      }),
      warning: cleanText(llmResult?.error, 1200)
    };
  }

  async function upsertKnowledgeIndex({ paths, metadata, filePath, paperId, extractionStatus, wikiStatus, nowIso }) {
    const db = await openKnowledgeDatabase(paths.sqlite_path);
    try {
      const existing = findExistingPaperRow(db, {
        doi: metadata.doi,
        pmid: metadata.pmid,
        pmcid: metadata.pmcid,
        pdfSha256: metadata.pdf_sha256,
        title: metadata.title
      });
      const resolvedPaperId = paperId || buildPaperId({
        existing,
        doi: metadata.doi,
        pdfSha256: metadata.pdf_sha256,
        title: metadata.title
      });
      const previousAddedAt = cleanText(existing?.added_at, 80) || nowIso;
      const wikiPath = buildRelativePath(paths.storage_path, paths.markdown_path);
      const folderPath = buildRelativePath(paths.storage_path, path.dirname(filePath));
      const pdfPath = buildRelativePath(paths.storage_path, filePath);
      const locationId = crypto.createHash('sha256')
        .update(`${resolvedPaperId}:${pdfPath}`)
        .digest('hex')
        .slice(0, 24);
      const location = {
        id: `location-${locationId}`,
        paper_id: resolvedPaperId,
        scope: getPaperScope(metadata.linked_type),
        container: metadata.linked_name || '',
        folder_path: folderPath,
        pdf_filename: path.basename(filePath),
        pdf_path: pdfPath,
        discovered_at: nowIso
      };
      runStatement(db, `
        INSERT INTO papers (
          id, doi, pmid, pmcid, title, abstract, authors_json, journal, year, url, pdf_sha256,
          added_at, updated_at, source, wiki_status, wiki_path, extraction_status, notes
        ) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          doi = COALESCE(excluded.doi, papers.doi),
          pmid = COALESCE(excluded.pmid, papers.pmid),
          pmcid = COALESCE(excluded.pmcid, papers.pmcid),
          title = excluded.title,
          abstract = excluded.abstract,
          authors_json = excluded.authors_json,
          journal = excluded.journal,
          year = excluded.year,
          url = excluded.url,
          pdf_sha256 = COALESCE(excluded.pdf_sha256, papers.pdf_sha256),
          updated_at = excluded.updated_at,
          source = excluded.source,
          wiki_status = excluded.wiki_status,
          wiki_path = excluded.wiki_path,
          extraction_status = excluded.extraction_status,
          notes = excluded.notes
      `, [
        resolvedPaperId,
        metadata.doi,
        metadata.pmid,
        metadata.pmcid,
        metadata.title,
        metadata.abstract,
        JSON.stringify(metadata.authors || []),
        metadata.journal,
        metadata.year,
        metadata.url,
        metadata.pdf_sha256,
        previousAddedAt,
        nowIso,
        metadata.source,
        wikiStatus,
        wikiPath,
        extractionStatus,
        metadata.notes
      ]);
      runStatement(db, `
        INSERT INTO paper_locations (
          id, paper_id, scope, container, folder_path, pdf_filename, pdf_path, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          paper_id = excluded.paper_id,
          scope = excluded.scope,
          container = excluded.container,
          folder_path = excluded.folder_path,
          pdf_filename = excluded.pdf_filename,
          pdf_path = excluded.pdf_path,
          discovered_at = excluded.discovered_at
      `, [
        location.id,
        location.paper_id,
        location.scope,
        location.container,
        location.folder_path,
        location.pdf_filename,
        location.pdf_path,
        location.discovered_at
      ]);
      await persistKnowledgeDatabase(paths.sqlite_path, db);
      await updateJsonIndex(paths.json_index_path, {
        id: resolvedPaperId,
        doi: metadata.doi,
        title: metadata.title,
        pdf_sha256: metadata.pdf_sha256,
        wiki_status: wikiStatus,
        wiki_path: wikiPath,
        extraction_status: extractionStatus,
        updated_at: nowIso
      }, location);
      return {
        paper_id: resolvedPaperId,
        wiki_path: wikiPath,
        location
      };
    } finally {
      db.close();
    }
  }

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
    const indexResult = await upsertKnowledgeIndex({
      paths,
      metadata,
      filePath: resolvedFilePath,
      extractionStatus,
      wikiStatus,
      nowIso
    });
    const figuresRelativeDir = figureDescriptors.length
      ? buildRelativePath(resolvedStoragePath, paths.figures_path)
      : '';
    const meta = {
      version: 1,
      paper_id: indexResult.paper_id,
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
    await writeJsonFile(paths.meta_path, meta);

    const paperIntake = wikiStatus === 'ready'
      ? await runPaperIntake({
        source,
        storagePath: resolvedStoragePath,
        paperFolderName: paths.paper_folder_name,
        metadata
      })
      : null;

    let chunkResult = null;
    if (wikiStatus === 'ready' && paperWikiChunkerRuntime && typeof paperWikiChunkerRuntime.chunkPaperMarkdown === 'function') {
      chunkResult = await paperWikiChunkerRuntime.chunkPaperMarkdown({
        storage_path: resolvedStoragePath,
        paper_id: indexResult.paper_id
      }).catch((error) => ({
        ok: false,
        error: cleanText(error?.message || error, 1200) || 'Wiki chunking failed.'
      }));
    }

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
      wiki_chunk_status: chunkResult?.ok === true ? 'ready' : (chunkResult ? 'failed' : 'skipped'),
      wiki_chunk_count: Number.isFinite(chunkResult?.chunk_count) ? chunkResult.chunk_count : 0,
      wiki_chunk_error: cleanText(chunkResult?.error, 1200),
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

  async function lookupPaper(input = {}) {
    const source = ensureObject(input);
    const storagePath = resolveStoragePath(source, cleanText);
    if (!storagePath) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper knowledge lookup requires storage_path.'
      };
    }
    const lookupIdentity = {
      storagePath,
      doi: source.doi || source.paper_doi || source.paperDoi,
      title: source.title || source.paper_title || source.paperTitle
    };
    const pathCandidates = [
      buildKnowledgeDatabasePaths(lookupIdentity),
      buildLegacyKnowledgeDatabasePaths(lookupIdentity)
    ];
    let indexAvailable = false;

    for (let index = 0; index < pathCandidates.length; index += 1) {
      const paths = pathCandidates[index];
      if (index > 0 && !(await pathExists(paths.sqlite_path))) {
        continue;
      }
      const db = await openKnowledgeDatabase(paths.sqlite_path).catch(() => null);
      if (!db) {
        continue;
      }
      indexAvailable = true;
      const paper = findExistingPaperRow(db, {
        doi: source.doi || source.paper_doi || source.paperDoi,
        pmid: source.pmid || source.paper_pmid || source.paperPmid,
        pmcid: source.pmcid || source.paper_pmcid || source.paperPmcid,
        title: source.title || source.paper_title || source.paperTitle
      });
      if (!paper) {
        db.close();
        continue;
      }
      let locations = [];
      try {
        locations = queryRows(db, 'SELECT * FROM paper_locations WHERE paper_id = ?', [paper.id]);
      } finally {
        db.close();
      }
      const selectedLocation = chooseLocation(
        locations,
        getPaperScope(source.linked_type || source.linkedType),
        cleanText(source.linked_name || source.linkedName, 220)
      );
      const markdownPath = paper.wiki_path ? resolveRelativeStoragePath(storagePath, paper.wiki_path) : '';
      const pdfPath = selectedLocation?.pdf_path
        ? resolveRelativeStoragePath(storagePath, selectedLocation.pdf_path)
        : '';
      const pdfExists = pdfPath
        ? await pathExists(pdfPath)
        : false;
      const markdownExists = markdownPath
        ? await pathExists(markdownPath)
        : false;
      return {
        ok: true,
        status: 'found',
        paper: {
          id: cleanText(paper.id, 180),
          doi: cleanText(paper.doi, 180),
          pmid: cleanText(paper.pmid, 120),
          pmcid: cleanText(paper.pmcid, 120),
          title: cleanText(paper.title, 320),
          wiki_status: cleanText(paper.wiki_status, 80),
          wiki_path: cleanText(paper.wiki_path, 2000),
          wiki_file_path: markdownPath,
          wiki_exists: markdownExists,
          pdf_sha256: cleanText(paper.pdf_sha256, 120),
          pdf_path: cleanText(selectedLocation?.pdf_path, 2000),
          pdf_file_path: pdfPath,
          pdf_exists: pdfExists,
          location: cloneJson(selectedLocation || {}, null)
        },
        summary: markdownExists
          ? `Found paper knowledge markdown at ${paper.wiki_path}.`
          : 'Found paper record, but the markdown file is missing.'
      };
    }
    if (!indexAvailable) {
      return {
        ok: false,
        status: 'missing',
        error: 'Paper knowledge index is not available.'
      };
    }
    return {
      ok: false,
      status: 'missing',
      summary: 'Paper was not found in the knowledge database.'
    };
  }

  return {
    KNOWLEDGE_BASE_FOLDER_NAME,
    KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
    KNOWLEDGE_DATABASE_FOLDER_NAME,
    KNOWLEDGE_PAPERS_FOLDER_NAME,
    LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
    LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
    KNOWLEDGE_INDEX_FILE_NAME,
    KNOWLEDGE_JSON_INDEX_FILE_NAME,
    buildKnowledgeDatabasePaths,
    buildLegacyKnowledgeDatabasePaths,
    buildKnowledgePaperSlug,
    buildKnowledgeMarkdownFileName,
    generateKnowledgeMarkdown,
    ingestPaperPdf,
    lookupPaper
  };
}

// Path/slug helpers live in ./paper-knowledge-paths.js and the SQLite + index
// layer in ./paper-knowledge-store.js. They are re-exported here so existing
// importers (paper-markdown-import, tests) keep working against the original
// module surface. ponytail: re-export shim during the strangler split; point
// new code at the focused modules directly.
module.exports = {
  KNOWLEDGE_BASE_FOLDER_NAME,
  KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
  KNOWLEDGE_DATABASE_FOLDER_NAME,
  KNOWLEDGE_PAPERS_FOLDER_NAME,
  LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
  LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_INDEX_FILE_NAME,
  KNOWLEDGE_JSON_INDEX_FILE_NAME,
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  buildKnowledgePaperSlug,
  buildKnowledgeMarkdownFileName,
  normalizeDoi,
  createPaperKnowledgeDatabaseRuntime,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  migratePaperColumns,
  findExistingPaperRow,
  queryRows,
  runStatement
};
