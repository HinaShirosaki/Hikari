'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { recognizeSequenceBackboneInLibrary } = require('./sequence-backbone-recognition');
const { resolveSqlJsWasmJsPath } = require('./sqljs-path.js');

const SQLJS_WASM_JS_PATH = resolveSqlJsWasmJsPath(__dirname);
const LIBRARY_FOLDER_NAME = 'SequenceViewer';
const DB_FILE_NAME = 'sequence-library.sqlite';
const STATUS_SAVED = 'saved';
const STATUS_TEMPORARY = 'temporary';
const FEATURE_SOURCE_BACKBONE_RECOGNITION = 'backbone_recognition';
const ALIGNMENTS_DIR_NAME = 'alignments';
const ALIGNMENTS_MANIFEST_FILE_NAME = 'alignment-sessions.json';

let sqlJsInitPromise = null;

const BASE_COMPLEMENT = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
  X: 'N'
});

function cleanText(value, _maxLength = 300) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized === STATUS_SAVED ? STATUS_SAVED : STATUS_TEMPORARY;
}

function sanitizeFileName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeName(value, fallback = 'sequence') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return normalized || fallback;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeSequenceText(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^A-Z*]/g, '');
}

function coerceBinaryBuffer(value) {
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
  return null;
}

function reverseComplementIupac(sequence) {
  return [...String(sequence || '').toUpperCase()]
    .reverse()
    .map((base) => BASE_COMPLEMENT[base] || 'N')
    .join('');
}

function buildStableId(prefix, input) {
  const digest = crypto
    .createHash('sha1')
    .update(String(input || ''))
    .digest('hex');
  return `${prefix}_${digest.slice(0, 24)}`;
}

function buildEntryId() {
  return `seq_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function buildSequenceSignature(sequence, prefix = 'seq') {
  const normalized = normalizeSequenceText(sequence);
  if (!normalized.length) {
    return '';
  }

  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(index);
  }

  return `${prefix}_${normalized.length}_${(hash >>> 0).toString(16)}`;
}

function ensureStoragePath(storagePath) {
  const resolved = path.resolve(cleanText(storagePath, 2000));
  if (!resolved) {
    throw new Error('Missing storage path.');
  }
  return resolved;
}

function toPosixRelative(rootPath, absolutePath) {
  return path.relative(rootPath, absolutePath).split(path.sep).join('/');
}

function ensurePathWithinRoot(rootPath, relativePath) {
  const target = path.resolve(rootPath, relativePath);
  const normalizedRoot = `${path.resolve(rootPath)}${path.sep}`;
  if (target !== path.resolve(rootPath) && !target.startsWith(normalizedRoot)) {
    throw new Error('Resolved path escaped sequence library root.');
  }
  return target;
}

function resolveLibraryPaths(storagePath) {
  const root = ensureStoragePath(storagePath);
  const libraryRoot = path.join(root, LIBRARY_FOLDER_NAME);
  return {
    storageRoot: root,
    libraryRoot,
    entriesRoot: path.join(libraryRoot, 'entries'),
    sqlitePath: path.join(libraryRoot, DB_FILE_NAME)
  };
}

async function ensureLibraryDirectories(paths) {
  await fs.mkdir(paths.libraryRoot, { recursive: true });
  await fs.mkdir(paths.entriesRoot, { recursive: true });
}

async function loadSqlJs() {
  if (!sqlJsInitPromise) {
    sqlJsInitPromise = (async () => {
      const initSqlJs = require(SQLJS_WASM_JS_PATH);
      return initSqlJs({
        locateFile: (fileName) => path.join(path.dirname(SQLJS_WASM_JS_PATH), fileName)
      });
    })();
  }
  return sqlJsInitPromise;
}

function applySchema(db) {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sequence_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT '',
      topology TEXT NOT NULL DEFAULT 'linear',
      sequence_length INTEGER NOT NULL DEFAULT 0,
      feature_count INTEGER NOT NULL DEFAULT 0,
      gbk_rel_path TEXT NOT NULL,
      html_rel_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_status
      ON sequence_entries(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sequence_entries_name
      ON sequence_entries(normalized_name);
    CREATE TABLE IF NOT EXISTS sequence_features (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      feature_type TEXT NOT NULL DEFAULT '',
      sequence TEXT NOT NULL,
      sequence_length INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_features_name
      ON sequence_features(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_sequence_features_type
      ON sequence_features(feature_type);
    CREATE TABLE IF NOT EXISTS sequence_feature_occurrences (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      host_vector_id TEXT NOT NULL,
      host_vector_name TEXT NOT NULL,
      host_vector_status TEXT NOT NULL DEFAULT '',
      host_topology TEXT NOT NULL DEFAULT 'linear',
      host_sequence_length INTEGER NOT NULL DEFAULT 0,
      source_format TEXT NOT NULL DEFAULT '',
      annotation_source TEXT NOT NULL DEFAULT '',
      strand INTEGER NOT NULL DEFAULT 1,
      start_pos INTEGER NOT NULL DEFAULT 1,
      end_pos INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_feature_occurrences_feature
      ON sequence_feature_occurrences(feature_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sequence_feature_occurrences_host
      ON sequence_feature_occurrences(host_vector_id, updated_at DESC);
  `);
}

async function openDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  let db;
  try {
    const bytes = await fs.readFile(sqlitePath);
    db = bytes.length > 0
      ? new SQL.Database(new Uint8Array(bytes))
      : new SQL.Database();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      db = new SQL.Database();
    } else {
      throw error;
    }
  }
  applySchema(db);
  return db;
}

async function persistDatabase(sqlitePath, db) {
  const bytes = db.export();
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  await fs.writeFile(sqlitePath, Buffer.from(bytes));
}

function readSingleRow(db, sql, values = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(values);
    if (!stmt.step()) {
      return null;
    }
    const row = stmt.getAsObject();
    return row && typeof row === 'object' ? row : null;
  } finally {
    stmt.free();
  }
}

function readRows(db, sql, values = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(values);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function normalizeEntryRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    id: cleanText(row.id, 200),
    name: cleanText(row.name, 140),
    normalizedName: cleanText(row.normalized_name, 200),
    status: normalizeStatus(row.status),
    sourceFormat: cleanText(row.source_format, 80),
    topology: cleanText(row.topology, 40) || 'linear',
    sequenceLength: Math.max(0, Number(row.sequence_length) || 0),
    featureCount: Math.max(0, Number(row.feature_count) || 0),
    gbkRelPath: cleanText(row.gbk_rel_path, 1200),
    htmlRelPath: cleanText(row.html_rel_path, 1200),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}

function stripExtension(name) {
  const text = String(name || '').trim();
  if (!text) {
    return '';
  }
  return text.replace(/\.[^.]+$/u, '');
}

function resolveAlignmentStoragePaths(entryDir) {
  const alignmentsDir = path.join(entryDir, ALIGNMENTS_DIR_NAME);
  return {
    alignmentsDir,
    manifestPath: path.join(alignmentsDir, ALIGNMENTS_MANIFEST_FILE_NAME)
  };
}

function normalizeAlignmentSourceKind(value) {
  return String(value || '').toLowerCase().trim() === 'paste' ? 'paste' : 'file';
}

function normalizeAlignmentTimestamp(value, fallbackValue = '') {
  const raw = String(value || fallbackValue || '').trim();
  if (!raw) {
    return new Date().toISOString();
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function normalizeAlignmentTracePayload(trace) {
  const safeTrace = trace && typeof trace === 'object' ? trace : null;
  if (!safeTrace) {
    return null;
  }

  const positions = (Array.isArray(safeTrace.positions) ? safeTrace.positions : [])
    .map((value) => Math.max(0, Math.round(Number(value) || 0)))
    .slice(0, 50000);
  const channels = (Array.isArray(safeTrace.channels) ? safeTrace.channels : [])
    .map((channel) => {
      const base = cleanText(channel?.base, 1).toUpperCase();
      if (!base || !['A', 'C', 'G', 'T'].includes(base)) {
        return null;
      }
      const values = (Array.isArray(channel?.values) ? channel.values : [])
        .map((value) => Math.max(0, Math.round(Number(value) || 0)))
        .slice(0, 50000);
      if (!values.length) {
        return null;
      }
      return { base, values };
    })
    .filter(Boolean);

  if (!channels.length) {
    return null;
  }

  return {
    baseOrder: cleanText(safeTrace.baseOrder, 16).toUpperCase(),
    positions,
    channels
  };
}

function normalizeAlignmentQueryRecord(record, index = 0) {
  const safeRecord = record && typeof record === 'object' ? record : {};
  const sequence = normalizeSequenceText(safeRecord.sequence);
  if (!sequence.length) {
    return null;
  }

  return {
    name: normalizeName(safeRecord.name || `alignment_query_${index + 1}`, `alignment_query_${index + 1}`),
    sourceFormat: cleanText(safeRecord.sourceFormat, 80).toLowerCase() || 'raw',
    topology: String(safeRecord.topology || '').toLowerCase() === 'circular' ? 'circular' : 'linear',
    sequence,
    quality: String(safeRecord.quality || '').slice(0, 500000),
    trace: normalizeAlignmentTracePayload(safeRecord.trace)
  };
}

function normalizeAlignmentDifferencePayload(difference, index = 0) {
  const safeDifference = difference && typeof difference === 'object' ? difference : {};
  return {
    type: cleanText(safeDifference.type, 40).toLowerCase() || `difference_${index + 1}`,
    referenceStart: Math.max(0, Math.round(Number(safeDifference.referenceStart) || 0)),
    referenceEnd: Math.max(0, Math.round(Number(safeDifference.referenceEnd) || 0)),
    queryStart: Math.max(0, Math.round(Number(safeDifference.queryStart) || 0)),
    queryEnd: Math.max(0, Math.round(Number(safeDifference.queryEnd) || 0)),
    referenceBases: String(safeDifference.referenceBases || '').slice(0, 20000),
    queryBases: String(safeDifference.queryBases || '').slice(0, 20000)
  };
}

function normalizeAlignmentResultPayload(result) {
  const safeResult = result && typeof result === 'object' ? result : null;
  if (!safeResult) {
    return null;
  }

  return {
    referenceName: cleanText(safeResult.referenceName, 140),
    queryName: cleanText(safeResult.queryName, 140),
    referenceFormat: cleanText(safeResult.referenceFormat, 80),
    queryFormat: cleanText(safeResult.queryFormat, 80),
    orientation: cleanText(safeResult.orientation, 40),
    score: Number(safeResult.score) || 0,
    identityPercent: Number(safeResult.identityPercent) || 0,
    queryCoveragePercent: Number(safeResult.queryCoveragePercent) || 0,
    mismatchCount: Math.max(0, Math.round(Number(safeResult.mismatchCount) || 0)),
    insertionCount: Math.max(0, Math.round(Number(safeResult.insertionCount) || 0)),
    deletionCount: Math.max(0, Math.round(Number(safeResult.deletionCount) || 0)),
    referenceSpan: {
      start: Math.max(0, Math.round(Number(safeResult.referenceSpan?.start) || 0)),
      end: Math.max(0, Math.round(Number(safeResult.referenceSpan?.end) || 0)),
      wraps: safeResult.referenceSpan?.wraps === true
    },
    alignedReference: String(safeResult.alignedReference || '').slice(0, 600000),
    alignedMarkers: String(safeResult.alignedMarkers || '').slice(0, 600000),
    alignedQuery: String(safeResult.alignedQuery || '').slice(0, 600000),
    differences: (Array.isArray(safeResult.differences) ? safeResult.differences : [])
      .map((difference, index) => normalizeAlignmentDifferencePayload(difference, index))
  };
}

function resolveAlignmentSourceFileExtension(session) {
  const originalExtension = path.extname(String(session?.originalFileName || '').trim()).replace(/[^\.\w-]+/g, '').slice(0, 16);
  if (originalExtension) {
    return originalExtension.toLowerCase();
  }

  const sourceFormat = cleanText(session?.sourceFormat || session?.queryRecord?.sourceFormat, 40).toLowerCase();
  if (sourceFormat === 'ab1') {
    return '.ab1';
  }
  if (sourceFormat === 'genbank') {
    return '.gbk';
  }
  if (sourceFormat === 'fasta') {
    return '.fasta';
  }
  return '.txt';
}

function normalizeAlignmentSessionPayload(session, index = 0, existingSession = null) {
  const safeSession = session && typeof session === 'object' ? session : {};
  const queryRecord = normalizeAlignmentQueryRecord(safeSession.queryRecord || safeSession.query, index);
  if (!queryRecord) {
    return null;
  }

  const result = normalizeAlignmentResultPayload(safeSession.result);
  const now = new Date().toISOString();
  const sourceText = typeof safeSession.rawText === 'string'
    ? safeSession.rawText
    : (typeof safeSession.sourceText === 'string' ? safeSession.sourceText : '');
  const sourceBytes = coerceBinaryBuffer(
    safeSession.rawBinary
      ?? safeSession.sourceBytes
      ?? safeSession.sourceBuffer
      ?? safeSession.sourceArrayBuffer
  );
  const baseName = sanitizeFileName(
    stripExtension(safeSession.originalFileName || safeSession.name || queryRecord.name) || 'alignment_query',
    'alignment_query'
  );
  const id = cleanText(safeSession.id, 200)
    || cleanText(existingSession?.id, 200)
    || `align_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  return {
    id,
    name: normalizeName(safeSession.name || queryRecord.name || `alignment_${index + 1}`, `alignment_${index + 1}`),
    referenceRecordKey: cleanText(
      safeSession.referenceRecordKey
        || safeSession.referenceKey
        || existingSession?.referenceRecordKey
        || buildSequenceSignature(safeSession.referenceRecord?.sequence || '', 'ref'),
      200
    ),
    referenceRecordName: normalizeName(
      safeSession.referenceRecordName
        || safeSession.referenceRecord?.name
        || existingSession?.referenceRecordName
        || 'reference',
      'reference'
    ),
    sourceKind: normalizeAlignmentSourceKind(safeSession.sourceKind),
    sourceFormat: cleanText(safeSession.sourceFormat || queryRecord.sourceFormat, 80).toLowerCase() || 'raw',
    originalFileName: cleanText(safeSession.originalFileName, 240),
    storedSourceRelPath: cleanText(safeSession.storedSourceRelPath || existingSession?.storedSourceRelPath, 1200),
    queryRecord,
    result,
    createdAt: normalizeAlignmentTimestamp(safeSession.createdAt, existingSession?.createdAt || now),
    updatedAt: normalizeAlignmentTimestamp(safeSession.updatedAt, now),
    _sourceText: sourceText,
    _sourceBytes: sourceBytes,
    _sourceBaseName: baseName,
    _sourceExtension: resolveAlignmentSourceFileExtension({
      ...safeSession,
      queryRecord
    })
  };
}

function normalizeStoredAlignmentSession(session) {
  const safeSession = session && typeof session === 'object' ? session : null;
  if (!safeSession?.id || !safeSession?.queryRecord) {
    return null;
  }

  return {
    id: cleanText(safeSession.id, 200),
    name: normalizeName(safeSession.name || safeSession.queryRecord?.name || 'alignment', 'alignment'),
    referenceRecordKey: cleanText(safeSession.referenceRecordKey || safeSession.referenceKey, 200),
    referenceRecordName: normalizeName(safeSession.referenceRecordName || 'reference', 'reference'),
    sourceKind: normalizeAlignmentSourceKind(safeSession.sourceKind),
    sourceFormat: cleanText(safeSession.sourceFormat || safeSession.queryRecord?.sourceFormat, 80).toLowerCase() || 'raw',
    originalFileName: cleanText(safeSession.originalFileName, 240),
    storedSourceRelPath: cleanText(safeSession.storedSourceRelPath, 1200),
    queryRecord: normalizeAlignmentQueryRecord(safeSession.queryRecord),
    result: normalizeAlignmentResultPayload(safeSession.result),
    createdAt: normalizeAlignmentTimestamp(safeSession.createdAt),
    updatedAt: normalizeAlignmentTimestamp(safeSession.updatedAt)
  };
}

async function readAlignmentManifest(entryDir) {
  const paths = resolveAlignmentStoragePaths(entryDir);
  try {
    const raw = await fs.readFile(paths.manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return sessions.map((session) => normalizeStoredAlignmentSession(session)).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function clearDirectoryContents(targetDir, options = {}) {
  const preserveNames = new Set((Array.isArray(options.preserveNames) ? options.preserveNames : []).map((value) => String(value)));
  try {
    const items = await fs.readdir(targetDir);
    await Promise.all(items.map(async (itemName) => {
      if (preserveNames.has(itemName)) {
        return;
      }
      await fs.rm(path.join(targetDir, itemName), { recursive: true, force: true });
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeAlignmentManifest(entryDir, inputSessions = [], libraryRoot) {
  const paths = resolveAlignmentStoragePaths(entryDir);
  const existingSessions = await readAlignmentManifest(entryDir);
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));
  const nextSessions = [];

  if (!Array.isArray(inputSessions) || !inputSessions.length) {
    await fs.rm(paths.alignmentsDir, { recursive: true, force: true });
    return [];
  }

  await fs.mkdir(paths.alignmentsDir, { recursive: true });

  for (let index = 0; index < inputSessions.length; index += 1) {
    const inputSession = inputSessions[index];
    const existingSession = existingById.get(cleanText(inputSession?.id, 200)) || null;
    const normalized = normalizeAlignmentSessionPayload(inputSession, index, existingSession);
    if (!normalized) {
      continue;
    }

    const sessionDirName = sanitizeFileName(normalized.id, `alignment_${index + 1}`);
    const sessionDir = path.join(paths.alignmentsDir, sessionDirName);
    await fs.mkdir(sessionDir, { recursive: true });

    let storedSourceRelPath = normalized.storedSourceRelPath;
    if (normalized._sourceText || normalized._sourceBytes) {
      await clearDirectoryContents(sessionDir);
      const sourceFileName = `${normalized._sourceBaseName}${normalized._sourceExtension}`;
      const sourceAbsPath = path.join(sessionDir, sourceFileName);
      if (normalized._sourceBytes) {
        await fs.writeFile(sourceAbsPath, normalized._sourceBytes);
      } else {
        await fs.writeFile(sourceAbsPath, normalized._sourceText, 'utf8');
      }
      storedSourceRelPath = toPosixRelative(libraryRoot, sourceAbsPath);
    }

    nextSessions.push({
      id: normalized.id,
      name: normalized.name,
      referenceRecordKey: normalized.referenceRecordKey,
      referenceRecordName: normalized.referenceRecordName,
      sourceKind: normalized.sourceKind,
      sourceFormat: normalized.sourceFormat,
      originalFileName: normalized.originalFileName,
      storedSourceRelPath,
      queryRecord: normalized.queryRecord,
      result: normalized.result,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt
    });
  }

  const keepSessionDirs = new Set(nextSessions.map((session) => sanitizeFileName(session.id, session.id)));
  try {
    const entries = await fs.readdir(paths.alignmentsDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      if (keepSessionDirs.has(entry.name)) {
        return;
      }
      await fs.rm(path.join(paths.alignmentsDir, entry.name), { recursive: true, force: true });
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(
    paths.manifestPath,
    JSON.stringify({ sessions: nextSessions }, null, 2),
    'utf8'
  );
  return nextSessions;
}

function attachAlignmentSourcePaths(sessions, libraryRoot) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const safeSession = normalizeStoredAlignmentSession(session);
      if (!safeSession) {
        return null;
      }
      const storedSourcePath = safeSession.storedSourceRelPath
        ? ensurePathWithinRoot(libraryRoot, safeSession.storedSourceRelPath)
        : '';
      return {
        ...safeSession,
        storedSourcePath
      };
    })
    .filter(Boolean);
}

function normalizeFeatureSegments(rawSegments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength) {
    return [];
  }
  return (Array.isArray(rawSegments) ? rawSegments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });
}

function normalizeFeaturePayload(feature, sequenceLength, index = 0) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const source = cleanText(feature?.source || feature?.mode || '', 120).toLowerCase();
  if (source === FEATURE_SOURCE_BACKBONE_RECOGNITION) {
    return null;
  }

  const strand = Number(feature?.strand) === -1 ? -1 : 1;
  const segments = normalizeFeatureSegments(feature?.segments, sequenceLength);
  if (!segments.length) {
    return null;
  }

  return {
    name: normalizeName(feature?.name || feature?.label || `feature_${index + 1}`, `feature_${index + 1}`),
    type: cleanText(feature?.type || 'misc_feature', 120).toLowerCase() || 'misc_feature',
    strand,
    source,
    segments
  };
}

function extractFeatureSequence(sequence, feature) {
  const text = normalizeSequenceText(sequence);
  if (!text.length || !feature) {
    return '';
  }

  const orderedSegments = normalizeFeatureSegments(feature.segments, text.length);
  if (!orderedSegments.length) {
    return '';
  }

  const raw = orderedSegments
    .map((segment) => text.slice(segment.start, segment.end))
    .join('');

  return feature.strand === -1
    ? reverseComplementIupac(raw)
    : raw;
}

function buildFeatureDedupeKey(name, type, sequence) {
  return crypto
    .createHash('sha1')
    .update(`${String(name || '').toLowerCase()}\n${String(type || '').toLowerCase()}\n${String(sequence || '')}`)
    .digest('hex');
}

function extractFeatureBounds(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) {
    return { startPos: 1, endPos: 0 };
  }

  const minStart = list.reduce((min, segment) => Math.min(min, Number(segment?.start) || 0), Number.POSITIVE_INFINITY);
  const maxEnd = list.reduce((max, segment) => Math.max(max, Number(segment?.end) || 0), 0);
  return {
    startPos: Math.max(1, minStart + 1),
    endPos: Math.max(0, maxEnd)
  };
}

function deleteOrphanFeatures(db) {
  db.run(`
    DELETE FROM sequence_features
    WHERE id NOT IN (
      SELECT DISTINCT feature_id
      FROM sequence_feature_occurrences
    )
  `);
}

function replaceFeatureOccurrencesForEntry(db, entryRow, payload = {}) {
  const hostVectorId = cleanText(entryRow?.id, 200);
  if (!hostVectorId) {
    return;
  }

  db.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [hostVectorId]);

  const sequence = normalizeSequenceText(payload.sequence);
  const normalizedFeatures = (Array.isArray(payload.features) ? payload.features : [])
    .map((feature, index) => normalizeFeaturePayload(feature, sequence.length, index))
    .filter(Boolean);

  if (!sequence.length || !normalizedFeatures.length) {
    deleteOrphanFeatures(db);
    return;
  }

  const now = new Date().toISOString();

  normalizedFeatures.forEach((feature) => {
    const featureSequence = extractFeatureSequence(sequence, feature);
    if (!featureSequence) {
      return;
    }

    const dedupeKey = buildFeatureDedupeKey(feature.name, feature.type, featureSequence);
    const featureId = buildStableId('feature', dedupeKey);
    const bounds = extractFeatureBounds(feature.segments);
    const occurrenceId = buildStableId(
      'feature_occurrence',
      [
        featureId,
        hostVectorId,
        bounds.startPos,
        bounds.endPos,
        feature.strand,
        feature.source
      ].join('|')
    );

    db.run(
      `INSERT INTO sequence_features (
         id, name, normalized_name, feature_type, sequence, sequence_length, dedupe_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         normalized_name = excluded.normalized_name,
         feature_type = excluded.feature_type,
         sequence = excluded.sequence,
         sequence_length = excluded.sequence_length,
         updated_at = excluded.updated_at`,
      [
        featureId,
        feature.name,
        feature.name.toLowerCase(),
        feature.type,
        featureSequence,
        featureSequence.length,
        dedupeKey,
        now,
        now
      ]
    );

    db.run(
      `INSERT INTO sequence_feature_occurrences (
         id, feature_id, host_vector_id, host_vector_name, host_vector_status, host_topology,
         host_sequence_length, source_format, annotation_source, strand, start_pos, end_pos,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         feature_id = excluded.feature_id,
         host_vector_name = excluded.host_vector_name,
         host_vector_status = excluded.host_vector_status,
         host_topology = excluded.host_topology,
         host_sequence_length = excluded.host_sequence_length,
         source_format = excluded.source_format,
         annotation_source = excluded.annotation_source,
         strand = excluded.strand,
         start_pos = excluded.start_pos,
         end_pos = excluded.end_pos,
         updated_at = excluded.updated_at`,
      [
        occurrenceId,
        featureId,
        hostVectorId,
        cleanText(entryRow?.name, 140),
        normalizeStatus(entryRow?.status),
        cleanText(entryRow?.topology, 40) || 'linear',
        Math.max(0, Number(entryRow?.sequenceLength) || 0),
        cleanText(entryRow?.sourceFormat, 80),
        feature.source,
        feature.strand,
        bounds.startPos,
        bounds.endPos,
        now,
        now
      ]
    );
  });

  deleteOrphanFeatures(db);
}

function normalizeFeatureOccurrenceRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: cleanText(row.id, 200),
    featureId: cleanText(row.feature_id, 200),
    hostVectorId: cleanText(row.host_vector_id, 200),
    hostVectorName: cleanText(row.host_vector_name, 140),
    hostVectorStatus: normalizeStatus(row.host_vector_status),
    topology: cleanText(row.host_topology, 40) || 'linear',
    sequenceLength: Math.max(0, Number(row.host_sequence_length) || 0),
    sourceFormat: cleanText(row.source_format, 80),
    annotationSource: cleanText(row.annotation_source, 120),
    strand: Number(row.strand) === -1 ? -1 : 1,
    startPos: Math.max(1, Number(row.start_pos) || 1),
    endPos: Math.max(0, Number(row.end_pos) || 0),
    createdAt: cleanText(row.created_at, 60),
    updatedAt: cleanText(row.updated_at, 60)
  };
}

function buildFeatureSearchResult(db, row) {
  const featureId = cleanText(row?.id, 200);
  const occurrenceRows = readRows(
    db,
    `SELECT *
     FROM sequence_feature_occurrences
     WHERE feature_id = ?
     ORDER BY updated_at DESC, host_vector_name COLLATE NOCASE ASC, start_pos ASC`,
    [featureId]
  );

  const hostsById = new Map();
  occurrenceRows.forEach((occurrenceRow) => {
    const occurrence = normalizeFeatureOccurrenceRow(occurrenceRow);
    if (!occurrence) {
      return;
    }

    const key = occurrence.hostVectorId;
    if (!hostsById.has(key)) {
      hostsById.set(key, {
        hostVectorId: occurrence.hostVectorId,
        hostVectorName: occurrence.hostVectorName,
        hostVectorStatus: occurrence.hostVectorStatus,
        topology: occurrence.topology,
        sequenceLength: occurrence.sequenceLength,
        sourceFormat: occurrence.sourceFormat,
        updatedAt: occurrence.updatedAt,
        locations: []
      });
    }

    hostsById.get(key).locations.push({
      startPos: occurrence.startPos,
      endPos: occurrence.endPos,
      strand: occurrence.strand,
      annotationSource: occurrence.annotationSource
    });
  });

  const hosts = [...hostsById.values()];
  return {
    id: featureId,
    name: cleanText(row?.name, 140),
    normalizedName: cleanText(row?.normalized_name, 200),
    type: cleanText(row?.feature_type, 120),
    sequence: normalizeSequenceText(row?.sequence),
    sequenceLength: Math.max(0, Number(row?.sequence_length) || 0),
    hostCount: hosts.length,
    updatedAt: cleanText(row?.updated_at, 60),
    hosts
  };
}

async function clearEntryFiles(entryDir, options = {}) {
  await clearDirectoryContents(entryDir, options);
}

function findNextSavedName(db, requestedName, selfId = '') {
  const base = normalizeName(requestedName, 'sequence');
  for (let attempt = 1; attempt < 5000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}_${attempt}`;
    const normalized = candidate.toLowerCase();
    const row = readSingleRow(
      db,
      'SELECT id FROM sequence_entries WHERE status = ? AND normalized_name = ? LIMIT 1',
      [STATUS_SAVED, normalized]
    );
    if (!row || cleanText(row.id, 200) === cleanText(selfId, 200)) {
      return candidate;
    }
  }
  throw new Error('Failed to resolve a unique saved sequence name.');
}

async function listSequenceEntries({ storagePath, status = '' }) {
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const normalizedStatus = cleanText(status, 40).toLowerCase();
    const filtered = normalizedStatus === STATUS_SAVED || normalizedStatus === STATUS_TEMPORARY;
    const rows = filtered
      ? readRows(
        db,
        `SELECT * FROM sequence_entries
         WHERE status = ?
         ORDER BY updated_at DESC, name COLLATE NOCASE ASC`,
        [normalizedStatus]
      )
      : readRows(
        db,
        `SELECT * FROM sequence_entries
         ORDER BY status ASC, updated_at DESC, name COLLATE NOCASE ASC`
      );

    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entries: rows.map((row) => normalizeEntryRow(row)).filter(Boolean)
    };
  } finally {
    db.close();
  }
}

async function getSequenceEntry({ storagePath, id, includeGbk = false, includeHtml = false, includeAlignments = false }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const row = readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [safeId]);
    const entry = normalizeEntryRow(row);
    if (!entry) {
      return { entry: null };
    }
    const result = { entry };
    if (includeGbk) {
      const gbkPath = ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath);
      result.gbkText = await fs.readFile(gbkPath, 'utf8');
    }
    if (includeHtml) {
      const htmlPath = ensurePathWithinRoot(paths.libraryRoot, entry.htmlRelPath);
      result.htmlText = await fs.readFile(htmlPath, 'utf8');
    }
    if (includeAlignments) {
      const entryDir = path.join(paths.entriesRoot, entry.id);
      const sessions = await readAlignmentManifest(entryDir);
      result.alignments = attachAlignmentSourcePaths(sessions, paths.libraryRoot);
    }
    return result;
  } finally {
    db.close();
  }
}

async function upsertSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const gbkText = String(payload.gbkText || '');
  const htmlText = String(payload.htmlText || '');
  const alignmentSessions = Array.isArray(payload.alignmentSessions) ? payload.alignmentSessions : null;
  if (!gbkText.trim()) {
    throw new Error('GBK content is required.');
  }
  if (!htmlText.trim()) {
    throw new Error('HTML preview content is required.');
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const inputId = cleanText(payload.id, 200);
    const existingRow = inputId
      ? readSingleRow(db, 'SELECT * FROM sequence_entries WHERE id = ? LIMIT 1', [inputId])
      : null;
    const existing = normalizeEntryRow(existingRow);

    const status = normalizeStatus(payload.status || existing?.status || STATUS_TEMPORARY);
    const requestedName = normalizeName(payload.name || existing?.name || 'sequence', 'sequence');
    const resolvedName = status === STATUS_SAVED
      ? findNextSavedName(db, requestedName, existing?.id || '')
      : requestedName;
    const entryId = existing?.id || inputId || buildEntryId();
    const fileSafeName = sanitizeFileName(resolvedName, 'sequence');
    const entryDir = path.join(paths.entriesRoot, entryId);
    await fs.mkdir(entryDir, { recursive: true });
    await clearEntryFiles(entryDir, { preserveNames: [ALIGNMENTS_DIR_NAME] });

    const gbkAbsPath = path.join(entryDir, `${fileSafeName}.gbk`);
    const htmlAbsPath = path.join(entryDir, `${fileSafeName}.html`);
    await fs.writeFile(gbkAbsPath, gbkText, 'utf8');
    await fs.writeFile(htmlAbsPath, htmlText, 'utf8');

    const now = new Date().toISOString();
    const createdAt = existing?.createdAt || now;
    const row = {
      id: entryId,
      name: resolvedName,
      normalizedName: resolvedName.toLowerCase(),
      status,
      sourceFormat: cleanText(payload.sourceFormat || existing?.sourceFormat, 80),
      topology: cleanText(payload.topology || existing?.topology, 40) || 'linear',
      sequenceLength: Math.max(0, Math.round(Number(payload.sequenceLength) || Number(existing?.sequenceLength) || 0)),
      featureCount: Math.max(0, Math.round(Number(payload.featureCount) || Number(existing?.featureCount) || 0)),
      gbkRelPath: toPosixRelative(paths.libraryRoot, gbkAbsPath),
      htmlRelPath: toPosixRelative(paths.libraryRoot, htmlAbsPath),
      createdAt,
      updatedAt: now
    };

    db.run(
      `INSERT INTO sequence_entries (
         id, name, normalized_name, status, source_format, topology, sequence_length, feature_count,
         gbk_rel_path, html_rel_path, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         normalized_name = excluded.normalized_name,
         status = excluded.status,
         source_format = excluded.source_format,
         topology = excluded.topology,
         sequence_length = excluded.sequence_length,
         feature_count = excluded.feature_count,
         gbk_rel_path = excluded.gbk_rel_path,
         html_rel_path = excluded.html_rel_path,
         updated_at = excluded.updated_at`,
      [
        row.id,
        row.name,
        row.normalizedName,
        row.status,
        row.sourceFormat,
        row.topology,
        row.sequenceLength,
        row.featureCount,
        row.gbkRelPath,
        row.htmlRelPath,
        row.createdAt,
        row.updatedAt
      ]
    );

    replaceFeatureOccurrencesForEntry(db, row, payload);

    const nextAlignmentSessions = alignmentSessions === null
      ? attachAlignmentSourcePaths(await readAlignmentManifest(entryDir), paths.libraryRoot)
      : attachAlignmentSourcePaths(
        await writeAlignmentManifest(entryDir, alignmentSessions, paths.libraryRoot),
        paths.libraryRoot
      );

    await persistDatabase(paths.sqlitePath, db);
    return {
      rootPath: paths.libraryRoot,
      sqlitePath: paths.sqlitePath,
      entry: row,
      alignments: nextAlignmentSessions
    };
  } finally {
    db.close();
  }
}

async function promoteSequenceEntry(payload = {}) {
  const storagePath = cleanText(payload.storagePath, 2000);
  const entryId = cleanText(payload.id, 200);
  if (!entryId) {
    throw new Error('Missing sequence entry id.');
  }
  const current = await getSequenceEntry({
    storagePath,
    id: entryId,
    includeGbk: true,
    includeHtml: true
  });
  if (!current?.entry) {
    throw new Error('Sequence entry not found.');
  }
  return upsertSequenceEntry({
    storagePath,
    id: current.entry.id,
    name: cleanText(payload.name, 140) || current.entry.name,
    status: STATUS_SAVED,
    sourceFormat: current.entry.sourceFormat,
    topology: current.entry.topology,
    sequenceLength: current.entry.sequenceLength,
    featureCount: current.entry.featureCount,
    gbkText: current.gbkText,
    htmlText: current.htmlText
  });
}

async function deleteSequenceEntry({ storagePath, id }) {
  const safeId = cleanText(id, 200);
  if (!safeId) {
    throw new Error('Missing sequence entry id.');
  }
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    db.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [safeId]);
    db.run('DELETE FROM sequence_entries WHERE id = ?', [safeId]);
    deleteOrphanFeatures(db);
    await persistDatabase(paths.sqlitePath, db);
  } finally {
    db.close();
  }
  const entryDir = path.join(paths.entriesRoot, safeId);
  await fs.rm(entryDir, { recursive: true, force: true });
  return { ok: true, id: safeId };
}

async function searchSequenceFeatures({ storagePath, query = '', limit = 30 }) {
  const safeQuery = cleanText(query, 600);
  const normalizedNameQuery = safeQuery.toLowerCase();
  const normalizedSequenceQuery = normalizeSequenceText(safeQuery);
  if (normalizedNameQuery.length < 2 && normalizedSequenceQuery.length < 3) {
    return {
      query: safeQuery,
      results: []
    };
  }

  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    const safeLimit = clamp(Math.round(Number(limit) || 30), 1, 100);
    const namePattern = normalizedNameQuery ? `%${normalizedNameQuery}%` : '';
    const sequencePattern = normalizedSequenceQuery ? `%${normalizedSequenceQuery}%` : '';
    const rows = readRows(
      db,
      `SELECT DISTINCT f.*
       FROM sequence_features f
       WHERE (? <> '' AND f.normalized_name LIKE ?)
          OR (? <> '' AND f.sequence LIKE ?)
       ORDER BY
         CASE WHEN ? <> '' AND f.normalized_name = ? THEN 0 ELSE 1 END,
         CASE WHEN ? <> '' AND f.sequence = ? THEN 0 ELSE 1 END,
         f.updated_at DESC,
         f.name COLLATE NOCASE ASC
       LIMIT ?`,
      [
        normalizedNameQuery,
        namePattern,
        normalizedSequenceQuery,
        sequencePattern,
        normalizedNameQuery,
        normalizedNameQuery,
        normalizedSequenceQuery,
        normalizedSequenceQuery,
        safeLimit
      ]
    );

    return {
      query: safeQuery,
      results: rows.map((row) => buildFeatureSearchResult(db, row)).filter(Boolean)
    };
  } finally {
    db.close();
  }
}
async function recognizeSequenceBackbone({ storagePath, sequence = '', excludeEntryId = '' }) {
  return recognizeSequenceBackboneInLibrary({
    fs,
    cleanText,
    normalizeSequenceText,
    normalizeStatus,
    clamp,
    reverseComplementIupac,
    resolveLibraryPaths,
    ensureLibraryDirectories,
    openDatabase,
    readRows,
    normalizeEntryRow,
    ensurePathWithinRoot,
    STATUS_SAVED,
    STATUS_TEMPORARY
  }, {
    storagePath,
    sequence,
    excludeEntryId
  });
}

module.exports = {
  STATUS_SAVED,
  STATUS_TEMPORARY,
  LIBRARY_FOLDER_NAME,
  DB_FILE_NAME,
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  searchSequenceFeatures,
  recognizeSequenceBackbone,
  sanitizeFileName
};
