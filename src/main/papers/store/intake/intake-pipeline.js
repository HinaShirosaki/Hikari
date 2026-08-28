'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../lib/llm/runtime-helpers.js');
const { findReviewJournalKeyword } = require('../../shared/review-paper-filter.js');
const { DOC_TYPES, createIntakeStore } = require('./intake-store.js');
const { asArray, ensureObject } = require('../../../lib/normalize.js');
const { contentSupportsEvidence, createPaperPageCursor, mergeExperiments, normalizeClaims, normalizeExperiments, normalizeOutline, splitExtractedTextPages, splitTextIntoPageWindows } = require('./pipeline/content-analysis.js');
const { CLASSIFY_SYSTEM_PROMPT, NON_RESEARCH_SYSTEM_PROMPT, RESEARCH_PAGE_SYSTEM_PROMPT, RESEARCH_SUMMARY_SYSTEM_PROMPT, buildClassificationPrompt, buildNonResearchPrompt, buildResearchPagePrompt, buildResearchSummaryPrompt } = require('./pipeline/prompts.js');
const { CLASSIFICATION_SCHEMA, NON_RESEARCH_SCHEMA, RESEARCH_PAGE_SCHEMA, RESEARCH_SUMMARY_SCHEMA } = require('./pipeline/schemas.js');
const { DEFAULT_MARKDOWN_CHAR_LIMIT, buildReviewSkipResult, cleanText, firstSentence, limitText } = require('./pipeline/text-utils.js');

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
 *     classifications down the non-research path. */
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
