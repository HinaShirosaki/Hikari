'use strict';

const { cloneJson } = require('../../../lib/normalize.js');
const { defaultCleanText, defaultEnsureObject } = require('./json-args.js');

// Validate and normalize the basic tool catalog loaded from `Tools.json`.
function validateAgentToolCatalog(catalog) {
  if (!Array.isArray(catalog)) {
    throw new Error('Agent tool catalog must be an array.');
  }

  const seen = new Set();
  return catalog.map((entry, index) => {
    const source = defaultEnsureObject(entry);
    const name = defaultCleanText(source.name);
    const description = defaultCleanText(source.description);
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
    const description = defaultCleanText(entry.description);
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

module.exports = {
  validateAgentToolCallCatalog,
  validateAgentToolCatalog
};
