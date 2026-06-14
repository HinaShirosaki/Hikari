'use strict';

/**
 * Direct Hikari MCP tools for the paper-intake summary KB.
 *
 * Three tools, all read-only:
 *   1. paper_intake_list_project_summaries — list one-sentence summaries for
 *      every paper attached to a given project.
 *   2. paper_intake_search_summaries — keyword search across one-sentence
 *      summaries (and titles).
 *   3. paper_intake_search_experiments — keyword search across structured
 *      experiment entries.
 *
 * These mirror the `definition` + `handler` shape used by the other entries in
 * `mcp-contract/direct-tools/` and are registered by that index.
 */

const { createIntakeStore, DOC_TYPES } = require('./intake-store.js');
const {
  tokenize,
  scoreSummary,
  scoreExperiment,
  rankAndTrim
} = require('./intake-search.js');

const TOOL_NAMES = Object.freeze({
  LIST_PROJECT_SUMMARIES: 'paper_intake_list_project_summaries',
  SEARCH_SUMMARIES: 'paper_intake_search_summaries',
  SEARCH_EXPERIMENTS: 'paper_intake_search_experiments'
});

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

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

function clampLimit(value) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, number));
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

function projectionForListing(record) {
  return compact({
    paper_id: record.paper_id,
    title: record.title,
    doi: record.doi,
    doc_type: record.doc_type,
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
          error: cleanText(error?.message || error, 600)
            || 'Failed to construct paper intake store.'
        }
      };
    }
  }
  return { error: configurationError(mcpToolName) };
}

const LIST_PROJECT_SUMMARIES_DEFINITION = Object.freeze({
  name: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
  description: [
    'List one-sentence summaries for every paper currently attached to a Hikari project.',
    'Uses the paper-intake summary knowledge base produced by the `hikari-paper-intake` skill',
    'after each PDF is transferred into `KnowledgeBase/papers.md/<paper_id>/paper.md`.',
    'Returns title, DOI, document type, and the count of recorded experiments for each paper.',
    'Use this when the user asks what papers a project contains or wants a roll-up of recent reading.'
  ].join(' '),
  annotations: readOnlyAnnotations('Paper Intake — List Project Summaries'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project_id: { type: 'string', minLength: 1, maxLength: 200 },
      project_name: { type: 'string', minLength: 1, maxLength: 240 },
      doc_types: {
        type: 'array',
        items: { type: 'string', enum: [...DOC_TYPES] },
        maxItems: DOC_TYPES.length
      },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }
    },
    anyOf: [
      { required: ['project_id'] },
      { required: ['project_name'] }
    ]
  }
});

async function callListProjectSummaries(input = {}, context = {}, deps = {}) {
  const args = ensureObject(input);
  const { store, error } = ensureStore(deps, TOOL_NAMES.LIST_PROJECT_SUMMARIES);
  if (error) {
    return error;
  }
  const projectId = cleanText(args.project_id || args.projectId, 200);
  const projectName = cleanText(args.project_name || args.projectName, 240);
  if (!projectId && !projectName) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
      error: 'Provide project_id or project_name.'
    };
  }
  const docTypes = asArray(args.doc_types).filter((value) => DOC_TYPES.includes(value));
  const limit = clampLimit(args.limit);

  const load = await store.loadAll();
  if (!load.ok) {
    return {
      ok: false,
      status: load.status || 'failed',
      mcp_tool: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
      error: load.error || 'Failed to read the paper intake store.'
    };
  }
  const projectRecords = await store.filterByProject(load.records, {
    project_id: projectId,
    project_name: projectName
  });
  const filtered = docTypes.length
    ? projectRecords.filter((record) => docTypes.includes(record.doc_type))
    : projectRecords;
  const items = filtered.slice(0, limit).map(projectionForListing);

  return compact({
    ok: true,
    status: items.length ? 'matched' : 'no_match',
    mcp_tool: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
    project_id: projectId,
    project_name: projectName,
    doc_types: docTypes,
    summary: items.length
      ? `Found ${filtered.length} intake record${filtered.length === 1 ? '' : 's'} for ${projectId || projectName}.`
      : `No paper intake records found for ${projectId || projectName}.`,
    items,
    total_matches: filtered.length,
    truncated: filtered.length > items.length,
    errors: load.errors
  });
}

const SEARCH_SUMMARIES_DEFINITION = Object.freeze({
  name: TOOL_NAMES.SEARCH_SUMMARIES,
  description: [
    'Keyword search across one-sentence paper summaries (and titles) in the paper-intake KB.',
    'Scores titles slightly higher than summaries and rewards verbatim phrase matches.',
    'Use this when the user wants to find a paper by topic, finding, or concept without reading every summary.',
    'Optionally constrain to a single project or to specific document types (research_paper, review, book, ...).'
  ].join(' '),
  annotations: readOnlyAnnotations('Paper Intake — Search Summaries'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 300 },
      project_id: { type: 'string', minLength: 1, maxLength: 200 },
      project_name: { type: 'string', minLength: 1, maxLength: 240 },
      doc_types: {
        type: 'array',
        items: { type: 'string', enum: [...DOC_TYPES] },
        maxItems: DOC_TYPES.length
      },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }
    }
  }
});

async function callSearchSummaries(input = {}, context = {}, deps = {}) {
  const args = ensureObject(input);
  const { store, error } = ensureStore(deps, TOOL_NAMES.SEARCH_SUMMARIES);
  if (error) {
    return error;
  }
  const query = cleanText(args.query, 300);
  if (!query) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      error: 'Provide a non-empty query.'
    };
  }
  const tokens = tokenize(query);
  if (!tokens.length) {
    return {
      ok: true,
      status: 'no_match',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      query,
      summary: 'Query produced no usable search terms after stopword removal.',
      items: []
    };
  }
  const docTypes = asArray(args.doc_types).filter((value) => DOC_TYPES.includes(value));
  const projectId = cleanText(args.project_id || args.projectId, 200);
  const projectName = cleanText(args.project_name || args.projectName, 240);
  const limit = clampLimit(args.limit);

  const load = await store.loadAll();
  if (!load.ok) {
    return {
      ok: false,
      status: load.status || 'failed',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      query,
      error: load.error || 'Failed to read the paper intake store.'
    };
  }
  let candidates = load.records;
  if (projectId || projectName) {
    candidates = await store.filterByProject(candidates, {
      project_id: projectId,
      project_name: projectName
    });
  }
  if (docTypes.length) {
    candidates = candidates.filter((record) => docTypes.includes(record.doc_type));
  }

  const scored = candidates
    .map((record) => {
      const { score, matched } = scoreSummary(record, tokens, query);
      return { record, score, matched };
    });
  const ranked = rankAndTrim(scored, limit);
  const items = ranked.map(({ record, score, matched }) => projectionForSummaryMatch(record, score, matched));

  return compact({
    ok: true,
    status: items.length ? 'matched' : 'no_match',
    mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
    query,
    terms_used: tokens,
    project_id: projectId,
    project_name: projectName,
    doc_types: docTypes,
    summary: items.length
      ? `Matched ${items.length} paper${items.length === 1 ? '' : 's'} on summary terms: ${tokens.join(', ')}.`
      : `No paper summary matched terms: ${tokens.join(', ')}.`,
    items,
    errors: load.errors
  });
}

const SEARCH_EXPERIMENTS_DEFINITION = Object.freeze({
  name: TOOL_NAMES.SEARCH_EXPERIMENTS,
  description: [
    'Keyword search across structured experiment entries in the paper-intake KB.',
    'Each result is a single experiment (title, technique, variables, figure_ref, outcome) attached',
    'to a paper, scored against title, technique, and variable fields.',
    'Use this when the user is hunting for a specific assay, condition, or outcome ("who did western blot on knockouts in HEK293?").',
    'Only papers with doc_type=research_paper carry experiments; reviews and books return no entries.'
  ].join(' '),
  annotations: readOnlyAnnotations('Paper Intake — Search Experiments'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 300 },
      project_id: { type: 'string', minLength: 1, maxLength: 200 },
      project_name: { type: 'string', minLength: 1, maxLength: 240 },
      technique: { type: 'string', minLength: 1, maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }
    }
  }
});

async function callSearchExperiments(input = {}, context = {}, deps = {}) {
  const args = ensureObject(input);
  const { store, error } = ensureStore(deps, TOOL_NAMES.SEARCH_EXPERIMENTS);
  if (error) {
    return error;
  }
  const query = cleanText(args.query, 300);
  if (!query) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: TOOL_NAMES.SEARCH_EXPERIMENTS,
      error: 'Provide a non-empty query.'
    };
  }
  const tokens = tokenize(query);
  if (!tokens.length) {
    return {
      ok: true,
      status: 'no_match',
      mcp_tool: TOOL_NAMES.SEARCH_EXPERIMENTS,
      query,
      summary: 'Query produced no usable search terms after stopword removal.',
      items: []
    };
  }
  const projectId = cleanText(args.project_id || args.projectId, 200);
  const projectName = cleanText(args.project_name || args.projectName, 240);
  const techniqueFilter = cleanText(args.technique, 200).toLowerCase();
  const limit = clampLimit(args.limit);

  const load = await store.loadAll();
  if (!load.ok) {
    return {
      ok: false,
      status: load.status || 'failed',
      mcp_tool: TOOL_NAMES.SEARCH_EXPERIMENTS,
      query,
      error: load.error || 'Failed to read the paper intake store.'
    };
  }

  let candidates = load.records.filter((record) => record.doc_type === 'research_paper');
  if (projectId || projectName) {
    candidates = await store.filterByProject(candidates, {
      project_id: projectId,
      project_name: projectName
    });
  }

  const scored = [];
  candidates.forEach((record) => {
    asArray(record.experiments).forEach((experiment) => {
      if (techniqueFilter && !String(experiment?.technique || '').toLowerCase().includes(techniqueFilter)) {
        return;
      }
      const { score, matched } = scoreExperiment(experiment, tokens, query);
      scored.push({ record, experiment, score, matched });
    });
  });
  const ranked = rankAndTrim(scored, limit);
  const items = ranked.map(({ record, experiment, score, matched }) => (
    projectionForExperimentMatch(record, experiment, score, matched)
  ));

  return compact({
    ok: true,
    status: items.length ? 'matched' : 'no_match',
    mcp_tool: TOOL_NAMES.SEARCH_EXPERIMENTS,
    query,
    terms_used: tokens,
    project_id: projectId,
    project_name: projectName,
    technique: techniqueFilter || undefined,
    summary: items.length
      ? `Matched ${items.length} experiment${items.length === 1 ? '' : 's'} across ${
        new Set(items.map((item) => item.paper_id)).size
      } paper${items.length === 1 ? '' : 's'}.`
      : `No experiment matched terms: ${tokens.join(', ')}.`,
    items,
    errors: load.errors
  });
}

const PAPER_INTAKE_DIRECT_MCP_TOOLS = Object.freeze([
  Object.freeze({
    definition: LIST_PROJECT_SUMMARIES_DEFINITION,
    handler: callListProjectSummaries
  }),
  Object.freeze({
    definition: SEARCH_SUMMARIES_DEFINITION,
    handler: callSearchSummaries
  }),
  Object.freeze({
    definition: SEARCH_EXPERIMENTS_DEFINITION,
    handler: callSearchExperiments
  })
]);

const PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES = Object.freeze(
  PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => tool.definition.name)
);

function getPaperIntakeDirectMcpToolDefinitions() {
  return PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => tool.definition);
}

/**
 * Build a stand-alone router for the three paper-intake tools. Mirrors the
 * shape of `createDirectMcpToolRouter` in `mcp-contract/direct-tools/index.js`
 * so the eventual wire-up can fold these into the main router or expose them
 * as their own sub-router.
 */
function createPaperIntakeMcpRouter(deps = {}) {
  const handlers = new Map(
    PAPER_INTAKE_DIRECT_MCP_TOOLS.map((tool) => [tool.definition.name, tool.handler])
  );

  return Object.freeze({
    hasTool(name) {
      return handlers.has(String(name || ''));
    },
    async callTool(name, args = {}, context = {}) {
      const handler = handlers.get(String(name || ''));
      if (typeof handler !== 'function') {
        return {
          ok: false,
          status: 'unknown_tool',
          error: `Unknown paper-intake MCP tool "${String(name || 'unknown')}".`
        };
      }
      return handler(args, context, deps);
    },
    getToolDefinitions: getPaperIntakeDirectMcpToolDefinitions
  });
}

module.exports = {
  TOOL_NAMES,
  PAPER_INTAKE_DIRECT_MCP_TOOLS,
  PAPER_INTAKE_DIRECT_MCP_TOOL_NAMES,
  LIST_PROJECT_SUMMARIES_DEFINITION,
  SEARCH_SUMMARIES_DEFINITION,
  SEARCH_EXPERIMENTS_DEFINITION,
  callListProjectSummaries,
  callSearchSummaries,
  callSearchExperiments,
  getPaperIntakeDirectMcpToolDefinitions,
  createPaperIntakeMcpRouter
};
