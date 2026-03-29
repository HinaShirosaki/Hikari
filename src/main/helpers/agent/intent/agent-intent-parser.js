/**
 * Intent parsing helpers for classifying user requests, validating the intent
 * catalog, normalizing model JSON output, and preparing parser-driven routing
 * hints such as entities, protocol candidates, and inventory search terms.
 */
'use strict';

// Raw intent definitions loaded from the catalog JSON file.
const RAW_INTENT_CATALOG = require('./agent-intent.json');

// Canonical intent names accepted by the parser and downstream routing layers.
const PARSER_CANONICAL_INTENTS = Object.freeze([
  'protocol_to_notebook',
  'notebook_draft',
  'inventory_lookup',
  'record_lookup',
  'project_science_question',
  'general_science_question',
  'paper_analysis',
  'literature_search',
  'result_analysis',
  'mixed_request',
  'unclear'
]);

// Common misspellings or alternate labels that should resolve to canonical intents.
const PARSER_INTENT_ALIASES = Object.freeze({
  data_analysis_or_coding: 'result_analysis',
  coding_data_analysis: 'result_analysis',
  inventory_loopup: 'inventory_lookup',
  record_loopup: 'record_lookup'
});

// Alias retained so schema/config code can refer to the allowed parser intents explicitly.
const PARSER_ALLOWED_INTENTS = PARSER_CANONICAL_INTENTS;

// Supported strategies for ordering inventory search terms during lookup.
const PARSER_SEARCH_MODES = Object.freeze([
  'exact_then_alias_then_fuzzy',
  'exact_only',
  'alias_then_fuzzy'
]);

// Entity slots the parser may populate from the user message or recent conversation.
const PARSER_ENTITY_KEYS = Object.freeze([
  'activity_type',
  'project_name',
  'protocol_name',
  'protein_name',
  'compound_name',
  'inventory_item',
  'cell_line',
  'paper_title',
  'workflow_step',
  'requested_output'
]);

// Maximum number of protocol name candidates the parser may return.
const PARSER_PROTOCOL_CANDIDATE_LIMIT = 3;

// Prompt-visible JSON template showing the exact response structure expected from the model.
const INTENT_PARSER_OUTPUT_TEMPLATE = Object.freeze({
  primary_intent: 'one allowed intent',
  needs_clarification: true,
  clarification_reason: 'string or null',
  entities: PARSER_ENTITY_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {}),
  inventory_search: {
    normalized_query: null,
    candidate_terms: [],
    aliases: [],
    search_mode: null
  },
  protocol_candidates: [],
  reasoning_summary: 'brief explanation'
});

// JSON-schema-like validation shape for normalized parser responses.
const INTENT_PARSER_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'primary_intent',
    'needs_clarification',
    'clarification_reason',
    'entities',
    'inventory_search',
    'protocol_candidates',
    'reasoning_summary'
  ],
  properties: {
    primary_intent: {
      type: 'string',
      enum: PARSER_ALLOWED_INTENTS
    },
    needs_clarification: {
      type: 'boolean'
    },
    clarification_reason: {
      anyOf: [{ type: 'string' }, { type: 'null' }]
    },
    entities: {
      type: 'object',
      additionalProperties: false,
      required: PARSER_ENTITY_KEYS,
      properties: PARSER_ENTITY_KEYS.reduce((acc, key) => {
        acc[key] = { anyOf: [{ type: 'string' }, { type: 'null' }] };
        return acc;
      }, {})
    },
    inventory_search: {
      type: 'object',
      additionalProperties: false,
      required: ['normalized_query', 'candidate_terms', 'aliases', 'search_mode'],
      properties: {
        normalized_query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        candidate_terms: {
          type: 'array',
          items: { type: 'string' }
        },
        aliases: {
          type: 'array',
          items: { type: 'string' }
        },
        search_mode: {
          anyOf: [
            { type: 'string', enum: PARSER_SEARCH_MODES },
            { type: 'null' }
          ]
        }
      }
    },
    protocol_candidates: {
      type: 'array',
      maxItems: PARSER_PROTOCOL_CANDIDATE_LIMIT,
      items: { type: 'string' }
    },
    reasoning_summary: { type: 'string' }
  }
};

// Return the input only when it is already an array; otherwise use an empty array.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Normalize unknown input into trimmed text and cap it to a safe maximum length.
function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

// Deduplicate normalized strings while preserving order and limiting output size.
function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const output = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || output.length >= max) {
      return;
    }
    seen.add(key);
    output.push(normalized);
  });
  return output;
}

// Check whether a value is a non-array object.
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Accept either an object or a JSON string and return a parsed object payload when possible.
function parseRawPayload(rawValue) {
  if (isObject(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Normalize raw intent names, including alias correction, into canonical parser intents.
function normalizeParserIntent(rawIntent) {
  const normalized = cleanText(rawIntent, 80)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return '';
  }
  if (PARSER_CANONICAL_INTENTS.includes(normalized)) {
    return normalized;
  }
  if (Object.prototype.hasOwnProperty.call(PARSER_INTENT_ALIASES, normalized)) {
    return PARSER_INTENT_ALIASES[normalized];
  }
  return '';
}

// Normalize the parser's entity block so every supported entity key is present.
function normalizeEntityBlock(rawEntities) {
  if (!isObject(rawEntities)) {
    return null;
  }
  const entities = {};
  for (const key of PARSER_ENTITY_KEYS) {
    const raw = rawEntities[key];
    if (raw == null) {
      entities[key] = null;
      continue;
    }
    const text = cleanText(raw, 220);
    entities[key] = text || null;
  }
  return entities;
}

// Normalize inventory search hints returned by the parser.
function normalizeInventorySearch(rawInventorySearch) {
  if (!isObject(rawInventorySearch)) {
    return null;
  }
  const normalizedQuery = cleanText(rawInventorySearch.normalized_query, 220) || null;
  const candidateTerms = uniqueStrings(rawInventorySearch.candidate_terms, 12);
  const aliases = uniqueStrings(rawInventorySearch.aliases, 12);
  const searchMode = cleanText(rawInventorySearch.search_mode, 60);
  return {
    normalized_query: normalizedQuery,
    candidate_terms: candidateTerms,
    aliases,
    search_mode: PARSER_SEARCH_MODES.includes(searchMode) ? searchMode : null
  };
}

// Keep protocol candidates only for notebook requests and seed them from explicit protocol entities.
function normalizeProtocolCandidates(rawCandidates, primaryIntent, entities = {}) {
  if (!['protocol_to_notebook', 'notebook_draft'].includes(primaryIntent)) {
    return [];
  }
  const seed = [
    ...asArray(rawCandidates),
    cleanText(entities?.protocol_name, 220)
  ];
  return uniqueStrings(seed, PARSER_PROTOCOL_CANDIDATE_LIMIT);
}

// Validate and normalize the model's parser JSON response into the runtime payload shape.
function normalizeIntentParserPayload(rawValue) {
  // Parse the raw model output first so later checks can assume an object payload.
  const parsed = parseRawPayload(rawValue);
  if (!parsed) {
    return {
      ok: false,
      error: 'Intent parser response was not valid JSON.'
    };
  }

  // Reject deprecated or unsupported fields so the parser output stays minimal and predictable.
  if (Object.prototype.hasOwnProperty.call(parsed, 'confidence')) {
    return {
      ok: false,
      error: 'Intent parser response must not include confidence.'
    };
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'secondary_intents')) {
    return {
      ok: false,
      error: 'Intent parser response must not include secondary_intents.'
    };
  }

  // Canonicalize the chosen intent before validating intent-specific branches.
  const primaryIntent = normalizeParserIntent(parsed.primary_intent);
  if (!primaryIntent) {
    return {
      ok: false,
      error: `Intent parser primary_intent is invalid: ${cleanText(parsed.primary_intent, 80) || 'missing'}`
    };
  }

  if (parsed.needs_clarification !== true && parsed.needs_clarification !== false) {
    return {
      ok: false,
      error: 'Intent parser needs_clarification must be a boolean.'
    };
  }

  const entities = normalizeEntityBlock(parsed.entities);
  if (!entities) {
    return {
      ok: false,
      error: 'Intent parser entities payload is missing or malformed.'
    };
  }

  const inventorySearchRaw = normalizeInventorySearch(parsed.inventory_search);
  if (!inventorySearchRaw) {
    return {
      ok: false,
      error: 'Intent parser inventory_search payload is missing or malformed.'
    };
  }

  if (!Array.isArray(parsed.protocol_candidates)) {
    return {
      ok: false,
      error: 'Intent parser protocol_candidates must be an array.'
    };
  }
  if (parsed.protocol_candidates.length > PARSER_PROTOCOL_CANDIDATE_LIMIT) {
    return {
      ok: false,
      error: 'Intent parser protocol_candidates must contain at most 3 candidates.'
    };
  }

  // Only preserve inventory hints when the chosen intent is actually an inventory lookup.
  const normalizedInventorySearch = primaryIntent === 'inventory_lookup'
    ? {
      normalized_query: inventorySearchRaw.normalized_query,
      candidate_terms: inventorySearchRaw.candidate_terms,
      aliases: inventorySearchRaw.aliases,
      search_mode: inventorySearchRaw.search_mode || 'exact_then_alias_then_fuzzy'
    }
    : {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    };

  // Return the final normalized payload consumed by routing and downstream helpers.
  return {
    ok: true,
    payload: {
      primary_intent: primaryIntent,
      needs_clarification: parsed.needs_clarification === true,
      clarification_reason: cleanText(parsed.clarification_reason, 260) || null,
      entities,
      inventory_search: normalizedInventorySearch,
      protocol_candidates: normalizeProtocolCandidates(parsed.protocol_candidates, primaryIntent, entities),
      reasoning_summary: cleanText(parsed.reasoning_summary, 300) || 'Intent parser returned no reasoning summary.'
    }
  };
}

// Small assertion helper used while validating the static intent catalog.
function assertCatalog(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Validate one required catalog string field and include its path in any thrown error.
function validateCatalogString(value, path, maxLength = 1200) {
  const normalized = cleanText(value, maxLength);
  assertCatalog(Boolean(normalized), `${path} must be a non-empty string.`);
  return normalized;
}

// Validate the free-form per-intent rule text in the catalog.
function validateCatalogRule(value, path) {
  return validateCatalogString(value, path, 1000);
}

// Validate the intent-specific output appendix block used in the parser prompt.
function validateCatalogSpecificOutputAppend(value, path) {
  assertCatalog(isObject(value), `${path} must be an object.`);
  const entries = Object.entries(value).map(([key, description]) => ({
    key: validateCatalogString(key, `${path}.<key>`, 120),
    description: validateCatalogString(description, `${path}.${key}`, 500)
  }));
  assertCatalog(entries.length > 0, `${path} must contain at least one entry.`);
  return entries;
}

// Validate the full intent catalog and return it in canonical parser-intent order.
function validateIntentCatalog(rawCatalog) {
  // Validate the top-level JSON shape before iterating through each intent entry.
  assertCatalog(isObject(rawCatalog), 'Intent catalog must be an object.');
  const namesSeen = new Set();
  // Normalize each entry and verify that names, descriptions, rules, and prompt appendices are valid.
  const normalizedEntries = Object.entries(rawCatalog).map(([key, rawEntry]) => {
    const path = `agent-intent.json.${key}`;
    assertCatalog(isObject(rawEntry), `${path} must be an object.`);
    const name = validateCatalogString(rawEntry.name, `${path}.name`, 80);
    assertCatalog(name === key, `${path}.name must match the top-level key.`);
    const normalizedIntent = normalizeParserIntent(name);
    assertCatalog(Boolean(normalizedIntent), `${path}.name must be one of the allowed canonical intents.`);
    assertCatalog(!namesSeen.has(normalizedIntent), `${path}.name duplicates the intent ${normalizedIntent}.`);
    namesSeen.add(normalizedIntent);
    return {
      name: normalizedIntent,
      description: validateCatalogString(rawEntry.description, `${path}.description`, 800),
      rules: validateCatalogRule(rawEntry.rules, `${path}.rules`),
      example_input: validateCatalogString(rawEntry.example_input, `${path}.example_input`, 1400),
      specific_output_append: validateCatalogSpecificOutputAppend(rawEntry.specific_output_append, `${path}.specific_output_append`)
    };
  });

  // Ensure the catalog covers every canonical intent exactly once and contains no unexpected extras.
  const byName = new Map(normalizedEntries.map((entry) => [entry.name, entry]));
  const missing = PARSER_CANONICAL_INTENTS.filter((name) => !byName.has(name));
  assertCatalog(missing.length === 0, `Intent catalog is missing canonical intents: ${missing.join(', ')}`);
  const unexpected = normalizedEntries
    .map((entry) => entry.name)
    .filter((name) => !PARSER_CANONICAL_INTENTS.includes(name));
  assertCatalog(unexpected.length === 0, `Intent catalog contains unexpected intents: ${unexpected.join(', ')}`);

  return Object.freeze(PARSER_CANONICAL_INTENTS.map((name) => byName.get(name)));
}

// Render one intent's output-append rows as bullet points for the prompt.
function formatIntentSpecificOutputAppend(rows = []) {
  return asArray(rows)
    .map((row) => `- ${cleanText(row?.key, 120)}: ${cleanText(row?.description, 500)}`)
    .filter(Boolean)
    .join('\n');
}

// Build the base instruction prompt that teaches the model the allowed intents and schema.
function buildIntentCatalogPrompt(catalog = []) {
  // Fall back to the validated static catalog unless a test/custom catalog is supplied.
  const normalizedCatalog = asArray(catalog).length ? asArray(catalog) : INTENT_PARSER_CATALOG;
  const allowedIntents = normalizedCatalog.map((entry) => `- ${entry.name}`).join('\n');
  const descriptions = normalizedCatalog.map((entry) => [
    `### ${entry.name}`,
    entry.description,
    `Intent-specific rule: ${entry.rules}`,
    'Intent-specific output append:',
    formatIntentSpecificOutputAppend(entry.specific_output_append)
  ].join('\n')).join('\n\n');
  const examples = normalizedCatalog.map((entry) => `User: "${entry.example_input}"`).join('\n');

  // Assemble one reusable instruction block that defines intents, schema, rules, and examples.
  return [
    'You are an intent and entity parser for a lab assistant app.',
    "Your job is to read the user's message and return JSON only.",
    'You must classify the user intent, extract key entities, and prepare inventory search hints when inventory is involved.',
    '## Allowed intents',
    allowedIntents,
    '## Output schema',
    JSON.stringify(INTENT_PARSER_OUTPUT_TEMPLATE, null, 2),
    '## Rules',
    '- Return JSON only.',
    '- Choose exactly one primary intent.',
    '- Populate entities only when they are supported by the user message or recent conversation.',
    '- For intents other than inventory_lookup, set inventory_search to nulls and empty arrays.',
    '- For intents other than protocol_to_notebook and notebook_draft, set protocol_candidates to [].',
    '- Do not invent obscure aliases or unsupported protocol names.',
    '## Intent descriptions',
    descriptions,
    '## Examples',
    examples,
    'Return JSON only.'
  ].join('\n\n');
}

// Validated static catalog and prebuilt prompt shared by all parser calls.
const INTENT_PARSER_CATALOG = validateIntentCatalog(RAW_INTENT_CATALOG);
const INTENT_PARSER_PROMPT = buildIntentCatalogPrompt(INTENT_PARSER_CATALOG);

// Map parser output intents to execution-layer intents, defaulting safely when unknown.
function mapCanonicalIntentToExecutionIntent(primaryIntent) {
  const normalized = normalizeParserIntent(primaryIntent);
  if (normalized) {
    return normalized;
  }
  return 'general_science_question';
}

// Convert parser entity keys into the flatter routing entity shape used elsewhere in the app.
function normalizeParserEntitiesToRoutingEntities(parserEntities, primaryIntent = '') {
  // Map the parser's richer entity block into the smaller routing entity shape.
  const source = isObject(parserEntities) ? parserEntities : {};
  const mapped = {
    activity: cleanText(source.activity_type, 180),
    project: cleanText(source.project_name, 180),
    protein: cleanText(source.protein_name, 100),
    compound: cleanText(source.compound_name, 120),
    protocol: cleanText(source.protocol_name, 220),
    cell_line: cleanText(source.cell_line, 80),
    paper_title: cleanText(source.paper_title, 220),
    workflow_step: cleanText(source.workflow_step, 180)
  };

  // Inventory requests may surface the compound under `inventory_item` instead of `compound_name`.
  if (!mapped.compound && cleanText(primaryIntent, 80) === 'inventory_lookup') {
    mapped.compound = cleanText(source.inventory_item, 120);
  }
  // Fall back to the requested output when no explicit activity type was extracted.
  if (!mapped.activity) {
    mapped.activity = cleanText(source.requested_output, 180);
  }
  return mapped;
}

// Combine the base parser prompt with project context, recent conversation, and the latest message.
function buildIntentParserPrompt({ message, conversation = [], projectName = '' }) {
  // Keep only the most recent turns and compress them into a numbered transcript block.
  const transcript = asArray(conversation)
    .slice(-8)
    .map((turn, index) => {
      const role = cleanText(turn?.role, 20) === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(turn?.text, 1200);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const project = cleanText(projectName, 180);
  const latestMessage = cleanText(message, 4000);
  // Append dynamic context to the static parser instructions for the current user request.
  return [
    INTENT_PARSER_PROMPT,
    project ? `Active project context: ${project}` : '',
    transcript ? `Recent conversation:\n${transcript}` : '',
    `User message:\n${latestMessage}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

// Build the ordered list of inventory search terms according to the parser-selected search mode.
function buildInventorySearchTerms({
  inventorySearch = {},
  fallbackQuery = '',
  maxTerms = 10
}) {
  // Normalize all inventory-search ingredients before ordering them by search strategy.
  const normalizedQuery = cleanText(inventorySearch?.normalized_query, 220);
  const candidateTerms = uniqueStrings(inventorySearch?.candidate_terms, maxTerms);
  const aliases = uniqueStrings(inventorySearch?.aliases, maxTerms);
  const searchMode = cleanText(inventorySearch?.search_mode, 60) || 'exact_then_alias_then_fuzzy';
  const baseFallback = cleanText(fallbackQuery, 220);

  const exactTerms = uniqueStrings([
    normalizedQuery,
    ...candidateTerms,
    baseFallback
  ], maxTerms);
  const aliasTerms = uniqueStrings(aliases, maxTerms);

  // Respect the parser-selected search order when combining exact terms and aliases.
  if (searchMode === 'exact_only') {
    return uniqueStrings(exactTerms, maxTerms);
  }
  if (searchMode === 'alias_then_fuzzy') {
    return uniqueStrings([...aliasTerms, ...exactTerms], maxTerms);
  }
  return uniqueStrings([...exactTerms, ...aliasTerms], maxTerms);
}

// Public module export exposing parser constants, prompt builders, and normalization helpers.
module.exports = {
  PARSER_CANONICAL_INTENTS,
  PARSER_ALLOWED_INTENTS,
  PARSER_INTENT_ALIASES,
  PARSER_SEARCH_MODES,
  PARSER_ENTITY_KEYS,
  INTENT_PARSER_CATALOG,
  INTENT_PARSER_OUTPUT_TEMPLATE,
  INTENT_PARSER_PROMPT,
  INTENT_PARSER_RESPONSE_SCHEMA,
  validateIntentCatalog,
  buildIntentCatalogPrompt,
  normalizeParserIntent,
  normalizeIntentParserPayload,
  mapCanonicalIntentToExecutionIntent,
  normalizeParserEntitiesToRoutingEntities,
  buildIntentParserPrompt,
  buildInventorySearchTerms
};
