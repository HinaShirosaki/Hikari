'use strict';

/**
 * Paper-intake pipeline (write side).
 *
 * Runs automatically for every imported paper AFTER its PDF has been transferred
 * into `KnowledgeBase/papers.md/<paper_id>/paper.md`. The pipeline:
 *
 *   1. Reads `paper.md` (and `meta.json` for title/doi hints) through the store.
 *   2. Classifies the document type with the injected LLM (research_paper vs
 *      review / book / book_chapter / other).
 *   3. Branches:
 *        - research_paper -> extract a one-sentence summary + the full experiment
 *          list (the "summary pipeline").
 *        - everything else -> the "other way": one-sentence summary + section
 *          outline + notable claims, with NO experiment list.
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

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { createIntakeStore, DOC_TYPES } = require('./intake-store.js');

const DEFAULT_MARKDOWN_CHAR_LIMIT = 24000;

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

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['one_sentence_summary', 'experiments'],
  properties: {
    one_sentence_summary: { type: 'string' },
    experiments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'technique', 'variables', 'figure_ref', 'outcome'],
        properties: {
          title: { type: 'string' },
          technique: { type: 'string' },
          variables: { type: 'string' },
          figure_ref: { type: 'string' },
          outcome: { type: 'string' }
        }
      }
    }
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

const RESEARCH_SYSTEM_PROMPT = [
  'You summarize a research paper for a lab knowledge base.',
  'Write exactly ONE sentence naming the system/question, the core method, and the headline finding.',
  'Then list every distinct experiment the paper conducts, in order of presentation.',
  'For each experiment give a short title, the technique/assay, the variables compared or hypothesis tested,',
  'the figure or table that reports it (e.g. "Fig. 2B", "Table 1", or "" when none), and a one-line outcome.',
  'Cover ablations, separate controls, supplementary experiments referenced in the main text, and computational experiments.',
  'Group sub-panels of the same experiment under one entry. Do not invent experiments only described as future work.',
  'Use the paper\'s own terminology for assays and techniques. Return JSON only.'
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
    'Document Markdown (from paper.md):',
    markdown || '-',
    'Return JSON with doc_type, confidence (0-1), and a short reason.'
  ].join('\n\n');
}

function buildResearchPrompt({ title, markdown }) {
  return [
    'Summarize the research paper below and enumerate every experiment.',
    `Title: ${title || '-'}`,
    'Paper Markdown (from paper.md):',
    markdown || '-',
    'Return JSON with one_sentence_summary and experiments[] (title, technique, variables, figure_ref, outcome).'
  ].join('\n\n');
}

function buildNonResearchPrompt({ title, docType, markdown }) {
  return [
    `Summarize the ${docType.replace(/_/gu, ' ')} below. Do not list experiments.`,
    `Title: ${title || '-'}`,
    'Document Markdown (from paper.md):',
    markdown || '-',
    'Return JSON with one_sentence_summary, structure_outline[] (section, summary), and notable_claims[] (section, claim).'
  ].join('\n\n');
}

function normalizeExperiments(value) {
  return asArray(value)
    .map((item, index) => {
      const source = ensureObject(item);
      return {
        id: `e${index + 1}`,
        title: cleanText(source.title, 240),
        technique: cleanText(source.technique, 240),
        variables: cleanText(source.variables, 400),
        figure_ref: cleanText(source.figure_ref || source.figureRef, 80),
        outcome: cleanText(source.outcome, 600)
      };
    })
    .filter((experiment) => experiment.title || experiment.technique)
    .slice(0, 60);
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
 *   - markdownCharLimit — cap on how much paper.md is fed to the LLM.
 *   - saveNonResearch (default true) — when false, non-research papers are
 *     classified and returned but not written to the KB.
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

  async function summarizeResearch({ title, markdown, traceContext }) {
    const result = await llm.requestStructuredJsonPayload({
      stage: 'paper_intake_research_summary',
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      userPrompt: buildResearchPrompt({ title, markdown }),
      schema: RESEARCH_SCHEMA,
      traceContext: traceContext || null,
      defaultError: 'Paper intake summary provider is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return { ok: false, error: cleanText(result?.error, 600) || 'Research summary failed.' };
    }
    const payload = ensureObject(result.payload);
    return {
      ok: true,
      one_sentence_summary: firstSentence(payload.one_sentence_summary),
      experiments: normalizeExperiments(payload.experiments)
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

    let markdown = cleanText(options.markdown, 0);
    if (!markdown) {
      const mdResult = await store.readPaperMarkdown(paperId);
      if (!mdResult.ok) {
        return {
          ok: false,
          status: mdResult.status || 'paper_md_unavailable',
          paper_id: paperId,
          error: mdResult.error || 'paper.md is not available for this paper yet.'
        };
      }
      markdown = mdResult.markdown;
    }
    if (!cleanText(markdown, 200)) {
      return {
        ok: false,
        status: 'empty_paper_md',
        paper_id: paperId,
        error: 'paper.md is empty; nothing to classify.'
      };
    }

    const meta = ensureObject((await store.readPaperMeta(paperId))?.meta);
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

    const treatAsResearch = classification.doc_type === 'research_paper'
      && classification.confidence >= minResearchConfidence;

    let summary = null;
    if (treatAsResearch) {
      summary = await summarizeResearch({ title, markdown: boundedMarkdown, traceContext });
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
        ...store.defaultSourcePaths(paperId),
        pdf_path: cleanText(meta.pdf_path || meta.pdfPath, 400)
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
    RESEARCH_SCHEMA,
    NON_RESEARCH_SCHEMA
  });
}

module.exports = {
  CLASSIFICATION_SCHEMA,
  RESEARCH_SCHEMA,
  NON_RESEARCH_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  NON_RESEARCH_SYSTEM_PROMPT,
  firstSentence,
  createIntakePipeline
};
