'use strict';

const path = require('node:path');
const { ensurePathWithinRoot, pathExists } = require('../../lib/path-safety.js');

const { transformPaperPdfToMarkdown } = require('../../papers/parse/paper-markdown-import.js');
const { PAPER_RECORD_FILE_SUFFIX } = require('../../storage/paper-discovery.js');

// Filesystem work behind the storage IPC handlers. fs, text cleanup, and the
// paper knowledge runtime are injected so the registrar owns all of the wiring.
function createStorageFileHelpers({
  fs: fsApi,
  cleanText,
  getStorageRootPointerPath,
  getStorageRoot = () => '',
  getDefaultDataFilePath = () => '',
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

  // The storage root as this process knows it: app-paths keeps it in memory,
  // seeded from the pointer file and refreshed on every auto-save, so it stays
  // right even when the pointer write fails. Pointer and legacy snapshot follow.
  async function readConfiguredStorageRoot() {
    const liveRoot = cleanText(getStorageRoot(), 2400);
    if (liveRoot) {
      return liveRoot;
    }
    const pointerRoot = await readStorageRootFrom(getStorageRootPointerPath(), 'pointer');
    if (pointerRoot) {
      return pointerRoot;
    }
    // ponytail: pre-pointer installs only recorded the root inside a saved
    // snapshot, so fall back to those. Drop once no one is upgrading from them.
    return readStorageRootFrom(getDefaultDataFilePath(), 'snapshot');
  }

  // ensurePathWithinRoot only confines a target against whatever root it is
  // handed, so taking that root from the payload made it decorative: a caller
  // could name any folder as "the workspace" and stay trivially inside it.
  // A caller may still say which workspace it means, but it has to be ours.
  async function resolveConfiguredStorageRoot(claimedPath) {
    const configuredRoot = await readConfiguredStorageRoot();
    if (!configuredRoot) {
      throw new Error('No storage path is configured yet.');
    }
    const resolvedRoot = path.resolve(configuredRoot);
    const claimed = String(claimedPath || '').trim();
    if (claimed && path.resolve(claimed) !== resolvedRoot) {
      throw new Error('Storage path does not match the configured storage path.');
    }
    return resolvedRoot;
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

    const resolvedStoragePath = await resolveConfiguredStorageRoot(storagePath);
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

    return {
      filePath: targetFilePath,
      fileName: path.basename(targetFilePath),
      relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/')
    };
  }

  function buildPaperKnowledgeFields(paperMarkdown) {
    return {
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

  // Intake (PDF -> Markdown + figures + structured records) runs for minutes on
  // a real paper, so it is deliberately not part of storing the file: callers
  // store the PDF, show the library row, then run this in the background.
  async function transformStoredPaperPdf(payload) {
    const storagePath = String(payload?.storagePath || '').trim();
    if (!storagePath) {
      throw new Error('Missing storage path.');
    }

    const resolvedStoragePath = await resolveConfiguredStorageRoot(storagePath);
    const filePath = resolveStorageFilePath(resolvedStoragePath, payload?.filePath, payload?.relativePath);
    if (!/\.pdf$/i.test(filePath)) {
      throw new Error('Stored file is not a PDF.');
    }
    const relativePath = path.relative(resolvedStoragePath, filePath).split(path.sep).join('/');

    const paperMarkdown = await transformPaperPdfToMarkdown({
      storagePath: resolvedStoragePath,
      filePath,
      paper: {
        title: payload?.paperTitle || payload?.title || path.basename(filePath).replace(/\.pdf$/i, ''),
        fileName: path.basename(filePath),
        storedRelativePath: relativePath,
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

    return {
      filePath,
      relativePath,
      ...buildPaperKnowledgeFields(paperMarkdown)
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

    const resolvedStoragePath = await resolveConfiguredStorageRoot(storagePath);
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
    const moveFile = async (from, to) => {
      try {
        await fs.rename(from, to);
      } catch (error) {
        if (error?.code !== 'EXDEV') {
          throw error;
        }
        await fs.copyFile(from, to);
        await fs.unlink(from);
      }
    };
    await moveFile(sourceFilePath, targetFilePath);
    // A stored PDF's paper record sits beside it and must move with it.
    await moveFile(`${sourceFilePath}${PAPER_RECORD_FILE_SUFFIX}`, `${targetFilePath}${PAPER_RECORD_FILE_SUFFIX}`).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });

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

    const resolvedStoragePath = await resolveConfiguredStorageRoot(storagePath);
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

    const resolvedStoragePath = await resolveConfiguredStorageRoot(storagePath);
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
    readConfiguredStorageRoot,
    resolveConfiguredStorageRoot,
    pathExists,
    getUniqueFilePath,
    normalizeImportedDataBytes,
    storeImportedFile,
    transformStoredPaperPdf,
    resolveStorageFilePath,
    moveStoredFile,
    appendNotebookPageLog,
    writeJsonStorageFile,
    mirrorStorageRoot,
    readStorageRootFrom
  };
}

module.exports = { createStorageFileHelpers };
