'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
const { getRelatedCommentsForPaperId, normalizeRelatedComments } = require('../../shared/paper-comment-context.js');

const DEFAULT_MAX_CONTEXT_BLOCKS = 50;

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeProvider(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-');
}

function shouldUseCodexPaperContextWorkflow(input = {}) {
  const source = ensureObject(input);
  // Single tristate flag: true forces on, false forces off, absent falls back to the provider default.
  if (source.codex_paper_context === true || source.codexPaperContext === true) {
    return true;
  }
  if (source.codex_paper_context === false || source.codexPaperContext === false) {
    return false;
  }
  const provider = normalizeProvider(
    source.provider
      || source.llm_provider
      || source.llmProvider
      || source.runtime_provider
      || source.runtimeProvider
  );
  return provider === 'codex' || provider === 'codex-cli' || provider === 'codex-agent';
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildDownloadedPaperMap(downloadedPapers = [], { asArray = defaultAsArray, cleanText = defaultCleanText } = {}) {
  const byId = new Map();
  asArray(downloadedPapers).forEach((paper) => {
    const source = ensureObject(paper);
    const paperId = cleanText(source.paper_id || source.paperId, 120);
    if (paperId) {
      byId.set(paperId, source);
    }
  });
  return byId;
}

function buildPaperReadTargets(selectedPapers = [], downloadedPapers = [], helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const annotationContext = helpers.annotationContext || helpers.annotation_context || null;
  const downloadsById = buildDownloadedPaperMap(downloadedPapers, { asArray, cleanText });
  return asArray(selectedPapers).map((paper) => {
    const source = ensureObject(paper);
    const paperId = cleanText(source.paper_id || source.paperId, 120);
    const download = downloadsById.get(paperId) || {};
    return {
      paper_id: paperId,
      paper_title: cleanText(source.paper_title || source.paperTitle || source.title, 320),
      source: cleanText(source.source, 80),
      summary: cleanText(source.summary || source.snippet, 1600),
      url: cleanText(source.url, 1200),
      doi: cleanText(source.doi, 180),
      pmid: cleanText(source.pmid, 120),
      pmcid: cleanText(source.pmcid, 120),
      published_at: cleanText(source.published_at || source.publishedAt, 80),
      score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
      download: {
        ok: download.ok === true,
        status: cleanText(download.status, 80),
        file_path: cleanText(download.file_path || download.filePath, 4000),
        relative_path: cleanText(download.relative_path || download.relativePath, 2000),
        knowledge_markdown_path: cleanText(
          download.knowledge_markdown_path || download.knowledgeMarkdownPath,
          4000
        ),
        knowledge_markdown_relative_path: cleanText(
          download.knowledge_markdown_relative_path || download.knowledgeMarkdownRelativePath,
          2000
        ),
        error: cleanText(download.error, 1200)
      },
      related_comments: normalizeRelatedComments(
        getRelatedCommentsForPaperId(paperId, annotationContext),
        { asArray, cleanText }
      )
    };
  });
}

module.exports = {
  DEFAULT_MAX_CONTEXT_BLOCKS,
  buildPaperReadTargets,
  defaultAsArray,
  defaultCleanText,
  shouldUseCodexPaperContextWorkflow,
  toPositiveInteger
};
