'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cloneJson } = require('../normalize.js');

const CHAT_LOG_FOLDER_NAME = 'chat_log';
const CHAT_LOG_INDEX_FILE_NAME = 'index.json';
const TRANSFORMED_CHAT_LOG_FOLDER_NAME = 'transformed';
const DEFAULT_SCAN_INTERVAL_MS = 15000;
const CONTEXT_SECTION_MARKERS = Object.freeze([
  'Recent conversation:',
  'Conversation:',
  'Transcript:',
  'Feedback message:',
  'User message:',
  'First user message:',
  'Clarified request:',
  'Request:',
  'Question:',
  'Context:',
  'Source paper title:',
  'Source:',
  'Selected blocks:',
  'Exit criteria:',
  'Pre-synthesized question:',
  'Supporting basis:',
  'Reasoning type:',
  'Extracted logic:',
  'Citations:',
  'Recent tool outputs:',
  'Tool outputs:'
]);

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFilePart(value, fallback = 'chat-log') {
  const clean = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return clean || fallback;
}

function formatPayload(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || '');
  }
}

function normalizeTransformFileStatus(rawStatus = {}) {
  const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  const sourceFile = defaultCleanText(source.source_file || source.sourceFile);
  if (!sourceFile) {
    return null;
  }
  return {
    source_file: sourceFile,
    output_file: defaultCleanText(source.output_file || source.outputFile),
    status: defaultCleanText(source.status) || 'pending',
    source_mtime_ms: normalizeFiniteNumber(source.source_mtime_ms ?? source.sourceMtimeMs, 0),
    source_size: Math.max(0, normalizeFiniteNumber(source.source_size ?? source.sourceSize, 0)),
    source_line_count: Math.max(0, normalizeFiniteNumber(source.source_line_count ?? source.sourceLineCount, 0)),
    trace_count: Math.max(0, normalizeFiniteNumber(source.trace_count ?? source.traceCount, 0)),
    transformed_at: defaultCleanText(source.transformed_at || source.transformedAt),
    error: defaultCleanText(source.error)
  };
}

function normalizeTransformState(rawState = {}) {
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const filesSource = source.files && typeof source.files === 'object' ? source.files : {};
  const files = {};
  Object.entries(filesSource).forEach(([key, value]) => {
    const normalized = normalizeTransformFileStatus({
      ...(value && typeof value === 'object' ? value : {}),
      source_file: defaultCleanText(
        value?.source_file || value?.sourceFile || key)
    });
    if (normalized?.source_file) {
      files[normalized.source_file] = normalized;
    }
  });
  return {
    updated_at: defaultCleanText(source.updated_at || source.updatedAt),
    output_folder: defaultCleanText(source.output_folder || source.outputFolder)
      || TRANSFORMED_CHAT_LOG_FOLDER_NAME,
    files
  };
}

function normalizeIndexPayload(rawIndex = {}) {
  const source = rawIndex && typeof rawIndex === 'object' ? rawIndex : {};
  return {
    version: Math.max(1, normalizeFiniteNumber(source.version, 1)),
    updated_at: defaultCleanText(source.updated_at || source.updatedAt),
    sessions: Array.isArray(source.sessions) ? cloneJson(source.sessions, []) : [],
    transforms: normalizeTransformState(source.transforms)
  };
}

function buildFallbackContext(requestContext) {
  const source = requestContext && typeof requestContext === 'object' ? requestContext : {};
  const lines = [];
  const message = defaultCleanText(source.message);
  const conversation = asArray(source.conversation);
  if (message) {
    lines.push(`User message:\n${message}`);
  }
  if (conversation.length) {
    lines.push(`Conversation:\n${JSON.stringify(conversation, null, 2)}`);
  }
  return lines.join('\n\n');
}

function splitCombinedPrompt(prompt = '') {
  const rawPrompt = defaultCleanText(prompt);
  if (!rawPrompt) {
    return {
      systemPrompt: '',
      context: ''
    };
  }

  let markerIndex = -1;
  CONTEXT_SECTION_MARKERS.forEach((marker) => {
    const match = new RegExp(`(?:\\n\\n|\\n|^)${escapeRegex(marker)}`, 'i').exec(rawPrompt);
    if (!match) {
      return;
    }
    const startIndex = match.index + match[0].length - marker.length;
    if (markerIndex === -1 || startIndex < markerIndex) {
      markerIndex = startIndex;
    }
  });

  if (markerIndex <= 0) {
    return {
      systemPrompt: rawPrompt.trim(),
      context: ''
    };
  }

  return {
    systemPrompt: rawPrompt.slice(0, markerIndex).trim(),
    context: rawPrompt.slice(markerIndex).trim()
  };
}

function extractPromptSections(requestPayload, requestContext) {
  const payload = requestPayload && typeof requestPayload === 'object'
    ? requestPayload
    : {};
  const sections = [];
  let systemPrompt = defaultCleanText(payload.system_prompt || payload.systemPrompt);

  if (Array.isArray(payload.conversation) && payload.conversation.length) {
    sections.push(`Conversation:\n${JSON.stringify(payload.conversation, null, 2)}`);
  }
  if (Array.isArray(payload.tool_outputs) && payload.tool_outputs.length) {
    sections.push(`Tool outputs:\n${JSON.stringify(payload.tool_outputs, null, 2)}`);
  }

  const fieldMap = [
    ['user_prompt', 'User prompt'],
    ['userPrompt', 'User prompt'],
    ['message', 'Message'],
    ['feedback_message', 'Feedback message'],
    ['feedbackMessage', 'Feedback message']
  ];
  fieldMap.forEach(([fieldName, label]) => {
    const value = defaultCleanText(payload[fieldName]);
    if (value) {
      sections.push(`${label}:\n${value}`);
    }
  });

  if (payload.attachment && typeof payload.attachment === 'object') {
    sections.push(`Attachment:\n${JSON.stringify(payload.attachment, null, 2)}`);
  }

  if (!systemPrompt) {
    const combinedPrompt = defaultCleanText(payload.prompt);
    if (combinedPrompt) {
      const split = splitCombinedPrompt(combinedPrompt);
      systemPrompt = split.systemPrompt;
      if (split.context) {
        sections.push(split.context);
      }
    }
  }

  if (!systemPrompt && defaultCleanText(payload.prompt)) {
    systemPrompt = defaultCleanText(payload.prompt);
  }

  if (!sections.length) {
    const fallbackContext = buildFallbackContext(requestContext);
    if (fallbackContext) {
      sections.push(fallbackContext);
    }
  }

  return {
    systemPrompt,
    context: sections.filter(Boolean).join('\n\n')
  };
}

function buildRequestContextMap(rows = []) {
  const byRequestId = new Map();
  asArray(rows).forEach((row) => {
    if (!row || typeof row !== 'object' || row.type !== 'agent-chat-request') {
      return;
    }
    const requestId = defaultCleanText(row.requestId);
    if (!requestId) {
      return;
    }
    byRequestId.set(requestId, {
      message: defaultCleanText(row.message),
      conversation: Array.isArray(row.conversation) ? cloneJson(row.conversation, []) : []
    });
  });
  return byRequestId;
}

function transformTraceRow(row, requestContextById) {
  const source = row && typeof row === 'object' ? row : {};
  const requestId = defaultCleanText(source.requestId);
  const requestContext = requestContextById.get(requestId) || null;
  const promptSections = extractPromptSections(source.request_payload, requestContext);
  return {
    stage: defaultCleanText(source.stage),
    request_id: requestId,
    timestamp: defaultCleanText(source.timestamp),
    system_prompt: promptSections.systemPrompt,
    context: promptSections.context,
    response: formatPayload(source.response_payload)
  };
}

function normalizeStoragePath(storagePath = '') {
  const clean = defaultCleanText(storagePath);
  return clean ? path.resolve(clean) : '';
}

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
      return normalizeIndexPayload(JSON.parse(raw));
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
    await runtimeFs.writeFile(paths.indexPath, JSON.stringify(nextIndex, null, 2), 'utf8');
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
