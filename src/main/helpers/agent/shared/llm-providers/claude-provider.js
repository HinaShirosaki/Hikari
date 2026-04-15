'use strict';

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function parseBase64DataUrl(dataUrl = '') {
  const match = String(dataUrl || '').trim().match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }
  return {
    mediaType: String(match[1]).trim().toLowerCase(),
    data: String(match[2]).trim()
  };
}

function createClaudeLlmProvider(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestClaudeMessagesWithBackoff = typeof deps.requestClaudeMessagesWithBackoff === 'function'
    ? deps.requestClaudeMessagesWithBackoff
    : null;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : ((payload) => cleanText(payload?.content?.[0]?.text, 120000));
  const recordTrace = typeof deps.recordTrace === 'function' ? deps.recordTrace : (async () => {});
  const parseJsonObjectFromText = typeof deps.parseJsonObjectFromText === 'function'
    ? deps.parseJsonObjectFromText
    : (() => null);
  const isAbortError = typeof deps.isAbortError === 'function' ? deps.isAbortError : (() => false);
  const providerId = cleanText(deps.providerId, 80) || 'claude';

  async function requestText(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestClaudeMessagesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Claude text input is not configured.'
      };
    }

    try {
      const body = {
        model: cleanText(input.model, 120),
        ...(cleanText(input.systemPrompt, 12000)
          ? { system: cleanText(input.systemPrompt, 12000) }
          : {}),
        max_tokens: Number.isFinite(Number(input.maxOutputTokens)) ? Number(input.maxOutputTokens) : 1600,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: cleanText(input.userPrompt, 48000)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              }
            ]
          }
        ]
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Claude.`,
        requestPayload: body,
        responsePayload: response
      });
      const text = extractClaudeResponseText(response);
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
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestClaudeMessagesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Claude image input is not configured.'
      };
    }
    const imageSource = parseBase64DataUrl(input.imageDataUrl);
    if (!imageSource || !/^image\//i.test(imageSource.mediaType)) {
      return {
        ok: false,
        error: `${normalizedStage} image input must be a base64 data URL.`
      };
    }

    try {
      const body = {
        model: cleanText(input.model, 120),
        ...(cleanText(input.systemPrompt, 12000)
          ? { system: cleanText(input.systemPrompt, 12000) }
          : {}),
        max_tokens: Number.isFinite(Number(input.maxOutputTokens)) ? Number(input.maxOutputTokens) : 1600,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: cleanText(input.userPrompt, 48000)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageSource.mediaType,
                  data: imageSource.data
                }
              }
            ]
          }
        ]
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Claude image input.`,
        requestPayload: {
          ...body,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: cleanText(input.userPrompt, 48000)
                    + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: imageSource.mediaType,
                    data: '[image omitted]'
                  }
                }
              ]
            }
          ]
        },
        responsePayload: response
      });
      const text = extractClaudeResponseText(response);
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

  async function requestFileInput(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestClaudeMessagesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Claude file input is not configured.'
      };
    }
    const documentSource = parseBase64DataUrl(input.fileDataUrl || input.pdfDataUrl);
    if (!documentSource || documentSource.mediaType !== 'application/pdf') {
      return {
        ok: false,
        error: `${normalizedStage} PDF input was not a valid PDF data URL.`
      };
    }

    try {
      const textPrompt = cleanText(input.userPrompt, 48000)
        + (input.expectJson === true ? '\n\nReturn JSON only.' : '');
      const body = {
        model: cleanText(input.model, 120),
        system: cleanText(input.systemPrompt, 12000) || 'Return valid JSON only.',
        max_tokens: Number.isFinite(Number(input.maxOutputTokens)) ? Number(input.maxOutputTokens) : 1600,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: textPrompt },
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: documentSource.data
                }
              }
            ]
          }
        ]
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Claude file input.`,
        requestPayload: {
          ...body,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: textPrompt },
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
          ]
        },
        responsePayload: response
      });
      const text = extractClaudeResponseText(response);
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

  async function requestWebSearch(input = {}) {
    return {
      ok: false,
      error: cleanText(input.defaultError, 600) || 'Claude provider web search is not configured.'
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
  createClaudeLlmProvider
};
