'use strict';

const { asArray, ensureObject } = require('../../lib/normalize.js');
const { buildNotebookLookupCoverage } = require('./notebook-lookup-coverage.js');

const text = (value) => String(value ?? '').trim();
const DATE_FIELDS = ['created', 'updated', 'executed'];
const NOTEBOOK_STATES = ['planned', 'executed', 'suggested'];

// Date-only ranges include the entire UTC day. Timestamps require an explicit
// timezone so the same request means the same thing on every execution host.
function parseNotebookDate(value, endOfDay = false) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return NaN;
  }
  const day = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return dateOnly ? day + (endOfDay ? 86400000 - 1 : 0) : Date.parse(value);
}

function compactNotebookItem(item) {
  return Object.fromEntries([
    'id', 'title', 'record_type', 'notebook_type', 'notebook_state',
    'project_id', 'project_name', 'linked_protocol_id', 'linked_protocol_name',
    'created_at', 'updated_at', 'executed_at', 'ui_target'
  ].map((key) => [key, item[key]]));
}

function invalidInput(error) {
  return { ok: false, status: 'invalid_input', error, items: [] };
}

function createNotebookListExecutor({ buildLookupContext, normalizeNotebookItem, filterNotebookItems }) {
  return async function executeList(input = {}) {
    const scope = {
      query: text(input.query),
      project_id: text(input.project_id),
      project_name: text(input.project_name),
      protocol_id: text(input.protocol_id),
      protocol_name: text(input.protocol_name),
      notebook_state: text(input.notebook_state).toLowerCase(),
      date_field: text(input.date_field) || 'updated',
      date_from: text(input.date_from),
      date_to: text(input.date_to)
    };
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return invalidInput('limit must be an integer from 1 to 200.');
    if (!DATE_FIELDS.includes(scope.date_field)) return invalidInput('date_field must be created, updated, or executed.');
    if (scope.notebook_state && !NOTEBOOK_STATES.includes(scope.notebook_state)) return invalidInput('Invalid notebook_state.');
    const from = parseNotebookDate(scope.date_from);
    const to = parseNotebookDate(scope.date_to, true);
    if (Number.isNaN(from) || Number.isNaN(to)) return invalidInput('Dates must be valid YYYY-MM-DD dates or ISO timestamps with an explicit timezone.');
    if (from !== null && to !== null && from > to) return invalidInput('date_from must be on or before date_to.');
    // ponytail: plain offset paging; pages edited mid-listing can shift. Add a
    // result fingerprint if agents start listing while the user edits.
    const offset = input.offset === undefined ? 0 : Number(input.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) return invalidInput('offset must be a non-negative integer.');

    const snapshot = ensureObject(input.snapshot);
    const context = await buildLookupContext({
      snapshot,
      dataFilePath: text(input.dataFilePath),
      fallbackDataFilePath: text(input.fallbackDataFilePath)
    });
    // Do not use listAgentEntries: its lookup candidate cap precedes filters.
    const candidates = asArray(context.hydratedSnapshot?.notebookEntries)
      .map((entry) => compactNotebookItem(normalizeNotebookItem(entry)))
      .filter((item) => item.id);
    const scopedItems = filterNotebookItems(candidates, {
      projectId: scope.project_id,
      projectName: scope.project_name,
      protocolId: scope.protocol_id,
      protocolName: scope.protocol_name,
      notebookState: scope.notebook_state
    }).filter((item) => !scope.query || item.title.toLowerCase().includes(scope.query.toLowerCase()));
    const dateKey = `${scope.date_field}_at`;
    // Planned and suggested pages have no executed date by design; they are not missing one.
    const missingDates = scopedItems.filter((item) => (scope.date_field !== 'executed' || !['planned', 'suggested'].includes(item.notebook_state.toLowerCase()))
      && (!item[dateKey] || !Number.isFinite(parseNotebookDate(item[dateKey])))).length;
    const items = scopedItems.filter((item) => {
      if (from === null && to === null) return true;
      const time = parseNotebookDate(item[dateKey]);
      return Number.isFinite(time) && (from === null || time >= from) && (to === null || time <= to);
    }).sort((left, right) => {
      const leftTime = parseNotebookDate(left[dateKey]);
      const rightTime = parseNotebookDate(right[dateKey]);
      const timeOrder = (Number.isFinite(rightTime) ? rightTime : -Infinity)
        - (Number.isFinite(leftTime) ? leftTime : -Infinity);
      return timeOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    });
    const coverage = buildNotebookLookupCoverage(context, snapshot, items.length);
    const bridge = ensureObject(snapshot.notebook_lookup_bridge);
    const applied = asArray(context.migration?.applied);
    if (bridge.complete === false && !context.loadedDataFile
      && !applied.some((source) => ['notebook_sidecar', 'project_root_storage', 'workflow_root_storage'].includes(source))) {
      if (coverage.access.status === 'ready') coverage.access.status = 'degraded';
      coverage.access.complete = false;
      coverage.access.warning_codes.push('notebook_index_incomplete');
      coverage.access.warnings.push('Only a bounded live notebook index was available; older pages may be missing.');
    }
    const page = items.slice(offset, offset + limit);
    const hasMore = offset + page.length < items.length;
    return {
      ok: true,
      status: coverage.access.status === 'permission_denied' ? 'permission_denied'
        : coverage.access.complete ? (items.length ? 'matched' : 'no_match') : 'partial',
      query: scope.query,
      source: coverage.source,
      sources: coverage.sources,
      scope,
      counts: { candidates: coverage.candidateCount, matched: items.length, returned: page.length, missing_dates: missingDates },
      access: coverage.access,
      pagination: {
        limit, total: items.length, offset, has_more: hasMore,
        next_offset: hasMore ? offset + page.length : null
      },
      items: page
    };
  };
}

module.exports = { createNotebookListExecutor };
