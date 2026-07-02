'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
  HIKARI_APP_MCP_ENDPOINT_PATH,
  HIKARI_APP_TOOL_CALL_TOOL_NAME
} = require('./host.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

function resolveAgentMcpEndpointUrl(rawUrl = '') {
  const endpoint = cleanText(rawUrl, 2000).replace(/\/+$/u, '');
  if (!endpoint) {
    return null;
  }
  const url = new URL(endpoint);
  const pathname = cleanText(url.pathname, 2000);
  if (!pathname || pathname === '/') {
    url.pathname = HIKARI_APP_MCP_ENDPOINT_PATH;
  }
  return url;
}

function extractToolCallOutput(response = {}) {
  const structured = ensureObject(response.structuredContent);
  if (Object.prototype.hasOwnProperty.call(structured, 'output')) {
    return structured.output;
  }
  return structured;
}

function createAgentMcpHostToolRunner(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const rawHostUrl = cleanText(
    options.hostUrl
      || env.HIKARI_AGENT_MCP_HOST
      || env.HIKARI_CODEX_MCP_HOST,
    2000
  );
  const token = cleanText(
    options.token
      || env.HIKARI_AGENT_MCP_TOKEN
      || env.HIKARI_CODEX_MCP_TOKEN,
    4000
  );
  if (!rawHostUrl) {
    return null;
  }
  const hostUrl = resolveAgentMcpEndpointUrl(rawHostUrl);
  if (!hostUrl) {
    return null;
  }
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  return async (toolId, args, snapshot = {}, context = {}) => {
    const client = new Client(
      { name: 'hikari-agent-mcp-host-client', version: '0.1.0' },
      { capabilities: {} }
    );
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const transport = new StreamableHTTPClientTransport(hostUrl, {
      requestInit: {
        headers
      }
    });

    try {
      await client.connect(transport);
      const response = await client.callTool({
        name: HIKARI_APP_TOOL_CALL_TOOL_NAME,
        arguments: {
          tool_id: toolId,
          args: ensureObject(args),
          snapshot: ensureObject(snapshot),
          context: ensureObject(context)
        }
      }, undefined, {
        timeout: timeoutMs
      });
      return extractToolCallOutput(response);
    } finally {
      if (typeof transport.terminateSession === 'function') {
        try {
          await transport.terminateSession();
        } catch {
          /* ignore host session cleanup failures */
        }
      }
      await client.close();
    }
  };
}

const createCodexMcpHostToolRunner = createAgentMcpHostToolRunner;

module.exports = {
  createAgentMcpHostToolRunner,
  createCodexMcpHostToolRunner,
  resolveAgentMcpEndpointUrl
};
