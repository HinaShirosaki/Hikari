'use strict';

const {
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload
} = require('../../tools/agent-tool-loading.js');
const {
  buildReadOnlyToolAnnotations,
  buildWriteToolAnnotations,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  runAppTool
} = require('./shared.js');

const READ_ONLY_APP_TOOL_IDS = Object.freeze(new Set([
  'purchase-recommendation'
]));

const OPEN_WORLD_APP_TOOL_IDS = Object.freeze(new Set([
  'literature-search',
  'paper-download',
  'paper-analysis',
  'purchase-recommendation'
]));

function toDirectMcpToolName(appToolId = '') {
  return cleanText(appToolId, 160).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function titleFromToolId(appToolId = '') {
  return cleanText(appToolId, 160)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function schemaUsesSharedDefs(schema = {}) {
  try {
    return JSON.stringify(schema).includes('#/$defs/');
  } catch {
    return false;
  }
}

function collectSchemaRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaRefs(item, refs));
    return refs;
  }
  if (!value || typeof value !== 'object') {
    return refs;
  }
  const ref = cleanText(value.$ref, 200);
  const match = ref.match(/^#\/\$defs\/([A-Za-z0-9_-]+)$/);
  if (match) {
    refs.add(match[1]);
  }
  Object.entries(value).forEach(([key, entryValue]) => {
    if (key === '$defs') {
      return;
    }
    collectSchemaRefs(entryValue, refs);
  });
  return refs;
}

function pickReferencedDefs(inputSchema = {}, sharedDefs = {}) {
  const defs = ensureObject(sharedDefs);
  const picked = {};
  const pending = [...collectSchemaRefs(inputSchema)];
  const seen = new Set();
  while (pending.length) {
    const name = pending.shift();
    if (seen.has(name) || !defs[name]) {
      continue;
    }
    seen.add(name);
    picked[name] = cloneJson(defs[name], {});
    collectSchemaRefs(defs[name]).forEach((refName) => {
      if (!seen.has(refName)) {
        pending.push(refName);
      }
    });
  }
  return picked;
}

function buildDirectInputSchema(appToolId = '') {
  const schemaEntry = ensureObject(AGENT_TOOL_CALL_CATALOG[appToolId]);
  const inputSchema = cloneJson(schemaEntry.input_schema, {
    type: 'object',
    additionalProperties: true,
    properties: {}
  });
  if (schemaUsesSharedDefs(inputSchema)) {
    const referencedDefs = pickReferencedDefs(inputSchema, AGENT_TOOL_CALL_CATALOG.$defs);
    if (Object.keys(referencedDefs).length) {
      inputSchema.$defs = referencedDefs;
    }
  }
  return inputSchema;
}

function buildDirectToolAnnotations(appToolId = '') {
  const title = titleFromToolId(appToolId);
  const annotations = READ_ONLY_APP_TOOL_IDS.has(appToolId)
    ? buildReadOnlyToolAnnotations(title)
    : buildWriteToolAnnotations(title);
  if (OPEN_WORLD_APP_TOOL_IDS.has(appToolId)) {
    return {
      ...annotations,
      openWorldHint: true
    };
  }
  return annotations;
}

function createDirectAppTool(appToolId = '', options = {}) {
  const toolId = cleanText(appToolId, 160);
  const directName = cleanText(options.name, 160) || toDirectMcpToolName(toolId);
  const schemaEntry = ensureObject(AGENT_TOOL_CALL_CATALOG[toolId]);
  const definition = Object.freeze({
    name: directName,
    description: cleanText(options.description, 2400)
      || cleanText(schemaEntry.description, 2400)
      || `Call the Hikari ${toolId} tool directly.`,
    annotations: ensureObject(options.annotations).title
      ? cloneJson(options.annotations, {})
      : buildDirectToolAnnotations(toolId),
    inputSchema: ensureObject(options.inputSchema).type
      ? cloneJson(options.inputSchema, {})
      : buildDirectInputSchema(toolId)
  });

  async function callDirectAppTool(input = {}, context = {}, deps = {}) {
    const normalized = normalizeToolArgumentsPayload({
      tool_calls: [{
        tool_name: toolId,
        arguments: ensureObject(input)
      }]
    }, {
      selectedToolNames: [toolId]
    });
    if (!normalized.ok) {
      return {
        ok: false,
        status: 'invalid_arguments',
        mcp_tool: directName,
        app_tool: toolId,
        error: normalized.error
      };
    }

    const result = await runAppTool({
      runTool: deps.runTool,
      toolId,
      args: normalized.payload.tool_calls[0].arguments,
      context
    });
    const status = result?.ok === false
      ? (cleanText(result?.status, 80) || 'failed')
      : (cleanText(result?.status || result?.result?.status || result?.output?.status, 80) || 'completed');
    return compactObject({
      ok: result?.ok !== false,
      status,
      mcp_tool: directName,
      app_tool: toolId,
      output: cloneJson(result, result),
      error: cleanText(result?.error || result?.result?.error || result?.output?.error, 1200)
    });
  }

  return Object.freeze({
    appToolId: toolId,
    definition,
    handler: callDirectAppTool
  });
}

module.exports = {
  createDirectAppTool,
  toDirectMcpToolName
};
