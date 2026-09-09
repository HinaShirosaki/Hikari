'use strict';

const fs = require('fs/promises');
const path = require('path');

const EXPERIMENT_LOG_SCHEMA = 'hikari_experiment_log';
const EXPERIMENT_LOG_SCHEMA_VERSION = '1.0.0';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeExperimentLogEntry(rawValue) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? rawValue
    : null;
  const id = cleanText(source?.id);
  const text = cleanText(source?.text || source?.note);
  const createdAt = cleanText(source?.createdAt || source?.updatedAt);
  const updatedAt = cleanText(source?.updatedAt || source?.createdAt) || createdAt;
  if (!id || !text || Number.isNaN(Date.parse(createdAt))) {
    return null;
  }
  return {
    id,
    text,
    createdAt,
    updatedAt
  };
}

function normalizeExperimentLogState(rawValue) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? rawValue
    : {};
  const entries = Array.isArray(source.entries)
    ? source.entries
    : (Array.isArray(source.quickLogEntries) ? source.quickLogEntries : []);
  return {
    quickLogDraft: String(source.draft ?? source.quickLogDraft ?? ''),
    quickLogEntries: entries.map(normalizeExperimentLogEntry).filter(Boolean)
  };
}

function buildExperimentLogSidecar(snapshot, updatedAt = new Date().toISOString()) {
  const dashboard = snapshot?.settings?.dashboard;
  const normalized = normalizeExperimentLogState(dashboard);
  return {
    schema_name: EXPERIMENT_LOG_SCHEMA,
    schema_version: EXPERIMENT_LOG_SCHEMA_VERSION,
    updated_at: String(updatedAt || new Date().toISOString()),
    draft: normalized.quickLogDraft,
    entries: normalized.quickLogEntries
  };
}

async function writeExperimentLogSidecar(filePath, snapshot, updatedAt) {
  const targetPath = cleanText(filePath);
  if (!targetPath) {
    return '';
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    JSON.stringify(buildExperimentLogSidecar(snapshot, updatedAt), null, 2),
    'utf8'
  );
  return targetPath;
}

async function readExperimentLogSidecar(filePath) {
  const targetPath = cleanText(filePath);
  if (!targetPath) {
    return { ok: false, exists: false, data: normalizeExperimentLogState({}) };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(targetPath, 'utf8'));
    return {
      ok: true,
      exists: true,
      data: normalizeExperimentLogState(parsed)
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, exists: false, data: normalizeExperimentLogState({}) };
    }
    return {
      ok: false,
      exists: true,
      data: normalizeExperimentLogState({}),
      error: `Failed to read experiment log: ${String(error?.message || error)}`
    };
  }
}

module.exports = {
  EXPERIMENT_LOG_SCHEMA,
  EXPERIMENT_LOG_SCHEMA_VERSION,
  buildExperimentLogSidecar,
  normalizeExperimentLogEntry,
  normalizeExperimentLogState,
  readExperimentLogSidecar,
  writeExperimentLogSidecar
};
