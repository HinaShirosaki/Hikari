'use strict';

const { DOC_TYPES } = require('../intake-store.js');
const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { MAX_LIMIT, TOOL_NAMES, clampLimit, compact, ensureStore, matchesDocTypes, projectionForListing, readOnlyAnnotations, resolveProjectSelector } = require('./projections.js');

const LIST_PROJECT_SUMMARIES_DEFINITION = Object.freeze({
  name: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
  description: [
    'List one-sentence summaries for every paper currently attached to a Hikari project.',
    'Uses the paper-intake summary knowledge base produced by the `hikari-paper-intake` skill',
    'after each PDF is transferred into a title-named Markdown file under `KnowledgeBase/papers.md/<paper_id>/`.',
    'Returns title, DOI, document type, and the count of recorded experiments for each paper.',
    'Use this when the user asks what papers a project contains or wants a roll-up of recent reading.'
  ].join(' '),
  annotations: readOnlyAnnotations('Paper Intake — List Project Summaries'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
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

async function callListProjectSummaries(input = {}, context = {}, deps = {}) {
  const args = ensureObject(input);
  const { store, error } = ensureStore(deps, TOOL_NAMES.LIST_PROJECT_SUMMARIES);
  if (error) {
    return error;
  }
  const { projectId, projectName } = resolveProjectSelector(args, context);
  if (!projectId && !projectName) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: TOOL_NAMES.LIST_PROJECT_SUMMARIES,
      error: 'Provide project_name (or open a project so it is available in context).'
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
    ? projectRecords.filter((record) => matchesDocTypes(record, docTypes))
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

module.exports = {
  LIST_PROJECT_SUMMARIES_DEFINITION,
  callListProjectSummaries
};
