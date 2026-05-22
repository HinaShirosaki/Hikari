'use strict';

const path = require('path');
const { coerceBinaryBuffer, cleanText, normalizeName, sanitizeFileName, stripExtension, buildSequenceSignature, normalizeSequenceText } = require('./utils');

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
    .map((channel) => normalizeTraceChannel(channel))
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

function normalizeTraceChannel(channel) {
  const base = cleanText(channel?.base, 1).toUpperCase();
  if (!base || !['A', 'C', 'G', 'T'].includes(base)) {
    return null;
  }
  const values = (Array.isArray(channel?.values) ? channel.values : [])
    .map((value) => Math.max(0, Math.round(Number(value) || 0)))
    .slice(0, 50000);
  return values.length ? { base, values } : null;
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
    referenceSpan: normalizeReferenceSpan(safeResult.referenceSpan),
    alignedReference: String(safeResult.alignedReference || '').slice(0, 600000),
    alignedMarkers: String(safeResult.alignedMarkers || '').slice(0, 600000),
    alignedQuery: String(safeResult.alignedQuery || '').slice(0, 600000),
    differences: (Array.isArray(safeResult.differences) ? safeResult.differences : [])
      .map((difference, index) => normalizeAlignmentDifferencePayload(difference, index))
  };
}

function normalizeReferenceSpan(span) {
  return {
    start: Math.max(0, Math.round(Number(span?.start) || 0)),
    end: Math.max(0, Math.round(Number(span?.end) || 0)),
    wraps: span?.wraps === true
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

  const now = new Date().toISOString();
  const sourceText = typeof safeSession.rawText === 'string'
    ? safeSession.rawText
    : (typeof safeSession.sourceText === 'string' ? safeSession.sourceText : '');
  const sourceBytes = coerceBinaryBuffer(safeSession.rawBinary ?? safeSession.sourceBytes ?? safeSession.sourceBuffer ?? safeSession.sourceArrayBuffer);
  const baseName = sanitizeFileName(stripExtension(safeSession.originalFileName || safeSession.name || queryRecord.name) || 'alignment_query', 'alignment_query');
  const id = cleanText(safeSession.id, 200)
    || cleanText(existingSession?.id, 200)
    || `align_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  return {
    id,
    name: normalizeName(safeSession.name || queryRecord.name || `alignment_${index + 1}`, `alignment_${index + 1}`),
    referenceRecordKey: cleanText(safeSession.referenceRecordKey || safeSession.referenceKey || existingSession?.referenceRecordKey || buildSequenceSignature(safeSession.referenceRecord?.sequence || '', 'ref'), 200),
    referenceRecordName: normalizeName(safeSession.referenceRecordName || safeSession.referenceRecord?.name || existingSession?.referenceRecordName || 'reference', 'reference'),
    sourceKind: normalizeAlignmentSourceKind(safeSession.sourceKind),
    sourceFormat: cleanText(safeSession.sourceFormat || queryRecord.sourceFormat, 80).toLowerCase() || 'raw',
    originalFileName: cleanText(safeSession.originalFileName, 240),
    storedSourceRelPath: cleanText(safeSession.storedSourceRelPath || existingSession?.storedSourceRelPath, 1200),
    queryRecord,
    result: normalizeAlignmentResultPayload(safeSession.result),
    createdAt: normalizeAlignmentTimestamp(safeSession.createdAt, existingSession?.createdAt || now),
    updatedAt: normalizeAlignmentTimestamp(safeSession.updatedAt, now),
    _sourceText: sourceText,
    _sourceBytes: sourceBytes,
    _sourceBaseName: baseName,
    _sourceExtension: resolveAlignmentSourceFileExtension({ ...safeSession, queryRecord })
  };
}

module.exports = {
  normalizeAlignmentQueryRecord,
  normalizeAlignmentResultPayload,
  normalizeAlignmentSessionPayload,
  normalizeAlignmentSourceKind,
  normalizeAlignmentTimestamp
};
