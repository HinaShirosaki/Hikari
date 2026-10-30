// Decides, for a new page of a protocol, which placeholders may be offered a
// value from previous runs and which must always be entered fresh.
//
//   identity  — which sample / plasmid / cell line. Never suggested: a wrong
//               prefilled sample name looks correct and nobody catches it.
//   parameter — volume, temperature, time… Suggested only when every recent
//               run of this protocol used the same value, and even then only
//               as ghost text the user has to accept.
//
// A placeholder is identity when its name resolves to a sample type (same
// resolver the inline sample suggestions use) or when any previous run linked
// a sample to it.

const DEFAULT_HISTORY = 5;

function placeholderKeysOf(protocol) {
  const rows = [];
  for (const step of Array.isArray(protocol?.steps) ? protocol.steps : []) {
    for (const placeholder of Array.isArray(step?.placeholders) ? step.placeholders : []) {
      rows.push({
        key: String(placeholder?.id || ''),
        name: String(placeholder?.name || '').trim()
      });
    }
  }
  return rows;
}

function entryTime(entry) {
  return String(entry?.executedAt || entry?.updatedAt || entry?.createdAt || '');
}

// The same protocol edited later can carry new placeholder ids; fall back to
// the name when it is unambiguous within that entry's snapshot.
function valueFor(entry, key, name) {
  const values = entry?.values && typeof entry.values === 'object' ? entry.values : {};
  if (Object.prototype.hasOwnProperty.call(values, key)) {
    return String(values[key] || '').trim();
  }
  const byName = placeholderKeysOf(entry?.protocolSnapshot).filter((row) => row.name === name);
  return byName.length === 1 ? String(values[byName[0].key] || '').trim() : '';
}

export function buildPlaceholderPrefill({
  protocol,
  entries = [],
  resolveType = () => '',
  history = DEFAULT_HISTORY
} = {}) {
  const protocolId = String(protocol?.id || '').trim();
  const recent = (Array.isArray(entries) ? entries : [])
    .filter((entry) => protocolId && String(entry?.protocolId || '').trim() === protocolId)
    .sort((a, b) => entryTime(b).localeCompare(entryTime(a)))
    .slice(0, history);
  const linkedNames = new Set();
  const linkedKeys = new Set();
  for (const entry of recent) {
    for (const link of Array.isArray(entry?.sampleLinks) ? entry.sampleLinks : []) {
      if (link?.placeholderKey) linkedKeys.add(String(link.placeholderKey));
      if (link?.placeholderName) linkedNames.add(String(link.placeholderName).trim());
    }
  }

  const result = {};
  for (const { key, name } of placeholderKeysOf(protocol)) {
    if (resolveType(name) || linkedKeys.has(key) || linkedNames.has(name)) {
      result[key] = { kind: 'identity', suggestion: '' };
      continue;
    }
    const seen = recent.map((entry) => valueFor(entry, key, name)).filter(Boolean);
    const stable = seen.length > 0 && seen.every((value) => value === seen[0]);
    result[key] = { kind: 'parameter', suggestion: stable ? seen[0] : '' };
  }
  return result;
}
