'use strict';

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createDeepSeekLlmProvider(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestOpenAiCompatibleChatCompletionsWithBackoff =
    typeof deps.requestOpenAiCompatibleChatCompletionsWithBackoff === 'function'
      ? deps.requestOpenAiCompatibleChatCompletionsWithBackoff
      : null;
  const extractChatCompletionText = typeof deps.extractChatCompletionText === 'function'
    ? deps.extractChatCompletionText
    : ((payload) => cleanText(payload?.choices?.[0]?.message?.content, 120000));
  const recordTrace = typeof deps.recordTrace === 'function' ? deps.recordTrace : (async () => {});
  const parseJsonObjectFromText = typeof deps.parseJsonObjectFromText === 'function'
    ? deps.parseJsonObjectFromText
    : (() => null);
  const isAbortError = typeof deps.isAbortError === 'function' ? deps.isAbortError : (() => false);
  const providerId = cleanText(deps.providerId, 80) || 'deepseek';

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
    const fileDataUrl = cleanText(input.fileDataUrl || input.pdfDataUrl, 400000);
    const imageDataUrl = cleanText(input.imageDataUrl || input.imageUrl, 400000);
    return [
      ...(fileDataUrl ? [{ kind: 'file', name: cleanText(input.fileName, 240) || 'attachment', dataUrl: fileDataUrl }] : []),
      ...(imageDataUrl ? [{ kind: 'image', name: 'image', dataUrl: imageDataUrl }] : [])
    ];
  }

  function redactReasoningContent(payload) {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }
    return {
      ...payload,
      choices: Array.isArray(payload.choices)
        ? payload.choices.map((choice) => {
          const message = choice?.message && typeof choice.message === 'object'
            ? {
              ...choice.message,
              ...(Object.prototype.hasOwnProperty.call(choice.message, 'reasoning_content')
                ? { reasoning_content: '[REDACTED]' }
                : {})
            }
            : choice?.message;
          return {
            ...choice,
            message
          };
        })
        : payload.choices
    };
  }

  function buildMessages(input = {}) {
    const systemPrompt = cleanText(input.systemPrompt, 12000);
    const userPrompt = [
      cleanText(input.userPrompt || input.prompt, 48000),
      input.expectJson === true ? 'Return JSON only.' : ''
    ].filter(Boolean).join('\n\n');
    return [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userPrompt }
    ];
  }

  async function requestText(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestOpenAiCompatibleChatCompletionsWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'DeepSeek text input is not configured.'
      };
    }

    const attachments = normalizeAttachments(input);
    if (attachments.length) {
      return {
        ok: false,
        error: 'DeepSeek provider currently supports text requests only; file and image inputs are not available.'
      };
    }

    try {
      const body = {
        model: cleanText(input.model, 120),
        messages: buildMessages(input)
      };
      if (Number.isFinite(Number(input.maxOutputTokens))) {
        body.max_tokens = Number(input.maxOutputTokens);
      }
      if (input.expectJson === true) {
        body.response_format = { type: 'json_object' };
      }
      const response = await requestOpenAiCompatibleChatCompletionsWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        fallbackEndpoint: 'https://api.deepseek.com',
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via DeepSeek Chat Completions.`,
        requestPayload: body,
        responsePayload: redactReasoningContent(response)
      });
      const text = extractChatCompletionText(response);
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
    return {
      ok: false,
      error: cleanText(input.defaultError, 600)
        || 'DeepSeek provider image input is not configured.'
    };
  }

  async function requestFileInput(input = {}) {
    return {
      ok: false,
      error: cleanText(input.defaultError, 600)
        || 'DeepSeek provider file input is not configured.'
    };
  }

  async function requestWebSearch(input = {}) {
    return {
      ok: false,
      error: cleanText(input.defaultError, 600)
        || 'DeepSeek provider web search is not configured.'
    };
  }

  return {
    requestText,
    requestImageInput,
    requestFileInput,
    requestWebSearch
  };
}

module.exports = {
  createDeepSeekLlmProvider
};
