/**
 * Utilities for validating the agent tool catalog, building LLM prompts for
 * tool selection/argument generation, normalizing returned payloads, and
 * executing registered tool handlers through a small runtime wrapper.
 */
'use strict';

// Static catalog definitions loaded from JSON files.
const RAW_AGENT_TOOL_CATALOG = require('./Tools.json');
const RAW_AGENT_TOOL_CALL_CATALOG = require('./Tool-call.json');

// Return the input only when it is already an array; otherwise use an empty array fallback.
function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

// Convert unknown input to a trimmed string and cap its length for safe prompt/error usage.
function defaultCleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

// Keep only plain object-like values; everything else becomes an empty object.
function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Parse JSON safely and return a fallback instead of throwing on invalid payloads.
function safeParseJson(value, fallback = null) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Deep-clone JSON-safe data structures so downstream mutations do not affect source data.
function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

// Normalize a value into an object payload, accepting either raw objects or JSON strings.
function normalizeJsonPayload(value, fallback = {}) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = safeParseJson(value, null);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }
  return fallback;
}

// Accept several common argument wrapper shapes and extract the actual tool input object.
function normalizeToolInvocationArgs(rawArgs) {
  const payload = normalizeJsonPayload(rawArgs, {});
  if (payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)) {
    return payload.input;
  }
  if (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)) {
    return payload.args;
  }
  if (payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)) {
    return payload.arguments;
  }
  if (typeof payload.input_json === 'string') {
    return normalizeJsonPayload(payload.input_json, payload);
  }
  return payload;
}

// When arguments are embedded directly on the tool call object, strip metadata fields away.
function extractInlineToolArguments(source) {
  const payload = defaultEnsureObject(source);
  const inline = { ...payload };
  delete inline.tool_name;
  delete inline.name;
  delete inline.rationale;
  return inline;
}

// Check whether a value is a non-array object.
function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

// Resolve local JSON-schema $ref pointers such as `#/...` against the root schema object.
function resolveSchemaRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null;
  }
  return ref
    .slice(2)
    .split('/')
    .reduce((acc, keyPart) => {
      if (!acc || typeof acc !== 'object') {
        return null;
      }
      const key = keyPart.replace(/~1/g, '/').replace(/~0/g, '~');
      return acc[key];
    }, rootSchema);
}

// Format a readable schema path for validation error messages.
function formatSchemaPath(path, fallback = 'value') {
  const normalized = String(path || '').trim();
  return normalized || fallback;
}

// Perform lightweight recursive validation against the JSON schema shapes used by tool calls.
function validateValueAgainstSchema(value, schema, rootSchema, path = 'value') {
  // Resolve references first so nested definitions can be validated like inline schemas.
  const resolvedSchema = isPlainObject(schema) && typeof schema.$ref === 'string'
    ? resolveSchemaRef(schema.$ref, rootSchema)
    : schema;
  if (!isPlainObject(resolvedSchema)) {
    return {
      ok: false,
      error: `${formatSchemaPath(path)} references an invalid schema.`
    };
  }

  // Support union-like schemas by allowing any candidate branch to validate successfully.
  if (Array.isArray(resolvedSchema.anyOf) && resolvedSchema.anyOf.length) {
    const matches = resolvedSchema.anyOf.some((candidate) => validateValueAgainstSchema(value, candidate, rootSchema, path).ok);
    return matches
      ? { ok: true }
      : { ok: false, error: `${formatSchemaPath(path)} did not match any allowed schema.` };
  }

  // Normalize the schema type field into an array for consistent checking.
  const allowedTypes = Array.isArray(resolvedSchema.type)
    ? resolvedSchema.type
    : (typeof resolvedSchema.type === 'string' ? [resolvedSchema.type] : []);

  if (allowedTypes.length) {
    const typeMatches = allowedTypes.some((type) => {
      if (type === 'null') {
        return value === null;
      }
      if (type === 'array') {
        return Array.isArray(value);
      }
      if (type === 'integer') {
        return Number.isInteger(value);
      }
      if (type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
      }
      if (type === 'object') {
        return isPlainObject(value);
      }
      if (type === 'string') {
        return typeof value === 'string';
      }
      if (type === 'boolean') {
        return typeof value === 'boolean';
      }
      return true;
    });
    if (!typeMatches) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be of type ${allowedTypes.join(' or ')}.`
      };
    }
  }

  // Enforce enum constraints when the schema lists explicit allowed values.
  if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length) {
    const matchesEnum = resolvedSchema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value));
    if (!matchesEnum) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be one of the allowed enum values.`
      };
    }
  }

  // Apply string length constraints.
  if (typeof value === 'string') {
    if (Number.isFinite(Number(resolvedSchema.minLength)) && value.length < Number(resolvedSchema.minLength)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must have length >= ${Number(resolvedSchema.minLength)}.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maxLength)) && value.length > Number(resolvedSchema.maxLength)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must have length <= ${Number(resolvedSchema.maxLength)}.`
      };
    }
  }

  // Apply numeric range constraints.
  if (typeof value === 'number') {
    if (Number.isFinite(Number(resolvedSchema.minimum)) && value < Number(resolvedSchema.minimum)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be >= ${Number(resolvedSchema.minimum)}.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maximum)) && value > Number(resolvedSchema.maximum)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must be <= ${Number(resolvedSchema.maximum)}.`
      };
    }
  }

  // Validate array size and recursively validate each item when an item schema exists.
  if (Array.isArray(value)) {
    if (Number.isFinite(Number(resolvedSchema.minItems)) && value.length < Number(resolvedSchema.minItems)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must contain at least ${Number(resolvedSchema.minItems)} items.`
      };
    }
    if (Number.isFinite(Number(resolvedSchema.maxItems)) && value.length > Number(resolvedSchema.maxItems)) {
      return {
        ok: false,
        error: `${formatSchemaPath(path)} must contain at most ${Number(resolvedSchema.maxItems)} items.`
      };
    }
    if (resolvedSchema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateValueAgainstSchema(
          value[index],
          resolvedSchema.items,
          rootSchema,
          `${formatSchemaPath(path)}[${index}]`
        );
        if (!nested.ok) {
          return nested;
        }
      }
    }
    return { ok: true };
  }

  // Validate required object fields, declared properties, and additionalProperties behavior.
  if (isPlainObject(value)) {
    const properties = isPlainObject(resolvedSchema.properties) ? resolvedSchema.properties : {};
    const required = defaultAsArray(resolvedSchema.required);
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return {
          ok: false,
          error: `${formatSchemaPath(path)}.${key} is required.`
        };
      }
    }

    for (const [key, entryValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const nested = validateValueAgainstSchema(
          entryValue,
          properties[key],
          rootSchema,
          `${formatSchemaPath(path)}.${key}`
        );
        if (!nested.ok) {
          return nested;
        }
        continue;
      }

      if (resolvedSchema.additionalProperties === false) {
        return {
          ok: false,
          error: `${formatSchemaPath(path)}.${key} is not allowed.`
        };
      }

      if (isPlainObject(resolvedSchema.additionalProperties)) {
        const nested = validateValueAgainstSchema(
          entryValue,
          resolvedSchema.additionalProperties,
          rootSchema,
          `${formatSchemaPath(path)}.${key}`
        );
        if (!nested.ok) {
          return nested;
        }
      }
    }
  }

  return { ok: true };
}

// Validate and normalize the basic tool catalog loaded from `Tools.json`.
function validateAgentToolCatalog(catalog) {
  if (!Array.isArray(catalog)) {
    throw new Error('Agent tool catalog must be an array.');
  }

  const seen = new Set();
  return catalog.map((entry, index) => {
    const source = defaultEnsureObject(entry);
    const name = defaultCleanText(source.name, 120);
    const description = defaultCleanText(source.description, 400);
    if (!name) {
      throw new Error(`Agent tool catalog entry ${index + 1} is missing name.`);
    }
    if (!description) {
      throw new Error(`Agent tool catalog entry "${name}" is missing description.`);
    }
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) {
      throw new Error(`Agent tool catalog contains duplicate tool name "${name}".`);
    }
    seen.add(dedupeKey);
    return {
      name,
      description
    };
  });
}

// Validate per-tool call schemas and ensure they stay aligned with the main tool catalog.
function validateAgentToolCallCatalog(toolCallCatalog, toolCatalog = []) {
  const source = defaultEnsureObject(toolCallCatalog);
  const defs = defaultEnsureObject(source.$defs);
  const normalized = {
    $defs: cloneJson(defs, {})
  };
  const catalogNames = validateAgentToolCatalog(cloneJson(toolCatalog, [])).map((entry) => entry.name);
  const catalogNameSet = new Set(catalogNames.map((name) => name.toLowerCase()));
  const schemaEntryNames = Object.keys(source).filter((name) => name !== '$defs');

  catalogNames.forEach((toolName) => {
    if (!Object.prototype.hasOwnProperty.call(source, toolName)) {
      throw new Error(`Tool-call catalog is missing schema for "${toolName}".`);
    }
  });

  schemaEntryNames.forEach((toolName) => {
    if (!catalogNameSet.has(toolName.toLowerCase())) {
      throw new Error(`Tool-call catalog includes unknown tool "${toolName}".`);
    }
    const entry = defaultEnsureObject(source[toolName]);
    const description = defaultCleanText(entry.description, 2400);
    const inputSchema = defaultEnsureObject(entry.input_schema);
    if (!description) {
      throw new Error(`Tool-call schema for "${toolName}" is missing description.`);
    }
    if (inputSchema.type !== 'object') {
      throw new Error(`Tool-call schema for "${toolName}" must declare type "object".`);
    }
    normalized[toolName] = {
      description,
      input_schema: cloneJson(inputSchema, {})
    };
  });

  return normalized;
}

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
  const normalized = defaultCleanText(value, 120).toLowerCase();
  return normalized ? (AGENT_TOOL_NAME_MAP.get(normalized) || '') : '';
}

// Retrieve the normalized tool metadata entry for a tool name.
function getToolCatalogEntry(toolName) {
  const canonicalName = resolveCanonicalToolName(toolName);
  return AGENT_TOOL_CATALOG.find((entry) => entry.name === canonicalName) || null;
}

// Retrieve the normalized tool-call schema entry for a tool name.
function getToolCallCatalogEntry(toolName) {
  const canonicalName = resolveCanonicalToolName(toolName);
  return canonicalName ? defaultEnsureObject(AGENT_TOOL_CALL_CATALOG[canonicalName]) : null;
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
      throw new Error(`Unknown tool "${defaultCleanText(toolName, 120) || 'unknown'}".`);
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
      detailed_description: defaultCleanText(schemaEntry.description, 2400),
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
      const text = defaultCleanText(row?.text, 1200);
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
  const toolRows = AGENT_TOOL_CATALOG.map((tool) => {
    const schemaEntry = getToolCallCatalogEntry(tool.name);
    const detailedDescription = defaultCleanText(schemaEntry?.description, 2400);
    return [
      `- ${tool.name}: ${tool.description}`,
      detailedDescription ? `  Usage: ${detailedDescription}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n');
  const conversationBlock = buildConversationPromptBlock(conversation);
  const promptRows = [
    'Select the minimum ordered list of agent tools needed to satisfy the current request.',
    'Use only tools from the catalog below.',
    'Return JSON only in the shape {"tool_calls":[{"tool_name":"<tool-name>","rationale":"..."}],"reasoning_summary":"..."}',
    'Reject duplicate tools and unknown tools.',
    `Available tools:\n${toolRows}`,
    projectName ? `Active project context: ${defaultCleanText(projectName, 220)}` : '',
    conversationBlock ? `Recent conversation:\n${conversationBlock}` : '',
    `User message: ${defaultCleanText(message, 3200)}`,
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
        error: `Unknown tool in selection payload: ${defaultCleanText(source.tool_name || source.name, 120) || 'unknown'}.`
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
      ...(defaultCleanText(source.rationale, 320) ? { rationale: defaultCleanText(source.rationale, 320) } : {})
    });
  }

  return {
    ok: true,
    payload: {
      tool_calls: toolCalls,
      reasoning_summary: defaultCleanText(payload.reasoning_summary, 800)
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
    `User message: ${defaultCleanText(message, 3200)}`,
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
      error: defaultCleanText(error?.message || error, 320) || 'Selected tool names are invalid.'
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

// Deep-merge plain objects, replacing non-object branches with cloned override values.
function mergeObjects(baseValue, overrideValue) {
  const base = defaultEnsureObject(baseValue);
  const override = defaultEnsureObject(overrideValue);
  const out = cloneJson(base, {});
  Object.entries(override).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeObjects(out[key], value);
      return;
    }
    out[key] = cloneJson(value, value);
  });
  return out;
}

// Deduplicate a list of strings while preserving order and enforcing a maximum output size.
function uniqueStrings(values, max = 20) {
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

// Generate a short human-readable summary from a tool execution result.
function summarizeToolResult(toolName, result) {
  const source = defaultEnsureObject(result);
  if (defaultCleanText(source.summary, 320)) {
    return defaultCleanText(source.summary, 320);
  }
  if (defaultCleanText(source.status, 40)) {
    return defaultCleanText(
      `${toolName} status=${defaultCleanText(source.status, 40)}.`,
      320
    );
  }
  if (isPlainObject(source.selected_protocol)) {
    return defaultCleanText(
      `${toolName} selected ${defaultCleanText(source.selected_protocol?.name, 220) || 'a protocol'}.`,
      320
    );
  }
  if (Array.isArray(source.items)) {
    return defaultCleanText(
      `${toolName} returned ${defaultAsArray(source.items).length} items.`,
      320
    );
  }
  return `${toolName} completed.`;
}

// Wrap a tool execution result in a consistent envelope consumed by the runtime.
function buildExecutionEnvelope(toolName, input, result, options = {}) {
  const normalizedResult = cloneJson(result, result);
  const ok = options.ok !== false;
  const summary = defaultCleanText(
    options.summary,
    320
  ) || (ok ? summarizeToolResult(toolName, normalizedResult) : defaultCleanText(options.error, 320));
  return {
    ok,
    tool_name: defaultCleanText(toolName, 120),
    input: cloneJson(defaultEnsureObject(input), {}),
    result: normalizedResult,
    items: defaultAsArray(normalizedResult?.items),
    summary,
    generated_at: new Date().toISOString(),
    ...(defaultCleanText(options.error, 600) ? { error: defaultCleanText(options.error, 600) } : {})
  };
}

// Create a runtime that can register tool executors, validate tool calls, and execute them safely.
function createAgentToolCallRuntime(deps = {}) {
  // Allow core helpers to be dependency-injected while keeping sensible defaults.
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const createExecutionContext = typeof deps.createExecutionContext === 'function'
    ? deps.createExecutionContext
    : ((context = {}) => {
      const snapshot = ensureObject(context.snapshot);
      return {
        provider: cleanText(context.provider, 80),
        endpoint: cleanText(context.endpoint, 1600),
        apiKey: cleanText(context.apiKey, 400),
        model: cleanText(context.model, 120),
        message: cleanText(context.message, 3200),
        conversation: asArray(context.conversation),
        snapshot,
        parserPayload: ensureObject(context.parserPayload),
        dataFilePath: cleanText(context.dataFilePath || snapshot.data_file_path, 2000),
        fallbackDataFilePath: cleanText(context.fallbackDataFilePath, 2000),
        traceContext: context.traceContext || null,
        lifecycleRecorder: context.lifecycleRecorder || null,
        project: ensureObject(context.project),
        sandboxRoot: cleanText(context.sandboxRoot, 2000),
        preferredPythonBin: cleanText(context.preferredPythonBin, 320),
        pythonExecutable: cleanText(context.pythonExecutable, 320)
      };
    });
  const applyToolResultState = typeof deps.applyToolResultState === 'function'
    ? deps.applyToolResultState
    : (() => {});
  const runtimeServices = ensureObject(deps.services);

  // Normalize executor lookup keys so registration and retrieval use the same naming rules.
  function resolveExecutorKey(toolName) {
    return resolveCanonicalToolName(toolName) || cleanText(toolName, 120);
  }

  // Registry of concrete tool handler implementations.
  const toolExecutors = new Map();

  // Register or replace a callable executor for a canonical tool name.
  function registerToolExecutor(toolName, executor) {
    const key = resolveExecutorKey(toolName);
    if (!key || typeof executor !== 'function') {
      return false;
    }
    toolExecutors.set(key, executor);
    return true;
  }

  // Remove an executor from the runtime registry.
  function unregisterToolExecutor(toolName) {
    const key = resolveExecutorKey(toolName);
    if (!key) {
      return false;
    }
    return toolExecutors.delete(key);
  }

  // Look up the executor currently associated with a tool.
  function getToolExecutor(toolName) {
    const key = resolveExecutorKey(toolName);
    return key ? (toolExecutors.get(key) || null) : null;
  }

  // Pre-register any executors supplied during runtime construction.
  Object.entries(ensureObject(deps.toolExecutors)).forEach(([toolName, executor]) => {
    registerToolExecutor(toolName, executor);
  });

  // Validate and execute a single tool call, returning a normalized envelope even on failure.
  async function executeToolCall(rawToolCall, context = {}, state = {}) {
    const normalized = normalizeToolArgumentsPayload({
      tool_calls: [rawToolCall]
    });
    if (!normalized.ok) {
      const source = defaultEnsureObject(typeof rawToolCall === 'object' ? rawToolCall : {});
      return buildExecutionEnvelope(
        resolveCanonicalToolName(source.tool_name || source.name) || cleanText(rawToolCall, 120) || 'unknown_tool',
        normalizeToolInvocationArgs(
          Object.prototype.hasOwnProperty.call(source, 'arguments')
            ? source.arguments
            : extractInlineToolArguments(source)
        ),
        null,
        {
          ok: false,
          error: normalized.error
        }
      );
    }

    const toolCall = normalized.payload.tool_calls[0];
    const toolName = toolCall.tool_name;
    const args = ensureObject(toolCall.arguments);
    const executionContext = createExecutionContext(context);
    const executor = getToolExecutor(toolName);
    if (typeof executor !== 'function') {
      return buildExecutionEnvelope(toolName, args, null, {
        ok: false,
        error: `No tool executor is registered for "${toolName}".`
      });
    }

    try {
      const result = await executor({
        toolName,
        args,
        context: executionContext,
        state,
        services: {
          asArray,
          cleanText,
          ensureObject,
          isPlainObject,
          uniqueStrings,
          mergeObjects,
          normalizeToolInvocationArgs,
          buildExecutionEnvelope,
          ...runtimeServices
        }
      });
      return buildExecutionEnvelope(toolName, args, result, {
        summary: cleanText(result?.summary, 320)
      });
    } catch (error) {
      return buildExecutionEnvelope(toolName, args, null, {
        ok: false,
        error: cleanText(error?.message || error, 600) || `Tool "${toolName}" failed.`
      });
    }
  }

  // Execute a validated batch of tool calls sequentially so state can accumulate across tools.
  async function executeToolCalls(rawToolCalls, context = {}) {
    const normalized = normalizeToolArgumentsPayload({
      tool_calls: asArray(rawToolCalls)
    });
    if (!normalized.ok) {
      return [
        buildExecutionEnvelope('tool-batch', {}, null, {
          ok: false,
          error: normalized.error
        })
      ];
    }

    const state = cloneJson(ensureObject(deps.initialState), {});
    const results = [];
    for (const toolCall of normalized.payload.tool_calls) {
      const envelope = await executeToolCall(toolCall, context, state);
      results.push(envelope);
      applyToolResultState(state, envelope);
    }
    return results;
  }

  return {
    registerToolExecutor,
    unregisterToolExecutor,
    getToolExecutor,
    executeToolCall,
    executeToolCalls
  };
}

// Public API exported for prompt building, payload normalization, validation, and runtime execution.
module.exports = {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_CALL_CATALOG,
  validateAgentToolCatalog,
  validateAgentToolCallCatalog,
  buildToolSelectionPrompt,
  normalizeToolSelectionPayload,
  getToolInputSchemas,
  buildToolArgumentsPrompt,
  normalizeToolArgumentsPayload,
  createAgentToolCallRuntime
};
