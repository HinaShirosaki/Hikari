'use strict';

const {
  asArray,
  cleanText,
  cloneJson,
  compactObject,
  ensureObject,
  runAppTool
} = require('./shared.js');

const PROTOCOL_GENERATION_MCP_TOOL = Object.freeze({
  name: 'protocol_generation',
  description: 'Normalize supplied protocol JSON into Hikari import-ready protocol format without an internal LLM call or required protocol id.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['protocol'],
    properties: {
      protocol: {
        type: 'object',
        additionalProperties: true,
        required: ['steps'],
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          purpose: { type: 'string' },
          materials: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 80
          },
          steps: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    text: { type: 'string' },
                    instruction: { type: 'string' },
                    action: { type: 'string' },
                    step_number: { type: 'integer' },
                    placeholders: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' }
                        }
                      },
                      maxItems: 60
                    }
                  }
                }
              ]
            },
            maxItems: 120
          },
          troubleshooting: {
            anyOf: [
              { type: 'string' },
              { type: 'array' }
            ]
          },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      result_summary: { type: 'string' }
    }
  }
});

function parseLineList(rawText = '') {
  return String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function normalizeProtocolForApp(inputProtocol = {}) {
  const protocol = cloneJson(ensureObject(inputProtocol), {});
  delete protocol.id;
  delete protocol.protocol_id;
  delete protocol.protocolId;

  if (!Array.isArray(protocol.steps) && Array.isArray(protocol.procedure)) {
    protocol.steps = protocol.procedure;
  }
  if (typeof protocol.materials === 'string') {
    protocol.materials = parseLineList(protocol.materials);
  }
  if (!cleanText(protocol.name, 220)) {
    protocol.name = cleanText(protocol.title || protocol.protocol_name || protocol.protocolName, 220)
      || 'Generated protocol';
  }
  return protocol;
}

function resolveProtocolGenerationPayload(result = {}) {
  const source = ensureObject(result);
  const resultPayload = ensureObject(source.result);
  const outputPayload = ensureObject(source.output);
  if (Object.keys(resultPayload).length) {
    return resultPayload;
  }
  if (Object.keys(outputPayload).length) {
    return outputPayload;
  }
  return source;
}

async function callProtocolGeneration(input = {}, context = {}, deps = {}) {
  const protocol = normalizeProtocolForApp(input.protocol);
  if (!Object.keys(protocol).length || !asArray(protocol.steps).length) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: PROTOCOL_GENERATION_MCP_TOOL.name,
      app_tool: 'protocol-generation',
      error: 'protocol_generation requires protocol JSON with at least one step.'
    };
  }

  const result = await runAppTool({
    runTool: deps.runTool,
    toolId: 'protocol-generation',
    args: compactObject({
      protocol,
      result_summary: cleanText(input.result_summary || input.resultSummary || input.summary, 320)
    }),
    context
  });
  const payload = resolveProtocolGenerationPayload(result);
  const outputProtocol = ensureObject(payload.protocol);
  const ok = result?.ok !== false && payload.ok !== false && Boolean(Object.keys(outputProtocol).length);
  const error = cleanText(payload.error || result?.error, 1200);
  return compactObject({
    ok,
    status: ok
      ? (cleanText(payload.status || result?.status, 80) || 'normalized')
      : (cleanText(payload.status || result?.status, 80) || 'failed'),
    mcp_tool: PROTOCOL_GENERATION_MCP_TOOL.name,
    app_tool: 'protocol-generation',
    summary: cleanText(payload.summary || result?.summary, 320),
    protocol: outputProtocol,
    error
  });
}

module.exports = {
  PROTOCOL_GENERATION_MCP_TOOL,
  callProtocolGeneration,
  normalizeProtocolForApp
};
