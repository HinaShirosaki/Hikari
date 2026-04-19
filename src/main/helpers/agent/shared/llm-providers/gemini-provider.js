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

  function buildParts(input = {}, attachments = [], redact = false) {
    return [
      {
        text: cleanText(input.userPrompt, 48000)
          + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
      },
      ...attachments.map((attachment) => {
        const source = parseBase64DataUrl(attachment?.dataUrl);
        if (!source) {
          return {
            text: `Attached file: ${cleanText(attachment?.name, 240) || 'attachment'}`
          };
        }
        return {
          inlineData: {
            mimeType: source.mediaType,
            data: redact ? '[binary omitted]' : source.data
          }
        };
      })
    ];
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
      const attachments = normalizeAttachments(input);
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
            parts: buildParts(input, attachments, false)
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
        summary: attachments.length
          ? `${normalizedStage} completed via Gemini multimodal input.`
          : `${normalizedStage} completed via Gemini.`,
        requestPayload: {
          ...body,
          contents: [
            {
              role: 'user',
              parts: buildParts(input, attachments, true)
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

  async function requestImageInput(input = {}) {
    return requestText(input);
  }

  async function requestFileInput(input = {}) {
    return requestText(input);
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
