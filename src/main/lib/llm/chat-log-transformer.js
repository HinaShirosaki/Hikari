'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray } = require('../normalize.js');
const { withFileLock, writeFileAtomic, parseJsonSalvagingTornTail } = require('../shared-json-file.js');
const { CHAT_LOG_FOLDER_NAME, CHAT_LOG_INDEX_FILE_NAME, DEFAULT_SCAN_INTERVAL_MS, TRANSFORMED_CHAT_LOG_FOLDER_NAME } = require('./chat-log-transform/constants.js');
const { defaultCleanText, normalizeIndexPayload, normalizeTransformFileStatus, normalizeTransformState, sanitizeFilePart } = require('./chat-log-transform/normalizing.js');
const { buildRequestContextMap, normalizeStoragePath, transformTraceRow } = require('./chat-log-transform/prompt-sections.js');

function createChatLogTransformRuntime(deps = {}) {
  const runtimeFs = deps.fs || fs;
  const runtimePath = deps.path || path;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());

  function resolvePaths(storagePath) {
    const resolvedStoragePath = runtimePath.resolve(cleanText(storagePath, 2400));
    if (!resolvedStoragePath) {
      throw new Error('Missing storage path.');
    }
    const chatLogPath = runtimePath.join(resolvedStoragePath, CHAT_LOG_FOLDER_NAME);
    const transformedFolderName = TRANSFORMED_CHAT_LOG_FOLDER_NAME;
    return {
      storagePath: resolvedStoragePath,
      chatLogPath,
      indexPath: runtimePath.join(chatLogPath, CHAT_LOG_INDEX_FILE_NAME),
      transformedPath: runtimePath.join(chatLogPath, transformedFolderName),
      transformedFolderName
    };
  }

  async function readIndex(paths) {
    try {
      const raw = await runtimeFs.readFile(paths.indexPath, 'utf8');
      return normalizeIndexPayload(parseJsonSalvagingTornTail(raw));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return normalizeIndexPayload({});
      }
      throw error;
    }
  }

  async function writeTransformStatus(storagePath, sourceFile, patch = {}) {
    const paths = resolvePaths(storagePath);
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    return withFileLock(paths.indexPath, () => writeTransformStatusLocked(paths, sourceFile, patch));
  }

  async function writeTransformStatusLocked(paths, sourceFile, patch) {
    const index = await readIndex(paths);
    const existing = normalizeTransformFileStatus(index.transforms.files[sourceFile]) || {
      source_file: sourceFile,
      output_file: '',
      status: 'pending',
      source_mtime_ms: 0,
      source_size: 0,
      source_line_count: 0,
      trace_count: 0,
      transformed_at: '',
      error: ''
    };
    const nextTransforms = normalizeTransformState({
      ...index.transforms,
      updated_at: now(),
      files: {
        ...index.transforms.files,
        [sourceFile]: {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
          source_file: sourceFile
        }
      }
    });
    const nextIndex = normalizeIndexPayload({
      ...index,
      updated_at: nextTransforms.updated_at,
      transforms: nextTransforms
    });
    await writeFileAtomic(runtimeFs, paths.indexPath, JSON.stringify(nextIndex, null, 2));
    return nextIndex;
  }

  async function transformLogFile(storagePath, logFileName) {
    const paths = resolvePaths(storagePath);
    const sourceFile = cleanText(logFileName, 240);
    if (!sourceFile) {
      throw new Error('Missing log file name.');
    }
    const logPath = runtimePath.join(paths.chatLogPath, sourceFile);
    const outputFileName = `${sanitizeFilePart(sourceFile.replace(/\.log$/i, ''), 'chat-log')}.json`;
    const outputRelativePath = runtimePath.join(paths.transformedFolderName, outputFileName);
    const outputPath = runtimePath.join(paths.chatLogPath, outputRelativePath);
    const stats = await runtimeFs.stat(logPath);
    const raw = await runtimeFs.readFile(logPath, 'utf8');
    const nonEmptyLines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const rows = nonEmptyLines.reduce((items, line) => {
      try {
        items.push(JSON.parse(line));
      } catch {
        // Skip incomplete trailing rows so active log files can be retried on the next scan.
      }
      return items;
    }, []);
    const requestContextById = buildRequestContextMap(rows);
    const entries = rows
      .filter((row) => row && typeof row === 'object' && row.type === 'agent-llm-trace')
      .map((row) => transformTraceRow(row, requestContextById))
      .filter((entry) => entry.system_prompt || entry.context || entry.response);
    const sessionId = defaultCleanText(
      rows.find((row) => row && typeof row === 'object' && defaultCleanText(row.session_id || row.sessionId, 120))
        ?.session_id
        || rows.find((row) => row && typeof row === 'object' && defaultCleanText(row.sessionId, 120))
          ?.sessionId) || sourceFile.replace(/\.log$/i, '');
    const outputPayload = {
      session_id: sessionId,
      source_log_file: sourceFile,
      transformed_at: now(),
      entry_count: entries.length,
      entries
    };
    await runtimeFs.mkdir(paths.transformedPath, { recursive: true });
    await runtimeFs.writeFile(outputPath, JSON.stringify(outputPayload, null, 2), 'utf8');
    await writeTransformStatus(storagePath, sourceFile, {
      output_file: outputRelativePath,
      status: 'complete',
      source_mtime_ms: stats.mtimeMs,
      source_size: stats.size,
      source_line_count: nonEmptyLines.length,
      trace_count: entries.length,
      transformed_at: outputPayload.transformed_at,
      error: ''
    });
    return {
      ok: true,
      source_file: sourceFile,
      output_file: outputRelativePath,
      source_size: stats.size,
      source_mtime_ms: stats.mtimeMs,
      source_line_count: nonEmptyLines.length,
      trace_count: entries.length
    };
  }

  async function scanStoragePath(storagePath) {
    const paths = resolvePaths(storagePath);
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    const index = await readIndex(paths);
    const dirEntries = await runtimeFs.readdir(paths.chatLogPath, { withFileTypes: true });
    const logFiles = dirEntries
      .filter((entry) => entry.isFile() && /\.log$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const transformed = [];
    const skipped = [];
    const failed = [];

    for (const logFile of logFiles) {
      const sourcePath = runtimePath.join(paths.chatLogPath, logFile);
      let stats = null;
      try {
        stats = await runtimeFs.stat(sourcePath);
      } catch (error) {
        failed.push({
          source_file: logFile,
          error: cleanText(error?.message || error, 1200)
        });
        continue;
      }

      const status = normalizeTransformFileStatus(index.transforms.files[logFile]);
      const outputFileName = `${sanitizeFilePart(logFile.replace(/\.log$/i, ''), 'chat-log')}.json`;
      const outputRelativePath = runtimePath.join(paths.transformedFolderName, outputFileName);
      const outputPath = runtimePath.join(paths.chatLogPath, outputRelativePath);
      let outputExists = false;
      try {
        await runtimeFs.access(outputPath);
        outputExists = true;
      } catch {
        outputExists = false;
      }

      const upToDate = status
        && status.status === 'complete'
        && status.output_file === outputRelativePath
        && status.source_size === stats.size
        && status.source_mtime_ms === stats.mtimeMs
        && outputExists;

      if (upToDate) {
        skipped.push({
          source_file: logFile,
          output_file: outputRelativePath,
          reason: 'up_to_date'
        });
        continue;
      }

      try {
        transformed.push(await transformLogFile(storagePath, logFile));
      } catch (error) {
        const errorMessage = cleanText(error?.message || error, 2400) || 'Unknown chat log transform error.';
        await writeTransformStatus(storagePath, logFile, {
          output_file: outputRelativePath,
          status: 'error',
          source_mtime_ms: stats.mtimeMs,
          source_size: stats.size,
          transformed_at: now(),
          error: errorMessage
        });
        failed.push({
          source_file: logFile,
          output_file: outputRelativePath,
          error: errorMessage
        });
      }
    }

    return {
      ok: failed.length === 0,
      storage_path: paths.storagePath,
      scanned_count: logFiles.length,
      transformed_count: transformed.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      transformed,
      skipped,
      failed
    };
  }

  return {
    resolvePaths,
    scanStoragePath,
    transformLogFile,
    normalizeStoragePath
  };
}

function createChatLogTransformMonitor(deps = {}) {
  const runtime = createChatLogTransformRuntime(deps);
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const scanIntervalMs = Math.max(2000, Number(deps.scanIntervalMs) || DEFAULT_SCAN_INTERVAL_MS);
  const trackedStoragePaths = new Set();
  let intervalHandle = null;
  let activeScan = null;

  function trackStoragePath(storagePath = '') {
    const normalized = runtime.normalizeStoragePath(cleanText(storagePath, 2400));
    if (!normalized) {
      return '';
    }
    trackedStoragePaths.add(normalized);
    void scanTrackedStoragePaths();
    return normalized;
  }

  async function scanTrackedStoragePaths() {
    if (activeScan) {
      return activeScan;
    }
    activeScan = (async () => {
      const results = [];
      for (const storagePath of trackedStoragePaths) {
        try {
          results.push(await runtime.scanStoragePath(storagePath));
        } catch (error) {
          results.push({
            ok: false,
            storage_path: storagePath,
            error: cleanText(error?.message || error, 2400)
          });
        }
      }
      return results;
    })().finally(() => {
      activeScan = null;
    });
    return activeScan;
  }

  function start(options = {}) {
    asArray(options.storagePaths).forEach((storagePath) => {
      trackStoragePath(storagePath);
    });
    if (!intervalHandle) {
      intervalHandle = setInterval(() => {
        void scanTrackedStoragePaths();
      }, scanIntervalMs);
      if (typeof intervalHandle?.unref === 'function') {
        intervalHandle.unref();
      }
    }
    return {
      scan_interval_ms: scanIntervalMs,
      tracked_storage_paths: Array.from(trackedStoragePaths)
    };
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return {
    start,
    stop,
    trackStoragePath,
    scanTrackedStoragePaths,
    scanStoragePath: runtime.scanStoragePath
  };
}

module.exports = {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  TRANSFORMED_CHAT_LOG_FOLDER_NAME,
  createChatLogTransformRuntime,
  createChatLogTransformMonitor
};
