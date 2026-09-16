import { getSharedLeftRailLayout } from '../shared-left-rail.js';
import { asArray } from '../../lib/normalize.js';

const PROTOCOL_MARKER = 1;
const MAX_LIST_SIZE = 500;
// Same shape inspect-plugin-folder.js enforces when a plugin is installed.
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// How long the quit guard waits for a frame to answer an app.save broadcast.
const PLUGIN_SAVE_TIMEOUT_MS = 15000;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// The plugin's own slice, keyed by the id the frame registry resolved — never
// by anything in the payload, so there is no key a plugin could pass to read a
// neighbour's data.
function readPluginStorage(state, pluginId) {
  return asObject(asObject(state.settings).pluginStorage)[pluginId] ?? null;
}

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
// touch: <storage root>/Plugins/<plugin id>/. This gives callers an early
// input error; the dedicated plugin-file
// IPC repeats validation and rejects symlinks at the actual filesystem boundary.
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
  const requested = String(rawPath ?? '').trim();
  const segments = requested.split('/').filter((part) => part && part !== '.');
  const unsafe = requested.startsWith('/')
    || requested.includes('\\')
    || /^[a-zA-Z]:/.test(requested)
    || segments.some((part) => part === '..' || part.includes('\0'));
  if (!segments.length || unsafe) {
    throw new Error(`Invalid plugin file path "${text(rawPath, 200)}".`);
  }
  return {
    root,
    relative: segments.join('/')
  };
}

function text(value, maxLength = 4000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function buildPluginAppContext(state, changed = '', windowObject = globalThis.window) {
  const settings = asObject(state?.settings);
  const appearance = asObject(settings.appearance);
  const requestedMode = text(appearance.mode, 20).toLowerCase();
  const mode = requestedMode === 'night' ? 'night' : 'day';
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
  const result = await api.writePluginFile({
    storagePath: target.root,
    pluginId: plugin.id,
    path: target.relative,
    dataBase64
  });
  if (!result?.ok) {
    throw new Error(text(result?.error, 400) || `Could not write "${target.relative}".`);
  }
  return text(result.path, 2400) || target.relative;
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
  if (typeof api?.writePluginFile !== 'function' || typeof api?.readFileBase64 !== 'function') {
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

export {
  MAX_FILE_BASE64_CHARS,
  MAX_LIST_SIZE,
  MAX_PYTHON_CODE_CHARS,
  MAX_PYTHON_INPUT_CHARS,
  MAX_PYTHON_INPUT_FILES,
  MAX_PYTHON_OUTPUT_CHARS,
  PLUGIN_SAVE_TIMEOUT_MS,
  PROTOCOL_MARKER,
  asObject,
  buildPluginAppContext,
  isCanonicalBase64,
  migrateLegacyGelRecords,
  readPluginStorage,
  resolvePluginFilePath,
  text
};
