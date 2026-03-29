'use strict';

const path = require('node:path');

function registerDataIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const dialog = deps.dialog;
  const shell = deps.shell;
  const fs = deps.fs;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });
  const mainDataHelpers = deps.mainDataHelpers;
  const hasSupportedDataExtension = deps.hasSupportedDataExtension;
  const defaultDataFileName = String(deps.DEFAULT_DATA_FILE_NAME || 'enana-data.json');
  const importStorageRoot = deps.importStorageRoot;
  const listSequenceEntries = deps.listSequenceEntries;
  const getSequenceEntry = deps.getSequenceEntry;
  const upsertSequenceEntry = deps.upsertSequenceEntry;
  const promoteSequenceEntry = deps.promoteSequenceEntry;
  const deleteSequenceEntry = deps.deleteSequenceEntry;
  const searchSequenceFeatures = deps.searchSequenceFeatures;
  const recognizeSequenceBackbone = deps.recognizeSequenceBackbone;
  const checkPlannotateEnvironment = deps.checkPlannotateEnvironment;
  const annotateWithBlast = deps.annotateWithBlast;
  const installPlannotateAssets = deps.installPlannotateAssets;
  const generatePlannotateGbk = deps.generatePlannotateGbk;

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

  async function storeImportedFile(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    const targetFolderInput = String(payload?.targetFolder || '').trim();
    const fileName = sanitizeImportedFileName(payload?.fileName);
    const dataBase64 = String(payload?.dataBase64 || '').trim();

    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    if (!targetFolderInput) {
      throw new Error('Missing target folder.');
    }
    if (!dataBase64) {
      throw new Error('Missing imported file data.');
    }

    const resolvedStoragePath = path.resolve(storagePath);
    const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
    await fs.mkdir(resolvedTargetFolder, { recursive: true });

    const targetFilePath = await getUniqueFilePath(resolvedTargetFolder, fileName);
    const binary = Buffer.from(dataBase64, 'base64');
    await fs.writeFile(targetFilePath, binary);

    return {
      filePath: targetFilePath,
      fileName: path.basename(targetFilePath),
      relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/')
    };
  }

  ipcMain.handle('ena:save', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const { data, filePath } = normalizedPayload;
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }

    let targetPath = filePath;
    if (!targetPath) {
      const result = await dialog.showSaveDialog({
        title: 'Save Enana Data',
        defaultPath: defaultDataFileName,
        filters: [{ name: 'Enana Data', extensions: ['json', 'ena'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      targetPath = result.filePath;
    }

    if (typeof hasSupportedDataExtension === 'function' && !hasSupportedDataExtension(targetPath)) {
      targetPath = `${targetPath}.json`;
    }

    return mainDataHelpers.saveSelectedDataFile({
      data,
      filePath: targetPath
    });
  });

  ipcMain.handle('ena:load', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load Enana Data',
      properties: ['openFile'],
      filters: [{ name: 'Enana Data', extensions: ['json', 'ena'] }]
    });

    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }

    return mainDataHelpers.loadSelectedDataFile(result.filePaths[0]);
  });

  ipcMain.handle('data:auto-save', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const { data, filePath } = normalizedPayload;
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }
    return mainDataHelpers.autoSaveDataFile({ data, filePath });
  });

  ipcMain.handle('data:auto-load', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    return mainDataHelpers.autoLoadDataFile(normalizedPayload?.filePath);
  });

  ipcMain.handle('storage:pick-directory', async (_event, payload) => {
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

  ipcMain.handle('storage:ensure-directory', async (_event, payload) => {
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

  ipcMain.handle('storage:store-imported-file', async (_event, payload) => {
    try {
      const stored = await storeImportedFile(normalizeJsonPayload(payload, {}));
      return { ok: true, ...stored };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('storage:open-file', async (_event, payload) => {
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

  ipcMain.handle('storage:read-file-base64', async (_event, payload) => {
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

  ipcMain.handle('storage:import-root', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:list', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:get', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:upsert', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:promote', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:delete', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:search-features', async (_event, payload) => {
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

  ipcMain.handle('sequence-library:recognize-backbone', async (_event, payload) => {
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

  ipcMain.handle('plannotate:check-env', async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const status = await checkPlannotateEnvironment(normalizedPayload?.dbDir || '');
      return { ok: true, status };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle('plannotate:annotate', async (_event, payload) => {
    try {
      const result = await annotateWithBlast(normalizeJsonPayload(payload, {}));
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('plannotate:install-all', async () => {
    try {
      const result = await installPlannotateAssets();
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('plannotate:generate-gbk', async (_event, payload) => {
    try {
      const gbk = generatePlannotateGbk(normalizeJsonPayload(payload, {}));
      return { ok: true, gbk };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
}

module.exports = {
  registerDataIpc
};
