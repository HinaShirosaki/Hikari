'use strict';

/**
 * Paper-intake pipeline (write side).
 *
 * Runs automatically for every imported paper AFTER its PDF has been transferred
 * into a title-named Markdown file under
 * `KnowledgeBase/papers.md/<paper_id>/`. The pipeline:
 *
 *   1. Reads the paper Markdown, page-delimited `extracted.txt`, and metadata through the store.
 *   2. Classifies the document type with the injected LLM (research_paper vs
 *      review / book / book_chapter / other).
 *   3. Branches:
 *        - research_paper -> extract a one-sentence summary + the full experiment
 *          list (the "summary pipeline").
 *        - review -> stop without running the summary pipeline or writing intake.
 *        - book / book_chapter / other -> the "other way": one-sentence summary
 *          + section outline + notable claims, with NO experiment list.
 *   4. Persists the normalized intake record into the KB via `store.writeIntake`.
 *
 * This is the programmatic counterpart of the `hikari-paper-intake` skill: the
 * skill is what an agent does when prompted; this pipeline does the same thing
 * unattended at import time.
 *
 * The LLM bridge, filesystem, and store are all injected so the common paper
 * knowledge writer can run the pipeline in the workspace that just received the
 * transformed markdown.
 */

const { createAgentLlmRuntimeHelpers } = require('../../../lib/llm/runtime-helpers.js');
const { findReviewJournalKeyword } = require('../../shared/review-paper-filter.js');
const { createIntakeStore, DOC_TYPES } = require('./intake-store.js');

const DEFAULT_MARKDOWN_CHAR_LIMIT = 24000;
const DEFAULT_FALLBACK_PAGE_CHARS = 12000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, maxLength = 2000) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function limitText(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

function firstSentence(value, maxLength = 800) {
  const text = cleanText(value, maxLength);
  if (!text) {
    return '';
  }
  // Collapse the summary to a single sentence: keep up to the first terminal
  // punctuation that is followed by whitespace or end-of-string.
  const match = text.match(/^.*?[.!?](?=\s|$)/u);
  return cleanText(match ? match[0] : text, maxLength);
}

function buildReviewSkipResult({
  paperId,
  status,
  reason,
  confidence,
  journal,
  matchedKeyword,
  classified = false
} = {}) {
  return {
    ok: true,
    status,
    skipped: true,
    reason,
    paper_id: paperId,
    ...(classified ? { doc_type: 'review', confidence } : {}),
    ...(journal ? { journal } : {}),
    ...(matchedKeyword ? { matched_keyword: matchedKeyword } : {}),
    is_research_paper: false,
    ran_summary_pipeline: false,
    experiment_count: 0,
    pages_read: 0,
    rejected_experiment_count: 0,
    one_sentence_summary: ''
  };
}

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_type', 'confidence', 'reason'],
  properties: {
    doc_type: { type: 'string', enum: [...DOC_TYPES] },
    confidence: { type: 'number' },
    reason: { type: 'string' }
  }
};

const RESEARCH_PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['experiments', 'request_next_page'],
  properties: {
    experiments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'technique', 'variables', 'figure_ref', 'outcome', 'evidence'],
        properties: {
          title: { type: 'string' },
          technique: { type: 'string' },
          variables: { type: 'string' },
          figure_ref: { type: 'string' },
          outcome: { type: 'string' },
          evidence: { type: 'string' }
        }
      }
    },
    request_next_page: { type: 'boolean' }
  }
};

const RESEARCH_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['one_sentence_summary'],
  properties: {
    one_sentence_summary: { type: 'string' }
  }
};

const NON_RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['one_sentence_summary', 'structure_outline', 'notable_claims'],
  properties: {
    one_sentence_summary: { type: 'string' },
    structure_outline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'summary'],
        properties: {
          section: { type: 'string' },
          summary: { type: 'string' }
        }
      }
    },
    notable_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'claim'],
        properties: {
          section: { type: 'string' },
          claim: { type: 'string' }
        }
      }
    }
  }
};

const CLASSIFY_SYSTEM_PROMPT = [
  'You classify a scientific document for a research knowledge base.',
  'Decide exactly one document type from the allowed enum based only on the supplied text.',
  'research_paper = primary report of original experiments or analyses with a methods/experiments section and new results.',
  'review = synthesizes prior literature without new experiments (systematic reviews and meta-analyses are reviews).',
  'book / book_chapter = long-form pedagogical or reference text, monograph, or textbook excerpt.',
  'other = preprint commentary, editorial, perspective, thesis abstract, dataset descriptor, or anything else.',
  'Choose research_paper only when a methods/experiments section is clearly present and new findings are reported.',
  'If unsure between research_paper and review, choose review.',
  'Return JSON only.'
].join(' ');

const RESEARCH_PAGE_SYSTEM_PROMPT = [
  'You inventory experiments from one full extracted paper page at a time.',
  'List every distinct experiment, control, ablation, computational analysis, or supplementary experiment evidenced by the supplied content.',
  'Include only experiments conducted by this paper; exclude background studies, cited prior work, future work, and reference-list entries.',
  'For each experiment, copy a short verbatim evidence excerpt from the supplied content.',
  'Do not paraphrase evidence and do not report an experiment without supporting content.',
  'Set request_next_page to true when another page is available and the paragraph, caption, table, method, result, or experiment continues.',
  'Do not add identifiers, page numbers, line numbers, or source paths. Return JSON only.'
].join(' ');

const RESEARCH_SUMMARY_SYSTEM_PROMPT = [
  'Write exactly one sentence summarizing a research paper from its verified experiment inventory.',
  'Name the system or question, core methods, and headline finding.',
  'Do not add findings absent from the inventory. Return JSON only.'
].join(' ');

const NON_RESEARCH_SYSTEM_PROMPT = [
  'You summarize a non-experimental scientific document (review, book, chapter, or other) for a knowledge base.',
  'This document does not conduct experiments, so do NOT produce an experiment list.',
  'Write exactly ONE sentence describing what the document covers and its central thesis or scope.',
  'Provide the document\'s own section/chapter outline with a one-line description each, in order.',
  'Provide up to five notable claims or cited pieces of evidence, each tagged with the section it appears in.',
  'Return JSON only.'
].join(' ');

function buildClassificationPrompt({ title, doi, markdown }) {
  return [
    'Classify the document below into one of: research_paper, review, book, book_chapter, other.',
    `Title hint: ${title || '-'}`,
    `DOI hint: ${doi || '-'}`,
    'Converted paper Markdown:',
    markdown || '-',
    'Return JSON with doc_type, confidence (0-1), and a short reason.'
  ].join('\n\n');
}

function buildResearchPagePrompt({
  title,
  content,
  hasMore,
  previousPageAnalysis = null,
  previousPageContent = ''
}) {
  return [
    'Inspect this full extracted page and return newly evidenced experiments.',
    `Title: ${title || '-'}`,
    `Another full page is available: ${hasMore ? 'yes' : 'no'}`,
    previousPageContent
      ? `Previous full page content retained because continuation was requested:\n${previousPageContent}`
      : '',
    previousPageAnalysis
      ? `Previous-page analysis for continuation only:\n${JSON.stringify(previousPageAnalysis, null, 2)}`
      : '',
    'Full page content:',
    content || '-',
    'Return JSON with experiments[] (title, technique, variables, figure_ref, outcome, evidence) and request_next_page.'
  ].filter(Boolean).join('\n\n');
}

function buildResearchSummaryPrompt({ title, experiments }) {
  const compactExperiments = asArray(experiments).map((experiment) => ({
    title: cleanText(experiment?.title, 240),
    technique: cleanText(experiment?.technique, 240),
    variables: cleanText(experiment?.variables, 400),
    figure_ref: cleanText(experiment?.figure_ref, 80),
    outcome: cleanText(experiment?.outcome, 600)
  }));
  return [
    'Summarize the verified experiment inventory below.',
    `Title: ${title || '-'}`,
    `Verified experiments JSON:\n${JSON.stringify(compactExperiments, null, 2)}`,
    'Return JSON with one_sentence_summary.'
  ].join('\n\n');
}

function buildNonResearchPrompt({ title, docType, markdown }) {
  return [
    `Summarize the ${docType.replace(/_/gu, ' ')} below. Do not list experiments.`,
    `Title: ${title || '-'}`,
    'Converted paper Markdown:',
    markdown || '-',
    'Return JSON with one_sentence_summary, structure_outline[] (section, summary), and notable_claims[] (section, claim).'
  ].join('\n\n');
}

function normalizeComparableContent(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function contentSupportsEvidence(content = '', evidence = '') {
  const normalizedEvidence = normalizeComparableContent(evidence);
  return normalizedEvidence.length >= 12
    && normalizeComparableContent(content).includes(normalizedEvidence);
}

function normalizeExperiments(value, { sourceContents = [], requireEvidence = false } = {}) {
  return asArray(value)
    .map((item, index) => {
      const source = ensureObject(item);
      const evidence = cleanText(source.evidence || source.source_content || source.sourceContent, 1600);
      if (requireEvidence && !asArray(sourceContents).some((content) => contentSupportsEvidence(content, evidence))) {
        return null;
      }
      return {
        id: `e${index + 1}`,
        title: cleanText(source.title, 240),
        technique: cleanText(source.technique, 240),
        variables: cleanText(source.variables, 400),
        figure_ref: cleanText(source.figure_ref || source.figureRef, 80),
        outcome: cleanText(source.outcome, 600),
        ...(evidence ? { evidence } : {})
      };
    })
    .filter((experiment) => experiment && (experiment.title || experiment.technique));
}

function experimentIdentity(experiment = {}) {
  const source = ensureObject(experiment);
  return [source.figure_ref, source.title, source.technique, source.variables, source.outcome]
    .map((value) => normalizeComparableContent(value))
    .join('|');
}

function mergeExperiments(current = [], incoming = []) {
  const merged = [];
  const seen = new Set();
  [...asArray(current), ...asArray(incoming)].forEach((experiment) => {
    const key = experimentIdentity(experiment);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push({ ...experiment, id: `e${merged.length + 1}` });
  });
  return merged;
}

function splitExtractedTextPages(value = '') {
  const text = String(value || '');
  const markerPattern = /^\[\[page:\s*\d+\s*\]\]\s*$/gimu;
  const markers = [...text.matchAll(markerPattern)];
  if (!markers.length) {
    return [];
  }
  return markers.map((marker, index) => {
    const start = Number(marker.index) + marker[0].length;
    const end = index + 1 < markers.length ? Number(markers[index + 1].index) : text.length;
    return text.slice(start, end).trim();
  }).filter(Boolean);
}

function splitTextIntoPageWindows(value = '', maxChars = DEFAULT_FALLBACK_PAGE_CHARS) {
  const paragraphs = String(value || '').split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const pages = [];
  let current = '';
  paragraphs.forEach((paragraph) => {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      pages.push(current);
      current = '';
    }
    if (paragraph.length > maxChars) {
      if (current) {
        pages.push(current);
        current = '';
      }
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        pages.push(paragraph.slice(offset, offset + maxChars));
      }
      return;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  });
  if (current) {
    pages.push(current);
  }
  return pages;
}

function createPaperPageCursor(pages = []) {
  const contentPages = asArray(pages).map((page) => cleanText(page, 0)).filter(Boolean);
  let index = 0;
  return Object.freeze({
    nextPage() {
      if (index >= contentPages.length) {
        return { content: '', has_more: false };
      }
      const content = contentPages[index];
      index += 1;
      return {
        content,
        has_more: index < contentPages.length
      };
    }
  });
}

function normalizeOutline(value) {
  return asArray(value)
    .map((item) => {
      const source = ensureObject(item);
      return {
        section: cleanText(source.section, 240),
        summary: cleanText(source.summary, 600)
      };
    })
    .filter((entry) => entry.section || entry.summary)
    .slice(0, 40);
}

function normalizeClaims(value) {
  return asArray(value)
    .map((item) => {
      const source = ensureObject(item);
      return {
        section: cleanText(source.section, 240),
        claim: cleanText(source.claim, 600)
      };
    })
    .filter((entry) => entry.claim)
    .slice(0, 5);
}

/**
 * Create a pipeline bound to a workspace + injected LLM/fs.
 *
 * Required deps (any of these forms):
 *   - store: a pre-built intake store (from createIntakeStore), OR
 *   - workspacePath + fs: so the pipeline builds its own store.
 *   - An LLM bridge: either deps.llmProviderBridge, or override functions such
 *     as deps.requestStructuredJsonPayload (matches createAgentLlmRuntimeHelpers).
 *
 * Optional deps:
 *   - resolveProjectIdsForPaper / listKnownPaperIds / matchProjectName — forwarded
 *     to the store.
 *   - markdownCharLimit — cap for classification and non-research summaries.
 *     Research experiment extraction always traverses every available page.
 *   - saveNonResearch (default true) — when false, books, book chapters, and
 *     other non-research documents are classified and returned but not written
 *     to the KB. Reviews are always skipped.
 *   - minResearchConfidence (default 0) — re-route low-confidence research
 *     classifications down the non-research path.
 */
function createIntakePipeline(deps = {}) {
  const llm = createAgentLlmRuntimeHelpers(deps);
  const store = deps.store && typeof deps.store.writeIntake === 'function'
    ? deps.store
    : createIntakeStore(deps);
  const markdownCharLimit = Number.isFinite(Number(deps.markdownCharLimit))
    ? Math.max(2000, Math.trunc(Number(deps.markdownCharLimit)))
    : DEFAULT_MARKDOWN_CHAR_LIMIT;
  const saveNonResearch = deps.saveNonResearch !== false;
  const minResearchConfidence = Number.isFinite(Number(deps.minResearchConfidence))
    ? Number(deps.minResearchConfidence)
    : 0;

  async function classifyDocument({ title, doi, markdown, traceContext }) {
    const result = await llm.requestStructuredJsonPayload({
      stage: 'paper_intake_classification',
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: buildClassificationPrompt({ title, doi, markdown }),
      schema: CLASSIFICATION_SCHEMA,
      traceContext: traceContext || null,
      defaultError: 'Paper intake classification provider is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return { ok: false, error: cleanText(result?.error, 600) || 'Classification failed.' };
    }
    const payload = ensureObject(result.payload);
    const docType = DOC_TYPES.includes(payload.doc_type) ? payload.doc_type : 'other';
    const confidence = Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 0;
    return {
      ok: true,
      doc_type: docType,
      confidence,
      reason: cleanText(payload.reason, 600)
    };
  }

  async function summarizeResearch({ title, markdown, pages: suppliedPages = [], traceContext }) {
    const pages = asArray(suppliedPages).length
      ? asArray(suppliedPages)
      : splitTextIntoPageWindows(markdown);
    const cursor = createPaperPageCursor(pages);
    let experiments = [];
    let previousPageAnalysis = null;
    let previousPageContent = '';
    let pagesRead = 0;
    let rejectedExperimentCount = 0;

    while (true) {
      const page = cursor.nextPage();
      if (!page.content) {
        break;
      }
      const result = await llm.requestStructuredJsonPayload({
        stage: 'paper_intake_research_page',
        systemPrompt: RESEARCH_PAGE_SYSTEM_PROMPT,
        userPrompt: buildResearchPagePrompt({
          title,
          content: page.content,
          hasMore: page.has_more,
          previousPageAnalysis,
          previousPageContent
        }),
        schema: RESEARCH_PAGE_SCHEMA,
        traceContext: traceContext || null,
        defaultError: 'Paper intake page-analysis provider is not configured.'
      });
      if (!result?.ok || !result.payload) {
        return { ok: false, error: cleanText(result?.error, 600) || 'Research page analysis failed.' };
      }
      pagesRead += 1;
      const payload = ensureObject(result.payload);
      const rawExperiments = asArray(payload.experiments);
      const sourceContents = [page.content];
      if (previousPageAnalysis && previousPageContent) {
        sourceContents.push(previousPageContent);
      }
      const accepted = normalizeExperiments(rawExperiments, {
        sourceContents,
        requireEvidence: true
      });
      rejectedExperimentCount += Math.max(0, rawExperiments.length - accepted.length);
      experiments = mergeExperiments(experiments, accepted);
      const requestsNextPage = payload.request_next_page === true && page.has_more;
      previousPageAnalysis = requestsNextPage
        ? { experiments: accepted, request_next_page: true }
        : null;
      previousPageContent = requestsNextPage ? page.content : '';
      if (!page.has_more) {
        break;
      }
    }

    const summaryResult = await llm.requestStructuredJsonPayload({
      stage: 'paper_intake_research_summary',
      systemPrompt: RESEARCH_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildResearchSummaryPrompt({ title, experiments }),
      schema: RESEARCH_SUMMARY_SCHEMA,
      traceContext: traceContext || null,
      defaultError: 'Paper intake summary provider is not configured.'
    });
    if (!summaryResult?.ok || !summaryResult.payload) {
      return { ok: false, error: cleanText(summaryResult?.error, 600) || 'Research summary failed.' };
    }
    const payload = ensureObject(summaryResult.payload);
    return {
      ok: true,
      one_sentence_summary: firstSentence(payload.one_sentence_summary),
      experiments,
      pages_read: pagesRead,
      rejected_experiment_count: rejectedExperimentCount
    };
  }

  async function summarizeNonResearch({ title, docType, markdown, traceContext }) {
    const result = await llm.requestStructuredJsonPayload({
      stage: 'paper_intake_non_research_summary',
      systemPrompt: NON_RESEARCH_SYSTEM_PROMPT,
      userPrompt: buildNonResearchPrompt({ title, docType, markdown }),
      schema: NON_RESEARCH_SCHEMA,
      traceContext: traceContext || null,
      defaultError: 'Paper intake summary provider is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return { ok: false, error: cleanText(result?.error, 600) || 'Document summary failed.' };
    }
    const payload = ensureObject(result.payload);
    return {
      ok: true,
      one_sentence_summary: firstSentence(payload.one_sentence_summary),
      structure_outline: normalizeOutline(payload.structure_outline),
      notable_claims: normalizeClaims(payload.notable_claims)
    };
  }

  /**
   * Run the full intake pipeline for a single paper id.
   *
   * Accepts either a bare paperId string or an options object:
   *   { paperId, markdown?, title?, doi?, projectIds?, traceContext?, save? }
   * When markdown/title/doi are omitted they are read from the store.
   */
  async function runIntakeForPaper(input = {}) {
    const options = typeof input === 'string' ? { paperId: input } : ensureObject(input);
    const paperId = cleanText(options.paperId || options.paper_id, 200);
    if (!paperId) {
      return { ok: false, status: 'invalid_arguments', error: 'paperId is required.' };
    }

    const meta = ensureObject((await store.readPaperMeta(paperId))?.meta);
    const reviewJournalMatch = findReviewJournalKeyword(
      options.journal
        || options.paper_journal
        || options.paperJournal
        || meta.journal
        || meta.paper_journal
        || meta.paperJournal
    );
    if (reviewJournalMatch) {
      return buildReviewSkipResult({
        paperId,
        status: 'skipped_review_journal',
        reason: 'review_journal',
        journal: reviewJournalMatch.journal,
        matchedKeyword: reviewJournalMatch.keyword
      });
    }

    let markdown = cleanText(options.markdown, 0);
    let paperMarkdownRelativePath = cleanText(
      options.paperMarkdownRelativePath || options.paper_markdown_relative_path,
      400
    );
    if (!markdown) {
      const mdResult = await store.readPaperMarkdown(paperId);
      if (!mdResult.ok) {
        return {
          ok: false,
          status: mdResult.status || 'paper_md_unavailable',
          paper_id: paperId,
          error: mdResult.error || 'The converted paper Markdown is not available for this paper yet.'
        };
      }
      markdown = mdResult.markdown;
      paperMarkdownRelativePath = cleanText(mdResult.paper_md, 400);
    } else if (!paperMarkdownRelativePath && typeof store.resolvePaperMarkdownPath === 'function') {
      // A caller-supplied `markdown` still needs the real on-disk path recorded,
      // otherwise source_paths.paper_md is invented from the title and points at
      // a file that need not exist.
      const located = await store.resolvePaperMarkdownPath(paperId);
      paperMarkdownRelativePath = located?.ok ? cleanText(located.paper_md, 400) : '';
    }
    if (!cleanText(markdown, 200)) {
      return {
        ok: false,
        status: 'empty_paper_md',
        paper_id: paperId,
        error: 'The converted paper Markdown is empty; nothing to classify.'
      };
    }

    const title = cleanText(options.title || meta.title || meta.paper_title, 400);
    const doi = cleanText(options.doi || meta.doi, 200);
    const projectIds = asArray(options.projectIds || options.project_ids);
    const traceContext = options.traceContext || null;
    const boundedMarkdown = limitText(markdown, markdownCharLimit);

    const classification = await classifyDocument({ title, doi, markdown: boundedMarkdown, traceContext });
    if (!classification.ok) {
      return {
        ok: false,
        status: 'classification_failed',
        paper_id: paperId,
        error: classification.error
      };
    }

    if (classification.doc_type === 'review') {
      return buildReviewSkipResult({
        paperId,
        status: 'skipped_review',
        reason: 'classified_as_review',
        confidence: classification.confidence,
        classified: true
      });
    }

    const treatAsResearch = classification.doc_type === 'research_paper'
      && classification.confidence >= minResearchConfidence;

    let summary = null;
    if (treatAsResearch) {
      let extractedText = cleanText(options.extractedText || options.extracted_text, 0);
      if (!extractedText && typeof store.readPaperExtractedText === 'function') {
        const extractedResult = await store.readPaperExtractedText(paperId);
        if (extractedResult?.ok) {
          extractedText = extractedResult.content;
        }
      }
      const pages = splitExtractedTextPages(extractedText);
      summary = await summarizeResearch({
        title,
        markdown,
        pages: pages.length ? pages : splitTextIntoPageWindows(markdown),
        traceContext
      });
    } else {
      summary = await summarizeNonResearch({
        title,
        docType: classification.doc_type,
        markdown: boundedMarkdown,
        traceContext
      });
    }
    if (!summary.ok) {
      return {
        ok: false,
        status: 'summary_failed',
        paper_id: paperId,
        doc_type: classification.doc_type,
        error: summary.error
      };
    }

    const record = {
      paper_id: paperId,
      doc_type: classification.doc_type,
      title,
      doi,
      project_ids: projectIds,
      one_sentence_summary: summary.one_sentence_summary,
      experiments: treatAsResearch ? summary.experiments : [],
      structure_outline: treatAsResearch ? [] : summary.structure_outline,
      notable_claims: treatAsResearch ? [] : summary.notable_claims,
      source_paths: {
        ...store.defaultSourcePaths(paperId, {
          title,
          paper_md: paperMarkdownRelativePath
        }),
        pdf_path: cleanText(meta.pdf_path || meta.pdfPath || meta.source_pdf_path, 400)
      }
    };

    const shouldSave = options.save === undefined
      ? (treatAsResearch || saveNonResearch)
      : options.save === true;

    let saved = null;
    if (shouldSave) {
      const writeResult = await store.writeIntake(paperId, record);
      if (!writeResult.ok) {
        return {
          ok: false,
          status: 'save_failed',
          paper_id: paperId,
          doc_type: classification.doc_type,
          error: writeResult.error || 'Failed to write intake record.'
        };
      }
      saved = writeResult.record;
    }

    return {
      ok: true,
      status: shouldSave ? 'saved' : 'classified',
      paper_id: paperId,
      doc_type: classification.doc_type,
      confidence: classification.confidence,
      is_research_paper: treatAsResearch,
      ran_summary_pipeline: true,
      experiment_count: treatAsResearch ? record.experiments.length : 0,
      pages_read: treatAsResearch ? Number(summary.pages_read) || 0 : 0,
      rejected_experiment_count: treatAsResearch ? Number(summary.rejected_experiment_count) || 0 : 0,
      one_sentence_summary: record.one_sentence_summary,
      record: saved || record
    };
  }

  /**
   * Batch entry point: classify + (for research papers) summarize + save across
   * many paper ids. When `paperIds` is omitted, every paper the store knows about
   * is processed. Returns a per-paper result list plus a roll-up.
   */
  async function runIntakeForImportedPapers(input = {}) {
    const options = ensureObject(input);
    let paperIds = asArray(options.paperIds || options.paper_ids)
      .map((id) => cleanText(id, 200))
      .filter(Boolean);
    if (!paperIds.length) {
      paperIds = await store.listPaperIds();
    }

    const results = [];
    for (const paperId of paperIds) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await runIntakeForPaper({
        paperId,
        projectIds: options.projectIds || options.project_ids,
        traceContext: options.traceContext || null,
        save: options.save
      }));
    }

    const processed = results.length;
    const researchPapers = results.filter((result) => result.ok && result.is_research_paper).length;
    const saved = results.filter((result) => result.ok && result.status === 'saved').length;
    const failed = results.filter((result) => !result.ok).length;

    return {
      ok: failed === 0,
      status: failed === 0 ? 'completed' : 'completed_with_errors',
      processed,
      research_papers: researchPapers,
      saved,
      failed,
      results
    };
  }

  return Object.freeze({
    store,
    classifyDocument,
    summarizeResearch,
    summarizeNonResearch,
    runIntakeForPaper,
    runIntakeForImportedPapers,
    CLASSIFICATION_SCHEMA,
    RESEARCH_PAGE_SCHEMA,
    RESEARCH_SUMMARY_SCHEMA,
    NON_RESEARCH_SCHEMA
  });
}

module.exports = {
  CLASSIFICATION_SCHEMA,
  RESEARCH_PAGE_SCHEMA,
  RESEARCH_SUMMARY_SCHEMA,
  NON_RESEARCH_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  RESEARCH_PAGE_SYSTEM_PROMPT,
  RESEARCH_SUMMARY_SYSTEM_PROMPT,
  NON_RESEARCH_SYSTEM_PROMPT,
  firstSentence,
  contentSupportsEvidence,
  createPaperPageCursor,
  splitExtractedTextPages,
  splitTextIntoPageWindows,
  createIntakePipeline
};
