'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function createAgentSessionRuntime(deps = {}) {
  const {
    LLM_PROVIDERS,
    asArray,
    cleanText,
    safeParseJson,
    toInputText,
    recordAgentLlmTrace,
    extractResponseText,
    extractClaudeResponseText,
    extractGeminiResponseText
  } = createAgentLlmRuntimeHelpers(deps);
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const requestClaudeMessagesWithBackoff = deps.requestClaudeMessagesWithBackoff;
  const requestGeminiGenerateContentWithBackoff = deps.requestGeminiGenerateContentWithBackoff;
  const requestOpenAiResponsesWithBackoff = deps.requestOpenAiResponsesWithBackoff;

  function extractFunctionCalls(payload) {
    return asArray(payload?.output)
      .filter((item) => item?.type === 'function_call')
      .map((item) => ({
        callId: String(item.call_id || item.id || ''),
        name: String(item.name || '').trim(),
        argsText: String(item.arguments || '{}')
      }))
      .filter((item) => item.callId && item.name);
  }

  function toClaudeToolDefinitions(toolDefinitions) {
    return asArray(toolDefinitions).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }

  function toGeminiToolDefinitions(toolDefinitions) {
    return [
      {
        functionDeclarations: asArray(toolDefinitions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }
    ];
  }

  function toClaudeMessage(role, text) {
    return {
      role: role === 'assistant' ? 'assistant' : 'user',
      content: [
        {
          type: 'text',
          text: String(text || '')
        }
      ]
    };
  }

  function toGeminiContent(role, text) {
    return {
      role: role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: String(text || '')
        }
      ]
    };
  }

  function extractClaudeFunctionCalls(payload) {
    return asArray(payload?.content)
      .filter((item) => item?.type === 'tool_use')
      .map((item, index) => ({
        callId: cleanText(item?.id, 120) || `claude-call-${index + 1}`,
        name: cleanText(item?.name, 120),
        argsText: JSON.stringify(item?.input || {})
      }))
      .filter((item) => item.callId && item.name);
  }

  function extractGeminiPrimaryCandidate(payload) {
    if (!Array.isArray(payload?.candidates) || payload.candidates.length === 0) {
      return null;
    }
    return payload.candidates[0];
  }

  function extractGeminiPartFunctionCall(part) {
    if (!part || typeof part !== 'object') {
      return null;
    }
    return part.functionCall && typeof part.functionCall === 'object'
      ? part.functionCall
      : part.function_call && typeof part.function_call === 'object'
        ? part.function_call
        : null;
  }

  function extractGeminiFunctionCalls(payload, round = 0) {
    const candidate = extractGeminiPrimaryCandidate(payload);
    if (!candidate?.content?.parts) {
      return [];
    }
    const calls = [];
    asArray(candidate.content.parts).forEach((part, index) => {
      const fn = extractGeminiPartFunctionCall(part);
      if (!fn?.name) {
        return;
      }
      const args = fn.args && typeof fn.args === 'object' ? fn.args : {};
      calls.push({
        callId: cleanText(fn.id, 120) || `gemini-call-${round + 1}-${index + 1}`,
        name: cleanText(fn.name, 120),
        argsText: JSON.stringify(args)
      });
    });
    return calls.filter((item) => item.callId && item.name);
  }

  function normalizeClaudeAssistantContent(payload) {
    return asArray(payload?.content)
      .map((item) => {
        if (item?.type === 'text') {
          return {
            type: 'text',
            text: String(item.text || '')
          };
        }
        if (item?.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: cleanText(item.id, 120),
            name: cleanText(item.name, 120),
            input: item.input && typeof item.input === 'object' ? item.input : {}
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  function parseToolOutputObject(rawOutput) {
    const clean = String(rawOutput || '').trim();
    if (!clean) {
      return {};
    }
    const parsed = safeParseJson(clean, null);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return { text: clean };
  }

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
      '{"assistant_text":"short explanation","tool_call":{"name":"tool_name","arguments":{}}}',
      '{"assistant_text":"final answer","tool_call":null}',
      'Never return more than one tool call in a single turn.',
      toolRows ? `Available tools:\n${toolRows}` : 'No tools are available.',
      transcriptText ? `Transcript:\n${transcriptText}` : ''
    ].filter(Boolean).join('\n\n');
  }

  function parseCodexSessionTurn(rawText) {
    const parsed = safeParseJson(rawText, null);
    if (parsed && typeof parsed === 'object') {
      const toolCallSource = parsed.tool_call && typeof parsed.tool_call === 'object'
        ? parsed.tool_call
        : (Array.isArray(parsed.tool_calls) && parsed.tool_calls[0] && typeof parsed.tool_calls[0] === 'object'
          ? parsed.tool_calls[0]
          : null);
      const toolCalls = toolCallSource
        ? [{
          callId: cleanText(toolCallSource.call_id || toolCallSource.callId || toolCallSource.id, 120) || `codex-call-${Date.now()}`,
          name: cleanText(toolCallSource.name || toolCallSource.tool_name, 120),
          argsText: JSON.stringify(toolCallSource.arguments && typeof toolCallSource.arguments === 'object'
            ? toolCallSource.arguments
            : {})
        }]
        : [];
      return {
        assistant_text: cleanText(parsed.assistant_text || parsed.answer || parsed.text, 12000),
        tool_calls: toolCalls.filter((item) => item.name)
      };
    }
    return {
      assistant_text: cleanText(rawText, 12000),
      tool_calls: []
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
    traceContext = null
  }) {
    const scopedToolDefinitions = asArray(toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;
    if (provider === LLM_PROVIDERS.CODEX) {
      const transcript = [
        ...asArray(conversation).map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          text: cleanText(item?.text, 4000)
        })),
        ...(hasLatestUserInConversation ? [] : [{
          role: 'user',
          text: cleanText(message, 4000)
        }])
      ].filter((item) => item.text);
      const prompt = buildCodexToolLoopPrompt({
        systemPrompt,
        transcript,
        toolDefinitions: scopedToolDefinitions
      });
      const response = await requestCodexCliText({
        prompt,
        model,
        cwd: getCodexCliWorkingDirectory()
      });
      await recordAgentLlmTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started Codex CLI session with tool-loop prompt.',
        request_payload: {
          model,
          prompt
        },
        response_payload: response
      });
      return {
        provider,
        endpoint,
        apiKey,
        model,
        systemPrompt,
        toolDefinitions: scopedToolDefinitions,
        transcript,
        raw: response,
        parsed: parseCodexSessionTurn(response),
        round: 0
      };
    }

    if (provider === LLM_PROVIDERS.CLAUDE) {
      const messages = [
        ...asArray(conversation).map((item) => toClaudeMessage(item.role, item.text)),
        ...(hasLatestUserInConversation ? [] : [toClaudeMessage('user', message)])
      ];
      const body = {
        model,
        system: systemPrompt,
        messages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: 1400
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint,
        apiKey,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started assistant session with tool-enabled prompt.',
        request_payload: body,
        response_payload: response
      });
      return {
        provider,
        endpoint,
        apiKey,
        model,
        systemPrompt,
        messages,
        toolDefinitions: scopedToolDefinitions,
        raw: response,
        round: 0
      };
    }

    if (provider === LLM_PROVIDERS.GEMINI) {
      const contents = [
        ...asArray(conversation).map((item) => toGeminiContent(item.role, item.text)),
        ...(hasLatestUserInConversation ? [] : [toGeminiContent('user', message)])
      ];
      const body = {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        ...(hasTools ? { tools: toGeminiToolDefinitions(scopedToolDefinitions) } : {}),
        ...(hasTools ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        } : {}),
        generationConfig: {
          maxOutputTokens: 1400
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint,
        apiKey,
        model,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started assistant session with tool-enabled prompt.',
        request_payload: body,
        response_payload: response
      });
      return {
        provider,
        endpoint,
        apiKey,
        model,
        systemPrompt,
        contents,
        toolDefinitions: scopedToolDefinitions,
        raw: response,
        round: 0
      };
    }

    const body = {
      model,
      input: [
        toInputText('system', systemPrompt),
        ...asArray(conversation).map((item) => toInputText(item.role, item.text)),
        ...(hasLatestUserInConversation ? [] : [toInputText('user', message)])
      ],
      ...(hasTools ? {
        tools: scopedToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false
      } : {}),
      max_output_tokens: 1400
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint,
      apiKey,
      body
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'agent_round_0',
      provider: LLM_PROVIDERS.OPENAI,
      model,
      summary: 'Started assistant session with tool-enabled prompt.',
      request_payload: body,
      response_payload: response
    });
    return {
      provider: LLM_PROVIDERS.OPENAI,
      endpoint,
      apiKey,
      model,
      toolDefinitions: scopedToolDefinitions,
      raw: response,
      round: 0
    };
  }

  function extractAgentSessionFunctionCalls(session) {
    if (!session) {
      return [];
    }
    if (session.provider === LLM_PROVIDERS.CODEX) {
      return asArray(session.parsed?.tool_calls);
    }
    if (session.provider === LLM_PROVIDERS.CLAUDE) {
      return extractClaudeFunctionCalls(session.raw);
    }
    if (session.provider === LLM_PROVIDERS.GEMINI) {
      return extractGeminiFunctionCalls(session.raw, session.round || 0);
    }
    return extractFunctionCalls(session.raw);
  }

  function extractAgentSessionText(session) {
    if (!session) {
      return '';
    }
    if (session.provider === LLM_PROVIDERS.CODEX) {
      return cleanText(session.parsed?.assistant_text, 12000);
    }
    if (session.provider === LLM_PROVIDERS.CLAUDE) {
      return extractClaudeResponseText(session.raw);
    }
    if (session.provider === LLM_PROVIDERS.GEMINI) {
      return extractGeminiResponseText(session.raw);
    }
    return extractResponseText(session.raw);
  }

  async function continueAgentSessionWithToolOutputs(session, toolOutputs, traceContext = null) {
    if (!session) {
      return session;
    }

    const scopedToolDefinitions = asArray(session.toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;

    if (session.provider === LLM_PROVIDERS.CODEX) {
      const transcript = [
        ...asArray(session.transcript),
        {
          role: 'assistant',
          text: cleanText(session.parsed?.assistant_text, 12000)
            || cleanText(session.raw, 12000)
        },
        ...asArray(toolOutputs).map((output) => ({
          role: 'tool',
          text: JSON.stringify({
            call_id: cleanText(output?.callId, 120),
            name: cleanText(output?.name, 120),
            output: parseToolOutputObject(output?.output)
          })
        }))
      ].filter((item) => cleanText(item?.text, 12000));
      const prompt = buildCodexToolLoopPrompt({
        systemPrompt: session.systemPrompt,
        transcript,
        toolDefinitions: scopedToolDefinitions
      });
      const response = await requestCodexCliText({
        prompt,
        model: session.model,
        cwd: getCodexCliWorkingDirectory()
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued Codex session with tool outputs.',
        request_payload: {
          model: session.model,
          prompt
        },
        response_payload: response
      });
      return {
        ...session,
        transcript,
        raw: response,
        parsed: parseCodexSessionTurn(response),
        round: Number(session.round || 0) + 1
      };
    }

    if (session.provider === LLM_PROVIDERS.CLAUDE) {
      const byId = new Map(asArray(toolOutputs).map((item) => [item.callId, item]));
      const assistantContent = normalizeClaudeAssistantContent(session.raw);
      const toolResultBlocks = asArray(session.raw?.content)
        .filter((item) => item?.type === 'tool_use')
        .map((item, index) => {
          const callId = cleanText(item?.id, 120) || `claude-call-${index + 1}`;
          const matched = byId.get(callId) || asArray(toolOutputs).find((output) => output.name === item?.name);
          return {
            type: 'tool_result',
            tool_use_id: callId,
            content: matched?.output || '{}'
          };
        });

      const nextMessages = [
        ...session.messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResultBlocks }
      ];

      const body = {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: 1400
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with tool outputs.',
        request_payload: body,
        response_payload: response
      });

      return {
        ...session,
        messages: nextMessages,
        raw: response,
        round: Number(session.round || 0) + 1
      };
    }

    if (session.provider === LLM_PROVIDERS.GEMINI) {
      const callOutputs = new Map(asArray(toolOutputs).map((item) => [item.callId, item]));
      const candidate = extractGeminiPrimaryCandidate(session.raw);
      const modelContent = candidate?.content && typeof candidate.content === 'object'
        ? candidate.content
        : null;
      const toolCalls = extractGeminiFunctionCalls(session.raw, session.round || 0);
      const responseParts = toolCalls.map((call) => {
        const matched = callOutputs.get(call.callId) || asArray(toolOutputs).find((item) => item.name === call.name);
        return {
          functionResponse: {
            name: call.name,
            response: parseToolOutputObject(matched?.output)
          }
        };
      });

      const nextContents = [...session.contents];
      if (modelContent) {
        nextContents.push(modelContent);
      }
      if (responseParts.length) {
        nextContents.push({
          role: 'user',
          parts: responseParts
        });
      }

      const body = {
        systemInstruction: {
          parts: [{ text: session.systemPrompt }]
        },
        contents: nextContents,
        ...(hasTools ? { tools: toGeminiToolDefinitions(scopedToolDefinitions) } : {}),
        ...(hasTools ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        } : {}),
        generationConfig: {
          maxOutputTokens: 1400
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        model: session.model,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with tool outputs.',
        request_payload: body,
        response_payload: response
      });

      return {
        ...session,
        contents: nextContents,
        raw: response,
        round: Number(session.round || 0) + 1
      };
    }

    const body = {
      model: session.model,
      previous_response_id: session.raw?.id,
      input: asArray(toolOutputs).map((output) => ({
        type: 'function_call_output',
        call_id: output.callId,
        output: output.output
      })),
      ...(hasTools ? {
        tools: scopedToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false
      } : {}),
      max_output_tokens: 1400
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body
    });
    await recordAgentLlmTrace(traceContext, {
      stage: `agent_round_${Number(session.round || 0) + 1}`,
      provider: session.provider,
      model: session.model,
      summary: 'Continued session with tool outputs.',
      request_payload: body,
      response_payload: response
    });

    return {
      ...session,
      raw: response,
      round: Number(session.round || 0) + 1
    };
  }

  async function continueAgentSessionWithUserMessage(session, message, traceContext = null) {
    if (!session) {
      return session;
    }
    const nextMessage = cleanText(message, 8000);
    if (!nextMessage) {
      return session;
    }

    const scopedToolDefinitions = asArray(session.toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;

    if (session.provider === LLM_PROVIDERS.CODEX) {
      const transcript = [
        ...asArray(session.transcript),
        {
          role: 'assistant',
          text: cleanText(session.parsed?.assistant_text, 12000)
            || cleanText(session.raw, 12000)
        },
        {
          role: 'user',
          text: nextMessage
        }
      ].filter((item) => cleanText(item?.text, 12000));
      const prompt = buildCodexToolLoopPrompt({
        systemPrompt: session.systemPrompt,
        transcript,
        toolDefinitions: scopedToolDefinitions
      });
      const response = await requestCodexCliText({
        prompt,
        model: session.model,
        cwd: getCodexCliWorkingDirectory()
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued Codex session with evaluator/user feedback.',
        request_payload: {
          model: session.model,
          prompt
        },
        response_payload: response
      });
      return {
        ...session,
        transcript,
        raw: response,
        parsed: parseCodexSessionTurn(response),
        round: Number(session.round || 0) + 1
      };
    }

    if (session.provider === LLM_PROVIDERS.CLAUDE) {
      const assistantContent = normalizeClaudeAssistantContent(session.raw);
      const nextMessages = [
        ...session.messages,
        { role: 'assistant', content: assistantContent },
        toClaudeMessage('user', nextMessage)
      ];
      const body = {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: 1400
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with evaluator/user feedback.',
        request_payload: body,
        response_payload: response
      });
      return {
        ...session,
        messages: nextMessages,
        raw: response,
        round: Number(session.round || 0) + 1
      };
    }

    if (session.provider === LLM_PROVIDERS.GEMINI) {
      const candidate = extractGeminiPrimaryCandidate(session.raw);
      const modelContent = candidate?.content && typeof candidate.content === 'object'
        ? candidate.content
        : null;
      const nextContents = [...session.contents];
      if (modelContent) {
        nextContents.push(modelContent);
      }
      nextContents.push(toGeminiContent('user', nextMessage));
      const body = {
        systemInstruction: {
          parts: [{ text: session.systemPrompt }]
        },
        contents: nextContents,
        ...(hasTools ? { tools: toGeminiToolDefinitions(scopedToolDefinitions) } : {}),
        ...(hasTools ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        } : {}),
        generationConfig: {
          maxOutputTokens: 1400
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        model: session.model,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: `agent_round_${Number(session.round || 0) + 1}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with evaluator/user feedback.',
        request_payload: body,
        response_payload: response
      });
      return {
        ...session,
        contents: nextContents,
        raw: response,
        round: Number(session.round || 0) + 1
      };
    }

    const body = {
      model: session.model,
      previous_response_id: session.raw?.id,
      input: [toInputText('user', nextMessage)],
      ...(hasTools ? {
        tools: scopedToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false
      } : {}),
      max_output_tokens: 1400
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body
    });
    await recordAgentLlmTrace(traceContext, {
      stage: `agent_round_${Number(session.round || 0) + 1}`,
      provider: session.provider,
      model: session.model,
      summary: 'Continued session with evaluator/user feedback.',
      request_payload: body,
      response_payload: response
    });
    return {
      ...session,
      raw: response,
      round: Number(session.round || 0) + 1
    };
  }

  return {
    extractResponseText,
    extractFunctionCalls,
    extractClaudeResponseText,
    extractGeminiResponseText,
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
