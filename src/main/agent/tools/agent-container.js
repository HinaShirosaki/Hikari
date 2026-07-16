'use strict';

const CONTAINER_ACTIONS = Object.freeze([
  'create',
  'read',
  'list',
  'update',
  'replace_range',
  'rename',
  'delete',
  'clear'
]);

const MAX_NAME_LENGTH = 160;
const MAX_STRING_LENGTH = 120000;
const MAX_SOURCE_LENGTH = 1200;
const MAX_LIST_LIMIT = 50;

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function rawString(value, maxLength = MAX_STRING_LENGTH) {
  const text = String(value ?? '');
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeValue(value) {
  if (typeof value === 'string') {
    return {
      ok: true,
      value: rawString(value, MAX_STRING_LENGTH),
      value_type: 'string'
    };
  }
  if (isFiniteNumber(value)) {
    return {
      ok: true,
      value,
      value_type: 'number'
    };
  }
  return {
    ok: false,
    status: 'invalid_value',
    error: 'Container value must be a string or finite number.'
  };
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toListLimit(value) {
  const parsed = toInteger(value, MAX_LIST_LIMIT);
  return Math.max(1, Math.min(MAX_LIST_LIMIT, parsed));
}

function previewValue(value) {
  if (typeof value === 'number') {
    return value;
  }
  return rawString(value, 240);
}

function buildContainerRecord({ id = '', name = '', value, source = '', createdAt = '', updatedAt = '' } = {}) {
  const normalized = normalizeValue(value);
  const valueType = normalized.ok ? normalized.value_type : '';
  return {
    id: cleanText(id, 40),
    name: cleanText(name, MAX_NAME_LENGTH),
    value: normalized.ok ? normalized.value : '',
    value_type: valueType,
    source: cleanText(source, MAX_SOURCE_LENGTH),
    created_at: cleanText(createdAt, 80),
    updated_at: cleanText(updatedAt || createdAt, 80)
  };
}

function cloneContainer(container = {}) {
  return buildContainerRecord(container);
}

function serializeContainer(container = {}) {
  const record = cloneContainer(container);
  return {
    ...record,
    length: typeof record.value === 'string' ? record.value.length : null,
    value_preview: previewValue(record.value)
  };
}

function serializeContainerSummary(container = {}) {
  const record = cloneContainer(container);
  return {
    id: record.id,
    name: record.name,
    value_type: record.value_type,
    length: typeof record.value === 'string' ? record.value.length : null,
    value_preview: previewValue(record.value),
    source: record.source,
    updated_at: record.updated_at
  };
}

function createAgentContainerRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const containers = new Map();
  let nextId = 1;

  function allocateId() {
    let id = String(nextId);
    nextId += 1;
    while (containers.has(id)) {
      id = String(nextId);
      nextId += 1;
    }
    return id;
  }

  function findByName(name = '') {
    const normalizedName = cleanText(name, MAX_NAME_LENGTH).toLowerCase();
    if (!normalizedName) {
      return null;
    }
    for (const container of containers.values()) {
      if (cleanText(container.name, MAX_NAME_LENGTH).toLowerCase() === normalizedName) {
        return container;
      }
    }
    return null;
  }

  function resolveContainer(input = {}) {
    const source = ensureObject(input);
    const id = cleanText(source.id, 40);
    if (id && containers.has(id)) {
      return containers.get(id);
    }
    const name = cleanText(source.name, MAX_NAME_LENGTH);
    if (name) {
      return findByName(name);
    }
    return null;
  }

  function missingContainer(input = {}) {
    const source = ensureObject(input);
    const id = cleanText(source.id, 40);
    const name = cleanText(source.name, MAX_NAME_LENGTH);
    return {
      ok: false,
      status: 'not_found',
      error: id
        ? `No container exists with id ${id}.`
        : (name ? `No container exists named "${name}".` : 'No container id or name was provided.')
    };
  }

  function create(input = {}) {
    const source = ensureObject(input);
    const normalized = normalizeValue(source.value);
    if (!normalized.ok) {
      return normalized;
    }
    const timestamp = now();
    const container = buildContainerRecord({
      id: allocateId(),
      name: cleanText(source.name, MAX_NAME_LENGTH),
      value: normalized.value,
      source: cleanText(source.source, MAX_SOURCE_LENGTH),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    containers.set(container.id, container);
    return {
      ok: true,
      status: 'created',
      container: serializeContainer(container),
      summary: `Created container ${container.id}${container.name ? ` (${container.name})` : ''}.`
    };
  }

  function read(input = {}) {
    const container = resolveContainer(input);
    if (!container) {
      return missingContainer(input);
    }
    return {
      ok: true,
      status: 'read',
      container: serializeContainer(container),
      summary: `Read container ${container.id}.`
    };
  }

  function list(input = {}) {
    const limit = toListLimit(input.limit);
    const items = [...containers.values()]
      .slice(0, limit)
      .map(serializeContainerSummary);
    return {
      ok: true,
      status: 'listed',
      items,
      count: items.length,
      total_count: containers.size,
      summary: `Listed ${items.length} container${items.length === 1 ? '' : 's'}.`
    };
  }

  function update(input = {}) {
    const container = resolveContainer(input);
    if (!container) {
      return missingContainer(input);
    }
    const normalized = normalizeValue(input.value);
    if (!normalized.ok) {
      return normalized;
    }
    container.value = normalized.value;
    container.value_type = normalized.value_type;
    container.source = cleanText(input.source || container.source, MAX_SOURCE_LENGTH);
    container.updated_at = now();
    return {
      ok: true,
      status: 'updated',
      container: serializeContainer(container),
      summary: `Updated container ${container.id}.`
    };
  }

  function replaceRange(input = {}) {
    const container = resolveContainer(input);
    if (!container) {
      return missingContainer(input);
    }
    if (typeof container.value !== 'string') {
      return {
        ok: false,
        status: 'invalid_value_type',
        error: 'replace_range can only edit string containers.'
      };
    }
    const replacement = rawString(input.replacement ?? '', MAX_STRING_LENGTH);
    const start = Math.max(0, toInteger(input.start, 0));
    const end = Object.prototype.hasOwnProperty.call(input, 'end')
      ? Math.max(start, toInteger(input.end, start))
      : start;
    if (start > container.value.length || end > container.value.length) {
      return {
        ok: false,
        status: 'range_out_of_bounds',
        error: `String range ${start}:${end} is outside container ${container.id} length ${container.value.length}.`
      };
    }
    const nextValue = `${container.value.slice(0, start)}${replacement}${container.value.slice(end)}`;
    if (nextValue.length > MAX_STRING_LENGTH) {
      return {
        ok: false,
        status: 'value_too_large',
        error: `Edited string exceeds the ${MAX_STRING_LENGTH} character limit.`
      };
    }
    container.value = nextValue;
    container.updated_at = now();
    return {
      ok: true,
      status: 'replaced',
      container: serializeContainer(container),
      range: {
        start,
        end,
        inserted_length: replacement.length
      },
      summary: `Edited container ${container.id} at ${start}:${end}.`
    };
  }

  function rename(input = {}) {
    const container = resolveContainer(input);
    if (!container) {
      return missingContainer(input);
    }
    container.name = cleanText(input.new_name, MAX_NAME_LENGTH);
    container.updated_at = now();
    return {
      ok: true,
      status: 'renamed',
      container: serializeContainer(container),
      summary: `Renamed container ${container.id}.`
    };
  }

  function deleteContainer(input = {}) {
    const container = resolveContainer(input);
    if (!container) {
      return missingContainer(input);
    }
    containers.delete(container.id);
    return {
      ok: true,
      status: 'deleted',
      id: container.id,
      summary: `Deleted container ${container.id}.`
    };
  }

  function clear() {
    const count = containers.size;
    containers.clear();
    return {
      ok: true,
      status: 'cleared',
      count,
      summary: `Cleared ${count} container${count === 1 ? '' : 's'}.`
    };
  }

  async function execute(input = {}) {
    const action = cleanText(input.action, 40) || 'list';
    if (!CONTAINER_ACTIONS.includes(action)) {
      return {
        ok: false,
        status: 'invalid_action',
        error: `Unsupported container action "${action}".`
      };
    }
    if (action === 'create') {
      return create(input);
    }
    if (action === 'read') {
      return read(input);
    }
    if (action === 'list') {
      return list(input);
    }
    if (action === 'update') {
      return update(input);
    }
    if (action === 'replace_range') {
      return replaceRange(input);
    }
    if (action === 'rename') {
      return rename(input);
    }
    if (action === 'delete') {
      return deleteContainer(input);
    }
    return clear();
  }

  return {
    execute,
    listContainers: () => [...containers.values()].map(cloneContainer),
    getContainer: (input = {}) => {
      const container = resolveContainer(input);
      return container ? cloneContainer(container) : null;
    }
  };
}

module.exports = {
  CONTAINER_ACTIONS,
  createAgentContainerRuntime
};
