import { parseJsonFromText } from './normalizers.js';
import { parsePdfDataUrl } from './storage.js';

const LLM_PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  claude: 'https://api.anthropic.com/v1/messages',
  codex: 'codex://cli'
};

const LLM_PROMPTS_PATH = './data/llm-prompts.json';
const DEFAULT_LLM_PROMPTS = {
  paperSummary: '',
  extractMethods: '',
  extractReagents: '',
  knowledgeQa: '',
  paperTitleSuffix: ''
};

function inferProviderFromEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('openai-cli')) {
    return 'codex';
  }
  if (value.includes('anthropic.com')) {
    return 'claude';
  }
  if (value.includes('generativelanguage.googleapis.com') || value.includes('ai.google')) {
    return 'gemini';
  }
  if (value.includes('openai.com') || value.includes('/openai/')) {
    return 'openai';
  }
  return '';
}

function normalizeLlmProvider(provider, endpoint = '') {
  const clean = String(provider || '').trim().toLowerCase();
  if (clean === 'openai' || clean === 'gemini' || clean === 'claude' || clean === 'codex') {
    return clean;
  }
  return inferProviderFromEndpoint(endpoint) || 'openai';
}

function defaultEndpointForProvider(provider) {
  const resolved = normalizeLlmProvider(provider);
  return LLM_PROVIDER_ENDPOINTS[resolved] || LLM_PROVIDER_ENDPOINTS.openai;
}

function getLlmRequestConfig(llm) {
  const legacySetting = String(llm?.api || '').trim();
  const legacyLooksLikeEndpoint = /^[a-z]+:\/\//i.test(legacySetting);
  const endpointCandidate = String(llm?.apiEndpoint || '').trim() || (legacyLooksLikeEndpoint ? legacySetting : '');
  const provider = normalizeLlmProvider(llm?.provider, endpointCandidate);
  const endpoint = endpointCandidate || defaultEndpointForProvider(provider);
  const token = String(llm?.apiKey || '').trim() || (legacySetting && !legacyLooksLikeEndpoint ? legacySetting : '');

  if (provider !== 'codex' && !token) {
    throw new Error('Missing API key in Settings > LLM Model & API.');
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
  if (!model && provider !== 'codex') {
    throw new Error('Missing model in Settings > LLM Model & API.');
  }

  if (provider === 'claude') {
    return requestClaude({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === 'gemini') {
    return requestGemini({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === 'codex') {
    return requestCodex({
      model,
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
  const cleanEndpoint = String(endpoint || '').trim() || LLM_PROVIDER_ENDPOINTS.gemini;
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
      ],
      generationConfig: {
        maxOutputTokens: 1400
      }
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

async function requestCodex({ model, prompt, fileName, pdfDataUrl }) {
  if (!window.enanaApi?.runCodexLlmPrompt) {
    throw new Error('Codex CLI bridge is unavailable in this build.');
  }
  const result = await window.enanaApi.runCodexLlmPrompt({
    model,
    prompt,
    fileName,
    pdfDataUrl
  });
  if (!result?.ok) {
    throw new Error(String(result?.error || 'Codex CLI request failed.'));
  }
  return String(result?.text || '').trim();
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
