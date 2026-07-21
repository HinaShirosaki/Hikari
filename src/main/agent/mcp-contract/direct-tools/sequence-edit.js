'use strict';

const {
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload
} = require('../../tools/agent-tool-loading.js');
const {
  buildWriteToolAnnotations,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  runAppTool
} = require('./shared.js');

const SEQUENCE_EDIT_MCP_TOOL = Object.freeze({
  name: 'sequence_edit',
  description: 'Propose a sequence base edit or feature annotation change. Never applies the change: it returns a preview plus a pending-approval token that the user must approve in Hikari. destructiveHint is false because nothing mutates without human approval.',
  // Approval-gated: returns a proposal, never applies. destructiveHint:false.
  annotations: buildWriteToolAnnotations('Sequence edit'),
  inputSchema: cloneJson(AGENT_TOOL_CALL_CATALOG['sequence-edit']?.input_schema, {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'target'],
    properties: {
      action: {
        type: 'string',
        enum: ['propose_edit', 'propose_annotation']
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

async function callSequenceEdit(input = {}, context = {}, deps = {}) {
  const normalized = normalizeToolArgumentsPayload({
    tool_calls: [{ tool_name: 'sequence-edit', arguments: ensureObject(input) }]
  }, {
    selectedToolNames: ['sequence-edit']
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: SEQUENCE_EDIT_MCP_TOOL.name,
      app_tool: 'sequence-edit',
      error: normalized.error
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'sequence-edit',
    args: normalized.payload.tool_calls[0].arguments,
    context
  });
  const payload = resolvePayload(result);
  const error = cleanText(payload.error || result?.error, 1200);
  const pendingApproval = payload.pending_approval === true;
  const status = cleanText(payload.status || result?.status, 80)
    || (error ? 'error' : (pendingApproval ? 'pending_approval' : 'completed'));
  const ok = result?.ok !== false && payload.ok !== false && !error;

  return compactObject({
    ...payload,
    ok,
    status,
    pending_approval: pendingApproval,
    mcp_tool: SEQUENCE_EDIT_MCP_TOOL.name,
    app_tool: 'sequence-edit',
    summary: cleanText(payload.summary || result?.summary, 500),
    error
  });
}

module.exports = {
  SEQUENCE_EDIT_MCP_TOOL,
  callSequenceEdit
};
