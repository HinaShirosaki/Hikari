'use strict';

const { DOC_TYPES } = require('../intake-store.js');
const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { rankAndTrim, scoreSummary, tokenize } = require('../intake-search.js');
const { MAX_LIMIT, TOOL_NAMES, clampLimit, cleanText, compact, ensureStore, matchesDocTypes, projectionForSummaryMatch, readOnlyAnnotations, resolveProjectSelector } = require('./projections.js');

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
      project_name: { type: 'string', minLength: 1, maxLength: 240 },
      doc_types: {
        type: 'array',
        items: { type: 'string', enum: [...DOC_TYPES] },
        maxItems: DOC_TYPES.length,
        description: 'Restrict results to these document types. Papers that have not been classified yet are still returned, marked `intake_status: "metadata_only"`; treat those as unclassified rather than as matching the requested type.'
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
      app_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      error: 'Provide a non-empty query.'
    };
  }
  const tokens = tokenize(query);
  if (!tokens.length) {
    return {
      ok: true,
      status: 'no_match',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      app_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      query,
      summary: 'Query produced no usable search terms after stopword removal.',
      items: []
    };
  }
  const docTypes = asArray(args.doc_types).filter((value) => DOC_TYPES.includes(value));
  const { projectId, projectName } = resolveProjectSelector(args, context);
  const limit = clampLimit(args.limit);

  const load = await store.loadAll();
  if (!load.ok) {
    return {
      ok: false,
      status: load.status || 'failed',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      app_tool: TOOL_NAMES.SEARCH_SUMMARIES,
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
    candidates = candidates.filter((record) => matchesDocTypes(record, docTypes));
  }

  const scored = candidates
    .map((record) => {
      const { score, matched } = scoreSummary(record, tokens, query);
      return { record, score, matched };
    });
  const ranked = rankAndTrim(scored, limit);
  const items = ranked.map(({ record, score, matched }) => projectionForSummaryMatch(record, score, matched));

  return {
    ...compact({
      ok: true,
      status: items.length ? 'matched' : 'no_match',
      mcp_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      app_tool: TOOL_NAMES.SEARCH_SUMMARIES,
      query,
      terms_used: tokens,
      project_id: projectId,
      project_name: projectName,
      doc_types: docTypes,
      summary: items.length
        ? `Matched ${items.length} paper${items.length === 1 ? '' : 's'} on summary terms: ${tokens.join(', ')}.`
        : `No paper summary matched terms: ${tokens.join(', ')}.`,
      errors: load.errors
    }),
    items
  };
}

module.exports = {
  SEARCH_SUMMARIES_DEFINITION,
  callSearchSummaries
};
