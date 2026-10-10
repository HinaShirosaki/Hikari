'use strict';

const fs = require('node:fs/promises');
const { legacyPathFor, readMarkdownCheckpoint } = require('./metadata');

const checkpointMarker = transaction => `<!-- hikari-checkpoint:${transaction} -->`;
const pendingPathFor = filePath => `${filePath}.pending`;

async function readOptional(filePath) {
  return fs.readFile(filePath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
}

async function captureCheckpoint(filePath, source) {
  const paths = [filePath, pendingPathFor(filePath)];
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await Promise.all(paths.map(readOptional));
    // A writer passes Markdown it read beforehand, so a second read here
    // would not cover that read; only readers need the stability check.
    if (source !== undefined) return { raw: before[0], pendingRaw: before[1], source };
    const markdown = await readOptional(filePath.replace(/\.json$/, '.md'));
    const after = await Promise.all(paths.map(readOptional));
    if (before.every((raw, index) => raw === after[index])) return { raw: before[0], pendingRaw: before[1], source: markdown };
  }
  throw new Error(`Record changed while loading ${filePath}. Retry the load.`);
}

// A pending checkpoint is written before Markdown changes. Its marker travels
// with that Markdown, so even an interrupted rename has the matching IDs and
// typed data. An uncommitted pending file never replaces the old companion.
async function readRecordCheckpoint(filePath, source, fallback) {
  try {
    const standalone = await readMarkdownCheckpoint(filePath, source, fallback);
    if (standalone) return standalone;
  } catch (error) { return { exists: true, ok: false, error: error.message, source, metadataError: true }; }
  filePath = legacyPathFor(filePath);
  let captured;
  try { captured = await captureCheckpoint(filePath, source); }
  catch (error) { return { exists: true, ok: false, error: error.message }; }
  let result;
  try {
    if (captured.raw === null) throw Object.assign(new Error('Missing record'), { code: 'ENOENT' });
    const data = JSON.parse(captured.raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid JSON object in ${filePath}`);
    result = { exists: true, ok: true, data, error: '' };
  } catch (error) {
    result = { exists: error.code !== 'ENOENT', ok: false, error: error.code === 'ENOENT' ? '' : error.message };
  }
  if (!result.ok && captured.source) result = { ...result, exists: true, error: result.error || 'Markdown record is missing its embedded scientific state and legacy JSON is unavailable' };
  try {
    if (captured.pendingRaw === null) return { ...result, source: captured.source };
    const pending = JSON.parse(captured.pendingRaw);
    if (pending.version !== 1 || !/^[a-f0-9-]{36}$/.test(pending.transaction || '')
      || !pending.checkpoint || typeof pending.checkpoint !== 'object' || Array.isArray(pending.checkpoint)) {
      throw new Error('Invalid pending record checkpoint');
    }
    if (captured.source?.includes(checkpointMarker(pending.transaction))) {
      const recovered = !result.ok || JSON.stringify(result.data) !== JSON.stringify(pending.checkpoint);
      result = { exists: true, ok: true, data: pending.checkpoint, error: '', recovered };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') result.checkpointError = `Cannot recover ${pendingPathFor(filePath)}: ${error.message}`;
  }
  return { ...result, source: captured.source };
}

module.exports = { checkpointMarker, pendingPathFor, readRecordCheckpoint };
