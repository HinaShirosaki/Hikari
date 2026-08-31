'use strict';

/**
 * Parsing + normalization of the Codex paper-context sub-agent's response.
 *
 * The sub-agent returns free-form text that should contain a JSON object;
 * these pure helpers extract it (tolerating code fences / surrounding prose)
 * and normalize it into the structured shapes the workflow expects — selected
 * papers, context blocks, and line-range selections — with defensible defaults
 * and caps. Split out of codex-paper-context-workflow.js so this "parse
 * untrusted LLM output" logic has one home and is unit-testable.
 */

const { normalizeLineRanges } = require('./paper-line-ranges.js');
const { ensureObject } = require('../../lib/normalize.js');
const {
  attachRelatedCommentsToContextBlocks,
  normalizeRelatedComments
} = require('../shared/paper-comment-context.js');

// Independent cap on how many blocks/selections a payload may contribute.
const DEFAULT_MAX_CONTEXT_BLOCKS = 50;

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  return String(value || '');
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonObjectFromText(raw = '') {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeSelectedPaper(rawPaper = {}, fallback = {}, { cleanText = defaultCleanText } = {}) {
  const source = ensureObject(rawPaper);
  const base = ensureObject(fallback);
  return {
    paper_id: cleanText(source.paper_id || source.paperId || base.paper_id || base.paperId, 120),
    paper_title: cleanText(
      source.paper_title
        || source.paperTitle
        || source.title
        || base.paper_title
        || base.paperTitle
        || base.title,
      320
    ),
    source: cleanText(source.source || base.source, 80),
    summary: cleanText(source.summary || base.summary || base.snippet, 1200),
    url: cleanText(source.url || base.url, 1200),
    doi: cleanText(source.doi || base.doi, 180),
    pmid: cleanText(source.pmid || base.pmid, 120),
    pmcid: cleanText(source.pmcid || base.pmcid, 120),
    pdf_urls: Array.isArray(source.pdf_urls || source.pdfUrls)
      ? (source.pdf_urls || source.pdfUrls).slice(0, 8)
      : (Array.isArray(base.pdf_urls) ? base.pdf_urls.slice(0, 8) : []),
    published_at: cleanText(source.published_at || source.publishedAt || base.published_at || base.publishedAt, 80),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : (Number.isFinite(Number(base.score)) ? Number(base.score) : 0),
    reason: cleanText(source.reason || source.relevance_reason || source.relevanceReason, 500)
  };
}

function normalizeContextBlock(rawBlock = {}, fallbackById = new Map(), { cleanText = defaultCleanText } = {}) {
  const source = ensureObject(rawBlock);
  const paperId = cleanText(source.paper_id || source.paperId, 120);
  const fallback = ensureObject(fallbackById.get(paperId));
  const excerpt = cleanText(source.excerpt || source.text || source.content, 1800);
  if (!paperId || !excerpt) {
    return null;
  }
  return {
    paper_id: paperId,
    paper_title: cleanText(
      source.paper_title
        || source.paperTitle
        || source.title
        || fallback.paper_title
        || fallback.paperTitle
        || fallback.title,
      320
    ),
    section_label: cleanText(source.section_label || source.sectionLabel || source.section, 160),
    excerpt,
    relevance_reason: cleanText(source.relevance_reason || source.relevanceReason || source.reason, 260),
    source: cleanText(source.source, 80) || 'knowledge_markdown',
    evidence_kind: cleanText(source.evidence_kind || source.evidenceKind, 40) || 'text',
    related_comments: normalizeRelatedComments(source.related_comments || source.relatedComments, { cleanText })
  };
}

function getPayloadLineSelections(payload = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const source = ensureObject(payload);
  const candidates = [
    source.selected_line_ranges,
    source.selectedLineRanges,
    source.line_selections,
    source.lineSelections,
    source.context_line_selections,
    source.contextLineSelections,
    source.selected_lines,
    source.selectedLines,
    source.context_blocks,
    source.contextBlocks,
    source.loaded_context_blocks,
    source.loadedContextBlocks
  ];
  const rows = candidates.find((candidate) => asArray(candidate).length);
  if (rows) {
    return asArray(rows);
  }
  return normalizeLineRanges(source).length ? [source] : [];
}

function normalizeLineSelection(rawSelection = {}, helpers = {}) {
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(rawSelection);
  const lineRanges = normalizeLineRanges(source);
  if (!lineRanges.length) {
    return null;
  }
  return {
    line_ranges: lineRanges,
    section_label: cleanText(source.section_label || source.sectionLabel || source.section, 160),
    relevance_reason: cleanText(source.relevance_reason || source.relevanceReason || source.reason, 360)
  };
}

function normalizeCodexPaperLinePayload(payload = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(payload);
  return {
    ok: source.ok === false ? false : true,
    status: cleanText(source.status, 40) || (source.ok === false ? 'failed' : 'completed'),
    selected_line_ranges: getPayloadLineSelections(source, { asArray })
      .map((selection) => normalizeLineSelection(selection, { cleanText }))
      .filter(Boolean)
      .slice(0, DEFAULT_MAX_CONTEXT_BLOCKS),
    notes: asArray(source.notes).map((note) => cleanText(note, 500)).filter(Boolean).slice(0, 12),
    summary: cleanText(source.summary, 800),
    error: cleanText(source.error, 1200)
  };
}

function normalizeCodexPaperContextPayload(payload = {}, fallback = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(payload);
  const fallbackPapers = asArray(fallback.selected_papers || fallback.selectedPapers);
  const fallbackById = new Map();
  fallbackPapers.forEach((paper) => {
    const paperId = cleanText(paper?.paper_id || paper?.paperId, 120);
    if (paperId) {
      fallbackById.set(paperId, paper);
    }
  });
  const selectedRaw = asArray(source.selected_papers || source.selectedPapers);
  const selectedPapers = (selectedRaw.length ? selectedRaw : fallbackPapers)
    .map((paper) => {
      const paperId = cleanText(paper?.paper_id || paper?.paperId, 120);
      return normalizeSelectedPaper(paper, fallbackById.get(paperId) || {}, { cleanText });
    })
    .filter((paper) => paper.paper_id && paper.paper_title);

  const annotationContext = fallback.paper_annotation_context || fallback.paperAnnotationContext || null;
  const loadedBlocks = attachRelatedCommentsToContextBlocks(asArray(source.loaded_context_blocks || source.loadedContextBlocks || source.context_blocks || source.contextBlocks)
    .map((block) => normalizeContextBlock(block, fallbackById, { cleanText }))
    .filter(Boolean), annotationContext, { asArray, cleanText });
  const readCount = toPositiveInteger(
    source.papers_read_count || source.papersReadCount,
    loadedBlocks.length
      ? new Set(loadedBlocks.map((block) => block.paper_id)).size
      : selectedPapers.length
  );

  return {
    ok: source.ok === false ? false : true,
    status: cleanText(source.status, 40) || (source.ok === false ? 'failed' : 'completed'),
    selected_papers: selectedPapers,
    loaded_context_blocks: loadedBlocks,
    papers_read_count: readCount,
    notes: asArray(source.notes).map((note) => cleanText(note, 500)).filter(Boolean).slice(0, 12),
    summary: cleanText(source.summary, 800)
  };
}

module.exports = {
  parseJsonObjectFromText,
  normalizeSelectedPaper,
  normalizeContextBlock,
  getPayloadLineSelections,
  normalizeLineSelection,
  normalizeCodexPaperLinePayload,
  normalizeCodexPaperContextPayload
};
