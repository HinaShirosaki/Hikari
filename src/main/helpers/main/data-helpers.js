'use strict';

function defaultCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
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
  const writeSnapshot = typeof deps.writeSnapshot === 'function'
    ? deps.writeSnapshot
    : (async () => {});
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
  const legacyChemicalsPath = cleanText(deps.legacyChemicalsPath, 1600);

  function withSqlitePath(source) {
    return {
      ...(source?.sidecarPaths || {}),
      sqlitePath: cleanText(source?.bundlePaths?.sqlitePath, 1600)
    };
  }

  async function persistSnapshot({
    targetPath,
    snapshot,
    ensureDirectory = false,
    includeFilePathOnError = false
  }) {
    try {
      if (ensureDirectory) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
      }
      await writeSnapshot(targetPath, snapshot);
      const bundleSync = await syncBundleFromSnapshot({
        dataFilePath: targetPath,
        snapshot,
        fallbackDataFilePath: getDefaultDataFilePath()
      });
      return {
        ok: true,
        filePath: targetPath,
        sidecarPaths: withSqlitePath(bundleSync),
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

  async function loadSnapshot({
    targetPath,
    allowMissing = false,
    includeFilePathOnError = false
  }) {
    try {
      const raw = await fs.readFile(targetPath, 'utf8');
      const parsed = JSON.parse(raw);
      const hydrated = await hydrateSnapshotFromBundle({
        dataFilePath: targetPath,
        snapshot: parsed,
        fallbackDataFilePath: getDefaultDataFilePath(),
        legacyChemicalsPath: legacyChemicalsPath || undefined
      });
      return {
        ok: true,
        filePath: targetPath,
        data: hydrated.snapshot,
        sidecarPaths: withSqlitePath(hydrated),
        bundlePaths: hydrated.bundlePaths,
        migration: hydrated.migration
      };
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
    const targetPath = normalizeDataFilePath(filePath, getDefaultDataFilePath());
    const snapshot = data && typeof data === 'object' ? data : {};
    return persistSnapshot({
      targetPath,
      snapshot,
      ensureDirectory: true,
      includeFilePathOnError: true
    });
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
