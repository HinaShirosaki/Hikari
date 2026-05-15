'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function compactObject(value = {}) {
  return Object.entries(ensureObject(value)).reduce((out, [key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) {
      return out;
    }
    if (typeof entryValue === 'string' && !entryValue) {
      return out;
    }
    if (Array.isArray(entryValue) && !entryValue.length) {
      return out;
    }
    if (
      entryValue
      && typeof entryValue === 'object'
      && !Array.isArray(entryValue)
      && !Object.keys(entryValue).length
    ) {
      return out;
    }
    out[key] = entryValue;
    return out;
  }, {});
}

function buildReadOnlyToolAnnotations(title = '') {
  return compactObject({
    title: cleanText(title, 120),
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
}

function uniqueStrings(values = [], max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
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

function toIntegerInRange(value, fallback = 8, minimum = 1, maximum = 25) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function buildCommonLookupInputSchema(extraProperties = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
      ...cloneJson(extraProperties, {})
    }
  };
}

function sanitizeInventorySearch(value = {}) {
  const source = ensureObject(value);
  return compactObject({
    normalized_query: cleanText(source.normalized_query || source.normalizedQuery, 300),
    candidate_terms: uniqueStrings(source.candidate_terms || source.candidateTerms, 10),
    aliases: uniqueStrings(source.aliases, 10),
    search_mode: cleanText(source.search_mode || source.searchMode, 80)
  });
}

function normalizeParserPayload(value = {}, additions = {}) {
  const source = ensureObject(value);
  const sourceEntities = ensureObject(source.entities);
  const additionEntities = ensureObject(additions.entities);
  const parserPayload = compactObject({
    primary_intent: cleanText(additions.primary_intent || source.primary_intent, 120),
    needs_clarification: typeof additions.needs_clarification === 'boolean'
      ? additions.needs_clarification
      : (typeof source.needs_clarification === 'boolean' ? source.needs_clarification : undefined),
    clarification_reason: cleanText(additions.clarification_reason || source.clarification_reason, 500),
    reasoning_summary: cleanText(additions.reasoning_summary || source.reasoning_summary, 1200),
    entities: compactObject({
      ...sourceEntities,
      ...additionEntities
    }),
    inventory_search: sanitizeInventorySearch(additions.inventory_search || source.inventory_search),
    protocol_candidates: uniqueStrings(additions.protocol_candidates || source.protocol_candidates, 8)
  });
  return parserPayload;
}

function normalizeLookupQuery(input = {}, context = {}) {
  return cleanText(
    input.query
      || input.name
      || input.term
      || input.protocol_name
      || input.protocolName
      || input.notebook_name
      || input.notebookName
      || context.message,
    600
  );
}

function resolveProjectFilter(input = {}) {
  return {
    project_id: cleanText(input.project_id || input.projectId, 120),
    project_name: cleanText(input.project_name || input.projectName, 220)
  };
}

function matchesProjectFilter(item = {}, filter = {}) {
  const projectId = cleanText(filter.project_id, 120);
  const projectName = cleanText(filter.project_name, 220).toLowerCase();
  if (!projectId && !projectName) {
    return true;
  }
  const itemProjectId = cleanText(item.project_id || item.projectId, 120);
  const itemProjectName = cleanText(item.project_name || item.projectName, 220).toLowerCase();
  if (projectId && itemProjectId === projectId) {
    return true;
  }
  if (projectId) {
    return false;
  }
  return Boolean(projectName && itemProjectName === projectName);
}

function filterRecordItems(items = [], recordType = '', input = {}) {
  const type = cleanText(recordType, 80);
  const projectFilter = resolveProjectFilter(input);
  return asArray(items).filter((item) => (
    cleanText(item?.record_type || item?.recordType, 80) === type
    && matchesProjectFilter(item, projectFilter)
  ));
}

function filterInventoryItemsByKind(items = [], kinds = []) {
  const kindSet = new Set(asArray(kinds).map((kind) => cleanText(kind, 80)).filter(Boolean));
  if (!kindSet.size) {
    return asArray(items);
  }
  return asArray(items).filter((item) => kindSet.has(cleanText(item?.kind, 80)));
}

function normalizeToolEnvelope(rawResult = {}) {
  const envelope = ensureObject(rawResult);
  const resultPayload = ensureObject(envelope.result);
  const outputPayload = ensureObject(envelope.output);
  const payload = Object.keys(resultPayload).length
    ? resultPayload
    : (Object.keys(outputPayload).length ? outputPayload : envelope);
  const items = asArray(payload.items).length ? asArray(payload.items) : asArray(envelope.items);
  const citations = asArray(payload.citations).length ? asArray(payload.citations) : asArray(envelope.citations);
  return {
    ok: envelope.ok !== false && payload.ok !== false,
    status: cleanText(payload.status || envelope.status, 80),
    query: cleanText(payload.query || envelope.query, 600),
    source: cleanText(payload.source || envelope.source, 120),
    backfilledSql: payload.backfilled_sql === true
      || payload.backfilledSql === true
      || envelope.backfilled_sql === true
      || envelope.backfilledSql === true,
    summary: cleanText(payload.summary || envelope.summary, 800),
    error: cleanText(payload.error || envelope.error, 1200),
    termsUsed: uniqueStrings(payload.terms_used || payload.termsUsed || envelope.terms_used || envelope.termsUsed, 10),
    items,
    citations,
    raw: envelope
  };
}

async function runAppTool({ runTool, toolId, args = {}, context = {} } = {}) {
  if (typeof runTool !== 'function') {
    return {
      ok: false,
      status: 'executor_unavailable',
      error: 'Hikari MCP lookup execution is not connected to the app runtime.'
    };
  }
  try {
    return await runTool(toolId, ensureObject(args), ensureObject(context.snapshot), context);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      error: cleanText(error?.message || error, 1200) || 'Hikari MCP lookup failed.'
    };
  }
}

function buildLookupCitations(items = [], source = '', reason = '') {
  const sourceText = cleanText(source, 120);
  const reasonText = cleanText(reason, 260);
  return asArray(items)
    .slice(0, 8)
    .map((item, index) => {
      const pointer = [
        cleanText(item?.id || item?.record_id || item?.recordId, 120),
        cleanText(item?.title || item?.name || item?.protocolName, 220)
      ].filter(Boolean).join(' | ');
      return {
        source: sourceText,
        pointer: pointer || `${sourceText || 'lookup'}:${index + 1}`,
        reason: reasonText
      };
    })
    .filter((citation) => citation.source && citation.pointer);
}

function buildLookupSummary(toolName = '', items = [], emptyText = '') {
  const count = asArray(items).length;
  if (!count) {
    return cleanText(emptyText, 320) || `${cleanText(toolName, 120) || 'lookup'} returned no matches.`;
  }
  const preview = asArray(items)
    .slice(0, 2)
    .map((item) => cleanText(item?.title || item?.name || item?.protocolName || item?.id, 160))
    .filter(Boolean)
    .join('; ');
  return `${cleanText(toolName, 120) || 'lookup'} matched ${count} item${count === 1 ? '' : 's'}${preview ? `: ${preview}.` : '.'}`;
}

function buildLookupResponse({
  mcpToolName = '',
  appToolId = '',
  query = '',
  envelope = {},
  items = [],
  source = '',
  citationReason = '',
  emptySummary = ''
} = {}) {
  const normalizedEnvelope = normalizeToolEnvelope(envelope);
  const resultItems = asArray(items);
  const ok = normalizedEnvelope.ok !== false;
  const summary = ok
    ? buildLookupSummary(mcpToolName, resultItems, emptySummary)
    : (normalizedEnvelope.error || `${cleanText(mcpToolName, 120) || 'lookup'} failed.`);
  return compactObject({
    ok,
    status: ok
      ? (resultItems.length ? 'matched' : 'no_match')
      : (normalizedEnvelope.status || 'failed'),
    mcp_tool: cleanText(mcpToolName, 120),
    app_tool: cleanText(appToolId, 120),
    query: cleanText(normalizedEnvelope.query || query, 600),
    source: cleanText(source || normalizedEnvelope.source, 120),
    backfilled_sql: normalizedEnvelope.backfilledSql === true,
    terms_used: normalizedEnvelope.termsUsed,
    summary,
    items: cloneJson(resultItems, []),
    citations: buildLookupCitations(resultItems, mcpToolName, citationReason),
    error: normalizedEnvelope.error
  });
}

module.exports = {
  asArray,
  cleanText,
  ensureObject,
  cloneJson,
  compactObject,
  buildReadOnlyToolAnnotations,
  uniqueStrings,
  toIntegerInRange,
  buildCommonLookupInputSchema,
  sanitizeInventorySearch,
  normalizeParserPayload,
  normalizeLookupQuery,
  resolveProjectFilter,
  matchesProjectFilter,
  filterRecordItems,
  filterInventoryItemsByKind,
  normalizeToolEnvelope,
  runAppTool,
  buildLookupCitations,
  buildLookupSummary,
  buildLookupResponse
};
