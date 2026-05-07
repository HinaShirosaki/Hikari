'use strict';

const DEFAULT_DIRECT_LLM_MODULES = Object.freeze([
  {
    id: 'papers',
    label: 'Papers',
    description: 'Paper library summarization and structured extraction.',
    tasks: [
      { id: 'paper-summary', label: 'Paper summary', requestKind: 'file' },
      { id: 'paper-structured-extraction', label: 'Paper structured extraction', requestKind: 'file' },
      { id: 'paper-methods-extraction', label: 'Paper methods extraction', requestKind: 'file' },
      { id: 'paper-reagents-extraction', label: 'Paper reagent extraction', requestKind: 'file' },
      { id: 'paper-knowledge-qa', label: 'Paper knowledge Q&A', requestKind: 'text' }
    ]
  },
  {
    id: 'protocol',
    label: 'Protocol',
    description: 'Protocol editor polishing and other direct protocol assistance.',
    tasks: [
      { id: 'protocol-generation', label: 'Protocol generation', requestKind: 'text', expectJson: true },
      { id: 'protocol-polish', label: 'Protocol polish', requestKind: 'text', expectJson: true }
    ]
  },
  {
    id: 'notebook',
    label: 'Notebook',
    description: 'Notebook note cleanup before persistence.',
    tasks: [
      { id: 'note-clarify', label: 'Clarify note', requestKind: 'text' }
    ]
  },
  {
    id: 'inventory',
    label: 'Inventory',
    description: 'Inventory import and mapping assistance.',
    tasks: [
      { id: 'chemical-header-mapping', label: 'Chemical import header mapping', requestKind: 'text', expectJson: true }
    ]
  },
  {
    id: 'shared',
    label: 'Shared',
    description: 'Shared direct LLM utility calls that do not have a narrower owner yet.',
    tasks: [
      { id: 'freeform-text', label: 'Freeform text', requestKind: 'text' }
    ]
  }
]);

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRegistryId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTaskDefinition(rawTask = {}) {
  const source = ensureObject(rawTask);
  const id = normalizeRegistryId(source.id || source.task || source.name);
  if (!id) {
    return null;
  }
  const requestKind = normalizeRegistryId(source.requestKind || source.request_kind || 'text') || 'text';
  return {
    id,
    label: String(source.label || source.name || id).trim() || id,
    description: String(source.description || '').trim(),
    requestKind,
    expectJson: source.expectJson === true || source.expect_json === true,
    enableWebSearch: source.enableWebSearch === true || source.enable_web_search === true
  };
}

function normalizeModuleDefinition(rawModule = {}) {
  const source = ensureObject(rawModule);
  const id = normalizeRegistryId(source.id || source.module || source.name);
  if (!id) {
    return null;
  }
  const tasks = asArray(source.tasks)
    .map(normalizeTaskDefinition)
    .filter(Boolean);
  return {
    id,
    label: String(source.label || source.name || id).trim() || id,
    description: String(source.description || '').trim(),
    tasks
  };
}

function createDirectLlmModuleRegistry(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestText = typeof deps.requestText === 'function' ? deps.requestText : null;
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const requestImageInput = typeof deps.requestImageInput === 'function' ? deps.requestImageInput : null;
  const requestFileInput = typeof deps.requestFileInput === 'function' ? deps.requestFileInput : null;
  const requestWebSearch = typeof deps.requestWebSearch === 'function' ? deps.requestWebSearch : null;
  const normalizeLlmProvider = typeof deps.normalizeLlmProvider === 'function' ? deps.normalizeLlmProvider : null;
  const defaultLlmEndpointForProvider = typeof deps.defaultLlmEndpointForProvider === 'function'
    ? deps.defaultLlmEndpointForProvider
    : (() => '');
  const defaultAgentModelForProvider = typeof deps.defaultAgentModelForProvider === 'function'
    ? deps.defaultAgentModelForProvider
    : (() => '');
  const LLM_PROVIDERS = ensureObject(deps.LLM_PROVIDERS);
  const DEFAULT_LLM_PROVIDER = cleanText(deps.DEFAULT_LLM_PROVIDER, 80);
  const modules = new Map();

  function registerModule(rawModule = {}) {
    const normalized = normalizeModuleDefinition(rawModule);
    if (!normalized) {
      return false;
    }
    const tasks = new Map();
    normalized.tasks.forEach((task) => {
      tasks.set(task.id, task);
    });
    modules.set(normalized.id, {
      ...normalized,
      tasks
    });
    return true;
  }

  function unregisterModule(moduleId = '') {
    const id = normalizeRegistryId(moduleId);
    return id ? modules.delete(id) : false;
  }

  function getModule(moduleId = '') {
    const id = normalizeRegistryId(moduleId);
    return id ? (modules.get(id) || null) : null;
  }

  function getTask(moduleId = '', taskId = '') {
    const moduleEntry = getModule(moduleId);
    const id = normalizeRegistryId(taskId);
    return moduleEntry && id ? (moduleEntry.tasks.get(id) || null) : null;
  }

  function listModules() {
    return Array.from(modules.values()).map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      tasks: Array.from(entry.tasks.values()).map((task) => ({ ...task }))
    }));
  }

  function normalizeLlmSource(rawSource = {}) {
    const source = ensureObject(rawSource);
    const endpointCandidate = cleanText(source.endpoint || source.apiEndpoint || source.api_endpoint, 2000);
    const providerCandidate = cleanText(source.provider, 80);
    const provider = normalizeRegistryId(
      normalizeLlmProvider
        ? normalizeLlmProvider(providerCandidate || DEFAULT_LLM_PROVIDER, endpointCandidate)
        : (providerCandidate || DEFAULT_LLM_PROVIDER)
    );
    const codexProvider = normalizeRegistryId(LLM_PROVIDERS.CODEX || 'codex');
    const endpoint = provider === codexProvider
      ? ''
      : (endpointCandidate || cleanText(defaultLlmEndpointForProvider(provider), 2000));
    const apiKey = provider === codexProvider
      ? ''
      : cleanText(source.apiKey || source.api_key || source.token, 400);
    const model = cleanText(source.model, 120) || cleanText(defaultAgentModelForProvider(provider), 120);
    return {
      provider,
      endpoint,
      apiKey,
      model,
      reasoningEffort: cleanText(source.reasoningEffort || source.reasoning_effort, 40).toLowerCase()
    };
  }

  function buildStage(moduleId, taskId) {
    return `direct_llm_${normalizeRegistryId(moduleId).replace(/-/g, '_')}_${normalizeRegistryId(taskId).replace(/-/g, '_')}`;
  }

  function chooseRequestMethod(requestOptions = {}, task = {}) {
    const requestKind = normalizeRegistryId(requestOptions.requestKind || task.requestKind || 'text');
    if (requestKind === 'web-search') {
      return requestWebSearch;
    }
    if (requestKind === 'image' || requestOptions.imageDataUrl || requestOptions.imageUrl) {
      return requestImageInput;
    }
    if (requestKind === 'file' || requestOptions.fileDataUrl || requestOptions.pdfDataUrl) {
      return requestFileInput || requestStructuredJsonPayload;
    }
    if (requestOptions.expectJson === true) {
      return requestStructuredJsonPayload || requestText;
    }
    return requestText;
  }

  async function requestModuleLlm(rawPayload = {}) {
    const source = ensureObject(rawPayload);
    const moduleId = normalizeRegistryId(source.moduleId || source.module_id || source.module);
    const taskId = normalizeRegistryId(source.task || source.taskId || source.task_id || source.capability);
    if (!moduleId) {
      return { ok: false, error: 'Direct LLM module id is required.' };
    }
    if (!taskId) {
      return { ok: false, error: 'Direct LLM task id is required.' };
    }
    const moduleEntry = getModule(moduleId);
    if (!moduleEntry) {
      return { ok: false, error: `Direct LLM module "${moduleId}" is not registered.` };
    }
    const task = getTask(moduleId, taskId);
    if (!task) {
      return { ok: false, error: `Direct LLM task "${taskId}" is not registered for module "${moduleId}".` };
    }

    const prompt = typeof source.prompt === 'string'
      ? source.prompt
      : (typeof source.userPrompt === 'string' ? source.userPrompt : String(source.message || ''));
    if (!prompt.trim()) {
      return { ok: false, error: 'Direct LLM prompt is required.' };
    }

    const llmSource = normalizeLlmSource(source.llm || source);
    const codexProvider = normalizeRegistryId(LLM_PROVIDERS.CODEX || 'codex');
    if (!llmSource.provider) {
      return { ok: false, error: 'LLM provider is required.' };
    }
    if (llmSource.provider !== codexProvider && !llmSource.apiKey) {
      return { ok: false, error: 'Missing API key in Settings > LLM Model & Access.' };
    }
    if (llmSource.provider !== codexProvider && !llmSource.model) {
      return { ok: false, error: 'Missing model in Settings > LLM Model & Access.' };
    }

    const requestOptions = {
      provider: llmSource.provider,
      endpoint: llmSource.endpoint,
      apiKey: llmSource.apiKey,
      model: llmSource.model,
      reasoningEffort: llmSource.reasoningEffort,
      stage: cleanText(source.stage, 120) || buildStage(moduleId, taskId),
      systemPrompt: cleanText(source.systemPrompt || source.system_prompt, 12000),
      userPrompt: prompt,
      prompt,
      query: cleanText(source.query, 1200) || prompt,
      attachments: asArray(source.attachments)
        .map((attachment) => {
          const entry = ensureObject(attachment);
          return {
            kind: cleanText(entry.kind, 40),
            name: cleanText(entry.name, 240) || 'attachment',
            dataUrl: cleanText(entry.dataUrl || entry.data_url, 400000)
          };
        })
        .filter((attachment) => attachment.dataUrl),
      fileName: cleanText(source.fileName || source.file_name, 240),
      fileDataUrl: cleanText(source.fileDataUrl || source.file_data_url, 400000),
      pdfDataUrl: cleanText(source.pdfDataUrl || source.pdf_data_url, 400000),
      imageDataUrl: cleanText(source.imageDataUrl || source.image_data_url, 400000),
      imageUrl: cleanText(source.imageUrl || source.image_url, 400000),
      requestKind: normalizeRegistryId(source.requestKind || source.request_kind || task.requestKind),
      expectJson: source.expectJson === true || source.expect_json === true || task.expectJson === true,
      enableWebSearch: source.enableWebSearch === true || source.enable_web_search === true || task.enableWebSearch === true,
      maxOutputTokens: Number.isFinite(Number(source.maxOutputTokens || source.max_output_tokens))
        ? Number(source.maxOutputTokens || source.max_output_tokens)
        : undefined,
      schema: source.schema && typeof source.schema === 'object' ? source.schema : undefined,
      traceContext: source.traceContext && typeof source.traceContext === 'object' ? source.traceContext : undefined
    };

    const requestMethod = chooseRequestMethod(requestOptions, task);
    if (typeof requestMethod !== 'function') {
      return {
        ok: false,
        error: `Direct LLM request kind "${requestOptions.requestKind || 'text'}" is not configured.`
      };
    }

    const result = await requestMethod(requestOptions);
    if (!result || result.ok === false) {
      return {
        ok: false,
        moduleId,
        task: taskId,
        provider: llmSource.provider,
        error: cleanText(result?.error, 1200) || 'Direct LLM request failed.'
      };
    }

    return {
      ok: true,
      moduleId,
      task: taskId,
      provider: llmSource.provider,
      text: cleanText(result.text || result.output_text || result.message, 120000),
      payload: result.payload && typeof result.payload === 'object' ? result.payload : null
    };
  }

  return {
    registerModule,
    unregisterModule,
    getModule,
    getTask,
    listModules,
    requestModuleLlm
  };
}

function registerDefaultDirectLlmModules(registry) {
  if (!registry || typeof registry.registerModule !== 'function') {
    return registry;
  }
  DEFAULT_DIRECT_LLM_MODULES.forEach((entry) => {
    registry.registerModule(entry);
  });
  return registry;
}

module.exports = {
  DEFAULT_DIRECT_LLM_MODULES,
  createDirectLlmModuleRegistry,
  registerDefaultDirectLlmModules
};
