import path from 'node:path';
import { readJson, toPosix, writeText } from './fs-helpers.mjs';
import { CODEX_MODEL_CONFIG_PATH, MAIN_LLM_PROVIDER_MODULE_OUTPUT, RENDERER_LLM_PROVIDER_MODULE_OUTPUT, ROOT_DIR } from './paths.mjs';

function ensureCodexModelCatalogShape(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('codex-models.json must export an object');
  }
  if (!Object.prototype.hasOwnProperty.call(catalog, 'defaultModel')) {
    throw new Error('codex-models.json requires a "defaultModel" field');
  }
  if (!Array.isArray(catalog.models) || !catalog.models.length) {
    throw new Error('codex-models.json requires a non-empty "models" array');
  }
}

function normalizeLlmProviderCatalog(catalog) {
  ensureCodexModelCatalogShape(catalog);
  const defaultModel = String(catalog.defaultModel || '').trim();
  const models = catalog.models.map((modelEntry, modelIndex) => {
        if (!modelEntry || typeof modelEntry !== 'object' || Array.isArray(modelEntry)) {
          throw new Error(`Invalid Codex model entry at index ${modelIndex}`);
        }
        const modelId = String(modelEntry.id || '').trim();
        const modelLabel = String(modelEntry.label || '').trim();
        const reasoningEfforts = Array.isArray(modelEntry.reasoningEfforts)
          ? modelEntry.reasoningEfforts.map((effort) => String(effort || '').trim().toLowerCase()).filter(Boolean)
          : [];
        const defaultReasoningEffort = String(modelEntry.defaultReasoningEffort || '').trim().toLowerCase();

        if (!modelId || !modelLabel) {
          throw new Error(`Codex model entry at index ${modelIndex} is missing a required field`);
        }
        if (defaultReasoningEffort && !reasoningEfforts.includes(defaultReasoningEffort)) {
          throw new Error(`Codex model "${modelId}" has defaultReasoningEffort outside reasoningEfforts`);
        }

        return {
          id: modelId,
          label: modelLabel,
          reasoningEfforts,
          defaultReasoningEffort
        };
  });

  if (!models.some((model) => model.id === defaultModel)) {
    throw new Error(`defaultModel "${defaultModel}" does not match any Codex model id`);
  }

  return {
    defaultProvider: 'codex',
    providers: [{
      id: 'codex',
      key: 'CODEX',
      label: 'Codex Agent (CLI)',
      defaultEndpoint: '',
      defaultModel,
      modelPlaceholder: 'optional, e.g. gpt-5.4',
      apiKeyPlaceholder: 'Handled by codex login',
      requiresApiKey: false,
      endpointHints: [],
      models
    }]
  };
}

function buildLlmProviderModuleSource({ catalog, moduleType }) {
  const sourcePath = toPosix(path.relative(ROOT_DIR, CODEX_MODEL_CONFIG_PATH));
  const rawProviders = JSON.stringify(catalog.providers, null, 2);
  const defaultProvider = JSON.stringify(catalog.defaultProvider);
  const providerEnumEntries = catalog.providers
    .map((provider) => `  ${provider.key}: ${JSON.stringify(provider.id)}`)
    .join(',\n');
  const exportBlock = moduleType === 'esm'
    ? [
      'export {',
      '  LLM_PROVIDER_CONFIGS,',
      '  LLM_PROVIDER_OPTIONS,',
      '  LLM_MODEL_OPTIONS_BY_PROVIDER,',
      '  PROVIDER_CONFIG_BY_ID,',
      '  MODEL_CONFIG_BY_PROVIDER_ID,',
      '  LLM_PROVIDERS,',
      '  DEFAULT_LLM_PROVIDER,',
      '  DEFAULT_AGENT_LLM_PROVIDER,',
      '  AGENT_LLM_PROVIDER_OPTIONS,',
      '  DEFAULT_LLM_ENDPOINTS,',
      '  DEFAULT_AGENT_MODELS,',
      '  inferLlmProviderFromEndpoint,',
      '  normalizeLlmProvider,',
      '  normalizeAgentLlmProvider,',
      '  getLlmProviderConfig,',
      '  getLlmProviderModelOptions,',
      '  getLlmModelConfig,',
      '  defaultLlmEndpointForProvider,',
      '  defaultAgentModelForProvider,',
      '  defaultReasoningEffortForModel,',
      '  normalizeReasoningEffort,',
      '  providerLabelForId,',
      '  modelPlaceholderForProvider,',
      '  apiKeyPlaceholderForProvider,',
      '  providerRequiresApiKey\n};'
    ].join('\n')
    : [
      'module.exports = {',
      '  LLM_PROVIDER_CONFIGS,',
      '  LLM_PROVIDER_OPTIONS,',
      '  LLM_MODEL_OPTIONS_BY_PROVIDER,',
      '  PROVIDER_CONFIG_BY_ID,',
      '  MODEL_CONFIG_BY_PROVIDER_ID,',
      '  LLM_PROVIDERS,',
      '  DEFAULT_LLM_PROVIDER,',
      '  DEFAULT_AGENT_LLM_PROVIDER,',
      '  AGENT_LLM_PROVIDER_OPTIONS,',
      '  DEFAULT_LLM_ENDPOINTS,',
      '  DEFAULT_AGENT_MODELS,',
      '  inferLlmProviderFromEndpoint,',
      '  normalizeLlmProvider,',
      '  normalizeAgentLlmProvider,',
      '  getLlmProviderConfig,',
      '  getLlmProviderModelOptions,',
      '  getLlmModelConfig,',
      '  defaultLlmEndpointForProvider,',
      '  defaultAgentModelForProvider,',
      '  defaultReasoningEffortForModel,',
      '  normalizeReasoningEffort,',
      '  providerLabelForId,',
      '  modelPlaceholderForProvider,',
      '  apiKeyPlaceholderForProvider,',
      '  providerRequiresApiKey\n};'
    ].join('\n');

  return [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${sourcePath} */`,
    '',
    `const RAW_LLM_PROVIDER_CONFIGS = ${rawProviders};`,
    '',
    'const LLM_PROVIDER_CONFIGS = Object.freeze(',
    '  RAW_LLM_PROVIDER_CONFIGS.map((provider) => Object.freeze({',
    '    ...provider,',
    '    endpointHints: Object.freeze(Array.isArray(provider.endpointHints) ? [...provider.endpointHints] : []),',
    '    models: Object.freeze(',
    '      (Array.isArray(provider.models) ? provider.models : []).map((model) => Object.freeze({',
    '        ...model,',
    '        reasoningEfforts: Object.freeze(Array.isArray(model.reasoningEfforts) ? [...model.reasoningEfforts] : [])',
    '      }))',
    '    )',
    '  }))',
    ');',
    '',
    'const LLM_PROVIDER_OPTIONS = Object.freeze(',
    '  LLM_PROVIDER_CONFIGS.map((provider) => Object.freeze({',
    '    value: provider.id,',
    '    label: provider.label',
    '  }))',
    ');',
    '',
    'const LLM_MODEL_OPTIONS_BY_PROVIDER = Object.freeze(',
    '  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [',
    '    provider.id,',
    '    Object.freeze(provider.models.map((model) => Object.freeze({',
    '      value: model.id,',
    '      label: model.label',
    '    })))',
    '  ]))',
    ');',
    '',
    'const PROVIDER_CONFIG_BY_ID = Object.freeze(',
    '  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider]))',
    ');',
    '',
    'const MODEL_CONFIG_BY_PROVIDER_ID = Object.freeze(',
    '  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [',
    '    provider.id,',
    '    Object.freeze(Object.fromEntries(provider.models.map((model) => [model.id, model])))',
    '  ]))',
    ');',
    '',
    'const LLM_PROVIDERS = Object.freeze({',
    providerEnumEntries,
    '});',
    '',
    `const DEFAULT_LLM_PROVIDER = ${defaultProvider};`,
    'const DEFAULT_AGENT_LLM_PROVIDER = LLM_PROVIDERS.CODEX || DEFAULT_LLM_PROVIDER;',
    'const AGENT_LLM_PROVIDER_OPTIONS = Object.freeze(',
    '  LLM_PROVIDER_OPTIONS.filter((provider) => provider.value === DEFAULT_AGENT_LLM_PROVIDER)',
    ');',
    'const DEFAULT_LLM_ENDPOINTS = Object.freeze(',
    '  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider.defaultEndpoint]))',
    ');',
    'const DEFAULT_AGENT_MODELS = Object.freeze(',
    '  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider.defaultModel]))',
    ');',
    '',
    'function inferLlmProviderFromEndpoint(endpoint) {',
    "  const value = String(endpoint || '').trim().toLowerCase();",
    '  if (!value) {',
    "    return '';",
    '  }',
    "  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('codex agent')) {",
    '    return LLM_PROVIDERS.CODEX;',
    '  }',
    '  for (const provider of LLM_PROVIDER_CONFIGS) {',
    '    const hints = Array.isArray(provider.endpointHints) ? provider.endpointHints : [];',
    "    if (hints.some((hint) => value.includes(String(hint || '').trim().toLowerCase()))) {",
    '      return provider.id;',
    '    }',
    '  }',
    "  return '';",
    '}',
    '',
    'function normalizeLlmProvider(provider, endpoint = \'\') {',
    "  const clean = String(provider || '').trim().toLowerCase();",
    '  if (Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG_BY_ID, clean)) {',
    '    return clean;',
    '  }',
    '  return inferLlmProviderFromEndpoint(endpoint) || DEFAULT_LLM_PROVIDER;',
    '}',
    '',
    'function normalizeAgentLlmProvider() {',
    '  return DEFAULT_AGENT_LLM_PROVIDER;',
    '}',
    '',
    'function getLlmProviderConfig(provider, endpoint = \'\') {',
    '  const resolved = normalizeLlmProvider(provider, endpoint);',
    '  return PROVIDER_CONFIG_BY_ID[resolved] || PROVIDER_CONFIG_BY_ID[DEFAULT_LLM_PROVIDER] || null;',
    '}',
    '',
    'function getLlmProviderModelOptions(provider, endpoint = \'\') {',
    '  const resolved = getLlmProviderConfig(provider, endpoint)?.id || DEFAULT_LLM_PROVIDER;',
    '  return LLM_MODEL_OPTIONS_BY_PROVIDER[resolved] || Object.freeze([]);',
    '}',
    '',
    'function getLlmModelConfig(provider, model, endpoint = \'\') {',
    '  const resolvedProvider = getLlmProviderConfig(provider, endpoint)?.id || DEFAULT_LLM_PROVIDER;',
    '  const resolvedModel = String(model || \'\').trim();',
    '  if (!resolvedModel) {',
    '    return null;',
    '  }',
    '  return MODEL_CONFIG_BY_PROVIDER_ID[resolvedProvider]?.[resolvedModel] || null;',
    '}',
    '',
    'function defaultLlmEndpointForProvider(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.defaultEndpoint || \'\';',
    '}',
    '',
    'function defaultAgentModelForProvider(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.defaultModel || \'\';',
    '}',
    '',
    'function defaultReasoningEffortForModel(provider, model, endpoint = \'\') {',
    '  return getLlmModelConfig(provider, model, endpoint)?.defaultReasoningEffort || \'\';',
    '}',
    '',
    'function normalizeReasoningEffort(provider, model, reasoningEffort, endpoint = \'\') {',
    '  const config = getLlmModelConfig(provider, model, endpoint);',
    '  const clean = String(reasoningEffort || \'\').trim().toLowerCase();',
    '  const supported = Array.isArray(config?.reasoningEfforts) ? config.reasoningEfforts : [];',
    '  if (!supported.length) {',
    '    return clean;',
    '  }',
    '  if (clean && supported.includes(clean)) {',
    '    return clean;',
    '  }',
    '  return \'\';',
    '}',
    '',
    'function providerLabelForId(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.label || \'\';',
    '}',
    '',
    'function modelPlaceholderForProvider(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.modelPlaceholder || \'\';',
    '}',
    '',
    'function apiKeyPlaceholderForProvider(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.apiKeyPlaceholder || \'\';',
    '}',
    '',
    'function providerRequiresApiKey(provider, endpoint = \'\') {',
    '  return getLlmProviderConfig(provider, endpoint)?.requiresApiKey !== false;',
    '}',
    '',
    exportBlock,
    ''
  ].join('\n');
}

async function buildLlmProviderModules() {
  const catalog = normalizeLlmProviderCatalog(await readJson(CODEX_MODEL_CONFIG_PATH));
  await writeText(
    MAIN_LLM_PROVIDER_MODULE_OUTPUT,
    buildLlmProviderModuleSource({ catalog, moduleType: 'cjs' })
  );
  await writeText(
    RENDERER_LLM_PROVIDER_MODULE_OUTPUT,
    buildLlmProviderModuleSource({ catalog, moduleType: 'esm' })
  );
  return [MAIN_LLM_PROVIDER_MODULE_OUTPUT, RENDERER_LLM_PROVIDER_MODULE_OUTPUT];
}

export {
  buildLlmProviderModules
};
