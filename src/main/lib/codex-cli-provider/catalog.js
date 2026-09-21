'use strict';

const fsSync = require('node:fs');
const path = require('node:path');
const {
  CODEX_CONFIG_FILE,
  CODEX_MODELS_CACHE_FILE
} = require('./constants');
const {
  getCodexCliCandidateHomeDirectories,
  getCodexCliHomeDirectory
} = require('./paths');
const { cleanText } = require('./utils');

let configuredCodexModel = '';
let configuredCodexReasoningEffort = '';

function normalizeCodexCliModel(model = '') {
  return String(cleanText(model, 120) || '').trim();
}

function normalizeCodexCliReasoningEffort(reasoningEffort = '') {
  return String(cleanText(reasoningEffort, 40) || '').trim().toLowerCase();
}

function parseCodexCliModelsCache(rawValue = '') {
  try {
    const parsed = JSON.parse(String(rawValue || ''));
    const models = Array.isArray(parsed?.models)
      ? parsed.models.map((entry) => {
        const id = cleanText(entry?.slug, 120);
        const label = cleanText(entry?.display_name, 160) || id;
        const reasoningEfforts = Array.isArray(entry?.supported_reasoning_levels)
          ? entry.supported_reasoning_levels
            .map((level) => normalizeCodexCliReasoningEffort(level?.effort))
            .filter(Boolean)
          : [];
        const defaultReasoningEffort = normalizeCodexCliReasoningEffort(entry?.default_reasoning_level);
        if (!id) {
          return null;
        }
        return {
          id,
          label,
          reasoningEfforts,
          defaultReasoningEffort: reasoningEfforts.includes(defaultReasoningEffort) ? defaultReasoningEffort : ''
        };
      }).filter(Boolean)
      : [];
    return {
      models,
      fetchedAt: cleanText(parsed?.fetched_at, 80),
      clientVersion: cleanText(parsed?.client_version, 80)
    };
  } catch {
    return {
      models: [],
      fetchedAt: '',
      clientVersion: ''
    };
  }
}

function parseCodexCliConfigDefaults(rawValue = '') {
  const source = String(rawValue || '');
  const modelMatch = source.match(/^\s*model\s*=\s*"([^"]+)"/m);
  const reasoningMatch = source.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
  return {
    defaultModel: normalizeCodexCliModel(modelMatch?.[1] || ''),
    defaultReasoningEffort: normalizeCodexCliReasoningEffort(reasoningMatch?.[1] || '')
  };
}

function findCodexCliModelConfig(model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : null;
  const models = Array.isArray(resolvedCatalog?.models) ? resolvedCatalog.models : [];
  const target = normalizeCodexCliModel(model);
  if (!target) {
    return null;
  }
  return models.find((entry) => entry.id === target) || null;
}

function getCodexCliCatalog() {
  const { cacheInfo, modelsCachePath } = readCatalogFile(CODEX_MODELS_CACHE_FILE, parseCodexCliModelsCache, {
    models: [],
    fetchedAt: '',
    clientVersion: ''
  });
  const { cacheInfo: configDefaults, modelsCachePath: configPath } = readCatalogFile(CODEX_CONFIG_FILE, parseCodexCliConfigDefaults, {
    defaultModel: '',
    defaultReasoningEffort: ''
  });
  const codexHome = path.dirname(modelsCachePath || configPath) || getCodexCliHomeDirectory();
  const models = cacheInfo.models;
  const fallbackModel = models[0]?.id || '';
  const defaultModel = findCodexCliModelConfig(configDefaults.defaultModel, { models })?.id
    || findCodexCliModelConfig(configuredCodexModel, { models })?.id
    || fallbackModel
    || configDefaults.defaultModel
    || configuredCodexModel
    || '';
  const defaultModelConfig = findCodexCliModelConfig(defaultModel, { models });
  const defaultReasoningEffort = defaultModelConfig?.reasoningEfforts?.includes(configDefaults.defaultReasoningEffort)
    ? configDefaults.defaultReasoningEffort
    : defaultModelConfig?.reasoningEfforts?.includes(configuredCodexReasoningEffort)
      ? configuredCodexReasoningEffort
      : defaultModelConfig?.defaultReasoningEffort
        || defaultModelConfig?.reasoningEfforts?.[0]
        || configDefaults.defaultReasoningEffort
        || configuredCodexReasoningEffort
        || '';

  return {
    ok: models.length > 0,
    codexHome,
    modelsCachePath,
    configPath,
    fetchedAt: cacheInfo.fetchedAt,
    clientVersion: cacheInfo.clientVersion,
    defaultModel,
    defaultReasoningEffort,
    models
  };
}

function readCatalogFile(fileName, parser, fallback) {
  let cacheInfo = fallback;
  let modelsCachePath = path.join(getCodexCliHomeDirectory(), fileName);
  for (const homeDirectory of getCodexCliCandidateHomeDirectories()) {
    const candidatePath = path.join(homeDirectory, fileName);
    try {
      cacheInfo = parser(fsSync.readFileSync(candidatePath, 'utf8'));
      modelsCachePath = candidatePath;
      break;
    } catch {
      // Continue scanning fallbacks.
    }
  }
  return { cacheInfo, modelsCachePath };
}

function getCodexCliModel() {
  return configuredCodexModel;
}

function setCodexCliModel(model = '') {
  const cleanModel = normalizeCodexCliModel(model);
  if (!cleanModel) {
    configuredCodexModel = '';
    return configuredCodexModel;
  }
  const catalog = getCodexCliCatalog();
  configuredCodexModel = findCodexCliModelConfig(cleanModel, catalog)?.id
    || normalizeCodexCliModel(catalog.defaultModel)
    || cleanModel;
  return configuredCodexModel;
}

function getCodexCliReasoningEffort() {
  return configuredCodexReasoningEffort;
}

function setCodexCliReasoningEffort(reasoningEffort = '') {
  configuredCodexReasoningEffort = normalizeCodexCliReasoningEffort(reasoningEffort);
  return configuredCodexReasoningEffort;
}

function resolveCodexCliModel(model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : getCodexCliCatalog();
  const explicitModel = normalizeCodexCliModel(model);
  const explicitConfig = findCodexCliModelConfig(explicitModel, resolvedCatalog);
  if (explicitConfig?.id) {
    configuredCodexModel = explicitConfig.id;
    return explicitConfig.id;
  }
  const configuredConfig = findCodexCliModelConfig(configuredCodexModel, resolvedCatalog);
  if (configuredConfig?.id) {
    return configuredConfig.id;
  }
  if (!Array.isArray(resolvedCatalog.models) || !resolvedCatalog.models.length) {
    // No models_cache.json yet (fresh machine). A static name such as the app's
    // catalog seed can already be retired for ChatGPT accounts, so pass only a
    // model the user chose; without -m the CLI picks its own current default
    // and writes the cache for the next call.
    return configuredCodexModel;
  }
  return normalizeCodexCliModel(resolvedCatalog.defaultModel) || explicitModel || configuredCodexModel;
}

function resolveCodexCliReasoningEffort(reasoningEffort = '', model = '', catalog = null) {
  const resolvedCatalog = catalog && typeof catalog === 'object' ? catalog : getCodexCliCatalog();
  const resolvedModel = resolveCodexCliModel(model, resolvedCatalog);
  const modelConfig = findCodexCliModelConfig(resolvedModel, resolvedCatalog);
  const explicitEffort = normalizeCodexCliReasoningEffort(reasoningEffort);

  if (modelConfig?.reasoningEfforts?.length) {
    if (modelConfig.reasoningEfforts.includes(explicitEffort)) {
      return explicitEffort;
    }
    if (modelConfig.reasoningEfforts.includes(configuredCodexReasoningEffort)) {
      return configuredCodexReasoningEffort;
    }
    if (modelConfig.reasoningEfforts.includes(resolvedCatalog.defaultReasoningEffort)) {
      return resolvedCatalog.defaultReasoningEffort;
    }
    return modelConfig.defaultReasoningEffort || modelConfig.reasoningEfforts[0] || '';
  }

  return explicitEffort || configuredCodexReasoningEffort || normalizeCodexCliReasoningEffort(resolvedCatalog.defaultReasoningEffort);
}

module.exports = {
  findCodexCliModelConfig,
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  normalizeCodexCliModel,
  normalizeCodexCliReasoningEffort,
  resolveCodexCliModel,
  resolveCodexCliReasoningEffort,
  setCodexCliModel,
  setCodexCliReasoningEffort
};
