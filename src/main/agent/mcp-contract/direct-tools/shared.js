'use strict';

const { asArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');
const { createUniqueStrings } = require('../../../lib/value-utils.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
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

function buildWriteToolAnnotations(title = '') {
  return compactObject({
    title: cleanText(title, 120),
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  });
}

function resolveDirectToolPayload(result = {}) {
  const source = ensureObject(result);
  const resultPayload = ensureObject(source.result);
  const outputPayload = ensureObject(source.output);
  if (Object.keys(resultPayload).length) {
    return resultPayload;
  }
  if (Object.keys(outputPayload).length) {
    return outputPayload;
  }
  return source;
}

const uniqueStrings = createUniqueStrings(cleanText);

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
    candidate_terms: uniqueStrings(source.candidate_terms || source.candidateTerms, 10)
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
    action: cleanText(payload.action || envelope.action, 40),
    detail: cleanText(payload.detail || envelope.detail, 40),
    sources: uniqueStrings(payload.sources || envelope.sources, 10),
    scope: ensureObject(payload.scope || envelope.scope),
    counts: ensureObject(payload.counts || envelope.counts),
    access: ensureObject(payload.access || envelope.access),
    items,
    citations,
    raw: envelope
  };
}

// Success is allowlisted rather than failure-blocklisted: when an app tool grows a
// new error status, an unrecognized status must read as a failure here instead of
// leaking through as ok:true and clearing the MCP isError flag.
function resolveDirectToolOk({ result = {}, payload = {}, status = '', successStatuses = [] } = {}) {
  const resultSource = ensureObject(result);
  const payloadSource = ensureObject(payload);
  const reportedStatus = cleanText(payloadSource.status || resultSource.status, 80);
  return Boolean(reportedStatus)
    && reportedStatus === cleanText(status, 80)
    && resultSource.ok !== false
    && payloadSource.ok !== false
    && asArray(successStatuses).includes(reportedStatus);
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

// The reason is one constant per lookup, so it is reported once as citation_reason
// rather than repeated on all eight entries. Entries keep source and pointer, which
// is what normalizeCitation needs to accept them in the agent's answer.
function buildLookupCitations(items = [], source = '') {
  const sourceText = cleanText(source, 120);
  return asArray(items)
    .slice(0, 8)
    .map((item, index) => {
      const pointer = [
        cleanText(item?.id || item?.record_id || item?.recordId, 120),
        cleanText(item?.title || item?.name || item?.protocolName, 220)
      ].filter(Boolean).join(' | ');
      return {
        source: sourceText,
        pointer: pointer || `${sourceText || 'lookup'}:${index + 1}`
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
  return {
    ...compactObject({
      ok,
      status: ok
        ? (normalizedEnvelope.status || (resultItems.length ? 'matched' : 'no_match'))
        : (normalizedEnvelope.status || 'failed'),
      mcp_tool: cleanText(mcpToolName, 120),
      app_tool: cleanText(appToolId, 120),
      query: cleanText(normalizedEnvelope.query || query, 600),
      source: cleanText(source || normalizedEnvelope.source, 120),
      backfilled_sql: normalizedEnvelope.backfilledSql === true,
      terms_used: normalizedEnvelope.termsUsed,
      action: normalizedEnvelope.action,
      detail: normalizedEnvelope.detail,
      sources: normalizedEnvelope.sources,
      scope: normalizedEnvelope.scope,
      counts: normalizedEnvelope.counts,
      access: normalizedEnvelope.access,
      summary,
      error: normalizedEnvelope.error,
      citation_reason: cleanText(citationReason, 260)
    }),
    // items and citations are the payload of a lookup, so they survive compaction
    // even when empty: stripping [] leaves a caller unable to tell "searched, found
    // nothing" from "this response never carried results at all".
    items: cloneJson(resultItems, []),
    citations: buildLookupCitations(resultItems, mcpToolName)
  };
}

module.exports = {
  asArray,
  cleanText,
  ensureObject,
  cloneJson,
  compactObject,
  buildReadOnlyToolAnnotations,
  buildWriteToolAnnotations,
  resolveDirectToolPayload,
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
  resolveDirectToolOk,
  runAppTool,
  buildLookupCitations,
  buildLookupSummary,
  buildLookupResponse
};
