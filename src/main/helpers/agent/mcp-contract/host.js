'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const {
  HIKARI_MCP_HEADERS_TIMEOUT_MS,
  HIKARI_MCP_KEEP_ALIVE_TIMEOUT_MS,
  HIKARI_MCP_TOOL_TIMEOUT_MS
} = require('./constants.js');

const SERVER_NAME = 'hikari-agent-mcp-app-host';
const SERVER_VERSION = '0.1.0';
const HIKARI_APP_MCP_ENDPOINT_PATH = '/mcp';
const HIKARI_APP_TOOL_CALL_TOOL_NAME = 'hikari_app_tool_call';
const LITERATURE_SEARCH_REQUEST_TTL_MS = HIKARI_MCP_TOOL_TIMEOUT_MS;

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return text && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function captureEnvValue(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key)
    ? { present: true, value: env[key] }
    : { present: false, value: undefined };
}

function restoreEnvValue(env, key, previous) {
  if (previous?.present) {
    env[key] = previous.value;
  } else {
    delete env[key];
  }
}

function toolResult(payload = {}) {
  const result = ensureObject(payload);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError: result.ok === false
  };
}

function createAgentMcpHost(deps = {}) {
  const runTool = typeof deps.runTool === 'function' ? deps.runTool : null;
  const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : (() => ({}));
  const getContextDefaults = typeof deps.getContextDefaults === 'function'
    ? deps.getContextDefaults
    : (() => ({}));
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const hostname = cleanText(deps.hostname, 120) || '127.0.0.1';
  const token = cleanText(deps.token, 4000) || crypto.randomBytes(24).toString('hex');
  const managedEnvKeys = Object.freeze([
    'HIKARI_AGENT_MCP_HOST',
    'HIKARI_AGENT_MCP_TOKEN',
    'HIKARI_CODEX_MCP_HOST',
    'HIKARI_CODEX_MCP_TOKEN'
  ]);
  const previousEnvValues = new Map(managedEnvKeys.map((key) => [key, captureEnvValue(env, key)]));
  let server = null;
  let started = null;
  let hostUrl = '';
  const literatureSearchRequestIds = new Map();

  function claimLiteratureSearchRequest(context = {}) {
    const source = ensureObject(context);
    const requestId = cleanText(
      source.traceRequestId
        || source.trace_request_id
        || source.requestId
        || source.request_id,
      160
    );
    if (!requestId) {
      return true;
    }
    const now = Date.now();
    literatureSearchRequestIds.forEach((createdAt, key) => {
      if (now - createdAt > LITERATURE_SEARCH_REQUEST_TTL_MS) {
        literatureSearchRequestIds.delete(key);
      }
    });
    if (literatureSearchRequestIds.has(requestId)) {
      return false;
    }
    literatureSearchRequestIds.set(requestId, now);
    return true;
  }

  function writeJson(response, statusCode, payload = {}, headers = {}) {
    const body = JSON.stringify(ensureObject(payload));
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      ...headers
    });
    response.end(body);
  }

  function isAuthorized(request) {
    if (!token) {
      return true;
    }
    const auth = cleanText(request.headers.authorization, 5000);
    return auth === `Bearer ${token}` || [
      request.headers['x-hikari-agent-mcp-token'],
      request.headers['x-hikari-codex-mcp-token']
    ].some((value) => cleanText(value, 5000) === token);
  }

  function createMcpServer() {
    const mcpServer = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        instructions: 'Private Hikari app-runtime callback server. Use the app tool call tool for live app execution.'
      }
    );
    mcpServer.registerTool(HIKARI_APP_TOOL_CALL_TOOL_NAME, {
      title: 'Hikari app tool call',
      description: 'Run one Hikari app-runtime tool through the live app process.',
      inputSchema: {
        tool_id: z.string().min(1),
        args: z.record(z.any()).optional(),
        snapshot: z.record(z.any()).optional(),
        context: z.record(z.any()).optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    }, async ({ tool_id: toolId, args = {}, snapshot = {}, context = {} }) => {
      if (!runTool) {
        return toolResult({
          ok: false,
          status: 'executor_unavailable',
          error: 'Hikari MCP tool execution is not connected to the app runtime.'
        });
      }
      const mergedContext = {
        ...ensureObject(getContextDefaults()),
        ...ensureObject(context),
        agentMcp: true
      };
      const providedSnapshot = ensureObject(snapshot);
      const liveSnapshot = Object.keys(providedSnapshot).length
        ? providedSnapshot
        : ensureObject(getSnapshot());
      const normalizedToolId = cleanText(toolId, 160);
      if (normalizedToolId === 'literature-search' && !claimLiteratureSearchRequest(mergedContext)) {
        return toolResult({
          ok: false,
          status: 'rejected',
          tool_id: normalizedToolId,
          error: 'This Codex turn already completed one literature_search request. Use its structured result to answer, or ask the user to start a refinement turn.'
        });
      }
      try {
        const output = await runTool(normalizedToolId, ensureObject(args), liveSnapshot, mergedContext);
        return toolResult({
          ok: output?.ok !== false,
          status: output?.ok === false ? 'failed' : 'completed',
          tool_id: normalizedToolId,
          output
        });
      } catch (error) {
        return toolResult({
          ok: false,
          status: 'failed',
          tool_id: normalizedToolId,
          error: cleanText(error?.message || error, 1200) || 'Hikari MCP tool execution failed.'
        });
      }
    });
    return mcpServer;
  }

  async function handleMcpRequest(request, response) {
    if (!isAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        status: 'unauthorized',
        error: 'Hikari MCP host token is missing or invalid.'
      }, {
        'WWW-Authenticate': 'Bearer realm="hikari-agent-mcp-host"'
      });
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(405, { Allow: 'POST, DELETE', 'Content-Length': '0' });
      response.end();
      return;
    }
    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined
    });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response);
    } finally {
      await mcpServer.close();
    }
  }

  async function handleRequest(request, response) {
    try {
      const requestUrl = new URL(request.url || '/', `http://${hostname}`);
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(response, 200, {
          ok: true,
          name: 'hikari-agent-mcp-host',
          transport: 'mcp-sdk-streamable-http',
          endpoint: HIKARI_APP_MCP_ENDPOINT_PATH
        });
      } else if (requestUrl.pathname === HIKARI_APP_MCP_ENDPOINT_PATH) {
        await handleMcpRequest(request, response);
      } else {
        writeJson(response, 404, { ok: false, error: 'Unknown Hikari MCP host route.' });
      }
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: cleanText(error?.message || error, 1200) || 'Hikari MCP host failed.'
      });
    }
  }

  async function ensureStarted() {
    if (hostUrl) {
      return { url: hostUrl, token };
    }
    if (started) {
      return started;
    }
    const localServer = http.createServer((request, response) => {
      void handleRequest(request, response);
    });
    localServer.headersTimeout = HIKARI_MCP_HEADERS_TIMEOUT_MS;
    localServer.requestTimeout = HIKARI_MCP_TOOL_TIMEOUT_MS;
    localServer.keepAliveTimeout = HIKARI_MCP_KEEP_ALIVE_TIMEOUT_MS;
    server = localServer;
    started = new Promise((resolve, reject) => {
      const failStart = (error) => {
        if (server === localServer) {
          server = null;
          started = null;
        }
        try {
          localServer.close();
        } catch {
          /* ignore */
        }
        reject(error);
      };
      localServer.once('error', failStart);
      localServer.listen(0, hostname, () => {
        localServer.off('error', failStart);
        const address = localServer.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        hostUrl = `http://${hostname}:${port}${HIKARI_APP_MCP_ENDPOINT_PATH}`;
        env.HIKARI_AGENT_MCP_HOST = hostUrl;
        env.HIKARI_AGENT_MCP_TOKEN = token;
        env.HIKARI_CODEX_MCP_HOST = hostUrl;
        env.HIKARI_CODEX_MCP_TOKEN = token;
        resolve({ url: hostUrl, token });
      });
    });
    return started;
  }

  async function close() {
    const localServer = server;
    if (localServer) {
      await new Promise((resolve) => {
        localServer.close(() => resolve());
      });
    }
    if (server === localServer) {
      server = null;
    }
    started = null;
    hostUrl = '';
    managedEnvKeys.forEach((key) => restoreEnvValue(env, key, previousEnvValues.get(key)));
  }

  return {
    ensureStarted,
    close,
    getHostUrl: () => hostUrl,
    getToken: () => token
  };
}

const createCodexAgentMcpHost = createAgentMcpHost;

module.exports = {
  HIKARI_APP_MCP_ENDPOINT_PATH,
  HIKARI_APP_TOOL_CALL_TOOL_NAME,
  createAgentMcpHost,
  createCodexAgentMcpHost
};
