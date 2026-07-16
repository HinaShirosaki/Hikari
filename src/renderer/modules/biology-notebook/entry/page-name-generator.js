import { requestDirectLlmText } from '../../../services/direct-llm.js';

const SMALL_MODEL_BY_PROVIDER = Object.freeze({
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash-lite',
  claude: 'claude-3-5-haiku-latest',
  deepseek: 'deepseek-v4-flash',
  codex: 'gpt-5.4-mini'
});

const NOTEBOOK_NAME_SOURCES = new Set(['protocol', 'generated', 'user']);

function cleanLine(value, maxLength = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function collectPlaceholderRows(protocol, values = {}) {
  const sourceValues = values && typeof values === 'object' ? values : {};
  const rows = [];
  (Array.isArray(protocol?.steps) ? protocol.steps : []).forEach((step, stepIndex) => {
    const stepId = String(step?.id || `step_${stepIndex + 1}`).trim();
    (Array.isArray(step?.placeholders) ? step.placeholders : []).forEach((placeholder, placeholderIndex) => {
      const placeholderId = String(placeholder?.id || '').trim();
      if (!placeholderId) {
        return;
      }
      rows.push({
        key: `${stepId}:${placeholderId}`,
        name: cleanLine(placeholder?.name || placeholderId || `Value ${placeholderIndex + 1}`, 100),
        value: cleanLine(sourceValues[`${stepId}:${placeholderId}`] ?? sourceValues[placeholderId], 180)
      });
    });
  });
  return rows;
}

export function areAllNotebookPlaceholdersFilled(protocol, values = {}) {
  const rows = collectPlaceholderRows(protocol, values);
  return rows.length > 0 && rows.every((row) => Boolean(row.value));
}

export function normalizeNotebookExperimentNameSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return NOTEBOOK_NAME_SOURCES.has(source) ? source : '';
}

export function resolveNotebookExperimentNameSource(entry = null, protocol = null) {
  const explicitSource = normalizeNotebookExperimentNameSource(entry?.experimentNameSource);
  if (explicitSource) {
    return explicitSource;
  }
  const experimentName = String(entry?.experimentName || '').trim();
  const protocolName = String(entry?.protocolName || protocol?.name || '').trim();
  if (experimentName && protocolName && experimentName !== protocolName) {
    return 'user';
  }
  return 'protocol';
}

export function buildSmallNotebookNamingLlm(llm = {}) {
  const provider = String(llm?.provider || '').trim().toLowerCase();
  return {
    ...llm,
    provider,
    model: SMALL_MODEL_BY_PROVIDER[provider] || String(llm?.model || '').trim(),
    reasoningEffort: provider === 'codex' ? 'low' : ''
  };
}

export function buildNotebookPageNamePrompt({ protocol, values = {} } = {}) {
  const rows = collectPlaceholderRows(protocol, values);
  const stepLines = (Array.isArray(protocol?.steps) ? protocol.steps : [])
    .slice(0, 50)
    .map((step, index) => {
      const text = cleanLine(step?.text || step?.instruction || step?.description, 260);
      return text ? `${index + 1}. ${text}` : '';
    })
    .filter(Boolean);
  return [
    'Generate a concise name for this completed biology notebook page.',
    '',
    'Requirements:',
    '- Use 3 to 8 words.',
    '- Describe the specific experiment, not the generic protocol.',
    '- Use important filled values only when they make the name more specific.',
    '- Do not add quotes, a label, a date, or terminal punctuation.',
    '- Return the name only.',
    '',
    `Protocol: ${cleanLine(protocol?.name, 160) || 'Untitled protocol'}`,
    stepLines.length ? `Steps:\n${stepLines.join('\n')}` : '',
    `Filled placeholders:\n${rows.map((row) => `- ${row.name}: ${row.value}`).join('\n')}`
  ].filter(Boolean).join('\n');
}

export function normalizeGeneratedNotebookPageName(value, maxLength = 80) {
  const unfenced = String(value || '')
    .replace(/```(?:text)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const firstLine = unfenced.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const clean = firstLine
    .replace(/^(?:title|name)\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  const shortened = clean.slice(0, maxLength + 1);
  const lastSpace = shortened.lastIndexOf(' ');
  return shortened.slice(0, lastSpace > Math.floor(maxLength * 0.6) ? lastSpace : maxLength).trim();
}

export async function generateNotebookPageName({ llm, protocol, values = {} } = {}) {
  if (!areAllNotebookPlaceholdersFilled(protocol, values)) {
    return null;
  }
  const namingLlm = buildSmallNotebookNamingLlm(llm);
  const rawName = await requestDirectLlmText({
    llm: namingLlm,
    moduleId: 'notebook',
    task: 'page-name',
    prompt: buildNotebookPageNamePrompt({ protocol, values }),
    systemPrompt: 'You name completed biology notebook experiments. Follow the requested output format exactly.',
    maxOutputTokens: 40
  });
  const name = normalizeGeneratedNotebookPageName(rawName);
  if (!name) {
    throw new Error('The notebook naming model returned an empty name.');
  }
  return {
    name,
    model: namingLlm.model,
    provider: namingLlm.provider
  };
}
