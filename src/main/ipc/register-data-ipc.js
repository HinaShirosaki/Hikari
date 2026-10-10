'use strict';

const path = require('node:path');
const {
  parseAssayResultImportFile,
  parseChemicalImportFile
} = require('../lib/chemical-import-parser');
const {
  STORAGE,
  ASSAY,
  INVENTORY
} = require('../../shared/ipc/channels');
const {
  registerSequenceLibraryIpc
} = require('./register-data-ipc/register-sequence-library-ipc');

const { createStorageFileHelpers } = require('./register-data-ipc/storage-files.js');
const { getBundlePaths } = require('../storage/storage-paths');

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
    asArray,
    storeImportedFile,
    transformStoredPaperPdf,
    moveStoredFile,
    appendNotebookPageLog,
    writeJsonStorageFile,
    mirrorStorageRoot,
    readConfiguredStorageRoot
  } = createStorageFileHelpers({
    fs,
    cleanText,
    getStorageRootPointerPath,
    getStorageRoot: typeof deps.getStorageRoot === 'function' ? deps.getStorageRoot : () => '',
    getDefaultDataFilePath,
    setStorageRoot: deps.setStorageRoot,
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
      deps.onWorkspaceSaved?.(data?.settings?.storagePath);
    }
    return result;
  });

  ipcMain.handle(STORAGE.LAST_ROOT, async () => {
    const storageRoot = await readConfiguredStorageRoot();
    return { ok: Boolean(storageRoot), storagePath: storageRoot };
  });

  ipcMain.handle(STORAGE.SYNC_SQLITE_BUNDLE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const mode = cleanText(normalizedPayload?.mode, 40);
    const snapshot = normalizedPayload?.snapshot || normalizedPayload?.data;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return { ok: false, error: 'Missing snapshot payload.' };
    }
    if (typeof syncSqliteBundleFromSnapshot !== 'function') {
      return { ok: false, error: 'SQLite bundle sync is unavailable.' };
    }
    // The caller used to name the destination file, which let anything running
    // in the renderer write a bundle-shaped blob to any path the user can write.
    // The chemical bundle path already belongs to getBundlePaths, so derive it
    // from the recorded storage root and ignore whatever the payload asked for.
    const storageRoot = await readConfiguredStorageRoot();
    if (!storageRoot) {
      return { ok: false, error: 'No storage path is configured yet.' };
    }
    if (mode.toLowerCase() !== 'chemical') {
      return { ok: false, error: `Unsupported sqlite bundle mode: ${mode || '(none)'}` };
    }
    const sqlitePath = cleanText(getBundlePaths({ storagePath: storageRoot }).chemicalsSqlitePath, 2400);
    if (!sqlitePath) {
      return { ok: false, error: 'Could not resolve the sqlite bundle path.' };
    }
    try {
      const result = await syncSqliteBundleFromSnapshot({ sqlitePath, snapshot });
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

  ipcMain.handle(STORAGE.TRANSFORM_PAPER_PDF, async (_event, payload) => {
    try {
      const transformed = await transformStoredPaperPdf(normalizeJsonPayload(payload, {}));
      return { ok: true, ...transformed };
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

module.exports = { registerDataIpc };
