'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

// Convert unknown input to a string without trimming or clipping content.
function defaultCleanText(value) {
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

module.exports = {
  defaultAsArray,
  defaultCleanText,
  defaultEnsureObject,
  extractInlineToolArguments,
  normalizeJsonPayload,
  normalizeToolInvocationArgs
};
