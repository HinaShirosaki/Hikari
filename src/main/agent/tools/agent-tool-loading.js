'use strict';

const RAW_AGENT_TOOL_CATALOG = require('./Tools.json');
const RAW_AGENT_TOOL_CALL_CATALOG = require('./Tool-call.json');
const { cloneJson } = require('../../lib/normalize.js');
const { validateAgentToolCallCatalog, validateAgentToolCatalog } = require('./tool-loading/catalog-validation.js');
const { defaultAsArray, defaultCleanText, defaultEnsureObject, extractInlineToolArguments, normalizeJsonPayload, normalizeToolInvocationArgs } = require('./tool-loading/json-args.js');
const { validateValueAgainstSchema } = require('./tool-loading/schema-validation.js');

// Frozen validated catalogs exposed to the rest of the app.
const AGENT_TOOL_CATALOG = Object.freeze(
  validateAgentToolCatalog(cloneJson(RAW_AGENT_TOOL_CATALOG, []))
);
const AGENT_TOOL_CALL_CATALOG = Object.freeze(
  validateAgentToolCallCatalog(cloneJson(RAW_AGENT_TOOL_CALL_CATALOG, {}), AGENT_TOOL_CATALOG)
);

// Case-insensitive lookup map so callers can resolve canonical tool names reliably.
const AGENT_TOOL_NAME_MAP = new Map(
  AGENT_TOOL_CATALOG.map((entry) => [entry.name.toLowerCase(), entry.name])
);

// Map a user/model-provided tool name to the canonical catalog entry.
function resolveCanonicalToolName(value) {
  const normalized = defaultCleanText(value).toLowerCase();
  return normalized ? (AGENT_TOOL_NAME_MAP.get(normalized) || '') : '';
}

// Retrieve the normalized tool metadata entry for a tool name.
function getToolCatalogEntry(toolName) {
  const canonicalName = resolveCanonicalToolName(toolName);
  return AGENT_TOOL_CATALOG.find((entry) => entry.name === canonicalName) || null;
}

// Normalize requested tool names, defaulting to the full catalog when none are supplied.
function normalizeRequestedToolNames(selectedToolNames) {
  if (!Array.isArray(selectedToolNames)) {
    return AGENT_TOOL_CATALOG.map((entry) => entry.name);
  }
  if (!selectedToolNames.length) {
    return AGENT_TOOL_CATALOG.map((entry) => entry.name);
  }
  return selectedToolNames.map((toolName) => {
    const canonicalName = resolveCanonicalToolName(toolName);
    if (!canonicalName) {
      throw new Error(`Unknown tool "${defaultCleanText(toolName) || 'unknown'}".`);
    }
    return canonicalName;
  });
}

// Return prompt-friendly tool metadata plus deep-cloned input schemas for selected tools.
function getToolInputSchemas(selectedToolNames = null) {
  return normalizeRequestedToolNames(selectedToolNames).map((toolName) => {
    const entry = getToolCatalogEntry(toolName);
    const schemaEntry = defaultEnsureObject(AGENT_TOOL_CALL_CATALOG[toolName]);
    if (!entry || !schemaEntry.input_schema) {
      throw new Error(`Tool schema for "${toolName}" is not available.`);
    }
    return {
      name: entry.name,
      description: entry.description,
      detailed_description: defaultCleanText(schemaEntry.description),
      input_schema: cloneJson(schemaEntry.input_schema, {})
    };
  });
}

// Convert the recent conversation window into a compact numbered prompt block.
function buildConversationPromptBlock(conversation) {
  return defaultAsArray(conversation)
    .slice(-8)
    .map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = defaultCleanText(row?.text);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

// Build the prompt that asks the model to choose the minimum ordered tool list.
function buildToolSelectionPrompt({
  message = '',
  conversation = [],
  parserPayload = {},
  projectName = ''
} = {}) {
  const toolRows = AGENT_TOOL_CATALOG.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  const conversationBlock = buildConversationPromptBlock(conversation);
  const promptRows = [
    'Select the minimum ordered list of agent tools needed to satisfy the current request.',
    'Use only tools from the catalog below.',
    'Return JSON only in the shape {"tool_calls":[{"tool_name":"<tool-name>","rationale":"..."}],"reasoning_summary":"..."}',
    'Reject duplicate tools and unknown tools.',
    `Available tools:\n${toolRows}`,
    projectName ? `Active project context: ${defaultCleanText(projectName)}` : '',
    conversationBlock ? `Recent conversation:\n${conversationBlock}` : '',
    `User message: ${defaultCleanText(message)}`,
    `Parser payload JSON:\n${JSON.stringify(defaultEnsureObject(parserPayload), null, 2)}`
  ].filter(Boolean);
  return promptRows.join('\n\n');
}

// Validate the model's tool-selection response and normalize it into canonical tool names.
function normalizeToolSelectionPayload(rawPayload) {
  const payload = normalizeJsonPayload(rawPayload, {});
  const rawToolCalls = defaultAsArray(payload.tool_calls);
  if (!rawToolCalls.length) {
    return {
      ok: false,
      error: 'Tool selection must include at least one tool call.'
    };
  }

  const seen = new Set();
  const toolCalls = [];
  for (const item of rawToolCalls) {
    const source = typeof item === 'string' ? { tool_name: item } : defaultEnsureObject(item);
    const toolName = resolveCanonicalToolName(source.tool_name || source.name);
    if (!toolName) {
      return {
        ok: false,
        error: `Unknown tool in selection payload: ${defaultCleanText(source.tool_name || source.name) || 'unknown'}.`
      };
    }
    const dedupeKey = toolName.toLowerCase();
    if (seen.has(dedupeKey)) {
      return {
        ok: false,
        error: `Tool selection contains duplicate tool "${toolName}".`
      };
    }
    seen.add(dedupeKey);
    toolCalls.push({
      tool_name: toolName,
      ...(defaultCleanText(source.rationale) ? { rationale: defaultCleanText(source.rationale) } : {})
    });
  }

  return {
    ok: true,
    payload: {
      tool_calls: toolCalls,
      reasoning_summary: defaultCleanText(payload.reasoning_summary)
    }
  };
}

// Build the prompt that asks the model to generate validated argument objects for each tool.
function buildToolArgumentsPrompt({
  message = '',
  conversation = [],
  parserPayload = {},
  selectedToolNames = []
} = {}) {
  const selectedSchemas = getToolInputSchemas(selectedToolNames);
  const conversationBlock = buildConversationPromptBlock(conversation);
  const schemaRows = selectedSchemas.map((tool) => (
    [
      `Tool: ${tool.name}`,
      `Short description: ${tool.description}`,
      tool.detailed_description ? `Detailed usage: ${tool.detailed_description}` : '',
      `Input schema JSON:\n${JSON.stringify(tool.input_schema, null, 2)}`
    ].filter(Boolean).join('\n')
  )).join('\n\n');
  const toolNameRows = selectedSchemas.map((tool) => tool.name).join(', ');
  const promptRows = [
    'Produce one arguments object for each selected tool in the same order.',
    'Return JSON only in the shape {"tool_calls":[{"tool_name":"<tool-name>","arguments":{...}}]}.',
    'Arguments must validate against the provided JSON schema for that tool.',
    `Selected tools in order: ${toolNameRows}`,
    schemaRows,
    conversationBlock ? `Recent conversation:\n${conversationBlock}` : '',
    `User message: ${defaultCleanText(message)}`,
    `Parser payload JSON:\n${JSON.stringify(defaultEnsureObject(parserPayload), null, 2)}`
  ].filter(Boolean);
  return promptRows.join('\n\n');
}

// Normalize and schema-validate the model's generated tool arguments payload.
function normalizeToolArgumentsPayload(rawPayload, options = {}) {
  const payload = normalizeJsonPayload(rawPayload, {});
  const rawToolCalls = defaultAsArray(payload.tool_calls);
  let selectedToolNames = [];
  try {
    selectedToolNames = Array.isArray(options.selectedToolNames) && options.selectedToolNames.length
      ? normalizeRequestedToolNames(options.selectedToolNames)
      : [];
  } catch (error) {
    return {
      ok: false,
      error: defaultCleanText(error?.message || error) || 'Selected tool names are invalid.'
    };
  }
  if (!rawToolCalls.length) {
    return {
      ok: false,
      error: 'Tool arguments payload must include at least one tool call.'
    };
  }

  const seen = new Set();
  const toolCalls = [];
  for (let index = 0; index < rawToolCalls.length; index += 1) {
    const source = defaultEnsureObject(rawToolCalls[index]);
    const toolName = resolveCanonicalToolName(source.tool_name || source.name);
    if (!toolName) {
      return {
        ok: false,
        error: `Unknown tool in arguments payload at index ${index}.`
      };
    }
    if (selectedToolNames.length && toolName !== selectedToolNames[index]) {
      return {
        ok: false,
        error: `Tool arguments order mismatch at index ${index}; expected "${selectedToolNames[index]}" and received "${toolName}".`
      };
    }
    const dedupeKey = toolName.toLowerCase();
    if (seen.has(dedupeKey)) {
      return {
        ok: false,
        error: `Tool arguments payload contains duplicate tool "${toolName}".`
      };
    }
    seen.add(dedupeKey);

    const argumentsPayload = normalizeToolInvocationArgs(
      Object.prototype.hasOwnProperty.call(source, 'arguments')
        ? source.arguments
        : extractInlineToolArguments(source)
    );
    const schemaEntry = defaultEnsureObject(AGENT_TOOL_CALL_CATALOG[toolName]);
    const validation = validateValueAgainstSchema(
      defaultEnsureObject(argumentsPayload),
      schemaEntry.input_schema,
      AGENT_TOOL_CALL_CATALOG,
      `${toolName}.arguments`
    );
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error
      };
    }
    toolCalls.push({
      tool_name: toolName,
      arguments: cloneJson(defaultEnsureObject(argumentsPayload), {})
    });
  }

  if (selectedToolNames.length && toolCalls.length !== selectedToolNames.length) {
    return {
      ok: false,
      error: `Expected ${selectedToolNames.length} tool argument blocks, received ${toolCalls.length}.`
    };
  }

  return {
    ok: true,
    payload: {
      tool_calls: toolCalls
    }
  };
}

module.exports = {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_CALL_CATALOG,
  validateAgentToolCatalog,
  validateAgentToolCallCatalog,
  resolveCanonicalToolName,
  normalizeToolInvocationArgs,
  getToolInputSchemas,
  buildToolSelectionPrompt,
  normalizeToolSelectionPayload,
  buildToolArgumentsPrompt,
  normalizeToolArgumentsPayload
};
