'use strict';

const path = require('node:path');
const {
  parseAssayResultImportFile,
  parseChemicalImportFile
} = require('../lib/chemical-import-parser');
const {
  STORAGE,
  ASSAY,
  INVENTORY,
  PLUGINS
} = require('../../shared/ipc/channels');
const { inspectPluginFolder } = require('../lib/inspect-plugin-folder');
const { createPluginServerRegistry } = require('../lib/plugin-server');
const {
  registerSequenceLibraryIpc
} = require('./register-data-ipc/register-sequence-library-ipc');

// Loopback servers for `serve: true` plugins. Process-lifetime: they are torn
// down with the app, and reused across renderer reloads so a reload does not
// leak listeners.
const { createStorageFileHelpers } = require('./data-ipc/storage-files.js');

const pluginServers = createPluginServerRegistry();
const MAX_PLUGIN_EXPORT_BASE64_CHARS = 24_000_000;
const BUNDLED_PLUGIN_TOKEN_PATTERN = /^@bundled\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function resolvePluginServePath({ pluginId, requestedPath, getBundledPluginPath }) {
  if (!String(requestedPath || '').startsWith('@bundled/')) {
    return requestedPath;
  }
  const match = BUNDLED_PLUGIN_TOKEN_PATTERN.exec(String(requestedPath || ''));
  if (!match || match[1] !== pluginId) {
    throw new Error(`Invalid bundled plugin path for "${pluginId}".`);
  }
  const resolvedPath = getBundledPluginPath(pluginId);
  if (!resolvedPath) {
    throw new Error(`Unknown bundled plugin "${pluginId}".`);
  }
  return resolvedPath;
}

function isCanonicalBase64(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return false;
  }
  try {
    return Buffer.from(encoded, 'base64').toString('base64') === encoded;
  } catch {
    return false;
  }
}

function registerDataIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const dialog = deps.dialog;
  const shell = deps.shell;
  const fs = deps.fs;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
    });
  const mainDataHelpers = deps.mainDataHelpers;
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');
  const getStorageRootPointerPath = typeof deps.getStorageRootPointerPath === 'function'
    ? deps.getStorageRootPointerPath
    : (() => '');
  const getUserDataPath = typeof deps.getUserDataPath === 'function' ? deps.getUserDataPath : (() => '');
  const getBundledPluginPath = typeof deps.getBundledPluginPath === 'function'
    ? deps.getBundledPluginPath
    : (() => '');
  const legacyUserDataFilePath = () => {
    const userDataPath = cleanText(getUserDataPath(), 2400);
    return userDataPath ? path.join(userDataPath, 'enana-data.json') : '';
  };
  const importStorageRoot = deps.importStorageRoot;
  const discoverPapersFromStorageRoot = deps.discoverPapersFromStorageRoot;
  const paperKnowledgeDatabaseRuntime = deps.paperKnowledgeDatabaseRuntime
    && typeof deps.paperKnowledgeDatabaseRuntime.ingestPaperPdf === 'function'
    ? deps.paperKnowledgeDatabaseRuntime
    : null;
  const syncSqliteBundleFromSnapshot = deps.syncSqliteBundleFromSnapshot;
  const listSequenceEntries = deps.listSequenceEntries;
  const getSequenceEntry = deps.getSequenceEntry;
  const upsertSequenceEntry = deps.upsertSequenceEntry;
  const promoteSequenceEntry = deps.promoteSequenceEntry;
  const deleteSequenceEntry = deps.deleteSequenceEntry;
  const upsertSequenceFolder = deps.upsertSequenceFolder;
  const deleteSequenceFolder = deps.deleteSequenceFolder;
  const moveSequenceEntryToFolder = deps.moveSequenceEntryToFolder;
  const annotateSequenceRecord = deps.annotateSequenceRecord;
  const searchSequenceFeatures = deps.searchSequenceFeatures;
  const listRecognizedBackbones = deps.listRecognizedBackbones;
  const upsertRecognizedBackbone = deps.upsertRecognizedBackbone;
  const recognizeSequenceBackbone = deps.recognizeSequenceBackbone;

  const {
    normalizeJsonPayload,
    sanitizeImportedFileName,
    asArray,
    storeImportedFile,
    moveStoredFile,
    appendNotebookPageLog,
    writeJsonStorageFile,
    mirrorStorageRoot,
    readStorageRootFrom
  } = createStorageFileHelpers({
    fs,
    cleanText,
    getStorageRootPointerPath,
    paperKnowledgeDatabaseRuntime
  });

  ipcMain.handle(STORAGE.AUTO_SAVE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const { data, filePath } = normalizedPayload;
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }
    const result = await mainDataHelpers.autoSaveDataFile({ data, filePath });
    if (result?.ok) {
      await mirrorStorageRoot(data?.settings?.storagePath);
    }
    return result;
  });

  ipcMain.handle(STORAGE.LAST_ROOT, async () => {
    const pointerRoot = await readStorageRootFrom(getStorageRootPointerPath(), 'pointer');
    if (pointerRoot) {
      return { ok: true, storagePath: pointerRoot };
    }
    // ponytail: pre-pointer installs only recorded the root inside a saved
    // snapshot, so fall back to those. Drop once no one is upgrading from them.
    const snapshotRoot = await readStorageRootFrom(getDefaultDataFilePath(), 'snapshot')
      || await readStorageRootFrom(legacyUserDataFilePath(), 'snapshot');
    return { ok: Boolean(snapshotRoot), storagePath: snapshotRoot };
  });

  ipcMain.handle(STORAGE.SYNC_SQLITE_BUNDLE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const sqlitePath = cleanText(normalizedPayload?.sqlitePath || normalizedPayload?.filePath, 2400);
    const mode = cleanText(normalizedPayload?.mode, 40);
    const snapshot = normalizedPayload?.snapshot || normalizedPayload?.data;
    if (!sqlitePath) {
      return { ok: false, error: 'Missing sqlite path.' };
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return { ok: false, error: 'Missing snapshot payload.' };
    }
    if (typeof syncSqliteBundleFromSnapshot !== 'function') {
      return { ok: false, error: 'SQLite bundle sync is unavailable.' };
    }
    try {
      const result = await syncSqliteBundleFromSnapshot({ sqlitePath, snapshot, mode });
      return {
        ok: true,
        sqlitePath: result?.sqlitePath || sqlitePath
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.PICK_DIRECTORY, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const currentPath = typeof normalizedPayload?.currentPath === 'string' ? normalizedPayload.currentPath.trim() : '';
    const result = await dialog.showOpenDialog({
      title: 'Select Storage Folder',
      defaultPath: currentPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle(PLUGINS.INSPECT_FOLDER, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    try {
      return await inspectPluginFolder({ fs, folderPath: normalizedPayload?.path });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  // Starts (or reuses) a loopback server for one plugin folder and returns its
  // base URL. The renderer only ever asks for folders already recorded in
  // settings, but the registry re-checks the path itself.
  ipcMain.handle(PLUGINS.SERVE_FOLDER, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    try {
      const pluginId = cleanText(normalizedPayload?.id, 80);
      const requestedPath = cleanText(normalizedPayload?.path, 2400);
      const resolvedPath = resolvePluginServePath({ pluginId, requestedPath, getBundledPluginPath });
      return await pluginServers.serve(pluginId, resolvedPath);
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  // Exports are mediated by a native save dialog instead of granting every
  // plugin iframe the broad `allow-downloads` sandbox token. The plugin picks
  // the suggested name; the user picks the actual destination.
  ipcMain.handle(PLUGINS.EXPORT_FILE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const dataBase64 = String(normalizedPayload?.dataBase64 || '');
    if (!dataBase64) {
      return { ok: false, error: 'Missing export data.' };
    }
    if (dataBase64.length > MAX_PLUGIN_EXPORT_BASE64_CHARS) {
      return { ok: false, error: 'Plugin export is too large.' };
    }
    if (!isCanonicalBase64(dataBase64)) {
      return { ok: false, error: 'Plugin export data is not valid base64.' };
    }
    const suggestedName = sanitizeImportedFileName(
      path.basename(String(normalizedPayload?.fileName || 'plugin-export.dat'))
    );
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Plugin File',
        defaultPath: suggestedName
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      await fs.writeFile(result.filePath, Buffer.from(dataBase64, 'base64'));
      return {
        ok: true,
        saved: true,
        fileName: path.basename(result.filePath)
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.ENSURE_DIRECTORY, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const targetPath = typeof normalizedPayload?.path === 'string' ? normalizedPayload.path.trim() : '';
    if (!targetPath) {
      return { ok: false, error: 'Missing directory path.' };
    }

    try {
      await fs.mkdir(targetPath, { recursive: true });
      return { ok: true, path: targetPath };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle(STORAGE.STORE_IMPORTED_FILE, async (_event, payload) => {
    try {
      const stored = await storeImportedFile(normalizeJsonPayload(payload, {}));
      return { ok: true, ...stored };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.MOVE_STORED_FILE, async (_event, payload) => {
    try {
      const moved = await moveStoredFile(normalizeJsonPayload(payload, {}));
      return { ok: true, ...moved };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.APPEND_NOTEBOOK_PAGE_LOG, async (_event, payload) => {
    try {
      const result = await appendNotebookPageLog(normalizeJsonPayload(payload, {}));
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.WRITE_JSON_FILE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    try {
      const result = await writeJsonStorageFile(normalizedPayload);
      return {
        ok: true,
        ...result
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error)
      };
    }
  });

  ipcMain.handle(STORAGE.OPEN_FILE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const targetPath = typeof normalizedPayload?.path === 'string' ? normalizedPayload.path.trim() : '';
    if (!targetPath) {
      return { ok: false, error: 'Missing file path.' };
    }

    const resolvedPath = path.resolve(targetPath);
    try {
      await fs.access(resolvedPath);
    } catch {
      return { ok: false, error: `File does not exist: ${resolvedPath}` };
    }

    const error = await shell.openPath(resolvedPath);
    if (error) {
      return { ok: false, error: String(error) };
    }
    return { ok: true, path: resolvedPath };
  });

  ipcMain.handle(STORAGE.READ_FILE_BYTES, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const targetPath = typeof normalizedPayload?.path === 'string' ? normalizedPayload.path.trim() : '';
    if (!targetPath) {
      return { ok: false, error: 'Missing file path.' };
    }

    const resolvedPath = path.resolve(targetPath);
    try {
      const bytes = await fs.readFile(resolvedPath);
      return {
        ok: true,
        path: resolvedPath,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error),
        path: resolvedPath
      };
    }
  });

  ipcMain.handle(STORAGE.READ_FILE_BASE64, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const targetPath = typeof normalizedPayload?.path === 'string' ? normalizedPayload.path.trim() : '';
    if (!targetPath) {
      return { ok: false, error: 'Missing file path.' };
    }

    const resolvedPath = path.resolve(targetPath);
    try {
      const bytes = await fs.readFile(resolvedPath);
      return {
        ok: true,
        path: resolvedPath,
        dataBase64: bytes.toString('base64')
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error),
        path: resolvedPath
      };
    }
  });

  ipcMain.handle(INVENTORY.PARSE_CHEMICAL_IMPORT, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const fileName = cleanText(normalizedPayload?.fileName, 300);
    const dataBase64 = String(normalizedPayload?.dataBase64 || '').trim();
    if (!dataBase64) {
      return { ok: false, error: 'Missing chemical import file data.' };
    }

    try {
      const parsed = parseChemicalImportFile({ fileName, dataBase64 });
      return {
        ok: true,
        ...parsed
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error)
      };
    }
  });

  ipcMain.handle(ASSAY.PARSE_RESULT_IMPORT, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const fileName = cleanText(normalizedPayload?.fileName, 300);
    const dataBase64 = String(normalizedPayload?.dataBase64 || '').trim();
    if (!dataBase64) {
      return { ok: false, error: 'Missing assay result import file data.' };
    }

    try {
      const parsed = parseAssayResultImportFile({ fileName, dataBase64 });
      return {
        ok: true,
        ...parsed
      };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error)
      };
    }
  });

  ipcMain.handle(STORAGE.IMPORT_ROOT, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
    if (!storagePath) {
      return { ok: false, error: 'Missing storage path.' };
    }
    try {
      const imported = await importStorageRoot({ storagePath });
      return { ok: true, ...imported };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(STORAGE.DISCOVER_PAPERS, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
    if (!storagePath) {
      return { ok: false, error: 'Missing storage path.' };
    }
    if (typeof discoverPapersFromStorageRoot !== 'function') {
      return { ok: false, error: 'Paper discovery is unavailable.' };
    }
    try {
      const discovered = await discoverPapersFromStorageRoot({
        storagePath,
        knownPapers: asArray(normalizedPayload?.knownPapers),
        projects: asArray(normalizedPayload?.projects),
        journalClubs: asArray(normalizedPayload?.journalClubs)
      });
      return { ok: true, ...discovered };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  registerSequenceLibraryIpc({
    ipcMain,
    cleanText,
    normalizeJsonPayload,
    listSequenceEntries,
    getSequenceEntry,
    upsertSequenceEntry,
    promoteSequenceEntry,
    deleteSequenceEntry,
    upsertSequenceFolder,
    deleteSequenceFolder,
    moveSequenceEntryToFolder,
    annotateSequenceRecord,
    searchSequenceFeatures,
    listRecognizedBackbones,
    upsertRecognizedBackbone,
    recognizeSequenceBackbone
  });

}

module.exports = {
  registerDataIpc,
  pluginServers,
  resolvePluginServePath
};
