'use strict';

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function defaultToInputText(role, text) {
  return {
    role,
    content: [{ type: 'input_text', text: String(text || '') }]
  };
}

function createOpenAiLlmProvider(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const toInputText = typeof deps.toInputText === 'function' ? deps.toInputText : defaultToInputText;
  const requestOpenAiResponsesWithBackoff = typeof deps.requestOpenAiResponsesWithBackoff === 'function'
    ? deps.requestOpenAiResponsesWithBackoff
    : null;
  const extractResponseText = typeof deps.extractResponseText === 'function'
    ? deps.extractResponseText
    : ((payload) => cleanText(payload?.output_text, 120000));
  const recordTrace = typeof deps.recordTrace === 'function' ? deps.recordTrace : (async () => {});
  const parseJsonObjectFromText = typeof deps.parseJsonObjectFromText === 'function'
    ? deps.parseJsonObjectFromText
    : (() => null);
  const buildWebSearchPrompt = typeof deps.buildWebSearchPrompt === 'function'
    ? deps.buildWebSearchPrompt
    : (() => '');
  const normalizeWebSearchPayload = typeof deps.normalizeWebSearchPayload === 'function'
    ? deps.normalizeWebSearchPayload
    : ((payload) => payload && typeof payload === 'object'
      ? { results: Array.isArray(payload.results) ? payload.results : [], reasoning: cleanText(payload.reasoning, 600) }
      : { results: [], reasoning: '' });
  const isAbortError = typeof deps.isAbortError === 'function' ? deps.isAbortError : (() => false);
  const providerId = cleanText(deps.providerId, 80) || 'openai';

  function buildJsonResponseFormat(stage, schema = {}) {
    return {
      type: 'json_schema',
      name: cleanText(stage, 120).replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'stage_result',
      schema
    };
  }

  function normalizeAttachments(input = {}) {
    const listed = Array.isArray(input.attachments) ? input.attachments : [];
    const attachments = listed.map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        kind: cleanText(source.kind, 40),
        name: cleanText(source.name, 240) || 'attachment',
        dataUrl: cleanText(source.dataUrl || source.data_url, 400000)
      };
    }).filter((attachment) => attachment.dataUrl);
    if (attachments.length) {
      return attachments;
    }
    const fileDataUrl = cleanText(input.fileDataUrl || input.pdfDataUrl, 240000);
    const imageDataUrl = cleanText(input.imageDataUrl || input.imageUrl, 240000);
    return [
      ...(fileDataUrl ? [{ kind: 'file', name: cleanText(input.fileName, 240) || 'attachment.pdf', dataUrl: fileDataUrl }] : []),
      ...(imageDataUrl ? [{ kind: 'image', name: 'image', dataUrl: imageDataUrl }] : [])
    ];
  }

  function buildUserContent(input = {}, attachments = [], redact = false) {
    return [
      { type: 'input_text', text: cleanText(input.userPrompt, 48000) },
      ...attachments.map((attachment) => (
        attachment.kind === 'image'
          ? { type: 'input_image', image_url: redact ? '[image omitted]' : attachment.dataUrl }
          : {
            type: 'input_file',
            filename: attachment.name || 'attachment',
            file_data: redact ? '[file omitted]' : attachment.dataUrl
          }
      ))
    ];
  }

  async function requestText(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestOpenAiResponsesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI text input is not configured.'
      };
    }

    try {
      const requestInput = [];
      const systemPrompt = cleanText(input.systemPrompt, 12000);
      const attachments = normalizeAttachments(input);
      if (systemPrompt) {
        requestInput.push(toInputText('system', systemPrompt));
      }
      requestInput.push({
        role: 'user',
        content: buildUserContent(input, attachments, false)
      });
      const body = {
        model: cleanText(input.model, 120),
        input: requestInput
      };
      if (input.enableWebSearch === true) {
        body.tools = [{
          type: 'web_search',
          ...(input.externalWebAccess === false ? { external_web_access: false } : {})
        }];
        body.tool_choice = 'auto';
        body.include = ['web_search_call.action.sources'];
      }
      if (Number.isFinite(Number(input.maxOutputTokens))) {
        body.max_output_tokens = Number(input.maxOutputTokens);
      }
      if (input.expectJson === true && input.schema && typeof input.schema === 'object') {
        body.text = {
          format: buildJsonResponseFormat(normalizedStage, input.schema)
        };
      }
      const response = await requestOpenAiResponsesWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: attachments.length
          ? `${normalizedStage} completed via OpenAI Responses multimodal input.`
          : `${normalizedStage} completed via OpenAI Responses.`,
        requestPayload: {
          ...body,
          input: [
            ...(systemPrompt ? [toInputText('system', systemPrompt)] : []),
            {
              role: 'user',
              content: buildUserContent(input, attachments, true)
            }
          ]
        },
        responsePayload: response
      });
      const text = extractResponseText(response);
      if (!text) {
        return { ok: false, error: `${normalizedStage} response was empty.`, raw: response };
      }
      if (input.expectJson === true) {
        const parsed = parseJsonObjectFromText(text);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
        }
        return { ok: true, payload: parsed, text, raw: response };
      }
      return { ok: true, text, raw: response };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }
  }

  async function requestImageInput(input = {}) {
    return requestText(input);
  }

  async function requestFileInput(input = {}) {
    return requestText(input);
  }

  async function requestWebSearch(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'web_search';
    const normalizedQuery = cleanText(input.query, 1200);
    if (!requestOpenAiResponsesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI web search is not configured.'
      };
    }
    if (!normalizedQuery) {
      return {
        ok: false,
        error: 'Web search query is required.'
      };
    }

    const maxResults = Math.max(1, Number(input.maxResults) || 8);
    const webSearchSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          maxItems: maxResults,
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

    try {
      const body = {
        model: cleanText(input.model, 120),
        tools: [{
          type: 'web_search',
          ...(Array.isArray(input.allowedDomains) && input.allowedDomains.length
            ? {
              filters: {
                allowed_domains: input.allowedDomains
              }
            }
            : {}),
          ...(input.userLocation && typeof input.userLocation === 'object'
            ? { user_location: input.userLocation }
            : {}),
          ...(input.externalWebAccess === false ? { external_web_access: false } : {})
        }],
        tool_choice: 'auto',
        include: ['web_search_call.action.sources'],
        input: [
          toInputText('system', 'Use web search to find relevant sources and return valid JSON only.'),
          toInputText('user', buildWebSearchPrompt({
            query: normalizedQuery,
            maxResults,
            allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains : [],
            userLocation: input.userLocation || null
          }))
        ],
        text: {
          format: {
            ...buildJsonResponseFormat(normalizedStage, webSearchSchema),
            strict: true
          }
        }
      };
      const response = await requestOpenAiResponsesWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via OpenAI Responses web_search.`,
        requestPayload: body,
        responsePayload: response
      });
      const parsed = parseJsonObjectFromText(extractResponseText(response));
      if (!parsed) {
        return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw: response };
      }
      const normalized = normalizeWebSearchPayload(parsed, maxResults);
      return {
        ok: true,
        results: normalized.results,
        reasoning: normalized.reasoning,
        raw: response
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || `${normalizedStage} request failed.`
      };
    }
  }

  return {
    requestText,
    requestImageInput,
    requestFileInput,
    requestWebSearch
  };
}

module.exports = {
  createOpenAiLlmProvider
};
