'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { resolveLibraryPaths, ensurePathWithinRoot } = require('../sequence-library/paths');
const { openDatabase, persistDatabase, readSingleRow } = require('../sequence-library/database');
const { upsertEntryRow } = require('../sequence-library/entry-row-store');
const { replaceFeatureOccurrencesForEntry } = require('../sequence-library/feature-store');
const { FEATURE_INDEX_VERSION } = require('../sequence-library/constants');
const { parseStoredRecordText } = require('../sequence-library/stored-record-read');
const library = require('../sequence-library');
const DESIGN_FILE = 'agent-design.json';
function hash(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function safeId(id) { if (!/^[a-zA-Z0-9_-]+$/.test(String(id || ''))) throw Object.assign(new Error('Invalid artifact ID.'), { code: 'invalid_arguments' }); return id; }
function revision(entry, gbkText) { return hash([entry.id, entry.name, entry.status, entry.folderId, entry.updatedAt, gbkText]); }
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(temporary, JSON.stringify(value)); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function load(storagePath, id) {
  safeId(id);
  const payload = await library.getSequenceEntry({ storagePath, id, includeGbk: true });
  if (!payload.entry) throw Object.assign(new Error('Sequence entry not found.'), { code: 'not_found' });
  const { record, parsed } = await parseStoredRecordText(payload.gbkText);
  if (!record || parsed?.errors?.length) throw Object.assign(new Error('Stored GenBank record cannot be parsed.'), { code: 'invalid_record' });
  record.name = payload.entry.name;
  const metadata = await readJson(path.join(resolveLibraryPaths(storagePath).entriesRoot, id, DESIGN_FILE));
  return { ...payload, record, revision: revision(payload.entry, payload.gbkText), metadata };
}
async function artifact(storagePath, id, value) {
  const file = path.join(resolveLibraryPaths(storagePath).entriesRoot, '.constructs', `${safeId(id)}.json`);
  if (value) await atomicJson(file, value);
  const result = value || await readJson(file);
  if (!result) throw Object.assign(new Error('Construct not found.'), { code: 'not_found' });
  return result;
}
async function createDerivative(storagePath, source, record, metadata, gbkText) {
  const paths = resolveLibraryPaths(storagePath);
  const id = `agent_${hash(metadata.request_id).slice(0, 32)}`;
  const finalDir = path.join(paths.entriesRoot, id);
  const staging = path.join(paths.entriesRoot, `.pending-${id}`);
  const existing = await readJson(path.join(finalDir, DESIGN_FILE));
  if (existing) {
    if (existing.request_hash !== metadata.request_hash) throw Object.assign(new Error('Request ID was already used with different arguments.'), { code: 'request_conflict' });
    return load(storagePath, id);
  }
  const now = new Date().toISOString();
  const row = {
    id, name: record.name, normalizedName: record.name.toLowerCase(), status: 'temporary',
    sourceFormat: 'agent', topology: record.topology, sequenceLength: record.sequence.length,
    featureCount: record.features.length, featureIndexVersion: FEATURE_INDEX_VERSION,
    gbkRelPath: `entries/${id}/sequence.gbk`, htmlRelPath: '', folderId: source.entry.folderId || '', createdAt: now, updatedAt: now
  };
  const design = { ...metadata, version: 1, entry: row };
  const db = await openDatabase(paths.sqlitePath);
  let published = false;
  try {
    if (readSingleRow(db, 'SELECT id FROM sequence_entries WHERE id = ?', [id])) throw new Error('Derivative ID collision.');
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(path.join(staging, 'sequence.gbk'), gbkText);
    await fs.writeFile(path.join(staging, DESIGN_FILE), JSON.stringify(design));
    upsertEntryRow(db, row);
    replaceFeatureOccurrencesForEntry(db, row, { sequence: record.sequence, features: record.features });
    await fs.rename(staging, finalDir);
    published = true;
    await persistDatabase(paths.sqlitePath, db);
  } catch (e) {
    await fs.rm(published ? finalDir : staging, { recursive: true, force: true });
    throw e;
  } finally { db.close(); }
  return load(storagePath, id);
}
async function retry(storagePath, requestId, requestHash) {
  const id = `agent_${hash(requestId).slice(0, 32)}`;
  const file = path.join(resolveLibraryPaths(storagePath).entriesRoot, id, DESIGN_FILE);
  const metadata = await readJson(file);
  if (!metadata) return null;
  if (metadata.request_hash !== requestHash) throw Object.assign(new Error('Request ID was already used with different arguments.'), { code: 'request_conflict' });
  return load(storagePath, id);
}
async function saveDesign(storagePath, entryId, metadata) {
  const root = resolveLibraryPaths(storagePath).entriesRoot;
  await atomicJson(ensurePathWithinRoot(root, `${safeId(entryId)}/${DESIGN_FILE}`), metadata);
}
module.exports = { load, hash, revision, readJson, atomicJson, artifact, createDerivative, retry, saveDesign, DESIGN_FILE };
