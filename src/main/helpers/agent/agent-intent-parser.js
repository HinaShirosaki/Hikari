'use strict';

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

const INTENT_PARSER_PROMPT = `You are an intent and entity parser for a lab assistant app.

Your job is to read the user's message and return JSON only.

You must:
1. classify the user's intent
2. extract key entities
3. if the request involves inventory or chemical lookup, generate multiple candidate search terms for database search

## Allowed intents
- protocol_to_notebook
- inventory_lookup
- record_lookup
- project_science_question
- general_science_question
- paper_analysis
- literature_search
- result_analysis
- mixed_request
- unclear

## Output schema

{
  "primary_intent": "one allowed intent",
  "needs_clarification": true,
  "clarification_reason": "string or null",
  "entities": {
    "activity_type": null,
    "project_name": null,
    "protocol_name": null,
    "protein_name": null,
    "compound_name": null,
    "inventory_item": null,
    "cell_line": null,
    "paper_title": null,
    "workflow_step": null,
    "requested_output": null
  },
  "inventory_search": {
    "normalized_query": null,
    "candidate_terms": [],
    "aliases": [],
    "search_mode": null
  },
  "protocol_candidates": [],
  "reasoning_summary": "brief explanation"
}

## Rules

- Return JSON only.
- Choose exactly one primary intent.
- If the request is about inventory, reagent identity, chemical stock, reagent location, molecular weight in stock, or stored reagent metadata, use inventory_lookup.
- For coding, data transforms, quantitative fitting, or result interpretation tasks, use result_analysis.
- For inventory_lookup, populate inventory_search.
- For protocol_to_notebook, populate protocol_candidates with 1 to 3 likely protocol names from the request.
- protocol_candidates must include only protocol names and must not exceed 3 values.
- For intents other than protocol_to_notebook, set protocol_candidates to [].
- normalized_query should be the best canonical short query for database search.
- candidate_terms should include likely exact names, normalized names, abbreviations, alternate punctuation, and common aliases.
- aliases should include common alternate names if they are strongly implied by the user message.
- search_mode should usually be:
  - "exact_then_alias_then_fuzzy"
  - "exact_only"
  - "alias_then_fuzzy"
- Do not invent obscure aliases unless they are common and likely useful.
- If the user asks for a non-inventory scientific property not clearly tied to lab stock, do not populate inventory_search unless inventory is explicitly involved.

## Examples

User: "Do we have PEI?"
Return inventory_lookup and candidate terms such as:
- PEI
- polyethylenimine
- linear PEI

User: "What is the MW of sulfo-SMCC in stock?"
Return inventory_lookup and candidate terms such as:
- sulfo-SMCC
- Sulfo-SMCC
- SMCC
- sulfosuccinimidyl 4-(N-maleimidomethyl)cyclohexane-1-carboxylate

User: "Where is tris?"
Return inventory_lookup and candidate terms such as:
- Tris
- tris
- Tris-HCl
- tris(hydroxymethyl)aminomethane

Return JSON only.`;

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
  INTENT_PARSER_PROMPT,
  INTENT_PARSER_RESPONSE_SCHEMA,
  normalizeParserIntent,
  normalizeIntentParserPayload,
  mapCanonicalIntentToExecutionIntent,
  normalizeParserEntitiesToRoutingEntities,
  buildIntentParserPrompt,
  buildInventorySearchTerms
};
