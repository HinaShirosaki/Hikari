'use strict';

const path = require('node:path');
const {
  parseAssayResultImportFile,
  parseChemicalImportFile
} = require('../helpers/main/chemical-import-parser');
const { transformPaperPdfToMarkdown } = require('../helpers/main/paper-markdown-import');
const {
  STORAGE,
  ASSAY,
  INVENTORY,
  SEQUENCE_LIBRARY
} = require('../../shared/ipc/channels');

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
  const importStorageRoot = deps.importStorageRoot;
  const discoverPapersFromStorageRoot = deps.discoverPapersFromStorageRoot;
  const syncSqliteBundleFromSnapshot = deps.syncSqliteBundleFromSnapshot;
  const listSequenceEntries = deps.listSequenceEntries;
  const getSequenceEntry = deps.getSequenceEntry;
  const upsertSequenceEntry = deps.upsertSequenceEntry;
  const promoteSequenceEntry = deps.promoteSequenceEntry;
  const deleteSequenceEntry = deps.deleteSequenceEntry;
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

    const targetFilePath = await getUniqueFilePath(resolvedTargetFolder, fileName);
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
      knowledgeError: cleanText(paperMarkdown?.error, 1200)
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

  ipcMain.handle(STORAGE.AUTO_SAVE, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const { data, filePath } = normalizedPayload;
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }
    return mainDataHelpers.autoSaveDataFile({ data, filePath });
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

  ipcMain.handle(SEQUENCE_LIBRARY.LIST, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      const status = cleanText(normalizedPayload?.status, 40);
      const result = await listSequenceEntries({ storagePath, status });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.GET, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      const id = cleanText(normalizedPayload?.id, 200);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (!id) {
        return { ok: false, error: 'Missing sequence entry id.' };
      }
      const result = await getSequenceEntry({
        storagePath,
        id,
        includeGbk: normalizedPayload?.includeGbk === true,
        includeHtml: normalizedPayload?.includeHtml === true,
        includeAlignments: normalizedPayload?.includeAlignments === true
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.UPSERT, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      const result = await upsertSequenceEntry({
        storagePath,
        id: cleanText(normalizedPayload?.id, 200),
        name: cleanText(normalizedPayload?.name, 140),
        status: cleanText(normalizedPayload?.status, 40),
        sourceFormat: cleanText(normalizedPayload?.sourceFormat, 80),
        topology: cleanText(normalizedPayload?.topology, 40),
        sequenceLength: Number(normalizedPayload?.sequenceLength),
        featureCount: Number(normalizedPayload?.featureCount),
        sequence: String(normalizedPayload?.sequence || ''),
        features: Array.isArray(normalizedPayload?.features) ? normalizedPayload.features : [],
        gbkText: String(normalizedPayload?.gbkText || ''),
        htmlText: String(normalizedPayload?.htmlText || ''),
        alignmentSessions: Array.isArray(normalizedPayload?.alignmentSessions)
          ? normalizedPayload.alignmentSessions
          : null
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.PROMOTE, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      const id = cleanText(normalizedPayload?.id, 200);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (!id) {
        return { ok: false, error: 'Missing sequence entry id.' };
      }
      const result = await promoteSequenceEntry({
        storagePath,
        id,
        name: cleanText(normalizedPayload?.name, 140)
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.DELETE, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      const id = cleanText(normalizedPayload?.id, 200);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (!id) {
        return { ok: false, error: 'Missing sequence entry id.' };
      }
      const result = await deleteSequenceEntry({ storagePath, id });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.SEARCH_FEATURES, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      const result = await searchSequenceFeatures({
        storagePath,
        query: cleanText(normalizedPayload?.query, 600),
        limit: Number(normalizedPayload?.limit)
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.LIST_BACKBONES, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (typeof listRecognizedBackbones !== 'function') {
        throw new Error('Stored backbone API unavailable.');
      }
      const result = await listRecognizedBackbones({
        storagePath,
        query: cleanText(normalizedPayload?.query, 600),
        limit: Number(normalizedPayload?.limit)
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.UPSERT_BACKBONE, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (typeof upsertRecognizedBackbone !== 'function') {
        throw new Error('Stored backbone API unavailable.');
      }
      const result = await upsertRecognizedBackbone({
        storagePath,
        backbone: normalizedPayload?.backbone || normalizedPayload?.data || {}
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.ANNOTATE, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (typeof annotateSequenceRecord !== 'function') {
        throw new Error('Sequence annotation API unavailable.');
      }
      const result = await annotateSequenceRecord({
        storagePath,
        sequence: String(normalizedPayload?.sequence || ''),
        topology: cleanText(normalizedPayload?.topology, 40),
        excludeEntryId: cleanText(normalizedPayload?.excludeEntryId, 200)
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(SEQUENCE_LIBRARY.RECOGNIZE_BACKBONE, async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const storagePath = cleanText(normalizedPayload?.storagePath, 2000);
      if (!storagePath) {
        return { ok: false, error: 'Missing storage path.' };
      }
      if (typeof recognizeSequenceBackbone !== 'function') {
        throw new Error('Backbone recognition API unavailable.');
      }
      const result = await recognizeSequenceBackbone({
        storagePath,
        sequence: String(normalizedPayload?.sequence || ''),
        excludeEntryId: cleanText(normalizedPayload?.excludeEntryId, 200)
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

}

module.exports = {
  registerDataIpc
};
