'use strict';

const crypto = require('crypto');
const path = require('path');
const {
  RECOGNIZED_BACKBONE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_STORE_FILE_NAME,
  RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION
} = require('./constants');
const { toPosixRelative } = require('./paths');
const {
  clamp,
  cleanText,
  normalizeSequenceText,
  normalizeStatus
} = require('./utils');

function normalizeBackboneSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function computeRecognizedBackboneInsertionOffset(segments, sequenceLength) {
  const normalized = normalizeBackboneSegments(segments, sequenceLength);
  if (!normalized.length) {
    return null;
  }
  if (normalized.length === 1) {
    const wrapGap = Math.max(0, sequenceLength - normalized[0].end) + normalized[0].start;
    return wrapGap > 0 ? normalized[0].end - normalized[0].start : null;
  }

  let cursor = 0;
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    cursor += current.end - current.start;
    const gapLength = next.start >= current.end
      ? next.start - current.end
      : Math.max(0, sequenceLength - current.end) + next.start;
    if (gapLength > 0) {
      return cursor;
    }
  }

  const last = normalized[normalized.length - 1];
  const first = normalized[0];
  const wrapGap = Math.max(0, sequenceLength - last.end) + first.start;
  return wrapGap > 0
    ? normalized.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0)
    : null;
}

function getRecognizedBackboneStorePath(paths) {
  return path.join(paths.libraryRoot, RECOGNIZED_BACKBONE_STORE_FILE_NAME);
}

function cloneJsonValue(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildRecognizedBackboneStoreId(backbone = {}) {
  const basis = JSON.stringify({
    sourceEntryId: cleanText(backbone?.source_record?.entry_id, 200),
    sourceName: cleanText(backbone?.source_record?.name, 200),
    sourceSignature: cleanText(backbone?.source_record?.sequence_signature, 200),
    hostVectorId: cleanText(backbone?.recognition?.host_vector_id, 200),
    hostVectorName: cleanText(backbone?.recognition?.host_vector_name, 200),
    candidateId: cleanText(backbone?.recognition?.candidate_id, 200),
    variantMode: cleanText(backbone?.recognition?.variant_mode, 80),
    backboneSequence: normalizeSequenceText(backbone?.backbone?.sequence || ''),
    insertSequence: normalizeSequenceText(backbone?.insert?.sequence || '')
  });
  const hash = crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
  return `recognized_backbone_${hash}`;
}

function normalizeRecognizedBackboneForStore(backbone = {}) {
  const normalized = cloneJsonValue(backbone);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('Missing recognized backbone payload.');
  }
  if (String(normalized?.schema_name || '') !== RECOGNIZED_BACKBONE_SCHEMA_NAME) {
    throw new Error('Recognized backbone payload has an unsupported schema.');
  }

  const nowIso = new Date().toISOString();
  normalized.id = cleanText(normalized?.id, 200) || buildRecognizedBackboneStoreId(normalized);
  normalized.schema_name = RECOGNIZED_BACKBONE_SCHEMA_NAME;
  normalized.schema_version = cleanText(normalized?.schema_version, 40) || '1.0.0';
  normalized.created_at = cleanText(normalized?.created_at, 120) || cleanText(normalized?.updated_at, 120) || nowIso;
  normalized.updated_at = cleanText(normalized?.updated_at, 120) || nowIso;
  return normalized;
}

function emptyRecognizedBackboneStore() {
  return {
    schema_name: RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
    schema_version: RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION,
    updated_at: '',
    backbones: []
  };
}

function buildRecognizedBackboneListItem(parsed, paths, sourcePath = '') {
  if (!parsed || String(parsed?.schema_name || '') !== RECOGNIZED_BACKBONE_SCHEMA_NAME) {
    return null;
  }

  const hostVectorName = cleanText(parsed?.recognition?.host_vector_name, 160);
  const sourceRecordName = cleanText(parsed?.source_record?.name, 160);
  const backboneName = cleanText(parsed?.backbone?.name, 160);
  const promoterName = cleanText(parsed?.recognition?.promoter_name, 160);
  const backboneSequence = normalizeSequenceText(parsed?.backbone?.sequence || '');
  const insertSequence = normalizeSequenceText(parsed?.insert?.sequence || '');
  const backboneLength = Math.max(0, Number(parsed?.backbone?.sequence_length) || backboneSequence.length);
  const insertLength = Math.max(0, Number(parsed?.insert?.sequence_length) || insertSequence.length);
  const originalSequenceLength = Math.max(backboneLength + insertLength, backboneSequence.length);
  const fallbackPath = sourcePath || getRecognizedBackboneStorePath(paths);

  return {
    id: cleanText(parsed?.id, 200) || toPosixRelative(paths.storageRoot, fallbackPath),
    sourceKind: 'recognized_backbone',
    fileName: path.basename(fallbackPath),
    relativePath: toPosixRelative(paths.storageRoot, fallbackPath),
    updatedAt: cleanText(parsed?.updated_at, 120),
    sourceRecordName,
    sourceEntryId: cleanText(parsed?.source_record?.entry_id, 200),
    sourceEntryStatus: normalizeStatus(parsed?.source_record?.entry_status),
    topology: cleanText(parsed?.source_record?.topology, 40) || 'linear',
    hostVectorName,
    promoterName,
    variantMode: cleanText(parsed?.recognition?.variant_mode, 40).toLowerCase() === 'restriction' ? 'restriction' : 'gibson',
    backboneName: backboneName || hostVectorName || sourceRecordName || 'Stored backbone',
    backboneSequence,
    backboneLength,
    backboneSegments: normalizeBackboneSegments(parsed?.backbone?.segments, originalSequenceLength),
    insertName: cleanText(parsed?.insert?.name, 160) || 'Stored insert',
    insertSequence,
    insertLength,
    insertSegments: normalizeBackboneSegments(parsed?.insert?.segments, originalSequenceLength),
    insertionOffset: computeRecognizedBackboneInsertionOffset(parsed?.backbone?.segments, originalSequenceLength)
  };
}

module.exports = {
  buildRecognizedBackboneListItem,
  emptyRecognizedBackboneStore,
  getRecognizedBackboneStorePath,
  normalizeRecognizedBackboneForStore
};
