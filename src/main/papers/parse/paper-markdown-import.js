'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { createPdfTextExtractionRuntime } = require('./agent-pdf-text-extraction.js');
const {
  buildKnowledgeDatabasePaths,
  createPaperKnowledgeDatabaseRuntime,
  normalizeDoi
} = require('../store/agent-paper-knowledge-database.js');

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

function getPaperTitle(paper = {}, filePath = '') {
  const source = ensureObject(paper);
  return cleanText(source.title || source.paper_title || source.paperTitle, 320)
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

  const title = getPaperTitle(normalizedPaper, resolvedFilePath);
  const doi = getPaperDoi(normalizedPaper);
  const expectedPaths = buildKnowledgeDatabasePaths({
    storagePath: resolvedStoragePath,
    doi,
    title
  });
  if (skipExistingMarkdown && await pathExists(expectedPaths.markdown_path)) {
    const skipped = {
      ok: true,
      status: 'ready',
      skipped: true,
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
    journal: normalizedPaper.journal || normalizedPaper.paperJournal || '',
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
  resolvePaperPdfPath,
  transformPaperPdfToMarkdown,
  transformPaperRecordsToMarkdown
};
