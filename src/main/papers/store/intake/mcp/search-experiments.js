'use strict';

const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { rankAndTrim, scoreExperiment, tokenize } = require('../intake-search.js');
const { MAX_LIMIT, TOOL_NAMES, clampLimit, cleanText, compact, ensureStore, projectionForExperimentMatch, readOnlyAnnotations, resolveProjectSelector } = require('./projections.js');

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
  const { projectId, projectName } = resolveProjectSelector(args, context);
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

module.exports = {
  SEARCH_EXPERIMENTS_DEFINITION,
  callSearchExperiments
};
