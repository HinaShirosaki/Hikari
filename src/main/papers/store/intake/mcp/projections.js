'use strict';

const { createIntakeStore } = require('../intake-store.js');
const { asArray, ensureObject } = require('../../../../lib/normalize.js');

const TOOL_NAMES = Object.freeze({
  LIST_PROJECT_SUMMARIES: 'paper_intake_list_project_summaries',
  SEARCH_SUMMARIES: 'paper_intake_search_summaries',
  SEARCH_EXPERIMENTS: 'paper_intake_search_experiments'
});

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

function cleanText(value, maxLength = 2000) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function clampLimit(value) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, number));
}

// Resolve the target project. filterByProject treats id and name as alternatives (OR),
// so we must never combine a context id with a different agent-supplied name — that would
// return the union of the active project and the named one. An explicit name therefore
// stands alone; only when the agent names nothing do we fall back to the active project in
// context (whose id and name refer to the same project, so OR-ing them is safe).
function resolveProjectSelector(args = {}, context = {}) {
  const suppliedName = cleanText(args.project_name || args.projectName, 240);
  if (suppliedName) {
    return { projectId: '', projectName: suppliedName };
  }
  const ctxProject = ensureObject(context.project);
  return {
    projectId: cleanText(ctxProject.id || ctxProject.project_id || ctxProject.projectId, 200),
    projectName: cleanText(
      ctxProject.name || ctxProject.project_name || ctxProject.projectName || ctxProject.title,
      240
    )
  };
}

function readOnlyAnnotations(title) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

function compact(object) {
  const out = {};
  Object.entries(ensureObject(object)).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === 'string' && !value) {
      return;
    }
    if (Array.isArray(value) && !value.length) {
      return;
    }
    out[key] = value;
  });
  return out;
}

// A metadata-only record predates classification, so it has no doc_type to test.
// Surfacing it beats reporting the paper absent, but it must not masquerade as a
// match for the type the caller asked for -- both listing tools apply this, so
// the project roll-up and summary search never disagree about the same library.
function matchesDocTypes(record, docTypes) {
  if (record?.intake_status === 'metadata_only') {
    return true;
  }
  return docTypes.includes(record?.doc_type);
}

function projectionForListing(record) {
  return compact({
    paper_id: record.paper_id,
    title: record.title,
    doi: record.doi,
    doc_type: record.doc_type,
    intake_status: record.intake_status,
    one_sentence_summary: record.one_sentence_summary,
    experiment_count: asArray(record.experiments).length,
    source_paths: compact(record.source_paths)
  });
}

function projectionForSummaryMatch(record, score, matchedTerms) {
  return compact({
    paper_id: record.paper_id,
    title: record.title,
    doc_type: record.doc_type,
    intake_status: record.intake_status,
    one_sentence_summary: record.one_sentence_summary,
    score: Math.round(score * 1000) / 1000,
    matched_terms: matchedTerms,
    source_paths: compact(record.source_paths)
  });
}

function projectionForExperimentMatch(record, experiment, score, matchedTerms) {
  return compact({
    paper_id: record.paper_id,
    paper_title: record.title,
    doc_type: record.doc_type,
    experiment: compact(experiment),
    score: Math.round(score * 1000) / 1000,
    matched_terms: matchedTerms,
    source_paths: compact(record.source_paths)
  });
}

function configurationError(mcpToolName) {
  return {
    ok: false,
    status: 'executor_unavailable',
    mcp_tool: mcpToolName,
    app_tool: mcpToolName,
    error: 'Paper intake store is not connected to the workspace yet.'
  };
}

function ensureStore(deps, mcpToolName) {
  if (deps && deps.intakeStore && typeof deps.intakeStore.loadAll === 'function') {
    return { store: deps.intakeStore };
  }
  if (deps && deps.workspacePath && deps.fs) {
    try {
      return { store: createIntakeStore(deps) };
    } catch (error) {
      return {
        error: {
          ok: false,
          status: 'executor_unavailable',
          mcp_tool: mcpToolName,
          app_tool: mcpToolName,
          error: cleanText(error?.message || error, 600)
            || 'Failed to construct paper intake store.'
        }
      };
    }
  }
  return { error: configurationError(mcpToolName) };
}

module.exports = {
  MAX_LIMIT,
  TOOL_NAMES,
  clampLimit,
  cleanText,
  compact,
  ensureStore,
  matchesDocTypes,
  projectionForExperimentMatch,
  projectionForListing,
  projectionForSummaryMatch,
  readOnlyAnnotations,
  resolveProjectSelector
};
