'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
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

function createMemoryId() {
  return `memory-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createAgentMemoryRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createMemoryId;
  const fsModule = deps.fs && typeof deps.fs.readFile === 'function' ? deps.fs : fs;
  const memoryFilePath = cleanText(deps.memoryFilePath, 2400);
  const store = deps.store instanceof Map ? deps.store : new Map();
  let hasLoaded = memoryFilePath ? false : true;

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
      project_name: cleanText(raw.project_name || raw.projectName, 220),
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

  async function ensureLoaded() {
    if (hasLoaded || !memoryFilePath) {
      return;
    }
    hasLoaded = true;
    try {
      const raw = await fsModule.readFile(memoryFilePath, 'utf8');
      const parsed = JSON.parse(String(raw || '{}'));
      const records = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.items) ? parsed.items : []);
      store.clear();
      records.forEach((record) => {
        const normalized = normalizeMemoryRecord(record);
        if (normalized.id) {
          store.set(normalized.id, normalized);
        }
      });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  async function persist() {
    if (!memoryFilePath) {
      return;
    }
    await fsModule.mkdir(path.dirname(memoryFilePath), { recursive: true });
    await fsModule.writeFile(
      memoryFilePath,
      JSON.stringify({
        schema_version: '1.0.0',
        items: serializeRecords()
      }, null, 2),
      'utf8'
    );
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
    if (projectName && source.project_name.toLowerCase() !== projectName) {
      return false;
    }
    if (tags.length && !tags.every((tag) => source.tags.includes(tag))) {
      return false;
    }
    if (query) {
      return buildLookupTokens(source).includes(query);
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
        && candidate.project_name.toLowerCase() === normalized.project_name.toLowerCase();
    }) || null;
  }

  async function remember(input = {}) {
    await ensureLoaded();
    const source = {
      ...ensureObject(input.record),
      ...ensureObject(input)
    };
    const candidate = normalizeMemoryRecord({
      id: source.id,
      category: source.category,
      key: source.key,
      summary: source.summary,
      value: source.value,
      project_name: source.project_name,
      tags: source.tags,
      source: source.source,
      created_at: source.created_at,
      updated_at: source.updated_at
    });
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
    const timestamp = now();
    const nextRecord = existing
      ? {
        ...normalizeMemoryRecord(existing),
        ...candidate,
        id: normalizeMemoryRecord(existing).id,
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

  async function recall(input = {}) {
    await ensureLoaded();
    const limit = Math.max(1, Math.min(50, Number.isFinite(Number(input.limit)) ? Number(input.limit) : 10));
    const items = serializeRecords()
      .filter((record) => matchesFilters(record, input))
      .slice(-limit)
      .reverse();
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
    await ensureLoaded();
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
    remember,
    recall,
    forget,
    list,
    execute
  };
}

module.exports = {
  MEMORY_ACTIONS,
  createAgentMemoryRuntime
};
