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
import { MAX_PLUGIN_STORAGE_CHARS, measurePluginStorageValue } from '../lib/plugin-storage.js';
import {
  getSharedLeftRailLayout,
  setSharedLeftRailWidth
} from './shared-left-rail.js';

const PROTOCOL_MARKER = 1;
const MAX_LIST_SIZE = 500;
// Same shape inspect-plugin-folder.js enforces when a plugin is installed.
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// How long the quit guard waits for a frame to answer an app.save broadcast.
const PLUGIN_SAVE_TIMEOUT_MS = 15000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// The plugin's own slice, keyed by the id the frame registry resolved — never
// by anything in the payload, so there is no key a plugin could pass to read a
// neighbour's data.
function readPluginStorage(state, pluginId) {
  return asObject(asObject(state.settings).pluginStorage)[pluginId] ?? null;
}

// Every plugin file lives under <storage root>/Plugins/<plugin id>/.
const PLUGIN_FILES_FOLDER = 'Plugins';
const MAX_FILE_BASE64_CHARS = 24000000;

// python.run bounds. The host runner enforces its own run time, stdout, and
// readback limits; these bound what a frame can push across the bridge before
// the runner ever sees it, and what comes back.
const MAX_PYTHON_CODE_CHARS = 200000;
const MAX_PYTHON_INPUT_FILES = 32;
const MAX_PYTHON_INPUT_CHARS = 4000000;
const MAX_PYTHON_OUTPUT_CHARS = 120000;

function isCanonicalBase64(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return false;
  }
  try {
    return btoa(atob(encoded)) === encoded;
  } catch {
    return false;
  }
}

// Resolves a plugin-supplied relative path into the one folder that plugin may
// touch. The validation has to happen *here*, not downstream: readFileBase64
// reads whatever absolute path it is handed, and storeImportedFile confines
// writes to the storage root but not to a subfolder of it — so neither would
// stop a plugin from reaching the user's notebook files. The frame never gets
// to supply an absolute path; this builds one from segments it has checked.
function resolvePluginFilePath(state, pluginId, rawPath) {
  const root = text(asObject(state.settings).storagePath, 2400).replace(/[\\/]+$/, '');
  if (!root) {
    throw new Error('No storage folder is configured. Set one in Settings before using files.');
  }
  // The id is half of the confining path, so it gets the same treatment as the
  // segments below. inspect-plugin-folder.js checks this at install time, but a
  // persisted settings record is re-hydrated without that check — and an id of
  // ".." would silently widen the folder this function exists to narrow.
  if (!PLUGIN_ID_PATTERN.test(String(pluginId ?? ''))) {
    throw new Error(`Invalid plugin id "${text(pluginId, 200)}".`);
  }
  const requested = String(rawPath ?? '').replace(/\\/g, '/').trim();
  const segments = requested.split('/').filter((part) => part && part !== '.');
  const unsafe = requested.startsWith('/')
    || /^[a-zA-Z]:/.test(requested)
    || segments.some((part) => part === '..' || part.includes('\0'));
  if (!segments.length || unsafe) {
    throw new Error(`Invalid plugin file path "${text(rawPath, 200)}".`);
  }
  const base = `${root}/${PLUGIN_FILES_FOLDER}/${pluginId}`;
  return {
    root,
    relative: segments.join('/'),
    folder: [base, ...segments.slice(0, -1)].join('/'),
    fileName: segments[segments.length - 1],
    absolute: [base, ...segments].join('/')
  };
}

function text(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function buildPluginAppContext(state, changed = '', windowObject = globalThis.window) {
  const settings = asObject(state?.settings);
  const appearance = asObject(settings.appearance);
  const requestedMode = text(appearance.mode, 20).toLowerCase();
  const mode = requestedMode === 'night' || requestedMode === 'miku'
    ? requestedMode
    : 'day';
  const context = {
    appearance: {
      mode,
      fontSize: Math.max(10, Math.min(32, Number(appearance.fontSize) || 16))
    },
    storage: {
      configured: Boolean(text(settings.storagePath, 2400))
    },
    layout: {
      leftRail: getSharedLeftRailLayout({
        document: windowObject?.document,
        windowObject
      })
    }
  };
  const normalizedChange = text(changed, 40);
  return normalizedChange ? { ...context, changed: normalizedChange } : context;
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function dataUrlBase64(value) {
  const source = String(value || '').trim();
  const comma = source.indexOf(',');
  return source.startsWith('data:') && comma >= 0 ? source.slice(comma + 1).trim() : '';
}

function safePluginFilePart(value, fallback = 'item') {
  const safe = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return safe || fallback;
}

async function writePluginFile({ state, plugin, api, path, dataBase64 }) {
  const target = resolvePluginFilePath(state, plugin.id, path);
  const result = await api.storeImportedFile({
    storagePath: target.root,
    targetFolder: target.folder,
    fileName: target.fileName,
    dataBase64,
    overwrite: true
  });
  if (!result?.ok && result?.ok !== undefined) {
    throw new Error(text(result?.error, 400) || `Could not write "${target.relative}".`);
  }
  const written = text(result?.relativePath, 2400)
    || `${PLUGIN_FILES_FOLDER}/${plugin.id}/${target.relative}`;
  const prefix = `${PLUGIN_FILES_FOLDER}/${plugin.id}/`;
  return written.startsWith(prefix) ? written.slice(prefix.length) : target.relative;
}

// Every place a legacy artifact might be, most specific first. The absolute
// path v1 recorded is only correct while the storage folder has not moved, so
// it can never be the *only* candidate: migration is one-shot, and a failed
// read here is written back as an empty path forever.
function resolveLegacyFilePaths(state, pathValue, relativePathValue) {
  const direct = String(pathValue || '').trim();
  const storageRoot = text(asObject(state.settings).storagePath, 2400).replace(/[\\/]+$/, '');
  const isAbsolute = direct.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(direct);
  const relatives = [isAbsolute ? '' : direct, String(relativePathValue || '').trim()];
  const candidates = [
    isAbsolute ? direct : '',
    ...(storageRoot
      ? relatives.map((value) => (value ? `${storageRoot}/${value.replace(/^[\\/]+/, '')}` : ''))
      : [])
  ];
  return [...new Set(candidates.filter(Boolean))];
}

async function readLegacyArtifact({ state, api, record, dataKey, pathKey, relativePathKey }) {
  const inline = dataUrlBase64(record?.[dataKey]);
  if (inline) {
    return inline;
  }
  for (const sourcePath of resolveLegacyFilePaths(state, record?.[pathKey], record?.[relativePathKey])) {
    const result = await api.readFileBase64(sourcePath);
    if (result?.ok && result.dataBase64) {
      return result.dataBase64;
    }
  }
  return '';
}

// One-time compatibility provider for the feature that graduated out of the
// renderer. It copies host-owned legacy artifacts into the plugin namespace and
// returns records containing only plugin-relative paths. This is an internal
// bundled-plugin hook, not a capability third-party manifests can request.
async function migrateLegacyGelRecords({ state, plugin, api, skipIds = [] }) {
  if (plugin.id !== 'gel' || plugin.bundled !== true || plugin.path !== '@bundled/gel') {
    throw new Error('The Gel v1 migration is available only to the bundled Gel plugin.');
  }
  if (typeof api?.storeImportedFile !== 'function' || typeof api?.readFileBase64 !== 'function') {
    throw new Error('Gel migration needs file storage access.');
  }
  if (!text(asObject(state.settings).storagePath, 2400)) {
    throw new Error('Choose a storage folder before importing legacy gels.');
  }

  // Ids the plugin already holds. Passing them makes this callable repeatedly,
  // so gels that arrive later (a storage-root import merges into gelAnalyses
  // long after first run) still get picked up.
  const alreadyMigrated = new Set(asArray(skipIds).map((value) => text(value, 200)).filter(Boolean));

  const migrated = [];
  // Deliberately uncapped, unlike the paged list verbs above: a record dropped
  // here is a record the user can never reach again.
  for (const sourceRecord of asArray(state.gelAnalyses)) {
    const record = asObject(sourceRecord);
    const id = text(record.id, 200);
    if (!id || alreadyMigrated.has(id)) {
      continue;
    }
    const folder = `Gels/${safePluginFilePart(record.name || id, 'gel')}__${safePluginFilePart(id, 'gel')}`;
    const next = {
      ...record,
      storageFolder: folder,
      sourceImageDataUrl: '',
      previewImageDataUrl: ''
    };

    const sourceBase64 = await readLegacyArtifact({
      state,
      api,
      record,
      dataKey: 'sourceImageDataUrl',
      pathKey: 'sourceImagePath',
      relativePathKey: 'sourceImageRelativePath'
    });
    if (sourceBase64) {
      const sourcePath = await writePluginFile({
        state,
        plugin,
        api,
        path: `${folder}/source.png`,
        dataBase64: sourceBase64
      });
      next.sourceImagePath = sourcePath;
      next.sourceImageRelativePath = sourcePath;
    } else {
      next.sourceImagePath = '';
      next.sourceImageRelativePath = '';
    }

    const previewBase64 = await readLegacyArtifact({
      state,
      api,
      record,
      dataKey: 'previewImageDataUrl',
      pathKey: 'previewImagePath',
      relativePathKey: 'previewImageRelativePath'
    });
    if (previewBase64) {
      const previewPath = await writePluginFile({
        state,
        plugin,
        api,
        path: `${folder}/preview.png`,
        dataBase64: previewBase64
      });
      next.previewImagePath = previewPath;
      next.previewImageRelativePath = previewPath;
    } else {
      next.previewImagePath = '';
      next.previewImageRelativePath = '';
    }

    const analysisResultPath = await writePluginFile({
      state,
      plugin,
      api,
      path: `${folder}/analysis-result.json`,
      dataBase64: utf8ToBase64(JSON.stringify(record.report || {}, null, 2))
    });
    next.analysisResultPath = analysisResultPath;
    next.analysisResultRelativePath = analysisResultPath;

    const metadata = { ...next };
    delete metadata.report;
    const recordJsonPath = await writePluginFile({
      state,
      plugin,
      api,
      path: `${folder}/gel-record.json`,
      dataBase64: utf8ToBase64(JSON.stringify(metadata, null, 2))
    });
    next.recordJsonPath = recordJsonPath;
    next.recordJsonRelativePath = recordJsonPath;
    migrated.push(next);
  }
  return { records: migrated };
}

// Every verb declares the permission it needs. A verb with an unlisted
// permission is unreachable, so adding a handler is not enough to expose data.
const VERBS = {
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
    handler: (params, { state, persist, plugin }) => {
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
      // barrier: a plugin's blob is the index for files it already wrote to the
      // storage folder. Undoing across it would revert the index while the
      // files stay on disk, and the frame is never told the rollback happened.
      persist?.({ barrier: true });
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
      if (typeof api?.storeImportedFile !== 'function') {
        throw new Error('File storage is unavailable in this environment.');
      }
      const result = await api.storeImportedFile({
        storagePath: target.root,
        targetFolder: target.folder,
        fileName: target.fileName,
        dataBase64,
        // The plugin owns this folder and addresses it by path, so a write to
        // the same path replaces the file instead of leaking a "_2" copy.
        overwrite: true
      });
      if (!result?.ok) {
        throw new Error(text(result?.error, 400) || `Could not write "${target.relative}".`);
      }
      // The path the plugin gets back is the one that was actually written.
      const written = text(result?.relativePath, 2400)
        || `${PLUGIN_FILES_FOLDER}/${plugin.id}/${target.relative}`;
      const prefix = `${PLUGIN_FILES_FOLDER}/${plugin.id}/`;
      return { path: written.startsWith(prefix) ? written.slice(prefix.length) : target.relative };
    }
  },

  'files.read': {
    permission: 'files',
    handler: async (params, { state, plugin, api }) => {
      const target = resolvePluginFilePath(state, plugin.id, params?.path);
      if (typeof api?.readFileBase64 !== 'function') {
        throw new Error('File storage is unavailable in this environment.');
      }
      const result = await api.readFileBase64(target.absolute);
      if (!result?.ok || !result.dataBase64) {
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

  'migration.importLegacyGel': {
    permission: '',
    internal: true,
    bundledPluginId: 'gel',
    handler: (params, context) => migrateLegacyGelRecords({ ...context, skipIds: params?.skipIds })
  }
};

export function createPluginBridge({
  state,
  persist,
  onNotebookEntriesChanged,
  windowObject = globalThis.window,
  api = windowObject?.hikariApi || null
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

  function broadcast(eventName, payload = {}) {
    const event = text(eventName, 80);
    if (!event) {
      return;
    }
    frames.forEach((_plugin, frameWindow) => {
      frameWindow?.postMessage?.({
        hikari: PROTOCOL_MARKER,
        event,
        payload
      }, '*');
    });
  }

  // Plugins that have reported unsaved work: id -> label. The host's quit guard
  // (unsavedChangesService) reads this so a frame's in-progress work blocks the
  // close the same way a built-in editor's does.
  const unsavedPlugins = new Map();
  const saveWaiters = new Map();

  function pluginUnsaved(plugin, unsaved) {
    const id = text(plugin?.id, 200);
    if (!id) {
      return;
    }
    if (unsaved) {
      unsavedPlugins.set(id, text(plugin.name, 200) || id);
      return;
    }
    unsavedPlugins.delete(id);
    (saveWaiters.get(id) || []).forEach((resolve) => resolve(true));
    saveWaiters.delete(id);
  }

  // Asking a frame to save is a broadcast plus a wait for its next
  // app.setUnsaved push — there is no request/reply in the host->plugin
  // direction. A frame that never answers resolves false and the guard reports
  // it, rather than hanging the quit.
  function requestPluginSave(id) {
    return new Promise((resolve) => {
      const waiters = saveWaiters.get(id) || [];
      waiters.push(resolve);
      saveWaiters.set(id, waiters);
      broadcast('app.save', { pluginId: id });
      windowObject?.setTimeout?.(() => resolve(!unsavedPlugins.has(id)), PLUGIN_SAVE_TIMEOUT_MS);
    });
  }

  function getUnsavedSources() {
    return Array.from(unsavedPlugins.entries()).map(([id, label]) => ({
      key: `plugin:${id}`,
      label,
      moduleApi: {
        hasUnsavedChanges: () => unsavedPlugins.has(id),
        saveUnsavedChanges: () => requestPluginSave(id)
      }
    }));
  }

  function broadcastAppContext(changed = '') {
    broadcast('app.context', buildPluginAppContext(state, changed, windowObject));
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
    if (
      verb.internal
      && (plugin.bundled !== true || plugin.id !== verb.bundledPluginId || plugin.path !== `@bundled/${plugin.id}`)
    ) {
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
      if (
        request.params !== undefined
        && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))
      ) {
        throw new Error(`Plugin call "${text(request.verb, 80)}" needs an object for params.`);
      }
      const params = request.params || {};
      const result = verb.handler(params, {
        state,
        persist,
        plugin,
        onNotebookEntriesChanged,
        api,
        pluginUnsaved,
        windowObject
      });
      // Filesystem verbs are async; the rest stay synchronous so a reply still
      // lands in the same turn as the request.
      if (result && typeof result.then === 'function') {
        result.then(
          (resolved) => reply({ ok: true, result: resolved }),
          (error) => reply({ ok: false, error: String(error?.message || error) })
        );
      } else {
        reply({ ok: true, result });
      }
    } catch (error) {
      reply({ ok: false, error: String(error?.message || error) });
    }
  }

  windowObject?.addEventListener?.('message', handleMessage);
  return { register, handleMessage, broadcast, broadcastAppContext, getUnsavedSources };
}

export const PLUGIN_BRIDGE_VERBS = Object.freeze(
  Object.fromEntries(
    Object.entries(VERBS)
      .filter(([, verb]) => !verb.internal)
      .map(([name, verb]) => [name, verb.permission])
  )
);
