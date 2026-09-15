'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const {
  defaultAsArray,
  defaultCleanText
} = require('../../lib/llm/runtime-helpers.js');

const MEMORY_ACTIONS = Object.freeze({
  RECALL: 'recall',
  REMEMBER: 'remember',
  FORGET: 'forget',
  LIST: 'list'
});

function createMemoryId() {
  return `memory-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createAgentMemoryRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createMemoryId;
  const fsModule = deps.fs && typeof deps.fs.readFile === 'function' ? deps.fs : fs;
  // A getter lets the file follow the storage root when it moves at runtime.
  const resolveMemoryFilePath = typeof deps.memoryFilePath === 'function'
    ? () => cleanText(deps.memoryFilePath(), 2400)
    : () => cleanText(deps.memoryFilePath, 2400);
  const store = deps.store instanceof Map ? deps.store : new Map();
  let loadedPath = null;
  let queue = Promise.resolve();

  // Capture the destination before queueing so a root switch cannot redirect a write.
  function transaction(work, input = {}) {
    const destination = resolveMemoryFilePath();
    const pending = queue.then(async () => {
      await ensureLoaded(destination);
      const previous = new Map(store);
      try {
        return await work(input);
      } catch (error) {
        store.clear();
        previous.forEach((record, id) => store.set(id, record));
        throw error;
      }
    });
    queue = pending.catch(() => {});
    return pending;
  }

  function normalizeAction(value) {
    const normalized = cleanText(value, 40).toLowerCase();
    return Object.values(MEMORY_ACTIONS).includes(normalized) ? normalized : '';
  }

  function normalizeTags(tags, max = 12) {
    const seen = new Set();
    const out = [];
    asArray(tags).forEach((tag) => {
      const normalized = cleanText(tag, 80).toLowerCase();
      if (!normalized || seen.has(normalized) || out.length >= max) {
        return;
      }
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }

  function normalizeValue(value) {
    if (value === undefined) {
      return null;
    }
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      return value;
    }
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return cloneJson(value, null);
    }
    return cleanText(value, 4000);
  }

  function normalizeMemoryRecord(source, fallbackId = '') {
    const raw = ensureObject(source);
    return {
      id: cleanText(raw.id, 160) || cleanText(fallbackId, 160) || createId(),
      category: cleanText(raw.category, 120),
      key: cleanText(raw.key, 220),
      summary: cleanText(raw.summary, 600),
      value: normalizeValue(raw.value),
      scope: raw.scope === 'global' ? 'global' : ((raw.project_id || raw.project_name || raw.projectName || raw.scope === 'project') ? 'project' : 'global'),
      project_id: raw.scope === 'global' ? '' : cleanText(raw.project_id, 220),
      project_name: raw.scope === 'global' ? '' : cleanText(raw.project_name || raw.projectName, 220),
      tags: normalizeTags(raw.tags),
      source: cleanText(raw.source, 120),
      created_at: cleanText(raw.created_at || raw.createdAt, 80),
      updated_at: cleanText(raw.updated_at || raw.updatedAt, 80)
    };
  }

  function serializeRecords() {
    return [...store.values()]
      .map((record) => normalizeMemoryRecord(record))
      .sort((left, right) => String(left.updated_at || left.created_at).localeCompare(String(right.updated_at || right.created_at)));
  }

  async function ensureLoaded(memoryFilePath) {
    if (loadedPath === memoryFilePath) return;
    let records = [];
    if (memoryFilePath) {
      try {
        const parsed = JSON.parse(await fsModule.readFile(memoryFilePath, 'utf8'));
        if (!Array.isArray(parsed) && !Array.isArray(parsed?.items)) {
          throw new Error('Invalid agent memory file: expected an items array.');
        }
        records = Array.isArray(parsed) ? parsed : parsed.items;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    } else if (loadedPath === null) {
      records = [...store.values()];
    }
    const normalized = records.map((record) => normalizeMemoryRecord(record));
    store.clear();
    normalized.forEach((record) => store.set(record.id, record));
    loadedPath = memoryFilePath;
  }

  async function persist() {
    const memoryFilePath = loadedPath;
    if (!memoryFilePath) return;
    await fsModule.mkdir(path.dirname(memoryFilePath), { recursive: true });
    const temporaryPath = `${memoryFilePath}.${randomUUID()}.tmp`;
    try {
      await fsModule.writeFile(temporaryPath, JSON.stringify({
        schema_version: '1.1.0', items: serializeRecords()
      }, null, 2), 'utf8');
      await fsModule.rename(temporaryPath, memoryFilePath);
    } catch (error) {
      await fsModule.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  function buildLookupTokens(record) {
    const source = normalizeMemoryRecord(record);
    const valueText = typeof source.value === 'string'
      ? source.value
      : JSON.stringify(source.value || {});
    return [
      source.category,
      source.key,
      source.summary,
      source.project_name,
      source.source,
      ...source.tags,
      valueText
    ].join(' ').toLowerCase();
  }

  function matchesFilters(record, input = {}) {
    const source = normalizeMemoryRecord(record);
    const query = cleanText(input.query, 320).toLowerCase();
    const id = cleanText(input.id, 160);
    const key = cleanText(input.key, 220).toLowerCase();
    const category = cleanText(input.category, 120).toLowerCase();
    const projectName = cleanText(input.project_name || input.projectName, 220).toLowerCase();
    const tags = normalizeTags(input.tags);

    if (id && source.id !== id) {
      return false;
    }
    if (key && source.key.toLowerCase() !== key) {
      return false;
    }
    if (category && source.category.toLowerCase() !== category) {
      return false;
    }
    const projectId = cleanText(input.project_id, 220);
    if (input.scope === 'global' && source.scope !== 'global') return false;
    if (input.scope === 'project' && source.scope !== 'project' && !input.include_global) return false;
    if (input.scope !== 'global' && (projectId || projectName)) {
      const projectMatch = projectId
        ? (source.project_id === projectId || (!source.project_id && projectName && source.project_name.toLowerCase() === projectName))
        : source.project_name.toLowerCase() === projectName;
      if (!projectMatch && !(input.include_global && source.scope === 'global')) return false;
    }
    if (tags.length && !tags.every((tag) => source.tags.includes(tag))) {
      return false;
    }
    if (query) {
      return queryScore(source, query) > 0;
    }
    return true;
  }

  function findByStableKey(record) {
    const normalized = normalizeMemoryRecord(record);
    if (!normalized.key) {
      return null;
    }
    return [...store.values()].find((existing) => {
      const candidate = normalizeMemoryRecord(existing);
      return candidate.key.toLowerCase() === normalized.key.toLowerCase()
        && candidate.category.toLowerCase() === normalized.category.toLowerCase()
        && candidate.scope === normalized.scope
        && (candidate.project_id && normalized.project_id
          ? candidate.project_id === normalized.project_id
          : candidate.project_name.toLowerCase() === normalized.project_name.toLowerCase());
    }) || null;
  }

  async function remember(input = {}) {
    const source = {
      ...ensureObject(input.record),
      ...ensureObject(input)
    };
    const candidate = normalizeMemoryRecord(source);
    if (candidate.scope === 'project' && !candidate.project_id && !candidate.project_name) {
      return { ok: false, status: 'error', error: 'Project memory requires project_id or project_name.' };
    }
    if (!candidate.key) {
      return {
        ok: false,
        status: 'error',
        error: 'remember requires key.'
      };
    }
    if (!candidate.summary && candidate.value === null) {
      return {
        ok: false,
        status: 'error',
        error: 'remember requires summary or value.'
      };
    }

    const existing = findByStableKey(candidate);
    if (store.has(candidate.id) && existing?.id !== candidate.id) {
      return { ok: false, status: 'error', error: 'Memory id belongs to a different key or scope.' };
    }
    const timestamp = now();
    const nextRecord = existing
      ? {
        ...normalizeMemoryRecord(existing),
        ...candidate,
        id: normalizeMemoryRecord(existing).id,
        project_id: candidate.project_id || existing.project_id || '',
        created_at: normalizeMemoryRecord(existing).created_at || timestamp,
        updated_at: timestamp
      }
      : {
        ...candidate,
        created_at: timestamp,
        updated_at: timestamp
      };
    store.set(nextRecord.id, nextRecord);
    await persist();
    return {
      ok: true,
      status: existing ? 'updated' : 'stored',
      item: cloneJson(nextRecord, {}),
      items: [cloneJson(nextRecord, {})],
      summary: existing
        ? `Updated memory for ${nextRecord.key}.`
        : `Stored memory for ${nextRecord.key}.`
    };
  }

  function queryScore(record, query) {
    const text = buildLookupTokens(record);
    const words = query.match(/[\p{L}\p{N}_-]+/gu) || [];
    if (!words.length) return text.includes(query) ? 1 : 0;
    if (!words.every((word) => text.includes(word))) return 0;
    const title = `${record.key} ${record.summary}`.toLowerCase();
    return (text.includes(query) ? 10 : 0) + words.reduce((score, word) => score + (title.includes(word) ? 2 : 1), 0);
  }

  async function recall(input = {}) {
    const limit = Math.max(1, Math.min(50, Number.isFinite(Number(input.limit)) ? Number(input.limit) : 10));
    const items = serializeRecords()
      .filter((record) => matchesFilters(record, input))
      .reverse()
      .sort((a, b) => {
        const query = cleanText(input.query, 320).toLowerCase();
        return query ? queryScore(b, query) - queryScore(a, query) : 0;
      })
      .slice(0, limit);
    return {
      ok: true,
      status: items.length ? 'matched' : 'empty',
      items: cloneJson(items, []),
      summary: items.length
        ? `Recalled ${items.length} memory item${items.length === 1 ? '' : 's'}.`
        : 'No matching long-term memory items were found.'
    };
  }

  async function list(input = {}) {
    return recall({
      ...input,
      query: ''
    });
  }

  async function forget(input = {}) {
    if (!cleanText(input.id, 160) && !cleanText(input.key, 220)) {
      return { ok: false, status: 'error', error: 'forget requires an exact id or key; bulk deletion is not supported.' };
    }
    input = { ...input, include_global: false };
    const matches = serializeRecords().filter((record) => matchesFilters(record, input));
    matches.forEach((record) => {
      store.delete(record.id);
    });
    await persist();
    return {
      ok: true,
      status: matches.length ? 'forgotten' : 'empty',
      removed_count: matches.length,
      items: cloneJson(matches, []),
      summary: matches.length
        ? `Forgot ${matches.length} memory item${matches.length === 1 ? '' : 's'}.`
        : 'No matching memory items were removed.'
    };
  }

  async function execute(input = {}) {
    const action = normalizeAction(input.action);
    if (!action) {
      return {
        ok: false,
        status: 'error',
        error: 'memory action must be one of recall, remember, forget, or list.'
      };
    }
    if (action === MEMORY_ACTIONS.REMEMBER) {
      return remember(input);
    }
    if (action === MEMORY_ACTIONS.FORGET) {
      return forget(input);
    }
    if (action === MEMORY_ACTIONS.LIST) {
      return list(input);
    }
    return recall(input);
  }

  return {
    remember: (input) => transaction(remember, input),
    recall: (input) => transaction(recall, input),
    forget: (input) => transaction(forget, input),
    list: (input) => transaction(list, input),
    execute: (input) => transaction(execute, input)
  };
}

module.exports = {
  MEMORY_ACTIONS,
  createAgentMemoryRuntime
};
