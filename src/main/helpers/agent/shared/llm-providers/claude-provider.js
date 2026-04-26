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
  const injectedCleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const cleanText = (value) => injectedCleanText(value);
  const requestClaudeMessagesWithBackoff = typeof deps.requestClaudeMessagesWithBackoff === 'function'
    ? deps.requestClaudeMessagesWithBackoff
    : null;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : ((payload) => cleanText(payload?.content?.[0]?.text));
  const recordTrace = typeof deps.recordTrace === 'function' ? deps.recordTrace : (async () => {});
  const parseJsonObjectFromText = typeof deps.parseJsonObjectFromText === 'function'
    ? deps.parseJsonObjectFromText
    : (() => null);
  const isAbortError = typeof deps.isAbortError === 'function' ? deps.isAbortError : (() => false);
  const providerId = cleanText(deps.providerId) || 'claude';

  function normalizeAttachments(input = {}) {
    const listed = Array.isArray(input.attachments) ? input.attachments : [];
    const attachments = listed.map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        kind: cleanText(source.kind),
        name: cleanText(source.name) || 'attachment',
        dataUrl: cleanText(source.dataUrl || source.data_url)
      };
    }).filter((attachment) => attachment.dataUrl);
    if (attachments.length) {
      return attachments;
    }
    const fileDataUrl = cleanText(input.fileDataUrl || input.pdfDataUrl);
    const imageDataUrl = cleanText(input.imageDataUrl || input.imageUrl);
    return [
      ...(fileDataUrl ? [{ kind: 'file', name: cleanText(input.fileName) || 'attachment.pdf', dataUrl: fileDataUrl }] : []),
      ...(imageDataUrl ? [{ kind: 'image', name: 'image', dataUrl: imageDataUrl }] : [])
    ];
  }

  function buildAttachmentContent(attachment, redact = false) {
    const source = parseBase64DataUrl(attachment?.dataUrl);
    if (!source) {
      return {
        type: 'text',
        text: `Attached file: ${cleanText(attachment?.name) || 'attachment'}`
      };
    }
    if (attachment?.kind === 'image' || /^image\//i.test(source.mediaType)) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: source.mediaType,
          data: redact ? '[image omitted]' : source.data
        }
      };
    }
    if (source.mediaType === 'application/pdf') {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: redact ? '[pdf omitted]' : source.data
        }
      };
    }
    return {
      type: 'text',
      text: `Attached file: ${cleanText(attachment?.name) || 'attachment'} (${cleanText(source.mediaType) || 'application/octet-stream'}).`
    };
  }

  async function requestText(input = {}) {
    const normalizedStage = cleanText(input.stage) || 'agent_stage';
    if (!requestClaudeMessagesWithBackoff) {
      return {
        ok: false,
        error: cleanText(input.defaultError) || 'Claude text input is not configured.'
      };
    }

    try {
      const attachments = normalizeAttachments(input);
      const systemPrompt = cleanText(input.systemPrompt);
      const body = {
        model: cleanText(input.model),
        ...(systemPrompt ? { system: systemPrompt } : {}),
        max_tokens: Number.isFinite(Number(input.maxOutputTokens)) ? Number(input.maxOutputTokens) : 64000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: cleanText(input.userPrompt)
                  + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
              },
              ...attachments.map((attachment) => buildAttachmentContent(attachment, false))
            ]
          }
        ]
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint: cleanText(input.endpoint),
        apiKey: cleanText(input.apiKey),
        body
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model),
        summary: attachments.length
          ? `${normalizedStage} completed via Claude multimodal input.`
          : `${normalizedStage} completed via Claude.`,
        requestPayload: {
          ...body,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: cleanText(input.userPrompt)
                    + (input.expectJson === true ? '\n\nReturn JSON only.' : '')
                },
                ...attachments.map((attachment) => buildAttachmentContent(attachment, true))
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
        error: cleanText(error?.message || error) || `${normalizedStage} request failed.`
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
      error: cleanText(input.defaultError) || 'Claude provider web search is not configured.'
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
