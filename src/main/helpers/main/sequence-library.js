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
const FEATURE_SOURCE_SQL_ANNOTATION_DNA = 'sql_annotation_dna';
const FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN = 'sql_annotation_protein';
const ALIGNMENTS_DIR_NAME = 'alignments';
const ALIGNMENTS_MANIFEST_FILE_NAME = 'alignment-sessions.json';
const RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME = 'protein-builder/backbones';
const RECOGNIZED_BACKBONE_SCHEMA_NAME = 'enana_recognized_backbone';
const ORF_START_CODONS = new Set(['ATG']);
const ORF_STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);
const MIN_DNA_ANNOTATION_FEATURE_LENGTH = 12;
const MIN_PROTEIN_ANNOTATION_AA_LENGTH = 3;
const MAX_ANNOTATION_MATCHES_PER_FEATURE = 32;
const MAX_ANNOTATION_FEATURES_PER_RUN = 500;

let sqlJsInitPromise = null;

const CODON_TO_AMINO_ACID = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
});

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

function normalizeRecognitionSegmentList(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Math.max(0, Math.round(Number(segment?.start) || 0));
      const end = Math.max(0, Math.round(Number(segment?.end) || 0));
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean);
}

function computeRecognizedBackboneInsertionOffset(backboneSegments = [], insertSegments = []) {
  const normalizedBackboneSegments = normalizeRecognitionSegmentList(backboneSegments);
  const normalizedInsertSegments = normalizeRecognitionSegmentList(insertSegments);
  if (!normalizedBackboneSegments.length) {
    return 0;
  }
  if (!normalizedInsertSegments.length) {
    return normalizedBackboneSegments.reduce(
      (length, segment) => length + Math.max(0, segment.end - segment.start),
      0
    );
  }

  const insertStart = normalizedInsertSegments[0].start;
  let insertionOffset = 0;
  let matched = false;

  normalizedBackboneSegments.forEach((segment) => {
    if (matched) {
      return;
    }
    if (segment.end <= insertStart) {
      insertionOffset += Math.max(0, segment.end - segment.start);
      return;
    }
    if (segment.start >= insertStart) {
      matched = true;
      return;
    }
    insertionOffset += Math.max(0, insertStart - segment.start);
    matched = true;
  });

  return insertionOffset;
}

function positiveModulo(value, modulo) {
  if (!Number.isFinite(Number(modulo)) || modulo <= 0) {
    return 0;
  }
  const numeric = Number(value) || 0;
  return ((numeric % modulo) + modulo) % modulo;
}

function normalizeTopologyValue(value) {
  return String(value || '').toLowerCase().trim() === 'circular' ? 'circular' : 'linear';
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
    CREATE TABLE IF NOT EXISTS sequence_feature_cds_sequences (
      feature_id TEXT PRIMARY KEY,
      dna_sequence TEXT NOT NULL,
      dna_length INTEGER NOT NULL DEFAULT 0,
      amino_acid_sequence TEXT NOT NULL,
      amino_acid_length INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(feature_id) REFERENCES sequence_features(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sequence_feature_proteins (
      feature_id TEXT PRIMARY KEY,
      protein_sequence TEXT NOT NULL,
      protein_length INTEGER NOT NULL DEFAULT 0,
      translation_source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(feature_id) REFERENCES sequence_features(id) ON DELETE CASCADE
    );
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
  const hadCdsSequenceTable = Boolean(
    readSingleRow(
      db,
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = 'sequence_feature_cds_sequences'
       LIMIT 1`
    )
  );
  applySchema(db);
  const cdsTableChanges = rebuildCdsSequenceTable(db);
  if (!hadCdsSequenceTable || cdsTableChanges > 0) {
    await persistDatabase(sqlitePath, db);
  }
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
  if (
    source === FEATURE_SOURCE_BACKBONE_RECOGNITION
    || source === FEATURE_SOURCE_SQL_ANNOTATION_DNA
    || source === FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN
  ) {
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
    translation: normalizeProteinSequence(feature?.translation || feature?.proteinSequence || ''),
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

function normalizeProteinSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z*]/g, '');
}

function stripTerminalProteinStop(proteinSequence) {
  const normalized = normalizeProteinSequence(proteinSequence);
  return normalized.endsWith('*') ? normalized.slice(0, -1) : normalized;
}

function translateFeatureSequenceToProtein(featureSequence) {
  const sequence = normalizeSequenceText(featureSequence);
  const codonCount = Math.floor(sequence.length / 3);
  if (codonCount <= 0) {
    return '';
  }

  let protein = '';
  for (let index = 0; index < codonCount; index += 1) {
    const codon = sequence.slice(index * 3, (index * 3) + 3);
    protein += CODON_TO_AMINO_ACID[codon] || 'X';
  }
  return stripTerminalProteinStop(protein);
}

function resolveFeatureProteinPayload(feature, featureSequence) {
  if (String(feature?.type || '').toLowerCase() !== 'cds') {
    return { proteinSequence: '', translationSource: '' };
  }

  const qualifierProteinSequence = stripTerminalProteinStop(feature?.translation || feature?.proteinSequence || '');
  if (qualifierProteinSequence) {
    return {
      proteinSequence: qualifierProteinSequence,
      translationSource: 'qualifier'
    };
  }

  const derivedProteinSequence = translateFeatureSequenceToProtein(featureSequence);
  if (derivedProteinSequence) {
    return {
      proteinSequence: derivedProteinSequence,
      translationSource: 'derived'
    };
  }
  return { proteinSequence: '', translationSource: '' };
}

function rebuildCdsSequenceTable(db) {
  if (!db || typeof db.run !== 'function') {
    return 0;
  }

  let rowsChanged = 0;
  db.run(`
    DELETE FROM sequence_feature_cds_sequences
    WHERE feature_id NOT IN (
      SELECT id
      FROM sequence_features
      WHERE lower(feature_type) = 'cds'
    )
  `);
  rowsChanged += Math.max(0, Number(db.getRowsModified?.() || 0));

  const cdsRows = readRows(
    db,
    `SELECT id, sequence, created_at, updated_at
     FROM sequence_features
     WHERE lower(feature_type) = 'cds'
     ORDER BY updated_at DESC, name COLLATE NOCASE ASC`
  );

  cdsRows.forEach((row) => {
    const featureId = cleanText(row?.id, 200);
    const dnaSequence = normalizeSequenceText(row?.sequence);
    if (!featureId || !dnaSequence) {
      return;
    }

    const createdAt = cleanText(row?.created_at, 60) || new Date().toISOString();
    const updatedAt = cleanText(row?.updated_at, 60) || createdAt;
    const aminoAcidSequence = translateFeatureSequenceToProtein(dnaSequence);

    db.run(
      `INSERT INTO sequence_feature_cds_sequences (
         feature_id, dna_sequence, dna_length, amino_acid_sequence, amino_acid_length, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_id) DO UPDATE SET
         dna_sequence = excluded.dna_sequence,
         dna_length = excluded.dna_length,
         amino_acid_sequence = excluded.amino_acid_sequence,
         amino_acid_length = excluded.amino_acid_length,
         updated_at = excluded.updated_at`,
      [
        featureId,
        dnaSequence,
        dnaSequence.length,
        aminoAcidSequence,
        aminoAcidSequence.length,
        createdAt,
        updatedAt
      ]
    );
    rowsChanged += Math.max(0, Number(db.getRowsModified?.() || 0));
  });

  return rowsChanged;
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
    rebuildCdsSequenceTable(db);
    return;
  }

  const now = new Date().toISOString();

  normalizedFeatures.forEach((feature) => {
    const featureSequence = extractFeatureSequence(sequence, feature);
    if (!featureSequence) {
      return;
    }
    const proteinPayload = resolveFeatureProteinPayload(feature, featureSequence);

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

    if (proteinPayload.proteinSequence) {
      db.run(
        `INSERT INTO sequence_feature_proteins (
           feature_id, protein_sequence, protein_length, translation_source, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(feature_id) DO UPDATE SET
           protein_sequence = excluded.protein_sequence,
           protein_length = excluded.protein_length,
           translation_source = excluded.translation_source,
           updated_at = excluded.updated_at`,
        [
          featureId,
          proteinPayload.proteinSequence,
          proteinPayload.proteinSequence.length,
          proteinPayload.translationSource,
          now,
          now
        ]
      );
    } else {
      db.run('DELETE FROM sequence_feature_proteins WHERE feature_id = ?', [featureId]);
    }

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
  rebuildCdsSequenceTable(db);
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
    rebuildCdsSequenceTable(db);
    await persistDatabase(paths.sqlitePath, db);
  } finally {
    db.close();
  }
  const entryDir = path.join(paths.entriesRoot, safeId);
  await fs.rm(entryDir, { recursive: true, force: true });
  return { ok: true, id: safeId };
}

function buildSegmentsFromStartAndLength(start, length, sequenceLength, topology = 'linear') {
  const normalizedLength = Math.max(0, Number(sequenceLength) || 0);
  const normalizedSpan = Math.max(0, Number(length) || 0);
  if (!normalizedLength || normalizedSpan <= 0) {
    return [];
  }

  if (normalizeTopologyValue(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, normalizedLength);
    const safeEnd = clamp(safeStart + normalizedSpan, 0, normalizedLength);
    return safeEnd > safeStart ? [{ start: safeStart, end: safeEnd }] : [];
  }

  const circularStart = positiveModulo(Math.round(Number(start) || 0), normalizedLength);
  if (normalizedSpan >= normalizedLength) {
    if (circularStart === 0) {
      return [{ start: 0, end: normalizedLength }];
    }
    return [
      { start: circularStart, end: normalizedLength },
      { start: 0, end: circularStart }
    ];
  }

  const circularEnd = (circularStart + normalizedSpan) % normalizedLength;
  if (circularEnd > circularStart) {
    return [{ start: circularStart, end: circularEnd }];
  }
  if (circularEnd === circularStart) {
    return [{ start: 0, end: normalizedLength }];
  }
  return [
    { start: circularStart, end: normalizedLength },
    { start: 0, end: circularEnd }
  ];
}

function readCircularCodon(sequence, start) {
  const text = String(sequence || '');
  const length = text.length;
  if (length < 3) {
    return '';
  }
  const first = text[positiveModulo(start, length)] || '';
  const second = text[positiveModulo(start + 1, length)] || '';
  const third = text[positiveModulo(start + 2, length)] || '';
  return `${first}${second}${third}`;
}

function readSequenceSpan(sequence, start, length, topology = 'linear') {
  const text = String(sequence || '');
  const safeLength = Math.max(0, Number(length) || 0);
  if (!text.length || safeLength <= 0) {
    return '';
  }

  if (normalizeTopologyValue(topology) === 'linear') {
    const safeStart = clamp(Math.round(Number(start) || 0), 0, text.length);
    return text.slice(safeStart, safeStart + safeLength);
  }

  let output = '';
  const safeStart = positiveModulo(Math.round(Number(start) || 0), text.length);
  for (let index = 0; index < safeLength; index += 1) {
    output += text[positiveModulo(safeStart + index, text.length)] || '';
  }
  return output;
}

function findPatternMatchStarts(querySequence, patternSequence, topology = 'linear', maxHits = MAX_ANNOTATION_MATCHES_PER_FEATURE) {
  const query = normalizeSequenceText(querySequence);
  const pattern = normalizeSequenceText(patternSequence);
  if (!query.length || !pattern.length || pattern.length > query.length) {
    return [];
  }

  if (pattern.length === query.length) {
    return query === pattern ? [0] : [];
  }

  const normalizedTopology = normalizeTopologyValue(topology);
  const haystack = normalizedTopology === 'circular'
    ? `${query}${query.slice(0, Math.max(0, pattern.length - 1))}`
    : query;
  const starts = [];
  let cursor = 0;

  while (starts.length < Math.max(1, Number(maxHits) || MAX_ANNOTATION_MATCHES_PER_FEATURE)) {
    const matchIndex = haystack.indexOf(pattern, cursor);
    if (matchIndex < 0 || matchIndex >= query.length) {
      break;
    }
    starts.push(matchIndex);
    cursor = matchIndex + 1;
  }

  return starts;
}

function appendHostToMap(hostMap, row) {
  if (!hostMap || !(hostMap instanceof Map)) {
    return;
  }

  const hostVectorId = cleanText(row?.host_vector_id, 200);
  if (!hostVectorId) {
    return;
  }

  if (!hostMap.has(hostVectorId)) {
    hostMap.set(hostVectorId, {
      hostVectorId,
      hostVectorName: cleanText(row?.host_vector_name, 140),
      hostVectorStatus: normalizeStatus(row?.host_vector_status)
    });
  }
}

function shouldSkipAnnotationFeatureName(name) {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return normalized === 'misc_feature'
    || normalized.startsWith('misc_feature_');
}

function buildDnaAnnotationCandidates(db, queryLength, excludeEntryId = '') {
  const rows = readRows(
    db,
    `SELECT f.id, f.name, f.feature_type, f.sequence, f.sequence_length, f.updated_at,
            o.host_vector_id, o.host_vector_name, o.host_vector_status
     FROM sequence_features f
     JOIN sequence_feature_occurrences o ON o.feature_id = f.id
     WHERE lower(f.feature_type) <> 'cds'
       AND f.sequence_length >= ?
       AND f.sequence_length <= ?
       AND lower(COALESCE(o.annotation_source, '')) NOT LIKE 'sql_annotation_%'
       AND (? = '' OR o.host_vector_id <> ?)
     ORDER BY f.sequence_length DESC, f.updated_at DESC, f.name COLLATE NOCASE ASC`,
    [
      MIN_DNA_ANNOTATION_FEATURE_LENGTH,
      Math.max(0, Number(queryLength) || 0),
      cleanText(excludeEntryId, 200),
      cleanText(excludeEntryId, 200)
    ]
  );

  const byFeatureId = new Map();
  rows.forEach((row) => {
    const featureId = cleanText(row?.id, 200);
    const sequence = normalizeSequenceText(row?.sequence);
    if (!featureId || !sequence || shouldSkipAnnotationFeatureName(row?.name)) {
      return;
    }

    let candidate = byFeatureId.get(featureId);
    if (!candidate) {
      candidate = {
        featureId,
        name: normalizeName(row?.name || 'feature', 'feature'),
        type: cleanText(row?.feature_type, 120).toLowerCase() || 'misc_feature',
        matchedSequence: sequence,
        sequenceLength: Math.max(0, Number(row?.sequence_length) || sequence.length),
        hosts: new Map()
      };
      byFeatureId.set(featureId, candidate);
    }
    appendHostToMap(candidate.hosts, row);
  });

  return [...byFeatureId.values()]
    .map((candidate) => ({
      ...candidate,
      hosts: [...candidate.hosts.values()]
    }))
    .sort((left, right) => {
      if (left.sequenceLength !== right.sequenceLength) {
        return right.sequenceLength - left.sequenceLength;
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
}

function detectLinearOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= sequenceLength - 3; start += 3) {
      const startCodon = text.slice(start, start + 3);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let position = start + 3; position <= sequenceLength - 3; position += 3) {
        const stopCodon = text.slice(position, position + 3);
        if (!ORF_STOP_CODONS.has(stopCodon)) {
          continue;
        }
        const length = (position + 3) - start;
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectCircularOrfHits(sequence, minNtLength) {
  const text = String(sequence || '');
  const sequenceLength = text.length;
  if (sequenceLength < 6) {
    return [];
  }

  const maxCodonSteps = Math.max(0, Math.floor(sequenceLength / 3));
  if (!maxCodonSteps) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start < sequenceLength; start += 3) {
      const startCodon = readCircularCodon(text, start);
      if (!ORF_START_CODONS.has(startCodon)) {
        continue;
      }

      for (let step = 1; step <= maxCodonSteps; step += 1) {
        const length = (step * 3) + 3;
        if (length > sequenceLength) {
          break;
        }
        const position = (start + (step * 3)) % sequenceLength;
        const stopCodon = readCircularCodon(text, position);
        if (!ORF_STOP_CODONS.has(stopCodon)) {
          continue;
        }
        if (length >= minNtLength) {
          hits.push({
            start,
            length,
            frame,
            stopCodon
          });
        }
        break;
      }
    }
  }

  return hits;
}

function detectOrfHitsForSequence(sequence, topology, minNtLength) {
  return normalizeTopologyValue(topology) === 'circular'
    ? detectCircularOrfHits(sequence, minNtLength)
    : detectLinearOrfHits(sequence, minNtLength);
}

function buildProteinAnnotationOrfs(sequence, topology = 'linear', minAaLength = MIN_PROTEIN_ANNOTATION_AA_LENGTH) {
  const text = normalizeSequenceText(sequence).replace(/[^ACGT]/g, 'N');
  const sequenceLength = text.length;
  if (!sequenceLength) {
    return [];
  }

  const normalizedTopology = normalizeTopologyValue(topology);
  const safeMinAaLength = Math.max(1, Math.floor(Number(minAaLength) || MIN_PROTEIN_ANNOTATION_AA_LENGTH));
  const minNtLength = Math.max(6, (safeMinAaLength + 1) * 3);
  const forwardHits = detectOrfHitsForSequence(text, normalizedTopology, minNtLength);
  const reverseSequence = reverseComplementIupac(text).replace(/[^ACGT]/g, 'N');
  const reverseHits = detectOrfHitsForSequence(reverseSequence, normalizedTopology, minNtLength);
  const dedupe = new Set();
  const orfs = [];

  const pushOrf = (hit, strand) => {
    const hitLength = Math.max(0, Number(hit?.length) || 0);
    if (hitLength <= 0) {
      return;
    }

    const genomicStart = strand === 1
      ? Math.max(0, Number(hit?.start) || 0)
      : positiveModulo(sequenceLength - ((Number(hit?.start) || 0) + hitLength), sequenceLength);
    const segments = buildSegmentsFromStartAndLength(genomicStart, hitLength, sequenceLength, normalizedTopology);
    if (!segments.length) {
      return;
    }

    const sourceSequence = strand === 1 ? text : reverseSequence;
    const dnaSequence = readSequenceSpan(sourceSequence, Number(hit?.start) || 0, hitLength, normalizedTopology);
    const proteinSequence = translateFeatureSequenceToProtein(dnaSequence);
    if (!proteinSequence) {
      return;
    }

    const frameIndex = Math.max(0, Math.min(2, Number(hit?.frame) || 0));
    const frameLabel = `${strand === -1 ? '-' : '+'}${frameIndex + 1}`;
    const dedupeKey = `${strand}|${frameLabel}|${segments.map((segment) => `${segment.start}-${segment.end}`).join(',')}|${proteinSequence}`;
    if (dedupe.has(dedupeKey)) {
      return;
    }
    dedupe.add(dedupeKey);

    orfs.push({
      strand,
      segments,
      dnaSequence,
      proteinSequence,
      translation: proteinSequence,
      orfFrame: frameLabel,
      orfLengthNt: hitLength,
      orfLengthAa: proteinSequence.length,
      startCodon: 'ATG',
      stopCodon: String(hit?.stopCodon || '').toUpperCase()
    });
  };

  forwardHits.forEach((hit) => pushOrf(hit, 1));
  reverseHits.forEach((hit) => pushOrf(hit, -1));

  return orfs.sort((left, right) => {
    const leftStart = left.segments?.[0]?.start ?? 0;
    const rightStart = right.segments?.[0]?.start ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return Math.max(0, Number(right.orfLengthNt) || 0) - Math.max(0, Number(left.orfLengthNt) || 0);
  });
}

function buildProteinAnnotationGroups(db, querySequence, excludeEntryId = '') {
  const rows = readRows(
    db,
    `SELECT f.id, f.name, f.feature_type,
            cds.dna_sequence, cds.dna_length, cds.amino_acid_sequence, cds.amino_acid_length,
            o.host_vector_id, o.host_vector_name, o.host_vector_status
     FROM sequence_feature_cds_sequences cds
     JOIN sequence_features f ON f.id = cds.feature_id
     JOIN sequence_feature_occurrences o ON o.feature_id = f.id
     WHERE cds.amino_acid_length >= ?
       AND cds.amino_acid_length <= ?
       AND lower(COALESCE(o.annotation_source, '')) NOT LIKE 'sql_annotation_%'
       AND (? = '' OR o.host_vector_id <> ?)
     ORDER BY cds.amino_acid_length DESC, f.updated_at DESC, f.name COLLATE NOCASE ASC`,
    [
      MIN_PROTEIN_ANNOTATION_AA_LENGTH,
      Math.max(0, Math.floor((normalizeSequenceText(querySequence).length || 0) / 3)),
      cleanText(excludeEntryId, 200),
      cleanText(excludeEntryId, 200)
    ]
  );

  const groupsByProtein = new Map();
  rows.forEach((row) => {
    const proteinSequence = normalizeProteinSequence(row?.amino_acid_sequence);
    if (!proteinSequence || shouldSkipAnnotationFeatureName(row?.name)) {
      return;
    }

    const groupKey = `${normalizeName(row?.name || 'cds', 'cds')}\n${cleanText(row?.feature_type, 120).toLowerCase() || 'cds'}`;
    let grouped = groupsByProtein.get(proteinSequence);
    if (!grouped) {
      grouped = new Map();
      groupsByProtein.set(proteinSequence, grouped);
    }

    let group = grouped.get(groupKey);
    if (!group) {
      group = {
        name: normalizeName(row?.name || 'cds', 'cds'),
        type: cleanText(row?.feature_type, 120).toLowerCase() || 'cds',
        proteinSequence,
        dnaSequence: normalizeSequenceText(row?.dna_sequence),
        hosts: new Map()
      };
      grouped.set(groupKey, group);
    }

    appendHostToMap(group.hosts, row);
  });

  return groupsByProtein;
}

function buildDnaAnnotationMatches(db, querySequence, topology = 'linear', excludeEntryId = '') {
  const normalizedQuery = normalizeSequenceText(querySequence);
  if (!normalizedQuery.length) {
    return [];
  }

  const candidates = buildDnaAnnotationCandidates(db, normalizedQuery.length, excludeEntryId);
  if (!candidates.length) {
    return [];
  }

  const sequenceMatchCache = new Map();
  const matches = [];
  for (const candidate of candidates) {
    if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
      break;
    }

    const candidateSequence = normalizeSequenceText(candidate.matchedSequence);
    if (!candidateSequence.length) {
      continue;
    }

    let cached = sequenceMatchCache.get(candidateSequence);
    if (!cached) {
      const reverseSequence = reverseComplementIupac(candidateSequence);
      cached = {
        forwardStarts: findPatternMatchStarts(normalizedQuery, candidateSequence, topology),
        reverseSequence,
        reverseStarts: reverseSequence !== candidateSequence
          ? findPatternMatchStarts(normalizedQuery, reverseSequence, topology)
          : []
      };
      sequenceMatchCache.set(candidateSequence, cached);
    }

    cached.forwardStarts.forEach((start) => {
      if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
        return;
      }
      matches.push({
        featureId: candidate.featureId,
        name: candidate.name,
        type: candidate.type,
        strand: 1,
        matchedSequence: candidateSequence,
        sequenceLength: candidate.sequenceLength,
        hosts: candidate.hosts,
        segments: buildSegmentsFromStartAndLength(start, candidateSequence.length, normalizedQuery.length, topology)
      });
    });

    cached.reverseStarts.forEach((start) => {
      if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
        return;
      }
      matches.push({
        featureId: candidate.featureId,
        name: candidate.name,
        type: candidate.type,
        strand: -1,
        matchedSequence: candidateSequence,
        sequenceLength: candidate.sequenceLength,
        hosts: candidate.hosts,
        segments: buildSegmentsFromStartAndLength(start, candidateSequence.length, normalizedQuery.length, topology)
      });
    });
  }

  return matches
    .filter((match) => Array.isArray(match.segments) && match.segments.length)
    .sort((left, right) => {
      const leftStart = left.segments?.[0]?.start ?? 0;
      const rightStart = right.segments?.[0]?.start ?? 0;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      return Math.max(0, Number(right.sequenceLength) || 0) - Math.max(0, Number(left.sequenceLength) || 0);
    });
}

function buildProteinAnnotationMatches(db, querySequence, topology = 'linear', excludeEntryId = '') {
  const normalizedQuery = normalizeSequenceText(querySequence);
  if (!normalizedQuery.length) {
    return [];
  }

  const groupsByProtein = buildProteinAnnotationGroups(db, normalizedQuery, excludeEntryId);
  const proteinLengths = [...groupsByProtein.keys()].map((proteinSequence) => proteinSequence.length).filter(Boolean);
  if (!proteinLengths.length) {
    return [];
  }

  const minDetectedAaLength = Math.max(
    MIN_PROTEIN_ANNOTATION_AA_LENGTH,
    Math.min(...proteinLengths)
  );
  const orfs = buildProteinAnnotationOrfs(normalizedQuery, topology, minDetectedAaLength);
  if (!orfs.length) {
    return [];
  }

  const matches = [];
  for (const orf of orfs) {
    if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
      break;
    }

    const groupedCandidates = groupsByProtein.get(normalizeProteinSequence(orf.proteinSequence));
    if (!groupedCandidates || !groupedCandidates.size) {
      continue;
    }

    groupedCandidates.forEach((group) => {
      if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
        return;
      }
      matches.push({
        name: group.name,
        type: group.type,
        strand: orf.strand,
        segments: orf.segments,
        translation: orf.translation,
        matchedSequence: orf.dnaSequence,
        proteinSequence: orf.proteinSequence,
        hosts: [...group.hosts.values()],
        orfFrame: orf.orfFrame,
        orfLengthNt: orf.orfLengthNt,
        orfLengthAa: orf.orfLengthAa,
        startCodon: orf.startCodon,
        stopCodon: orf.stopCodon
      });
    });
  }

  return matches.sort((left, right) => {
    const leftStart = left.segments?.[0]?.start ?? 0;
    const rightStart = right.segments?.[0]?.start ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return Math.max(0, Number(right.orfLengthNt) || 0) - Math.max(0, Number(left.orfLengthNt) || 0);
  });
}

async function annotateSequenceRecord({ storagePath, sequence = '', topology = 'linear', excludeEntryId = '' }) {
  const normalizedQuery = normalizeSequenceText(sequence);
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);
  const db = await openDatabase(paths.sqlitePath);
  try {
    if (!normalizedQuery.length) {
      return {
        queryLength: 0,
        topology: normalizeTopologyValue(topology),
        dnaMatches: [],
        proteinMatches: [],
        totalMatches: 0
      };
    }

    const normalizedTopology = normalizeTopologyValue(topology);
    const dnaMatches = buildDnaAnnotationMatches(db, normalizedQuery, normalizedTopology, excludeEntryId);
    const proteinMatches = buildProteinAnnotationMatches(db, normalizedQuery, normalizedTopology, excludeEntryId);
    return {
      queryLength: normalizedQuery.length,
      topology: normalizedTopology,
      dnaMatches,
      proteinMatches,
      totalMatches: dnaMatches.length + proteinMatches.length
    };
  } finally {
    db.close();
  }
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

async function listRecognizedBackbones({ storagePath, query = '', limit = 50 }) {
  const safeQuery = cleanText(query, 600).toLowerCase();
  const safeLimit = clamp(Math.round(Number(limit) || 50), 1, 200);
  const paths = resolveLibraryPaths(storagePath);
  await ensureLibraryDirectories(paths);

  const artifactsRoot = path.join(paths.libraryRoot, RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME);
  let entries = [];
  try {
    entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
  } catch (error) {
    if (String(error?.code || '') === 'ENOENT') {
      return { query: cleanText(query, 600), results: [] };
    }
    throw error;
  }

  const results = [];
  await Promise.all(entries.map(async (entry) => {
    if (!entry?.isFile?.() || !String(entry.name || '').toLowerCase().endsWith('.json')) {
      return;
    }

    const filePath = path.join(artifactsRoot, entry.name);
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      return;
    }
    if (!parsed || String(parsed?.schema_name || '') !== RECOGNIZED_BACKBONE_SCHEMA_NAME) {
      return;
    }

    const hostVectorName = cleanText(parsed?.recognition?.host_vector_name, 160);
    const sourceRecordName = cleanText(parsed?.source_record?.name, 160);
    const backboneName = cleanText(parsed?.backbone?.name, 160);
    const promoterName = cleanText(parsed?.recognition?.promoter_name, 160);
    const searchableText = [
      hostVectorName,
      sourceRecordName,
      backboneName,
      promoterName,
      cleanText(parsed?.recognition?.variant_mode, 40)
    ].join(' ').toLowerCase();

    if (safeQuery && !searchableText.includes(safeQuery)) {
      return;
    }

    const backboneSequence = normalizeSequenceText(parsed?.backbone?.sequence || '');
    const insertSequence = normalizeSequenceText(parsed?.insert?.sequence || '');
    const backboneSegments = normalizeRecognitionSegmentList(parsed?.backbone?.segments);
    const insertSegments = normalizeRecognitionSegmentList(parsed?.insert?.segments);
    const updatedAt = cleanText(parsed?.updated_at, 120);
    results.push({
      id: toPosixRelative(paths.storageRoot, filePath),
      fileName: entry.name,
      relativePath: toPosixRelative(paths.storageRoot, filePath),
      updatedAt,
      sourceRecordName,
      sourceEntryId: cleanText(parsed?.source_record?.entry_id, 200),
      sourceEntryStatus: normalizeStatus(parsed?.source_record?.entry_status),
      hostVectorName,
      promoterName,
      variantMode: cleanText(parsed?.recognition?.variant_mode, 40).toLowerCase() === 'restriction'
        ? 'restriction'
        : 'gibson',
      backboneName: backboneName || hostVectorName || sourceRecordName || 'Stored backbone',
      backboneSequence,
      backboneSegments,
      backboneLength: Math.max(0, Number(parsed?.backbone?.sequence_length) || backboneSequence.length),
      insertName: cleanText(parsed?.insert?.name, 160) || 'Stored insert',
      insertSequence,
      insertSegments,
      insertLength: Math.max(0, Number(parsed?.insert?.sequence_length) || insertSequence.length),
      insertionOffset: computeRecognizedBackboneInsertionOffset(backboneSegments, insertSegments)
    });
  }));

  results.sort((left, right) => {
    const leftTime = Date.parse(String(left?.updatedAt || '')) || 0;
    const rightTime = Date.parse(String(right?.updatedAt || '')) || 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return cleanText(left?.backboneName, 160).localeCompare(cleanText(right?.backboneName, 160));
  });

  return {
    query: cleanText(query, 600),
    results: results.slice(0, safeLimit)
  };
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
  annotateSequenceRecord,
  searchSequenceFeatures,
  listRecognizedBackbones,
  recognizeSequenceBackbone,
  sanitizeFileName
};
