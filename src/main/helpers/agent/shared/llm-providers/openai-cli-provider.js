'use strict';

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createOpenAiCliLlmProvider(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const resolveCodexEndpoint = typeof deps.resolveCodexEndpoint === 'function'
    ? deps.resolveCodexEndpoint
    : ((endpoint) => cleanText(endpoint, 2000));
  const resolveCodexApiKey = typeof deps.resolveCodexApiKey === 'function'
    ? deps.resolveCodexApiKey
    : ((input = {}) => cleanText(input.apiKey, 400));
  const requestCodexCliText = typeof deps.requestCodexCliText === 'function' ? deps.requestCodexCliText : null;
  const getWorkingDirectory = typeof deps.getWorkingDirectory === 'function'
    ? deps.getWorkingDirectory
    : (() => process.cwd());
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
  const providerId = cleanText(deps.providerId, 80) || 'codex';

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
    const imageDataUrl = cleanText(input.imageDataUrl || input.imageUrl, 400000);
    return [
      ...(fileDataUrl ? [{ kind: 'file', name: cleanText(input.fileName, 240) || 'attachment.pdf', dataUrl: fileDataUrl }] : []),
      ...(imageDataUrl ? [{ kind: 'image', name: 'image', dataUrl: imageDataUrl }] : [])
    ];
  }

  function resolveCodexRequestOptions(input = {}) {
    const endpoint = cleanText(resolveCodexEndpoint(input.endpoint), 2000);
    const apiKey = cleanText(resolveCodexApiKey({
      apiKey: input.apiKey,
      endpoint: input.endpoint
    }), 4000);
    if (!endpoint) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI endpoint is not configured.'
      };
    }
    if (!apiKey) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI OAuth credentials are not configured. Run `codex login` first.'
      };
    }
    return {
      ok: true,
      endpoint,
      apiKey
    };
  }

  async function requestTextViaLegacyCli(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestCodexCliText) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI text input is not configured.'
      };
    }

    try {
      const attachments = normalizeAttachments(input);
      const prompt = [
        cleanText(input.systemPrompt, 12000),
        cleanText(input.userPrompt, 48000),
        input.expectJson === true ? 'Return JSON only.' : ''
      ]
        .filter(Boolean)
        .join('\n\n');
      const raw = await requestCodexCliText({
        prompt,
        model: cleanText(input.model, 120),
        enableWebSearch: input.enableWebSearch === true,
        cwd: getWorkingDirectory(),
        attachments,
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 4000)
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: attachments.length
          ? `${normalizedStage} completed via Codex multimodal prompt transport.`
          : `${normalizedStage} completed via legacy OpenAI CLI fallback.`,
        requestPayload: {
          model: cleanText(input.model, 120),
          prompt,
          enableWebSearch: input.enableWebSearch === true,
          attachments: attachments.map((attachment) => ({
            name: attachment.name,
            kind: attachment.kind,
            data: attachment.kind === 'image' ? '[image omitted]' : '[file omitted]'
          }))
        },
        responsePayload: raw
      });
      const text = cleanText(raw, 120000);
      if (!text) {
        return { ok: false, error: `${normalizedStage} response was empty.`, raw };
      }
      if (input.expectJson === true) {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        return { ok: true, payload: parsed, text, raw };
      }
      return { ok: true, text, raw };
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

  async function requestFileInputViaLegacyCli(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestCodexCliText) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI file input is not configured.'
      };
    }

    const normalizedFileData = cleanText(input.fileDataUrl || input.pdfDataUrl, 240000);
    const normalizedFileName = cleanText(input.fileName, 240) || 'paper.pdf';
    if (!normalizedFileData) {
      return {
        ok: false,
        error: `${normalizedStage} file input is required.`
      };
    }

    try {
      const prompt = [
        cleanText(input.systemPrompt, 12000),
        cleanText(input.userPrompt, 48000),
        input.expectJson === true ? 'Return JSON only.' : ''
      ].filter(Boolean).join('\n\n');
      const raw = await requestCodexCliText({
        prompt,
        model: cleanText(input.model, 120),
        enableWebSearch: input.enableWebSearch === true,
        cwd: getWorkingDirectory(),
        fileName: normalizedFileName,
        pdfDataUrl: normalizedFileData,
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 4000)
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via legacy OpenAI CLI fallback.`,
        requestPayload: {
          model: cleanText(input.model, 120),
          prompt,
          enableWebSearch: input.enableWebSearch === true,
          attachment: {
            file_name: normalizedFileName,
            file_type: 'document'
          }
        },
        responsePayload: raw
      });
      const text = cleanText(raw, 120000);
      if (!text) {
        return { ok: false, error: `${normalizedStage} response was empty.`, raw };
      }
      if (input.expectJson === true) {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        return { ok: true, payload: parsed, text, raw };
      }
      return { ok: true, text, raw };
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

  async function requestWebSearchViaLegacyCli(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'web_search';
    const normalizedQuery = cleanText(input.query, 1200);
    if (!requestCodexCliText) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI web search is not configured.'
      };
    }
    if (!normalizedQuery) {
      return {
        ok: false,
        error: 'Web search query is required.'
      };
    }

    try {
      const prompt = buildWebSearchPrompt({
        query: normalizedQuery,
        maxResults: Number(input.maxResults) || 8,
        allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains : [],
        userLocation: input.userLocation || null,
        codexMode: true
      });
      const raw = await requestCodexCliText({
        prompt,
        model: cleanText(input.model, 120),
        enableWebSearch: true,
        cwd: getWorkingDirectory(),
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 4000)
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via legacy OpenAI CLI fallback.`,
        requestPayload: {
          model: cleanText(input.model, 120),
          prompt,
          enableWebSearch: true
        },
        responsePayload: raw
      });
      const parsed = parseJsonObjectFromText(raw);
      if (!parsed) {
        return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
      }
      const normalized = normalizeWebSearchPayload(parsed, input.maxResults);
      return {
        ok: true,
        results: normalized.results,
        reasoning: normalized.reasoning,
        raw
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

  async function requestImageInputViaCodex(input = {}) {
    const normalizedStage = cleanText(input.stage, 120) || 'agent_stage';
    if (!requestCodexCliText) {
      return {
        ok: false,
        error: cleanText(input.defaultError, 600) || 'OpenAI CLI image input is not configured.'
      };
    }
    const normalizedImageData = cleanText(input.imageDataUrl || input.imageUrl, 400000);
    if (!normalizedImageData) {
      return {
        ok: false,
        error: `${normalizedStage} image input is required.`
      };
    }

    try {
      const prompt = [
        cleanText(input.systemPrompt, 12000),
        cleanText(input.userPrompt, 48000),
        input.expectJson === true ? 'Return JSON only.' : ''
      ].filter(Boolean).join('\n\n');
      const raw = await requestCodexCliText({
        prompt,
        model: cleanText(input.model, 120),
        enableWebSearch: input.enableWebSearch === true,
        cwd: getWorkingDirectory(),
        imageDataUrl: normalizedImageData,
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 4000)
      });
      await recordTrace(input.traceContext, {
        stage: normalizedStage,
        provider: providerId,
        model: cleanText(input.model, 120),
        summary: `${normalizedStage} completed via Codex multimodal prompt transport.`,
        requestPayload: {
          model: cleanText(input.model, 120),
          prompt,
          enableWebSearch: input.enableWebSearch === true,
          attachment: {
            file_type: 'image'
          }
        },
        responsePayload: raw
      });
      const text = cleanText(raw, 120000);
      if (!text) {
        return { ok: false, error: `${normalizedStage} response was empty.`, raw };
      }
      if (input.expectJson === true) {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
          return { ok: false, error: `${normalizedStage} response was not valid JSON.`, raw };
        }
        return { ok: true, payload: parsed, text, raw };
      }
      return { ok: true, text, raw };
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

  async function requestText(input = {}) {
    const resolved = resolveCodexRequestOptions(input);
    if (!resolved.ok) {
      return resolved;
    }
    return requestTextViaLegacyCli({
      ...input,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });
  }

  async function requestImageInput(input = {}) {
    const resolved = resolveCodexRequestOptions(input);
    if (!resolved.ok) {
      return resolved;
    }
    return requestImageInputViaCodex({
      ...input,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });
  }

  async function requestFileInput(input = {}) {
    const resolved = resolveCodexRequestOptions(input);
    if (!resolved.ok) {
      return resolved;
    }
    return requestFileInputViaLegacyCli({
      ...input,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });
  }

  async function requestWebSearch(input = {}) {
    const resolved = resolveCodexRequestOptions(input);
    if (!resolved.ok) {
      return resolved;
    }
    return requestWebSearchViaLegacyCli({
      ...input,
      endpoint: resolved.endpoint,
      apiKey: resolved.apiKey
    });
  }

  return {
    requestText,
    requestImageInput,
    requestFileInput,
    requestWebSearch
  };
}

module.exports = {
  createOpenAiCliLlmProvider
};
