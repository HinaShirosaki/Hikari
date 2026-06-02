'use strict';

const http = require('node:http');
const https = require('node:https');

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

function postJson(url, payload, headers = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    const client = parsed.protocol === 'https:' ? https : http;
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_REQUEST_TIMEOUT_MS;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };
    const request = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        ...headers
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += String(chunk || '');
      });
      response.on('error', (error) => {
        request.destroy();
        settle(reject, error);
      });
      response.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = raw ? JSON.parse(raw) : {};
        } catch {
          parsedBody = { ok: false, error: raw || 'Invalid Hikari MCP host response.' };
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          settle(resolve, parsedBody);
          return;
        }
        const error = new Error(cleanText(parsedBody?.error || raw, 1200) || `Hikari MCP host returned ${response.statusCode}.`);
        error.statusCode = response.statusCode;
        error.payload = parsedBody;
        settle(reject, error);
      });
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error(`Hikari MCP host request timed out after ${timeoutMs}ms.`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', (error) => settle(reject, error));
    request.write(body);
    request.end();
  });
}

function createAgentMcpHostToolRunner(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const hostUrl = cleanText(
    options.hostUrl
      || env.HIKARI_AGENT_MCP_HOST
      || env.ENANA_AGENT_MCP_HOST
      || env.HIKARI_CODEX_MCP_HOST
      || env.ENANA_CODEX_MCP_HOST,
    2000
  ).replace(/\/+$/u, '');
  const token = cleanText(
    options.token
      || env.HIKARI_AGENT_MCP_TOKEN
      || env.ENANA_AGENT_MCP_TOKEN
      || env.HIKARI_CODEX_MCP_TOKEN
      || env.ENANA_CODEX_MCP_TOKEN,
    4000
  );
  if (!hostUrl) {
    return null;
  }

  return async (toolId, args, snapshot = {}, context = {}) => {
    const response = await postJson(
      `${hostUrl}/tool-call`,
      {
        tool_id: toolId,
        args: ensureObject(args),
        snapshot: ensureObject(snapshot),
        context: ensureObject(context)
      },
      token ? { Authorization: `Bearer ${token}` } : {}
    );
    return response && Object.prototype.hasOwnProperty.call(response, 'output')
      ? response.output
      : response;
  };
}

const createCodexMcpHostToolRunner = createAgentMcpHostToolRunner;

module.exports = {
  createAgentMcpHostToolRunner,
  createCodexMcpHostToolRunner,
  postJson
};
