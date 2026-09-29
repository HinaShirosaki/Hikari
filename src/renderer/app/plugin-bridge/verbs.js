import { normalizeNotebookResultTable, normalizeNotebookResultTables } from '../../lib/notebook-result-tables.js';
import { MAX_PLUGIN_STORAGE_CHARS, measurePluginStorageValue } from '../../lib/plugin-storage.js';
import { setSharedLeftRailWidth } from '../shared-left-rail.js';
import { asArray } from '../../lib/normalize.js';
import { MAX_FILE_BASE64_CHARS, MAX_LIST_SIZE, MAX_PYTHON_CODE_CHARS, MAX_PYTHON_INPUT_CHARS, MAX_PYTHON_INPUT_FILES, MAX_PYTHON_OUTPUT_CHARS, asObject, buildPluginAppContext, isCanonicalBase64, migrateLegacyGelRecords, readPluginStorage, resolvePluginFilePath, text } from './helpers.js';

const MAX_NOTIFICATION_MESSAGE_CHARS = 1000;
const DEFAULT_NOTIFICATION_DURATION_MS = 5000;
const MIN_NOTIFICATION_DURATION_MS = 1000;
const MAX_NOTIFICATION_DURATION_MS = 15000;
const NOTIFICATION_TYPES = Object.freeze(['success', 'error']);

// Every verb declares the permission it needs. A verb with an unlisted
// permission is unreachable, so adding a handler is not enough to expose data.
const VERBS = {
  // internal + bundledPluginId: only the bundled Gel plugin may call this, and
  // it is hidden from the public verb list (see plugin-bridge.js).
  'gel.takeNotebookLink': {
    permission: '',
    internal: true,
    bundledPluginId: 'gel',
    handler: (_params, { takeNotebookGel }) => takeNotebookGel()
  },
  'app.info': {
    permission: '',
    handler: (_params, { plugin, state, windowObject }) => ({
      host: 'hikari',
      pluginId: plugin.id,
      permissions: asArray(plugin.permissions),
      ...buildPluginAppContext(state, '', windowObject)
    })
  },

  'app.setLeftRailWidth': {
    // Not permission-free: this writes the host's documentElement CSS variable and
    // the host's localStorage, and the resulting layout event is broadcast to every
    // other plugin frame.
    permission: 'layout',
    handler: (params, { windowObject }) => {
      if (typeof params?.width !== 'number' || !Number.isFinite(params.width)) {
        throw new Error('app.setLeftRailWidth requires a finite numeric "width".');
      }
      return {
        leftRail: setSharedLeftRailWidth(params.width, {
          document: windowObject?.document,
          windowObject
        })
      };
    }
  },

  // Host-owned UI with explicit attribution. A plugin cannot pass its own
  // label, HTML, placement, or stacking rules, so the notice cannot masquerade
  // as an unattributed Hikari message or create a parallel notification UI.
  'notifications.show': {
    permission: 'notifications',
    handler: (params, { plugin, notify }) => {
      if (typeof params?.message !== 'string') {
        throw new Error('notifications.show requires a string "message".');
      }
      const message = params.message.trim();
      if (!message) {
        throw new Error('notifications.show requires a non-empty "message".');
      }
      if (message.length > MAX_NOTIFICATION_MESSAGE_CHARS) {
        throw new Error(
          `notifications.show rejected: ${message.length} characters exceeds the ${MAX_NOTIFICATION_MESSAGE_CHARS}-character limit.`
        );
      }

      const type = params.type === undefined ? 'success' : params.type;
      if (!NOTIFICATION_TYPES.includes(type)) {
        throw new Error('notifications.show "type" must be "success" or "error".');
      }

      const durationMs = params.durationMs === undefined
        ? DEFAULT_NOTIFICATION_DURATION_MS
        : params.durationMs;
      if (!Number.isInteger(durationMs)
        || durationMs < MIN_NOTIFICATION_DURATION_MS
        || durationMs > MAX_NOTIFICATION_DURATION_MS) {
        throw new Error(
          `notifications.show "durationMs" must be an integer from ${MIN_NOTIFICATION_DURATION_MS} to ${MAX_NOTIFICATION_DURATION_MS}.`
        );
      }
      if (typeof notify !== 'function') {
        throw new Error('Notifications are unavailable in this environment.');
      }

      const pluginLabel = (
        text(plugin?.name, 200)
        || text(plugin?.id, 200)
        || 'unknown'
      ).replace(/\s+/g, ' ');
      notify(`Plugin ${pluginLabel}: ${message}`, { type, durationMs });
      return { shown: true, type, durationMs };
    }
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
        savedAt: text(entry?.updatedAt || entry?.savedAt, 40)
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
        resultText: text(entry.result ?? entry.resultText, 20000),
        resultTables: normalizeNotebookResultTables(entry.resultTables, entry.resultTable),
        savedAt: text(entry.updatedAt || entry.savedAt, 40)
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
      // The API calls this resultText, but notebook records and the editor use
      // result. Never apply the read-response length cap to existing content.
      const previousText = String(entry.result ?? entry.resultText ?? '');
      const tables = normalizeNotebookResultTables(entry.resultTables, entry.resultTable);
      if (table) tables.push(table);
      const nextEntries = entries.slice();
      nextEntries[index] = {
        ...entry,
        result: note
          ? [previousText, note].filter(Boolean).join('\n\n')
          : previousText,
        resultTable: tables[0] || null,
        resultTables: tables,
        updatedAt: new Date().toISOString()
      };

      state.notebookEntries = nextEntries;
      try {
        persist?.();
      } catch (error) {
        state.notebookEntries = entries;
        throw error;
      }
      onNotebookEntriesChanged?.();
      return { id: entryId, appendedText: Boolean(note), appendedTable: Boolean(table) };
    }
  },

  // A plugin's own persisted blob. This is what lets a plugin keep records of
  // its own instead of pushing everything it produces into the notebook, and
  // it stays inside the "no create verbs" rule — the data belongs to the
  // plugin, not to the user's protocols, samples, or entries.
  'storage.get': {
    permission: 'storage',
    handler: (_params, { state, plugin }) => ({
      value: readPluginStorage(state, plugin.id),
      limit: MAX_PLUGIN_STORAGE_CHARS
    })
  },

  'storage.set': {
    permission: 'storage',
    handler: (params, { state, persist, plugin, onNotebookEntriesChanged }) => {
      if (!Object.prototype.hasOwnProperty.call(params, 'value')) {
        throw new Error('storage.set needs a "value" property. Pass null explicitly to clear plugin storage.');
      }
      const value = params.value;
      // measure throws on anything JSON cannot represent (a cyclic object from
      // the frame), and the dispatcher turns that into a plain error reply.
      const size = measurePluginStorageValue(value);
      if (size > MAX_PLUGIN_STORAGE_CHARS) {
        throw new Error(
          `storage.set rejected: ${size} characters exceeds the ${MAX_PLUGIN_STORAGE_CHARS}-character limit for one plugin.`
        );
      }

      const settings = asObject(state.settings);
      const previousSettings = state.settings;
      const hadStorage = Object.prototype.hasOwnProperty.call(settings, 'pluginStorage');
      const previousStorage = settings.pluginStorage;
      const stored = { ...asObject(settings.pluginStorage) };
      if (value === null) {
        delete stored[plugin.id];
      } else {
        // Round-trip through JSON so what sits in state is exactly what will
        // survive persistence — a structured-clone Map or Date from the frame
        // would otherwise be stored live and quietly change shape on reload.
        stored[plugin.id] = JSON.parse(JSON.stringify(value));
      }
      settings.pluginStorage = stored;
      state.settings = settings;
      const previousEntries = state.notebookEntries;
      // Gel's blob is the source of truth for which gels belong to which page;
      // mirror it onto entry.gelIds so notebook previews stay in sync. Rolled
      // back with the rest of the state if persist() fails below.
      const isBundledGel = plugin.id === 'gel' && plugin.bundled === true && plugin.path === '@bundled/gel';
      if (isBundledGel) {
        const gels = asArray(stored.gel?.gelAnalyses);
        state.notebookEntries = asArray(state.notebookEntries).map((entry) => ({
          ...entry,
          gelIds: gels.filter((gel) => gel.notebookEntryId === entry.id).map((gel) => gel.id)
        }));
      }
      // barrier: a plugin's blob is the index for files it already wrote to the
      // storage folder. Undoing across it would revert the index while the
      // files stay on disk, and the frame is never told the rollback happened.
      try {
        persist?.({ barrier: true });
      } catch (error) {
        if (hadStorage) settings.pluginStorage = previousStorage;
        else delete settings.pluginStorage;
        state.settings = previousSettings;
        state.notebookEntries = previousEntries;
        throw error;
      }
      if (isBundledGel) onNotebookEntriesChanged?.();
      return { bytes: size, limit: MAX_PLUGIN_STORAGE_CHARS };
    }
  },

  // Files, for the data a storage blob cannot hold — images, and anything else
  // measured in megabytes. The plugin addresses them by a path relative to its
  // own folder and never sees where that folder is.
  'files.write': {
    permission: 'files',
    handler: async (params, { state, plugin, api }) => {
      const target = resolvePluginFilePath(state, plugin.id, params?.path);
      const dataBase64 = String(params?.dataBase64 ?? '');
      if (!dataBase64) {
        throw new Error('files.write needs "dataBase64".');
      }
      if (dataBase64.length > MAX_FILE_BASE64_CHARS) {
        throw new Error(`files.write rejected: ${dataBase64.length} characters exceeds the ${MAX_FILE_BASE64_CHARS}-character limit.`);
      }
      if (!isCanonicalBase64(dataBase64)) {
        throw new Error('files.write needs canonical base64 data.');
      }
      if (typeof api?.writePluginFile !== 'function') {
        throw new Error('File storage is unavailable in this environment.');
      }
      const result = await api.writePluginFile({
        storagePath: target.root,
        pluginId: plugin.id,
        path: target.relative,
        dataBase64
      });
      if (!result?.ok) {
        throw new Error(text(result?.error, 400) || `Could not write "${target.relative}".`);
      }
      return { path: text(result.path, 2400) || target.relative };
    }
  },

  'files.read': {
    permission: 'files',
    handler: async (params, { state, plugin, api }) => {
      const target = resolvePluginFilePath(state, plugin.id, params?.path);
      if (typeof api?.readPluginFile !== 'function') {
        throw new Error('File storage is unavailable in this environment.');
      }
      const result = await api.readPluginFile({
        storagePath: target.root,
        pluginId: plugin.id,
        path: target.relative
      });
      if (!result?.ok || typeof result.dataBase64 !== 'string') {
        throw new Error(text(result?.error, 400) || `Could not read "${target.relative}".`);
      }
      return { path: target.relative, dataBase64: result.dataBase64 };
    }
  },

  // User-visible exports go through a native save dialog. This keeps the frame
  // sandbox narrow and makes the destination an explicit user choice.
  'downloads.save': {
    permission: 'downloads',
    handler: async (params, { api }) => {
      const dataBase64 = String(params?.dataBase64 ?? '');
      if (!dataBase64) {
        throw new Error('downloads.save needs "dataBase64".');
      }
      if (dataBase64.length > MAX_FILE_BASE64_CHARS) {
        throw new Error(`downloads.save rejected: ${dataBase64.length} characters exceeds the ${MAX_FILE_BASE64_CHARS}-character limit.`);
      }
      if (!isCanonicalBase64(dataBase64)) {
        throw new Error('downloads.save needs canonical base64 data.');
      }
      if (typeof api?.exportPluginFile !== 'function') {
        throw new Error('Plugin exports are unavailable in this environment.');
      }
      const result = await api.exportPluginFile({
        fileName: text(params?.fileName, 240),
        dataBase64
      });
      if (!result?.ok) {
        if (result?.canceled) {
          return { saved: false, canceled: true };
        }
        throw new Error(text(result?.error, 400) || 'Could not export the file.');
      }
      return {
        saved: true,
        fileName: text(result.fileName, 240)
      };
    }
  },

  // Runs Python in the host's sandbox (one throwaway directory per run, deleted
  // when it ends). This is the only verb that executes plugin-authored code
  // outside the frame, so it carries its own permission rather than riding on
  // `files` or `storage` — a plugin that can read a file has not thereby been
  // granted a subprocess.
  //
  // The frame supplies no filesystem path: `files` and `readbackPaths` are
  // resolved inside the run directory by the host runner, the same way the
  // agent's Python tool uses it.
  'python.run': {
    permission: 'python',
    handler: async (params, { api }) => {
      const code = String(params?.code ?? '');
      if (!code.trim()) {
        throw new Error('python.run needs "code".');
      }
      if (code.length > MAX_PYTHON_CODE_CHARS) {
        throw new Error(`python.run rejected: ${code.length} characters of code exceeds the ${MAX_PYTHON_CODE_CHARS}-character limit.`);
      }
      if (typeof api?.runPython !== 'function') {
        throw new Error('Python is unavailable in this environment.');
      }
      const files = asArray(params?.files).slice(0, MAX_PYTHON_INPUT_FILES).map((file) => ({
        path: text(asObject(file).path, 400),
        content: String(asObject(file).content ?? '')
      }));
      const inputChars = files.reduce((total, file) => total + file.content.length, 0);
      if (inputChars > MAX_PYTHON_INPUT_CHARS) {
        throw new Error(`python.run rejected: ${inputChars} characters of input files exceeds the ${MAX_PYTHON_INPUT_CHARS}-character limit.`);
      }
      const result = asObject(await api.runPython({
        code,
        files,
        readback_paths: asArray(params?.readbackPaths).map((item) => text(item, 400)),
        timeout_ms: Number(params?.timeoutMs) || undefined
      }));
      // Rebuilt, not forwarded: the host result also carries the interpreter
      // path, run id, and pid, none of which the frame asked for.
      return {
        ok: result.ok === true,
        status: text(result.status, 40),
        stdout: String(result.stdout ?? '').slice(0, MAX_PYTHON_OUTPUT_CHARS),
        stderr: String(result.stderr ?? '').slice(0, MAX_PYTHON_OUTPUT_CHARS),
        exitCode: Number.isFinite(Number(result.exit_code)) ? Number(result.exit_code) : null,
        timedOut: result.timed_out === true,
        error: text(result.error, 4000),
        files: asArray(result.readback_files).map((file) => ({
          path: text(asObject(file).path, 400),
          content: String(asObject(file).content ?? '').slice(0, MAX_PYTHON_OUTPUT_CHARS),
          truncated: asObject(file).truncated === true
        }))
      };
    }
  },

  // A plugin's own dirty flag, pushed up so the host's quit guard can list it.
  // The frame has no host DOM and the protocol has no host->plugin request, so
  // the plugin volunteers this rather than being asked at close time.
  'app.setUnsaved': {
    permission: '',
    handler: (params, { plugin, pluginUnsaved }) => {
      const unsaved = params?.unsaved === true;
      pluginUnsaved?.(plugin, unsaved);
      return { unsaved };
    }
  },

  // A plugin's own undo/redo depth, pushed up so the host's global history
  // buttons can drive the frame that owns the edits. The host cannot see inside
  // the frame, and keyboard events in a focused frame never reach it, so the
  // plugin volunteers this the same way it volunteers app.setUnsaved.
  'app.setHistory': {
    permission: '',
    handler: (params, { pluginHistory, frameWindow }) => {
      const history = {
        canUndo: params?.canUndo === true,
        canRedo: params?.canRedo === true
      };
      pluginHistory?.(frameWindow, history);
      return history;
    }
  },

  'migration.importLegacyGel': {
    permission: '',
    internal: true,
    bundledPluginId: 'gel',
    handler: (params, context) => migrateLegacyGelRecords({ ...context, skipIds: params?.skipIds })
  }
};

export {
  VERBS
};
