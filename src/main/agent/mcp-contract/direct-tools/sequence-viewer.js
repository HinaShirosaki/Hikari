'use strict';

const {
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload
} = require('../../tools/agent-tool-loading.js');
const {
  buildReadOnlyToolAnnotations,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  runAppTool
} = require('./shared.js');

const SEQUENCE_VIEWER_MCP_TOOL = Object.freeze({
  name: 'sequence_viewer',
  description: 'Read and compute over the loaded sequence-viewer records: list records, read metadata, windowed sequence slices, features, restriction/ORF/translation/GC analysis, and compute-only cloning designs. Read-only — never mutates.',
  annotations: buildReadOnlyToolAnnotations('Sequence viewer'),
  inputSchema: cloneJson(AGENT_TOOL_CALL_CATALOG['sequence-viewer']?.input_schema, {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list_records', 'get_record', 'get_sequence', 'get_features', 'analyze', 'design_cloning', 'get_cloning_design']
      }
    }
  })
});

function resolvePayload(result = {}) {
  const source = ensureObject(result);
  const resultPayload = ensureObject(source.result);
  if (Object.keys(resultPayload).length) {
    return resultPayload;
  }
  return source;
}

async function callSequenceViewer(input = {}, context = {}, deps = {}) {
  const normalized = normalizeToolArgumentsPayload({
    tool_calls: [{ tool_name: 'sequence-viewer', arguments: ensureObject(input) }]
  }, {
    selectedToolNames: ['sequence-viewer']
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: SEQUENCE_VIEWER_MCP_TOOL.name,
      app_tool: 'sequence-viewer',
      error: normalized.error
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'sequence-viewer',
    args: normalized.payload.tool_calls[0].arguments,
    context
  });
  const payload = resolvePayload(result);
  const error = cleanText(payload.error || result?.error, 1200);
  const status = cleanText(payload.status || result?.status, 80) || (error ? 'error' : 'completed');
  const ok = result?.ok !== false && payload.ok !== false && !error;

  return compactObject({
    ...payload,
    ok,
    status,
    mcp_tool: SEQUENCE_VIEWER_MCP_TOOL.name,
    app_tool: 'sequence-viewer',
    summary: cleanText(payload.summary || result?.summary, 500),
    error
  });
}

module.exports = {
  SEQUENCE_VIEWER_MCP_TOOL,
  callSequenceViewer
};
