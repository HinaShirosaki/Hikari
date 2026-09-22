'use strict';

const { preparePaper } = require('./compiled.js');
const caches = new WeakMap();
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

function freezeRecord(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeRecord);
  return Object.freeze(value);
}

// Shared by filesystem identity, including across the short-lived stores the MCP
// gateway constructs on each call. This bounds cache memory, never library recall.
function getIntakeRecordCache(fs) {
  if (caches.has(fs)) return caches.get(fs);
  const entries = new Map();
  let bytes = 0;
  const remove = (key) => {
    bytes -= entries.get(key)?.bytes || 0;
    entries.delete(key);
  };
  async function signature(file) {
    if (typeof fs.stat !== 'function') return null;
    try {
      const stat = await fs.stat(file);
      if (![stat.mtimeMs, stat.ctimeMs, stat.size].every(Number.isFinite)) return null;
      return [stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino].join(':');
    } catch {
      return null;
    }
  }
  async function read(file, loader, cacheable = () => true) {
    const before = await signature(file);
    const cached = entries.get(file);
    if (before && cached?.signature === before) {
      entries.delete(file);
      entries.set(file, cached);
      return cached.result;
    }
    remove(file);
    const result = await loader();
    if (!result.ok) return result;
    freezeRecord(result.record);
    const prepared = preparePaper(result.record);
    const weight = prepared.estimatedBytes + JSON.stringify(result.record).length * 2;
    // Check both sides of the read: a concurrent write must not cache a torn or
    // obsolete snapshot under the new file's timestamp. Errors are never cached.
    if (before && cacheable(result) && weight <= MAX_CACHE_BYTES && before === await signature(file)) {
      remove(file);
      while (bytes + weight > MAX_CACHE_BYTES && entries.size) remove(entries.keys().next().value);
      entries.set(file, { signature: before, result: Object.freeze(result), bytes: weight });
      bytes += weight;
    }
    return result;
  }
  const cache = { read, remove };
  caches.set(fs, cache);
  return cache;
}

module.exports = { getIntakeRecordCache };
