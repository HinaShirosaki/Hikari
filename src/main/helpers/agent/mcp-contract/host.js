'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

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

function parseJson(raw = '', fallback = {}) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
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

function createAgentMcpHost(deps = {}) {
  const runTool = typeof deps.runTool === 'function' ? deps.runTool : null;
  const getSnapshot = typeof deps.getSnapshot === 'function' ? deps.getSnapshot : (() => ({}));
  const getContextDefaults = typeof deps.getContextDefaults === 'function'
    ? deps.getContextDefaults
    : (() => ({}));
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const hostname = cleanText(deps.hostname, 120) || '127.0.0.1';
  const token = cleanText(deps.token, 4000) || crypto.randomBytes(24).toString('hex');
  const maxBodyBytes = Math.max(1024, Math.min(10 * 1024 * 1024, Number(deps.maxBodyBytes) || 5 * 1024 * 1024));
  const managedEnvKeys = Object.freeze([
    'HIKARI_AGENT_MCP_HOST',
    'HIKARI_AGENT_MCP_TOKEN',
    'ENANA_AGENT_MCP_HOST',
    'ENANA_AGENT_MCP_TOKEN',
    'HIKARI_CODEX_MCP_HOST',
    'HIKARI_CODEX_MCP_TOKEN',
    'ENANA_CODEX_MCP_HOST',
    'ENANA_CODEX_MCP_TOKEN'
  ]);
  const previousEnvValues = new Map(
    managedEnvKeys.map((key) => [key, captureEnvValue(env, key)])
  );
  let server = null;
  let started = null;
  let hostUrl = '';

  function writeJson(response, statusCode, payload = {}) {
    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    response.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body, 'utf8')
    });
    response.end(body);
  }

  function readRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = '';
      let total = 0;
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        const text = String(chunk || '');
        total += Buffer.byteLength(text, 'utf8');
        if (total > maxBodyBytes) {
          reject(new Error('Hikari MCP host request is too large.'));
          request.destroy();
          return;
        }
        raw += text;
      });
      request.on('end', () => resolve(raw));
      request.on('error', reject);
    });
  }

  function isAuthorized(request) {
    if (!token) {
      return true;
    }
    const auth = cleanText(request.headers.authorization, 5000);
    const headerTokens = [
      request.headers['x-hikari-agent-mcp-token'],
      request.headers['x-enana-agent-mcp-token'],
      request.headers['x-hikari-codex-mcp-token'],
      request.headers['x-enana-codex-mcp-token']
    ].map((value) => cleanText(value, 5000));
    return auth === `Bearer ${token}` || headerTokens.includes(token);
  }

  async function handleToolCall(request, response) {
    if (!runTool) {
      writeJson(response, 503, {
        ok: false,
        status: 'executor_unavailable',
        error: 'Hikari MCP tool execution is not connected to the app runtime.'
      });
      return;
    }
    if (!isAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        status: 'unauthorized',
        error: 'Hikari MCP host token is missing or invalid.'
      });
      return;
    }

    const body = parseJson(await readRequestBody(request), {});
    const toolId = cleanText(body.tool_id || body.toolId, 160);
    const args = ensureObject(body.args);
    const context = {
      ...ensureObject(getContextDefaults()),
      ...ensureObject(body.context),
      agentMcp: true
    };
    const snapshot = Object.keys(ensureObject(body.snapshot)).length
      ? ensureObject(body.snapshot)
      : ensureObject(getSnapshot());
    const result = await runTool(toolId, args, snapshot, context);
    writeJson(response, 200, {
      ok: result?.ok !== false,
      status: result?.ok === false ? 'failed' : 'completed',
      tool_id: toolId,
      output: result
    });
  }

  async function handleRequest(request, response) {
    try {
      const requestUrl = new URL(request.url || '/', `http://${hostname}`);
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(response, 200, {
          ok: true,
          name: 'hikari-agent-mcp-host'
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/tool-call') {
        await handleToolCall(request, response);
        return;
      }
      writeJson(response, 404, {
        ok: false,
        error: 'Unknown Hikari MCP host route.'
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: cleanText(error?.message || error, 1200) || 'Hikari MCP host failed.'
      });
    }
  }

  async function ensureStarted() {
    if (hostUrl) {
      return {
        url: hostUrl,
        token
      };
    }
    if (started) {
      return started;
    }
    const localServer = http.createServer((request, response) => {
      void handleRequest(request, response);
    });
    localServer.headersTimeout = 65_000;
    localServer.requestTimeout = 60_000;
    localServer.keepAliveTimeout = 5_000;
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
        hostUrl = `http://${hostname}:${port}`;
        env.HIKARI_AGENT_MCP_HOST = hostUrl;
        env.HIKARI_AGENT_MCP_TOKEN = token;
        env.ENANA_AGENT_MCP_HOST = hostUrl;
        env.ENANA_AGENT_MCP_TOKEN = token;
        env.HIKARI_CODEX_MCP_HOST = hostUrl;
        env.HIKARI_CODEX_MCP_TOKEN = token;
        env.ENANA_CODEX_MCP_HOST = hostUrl;
        env.ENANA_CODEX_MCP_TOKEN = token;
        resolve({
          url: hostUrl,
          token
        });
      });
    });
    return started;
  }

  async function close() {
    if (!server) {
      return;
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    started = null;
    hostUrl = '';
    managedEnvKeys.forEach((key) => {
      restoreEnvValue(env, key, previousEnvValues.get(key));
    });
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
  createAgentMcpHost,
  createCodexAgentMcpHost
};
