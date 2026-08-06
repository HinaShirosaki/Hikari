'use strict';

const path = require('node:path');
const {
  parseAssayResultImportFile,
  parseChemicalImportFile
} = require('../lib/chemical-import-parser');
const { transformPaperPdfToMarkdown } = require('../papers/parse/paper-markdown-import.js');
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

  function safeParseJson(value, fallback = null) {
    try {
      const parsed = JSON.parse(String(value || ''));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeJsonPayload(payload, fallback = {}) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    if (typeof payload === 'string') {
      const parsed = safeParseJson(payload, null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  function sanitizeStorageName(value, fallback = 'item') {
    const cleaned = String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 180);
    return cleaned || fallback;
  }

  function sanitizeImportedFileName(fileName) {
    const rawName = String(fileName || '').trim();
    const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24);
    const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
    const safeBase = sanitizeStorageName(base, 'imported-file');
    return `${safeBase}${ext}`;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function ensurePathWithinRoot(rootPath, targetPath) {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget === resolvedRoot) {
      return resolvedTarget;
    }
    const rootWithSep = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : `${resolvedRoot}${path.sep}`;
    if (!resolvedTarget.startsWith(rootWithSep)) {
      throw new Error('Target path must be inside the configured storage path.');
    }
    return resolvedTarget;
  }

  async function pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async function getUniqueFilePath(folderPath, fileName) {
    const parsed = path.parse(fileName);
    const safeNameBase = sanitizeStorageName(parsed.name, 'imported-file');
    const safeExt = String(parsed.ext || '').replace(/[^.\w-]+/g, '').slice(0, 24);
    let attempt = 0;
    while (attempt < 5000) {
      const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
      const candidateName = `${safeNameBase}${suffix}${safeExt}`;
      const candidatePath = path.join(folderPath, candidateName);
      if (!(await pathExists(candidatePath))) {
        return candidatePath;
      }
      attempt += 1;
    }
    throw new Error('Unable to find a unique file name for imported file.');
  }

  function normalizeImportedDataBytes(value) {
    if (!value) {
      return null;
    }
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value?.data)) {
      return Buffer.from(value.data);
    }
    return null;
  }

  async function storeImportedFile(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    const targetFolderInput = String(payload?.targetFolder || '').trim();
    const fileName = sanitizeImportedFileName(payload?.fileName);
    const dataBase64 = String(payload?.dataBase64 || '').trim();
    const dataBytes = normalizeImportedDataBytes(payload?.dataBytes);

    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    if (!targetFolderInput) {
      throw new Error('Missing target folder.');
    }
    if (!dataBase64 && !dataBytes?.byteLength) {
      throw new Error('Missing imported file data.');
    }

    const resolvedStoragePath = path.resolve(storagePath);
    const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
    await fs.mkdir(resolvedTargetFolder, { recursive: true });

    // De-duplicating is right for a user *import* (two files named scan.png are
    // two different files). It is wrong for a caller that owns its folder and
    // addresses files by path — re-saving would leak a copy every time — so
    // those opt into overwrite. fileName is already separator-free by then.
    const targetFilePath = payload?.overwrite === true
      ? path.join(resolvedTargetFolder, fileName)
      : await getUniqueFilePath(resolvedTargetFolder, fileName);
    const binary = dataBytes?.byteLength ? dataBytes : Buffer.from(dataBase64, 'base64');
    await fs.writeFile(targetFilePath, binary);
    let paperMarkdown = null;
    if (payload?.transformPdfToMarkdown === true && /\.pdf$/i.test(targetFilePath)) {
      paperMarkdown = await transformPaperPdfToMarkdown({
        storagePath: resolvedStoragePath,
        filePath: targetFilePath,
        paper: {
          title: payload?.paperTitle || payload?.title || fileName.replace(/\.pdf$/i, ''),
          fileName: path.basename(targetFilePath),
          storedRelativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/'),
          linkedType: payload?.linkedType,
          linkedName: payload?.linkedName,
          doi: payload?.doi
        },
        paperKnowledgeDatabaseRuntime,
        skipExistingMarkdown: false,
        source: 'manual-import'
      }).catch((error) => ({
        ok: false,
        status: 'error',
        error: String(error?.message || error)
      }));
    }

    return {
      filePath: targetFilePath,
      fileName: path.basename(targetFilePath),
      relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/'),
      knowledgeDatabase: paperMarkdown || null,
      knowledgeMarkdownRelativePath: cleanText(paperMarkdown?.markdown_relative_path, 2400),
      knowledgeExtractedTextRelativePath: cleanText(paperMarkdown?.extracted_text_relative_path, 2400),
      knowledgeMetaRelativePath: cleanText(paperMarkdown?.meta_relative_path, 2400),
      knowledgeStatus: cleanText(paperMarkdown?.status, 80),
      knowledgeError: cleanText(paperMarkdown?.error || paperMarkdown?.paper_intake_error, 1200),
      paperIntakeStatus: cleanText(paperMarkdown?.paper_intake_status, 80),
      paperIntakeError: cleanText(paperMarkdown?.paper_intake_error, 1200)
    };
  }

  function resolveStorageFilePath(storagePath, sourcePath = '', sourceRelativePath = '') {
    const resolvedStoragePath = path.resolve(storagePath);
    const directPath = String(sourcePath || '').trim();
    const relativePath = String(sourceRelativePath || '').trim();
    const candidate = directPath
      ? (path.isAbsolute(directPath) ? path.resolve(directPath) : path.resolve(resolvedStoragePath, directPath))
      : path.resolve(resolvedStoragePath, relativePath);
    return ensurePathWithinRoot(resolvedStoragePath, candidate);
  }

  async function moveStoredFile(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    const targetFolderInput = String(payload?.targetFolder || '').trim();

    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    if (!targetFolderInput) {
      throw new Error('Missing target folder.');
    }

    const resolvedStoragePath = path.resolve(storagePath);
    const sourceFilePath = resolveStorageFilePath(
      resolvedStoragePath,
      payload?.sourcePath,
      payload?.sourceRelativePath
    );
    const sourceStat = await fs.stat(sourceFilePath);
    if (!sourceStat.isFile()) {
      throw new Error('Source path is not a file.');
    }

    const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
    await fs.mkdir(resolvedTargetFolder, { recursive: true });

    const targetFileName = sanitizeImportedFileName(payload?.fileName || path.basename(sourceFilePath));
    const directTargetPath = path.join(resolvedTargetFolder, targetFileName);
    if (path.resolve(directTargetPath) === sourceFilePath) {
      return {
        moved: false,
        filePath: sourceFilePath,
        fileName: path.basename(sourceFilePath),
        relativePath: path.relative(resolvedStoragePath, sourceFilePath).split(path.sep).join('/'),
        previousRelativePath: path.relative(resolvedStoragePath, sourceFilePath).split(path.sep).join('/')
      };
    }

    const targetFilePath = await getUniqueFilePath(resolvedTargetFolder, targetFileName);
    try {
      await fs.rename(sourceFilePath, targetFilePath);
    } catch (error) {
      if (error?.code !== 'EXDEV') {
        throw error;
      }
      await fs.copyFile(sourceFilePath, targetFilePath);
      await fs.unlink(sourceFilePath);
    }

    return {
      moved: true,
      filePath: targetFilePath,
      fileName: path.basename(targetFilePath),
      relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/'),
      previousRelativePath: path.relative(resolvedStoragePath, sourceFilePath).split(path.sep).join('/')
    };
  }

  async function appendNotebookPageLog(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    const targetFolderInput = String(payload?.storageFolder || '').trim();
    const action = cleanText(payload?.action, 80);
    const entryId = cleanText(payload?.entryId, 200);

    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    if (!targetFolderInput) {
      throw new Error('Missing notebook page storage folder.');
    }
    if (!action) {
      throw new Error('Missing log action.');
    }

    const resolvedStoragePath = path.resolve(storagePath);
    const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
    await fs.mkdir(resolvedTargetFolder, { recursive: true });

    const timestamp = typeof payload?.timestamp === 'string' && payload.timestamp.trim()
      ? payload.timestamp.trim()
      : new Date().toISOString();
    const summary = cleanText(payload?.summary, 600);
    const details = payload?.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
      ? payload.details
      : {};

    const record = {
      ts: timestamp,
      action,
      entryId,
      summary,
      details
    };
    const line = `${JSON.stringify(record)}\n`;
    const logFilePath = path.join(resolvedTargetFolder, 'page.log');
    await fs.appendFile(logFilePath, line, 'utf8');

    return {
      filePath: logFilePath,
      relativePath: path.relative(resolvedStoragePath, logFilePath).split(path.sep).join('/')
    };
  }

  async function writeJsonStorageFile(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    const targetFolderInput = String(payload?.targetFolder || '').trim();
    const fileName = sanitizeImportedFileName(payload?.fileName || 'data.json');
    const data = payload?.data;

    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    if (!targetFolderInput) {
      throw new Error('Missing target folder.');
    }

    const resolvedStoragePath = path.resolve(storagePath);
    const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
    await fs.mkdir(resolvedTargetFolder, { recursive: true });

    const targetFilePath = path.join(resolvedTargetFolder, fileName);
    await fs.writeFile(targetFilePath, JSON.stringify(data ?? null, null, 2), 'utf8');

    return {
      filePath: targetFilePath,
      fileName: path.basename(targetFilePath),
      relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/')
    };
  }

  // The workspace root otherwise lives only in renderer localStorage, so a
  // cleared profile used to boot into an empty workspace with no way back.
  let mirroredStorageRoot = '';

  async function mirrorStorageRoot(storagePath) {
    const nextPath = cleanText(storagePath, 2400);
    const pointerPath = cleanText(getStorageRootPointerPath(), 2400);
    if (!nextPath || !pointerPath || nextPath === mirroredStorageRoot) {
      return;
    }
    try {
      await fs.mkdir(path.dirname(pointerPath), { recursive: true });
      await fs.writeFile(pointerPath, `${JSON.stringify({ storagePath: nextPath }, null, 2)}\n`, 'utf8');
      mirroredStorageRoot = nextPath;
    } catch {
      // A missing pointer only costs the startup recovery below; never fail the save.
    }
  }

  async function readStorageRootFrom(filePath, field) {
    const targetPath = cleanText(filePath, 2400);
    if (!targetPath) {
      return '';
    }
    try {
      const snapshot = safeParseJson(await fs.readFile(targetPath, 'utf8'), {});
      return cleanText(field === 'pointer' ? snapshot?.storagePath : snapshot?.settings?.storagePath, 2400);
    } catch {
      return '';
    }
  }

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
