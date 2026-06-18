export function buildDirectLlmSettings(llm = {}) {
  const provider = String(llm?.provider || '').trim();
  return {
    provider,
    model: String(llm?.model || '').trim(),
    reasoningEffort: String(llm?.reasoningEffort || '').trim().toLowerCase(),
    apiEndpoint: provider === 'codex' ? '' : String(llm?.apiEndpoint || '').trim(),
    apiKey: provider === 'codex' ? '' : String(llm?.apiKey || '').trim()
  };
}

function getDirectLlmApi() {
  return globalThis.window?.hikariApi || globalThis.hikariApi || null;
}

async function requestDirectLlm({
  llm,
  moduleId,
  task,
  prompt,
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  attachments = [],
  expectJson = false,
  schema = null,
  systemPrompt = ''
}) {
  const api = getDirectLlmApi();
  if (!api?.runDirectLlmPrompt) {
    throw new Error('Direct LLM registry is unavailable in this build.');
  }

  const result = await api.runDirectLlmPrompt({
    moduleId,
    task,
    prompt,
    fileName,
    pdfDataUrl,
    imageDataUrl,
    attachments,
    expectJson,
    ...(schema && typeof schema === 'object' ? { schema } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    llm: buildDirectLlmSettings(llm)
  });
  if (!result?.ok) {
    throw new Error(String(result?.error || 'Direct LLM request failed.'));
  }
  return result;
}

async function requestDirectLlmText(options = {}) {
  const result = await requestDirectLlm(options);
  if (result?.text) {
    return String(result.text || '').trim();
  }
  if (result?.payload && typeof result.payload === 'object') {
    return JSON.stringify(result.payload);
  }
  return '';
}

export function requestLlmText({
  llm,
  prompt,
  fileName = '',
  pdfDataUrl = '',
  moduleId = 'shared',
  task = 'freeform-text',
  expectJson = false
}) {
  return requestDirectLlmText({
    llm,
    moduleId,
    task,
    prompt,
    fileName,
    pdfDataUrl,
    expectJson
  });
}

export {
  requestDirectLlm,
  requestDirectLlmText
};
