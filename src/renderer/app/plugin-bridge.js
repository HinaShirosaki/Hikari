// postMessage host API for sandboxed plugin iframes.
//
// Plugins run as an opaque origin with no DOM, storage, or preload access (see
// plugin-loader.js), so the only way in is a message they post to the host.
// This module owns that door: it maps each registered iframe's contentWindow
// back to the installed plugin record, checks the verb's permission against
// that record's manifest-declared permissions, and runs a handler.
//
// Wire protocol (both directions), always on window.postMessage:
//   plugin -> host: { hikari: 1, id: <string>, verb: <string>, params: <object> }
//   host -> plugin: { hikari: 1, id: <string>, ok: true,  result: <json> }
//                   { hikari: 1, id: <string>, ok: false, error: <string> }
//
// Replies are posted to '*' because the plugin's opaque origin serializes to
// "null" and cannot be targeted; the payload therefore must never carry
// anything the plugin did not already ask for and hold permission to read.

import { normalizeNotebookResultTable } from '../lib/notebook-result-tables.js';

const PROTOCOL_MARKER = 1;
const MAX_LIST_SIZE = 500;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

// Every verb declares the permission it needs. A verb with an unlisted
// permission is unreachable, so adding a handler is not enough to expose data.
const VERBS = {
  'app.info': {
    permission: '',
    handler: (_params, { plugin }) => ({
      host: 'hikari',
      pluginId: plugin.id,
      permissions: asArray(plugin.permissions)
    })
  },

  'protocols.list': {
    permission: 'protocols:read',
    handler: (_params, { state }) => asArray(state.protocols)
      .slice(0, MAX_LIST_SIZE)
      .map((protocol) => ({
        id: text(protocol?.id, 200),
        name: text(protocol?.name, 200),
        purpose: text(protocol?.purpose, 400),
        updatedAt: text(protocol?.updatedAt, 40)
      }))
  },

  'protocols.get': {
    permission: 'protocols:read',
    handler: (params, { state }) => {
      const id = text(params?.id, 200);
      const protocol = asArray(state.protocols).find((item) => item?.id === id);
      if (!protocol) {
        throw new Error(`No protocol with id "${id}".`);
      }
      return {
        id: protocol.id,
        name: text(protocol.name, 200),
        purpose: text(protocol.purpose, 4000),
        materials: asArray(protocol.materials),
        steps: asArray(protocol.steps),
        troubleshooting: text(protocol.troubleshooting, 8000),
        createdAt: text(protocol.createdAt, 40),
        updatedAt: text(protocol.updatedAt, 40)
      };
    }
  },

  'projects.list': {
    permission: 'projects:read',
    handler: (_params, { state }) => asArray(state.projects)
      .slice(0, MAX_LIST_SIZE)
      .map((project) => ({
        id: text(project?.id, 200),
        name: text(project?.name, 200)
      }))
  },

  'samples.list': {
    permission: 'samples:read',
    handler: (_params, { state }) => asArray(state.samples)
      .slice(0, MAX_LIST_SIZE)
      .map((sample) => ({
        id: text(sample?.id, 200),
        name: text(sample?.name, 200),
        type: text(sample?.type, 80)
      }))
  },

  'notebook.list': {
    permission: 'notebook:read',
    handler: (_params, { state }) => asArray(state.notebookEntries)
      .slice(0, MAX_LIST_SIZE)
      .map((entry) => ({
        id: text(entry?.id, 200),
        experimentName: text(entry?.experimentName, 200),
        protocolId: text(entry?.protocolId, 200),
        projectId: text(entry?.projectId, 200),
        savedAt: text(entry?.savedAt, 40)
      }))
  },

  'notebook.get': {
    permission: 'notebook:read',
    handler: (params, { state }) => {
      const id = text(params?.id, 200);
      const entry = asArray(state.notebookEntries).find((item) => item?.id === id);
      if (!entry) {
        throw new Error(`No notebook entry with id "${id}".`);
      }
      return {
        id: entry.id,
        experimentName: text(entry.experimentName, 200),
        protocolId: text(entry.protocolId, 200),
        projectId: text(entry.projectId, 200),
        resultText: text(entry.resultText, 20000),
        resultTables: asArray(entry.resultTables),
        savedAt: text(entry.savedAt, 40)
      };
    }
  },

  // The one write verb. It appends to an existing entry rather than creating
  // one, so a plugin can never manufacture notebook records the user did not
  // start — it can only add results to an experiment they already opened.
  'notebook.appendResult': {
    permission: 'notebook:write',
    handler: (params, { state, persist, onNotebookEntriesChanged }) => {
      const entryId = text(params?.entryId, 200);
      const entries = asArray(state.notebookEntries);
      const index = entries.findIndex((item) => item?.id === entryId);
      if (index < 0) {
        throw new Error(`No notebook entry with id "${entryId}".`);
      }

      const note = text(params?.text, 20000);
      const table = params?.table ? normalizeNotebookResultTable(params.table) : null;
      if (!note && !table) {
        throw new Error('notebook.appendResult needs a "text" string, a "table" object, or both.');
      }

      const entry = entries[index];
      const previousText = text(entry.resultText, 20000);
      entries[index] = {
        ...entry,
        resultText: note
          ? [previousText, note].filter(Boolean).join('\n\n')
          : previousText,
        resultTables: table
          ? [...asArray(entry.resultTables), table]
          : asArray(entry.resultTables)
      };

      state.notebookEntries = entries;
      persist?.();
      onNotebookEntriesChanged?.();
      return { id: entryId, appendedText: Boolean(note), appendedTable: Boolean(table) };
    }
  }
};

export function createPluginBridge({
  state,
  persist,
  onNotebookEntriesChanged,
  windowObject = globalThis.window
} = {}) {
  // contentWindow -> installed plugin record. Identity comes from the window
  // the message actually arrived from, never from anything inside the payload,
  // so a plugin cannot claim another plugin's id to borrow its permissions.
  const frames = new Map();

  function register(frameWindow, plugin) {
    if (frameWindow && plugin) {
      frames.set(frameWindow, plugin);
    }
  }

  function handleMessage(event) {
    const request = event?.data;
    if (!request || typeof request !== 'object' || request.hikari !== PROTOCOL_MARKER) {
      return;
    }
    const plugin = frames.get(event.source);
    const reply = (payload) => {
      event.source?.postMessage?.({ hikari: PROTOCOL_MARKER, id: request.id, ...payload }, '*');
    };
    if (!plugin) {
      return;
    }

    const verb = VERBS[text(request.verb, 80)];
    if (!verb) {
      reply({ ok: false, error: `Unknown verb "${text(request.verb, 80)}".` });
      return;
    }
    if (verb.permission && !asArray(plugin.permissions).includes(verb.permission)) {
      reply({
        ok: false,
        error: `Plugin "${plugin.id}" did not declare the "${verb.permission}" permission in plugin.json.`
      });
      return;
    }

    try {
      const params = request.params && typeof request.params === 'object' ? request.params : {};
      reply({ ok: true, result: verb.handler(params, { state, persist, plugin, onNotebookEntriesChanged }) });
    } catch (error) {
      reply({ ok: false, error: String(error?.message || error) });
    }
  }

  windowObject?.addEventListener?.('message', handleMessage);
  return { register, handleMessage };
}

export const PLUGIN_BRIDGE_VERBS = Object.freeze(
  Object.fromEntries(Object.entries(VERBS).map(([name, verb]) => [name, verb.permission]))
);
