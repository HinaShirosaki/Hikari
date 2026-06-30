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
  'purchase_recommendation',
  'result_analysis',
  'mixed_request',
  'unclear'
]);

// Common misspellings or alternate labels that should resolve to canonical intents.
const PARSER_INTENT_ALIASES = Object.freeze({
  data_analysis_or_coding: 'result_analysis',
  coding_data_analysis: 'result_analysis',
  inventory_loopup: 'inventory_lookup',
  record_loopup: 'record_lookup',
  product_recommendation: 'purchase_recommendation',
  shopping_recommendation: 'purchase_recommendation',
  shopping_search: 'purchase_recommendation'
});

// Alias retained so schema/config code can refer to the allowed parser intents explicitly.
const PARSER_ALLOWED_INTENTS = PARSER_CANONICAL_INTENTS;

// Supported strategies for ordering inventory search terms during lookup.
const PARSER_SEARCH_MODES = Object.freeze([
  'exact_then_alias_then_fuzzy',
  'exact_only',
  'alias_then_fuzzy'
]);

// Science-question intents classify how much routing effort is needed before answering.
const PARSER_REASONING_EFFORT_LEVELS = Object.freeze([0, 1, 2]);

// Maximum number of protocol name candidates the parser may return.
const PARSER_PROTOCOL_CANDIDATE_LIMIT = 3;

// Prompt-visible base JSON template. Intents may append only their listed extra fields.
const INTENT_PARSER_OUTPUT_TEMPLATE = Object.freeze({
  primary_intent: 'one allowed intent'
});

// Shared schema fragments used to build the strict per-intent response schema.
const INTENT_PARSER_ENTITY_VALUE_SCHEMA = Object.freeze({
  anyOf: [{ type: 'string' }, { type: 'null' }]
});
const INTENT_PARSER_OPTIONAL_PROPERTY_SCHEMAS = Object.freeze({
  reasoning_effort: {
    type: 'integer',
    enum: PARSER_REASONING_EFFORT_LEVELS
  },
  direct_answer: {
    anyOf: [{ type: 'string' }, { type: 'null' }]
  },
  needs_clarification: {
    type: 'boolean'
  },
  clarification_reason: {
    anyOf: [{ type: 'string' }, { type: 'null' }]
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
  }
});

// Return the input only when it is already an array; otherwise use an empty array.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Normalize unknown input into a string without trimming or clipping content.
function cleanText(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
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

// Only science-question intents use multi-level routing effort; everything else stays at level 0.
function normalizeReasoningEffort(rawReasoningEffort, primaryIntent = '') {
  const intent = cleanText(primaryIntent, 80);
  const numeric = Number(rawReasoningEffort);
  if (!['project_science_question', 'general_science_question'].includes(intent)) {
    return 0;
  }
  return PARSER_REASONING_EFFORT_LEVELS.includes(numeric) ? numeric : 1;
}

// Preserve only string/null entity pairs without requiring a fixed schema block.
function normalizeEntityKey(rawKey) {
  return cleanText(rawKey, 80)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function createEmptyInventorySearch() {
  return {
    normalized_query: null,
    candidate_terms: [],
    aliases: [],
    search_mode: null
  };
}

// Normalize the parser's entity block into a compact optional object.
function normalizeEntityBlock(rawEntities) {
  if (rawEntities == null) {
    return {};
  }
  if (!isObject(rawEntities)) {
    return null;
  }
  const entities = {};
  for (const [rawKey, raw] of Object.entries(rawEntities).slice(0, 24)) {
    const key = normalizeEntityKey(rawKey);
    if (!key) {
      continue;
    }
    if (raw == null) {
      entities[key] = null;
      continue;
    }
    const text = cleanText(raw, 220);
    entities[key] = text || null;
  }
  return entities;
}

// Only reasoning-effort 0 science intents may carry a direct answer from the parser itself.
function normalizeDirectAnswer(rawDirectAnswer, primaryIntent = '', reasoningEffort = 0, needsClarification = false) {
  if (needsClarification === true) {
    return null;
  }
  if (!['project_science_question', 'general_science_question'].includes(cleanText(primaryIntent, 80))) {
    return null;
  }
  if (Number(reasoningEffort) !== 0) {
    return null;
  }
  return cleanText(rawDirectAnswer, 12000) || null;
}

// Normalize inventory search hints returned by the parser.
function normalizeInventorySearch(rawInventorySearch) {
  if (rawInventorySearch == null) {
    return createEmptyInventorySearch();
  }
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

function normalizeNeedsClarification(rawNeedsClarification, primaryIntent = '', rawClarificationReason = '') {
  if (rawNeedsClarification === true || rawNeedsClarification === false) {
    return rawNeedsClarification;
  }
  if (cleanText(rawClarificationReason, 260)) {
    return true;
  }
  return ['mixed_request', 'unclear'].includes(cleanText(primaryIntent, 80));
}

function buildDefaultClarificationReason(primaryIntent = '') {
  const intent = cleanText(primaryIntent, 80);
  if (intent === 'mixed_request') {
    return 'Please split the request or tell me which task to handle first.';
  }
  if (intent === 'unclear') {
    return 'Please share the missing detail I need to route this request.';
  }
  return null;
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

  if (
    parsed.needs_clarification !== undefined
    && parsed.needs_clarification !== true
    && parsed.needs_clarification !== false
  ) {
    return {
      ok: false,
      error: 'Intent parser needs_clarification must be a boolean.'
    };
  }

  const reasoningEffort = normalizeReasoningEffort(parsed.reasoning_effort, primaryIntent);
  const needsClarification = normalizeNeedsClarification(
    parsed.needs_clarification,
    primaryIntent,
    parsed.clarification_reason
  );

  const entities = normalizeEntityBlock(parsed.entities);
  if (entities === null) {
    return {
      ok: false,
      error: 'Intent parser entities payload is malformed.'
    };
  }

  const inventorySearchRaw = normalizeInventorySearch(parsed.inventory_search);
  if (inventorySearchRaw === null) {
    return {
      ok: false,
      error: 'Intent parser inventory_search payload is malformed.'
    };
  }

  if (parsed.protocol_candidates !== undefined && !Array.isArray(parsed.protocol_candidates)) {
    return {
      ok: false,
      error: 'Intent parser protocol_candidates must be an array.'
    };
  }
  if (Array.isArray(parsed.protocol_candidates) && parsed.protocol_candidates.length > PARSER_PROTOCOL_CANDIDATE_LIMIT) {
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
    : createEmptyInventorySearch();

  // Return the final normalized payload consumed by routing and downstream helpers.
  return {
    ok: true,
    payload: {
      primary_intent: primaryIntent,
      reasoning_effort: reasoningEffort,
      direct_answer: normalizeDirectAnswer(
        parsed.direct_answer,
        primaryIntent,
        reasoningEffort,
        needsClarification
      ),
      needs_clarification: needsClarification,
      clarification_reason: needsClarification
        ? (cleanText(parsed.clarification_reason, 260) || buildDefaultClarificationReason(primaryIntent))
        : null,
      entities,
      inventory_search: normalizedInventorySearch,
      protocol_candidates: normalizeProtocolCandidates(
        Array.isArray(parsed.protocol_candidates) ? parsed.protocol_candidates : [],
        primaryIntent,
        entities
      ),
      reasoning_summary: cleanText(parsed.reasoning_summary, 300)
        || `Intent parser selected ${primaryIntent}.`
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

function formatIntentSpecificOutputKeys(rows = []) {
  return asArray(rows)
    .map((row) => cleanText(row?.key, 120))
    .filter(Boolean)
    .join(', ');
}

function formatIntentGuideLine(entry = {}) {
  const extras = formatIntentSpecificOutputKeys(entry.specific_output_append);
  return [
    `- ${cleanText(entry.name, 80)}:`,
    cleanText(entry.description, 800),
    cleanText(entry.rules, 1000),
    `Extras: ${extras || 'none'}.`
  ].filter(Boolean).join(' ');
}

function buildScienceReasoningEffortRubric() {
  return 'Science reasoning_effort: 0=stable direct answer; 1=default careful answer or light retrieval; 2=broad synthesis, recent literature, or multi-step evidence gathering. If unsure, choose 1.';
}

// Build the base instruction prompt that teaches the model the allowed intents and schema.
function buildIntentCatalogPrompt(catalog = []) {
  // Fall back to the validated static catalog unless a test/custom catalog is supplied.
  const normalizedCatalog = asArray(catalog).length ? asArray(catalog) : INTENT_PARSER_CATALOG;
  const allowedIntents = normalizedCatalog.map((entry) => entry.name).join(', ');
  const intentGuide = normalizedCatalog.map(formatIntentGuideLine).join('\n');

  // Assemble one compact instruction block that defines intents, schema, and routing boundaries.
  return [
    'Classify the lab-assistant user message. Return compact JSON only.',
    `Allowed intents: ${allowedIntents}`,
    'Base JSON: { "primary_intent": "one allowed intent" }',
    'Add only the extra fields listed for the chosen intent. Omit all other keys and empty placeholders.',
    'If you include entities, include only listed entities.* keys.',
    'Rules:',
    '- Choose exactly one primary_intent.',
    `- ${buildScienceReasoningEffortRubric()}`,
    '- Include direct_answer only for science intents at reasoning_effort=0.',
    '- inventory_search shape: {normalized_query, candidate_terms, aliases, search_mode}.',
    '- protocol_candidates: 1 to 3 likely protocol names; do not invent obscure aliases.',
    '- needs_clarification and clarification_reason only when routing is blocked.',
    '- Standalone instructional wet-lab protocol requests, such as "how to express X" or "give me a detailed protocol", are science questions unless the user asks for a notebook page, notebook draft, lab record, or documentation of work they performed.',
    'Intent guide:',
    intentGuide,
    'Return JSON only.'
  ].join('\n');
}

function cloneSchemaFragment(schema) {
  return JSON.parse(JSON.stringify(schema));
}

function buildIntentSpecificResponseSchema(catalog = []) {
  const normalizedCatalog = asArray(catalog).length ? asArray(catalog) : INTENT_PARSER_CATALOG;
  const properties = {
    primary_intent: {
      type: 'string',
      enum: normalizedCatalog.map((entry) => entry.name)
    }
  };
  const entityKeys = new Set();
  normalizedCatalog.forEach((entry) => {
    asArray(entry.specific_output_append).forEach((row) => {
      const key = cleanText(row?.key, 120);
      if (!key) {
        return;
      }
      if (key.startsWith('entities.')) {
        entityKeys.add(normalizeEntityKey(key.slice('entities.'.length)));
        return;
      }
      if (Object.prototype.hasOwnProperty.call(INTENT_PARSER_OPTIONAL_PROPERTY_SCHEMAS, key)) {
        properties[key] = cloneSchemaFragment(INTENT_PARSER_OPTIONAL_PROPERTY_SCHEMAS[key]);
      }
    });
  });
  if (entityKeys.size) {
    properties.entities = {
      type: 'object',
      additionalProperties: false,
      properties: [...entityKeys].reduce((acc, key) => {
        acc[key] = cloneSchemaFragment(INTENT_PARSER_ENTITY_VALUE_SCHEMA);
        return acc;
      }, {})
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['primary_intent'],
    properties
  };
}

// Validated static catalog and prebuilt prompt/schema shared by all parser calls.
const INTENT_PARSER_CATALOG = validateIntentCatalog(RAW_INTENT_CATALOG);
const INTENT_PARSER_RESPONSE_SCHEMA = buildIntentSpecificResponseSchema(INTENT_PARSER_CATALOG);
const INTENT_PARSER_PROMPT = buildIntentCatalogPrompt(INTENT_PARSER_CATALOG);

// Map parser output intents to execution-layer intents, defaulting safely when unknown.
function mapCanonicalIntentToExecutionIntent(primaryIntent) {
  const normalized = normalizeParserIntent(primaryIntent);
  if (normalized === 'unclear') {
    return 'general_science_question';
  }
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
    activity: cleanText(source.activity_type || source.activity, 180),
    project: cleanText(source.project_name || source.project, 180),
    protein: cleanText(source.protein_name || source.protein, 100),
    compound: cleanText(source.compound_name || source.compound, 120),
    protocol: cleanText(source.protocol_name || source.protocol, 220),
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
    mapped.activity = cleanText(source.requested_output || source.output, 180);
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
  PARSER_REASONING_EFFORT_LEVELS,
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
