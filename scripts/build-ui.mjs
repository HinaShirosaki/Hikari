#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const LLM_PROVIDER_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'llm-providers.json');
const HTML_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'html-order.json');
const CSS_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'css-order.json');
const APP_REGISTRY_PATH = path.join(ROOT_DIR, 'ui', 'config', 'app-registry.json');
const APP_REGISTRY_MODULE_OUTPUT = 'src/renderer/modules/app-registry.generated.js';
const MAIN_LLM_PROVIDER_MODULE_OUTPUT = 'src/main/generated/llm-provider-config.generated.js';
const RENDERER_LLM_PROVIDER_MODULE_OUTPUT = 'src/renderer/modules/llm-provider-config.generated.js';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readText(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return fs.readFile(absolutePath, 'utf8');
}

async function writeText(relativePath, contents) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents.replace(/\r\n/g, '\n'), 'utf8');
}

function toConstKey(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return normalized || 'UNKNOWN';
}

function ensureLlmProviderCatalogShape(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('llm-providers.json must export an object');
  }
  const defaultProvider = String(catalog.defaultProvider || '').trim().toLowerCase();
  if (!defaultProvider) {
    throw new Error('llm-providers.json requires a non-empty "defaultProvider"');
  }
  if (!Array.isArray(catalog.providers) || !catalog.providers.length) {
    throw new Error('llm-providers.json requires a non-empty "providers" array');
  }
}

function normalizeLlmProviderCatalog(catalog) {
  ensureLlmProviderCatalogShape(catalog);
  const defaultProvider = String(catalog.defaultProvider || '').trim().toLowerCase();
  const seenIds = new Set();
  const providers = catalog.providers.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid LLM provider entry at index ${index}`);
    }
    const id = String(entry.id || '').trim().toLowerCase();
    const label = String(entry.label || '').trim();
    const defaultEndpoint = String(entry.defaultEndpoint || '').trim();
    const defaultModel = String(entry.defaultModel || '').trim();
    const modelPlaceholder = String(entry.modelPlaceholder || '').trim();
    const apiKeyPlaceholder = String(entry.apiKeyPlaceholder || '').trim();
    const endpointHints = Array.isArray(entry.endpointHints)
      ? entry.endpointHints.map((hint) => String(hint || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const models = Array.isArray(entry.models)
      ? entry.models.map((modelEntry, modelIndex) => {
        if (!modelEntry || typeof modelEntry !== 'object' || Array.isArray(modelEntry)) {
          throw new Error(`Invalid model entry at index ${modelIndex} for LLM provider "${id || index}"`);
        }
        const modelId = String(modelEntry.id || '').trim();
        const modelLabel = String(modelEntry.label || '').trim();
        const reasoningEfforts = Array.isArray(modelEntry.reasoningEfforts)
          ? modelEntry.reasoningEfforts.map((effort) => String(effort || '').trim().toLowerCase()).filter(Boolean)
          : [];
        const defaultReasoningEffort = String(modelEntry.defaultReasoningEffort || '').trim().toLowerCase();

        if (!modelId || !modelLabel) {
          throw new Error(`Model entry at index ${modelIndex} for LLM provider "${id || index}" is missing a required field`);
        }
        if (defaultReasoningEffort && !reasoningEfforts.includes(defaultReasoningEffort)) {
          throw new Error(`Model "${modelId}" for LLM provider "${id || index}" has defaultReasoningEffort outside reasoningEfforts`);
        }

        return {
          id: modelId,
          label: modelLabel,
          reasoningEfforts,
          defaultReasoningEffort
        };
      })
      : [];

    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      throw new Error(`LLM provider at index ${index} requires a lowercase "id" using letters, numbers, or dashes`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate LLM provider id in llm-providers.json: ${id}`);
    }
    const requiresApiKey = entry.requiresApiKey !== false;
    const allowsEmptyEndpoint = id === 'codex' && !requiresApiKey;
    if (!label || (!defaultEndpoint && !allowsEmptyEndpoint) || !modelPlaceholder || !apiKeyPlaceholder) {
      throw new Error(`LLM provider "${id}" is missing a required field`);
    }

    seenIds.add(id);

    return {
      id,
      key: toConstKey(id),
      label,
      defaultEndpoint,
      defaultModel,
      modelPlaceholder,
      apiKeyPlaceholder,
      requiresApiKey,
      endpointHints,
      models
    };
  });

  if (!seenIds.has(defaultProvider)) {
    throw new Error(`defaultProvider "${defaultProvider}" does not match any provider id`);
  }

  return {
    defaultProvider,
    providers
  };
}

function buildLlmProviderModuleSource({ catalog, moduleType }) {
  const sourcePath = toPosix(path.relative(ROOT_DIR, LLM_PROVIDER_CONFIG_PATH));
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
      '  DEFAULT_LLM_ENDPOINTS,',
      '  DEFAULT_AGENT_MODELS,',
      '  inferLlmProviderFromEndpoint,',
      '  normalizeLlmProvider,',
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
      '  DEFAULT_LLM_ENDPOINTS,',
      '  DEFAULT_AGENT_MODELS,',
      '  inferLlmProviderFromEndpoint,',
      '  normalizeLlmProvider,',
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
  const catalog = normalizeLlmProviderCatalog(await readJson(LLM_PROVIDER_CONFIG_PATH));
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

function ensureAppRegistryShape(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('app-registry.json must export an object');
  }
  if (!Array.isArray(registry.apps) || !registry.apps.length) {
    throw new Error('app-registry.json requires a non-empty "apps" array');
  }
  if (!Array.isArray(registry.dockOrder) || !registry.dockOrder.length) {
    throw new Error('app-registry.json requires a non-empty "dockOrder" array');
  }
}

async function buildAppRegistry(validViewIds) {
  const registry = await readJson(APP_REGISTRY_PATH);
  ensureAppRegistryShape(registry);

  const seenIds = new Set();
  const seenViewIds = new Set();
  const seenIcons = new Set();
  const dockApps = [];
  const normalizedApps = [];

  for (const [index, rawApp] of registry.apps.entries()) {
    if (!rawApp || typeof rawApp !== 'object' || Array.isArray(rawApp)) {
      throw new Error(`Invalid app entry at index ${index} in app-registry.json`);
    }
    const id = String(rawApp.id || '').trim();
    const label = String(rawApp.label || '').trim();
    const viewId = String(rawApp.viewId || '').trim();
    const icon = String(rawApp.icon || '').trim();
    const placement = String(rawApp.placement || '').trim();
    const aliases = Array.isArray(rawApp.aliases)
      ? rawApp.aliases.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const searchInputId = String(rawApp.searchInputId || '').trim();
    const agentChatRail = rawApp.agentChatRail === true;
    const hiddenFromNavigation = rawApp.hiddenFromNavigation === true;

    if (!id || !label || !viewId || !icon || !placement) {
      throw new Error(`App entry "${id || `index ${index}`}" is missing a required field`);
    }
    if (placement !== 'dock' && placement !== 'more') {
      throw new Error(`App "${id}" has unsupported placement "${placement}"`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate app id in app-registry.json: ${id}`);
    }
    if (seenViewIds.has(viewId)) {
      throw new Error(`Duplicate app viewId in app-registry.json: ${viewId}`);
    }
    if (seenIcons.has(icon)) {
      throw new Error(`Duplicate app icon in app-registry.json: ${icon}`);
    }
    if (!validViewIds.has(viewId)) {
      throw new Error(`App "${id}" references unknown viewId "${viewId}"`);
    }

    const iconPath = path.join(ROOT_DIR, 'assets', 'icons', icon);
    let iconMarkup = '';
    try {
      await fs.access(iconPath);
      iconMarkup = (await fs.readFile(iconPath, 'utf8')).trim();
    } catch {
      throw new Error(`App "${id}" references missing icon "${iconPath}"`);
    }

    seenIds.add(id);
    seenViewIds.add(viewId);
    seenIcons.add(icon);

    const app = {
      id,
      label,
      viewId,
      icon,
      iconMarkup,
      placement,
      aliases,
      searchInputId,
      agentChatRail,
      hiddenFromNavigation
    };
    if (placement === 'dock') {
      dockApps.push(id);
    }
    normalizedApps.push(app);
  }

  const dockOrder = registry.dockOrder.map((value) => String(value || '').trim()).filter(Boolean);
  if (dockOrder.length !== dockApps.length) {
    throw new Error('dockOrder length must match the number of apps with placement "dock"');
  }
  const dockAppSet = new Set(dockApps);
  dockOrder.forEach((id) => {
    if (!seenIds.has(id)) {
      throw new Error(`dockOrder references unknown app id "${id}"`);
    }
    if (!dockAppSet.has(id)) {
      throw new Error(`dockOrder references app "${id}" but its placement is not "dock"`);
    }
  });
  dockApps.forEach((id) => {
    if (!dockOrder.includes(id)) {
      throw new Error(`App "${id}" is placed in the dock but missing from dockOrder`);
    }
  });

  const generated = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, APP_REGISTRY_PATH))} */`,
    '',
    `export const APP_REGISTRY = ${JSON.stringify(normalizedApps, null, 2)};`,
    '',
    `export const APP_DOCK_ORDER = ${JSON.stringify(dockOrder, null, 2)};`,
    ''
  ].join('\n');

  await writeText(APP_REGISTRY_MODULE_OUTPUT, generated);
  return normalizedApps;
}

function collectHtmlIds(htmlText) {
  const idCounts = new Map();
  const idRegex = /\bid="([^"]+)"/g;
  let match = idRegex.exec(htmlText);
  while (match) {
    const id = match[1];
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
    match = idRegex.exec(htmlText);
  }
  return idCounts;
}

function ensureViewBlock({ id, file, contents }) {
  const expected = new RegExp(`<section\\s+id="${id}"`);
  if (!expected.test(contents)) {
    throw new Error(`View file ${file} does not contain expected section id: ${id}`);
  }
}

async function buildHtml() {
  const config = await readJson(HTML_CONFIG_PATH);
  const validViewIds = new Set((config.views || []).map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  await buildAppRegistry(validViewIds);
  const shellStart = await readText(config.shellStart);
  const shellEnd = await readText(config.shellEnd);

  const viewParts = [];
  const seenViewIds = new Set();

  for (const entry of config.views || []) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid view entry in html-order.json');
    }
    const { id, file } = entry;
    if (!id || !file) {
      throw new Error('Each html view entry requires id and file');
    }
    if (seenViewIds.has(id)) {
      throw new Error(`Duplicate view id in html-order.json: ${id}`);
    }
    seenViewIds.add(id);
    const contents = await readText(file);
    ensureViewBlock({ id, file, contents });
    viewParts.push(`<!-- SOURCE: ${file} -->\n${contents.trimEnd()}\n`);
  }

  const autoHeader = [
    '<!-- AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. -->',
    `<!-- Source config: ${toPosix(path.relative(ROOT_DIR, HTML_CONFIG_PATH))} -->`,
    ''
  ].join('\n');

  const html = `${autoHeader}${shellStart.trimEnd()}\n${viewParts.join('\n')}${shellEnd.trimStart()}`;

  const idCounts = collectHtmlIds(html);
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1);
  if (duplicateIds.length) {
    const message = duplicateIds.map(([id, count]) => `${id} (${count})`).join(', ');
    throw new Error(`Duplicate HTML id attributes detected: ${message}`);
  }

  const missingViews = [...seenViewIds].filter((id) => !idCounts.has(id));
  if (missingViews.length) {
    throw new Error(`Generated HTML is missing required view ids: ${missingViews.join(', ')}`);
  }

  await writeText(config.output, html.endsWith('\n') ? html : `${html}\n`);
  return config.output;
}

async function buildCss() {
  const config = await readJson(CSS_CONFIG_PATH);
  const inputs = config.inputs || [];
  const seen = new Set();
  const importLines = [];

  for (const file of inputs) {
    if (!file || typeof file !== 'string') {
      throw new Error('Each CSS input entry must be a non-empty string');
    }
    if (seen.has(file)) {
      throw new Error(`Duplicate CSS input entry in css-order.json: ${file}`);
    }
    seen.add(file);

    // Validate source CSS exists/readable.
    await readText(file);

    const relativeImport = toPosix(path.relative(path.dirname(config.output), file));
    const importPath = relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`;
    importLines.push(`@import url("${importPath}");`);
  }

  const cssHeader = [
    '/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */',
    `/* Source config: ${toPosix(path.relative(ROOT_DIR, CSS_CONFIG_PATH))} */`,
    '/* Intentionally kept as an import manifest to reduce merge conflicts across branches. */',
    ''
  ].join('\n');

  const css = `${cssHeader}${importLines.join('\n')}\n`;
  await writeText(config.output, css.endsWith('\n') ? css : `${css}\n`);
  return config.output;
}

async function main() {
  const llmProviderOutputs = await buildLlmProviderModules();
  const htmlOutput = await buildHtml();
  const cssOutput = await buildCss();
  console.log(`Built ${[...llmProviderOutputs, htmlOutput, cssOutput].join(', ')}`);
}

main().catch((error) => {
  console.error('[build-ui] Failed:', error?.message || error);
  process.exit(1);
});
