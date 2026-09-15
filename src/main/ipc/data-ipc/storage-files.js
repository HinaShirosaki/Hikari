'use strict';

const path = require('node:path');

const { transformPaperPdfToMarkdown } = require('../../papers/parse/paper-markdown-import.js');

// Filesystem work behind the storage IPC handlers. fs, text cleanup, and the
// paper knowledge runtime are injected so the registrar owns all of the wiring.
function createStorageFileHelpers({
  fs: fsApi,
  cleanText,
  getStorageRootPointerPath,
  setStorageRoot = () => {},
  paperKnowledgeDatabaseRuntime
} = {}) {
  const fs = fsApi;

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
    await setStorageRoot(nextPath);
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

  return {
    safeParseJson,
    normalizeJsonPayload,
    sanitizeStorageName,
    sanitizeImportedFileName,
    asArray,
    ensurePathWithinRoot,
    pathExists,
    getUniqueFilePath,
    normalizeImportedDataBytes,
    storeImportedFile,
    resolveStorageFilePath,
    moveStoredFile,
    appendNotebookPageLog,
    writeJsonStorageFile,
    mirrorStorageRoot,
    readStorageRootFrom
  };
}

module.exports = { createStorageFileHelpers };
