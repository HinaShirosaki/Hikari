import { parseJsonFromText } from './normalizers.js';
import { parsePdfDataUrl } from './storage.js';
import {
  LLM_PROVIDERS,
  defaultLlmEndpointForProvider,
  normalizeLlmProvider,
  providerRequiresApiKey
} from '../shared.js';

const LLM_PROMPTS_PATH = './data/llm-prompts.json';
const DEFAULT_LLM_PROMPTS = {
  paperSummary: '',
  extractMethods: '',
  extractReagents: '',
  knowledgeQa: '',
  paperTitleSuffix: ''
};

function getLlmRequestConfig(llm) {
  const legacySetting = String(llm?.api || '').trim();
  const legacyLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacySetting);
  const endpointCandidate = String(llm?.apiEndpoint || '').trim() || (legacyLooksLikeEndpoint ? legacySetting : '');
  const provider = normalizeLlmProvider(llm?.provider, endpointCandidate);
  const endpoint = provider === LLM_PROVIDERS.CODEX
    ? ''
    : (endpointCandidate || defaultLlmEndpointForProvider(provider));
  const token = provider === LLM_PROVIDERS.CODEX
    ? ''
    : (String(llm?.apiKey || '').trim() || (legacySetting && !legacyLooksLikeEndpoint ? legacySetting : ''));

  if (providerRequiresApiKey(provider) && !token) {
    throw new Error('Missing API key in Settings > LLM Model & Access.');
  }

  return { provider, endpoint, token };
}

function normalizePromptConfig(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const fromNested = source.papers && typeof source.papers === 'object' ? source.papers : {};
  const fromFlat = source;
  return {
    ...DEFAULT_LLM_PROMPTS,
    ...fromFlat,
    ...fromNested
  };
}

function renderPromptTemplate(template, vars = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return String(vars[key] ?? '');
  });
}

async function requestResponses({ llm, modelFallbackPrompt, fileName, pdfDataUrl, prompt }) {
  const { provider, endpoint, token } = getLlmRequestConfig(llm);
  const model = String(llm?.model || '').trim();
  if (!model && provider !== LLM_PROVIDERS.CODEX) {
    throw new Error('Missing model in Settings > LLM Model & Access.');
  }

  if (provider === LLM_PROVIDERS.CLAUDE) {
    return requestClaude({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === LLM_PROVIDERS.GEMINI) {
    return requestGemini({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === LLM_PROVIDERS.CODEX) {
    return requestCodex({
      model,
      reasoningEffort: String(llm?.reasoningEffort || '').trim().toLowerCase(),
      prompt: prompt || modelFallbackPrompt || '',
      fileName,
      pdfDataUrl
    });
  }
  return requestOpenAi({
    endpoint,
    token,
    model,
    prompt: prompt || modelFallbackPrompt || '',
    fileName,
    pdfDataUrl
  });
}

async function requestOpenAi({ endpoint, token, model, prompt, fileName, pdfDataUrl }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: pdfDataUrl
            ? [
              { type: 'input_text', text: prompt },
              {
                type: 'input_file',
                filename: fileName || 'paper.pdf',
                file_data: pdfDataUrl
              }
            ]
            : [
              { type: 'input_text', text: prompt }
            ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  if (payload.output_text) {
    return payload.output_text;
  }

  const chunks = [];
  (payload.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    });
  });
  return chunks.join('\n').trim();
}

async function requestClaude({ endpoint, token, model, prompt, pdfDataUrl }) {
  const content = [{ type: 'text', text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Claude request.');
  }
  if (pdfBase64) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  return (payload?.content || [])
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function buildGeminiGenerateContentUrl(endpoint, model, token) {
  const cleanEndpoint = String(endpoint || '').trim() || defaultLlmEndpointForProvider(LLM_PROVIDERS.GEMINI);
  let url = cleanEndpoint.replace(/\/+$/, '');
  if (!url.includes(':generateContent')) {
    if (/\/models\/[^/?#]+$/i.test(url)) {
      url = `${url}:generateContent`;
    } else if (/\/models$/i.test(url)) {
      url = `${url}/${encodeURIComponent(model)}:generateContent`;
    } else {
      url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(token)}`;
}

async function requestGemini({ endpoint, token, model, prompt, pdfDataUrl }) {
  const parts = [{ text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Gemini request.');
  }
  if (pdfBase64) {
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(buildGeminiGenerateContentUrl(endpoint, model, token), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  if (!candidate?.content?.parts) {
    return '';
  }
  return candidate.content.parts
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function requestCodex({ model, reasoningEffort, prompt, fileName, pdfDataUrl }) {
  if (!window.enanaApi?.runCodexLlmPrompt) {
    throw new Error('Codex agent bridge is unavailable in this build.');
  }
  const result = await window.enanaApi.runCodexLlmPrompt({
    model,
    reasoningEffort,
    prompt,
    fileName,
    pdfDataUrl
  });
  if (!result?.ok) {
    throw new Error(String(result?.error || 'Codex agent request failed.'));
  }
  return String(result?.text || '').trim();
}

export function requestLlmText({ llm, prompt, fileName = '', pdfDataUrl = '' }) {
  return requestResponses({
    llm,
    prompt,
    fileName,
    pdfDataUrl
  });
}

export function getLlmPrompts() {
  return (async () => {
    try {
      const response = await fetch(`${LLM_PROMPTS_PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load prompts: ${response.status}`);
      }
      const parsed = await response.json();
      return normalizePromptConfig(parsed);
    } catch {
      return normalizePromptConfig({});
    }
  })();
}

export function requirePrompt(prompts, key) {
  const value = String(prompts?.[key] || '').trim();
  if (!value) {
    throw new Error(`Missing LLM prompt "${key}" in ${LLM_PROMPTS_PATH}.`);
  }
  return value;
}

export function requestSummary({ llm, pdfDataUrl, fileName, title, prompts = null }) {
  return (async () => {
    const resolvedPrompts = prompts || await getLlmPrompts();
    return requestResponses({
      llm,
      fileName,
      pdfDataUrl,
      prompt: renderPromptTemplate(requirePrompt(resolvedPrompts, 'paperSummary'), {
        title: title || fileName
      })
    });
  })();
}

export function requestStructuredFromPaper({
  llm,
  pdfDataUrl,
  fileName,
  title,
  instruction,
  prompts = null
}) {
  return (async () => {
    const resolvedPrompts = prompts || await getLlmPrompts();
    const raw = await requestResponses({
      llm,
      fileName,
      pdfDataUrl,
      prompt: `${instruction}\n\n${renderPromptTemplate(requirePrompt(resolvedPrompts, 'paperTitleSuffix'), {
        title: title || fileName
      })}`
    });
    return parseJsonFromText(raw);
  })();
}
