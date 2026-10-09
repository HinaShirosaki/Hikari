// History stores changes, not whole-app snapshots. Records in collections are
// addressed by id so another module can insert/delete a different record safely.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const recordArray = value => Array.isArray(value)
  && value.every(item => object(item) && typeof item.id === 'string' && item.id)
  && new Set(value.map(item => item.id)).size === value.length;

export function captureHistoryState(state) {
  // Save acknowledgments advance this persistence token asynchronously. It is
  // not an edit and must never be rolled back with the user's document content.
  return JSON.parse(JSON.stringify(state, (key, value) => key === 'markdownRevision' ? undefined : value));
}

export function diffHistoryState(before, after, path = [], changes = []) {
  if (equal(before, after)) return changes;
  if (object(before) && object(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffHistoryState(before[key], after[key], [...path, key], changes);
    }
  } else if (recordArray(before) && recordArray(after)) {
    const previous = new Map(before.map(item => [item.id, item]));
    const next = new Map(after.map(item => [item.id, item]));
    const oldOrder = before.filter(item => next.has(item.id)).map(item => item.id);
    const newOrder = after.filter(item => previous.has(item.id)).map(item => item.id);
    if (!equal(oldOrder, newOrder)) {
      changes.push({ path, before, after });
      return changes;
    }
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const start = changes.length;
      diffHistoryState(previous.get(id), next.get(id), [...path, { id }], changes);
      // Preserve placement when re-inserting a deleted/created record.
      if (!previous.has(id) || !next.has(id)) {
        const list = previous.has(id) ? before : after;
        if (changes[start]) changes[start].index = list.findIndex(item => item.id === id);
      }
    }
  } else {
    changes.push({ path, before, after });
  }
  return changes;
}

function child(value, segment) {
  return typeof segment === 'object'
    ? (Array.isArray(value) ? value.find(item => item.id === segment.id) : undefined)
    : value && Object.hasOwn(value, segment) ? value[segment] : undefined;
}

function read(state, path) {
  return path.reduce(child, state);
}

function restoreValue(value, current) {
  if (Array.isArray(value)) {
    const records = recordArray(value) && recordArray(current);
    const byId = records ? new Map(current.map(item => [item.id, item])) : null;
    return value.map((item, index) => restoreValue(item, byId ? byId.get(item.id) : current?.[index]));
  }
  if (!object(value)) return value;
  const restored = clone(value);
  for (const key of Object.keys(restored)) restored[key] = restoreValue(restored[key], current?.[key]);
  if (object(current) && Object.hasOwn(current, 'markdownRevision')) {
    restored.markdownRevision = clone(current.markdownRevision);
  }
  return restored;
}

function write(state, change, value) {
  const parent = read(state, change.path.slice(0, -1));
  const segment = change.path.at(-1);
  if (typeof segment === 'object') {
    const index = parent.findIndex(item => item.id === segment.id);
    if (value === undefined) parent.splice(index, 1);
    else if (index >= 0) parent[index] = restoreValue(value, parent[index]);
    else parent.splice(Math.min(change.index ?? parent.length, parent.length), 0, restoreValue(value));
  } else if (value === undefined) {
    delete parent[segment];
  } else {
    // Define an own property rather than invoking a prototype setter.
    Object.defineProperty(parent, segment, { value: restoreValue(value, parent[segment]), writable: true, enumerable: true, configurable: true });
  }
}

export function historyChangesOverlap(first, second) {
  return first.some(a => second.some(b => {
    const length = Math.min(a.path.length, b.path.length);
    return a.path.slice(0, length).every((part, index) => equal(part, b.path[index]));
  }));
}

export function canApplyHistoryChanges(state, changes, direction) {
  const snapshot = captureHistoryState(state);
  const expected = direction === 'undo' ? 'after' : 'before';
  return changes.every(change => read(snapshot, change.path.slice(0, -1)) != null
    && equal(read(snapshot, change.path), change[expected]));
}

export function applyHistoryChanges(state, changes, direction) {
  const target = direction === 'undo' ? 'before' : 'after';
  // All preconditions are checked before any write. A linked operation either
  // restores every changed record or leaves every record untouched.
  if (!canApplyHistoryChanges(state, changes, direction)) return false;
  // Remove records before re-inserting others at their saved positions. A
  // replacement batch can otherwise shift those positions during undo.
  const isRecordRemoval = change => typeof change.path.at(-1) === 'object' && change[target] === undefined;
  for (const change of changes.filter(isRecordRemoval)) write(state, change, undefined);
  for (const change of changes.filter(change => !isRecordRemoval(change))) write(state, change, change[target]);
  return true;
}

export function removesReferencedHistoryRecord(state, changes, direction) {
  const source = direction === 'undo' ? 'after' : 'before';
  const target = direction === 'undo' ? 'before' : 'after';
  const removedIds = new Set(changes.filter(change => change[target] === undefined && object(change[source])
    && typeof change.path.at(-1) === 'object').map(change => change[source].id));
  if (!removedIds.size) return false;
  const next = captureHistoryState(state);
  if (!applyHistoryChanges(next, changes, direction)) return false;
  const referencesRemovedRecord = (value, key = '') => {
    if (typeof value === 'string') return key !== 'id' && removedIds.has(value);
    return value !== null && typeof value === 'object'
      && Object.entries(value).some(([childKey, childValue]) => referencesRemovedRecord(childValue, childKey));
  };
  return referencesRemovedRecord(next);
}

export function mergeHistoryChanges(previous, next) {
  // Parent/child replacements need two separate steps; merging their paths
  // would make the preconditions contradictory.
  if (previous.some(a => next.some(b => !equal(a.path, b.path) && historyChangesOverlap([a], [b])))) return null;
  const merged = previous.map(change => ({ ...change }));
  for (const change of next) {
    const existing = merged.find(item => equal(item.path, change.path));
    if (existing) existing.after = change.after;
    else merged.push(change);
  }
  return merged.filter(change => !equal(change.before, change.after));
}
