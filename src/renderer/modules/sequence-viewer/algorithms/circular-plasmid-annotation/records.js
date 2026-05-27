'use strict';

const os = require('os');
const { DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS } = require('./constants');
const {
  clampInteger,
  cleanText,
  normalizeDnaSequence,
  normalizeTopology
} = require('./dna-utils');

function prepareDatabaseRecords(databaseRecords, options) {
  const records = Array.isArray(databaseRecords) ? databaseRecords : [];
  return records
    .map((record, index) => {
      const sequence = normalizeDnaSequence(
        record?.sequence || record?.seq || record?.dna || record?.bases || ''
      );
      return {
        recordIndex: index,
        recordId: cleanText(record?.id || record?.accession || `record_${index + 1}`, 120),
        recordName: cleanText(
          record?.name || record?.label || record?.feature || record?.accession || `record_${index + 1}`,
          240
        ),
        featureType: cleanText(record?.type || record?.featureType || '', 80),
        source: cleanText(record?.source || record?.db || '', 80),
        topology: normalizeTopology(record?.topology),
        sequence
      };
    })
    .filter((record) => record.sequence.length >= options.minRecordLength);
}

function getAvailableParallelism() {
  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, os.availableParallelism());
  }
  const cpus = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  return Math.max(1, cpus || 1);
}

function resolveRuntimeOptions(options = {}) {
  const merged = {
    ...DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS,
    ...(options && typeof options === 'object' ? options : {})
  };
  const availableParallelism = getAvailableParallelism();
  return {
    minRecordLength: clampInteger(merged.minRecordLength, 1, 1_000_000, 12),
    allowReverseComplement: merged.allowReverseComplement !== false,
    maxHitsPerRecord: clampInteger(merged.maxHitsPerRecord, 1, 10_000, 8),
    maxWorkers: clampInteger(merged.maxWorkers || availableParallelism, 1, availableParallelism, availableParallelism),
    workerThreshold: clampInteger(merged.workerThreshold, 1, 1_000_000, 256),
    recordsPerWorker: clampInteger(merged.recordsPerWorker, 1, 1_000_000, 256),
    maxMismatchCount: clampInteger(merged.maxMismatchCount, 0, 1_000_000, 0),
    maxMismatchRate: Number.isFinite(Number(merged.maxMismatchRate)) ? Math.max(0, Number(merged.maxMismatchRate)) : 0,
    minSeedLength: clampInteger(merged.minSeedLength, 1, 10_000, 12),
    approximateCandidateCap: clampInteger(merged.approximateCandidateCap, 8, 1_000_000, 4096),
    bruteForceCompatibilityLimit: clampInteger(merged.bruteForceCompatibilityLimit, 1_000, 1_000_000_000, 2_000_000),
    sortResults: merged.sortResults !== false
  };
}

function splitIntoChunks(records, chunkCount) {
  const items = Array.isArray(records) ? records : [];
  const desiredChunks = Math.max(1, Math.min(items.length || 1, chunkCount || 1));
  const chunkSize = Math.ceil(items.length / desiredChunks);
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function sortMatches(matches) {
  return [...matches].sort((left, right) => {
    if (left.recordIndex !== right.recordIndex) {
      return left.recordIndex - right.recordIndex;
    }
    if (left.mismatches !== right.mismatches) {
      return left.mismatches - right.mismatches;
    }
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return right.strand - left.strand;
  });
}

function buildEmptyAnnotationResult(queryLength, options, databaseSize = 0) {
  return {
    queryTopology: 'circular',
    queryLength,
    databaseSize,
    matches: [],
    stats: {
      workerCount: 1,
      scannedRecords: 0,
      skippedRecords: 0,
      exactMatches: 0,
      approximateMatches: 0,
      elapsedMs: 0,
      maxHitsPerRecord: options.maxHitsPerRecord
    }
  };
}

function finalizeAnnotationResult(matches, chunkResults, queryLength, databaseSize, workerCount, startedAt, options) {
  const total = (key) => chunkResults.reduce((sum, chunk) => sum + (chunk?.stats?.[key] || 0), 0);
  return {
    queryTopology: 'circular',
    queryLength,
    databaseSize,
    matches: options.sortResults ? sortMatches(matches) : matches,
    stats: {
      workerCount,
      scannedRecords: total('scannedRecords'),
      skippedRecords: total('skippedRecords'),
      exactMatches: total('exactMatches'),
      approximateMatches: total('approximateMatches'),
      elapsedMs: Date.now() - startedAt,
      maxHitsPerRecord: options.maxHitsPerRecord
    }
  };
}

module.exports = {
  buildEmptyAnnotationResult,
  finalizeAnnotationResult,
  prepareDatabaseRecords,
  resolveRuntimeOptions,
  splitIntoChunks
};
