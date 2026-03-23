'use strict';

const RAW_INTENT_CATALOG = require('./agent-intent.json');

const PARSER_CANONICAL_INTENTS = Object.freeze([
  'protocol_to_notebook',
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

const PARSER_INTENT_ALIASES = Object.freeze({
  data_analysis_or_coding: 'result_analysis',
  coding_data_analysis: 'result_analysis',
  inventory_loopup: 'inventory_lookup',
  record_loopup: 'record_lookup'
});

const PARSER_ALLOWED_INTENTS = PARSER_CANONICAL_INTENTS;

const PARSER_SEARCH_MODES = Object.freeze([
  'exact_then_alias_then_fuzzy',
  'exact_only',
  'alias_then_fuzzy'
]);

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

const PARSER_PROTOCOL_CANDIDATE_LIMIT = 3;

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

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

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function normalizeProtocolCandidates(rawCandidates, primaryIntent, entities = {}) {
  if (primaryIntent !== 'protocol_to_notebook') {
    return [];
  }
  const seed = [
    ...asArray(rawCandidates),
    cleanText(entities?.protocol_name, 220)
  ];
  return uniqueStrings(seed, PARSER_PROTOCOL_CANDIDATE_LIMIT);
}

function normalizeIntentParserPayload(rawValue) {
  const parsed = parseRawPayload(rawValue);
  if (!parsed) {
    return {
      ok: false,
      error: 'Intent parser response was not valid JSON.'
    };
  }

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

function assertCatalog(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateCatalogString(value, path, maxLength = 1200) {
  const normalized = cleanText(value, maxLength);
  assertCatalog(Boolean(normalized), `${path} must be a non-empty string.`);
  return normalized;
}

function validateCatalogRule(value, path) {
  return validateCatalogString(value, path, 1000);
}

function validateCatalogSpecificOutputAppend(value, path) {
  assertCatalog(isObject(value), `${path} must be an object.`);
  const entries = Object.entries(value).map(([key, description]) => ({
    key: validateCatalogString(key, `${path}.<key>`, 120),
    description: validateCatalogString(description, `${path}.${key}`, 500)
  }));
  assertCatalog(entries.length > 0, `${path} must contain at least one entry.`);
  return entries;
}

function validateIntentCatalog(rawCatalog) {
  assertCatalog(isObject(rawCatalog), 'Intent catalog must be an object.');
  const namesSeen = new Set();
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

  const byName = new Map(normalizedEntries.map((entry) => [entry.name, entry]));
  const missing = PARSER_CANONICAL_INTENTS.filter((name) => !byName.has(name));
  assertCatalog(missing.length === 0, `Intent catalog is missing canonical intents: ${missing.join(', ')}`);
  const unexpected = normalizedEntries
    .map((entry) => entry.name)
    .filter((name) => !PARSER_CANONICAL_INTENTS.includes(name));
  assertCatalog(unexpected.length === 0, `Intent catalog contains unexpected intents: ${unexpected.join(', ')}`);

  return Object.freeze(PARSER_CANONICAL_INTENTS.map((name) => byName.get(name)));
}

function formatIntentSpecificOutputAppend(rows = []) {
  return asArray(rows)
    .map((row) => `- ${cleanText(row?.key, 120)}: ${cleanText(row?.description, 500)}`)
    .filter(Boolean)
    .join('\n');
}

function buildIntentCatalogPrompt(catalog = []) {
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
    '- For intents other than protocol_to_notebook, set protocol_candidates to [].',
    '- Do not invent obscure aliases or unsupported protocol names.',
    '## Intent descriptions',
    descriptions,
    '## Examples',
    examples,
    'Return JSON only.'
  ].join('\n\n');
}

const INTENT_PARSER_CATALOG = validateIntentCatalog(RAW_INTENT_CATALOG);
const INTENT_PARSER_PROMPT = buildIntentCatalogPrompt(INTENT_PARSER_CATALOG);

function mapCanonicalIntentToExecutionIntent(primaryIntent) {
  const normalized = normalizeParserIntent(primaryIntent);
  if (normalized) {
    return normalized;
  }
  return 'general_science_question';
}

function normalizeParserEntitiesToRoutingEntities(parserEntities, primaryIntent = '') {
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

  if (!mapped.compound && cleanText(primaryIntent, 80) === 'inventory_lookup') {
    mapped.compound = cleanText(source.inventory_item, 120);
  }
  if (!mapped.activity) {
    mapped.activity = cleanText(source.requested_output, 180);
  }
  return mapped;
}

function buildIntentParserPrompt({ message, conversation = [], projectName = '' }) {
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
  return [
    INTENT_PARSER_PROMPT,
    project ? `Active project context: ${project}` : '',
    transcript ? `Recent conversation:\n${transcript}` : '',
    `User message:\n${latestMessage}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

function buildInventorySearchTerms({
  inventorySearch = {},
  fallbackQuery = '',
  maxTerms = 10
}) {
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

  if (searchMode === 'exact_only') {
    return uniqueStrings(exactTerms, maxTerms);
  }
  if (searchMode === 'alias_then_fuzzy') {
    return uniqueStrings([...aliasTerms, ...exactTerms], maxTerms);
  }
  return uniqueStrings([...exactTerms, ...aliasTerms], maxTerms);
}

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
