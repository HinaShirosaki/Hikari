'use strict';

const { writeFileAtomic } = require('../lib/shared-json-file');
const { getBundlePaths } = require('../storage/storage-paths');
const { withStorageRootWrite } = require('../storage/write-coordinator');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createMainDataHelpers(deps = {}) {
  const fs = deps.fs;
  const path = deps.path;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const hasSupportedDataExtension = typeof deps.hasSupportedDataExtension === 'function'
    ? deps.hasSupportedDataExtension
    : (() => false);
  const normalizeDataFilePath = typeof deps.normalizeDataFilePath === 'function'
    ? deps.normalizeDataFilePath
    : ((filePath) => String(filePath || ''));
  const serializeSnapshot = typeof deps.serializeSnapshot === 'function'
    ? deps.serializeSnapshot
    : ((snapshot) => JSON.stringify(snapshot, null, 2));
  // Write beside, then rename: a crash or power loss mid-write leaves the old
  // snapshot intact instead of a truncated .json. rename() replaces atomically
  // on the same filesystem (Windows included). `.tmp` keeps the partial file
  // outside the .json extension filter.
  async function writeSnapshotAtomically(filePath, snapshot) {
    await writeFileAtomic(fs, filePath, serializeSnapshot(snapshot));
  }
  const writeSnapshot = typeof deps.writeSnapshot === 'function'
    ? deps.writeSnapshot
    : writeSnapshotAtomically;
  const syncBundleFromSnapshot = typeof deps.syncBundleFromSnapshot === 'function'
    ? deps.syncBundleFromSnapshot
    : (async () => ({ bundlePaths: {}, sidecarPaths: {} }));
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : (async ({ snapshot = {} } = {}) => ({
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {},
      bundlePaths: {},
      sidecarPaths: {},
      migration: null
    }));
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');

  function hasObjectKeys(value) {
    return Boolean(value && typeof value === 'object' && Object.keys(value).length);
  }

  function isPathWithinRoot(rootPath, targetPath) {
    const resolvedRoot = path.resolve(cleanText(rootPath, 2400));
    const resolvedTarget = path.resolve(cleanText(targetPath, 2400));
    if (!resolvedRoot || !resolvedTarget) {
      return false;
    }
    if (resolvedTarget === resolvedRoot) {
      return true;
    }
    const rootWithSep = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : `${resolvedRoot}${path.sep}`;
    return resolvedTarget.startsWith(rootWithSep);
  }

  function getDefaultAutoSaveDataFilePath(storagePath) {
    const defaultName = path.basename(getDefaultDataFilePath() || 'hikari-data.json') || 'hikari-data.json';
    return normalizeDataFilePath(path.join(storagePath, defaultName), getDefaultDataFilePath());
  }

  function resolveAutoSaveTarget(filePath, snapshot) {
    const storagePath = cleanText(snapshot?.settings?.storagePath, 2400);
    if (!storagePath) {
      return null;
    }

    const explicitPath = cleanText(filePath, 2400);
    if (explicitPath) {
      const normalizedExplicitPath = normalizeDataFilePath(explicitPath, getDefaultDataFilePath());
      if (!isPathWithinRoot(storagePath, normalizedExplicitPath)) {
        return null;
      }
      return {
        targetPath: normalizedExplicitPath,
        writeDataFile: true,
        staleDataFilePath: ''
      };
    }

    return {
      targetPath: '',
      writeDataFile: false,
      staleDataFilePath: getDefaultAutoSaveDataFilePath(storagePath)
    };
  }

  async function persistSnapshotUnlocked({
    targetPath,
    snapshot,
    ensureDirectory = false,
    includeFilePathOnError = false,
    writeDataFile = true,
    staleDataFilePath = '',
    fallbackDataFilePath
  }) {
    try {
      if (writeDataFile && !targetPath) {
        throw new Error('Missing data file path.');
      }
      if (writeDataFile && ensureDirectory) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
      }
      if (writeDataFile) {
        await writeSnapshot(targetPath, snapshot);
      }
      const bundleSync = await syncBundleFromSnapshot({
        dataFilePath: targetPath,
        snapshot,
        fallbackDataFilePath
      });
      if (!writeDataFile && staleDataFilePath) {
        await fs.rm(staleDataFilePath, { force: true }).catch(() => {});
      }
      return {
        ok: true,
        filePath: targetPath,
        sidecarPaths: bundleSync.sidecarPaths || {},
        bundlePaths: bundleSync.bundlePaths
      };
    } catch (error) {
      const result = {
        ok: false,
        error: String(error)
      };
      if (includeFilePathOnError) {
        result.filePath = targetPath;
      }
      return result;
    }
  }

  function persistSnapshot(input) {
    const snapshot = structuredClone(input.snapshot);
    const fallbackDataFilePath = getDefaultDataFilePath();
    const { storageRootPath } = getBundlePaths({
      dataFilePath: input.targetPath,
      fallbackDataFilePath,
      storagePath: snapshot.settings?.storagePath
    });
    return withStorageRootWrite(storageRootPath, () => persistSnapshotUnlocked({ ...input, snapshot, fallbackDataFilePath }));
  }

  async function loadSnapshot({
    targetPath,
    allowMissing = false,
    includeFilePathOnError = false
  }) {
    try {
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(raw);
      const fallbackDataFilePath = getDefaultDataFilePath();
      const { storageRootPath } = getBundlePaths({
        dataFilePath: targetPath,
        fallbackDataFilePath,
        storagePath: parsed?.settings?.storagePath
      });
      return await withStorageRootWrite(storageRootPath, async () => {
        const hydrated = await hydrateSnapshotFromBundle({
          dataFilePath: targetPath,
          snapshot: parsed,
          fallbackDataFilePath
        });
        let loadSync = null;
        try {
          loadSync = await syncBundleFromSnapshot({
            dataFilePath: targetPath,
            snapshot: hydrated.snapshot,
            fallbackDataFilePath
          });
        } catch {
          loadSync = null;
        }
        const sidecarSource = {
          bundlePaths: hasObjectKeys(loadSync?.bundlePaths) ? loadSync.bundlePaths : hydrated.bundlePaths,
          sidecarPaths: hasObjectKeys(loadSync?.sidecarPaths) ? loadSync.sidecarPaths : hydrated.sidecarPaths
        };
        return {
          ok: true,
          filePath: targetPath,
          data: hydrated.snapshot,
          sidecarPaths: sidecarSource.sidecarPaths || {},
          bundlePaths: sidecarSource.bundlePaths || hydrated.bundlePaths,
          migration: hydrated.migration
        };
      });
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') {
        return { ok: true, filePath: targetPath, data: null };
      }
      const result = {
        ok: false,
        error: String(error)
      };
      if (includeFilePathOnError) {
        result.filePath = targetPath;
      }
      return result;
    }
  }

  async function saveSelectedDataFile({ data, filePath }) {
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }
    let targetPath = filePath;
    if (!hasSupportedDataExtension(targetPath)) {
      targetPath = `${targetPath}.json`;
    }
    const snapshot = data && typeof data === 'object' ? data : {};
    return persistSnapshot({
      targetPath,
      snapshot
    });
  }

  async function autoSaveDataFile({ data, filePath }) {
    if (!data) {
      return { ok: false, error: 'Missing data payload.' };
    }
    const snapshot = data && typeof data === 'object' ? data : {};
    const target = resolveAutoSaveTarget(filePath, snapshot);
    if (!target) {
      return { ok: false, error: 'Auto-save requires a configured storage path.' };
    }
    const result = await persistSnapshot({
      targetPath: target.targetPath,
      snapshot,
      ensureDirectory: true,
      includeFilePathOnError: true,
      writeDataFile: target.writeDataFile,
      staleDataFilePath: target.staleDataFilePath
    });
    return result;
  }

  async function loadSelectedDataFile(filePath) {
    return loadSnapshot({
      targetPath: filePath
    });
  }

  async function autoLoadDataFile(filePath) {
    const targetPath = normalizeDataFilePath(filePath, getDefaultDataFilePath());
    return loadSnapshot({
      targetPath,
      allowMissing: true,
      includeFilePathOnError: true
    });
  }

  return {
    saveSelectedDataFile,
    loadSelectedDataFile,
    autoSaveDataFile,
    autoLoadDataFile
  };
}

module.exports = {
  createMainDataHelpers
};
