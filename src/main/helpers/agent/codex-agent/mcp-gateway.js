'use strict';

const {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_CALL_CATALOG,
  normalizeToolArgumentsPayload,
  resolveCanonicalToolName
} = require('../tools/agent-tool-loading.js');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const limit = Number.isFinite(Number(maxLength)) ? Number(maxLength) : 2000;
  return limit > 0 ? text.slice(0, limit) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeQuery(value = '') {
  return cleanText(value, 500)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 16);
}

function scoreText(text = '', tokens = []) {
  if (!tokens.length) {
    return 1;
  }
  const haystack = String(text || '').toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

function getToolSchema(toolId) {
  const canonical = resolveCanonicalToolName(toolId);
  return canonical ? ensureObject(AGENT_TOOL_CALL_CATALOG[canonical]) : {};
}

function buildInputHint(toolId) {
  const schema = ensureObject(getToolSchema(toolId).input_schema);
  const properties = ensureObject(schema.properties);
  const required = new Set(asArray(schema.required).map((key) => cleanText(key, 80)).filter(Boolean));
  const keys = Object.keys(properties).slice(0, 7);
  return keys.map((key) => (required.has(key) ? key : `${key}?`)).join(', ');
}

function summarizeTool(entry) {
  return {
    tool_id: entry.name,
    summary: cleanText(entry.description, 800),
    input_hint: buildInputHint(entry.name)
  };
}

function createCodexAgentMcpGateway(deps = {}) {
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  function toolSearch(input = {}) {
    const tokens = normalizeQuery(input.query);
    const limit = Math.max(1, Math.min(30, Number(input.limit) || 8));
    const results = AGENT_TOOL_CATALOG
      .map((entry) => {
        const schema = getToolSchema(entry.name);
        return {
          entry,
          score: scoreText([
            entry.name,
            entry.description,
            schema.description,
            buildInputHint(entry.name)
          ].join(' '), tokens)
        };
      })
      .filter((row) => !tokens.length || row.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
      .slice(0, limit)
      .map((row) => summarizeTool(row.entry));
    return {
      ok: true,
      results
    };
  }

  function toolInfo(input = {}) {
    const toolId = resolveCanonicalToolName(input.tool_id || input.toolId);
    const entry = AGENT_TOOL_CATALOG.find((candidate) => candidate.name === toolId);
    if (!entry) {
      return {
        ok: false,
        error: `Unknown tool_id "${cleanText(input.tool_id || input.toolId, 160) || 'unknown'}".`
      };
    }
    const detailLevel = cleanText(input.detail_level || input.detailLevel || 'summary', 40);
    const schema = getToolSchema(toolId);
    return {
      ok: true,
      detail_level: detailLevel,
      tool: {
        ...summarizeTool(entry),
        detailed_description: cleanText(schema.description, 2400),
        ...(['schema', 'full'].includes(detailLevel) ? {
          input_schema: cloneJson(schema.input_schema, {}),
          schema_defs: cloneJson(AGENT_TOOL_CALL_CATALOG.$defs, {})
        } : {})
      }
    };
  }

  async function toolCall(input = {}, context = {}) {
    const toolId = resolveCanonicalToolName(input.tool_id || input.toolId);
    if (!toolId) {
      return {
        ok: false,
        status: 'invalid_tool',
        error: `Unknown tool_id "${cleanText(input.tool_id || input.toolId, 160) || 'unknown'}".`
      };
    }
    const normalized = normalizeToolArgumentsPayload({
      tool_calls: [{
        tool_name: toolId,
        arguments: ensureObject(input.args)
      }]
    }, {
      selectedToolNames: [toolId]
    });
    if (!normalized.ok) {
      return {
        ok: false,
        status: 'invalid_arguments',
        tool_id: toolId,
        error: normalized.error
      };
    }
    if (!runTool) {
      return {
        ok: false,
        status: 'executor_unavailable',
        tool_id: toolId,
        error: 'Enana MCP tool execution is not connected to a host app runtime yet.'
      };
    }
    const result = await runTool(toolId, normalized.payload.tool_calls[0].arguments, ensureObject(context.snapshot), context);
    return {
      ok: result?.ok !== false,
      status: result?.ok === false ? 'failed' : 'completed',
      tool_id: toolId,
      output: cloneJson(result, result)
    };
  }

  function resourceSearch(input = {}) {
    const tokens = normalizeQuery(input.query);
    const resources = [
      {
        uri: 'enana://instructions/codex-agent',
        name: 'Codex agent instructions',
        description: 'Enana rules for Codex intent parsing, inference verification, paper download, and context loading.'
      },
      ...AGENT_TOOL_CATALOG.map((entry) => ({
        uri: `enana://tool/${entry.name}`,
        name: `${entry.name} tool manifest`,
        description: entry.description
      }))
    ];
    return {
      ok: true,
      results: resources
        .map((resource) => ({
          resource,
          score: scoreText(`${resource.name} ${resource.description} ${resource.uri}`, tokens)
        }))
        .filter((row) => !tokens.length || row.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Math.min(40, Number(input.limit) || 10)))
        .map((row) => row.resource)
    };
  }

  function resourceRead(input = {}) {
    const uri = cleanText(input.uri, 1000);
    if (uri === 'enana://instructions/codex-agent') {
      const { buildEnanaCodexAgentsInstructions } = require('./agent-instructions.js');
      return {
        ok: true,
        uri,
        mimeType: 'text/markdown',
        contents: buildEnanaCodexAgentsInstructions()
      };
    }
    const toolMatch = uri.match(/^enana:\/\/tool\/(.+)$/i);
    if (toolMatch) {
      return {
        ok: true,
        uri,
        mimeType: 'application/json',
        contents: toolInfo({ tool_id: toolMatch[1], detail_level: 'full' })
      };
    }
    return {
      ok: false,
      uri,
      error: `Resource "${uri || 'unknown'}" is not available.`
    };
  }

  async function callGatewayTool(name = '', args = {}, context = {}) {
    const toolName = cleanText(name, 120);
    if (toolName === 'tool_search') {
      return toolSearch(args);
    }
    if (toolName === 'tool_info') {
      return toolInfo(args);
    }
    if (toolName === 'tool_call') {
      return toolCall(args, context);
    }
    if (toolName === 'resource_search') {
      return resourceSearch(args);
    }
    if (toolName === 'resource_read') {
      return resourceRead(args);
    }
    return {
      ok: false,
      error: `Unknown Enana MCP gateway tool "${toolName || 'unknown'}".`
    };
  }

  return {
    callGatewayTool,
    toolSearch,
    toolInfo,
    toolCall,
    resourceSearch,
    resourceRead
  };
}

module.exports = {
  createCodexAgentMcpGateway
};
