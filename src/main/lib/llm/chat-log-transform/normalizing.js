'use strict';

const { cloneJson } = require('../../normalize.js');
const { TRANSFORMED_CHAT_LOG_FOLDER_NAME } = require('./constants.js');

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

module.exports = {
  defaultCleanText,
  escapeRegex,
  formatPayload,
  normalizeIndexPayload,
  normalizeTransformFileStatus,
  normalizeTransformState,
  sanitizeFilePart
};
