import { parseJsonFromText } from './normalizers.js';
import { requestDirectLlmText } from '../direct-llm.js';

const LLM_PROMPTS_PATH = './data/llm-prompts.json';
const DEFAULT_LLM_PROMPTS = {
  paperSummary: '',
  extractMethods: '',
  extractReagents: '',
  knowledgeQa: '',
  paperTitleSuffix: ''
};

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

async function requestResponses({
  llm,
  modelFallbackPrompt,
  fileName,
  pdfDataUrl,
  prompt,
  moduleId = 'shared',
  task = 'freeform-text',
  expectJson = false
}) {
  const resolvedPrompt = prompt || modelFallbackPrompt || '';
  return requestDirectLlmText({
    llm,
    moduleId,
    task,
    prompt: resolvedPrompt,
    fileName,
    pdfDataUrl,
    expectJson
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
    } catch (error) {
      console.warn('Failed to load LLM prompts; falling back to empty config:', error);
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
      moduleId: 'papers',
      task: 'paper-summary',
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
  prompts = null,
  task = 'paper-structured-extraction'
}) {
  return (async () => {
    const resolvedPrompts = prompts || await getLlmPrompts();
    const raw = await requestResponses({
      llm,
      fileName,
      pdfDataUrl,
      moduleId: 'papers',
      task,
      expectJson: true,
      prompt: `${instruction}\n\n${renderPromptTemplate(requirePrompt(resolvedPrompts, 'paperTitleSuffix'), {
        title: title || fileName
      })}`
    });
    return parseJsonFromText(raw);
  })();
}
