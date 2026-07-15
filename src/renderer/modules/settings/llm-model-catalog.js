import {
  getLlmModelConfig,
  getLlmProviderModelOptions,
  normalizeReasoningEffort
} from '../codex-model-catalog.generated.js';

export function normalizeCodexCatalog(rawCatalog) {
  const source = rawCatalog && typeof rawCatalog === 'object' ? rawCatalog : {};
  return {
    defaultModel: String(source.defaultModel || '').trim(),
    defaultReasoningEffort: String(source.defaultReasoningEffort || '').trim().toLowerCase(),
    models: (Array.isArray(source.models) ? source.models : []).map((entry) => ({
      id: String(entry?.id || '').trim(),
      label: String(entry?.label || entry?.id || '').trim(),
      reasoningEfforts: (Array.isArray(entry?.reasoningEfforts) ? entry.reasoningEfforts : [])
        .map((effort) => String(effort || '').trim().toLowerCase())
        .filter(Boolean),
      defaultReasoningEffort: String(entry?.defaultReasoningEffort || '').trim().toLowerCase()
    })).filter((entry) => entry.id)
  };
}

export function normalizeCodexLoginStatus(rawStatus) {
  const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  return {
    ok: source.ok === true,
    loggedIn: source.loggedIn === true,
    source: String(source.source || '').trim().toLowerCase() || 'none',
    expired: source.expired === true,
    sourcePath: String(source.sourcePath || '').trim(),
    message: String(source.message || '').trim()
  };
}

export function createLlmModelCatalog() {
  let codexCatalog = null;

  function getCodexModelConfig(model = '') {
    const target = String(model || '').trim();
    return codexCatalog?.models?.length && target
      ? codexCatalog.models.find((entry) => entry.id === target) || null
      : null;
  }

  function getModelConfig(provider, model = '') {
    return provider === 'codex' && codexCatalog?.models?.length
      ? getCodexModelConfig(model)
      : getLlmModelConfig(provider, model);
  }

  function getModelOptions(provider) {
    return provider === 'codex' && codexCatalog?.models?.length
      ? codexCatalog.models.map((entry) => ({ value: entry.id, label: entry.label || entry.id }))
      : getLlmProviderModelOptions(provider);
  }

  function normalizeModel(provider, model = '') {
    const cleanModel = String(model || '').trim();
    if (!cleanModel) {
      return '';
    }
    if (provider === 'codex' && codexCatalog?.models?.length) {
      return getCodexModelConfig(cleanModel)?.id
        || String(codexCatalog.defaultModel || '').trim()
        || cleanModel;
    }
    return cleanModel;
  }

  function normalizeReasoning(provider, model = '', reasoningEffort = '') {
    const cleanEffort = String(reasoningEffort || '').trim().toLowerCase();
    const modelConfig = getModelConfig(provider, model);
    const supported = Array.isArray(modelConfig?.reasoningEfforts) ? modelConfig.reasoningEfforts : [];
    return supported.length
      ? (supported.includes(cleanEffort) ? cleanEffort : '')
      : normalizeReasoningEffort(provider, model, cleanEffort);
  }

  return {
    getModelConfig,
    getModelOptions,
    hasCodexModels: () => Boolean(codexCatalog?.models?.length),
    normalizeModel,
    normalizeReasoning,
    setCodexCatalog(rawCatalog) {
      codexCatalog = normalizeCodexCatalog(rawCatalog);
      return codexCatalog;
    }
  };
}
