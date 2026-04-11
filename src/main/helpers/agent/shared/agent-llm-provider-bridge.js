'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function defaultSafeParseJson(text, fallback = null) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Fallback below.
  }
  return fallback;
}

function defaultToInputText(role, text) {
  return {
    role,
    content: [{ type: 'input_text', text: String(text || '') }]
  };
}

function defaultParsePdfDataUrl(pdfDataUrl) {
  const match = String(pdfDataUrl || '').trim().match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

function normalizeWebUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function extractSourceDomain(url) {
  const normalized = normalizeWebUrl(url);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

function defaultExtractResponseText(payload, asArray = defaultAsArray) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  asArray(payload?.output).forEach((item) => {
    if (item?.type === 'message') {
      asArray(item.content).forEach((content) => {
        if (content?.type === 'output_text' && content.text) {
          chunks.push(content.text);
        }
      });
      return;
    }
    if (item?.type === 'output_text' && item.text) {
      chunks.push(item.text);
    }
  });
  return chunks.join('\n').trim();
}

function defaultExtractClaudeResponseText(payload, asArray = defaultAsArray) {
  return asArray(payload?.content)
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function defaultExtractGeminiResponseText(payload, asArray = defaultAsArray) {
  const candidate = Array.isArray(payload?.candidates) && payload.candidates.length > 0
    ? payload.candidates[0]
    : null;
  if (!candidate?.content?.parts) {
    return '';
  }
  return asArray(candidate.content.parts)
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function createAgentLlmProviderBridge(deps = {}) {
  const LLM_PROVIDERS = deps.LLM_PROVIDERS && typeof deps.LLM_PROVIDERS === 'object'
    ? deps.LLM_PROVIDERS
    : {};
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const safeParseJson = typeof deps.safeParseJson === 'function' ? deps.safeParseJson : defaultSafeParseJson;
  const toInputText = typeof deps.toInputText === 'function' ? deps.toInputText : defaultToInputText;
  const parsePdfDataUrl = typeof deps.parsePdfDataUrl === 'function' ? deps.parsePdfDataUrl : defaultParsePdfDataUrl;
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const requestClaudeMessagesWithBackoff = deps.requestClaudeMessagesWithBackoff;
  const requestGeminiGenerateContentWithBackoff = deps.requestGeminiGenerateContentWithBackoff;
  const requestOpenAiResponsesWithBackoff = deps.requestOpenAiResponsesWithBackoff;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : ((payload) => defaultExtractClaudeResponseText(payload, asArray));
  const extractGeminiResponseText = typeof deps.extractGeminiResponseText === 'function'
    ? deps.extractGeminiResponseText
    : ((payload) => defaultExtractGeminiResponseText(payload, asArray));
  const extractResponseText = typeof deps.extractResponseText === 'function'
    ? deps.extractResponseText
    : ((payload) => defaultExtractResponseText(payload, asArray));
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const isAbortError = typeof deps.isAbortError === 'function'
    ? deps.isAbortError
    : (() => false);
  const buildCodexToolLoopPrompt = typeof deps.buildCodexToolLoopPrompt === 'function'
    ? deps.buildCodexToolLoopPrompt
    : (({ systemPrompt = '', transcript = [] } = {}) => [
      cleanText(systemPrompt, 12000),
      asArray(transcript).map((entry, index) => {
        const role = cleanText(entry?.role, 30) || 'system';
        const text = cleanText(entry?.text, 16000);
        return text ? `${index + 1}. ${role}: ${text}` : '';
      }).filter(Boolean).join('\n')
    ].filter(Boolean).join('\n\n'));
  const agentSessionMaxOutputTokens = Number.isFinite(Number(deps.agentSessionMaxOutputTokens))
    ? Number(deps.agentSessionMaxOutputTokens)
    : 2200;

  function parseJsonObjectFromText(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw !== 'string') {
      return null;
    }
    const parsed = safeParseJson(raw, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  }

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
    if (part.functionCall && typeof part.functionCall === 'object') {
      return part.functionCall;
    }
    if (part.function_call && typeof part.function_call === 'object') {
      return part.function_call;
    }
    return null;
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

  function buildParsedToolLoopTurn(provider, raw, round = 0) {
    if (provider === LLM_PROVIDERS.CODEX) {
      return parseCodexSessionTurn(raw);
    }
    if (provider === LLM_PROVIDERS.CLAUDE) {
      return {
        assistant_text: cleanText(extractClaudeResponseText(raw), 12000),
        tool_calls: extractClaudeFunctionCalls(raw)
      };
    }
    if (provider === LLM_PROVIDERS.GEMINI) {
      return {
        assistant_text: cleanText(extractGeminiResponseText(raw), 12000),
        tool_calls: extractGeminiFunctionCalls(raw, round)
      };
    }
    return {
      assistant_text: cleanText(extractResponseText(raw), 12000),
      tool_calls: extractFunctionCalls(raw)
    };
  }

  function normalizeWebSearchPayload(payload = {}, maxResults = 8) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const results = asArray(source.results || source.items || source.search_results)
      .map((item) => {
        const result = item && typeof item === 'object' ? item : {};
        const url = normalizeWebUrl(result.url || result.link);
        return {
          title: cleanText(result.title || result.name, 320),
          url,
          summary: cleanText(result.summary || result.snippet || result.description, 1200),
          source_domain: cleanText(result.source_domain, 120).toLowerCase() || extractSourceDomain(url)
        };
      })
      .filter((item) => item.url)
      .slice(0, Math.max(1, Number(maxResults) || 8));
    return {
      results,
      reasoning: cleanText(source.reasoning || source.summary, 600)
    };
  }

  function buildWebSearchPrompt({
    query = '',
    maxResults = 8,
    allowedDomains = [],
    userLocation = null,
    codexMode = false
  } = {}) {
    return [
      codexMode
        ? 'If internet access is available in this Codex environment, search the web for the requested query. If internet access is unavailable, return an empty results array and explain that in reasoning.'
        : 'Use web search to find relevant results for the requested query.',
      `Search query: ${cleanText(query, 800) || '-'}`,
      `Max results: ${Math.max(1, Number(maxResults) || 8)}`,
      `Allowed domains: ${asArray(allowedDomains).map((item) => cleanText(item, 160)).filter(Boolean).join(', ') || '-'}`,
      `User location: ${userLocation && typeof userLocation === 'object'
        ? JSON.stringify(userLocation)
        : '-'}`,
      'Return JSON only with this shape:',
      '{"results":[{"title":"...","url":"https://...","summary":"...","source_domain":"example.com"}],"reasoning":"brief note"}'
    ].join('\n\n');
  }

  async function recordTrace(traceContext, {
    stage,
    provider,
    model,
    summary,
    requestPayload,
    responsePayload
  }) {
    await recordAgentLlmTrace(traceContext, {
      stage,
      provider,
      model,
      summary,
      request_payload: requestPayload,
      response_payload: responsePayload
    });
  }

  async function requestAssistantText(options = {}) {
    const {
      provider,
      endpoint,
      apiKey,
      model,
      stage,
      systemPrompt,
      userPrompt,
      traceContext = null,
      maxOutputTokens = null,
      openAiAsDefaultProvider = false,
      defaultError = 'Assistant text provider is not configured.'
    } = options;
    const system = cleanText(systemPrompt, 12000);
    const user = cleanText(userPrompt, 48000);
    const normalizedStage = cleanText(stage, 120) || 'agent_stage';

    try {
      if (provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
        const prompt = [system, user].filter(Boolean).join('\n\n');
        const raw = await requestCodexCliText({
          prompt,
          model,
          cwd: getCodexCliWorkingDirectory()
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Codex CLI.`,
          requestPayload: { model, prompt },
          responsePayload: raw
        });
        const text = String(raw || '').trim();
        if (!text) {
          return { ok: false, error: `${normalizedStage} response was empty.`, raw };
        }
        return { ok: true, text, raw };
      }

      if (provider === LLM_PROVIDERS.CLAUDE && typeof requestClaudeMessagesWithBackoff === 'function') {
        const body = {
          model,
          ...(system ? { system } : {}),
          max_tokens: Number.isFinite(Number(maxOutputTokens)) ? Number(maxOutputTokens) : 1600,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: user }]
            }
          ]
        };
        const response = await requestClaudeMessagesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Claude.`,
          requestPayload: body,
          responsePayload: response
        });
        const text = extractClaudeResponseText(response);
        if (!text) {
          return { ok: false, error: `${normalizedStage} response was empty.`, raw: response };
        }
        return { ok: true, text, raw: response };
      }

      if (provider === LLM_PROVIDERS.GEMINI && typeof requestGeminiGenerateContentWithBackoff === 'function') {
        const body = {
          ...(system
            ? {
              systemInstruction: {
                parts: [{ text: system }]
              }
            }
            : {}),
          contents: [
            {
              role: 'user',
              parts: [{ text: user }]
            }
          ],
          generationConfig: {
            ...(Number.isFinite(Number(maxOutputTokens)) ? { maxOutputTokens: Number(maxOutputTokens) } : {})
          }
        };
        const response = await requestGeminiGenerateContentWithBackoff({
          endpoint,
          apiKey,
          model,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Gemini.`,
          requestPayload: body,
          responsePayload: response
        });
        const text = extractGeminiResponseText(response);
        if (!text) {
          return { ok: false, error: `${normalizedStage} response was empty.`, raw: response };
        }
        return { ok: true, text, raw: response };
      }

      if ((provider === LLM_PROVIDERS.OPENAI || openAiAsDefaultProvider === true)
        && typeof requestOpenAiResponsesWithBackoff === 'function') {
        const resolvedProvider = provider === LLM_PROVIDERS.OPENAI ? provider : LLM_PROVIDERS.OPENAI;
        const input = [];
        if (system) {
          input.push(toInputText('system', system));
        }
        input.push(toInputText('user', user));
        const body = {
          model,
          input
        };
        if (Number.isFinite(Number(maxOutputTokens))) {
          body.max_output_tokens = Number(maxOutputTokens);
        }
        const response = await requestOpenAiResponsesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider: resolvedProvider,
          model,
          summary: `${normalizedStage} completed via OpenAI Responses.`,
          requestPayload: body,
          responsePayload: response
        });
        const text = extractResponseText(response);
        if (!text) {
          return { ok: false, error: `${normalizedStage} response was empty.`, raw: response };
        }
        return { ok: true, text, raw: response };
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }

    return {
      ok: false,
      error: defaultError
    };
  }

  async function requestStructuredJsonPayload(options = {}) {
    const {
      provider,
      endpoint,
      apiKey,
      model,
      stage,
      systemPrompt,
      userPrompt,
      schema,
      traceContext = null,
      maxOutputTokens = null,
      openAiStrict = null,
      openAiAsDefaultProvider = false,
      pdfDataUrl = '',
      fileName = '',
      defaultError = 'Structured JSON provider is not configured.'
    } = options;
    const system = cleanText(systemPrompt, 12000);
    const user = cleanText(userPrompt, 48000);
    const normalizedStage = cleanText(stage, 120) || 'agent_stage';
    const normalizedPdfDataUrl = String(pdfDataUrl || '').trim();
    const normalizedFileName = cleanText(fileName, 240) || 'paper.pdf';
    const pdfBase64 = normalizedPdfDataUrl ? parsePdfDataUrl(normalizedPdfDataUrl) : '';
    const pdfTrace = normalizedPdfDataUrl
      ? {
        attachment_type: 'pdf',
        file_name: normalizedFileName,
        approximate_base64_length: pdfBase64.length
      }
      : null;

    try {
      if (provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
        const prompt = [system, user, 'Return JSON only.'].filter(Boolean).join('\n\n');
        const raw = await requestCodexCliText({
          prompt,
          model,
          cwd: getCodexCliWorkingDirectory(),
          fileName: normalizedFileName,
          pdfDataUrl: normalizedPdfDataUrl
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Codex CLI.`,
          requestPayload: {
            model,
            prompt,
            ...(pdfTrace ? { attachment: pdfTrace } : {})
          },
          responsePayload: raw
        });
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        return { ok: true, payload: parsed, raw };
      }

      if (provider === LLM_PROVIDERS.CLAUDE && typeof requestClaudeMessagesWithBackoff === 'function') {
        if (normalizedPdfDataUrl && !pdfBase64) {
          return { ok: false, error: `${normalizedStage} PDF input was not a valid PDF data URL.` };
        }
        const content = normalizedPdfDataUrl
          ? [
            { type: 'text', text: `${user}\n\nReturn JSON only.` },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64
              }
            }
          ]
          : [{ type: 'text', text: `${user}\n\nReturn JSON only.` }];
        const body = {
          model,
          system: system || 'Return valid JSON only.',
          max_tokens: Number.isFinite(Number(maxOutputTokens)) ? Number(maxOutputTokens) : 1600,
          messages: [
            {
              role: 'user',
              content
            }
          ]
        };
        const response = await requestClaudeMessagesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Claude.`,
          requestPayload: pdfTrace
            ? {
              ...body,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: `${user}\n\nReturn JSON only.` },
                    {
                      type: 'document',
                      source: {
                        type: 'base64',
                        media_type: 'application/pdf',
                        data: '[pdf omitted]'
                      }
                    }
                  ]
                }
              ],
              attachment: pdfTrace
            }
            : body,
          responsePayload: response
        });
        const parsed = parseJsonObjectFromText(extractClaudeResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }

      if (provider === LLM_PROVIDERS.GEMINI && typeof requestGeminiGenerateContentWithBackoff === 'function') {
        if (normalizedPdfDataUrl && !pdfBase64) {
          return { ok: false, error: `${normalizedStage} PDF input was not a valid PDF data URL.` };
        }
        const parts = normalizedPdfDataUrl
          ? [
            { text: `${user}\n\nReturn JSON only.` },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64
              }
            }
          ]
          : [{ text: `${user}\n\nReturn JSON only.` }];
        const body = {
          systemInstruction: {
            parts: [{ text: system || 'Return valid JSON only.' }]
          },
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          generationConfig: {
            ...(Number.isFinite(Number(maxOutputTokens)) ? { maxOutputTokens: Number(maxOutputTokens) } : {})
          }
        };
        const response = await requestGeminiGenerateContentWithBackoff({
          endpoint,
          apiKey,
          model,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Gemini.`,
          requestPayload: pdfTrace
            ? {
              ...body,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: `${user}\n\nReturn JSON only.` },
                    {
                      inlineData: {
                        mimeType: 'application/pdf',
                        data: '[pdf omitted]'
                      }
                    }
                  ]
                }
              ],
              attachment: pdfTrace
            }
            : body,
          responsePayload: response
        });
        const parsed = parseJsonObjectFromText(extractGeminiResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }

      if ((provider === LLM_PROVIDERS.OPENAI || openAiAsDefaultProvider === true)
        && typeof requestOpenAiResponsesWithBackoff === 'function') {
        const resolvedProvider = provider === LLM_PROVIDERS.OPENAI ? provider : LLM_PROVIDERS.OPENAI;
        const format = {
          type: 'json_schema',
          name: normalizedStage.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'stage_result',
          schema
        };
        if (typeof openAiStrict === 'boolean') {
          format.strict = openAiStrict;
        }
        const body = {
          model,
          input: normalizedPdfDataUrl
            ? [
              toInputText('system', system || 'Return valid JSON only.'),
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: user },
                  {
                    type: 'input_file',
                    filename: normalizedFileName,
                    file_data: normalizedPdfDataUrl
                  }
                ]
              }
            ]
            : [
              toInputText('system', system || 'Return valid JSON only.'),
              toInputText('user', user)
            ],
          text: { format }
        };
        if (Number.isFinite(Number(maxOutputTokens))) {
          body.max_output_tokens = Number(maxOutputTokens);
        }
        const response = await requestOpenAiResponsesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider: resolvedProvider,
          model,
          summary: `${normalizedStage} completed via OpenAI Responses.`,
          requestPayload: pdfTrace
            ? {
              ...body,
              input: [
                toInputText('system', system || 'Return valid JSON only.'),
                {
                  role: 'user',
                  content: [
                    { type: 'input_text', text: user },
                    {
                      type: 'input_file',
                      filename: normalizedFileName,
                      file_data: '[pdf omitted]'
                    }
                  ]
                }
              ],
              attachment: pdfTrace
            }
            : body,
          responsePayload: response
        });
        const parsed = parseJsonObjectFromText(extractResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, raw: response };
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }

    return {
      ok: false,
      error: defaultError
    };
  }

  async function requestWebSearch(options = {}) {
    const {
      provider,
      endpoint,
      apiKey,
      model,
      stage,
      query,
      maxResults = 8,
      allowedDomains = [],
      userLocation = null,
      externalWebAccess = true,
      traceContext = null,
      defaultError = 'Web search provider is not configured.'
    } = options;
    const normalizedStage = cleanText(stage, 120) || 'web_search';
    const normalizedQuery = cleanText(query, 1200);
    const normalizedDomains = asArray(allowedDomains).map((item) => cleanText(item, 160)).filter(Boolean);
    const webSearchSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          maxItems: Math.max(1, Number(maxResults) || 8),
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              summary: { type: 'string' },
              source_domain: { type: 'string' }
            },
            required: ['title', 'url', 'summary', 'source_domain']
          }
        },
        reasoning: { type: 'string' }
      },
      required: ['results', 'reasoning']
    };

    if (!normalizedQuery) {
      return {
        ok: false,
        error: 'Web search query is required.'
      };
    }

    try {
      if (provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
        const prompt = buildWebSearchPrompt({
          query: normalizedQuery,
          maxResults,
          allowedDomains: normalizedDomains,
          userLocation,
          codexMode: true
        });
        const raw = await requestCodexCliText({
          prompt,
          model,
          enableWebSearch: true,
          cwd: getCodexCliWorkingDirectory()
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via Codex CLI.`,
          requestPayload: { model, prompt },
          responsePayload: raw
        });
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        const normalized = normalizeWebSearchPayload(parsed, maxResults);
        return { ok: true, results: normalized.results, reasoning: normalized.reasoning, raw };
      }

      if (provider === LLM_PROVIDERS.OPENAI && typeof requestOpenAiResponsesWithBackoff === 'function') {
        const format = {
          type: 'json_schema',
          name: normalizedStage.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'web_search_results',
          schema: webSearchSchema,
          strict: true
        };
        const tools = [{
          type: 'web_search',
          ...(normalizedDomains.length
            ? {
              filters: {
                allowed_domains: normalizedDomains
              }
            }
            : {}),
          ...(userLocation && typeof userLocation === 'object'
            ? { user_location: userLocation }
            : {}),
          ...(externalWebAccess === false ? { external_web_access: false } : {})
        }];
        const body = {
          model,
          tools,
          tool_choice: 'auto',
          include: ['web_search_call.action.sources'],
          input: [
            toInputText('system', 'Use web search to find relevant sources and return valid JSON only.'),
            toInputText('user', buildWebSearchPrompt({
              query: normalizedQuery,
              maxResults,
              allowedDomains: normalizedDomains,
              userLocation
            }))
          ],
          text: { format }
        };
        const response = await requestOpenAiResponsesWithBackoff({
          endpoint,
          apiKey,
          body
        });
        await recordTrace(traceContext, {
          stage: normalizedStage,
          provider,
          model,
          summary: `${normalizedStage} completed via OpenAI Responses web_search.`,
          requestPayload: body,
          responsePayload: response
        });
        const parsed = parseJsonObjectFromText(extractResponseText(response));
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        const normalized = normalizeWebSearchPayload(parsed, maxResults);
        return { ok: true, results: normalized.results, reasoning: normalized.reasoning, raw: response };
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }

    return {
      ok: false,
      error: defaultError
    };
  }

  async function startToolSession({
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
  } = {}) {
    const scopedToolDefinitions = asArray(toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;

    if (provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
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
      await recordTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started Codex CLI session with tool-loop prompt.',
        requestPayload: { model, prompt },
        responsePayload: response
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
        parsed: buildParsedToolLoopTurn(provider, response, 0),
        round: 0
      };
    }

    if (provider === LLM_PROVIDERS.CLAUDE && typeof requestClaudeMessagesWithBackoff === 'function') {
      const messages = [
        ...asArray(conversation).map((item) => toClaudeMessage(item.role, item.text)),
        ...(hasLatestUserInConversation ? [] : [toClaudeMessage('user', message)])
      ];
      const body = {
        model,
        system: systemPrompt,
        messages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: agentSessionMaxOutputTokens
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint,
        apiKey,
        body
      });
      await recordTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started assistant session with tool-enabled prompt.',
        requestPayload: body,
        responsePayload: response
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
        parsed: buildParsedToolLoopTurn(provider, response, 0),
        round: 0
      };
    }

    if (provider === LLM_PROVIDERS.GEMINI && typeof requestGeminiGenerateContentWithBackoff === 'function') {
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
          maxOutputTokens: agentSessionMaxOutputTokens
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint,
        apiKey,
        model,
        body
      });
      await recordTrace(traceContext, {
        stage: 'agent_round_0',
        provider,
        model,
        summary: 'Started assistant session with tool-enabled prompt.',
        requestPayload: body,
        responsePayload: response
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
        parsed: buildParsedToolLoopTurn(provider, response, 0),
        round: 0
      };
    }

    const resolvedProvider = provider === LLM_PROVIDERS.OPENAI ? provider : LLM_PROVIDERS.OPENAI;
    if (typeof requestOpenAiResponsesWithBackoff !== 'function') {
      return null;
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
      max_output_tokens: agentSessionMaxOutputTokens
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint,
      apiKey,
      body
    });
    await recordTrace(traceContext, {
      stage: 'agent_round_0',
      provider: resolvedProvider,
      model,
      summary: 'Started assistant session with tool-enabled prompt.',
      requestPayload: body,
      responsePayload: response
    });
    return {
      provider: resolvedProvider,
      endpoint,
      apiKey,
      model,
      systemPrompt,
      toolDefinitions: scopedToolDefinitions,
      raw: response,
      parsed: buildParsedToolLoopTurn(resolvedProvider, response, 0),
      round: 0
    };
  }

  async function continueToolSessionWithToolOutputs(session, toolOutputs, traceContext = null) {
    if (!session) {
      return session;
    }
    const scopedToolDefinitions = asArray(session.toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;

    if (session.provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
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
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued Codex session with tool outputs.',
        requestPayload: {
          model: session.model,
          prompt
        },
        responsePayload: response
      });
      return {
        ...session,
        transcript,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (session.provider === LLM_PROVIDERS.CLAUDE && typeof requestClaudeMessagesWithBackoff === 'function') {
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
        ...asArray(session.messages),
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResultBlocks }
      ];

      const body = {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: agentSessionMaxOutputTokens
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        body
      });
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with tool outputs.',
        requestPayload: body,
        responsePayload: response
      });

      return {
        ...session,
        messages: nextMessages,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (session.provider === LLM_PROVIDERS.GEMINI && typeof requestGeminiGenerateContentWithBackoff === 'function') {
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

      const nextContents = [...asArray(session.contents)];
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
          maxOutputTokens: agentSessionMaxOutputTokens
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        model: session.model,
        body
      });
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with tool outputs.',
        requestPayload: body,
        responsePayload: response
      });

      return {
        ...session,
        contents: nextContents,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (typeof requestOpenAiResponsesWithBackoff !== 'function') {
      return session;
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
      max_output_tokens: agentSessionMaxOutputTokens
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body
    });
    const nextRound = Number(session.round || 0) + 1;
    await recordTrace(traceContext, {
      stage: `agent_round_${nextRound}`,
      provider: session.provider,
      model: session.model,
      summary: 'Continued session with tool outputs.',
      requestPayload: body,
      responsePayload: response
    });

    return {
      ...session,
      raw: response,
      parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
      round: nextRound
    };
  }

  async function continueToolSessionWithUserMessage(session, message, traceContext = null) {
    if (!session) {
      return session;
    }
    const nextMessage = cleanText(message, 8000);
    if (!nextMessage) {
      return session;
    }
    const scopedToolDefinitions = asArray(session.toolDefinitions);
    const hasTools = scopedToolDefinitions.length > 0;

    if (session.provider === LLM_PROVIDERS.CODEX && typeof requestCodexCliText === 'function') {
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
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued Codex session with evaluator/user feedback.',
        requestPayload: {
          model: session.model,
          prompt
        },
        responsePayload: response
      });
      return {
        ...session,
        transcript,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (session.provider === LLM_PROVIDERS.CLAUDE && typeof requestClaudeMessagesWithBackoff === 'function') {
      const assistantContent = normalizeClaudeAssistantContent(session.raw);
      const nextMessages = [
        ...asArray(session.messages),
        { role: 'assistant', content: assistantContent },
        toClaudeMessage('user', nextMessage)
      ];
      const body = {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        ...(hasTools ? { tools: toClaudeToolDefinitions(scopedToolDefinitions) } : {}),
        max_tokens: agentSessionMaxOutputTokens
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        body
      });
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with evaluator/user feedback.',
        requestPayload: body,
        responsePayload: response
      });
      return {
        ...session,
        messages: nextMessages,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (session.provider === LLM_PROVIDERS.GEMINI && typeof requestGeminiGenerateContentWithBackoff === 'function') {
      const candidate = extractGeminiPrimaryCandidate(session.raw);
      const modelContent = candidate?.content && typeof candidate.content === 'object'
        ? candidate.content
        : null;
      const nextContents = [...asArray(session.contents)];
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
          maxOutputTokens: agentSessionMaxOutputTokens
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: session.endpoint,
        apiKey: session.apiKey,
        model: session.model,
        body
      });
      const nextRound = Number(session.round || 0) + 1;
      await recordTrace(traceContext, {
        stage: `agent_round_${nextRound}`,
        provider: session.provider,
        model: session.model,
        summary: 'Continued session with evaluator/user feedback.',
        requestPayload: body,
        responsePayload: response
      });
      return {
        ...session,
        contents: nextContents,
        raw: response,
        parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
        round: nextRound
      };
    }

    if (typeof requestOpenAiResponsesWithBackoff !== 'function') {
      return session;
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
      max_output_tokens: agentSessionMaxOutputTokens
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body
    });
    const nextRound = Number(session.round || 0) + 1;
    await recordTrace(traceContext, {
      stage: `agent_round_${nextRound}`,
      provider: session.provider,
      model: session.model,
      summary: 'Continued session with evaluator/user feedback.',
      requestPayload: body,
      responsePayload: response
    });
    return {
      ...session,
      raw: response,
      parsed: buildParsedToolLoopTurn(session.provider, response, nextRound),
      round: nextRound
    };
  }

  function extractToolSessionFunctionCalls(session) {
    if (!session) {
      return [];
    }
    if (Array.isArray(session?.parsed?.tool_calls)) {
      return session.parsed.tool_calls;
    }
    return buildParsedToolLoopTurn(session.provider, session.raw, session.round || 0).tool_calls;
  }

  function extractToolSessionText(session) {
    if (!session) {
      return '';
    }
    if (typeof session?.parsed?.assistant_text === 'string' && session.parsed.assistant_text.trim()) {
      return cleanText(session.parsed.assistant_text, 12000);
    }
    return cleanText(buildParsedToolLoopTurn(session.provider, session.raw, session.round || 0).assistant_text, 12000);
  }

  return {
    parseJsonObjectFromText,
    extractFunctionCalls,
    requestAssistantText,
    requestStructuredJsonPayload,
    requestWebSearch,
    startToolSession,
    continueToolSessionWithToolOutputs,
    continueToolSessionWithUserMessage,
    extractToolSessionFunctionCalls,
    extractToolSessionText
  };
}

module.exports = {
  createAgentLlmProviderBridge
};
