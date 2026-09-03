// Notebook page activity log. Appends one JSONL record per user action
// to {storageFolder}/page.log so each saved notebook page has its own
// audit trail next to its page.json.

import { isPathInsideRoot } from '../../../lib/storage-paths.js';

const TEXT_PREVIEW_LIMIT = 400;
const SCALAR_PREVIEW_LIMIT = 240;

const DEFAULT_DIFF_FIELDS = [
  'experimentName',
  'projectId',
  'projectName',
  'protocolId',
  'protocolName',
  'values',
  'result',
  'resultTable',
  'resultTables',
  'toolCalculations',
  'sampleLinks',
  'resultFiles',
  'notebookState',
  'protocolSnapshot'
];

function safeString(value, max = 600) {
  const text = String(value == null ? '' : value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function ensureDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {};
  }
  return details;
}

function truncateText(value, max = TEXT_PREVIEW_LIMIT) {
  const text = String(value == null ? '' : value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

// Every use of this is an equality test, and JSON.stringify is key-order
// sensitive: `values` is rebuilt from a DOM query on each save, so an
// unchanged page reordered its keys and logged a phantom edit. Sorting object
// keys (arrays keep their order, which is meaningful) makes the comparison
// structural.
function sortObjectKeys(_key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? null, sortObjectKeys);
  } catch {
    return String(value ?? '');
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function describeScalarChange(before, after) {
  return {
    before: truncateText(before, SCALAR_PREVIEW_LIMIT),
    after: truncateText(after, SCALAR_PREVIEW_LIMIT)
  };
}

function describeTextChange(before, after) {
  const beforeText = String(before == null ? '' : before);
  const afterText = String(after == null ? '' : after);
  return {
    beforeLength: beforeText.length,
    afterLength: afterText.length,
    deltaLength: afterText.length - beforeText.length,
    beforePreview: truncateText(beforeText, TEXT_PREVIEW_LIMIT),
    afterPreview: truncateText(afterText, TEXT_PREVIEW_LIMIT)
  };
}

function describeKeyedObjectChange(before, after) {
  const prev = isPlainObject(before) ? before : {};
  const next = isPlainObject(after) ? after : {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const added = {};
  const removed = {};
  const modified = {};
  for (const key of allKeys) {
    const hadKey = Object.prototype.hasOwnProperty.call(prev, key);
    const hasKey = Object.prototype.hasOwnProperty.call(next, key);
    const prevValue = prev[key];
    const nextValue = next[key];
    if (!hadKey && hasKey) {
      added[key] = truncateText(nextValue, SCALAR_PREVIEW_LIMIT);
    } else if (hadKey && !hasKey) {
      removed[key] = truncateText(prevValue, SCALAR_PREVIEW_LIMIT);
    } else if (safeStringify(prevValue) !== safeStringify(nextValue)) {
      modified[key] = {
        before: truncateText(prevValue, SCALAR_PREVIEW_LIMIT),
        after: truncateText(nextValue, SCALAR_PREVIEW_LIMIT)
      };
    }
  }
  return { added, removed, modified };
}

function describeStringArrayChange(before, after) {
  const prev = Array.isArray(before) ? before.map((item) => String(item ?? '')) : [];
  const next = Array.isArray(after) ? after.map((item) => String(item ?? '')) : [];
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    beforeCount: prev.length,
    afterCount: next.length,
    added: next.filter((item) => !prevSet.has(item)),
    removed: prev.filter((item) => !nextSet.has(item))
  };
}

function describeResultTableChange(before, after) {
  const prevRows = Array.isArray(before?.rows) ? before.rows.length : 0;
  const nextRows = Array.isArray(after?.rows) ? after.rows.length : 0;
  const prevCols = Array.isArray(before?.columns) ? before.columns.length : 0;
  const nextCols = Array.isArray(after?.columns) ? after.columns.length : 0;
  return {
    beforeRowCount: prevRows,
    afterRowCount: nextRows,
    beforeColumnCount: prevCols,
    afterColumnCount: nextCols
  };
}

function normalizeResultTablesForDiff(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value && typeof value === 'object' ? [value] : [];
}

function describeResultTableShape(table) {
  return {
    rowCount: Array.isArray(table?.rows) ? table.rows.length : 0,
    columnCount: Array.isArray(table?.columns) ? table.columns.length : 0
  };
}

function describeResultTablesChange(before, after) {
  const prev = normalizeResultTablesForDiff(before);
  const next = normalizeResultTablesForDiff(after);
  return {
    beforeCount: prev.length,
    afterCount: next.length,
    beforeTables: prev.map((table) => describeResultTableShape(table)),
    afterTables: next.map((table) => describeResultTableShape(table))
  };
}

// Diff two lists of records by identity rather than position, so reordering
// is not an edit and a changed item reports what changed on it.
function describeKeyedListChange(before, after, keyOf, describeItem) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const indexByKey = (list) => new Map(
    list.map((item, position) => [keyOf(item) || `index:${position}`, item])
  );
  const prevByKey = indexByKey(prev);
  const nextByKey = indexByKey(next);
  const added = [];
  const removed = [];
  const modified = [];
  for (const [key, item] of nextByKey) {
    if (!prevByKey.has(key)) {
      added.push(describeItem(item));
    } else if (safeStringify(prevByKey.get(key)) !== safeStringify(item)) {
      modified.push({
        key,
        before: describeItem(prevByKey.get(key)),
        after: describeItem(item)
      });
    }
  }
  for (const [key, item] of prevByKey) {
    if (!nextByKey.has(key)) {
      removed.push(describeItem(item));
    }
  }
  return {
    beforeCount: prev.length,
    afterCount: next.length,
    added,
    removed,
    modified
  };
}

function sampleLinkKey(link) {
  if (!link || typeof link !== 'object') {
    return '';
  }
  const placeholder = String(link.placeholderKey || '').trim();
  if (placeholder) {
    return `placeholder:${placeholder}`;
  }
  const sampleId = String(link.sampleId || link.id || '').trim();
  return sampleId ? `sample:${sampleId}` : '';
}

function describeSampleLink(link) {
  if (!link || typeof link !== 'object') {
    return {};
  }
  return {
    placeholderKey: link.placeholderKey || '',
    sampleId: link.sampleId || link.id || '',
    sampleName: link.sampleName || link.name || ''
  };
}

function toolCalculationKey(calculation) {
  if (!calculation || typeof calculation !== 'object') {
    return '';
  }
  const id = String(calculation.id || '').trim();
  return id ? `calculation:${id}` : '';
}

function describeToolCalculation(calculation) {
  if (!calculation || typeof calculation !== 'object') {
    return {};
  }
  return {
    id: calculation.id || '',
    type: calculation.type || '',
    title: calculation.title || '',
    result: truncateText(calculation.result || calculation.summary || '', SCALAR_PREVIEW_LIMIT)
  };
}

function describeProtocolSnapshotChange(before, after) {
  const prevSteps = Array.isArray(before?.steps) ? before.steps.length : 0;
  const nextSteps = Array.isArray(after?.steps) ? after.steps.length : 0;
  return {
    beforeName: String(before?.name || ''),
    afterName: String(after?.name || ''),
    beforeStepCount: prevSteps,
    afterStepCount: nextSteps
  };
}

// The identity-keyed describers ignore list and key order on purpose, so they
// can report "nothing changed" for a field the stringify comparison flagged.
// Recording that as an edit is the phantom entry, not a change worth keeping.
function isEmptyIdentityChange(description) {
  if (description?.beforeCount !== description?.afterCount) {
    return false;
  }
  return ['added', 'removed', 'modified'].every((key) => {
    const value = description?.[key];
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return isPlainObject(value) && Object.keys(value).length === 0;
  });
}

function describeFieldChange(field, before, after) {
  switch (field) {
    case 'result':
      return describeTextChange(before, after);
    case 'values':
      return describeKeyedObjectChange(before, after);
    case 'resultFiles':
      return describeStringArrayChange(before, after);
    case 'resultTable':
      return describeResultTableChange(before, after);
    case 'resultTables':
      return describeResultTablesChange(before, after);
    case 'sampleLinks':
      return describeKeyedListChange(before, after, sampleLinkKey, describeSampleLink);
    // Without a case of its own this fell to describeScalarChange, which
    // stringified the array to "[object Object]" for both sides.
    case 'toolCalculations':
      return describeKeyedListChange(before, after, toolCalculationKey, describeToolCalculation);
    case 'protocolSnapshot':
      return describeProtocolSnapshotChange(before, after);
    default:
      return describeScalarChange(before, after);
  }
}

// Compute a structured before/after diff between two notebook entries.
// Each changed field gets a per-field description (text length deltas,
// added/removed/modified keys for `values`, row/column counts for tables,
// etc.) so the audit log records *what* changed, not just *that* it did.
export function describeNotebookEntryChanges(previous, next, fields) {
  const fieldList = Array.isArray(fields) && fields.length ? fields : DEFAULT_DIFF_FIELDS;
  const prev = previous || {};
  const curr = next || {};
  const changes = {};
  for (const field of fieldList) {
    if (safeStringify(prev[field] ?? null) === safeStringify(curr[field] ?? null)) {
      continue;
    }
    const description = describeFieldChange(field, prev[field], curr[field]);
    if (isEmptyIdentityChange(description)) {
      continue;
    }
    changes[field] = description;
  }
  return changes;
}

export function changedFieldList(changes) {
  return changes && typeof changes === 'object' ? Object.keys(changes) : [];
}

// No caller inspects the result of a fire-and-forget log write, so a page log
// that silently stopped recording would never be noticed. Warn instead.
function reportLogFailure(error) {
  console.warn('Notebook page log not written:', error);
  return { ok: false, error };
}

// Fire-and-forget: log a notebook page activity. Returns a promise that
// resolves with the IPC result, but callers should not await — log writes
// must never block user-facing actions.
export function logNotebookPageEvent({
  entry,
  storagePath,
  action,
  summary = '',
  details = {}
} = {}) {
  const appendLog = window?.hikariApi?.appendNotebookPageLog;
  if (typeof appendLog !== 'function') {
    return Promise.resolve(reportLogFailure('appendNotebookPageLog unavailable'));
  }
  const storageFolder = String(entry?.storageFolder || '').trim();
  const root = String(storagePath || '').trim();
  if (!storageFolder || !root || !isPathInsideRoot(root, storageFolder)) {
    return Promise.resolve(reportLogFailure('storageFolder is not inside storagePath'));
  }
  const cleanAction = safeString(action, 80);
  if (!cleanAction) {
    return Promise.resolve(reportLogFailure('missing action'));
  }
  return appendLog({
    storagePath: root,
    storageFolder,
    entryId: safeString(entry?.id, 200),
    action: cleanAction,
    summary: safeString(summary, 600),
    details: ensureDetails(details),
    timestamp: new Date().toISOString()
  })
    .then((result) => (result?.ok ? result : reportLogFailure(String(result?.error || 'unknown error'))))
    .catch((error) => reportLogFailure(String(error?.message || error)));
}
