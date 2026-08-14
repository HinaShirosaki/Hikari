'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { createPdfTextExtractionRuntime } = require('./agent-pdf-text-extraction.js');
const {
  buildKnowledgeDatabasePaths,
  createPaperKnowledgeDatabaseRuntime,
  normalizeDoi
} = require('../store/agent-paper-knowledge-database.js');
const { isLikelyJunkPdfTitle } = require('../store/paper-knowledge-paths.js');
const { createReviewJournalSkipResult } = require('../shared/review-paper-filter.js');
const {
  findExistingPaperRow,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  queryRows,
  runStatement,
  updateJsonIndex
} = require('../store/paper-knowledge-store.js');

function cleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const numericMax = Number(maxLength);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ''));
  const child = path.resolve(String(childPath || ''));
  if (!parent || !child) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function resolvePathInsideRoot(storagePath, maybePath) {
  const source = cleanText(maybePath, 2400);
  if (!source) {
    return '';
  }
  const resolvedStoragePath = path.resolve(storagePath);
  const resolvedPath = path.isAbsolute(source)
    ? path.resolve(source)
    : path.resolve(resolvedStoragePath, source);
  return isPathInside(resolvedStoragePath, resolvedPath) ? resolvedPath : '';
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(path.resolve(rootPath), path.resolve(targetPath)).split(path.sep).join('/');
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function updateJsonFileIfPresent(filePath, updater) {
  if (!(await pathExists(filePath))) {
    return false;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  } catch {
    return false;
  }
  const next = updater(ensureObject(parsed));
  if (!next || typeof next !== 'object') {
    return false;
  }
  if (JSON.stringify(parsed) === JSON.stringify(next)) {
    return false;
  }
  await fsPromises.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

async function synchronizeTitleMarkdownReferences({
  storagePath,
  paths,
  title,
  doi
} = {}) {
  const markdownRelativePath = toPosixRelative(storagePath, paths.markdown_path);
  const nowIso = new Date().toISOString();
  await updateJsonFileIfPresent(paths.meta_path, (meta) => {
    const markdownFileName = path.basename(paths.markdown_path);
    const storedTitle = cleanText(meta.title, 320) || title;
    if (
      cleanText(meta.markdown_path || meta.markdownPath, 2400) === markdownRelativePath
      && cleanText(meta.markdown_file_name || meta.markdownFileName, 400) === markdownFileName
      && cleanText(meta.title, 320) === storedTitle
    ) {
      return meta;
    }
    return {
      ...meta,
      title: storedTitle,
      markdown_file_name: markdownFileName,
      markdown_path: markdownRelativePath,
      updated_at: nowIso
    };
  });
  await updateJsonFileIfPresent(path.join(paths.paper_folder_path, 'intake.json'), (intake) => {
    const sourcePaths = ensureObject(intake.source_paths);
    if (cleanText(sourcePaths.paper_md, 2400) === markdownRelativePath) {
      return intake;
    }
    return {
      ...intake,
      source_paths: {
        ...sourcePaths,
        paper_md: markdownRelativePath
      },
      updated_at: nowIso
    };
  });

  if (!(await pathExists(paths.sqlite_path))) {
    return '';
  }
  const folderRelativePrefix = `${toPosixRelative(storagePath, paths.paper_folder_path)}/`;
  const db = await openKnowledgeDatabase(paths.sqlite_path);
  try {
    // The stored title can differ from the import-side title (it may have come
    // from embedded PDF metadata), so fall back to the row that already points
    // into this folder -- the only row whose wiki_path the rename can dangle.
    const paper = findExistingPaperRow(db, { doi, title })
      || queryRows(db, 'SELECT * FROM papers', [])
        .find((row) => cleanText(row?.wiki_path, 2400).startsWith(folderRelativePrefix))
      || null;
    if (!paper) {
      return 'the knowledge index has no row pointing at this paper folder';
    }
    if (cleanText(paper.wiki_path, 2400) === markdownRelativePath) {
      return '';
    }
    runStatement(
      db,
      'UPDATE papers SET wiki_path = ?, updated_at = ? WHERE id = ?',
      [markdownRelativePath, nowIso, paper.id]
    );
    await persistKnowledgeDatabase(paths.sqlite_path, db);
    const updated = queryRows(db, 'SELECT * FROM papers WHERE id = ? LIMIT 1', [paper.id])[0];
    if (updated) {
      await updateJsonIndex(paths.json_index_path, updated);
    }
    return '';
  } finally {
    db.close();
  }
}

async function ensureTitleNamedKnowledgeMarkdown({ storagePath, paths, title, doi } = {}) {
  if (!paths?.markdown_path || paths.markdown_path === paths.legacy_markdown_path) {
    return { ready: await pathExists(paths?.markdown_path || ''), migrated: false, warning: '' };
  }
  let migrated = false;
  if (!(await pathExists(paths.markdown_path))) {
    // The recorded path is the name actually on disk. Without it, a paper whose
    // title changed after ingest matches neither the title-derived name nor
    // `paper.md`, and the caller re-extracts the whole PDF on every scan.
    const recorded = paths.recorded_markdown_path;
    const source = (recorded && recorded !== paths.markdown_path && await pathExists(recorded))
      ? recorded
      : ((await pathExists(paths.legacy_markdown_path)) ? paths.legacy_markdown_path : '');
    if (!source) {
      return { ready: false, migrated: false, warning: '' };
    }
    // Move, not copy: a second stale Markdown in the folder outlives every
    // refresh and can win the reader's candidate scan.
    await fsPromises.rename(source, paths.markdown_path);
    migrated = true;
  }
  let warning = '';
  // Only a real migration needs the reference sweep. Running it on every
  // already-converted paper reloads and re-serializes the whole SQLite index
  // once per paper, on a path that is awaited before the UI hydrates.
  if (migrated) {
    try {
      const issue = await synchronizeTitleMarkdownReferences({ storagePath, paths, title, doi });
      if (issue) {
        warning = `Title-named Markdown is in place, but ${issue}.`;
      }
    } catch (error) {
      warning = `Title-named Markdown was created, but stored references could not all be updated: ${cleanText(error?.message || error, 600)}`;
    }
  }
  return { ready: true, migrated, warning };
}

function resolvePaperPdfPath(storagePath, paper = {}, filePath = '') {
  const source = ensureObject(paper);
  const explicitPath = resolvePathInsideRoot(storagePath, filePath);
  if (explicitPath) {
    return explicitPath;
  }
  return resolvePathInsideRoot(storagePath, source.storedRelativePath)
    || resolvePathInsideRoot(storagePath, source.storedFilePath)
    || '';
}

function rebaseKnowledgePathsToRecordedFolder(storagePath, paths = {}, paper = {}) {
  const source = ensureObject(paper);
  const recordedPath = resolvePathInsideRoot(
    storagePath,
    source.knowledgeMarkdownRelativePath
      || source.knowledge_markdown_relative_path
      || source.transformed_markdown_relative_path
  );
  if (!recordedPath) {
    return paths;
  }
  const paperFolderPath = path.dirname(recordedPath);
  const paperRootPath = path.resolve(paths.papers_path || '');
  if (!paperRootPath || !isPathInside(paperRootPath, paperFolderPath)) {
    return paths;
  }
  return {
    ...paths,
    paper_folder_name: path.basename(paperFolderPath),
    paper_folder_path: paperFolderPath,
    // Kept so the caller can find the file that actually exists on disk, whose
    // name may predate the current title.
    recorded_markdown_path: recordedPath,
    markdown_path: path.join(paperFolderPath, paths.markdown_file_name || path.basename(paths.markdown_path)),
    legacy_markdown_path: path.join(paperFolderPath, 'paper.md'),
    extracted_text_path: path.join(paperFolderPath, 'extracted.txt'),
    meta_path: path.join(paperFolderPath, 'meta.json'),
    figures_path: path.join(paperFolderPath, 'figures')
  };
}

function getPaperTitle(paper = {}, filePath = '') {
  const source = ensureObject(paper);
  const pdfMetadata = ensureObject(source.pdfMetadata || source.pdf_metadata);
  const embeddedTitle = isLikelyJunkPdfTitle(pdfMetadata.title) ? '' : pdfMetadata.title;
  return cleanText(embeddedTitle, 320)
    || cleanText(source.title || source.paper_title || source.paperTitle, 320)
    || cleanText(source.fileName || source.file_name, 320).replace(/\.pdf$/i, '')
    || cleanText(path.basename(filePath || ''), 320).replace(/\.pdf$/i, '')
    || 'Untitled paper';
}

function getPaperDoi(paper = {}) {
  const source = ensureObject(paper);
  return normalizeDoi(source.doi || source.paper_doi || source.paperDoi);
}

function applyKnowledgeResultToPaper(paper, result = {}) {
  if (!paper || typeof paper !== 'object') {
    return;
  }
  const status = cleanText(result.status, 80) || (result.ok === true ? 'ready' : '');
  const markdownRelativePath = cleanText(result.markdown_relative_path, 2400)
    || cleanText(result.knowledge_markdown_relative_path, 2400);
  if (markdownRelativePath) {
    paper.knowledgeMarkdownRelativePath = markdownRelativePath;
  }
  const extractedRelativePath = cleanText(result.extracted_text_relative_path, 2400);
  if (extractedRelativePath) {
    paper.knowledgeExtractedTextRelativePath = extractedRelativePath;
  }
  const metaRelativePath = cleanText(result.meta_relative_path, 2400);
  if (metaRelativePath) {
    paper.knowledgeMetaRelativePath = metaRelativePath;
  }
  if (status) {
    paper.knowledgeStatus = status;
  }
  if (cleanText(result.wiki_generation_method, 120)) {
    paper.knowledgeGenerationMethod = cleanText(result.wiki_generation_method, 120);
  }
  paper.knowledgeUpdatedAt = new Date().toISOString();
}

function createDefaultPaperKnowledgeRuntime(pdfTextExtractionRuntime = null) {
  const extractionRuntime = pdfTextExtractionRuntime || createPdfTextExtractionRuntime({
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
  });
  return createPaperKnowledgeDatabaseRuntime({
    pdfTextExtractionRuntime: extractionRuntime,
    requestAssistantText: async () => ({
      ok: false,
      error: 'LLM rewrite is disabled for automatic PDF-to-Markdown import.'
    })
  });
}

async function transformPaperPdfToMarkdown({
  storagePath = '',
  paper = {},
  filePath = '',
  pdfTextExtractionRuntime = null,
  paperKnowledgeDatabaseRuntime = null,
  skipExistingMarkdown = true,
  source = 'auto-discovery'
} = {}) {
  const storagePathText = cleanText(storagePath, 2400);
  if (!storagePathText) {
    return { ok: false, status: 'error', error: 'Missing storage path.' };
  }
  const resolvedStoragePath = path.resolve(storagePathText);
  const normalizedPaper = ensureObject(paper);
  const resolvedFilePath = resolvePaperPdfPath(resolvedStoragePath, normalizedPaper, filePath);
  if (!resolvedFilePath || !/\.pdf$/i.test(resolvedFilePath)) {
    return { ok: true, status: 'skipped', skipped: true, reason: 'not_pdf' };
  }
  if (!(await pathExists(resolvedFilePath))) {
    return { ok: false, status: 'missing', error: `Paper PDF was not found at ${resolvedFilePath}.` };
  }

  const journal = cleanText(
    normalizedPaper.journal || normalizedPaper.paper_journal || normalizedPaper.paperJournal,
    320
  );
  const reviewJournalSkip = createReviewJournalSkipResult(journal);
  if (reviewJournalSkip) {
    applyKnowledgeResultToPaper(normalizedPaper, reviewJournalSkip);
    return reviewJournalSkip;
  }

  const title = getPaperTitle(normalizedPaper, resolvedFilePath);
  const doi = getPaperDoi(normalizedPaper);
  const expectedPaths = rebaseKnowledgePathsToRecordedFolder(resolvedStoragePath, buildKnowledgeDatabasePaths({
    storagePath: resolvedStoragePath,
    doi,
    title
  }), normalizedPaper);
  const existingMarkdown = skipExistingMarkdown
    ? await ensureTitleNamedKnowledgeMarkdown({
      storagePath: resolvedStoragePath,
      paths: expectedPaths,
      title,
      doi
    })
    : { ready: false, migrated: false };
  if (skipExistingMarkdown && existingMarkdown.ready) {
    const skipped = {
      ok: true,
      status: 'ready',
      skipped: true,
      migrated_legacy_markdown: existingMarkdown.migrated,
      warning: existingMarkdown.warning,
      markdown_path: expectedPaths.markdown_path,
      markdown_relative_path: toPosixRelative(resolvedStoragePath, expectedPaths.markdown_path),
      extracted_text_path: expectedPaths.extracted_text_path,
      extracted_text_relative_path: toPosixRelative(resolvedStoragePath, expectedPaths.extracted_text_path),
      meta_path: expectedPaths.meta_path,
      meta_relative_path: toPosixRelative(resolvedStoragePath, expectedPaths.meta_path),
      summary: `Paper Markdown already exists at ${toPosixRelative(resolvedStoragePath, expectedPaths.markdown_path)}.`
    };
    applyKnowledgeResultToPaper(normalizedPaper, skipped);
    return skipped;
  }

  const runtime = paperKnowledgeDatabaseRuntime || createDefaultPaperKnowledgeRuntime(pdfTextExtractionRuntime);
  if (!runtime || typeof runtime.ingestPaperPdf !== 'function') {
    return { ok: false, status: 'error', error: 'Paper knowledge runtime is unavailable.' };
  }
  const result = await runtime.ingestPaperPdf({
    storage_path: resolvedStoragePath,
    file_path: resolvedFilePath,
    paper_title: title,
    doi,
    authors: normalizedPaper.authors || normalizedPaper.paperAuthors || [],
    journal,
    year: normalizedPaper.year || normalizedPaper.publishedAt || normalizedPaper.published_at || '',
    url: normalizedPaper.url || normalizedPaper.paperUrl || normalizedPaper.paper_url || '',
    linked_type: normalizedPaper.linkedType || normalizedPaper.linked_type,
    linked_name: normalizedPaper.linkedName || normalizedPaper.linked_name,
    source,
    use_llm_rewrite: false,
    allow_fallback_markdown: true,
    max_pages: 500,
    max_total_chars: 800000
  });
  if (result?.ok === true) {
    applyKnowledgeResultToPaper(normalizedPaper, result);
  }
  return result;
}

async function transformPaperRecordsToMarkdown({
  storagePath = '',
  papers = [],
  pdfTextExtractionRuntime = null,
  paperKnowledgeDatabaseRuntime = null,
  skipExistingMarkdown = true,
  source = 'auto-discovery'
} = {}) {
  const rows = asArray(papers);
  const summary = {
    transformed: 0,
    skipped: 0,
    failed: 0,
    items: [],
    warnings: []
  };
  let sharedRuntime = paperKnowledgeDatabaseRuntime || null;
  for (const paper of rows) {
    try {
      if (!sharedRuntime) {
        sharedRuntime = createDefaultPaperKnowledgeRuntime(pdfTextExtractionRuntime);
      }
      const result = await transformPaperPdfToMarkdown({
        storagePath,
        paper,
        paperKnowledgeDatabaseRuntime: sharedRuntime,
        skipExistingMarkdown,
        source
      });
      if (result?.skipped) {
        summary.skipped += 1;
      } else if (result?.ok === true) {
        summary.transformed += 1;
      } else {
        summary.failed += 1;
        summary.warnings.push(cleanText(result?.error, 1200) || 'Failed to transform paper PDF to Markdown.');
      }
      if (result && result.status !== 'skipped') {
        summary.items.push({
          ok: result.ok === true,
          status: cleanText(result.status, 80),
          paper_id: cleanText(paper?.id, 220),
          markdown_relative_path: cleanText(result.markdown_relative_path, 2400),
          error: cleanText(result.error, 1200)
        });
      }
    } catch (error) {
      summary.failed += 1;
      summary.warnings.push(cleanText(error?.message || error, 1200) || 'Failed to transform paper PDF to Markdown.');
    }
  }
  return summary;
}

module.exports = {
  applyKnowledgeResultToPaper,
  ensureTitleNamedKnowledgeMarkdown,
  rebaseKnowledgePathsToRecordedFolder,
  resolvePaperPdfPath,
  transformPaperPdfToMarkdown,
  transformPaperRecordsToMarkdown
};
