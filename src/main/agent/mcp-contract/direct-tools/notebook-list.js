'use strict';

const {
  buildReadOnlyToolAnnotations,
  runAppTool,
  resolveDirectToolPayload,
  normalizeToolEnvelope,
  buildLookupResponse
} = require('./shared.js');

const NOTEBOOK_LIST_MCP_TOOL = Object.freeze({
  name: 'notebook_list',
  description: 'List notebook page titles and compact metadata, with optional project, protocol, state, title substring, and date-range filters. No filters lists all pages. Follow pagination.next_offset with unchanged filters until null; access.complete reports storage coverage. Dates use created, updated (default), or executed timestamps; YYYY-MM-DD bounds include the entire UTC day. Results sort newest first, then by entry id.',
  annotations: buildReadOnlyToolAnnotations('Notebook list'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 220, description: 'Case-insensitive title substring.' },
      project_id: { type: 'string', minLength: 1, maxLength: 120 },
      project_name: { type: 'string', minLength: 1, maxLength: 220 },
      protocol_id: { type: 'string', minLength: 1, maxLength: 120 },
      protocol_name: { type: 'string', minLength: 1, maxLength: 220 },
      notebook_state: { type: 'string', enum: ['planned', 'executed', 'suggested'] },
      date_field: { type: 'string', enum: ['created', 'updated', 'executed'], default: 'updated' },
      date_from: { type: 'string', minLength: 1, maxLength: 40, description: 'Inclusive YYYY-MM-DD (UTC) or ISO timestamp with timezone.' },
      date_to: { type: 'string', minLength: 1, maxLength: 40, description: 'Inclusive YYYY-MM-DD (whole UTC day) or ISO timestamp with timezone.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      offset: { type: 'integer', minimum: 0, default: 0, description: 'pagination.next_offset from the previous response; keep all filters unchanged.' }
    }
  }
});

async function callNotebookList(input = {}, context = {}, deps = {}) {
  const result = await runAppTool({ runTool: deps.runTool, toolId: 'notebook-list', args: input, context });
  const envelope = normalizeToolEnvelope(result);
  const response = buildLookupResponse({
    mcpToolName: NOTEBOOK_LIST_MCP_TOOL.name,
    appToolId: 'notebook-list',
    envelope: result,
    items: envelope.items,
    citationReason: 'Notebook page metadata from local Hikari data.',
    emptySummary: 'No notebook pages matched the list filters.'
  });
  const payload = resolveDirectToolPayload(result);
  if (payload.pagination) response.pagination = payload.pagination;
  if (response.ok && response.pagination) {
    response.summary = `Returned ${response.items.length} of ${response.pagination.total} matching notebook pages.`;
    if (response.pagination.has_more) response.summary += ' Continue with pagination.next_offset and the same filters.';
    if (response.access?.complete === false) response.summary += ' Storage coverage is incomplete; totals cover available pages only.';
  }
  return response;
}

module.exports = { NOTEBOOK_LIST_MCP_TOOL, callNotebookList };
