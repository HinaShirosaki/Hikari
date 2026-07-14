'use strict';

const { isAgentRequestAbortError } = require('../../../lib/llm/request-context.js');

const {
  normalizeToolArgumentsPayload,
  normalizeToolInvocationArgs,
  resolveCanonicalToolName
} = require('./agent-tool-loading.js');

// Return the input only when it is already an array; otherwise use an empty array fallback.
function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

// Convert unknown input to a string without trimming or clipping payload fields.
function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

// Keep only plain object-like values; everything else becomes an empty object.
function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Deep-clone JSON-safe data structures so downstream mutations do not affect source data.
function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

// Check whether a value is a non-array object.
function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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
        cwd: cleanText(context.cwd, 1200),
        allowWriteTools: context.allowWriteTools === true,
        message: cleanText(context.message, 3200),
        conversation: asArray(context.conversation),
        snapshot,
        parserPayload: ensureObject(context.parserPayload),
        dataFilePath: cleanText(context.dataFilePath || snapshot.data_file_path, 2000),
        fallbackDataFilePath: cleanText(context.fallbackDataFilePath, 2000),
        traceContext: context.traceContext || null,
        agentMcp: context.agentMcp === true,
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
      if (isAgentRequestAbortError(error)) {
        throw error;
      }
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

module.exports = {
  buildExecutionEnvelope,
  createAgentToolCallRuntime
};
