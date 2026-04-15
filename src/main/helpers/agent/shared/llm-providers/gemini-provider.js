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
    mediaType: String(match[1]).trim(),
    data: String(match[2]).trim()
  };
}

function createGeminiLlmProvider(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestGeminiGenerateContentWithBackoff = typeof deps.requestGeminiGenerateContentWithBackoff === 'function'
    ? deps.requestGeminiGenerateContentWithBackoff
    : null;
  const extractGeminiResponseText = typeof deps.extractGeminiResponseText === 'function'
    ? deps.extractGeminiResponseText
    : ((payload) => cleanText(payload?.candidates?.[0]?.content?.parts?.[0]?.text, 120000));
  const recordTrace = typeof deps.recordTrace === 'function' ? deps.recordTrace : (async () => {});
  const parseJsonObjectFromText = typeof deps.parseJsonObjectFromText === 'function'
    ? deps.parseJsonObjectFromText
    : (() => null);
  const isAbortError = typeof deps.isAbortError === 'function' ? deps.isAbortError : (() => false);
  const providerId = cleanText(deps.providerId, 80) || 'gemini';

  function buildGenerationConfig(maxOutputTokens) {
    return {
      ...(Number.isFinite(Number(maxOutputTokens)) ? { maxOutputTokens: Number(maxOutputTokens) } : {})
    };
  }

  async function requestText(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestGeminiGenerateContentWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Gemini text input is not configured.'
      };
    }

    try {
      const body = {
        ...(cleanText(input.systemPrompt, 12000)
          ? {
            systemInstruction: {
              parts: [{ text: cleanText(input.systemPrompt, 12000) }]
            }
          }
          : {}),
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText(input.userPrompt, 48000)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              }
            ]
          }
        ],
        generationConfig: buildGenerationConfig(input.maxOutputTokens)
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        model: cleanText(input.model, 120),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Gemini.`,
        requestPayload: body,
        responsePayload: response
      });
      const text = extractGeminiResponseText(response);
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
    if (!requestGeminiGenerateContentWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Gemini image input is not configured.'
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
        systemInstruction: {
          parts: [{ text: cleanText(input.systemPrompt, 12000) || 'Answer the user request.' }]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText(input.userPrompt, 48000)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              },
              {
                inlineData: {
                  mimeType: imageSource.mediaType,
                  data: imageSource.data
                }
              }
            ]
          }
        ],
        generationConfig: buildGenerationConfig(input.maxOutputTokens)
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        model: cleanText(input.model, 120),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Gemini image input.`,
        requestPayload: {
          ...body,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText(input.userPrompt, 48000)
                    + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
                },
                {
                  inlineData: {
                    mimeType: imageSource.mediaType,
                    data: '[image omitted]'
                  }
                }
              ]
            }
          ]
        },
        responsePayload: response
      });
      const text = extractGeminiResponseText(response);
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
    if (!requestGeminiGenerateContentWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'Gemini file input is not configured.'
      };
    }
    const fileSource = parseBase64DataUrl(input.fileDataUrl || input.pdfDataUrl);
    if (!fileSource || fileSource.mediaType.toLowerCase() !== 'application/pdf') {
      return {
        ok: false,
        error: `${normalizedStage} PDF input was not a valid PDF data URL.`
      };
    }

    try {
      const body = {
        systemInstruction: {
          parts: [{ text: cleanText(input.systemPrompt, 12000) || 'Return valid JSON only.' }]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText(input.userPrompt, 48000)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              },
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: fileSource.data
                }
              }
            ]
          }
        ],
        generationConfig: buildGenerationConfig(input.maxOutputTokens)
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        model: cleanText(input.model, 120),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Gemini file input.`,
        requestPayload: {
          ...body,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText(input.userPrompt, 48000)
                    + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
                },
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: '[pdf omitted]'
                  }
                }
              ]
            }
          ]
        },
        responsePayload: response
      });
      const text = extractGeminiResponseText(response);
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
      error: cleanText(input.defaultError, 600) || 'Gemini provider web search is not configured.'
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
  createGeminiLlmProvider
};
