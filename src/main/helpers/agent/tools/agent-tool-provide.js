'use strict';

const {
  AGENT_TOOL_CATALOG,
  getToolInputSchemas,
  resolveCanonicalToolName
} = require('./agent-tool-loading.js');

function freezeToolScope(toolNames = []) {
  return Object.freeze(toolNames.slice());
}

const REASONING_ENTRY_TOOL_SCOPES = Object.freeze({
  science_reasoning_entry: Object.freeze({
    general_science_question: freezeToolScope([
      'literature-search',
      'web-search',
      'paper-analysis',
      'protocol-generation',
      'python-sandbox'
    ]),
    project_science_question: freezeToolScope([
      'record-lookup',
      'inventory-lookup',
      'literature-search',
      'web-search',
      'paper-analysis',
      'protocol-generation',
      'python-sandbox'
    ]),
    result_analysis: freezeToolScope([
      'python-sandbox',
      'record-lookup',
      'inventory-lookup',
      'literature-search',
      'web-search',
      'paper-analysis'
    ])
  }),
  deep_research_entry: Object.freeze({
    general_science_question: freezeToolScope([
      'literature-search',
      'web-search',
      'paper-download',
      'paper-analysis',
      'protocol-generation',
      'sub-agent',
      'python-sandbox'
    ]),
    project_science_question: freezeToolScope([
      'record-lookup',
      'inventory-lookup',
      'literature-search',
      'web-search',
      'paper-download',
      'paper-analysis',
      'protocol-generation',
      'sub-agent',
      'python-sandbox'
    ]),
    result_analysis: freezeToolScope([
      'python-sandbox',
      'record-lookup',
      'inventory-lookup',
      'literature-search',
      'web-search',
      'paper-analysis',
      'sub-agent'
    ])
  })
});

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function defaultUniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  defaultAsArray(values).forEach((value) => {
    const normalized = defaultCleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function defaultListCatalogToolNames() {
  return AGENT_TOOL_CATALOG.map((entry) => entry.name);
}

function createAgentToolProviderRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const uniqueStrings = typeof deps.uniqueStrings === 'function' ? deps.uniqueStrings : defaultUniqueStrings;
  const listCatalogToolNames = typeof deps.listCatalogToolNames === 'function'
    ? deps.listCatalogToolNames
    : defaultListCatalogToolNames;
  const resolveCanonicalName = typeof deps.resolveCanonicalToolName === 'function'
    ? deps.resolveCanonicalToolName
    : resolveCanonicalToolName;
  const entryToolScopes = deps.entryToolScopes && typeof deps.entryToolScopes === 'object'
    ? deps.entryToolScopes
    : REASONING_ENTRY_TOOL_SCOPES;
  const getModelToolDefinitions = typeof deps.getModelToolDefinitions === 'function'
    ? deps.getModelToolDefinitions
    : ((selectedToolNames = []) => getToolInputSchemas(selectedToolNames).map((tool) => ({
      name: cleanText(tool?.name, 120),
      description: cleanText(tool?.description, 500),
      short_description: cleanText(tool?.description, 500),
      detailed_description: cleanText(tool?.detailed_description, 2400),
      parameters: tool?.input_schema && typeof tool.input_schema === 'object'
        ? tool.input_schema
        : { type: 'object', additionalProperties: true, properties: {} }
    })));

  function normalizeRequestedToolNames(values, max = 20) {
    const seen = new Set();
    const out = [];
    asArray(values).forEach((value) => {
      const canonicalName = cleanText(resolveCanonicalName(value), 120);
      if (!canonicalName) {
        return;
      }
      const key = canonicalName.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(canonicalName);
    });
    return out;
  }

  function resolveEntryToolNames({
    entryPoint = 'science_reasoning_entry',
    intent = '',
    requestedToolNames = null
  } = {}) {
    if (Array.isArray(requestedToolNames)) {
      return normalizeRequestedToolNames(requestedToolNames, 20);
    }
    const normalizedEntryPoint = cleanText(entryPoint, 80);
    const normalizedIntent = cleanText(intent, 80);
    const entryScopes = entryToolScopes[normalizedEntryPoint] || {};
    if (Object.prototype.hasOwnProperty.call(entryScopes, normalizedIntent)) {
      const scopedToolNames = normalizeRequestedToolNames(entryScopes[normalizedIntent], 20);
      return scopedToolNames;
    }
    return uniqueStrings(normalizeRequestedToolNames(listCatalogToolNames(), 40), 40);
  }

  function provideToolDefinitions(input = {}) {
    const toolNames = resolveEntryToolNames(input);
    return getModelToolDefinitions(toolNames);
  }

  function provideTools(input = {}) {
    const tool_names = resolveEntryToolNames(input);
    return {
      tool_names,
      tool_definitions: provideToolDefinitions({
        ...input,
        requestedToolNames: tool_names
      })
    };
  }

  return {
    resolveEntryToolNames,
    provideToolDefinitions,
    provideTools
  };
}

module.exports = {
  REASONING_ENTRY_TOOL_SCOPES,
  createAgentToolProviderRuntime
};
