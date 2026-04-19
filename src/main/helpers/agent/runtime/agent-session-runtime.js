'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createAgentSessionRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    safeParseJson,
    requestText
  } = createAgentLlmRuntimeHelpers(deps);
  // requestText(...) records traces via recordAgentLlmTrace(...) inside the
  // shared LLM helper layer for each tool-loop turn.

  const arrayValues = typeof asArray === 'function' ? asArray : defaultAsArray;
  const cleanValue = typeof cleanText === 'function' ? cleanText : defaultCleanText;
  const safeParse = typeof safeParseJson === 'function' ? safeParseJson : (() => null);
  const requestTextTurn = typeof requestText === 'function'
    ? requestText
    : (async () => ({ ok: false, error: 'Text generation bridge is not configured.' }));

  function buildCodexToolLoopPrompt({
    systemPrompt,
    transcript = [],
    toolDefinitions = []
  }) {
    const toolRows = arrayValues(toolDefinitions).map((tool) => [
      `Tool: ${cleanValue(tool?.name, 120) || 'unknown_tool'}`,
      `Description: ${cleanValue(tool?.description, 500) || '-'}`,
      `Input schema JSON:\n${JSON.stringify(tool?.parameters || { type: 'object', additionalProperties: true }, null, 2)}`
    ].join('\n')).join('\n\n');
    const transcriptText = arrayValues(transcript).map((entry, index) => {
      const role = cleanValue(entry?.role, 30) || 'system';
      const text = cleanValue(entry?.text, 16000);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      cleanValue(systemPrompt, 12000),
      'You are participating in a stepwise tool loop.',
      'At each turn, either request one or more independent tool calls or answer directly if the evidence is already sufficient.',
      'Return JSON only in one of these forms:',
      '{"assistant_text":"progress update","tool_call":{"name":"tool_name","arguments":{}}}',
      '{"assistant_text":"progress update","tool_calls":[{"name":"tool_name","arguments":{}}]}',
      '{"assistant_text":"grounded final answer","tool_call":null,"tool_calls":[]}',
      'If you request multiple tool calls, keep them tightly scoped and independent so they can run in parallel as one round.',
      toolRows ? `Available tools:\n${toolRows}` : 'No tools are available.',
      transcriptText ? `Transcript:\n${transcriptText}` : ''
    ].filter(Boolean).join('\n\n');
  }

  function parseToolLoopTurn(raw) {
    const source = typeof raw === 'string'
      ? cleanValue(raw, 12000)
      : cleanValue(raw?.text || raw?.output_text || raw?.error, 12000);
    const parsed = safeParse(source, null);
    if (parsed && typeof parsed === 'object') {
      const rawToolCalls = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls
        : (parsed.tool_call && typeof parsed.tool_call === 'object' ? [parsed.tool_call] : []);
      const toolCalls = rawToolCalls
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry, index) => ({
          callId: cleanValue(entry.call_id || entry.callId || entry.id, 120) || `tool-call-${index + 1}`,
          name: cleanValue(entry.name || entry.tool_name, 120),
          argsText: JSON.stringify(entry.arguments && typeof entry.arguments === 'object'
            ? entry.arguments
            : {})
        }))
        .filter((entry) => entry.name);
      return {
        assistant_text: cleanValue(parsed.assistant_text || parsed.answer || parsed.text, 12000),
        tool_calls: toolCalls
      };
    }
    return {
      assistant_text: source,
      tool_calls: []
    };
  }

  async function requestToolLoopTurn({
    provider,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    transcript,
    toolDefinitions,
    traceContext,
    round,
    attachments = []
  }) {
    const prompt = buildCodexToolLoopPrompt({
      systemPrompt,
      transcript,
      toolDefinitions
    });
    const response = await requestTextTurn({
      provider,
      endpoint,
      apiKey,
      model,
      stage: `agent_tool_loop_round_${Number(round) || 0}`,
      systemPrompt: '',
      userPrompt: prompt,
      attachments,
      traceContext,
      maxOutputTokens: 2200,
      defaultError: 'Assistant text provider is not configured.'
    });
    return {
      raw: response,
      parsed: parseToolLoopTurn(response)
    };
  }

  async function startAgentSession({
    provider,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    conversation,
    message,
    hasLatestUserInConversation,
    toolDefinitions = [],
    traceContext = null,
    attachments = []
  } = {}) {
    const transcript = [
      ...arrayValues(conversation).map((item) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        text: cleanValue(item?.text, 4000)
      })),
      ...(hasLatestUserInConversation ? [] : [{
        role: 'user',
        text: cleanValue(message, 4000)
      }])
    ].filter((item) => item.text);
    const turn = await requestToolLoopTurn({
      provider,
      endpoint,
      apiKey,
      model,
      systemPrompt,
      transcript,
      toolDefinitions: arrayValues(toolDefinitions),
      attachments: arrayValues(attachments),
      traceContext,
      round: 0
    });
    return {
      provider: cleanValue(provider, 80),
      endpoint: cleanValue(endpoint, 2000),
      apiKey: cleanValue(apiKey, 400),
      model: cleanValue(model, 120),
      systemPrompt: cleanValue(systemPrompt, 12000),
      transcript,
      toolDefinitions: arrayValues(toolDefinitions),
      raw: turn.raw,
      parsed: turn.parsed,
      round: 0
    };
  }

  function extractAgentSessionFunctionCalls(session) {
    if (!session) {
      return [];
    }
    if (Array.isArray(session?.parsed?.tool_calls)) {
      return session.parsed.tool_calls;
    }
    return parseToolLoopTurn(session.raw).tool_calls;
  }

  function extractAgentSessionText(session) {
    if (!session) {
      return '';
    }
    if (typeof session?.parsed?.assistant_text === 'string' && session.parsed.assistant_text.trim()) {
      return cleanValue(session.parsed.assistant_text, 12000);
    }
    return cleanValue(parseToolLoopTurn(session.raw).assistant_text, 12000);
  }

  async function continueAgentSessionWithToolOutputs(session, toolOutputs, traceContext = null) {
    if (!session) {
      return session;
    }
    const transcript = [
      ...arrayValues(session.transcript),
      {
        role: 'assistant',
        text: cleanValue(session.parsed?.assistant_text, 12000)
          || cleanValue(session.raw?.text || session.raw?.error, 12000)
      },
      ...arrayValues(toolOutputs).map((output) => ({
        role: 'tool',
        text: JSON.stringify({
          call_id: cleanValue(output?.callId, 120),
          name: cleanValue(output?.name, 120),
          output: safeParse(cleanValue(output?.output, 16000), cleanValue(output?.output, 16000))
        })
      }))
    ].filter((item) => cleanValue(item?.text, 12000));
    const nextRound = Number(session.round || 0) + 1;
    const turn = await requestToolLoopTurn({
      provider: session.provider,
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      model: session.model,
      systemPrompt: session.systemPrompt,
      transcript,
      toolDefinitions: arrayValues(session.toolDefinitions),
      traceContext,
      round: nextRound
    });
    return {
      ...session,
      transcript,
      raw: turn.raw,
      parsed: turn.parsed,
      round: nextRound
    };
  }

  async function continueAgentSessionWithUserMessage(session, message, traceContext = null) {
    if (!session) {
      return session;
    }
    const nextMessage = cleanValue(message, 8000);
    if (!nextMessage) {
      return session;
    }
    const transcript = [
      ...arrayValues(session.transcript),
      {
        role: 'assistant',
        text: cleanValue(session.parsed?.assistant_text, 12000)
          || cleanValue(session.raw?.text || session.raw?.error, 12000)
      },
      {
        role: 'user',
        text: nextMessage
      }
    ].filter((item) => cleanValue(item?.text, 12000));
    const nextRound = Number(session.round || 0) + 1;
    const turn = await requestToolLoopTurn({
      provider: session.provider,
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      model: session.model,
      systemPrompt: session.systemPrompt,
      transcript,
      toolDefinitions: arrayValues(session.toolDefinitions),
      traceContext,
      round: nextRound
    });
    return {
      ...session,
      transcript,
      raw: turn.raw,
      parsed: turn.parsed,
      round: nextRound
    };
  }

  function extractFunctionCalls(payload) {
    return parseToolLoopTurn(payload).tool_calls;
  }

  return {
    buildCodexToolLoopPrompt,
    startAgentSession,
    extractFunctionCalls,
    extractAgentSessionFunctionCalls,
    extractAgentSessionText,
    continueAgentSessionWithToolOutputs,
    continueAgentSessionWithUserMessage
  };
}

module.exports = {
  createAgentSessionRuntime
};
