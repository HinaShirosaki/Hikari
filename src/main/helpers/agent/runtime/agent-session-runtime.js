'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { createAgentLlmProviderBridge } = require('../shared/agent-llm-provider-bridge.js');

function createAgentSessionRuntime(deps = {}) {
  const AGENT_SESSION_MAX_OUTPUT_TOKENS = 2200;
  const {
    LLM_PROVIDERS,
    asArray,
    cleanText,
    safeParseJson,
    toInputText,
    extractResponseText,
    extractClaudeResponseText,
    extractGeminiResponseText
  } = createAgentLlmRuntimeHelpers(deps);
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  // recordAgentLlmTrace(...) is executed inside the shared provider bridge for
  // every start/continue session turn.

  function buildCodexToolLoopPrompt({
    systemPrompt,
    transcript = [],
    toolDefinitions = []
  }) {
    const toolRows = asArray(toolDefinitions).map((tool) => [
      `Tool: ${cleanText(tool?.name, 120) || 'unknown_tool'}`,
      `Description: ${cleanText(tool?.description, 500) || '-'}`,
      `Input schema JSON:\n${JSON.stringify(tool?.parameters || { type: 'object', additionalProperties: true }, null, 2)}`
    ].join('\n')).join('\n\n');
    const transcriptText = asArray(transcript).map((entry, index) => {
      const role = cleanText(entry?.role, 30) || 'system';
      const text = cleanText(entry?.text, 16000);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      cleanText(systemPrompt, 12000),
      'You are participating in a stepwise tool loop.',
      'At each turn, either request exactly one tool call or answer directly if the evidence is already sufficient.',
      'Return JSON only in one of these forms:',
      '{"assistant_text":"progress update","tool_call":{"name":"tool_name","arguments":{}}}',
      '{"assistant_text":"grounded final answer","tool_call":null}',
      'Never return more than one tool call in a single turn.',
      toolRows ? `Available tools:\n${toolRows}` : 'No tools are available.',
      transcriptText ? `Transcript:\n${transcriptText}` : ''
    ].filter(Boolean).join('\n\n');
  }

  const llmProviderBridge = deps.llmProviderBridge && typeof deps.llmProviderBridge === 'object'
    ? deps.llmProviderBridge
    : createAgentLlmProviderBridge({
      ...deps,
      LLM_PROVIDERS,
      asArray,
      cleanText,
      safeParseJson,
      toInputText,
      extractResponseText,
      extractClaudeResponseText,
      extractGeminiResponseText,
      recordAgentLlmTrace,
      buildCodexToolLoopPrompt,
      agentSessionMaxOutputTokens: AGENT_SESSION_MAX_OUTPUT_TOKENS
    });

  async function startAgentSession(input = {}) {
    return llmProviderBridge.startToolSession(input);
  }

  function extractAgentSessionFunctionCalls(session) {
    return llmProviderBridge.extractToolSessionFunctionCalls(session);
  }

  function extractAgentSessionText(session) {
    return llmProviderBridge.extractToolSessionText(session);
  }

  async function continueAgentSessionWithToolOutputs(session, toolOutputs, traceContext = null) {
    return llmProviderBridge.continueToolSessionWithToolOutputs(session, toolOutputs, traceContext);
  }

  async function continueAgentSessionWithUserMessage(session, message, traceContext = null) {
    return llmProviderBridge.continueToolSessionWithUserMessage(session, message, traceContext);
  }

  return {
    extractResponseText,
    extractFunctionCalls: llmProviderBridge.extractFunctionCalls,
    extractClaudeResponseText,
    extractGeminiResponseText,
    buildCodexToolLoopPrompt,
    startAgentSession,
    extractAgentSessionFunctionCalls,
    extractAgentSessionText,
    continueAgentSessionWithToolOutputs,
    continueAgentSessionWithUserMessage
  };
}

module.exports = {
  createAgentSessionRuntime
};
