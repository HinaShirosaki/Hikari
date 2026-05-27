'use strict';

const { DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS } = require('./constants');
const { normalizeDnaSequence, reverseComplementDna } = require('./dna-utils');
const {
  buildEmptyAnnotationResult,
  finalizeAnnotationResult,
  prepareDatabaseRecords,
  resolveRuntimeOptions,
  splitIntoChunks
} = require('./records');
const { scanDatabaseChunk } = require('./scanner');
const { canUseWorkerThreads, runWorkerChunk } = require('./worker-runner');

async function annotateCircularPlasmidSequence(querySequence, databaseRecords, options = {}) {
  const runtimeOptions = resolveRuntimeOptions(options);
  const query = normalizeDnaSequence(querySequence);
  if (!query.length) {
    return buildEmptyAnnotationResult(0, runtimeOptions, 0);
  }

  const preparedRecords = prepareDatabaseRecords(databaseRecords, runtimeOptions);
  if (!preparedRecords.length) {
    return buildEmptyAnnotationResult(query.length, runtimeOptions, 0);
  }

  const startedAt = Date.now();
  const canUseWorkers = canUseWorkerThreads()
    && preparedRecords.length >= runtimeOptions.workerThreshold
    && runtimeOptions.maxWorkers > 1;

  if (!canUseWorkers) {
    const result = scanDatabaseChunk(query, preparedRecords, runtimeOptions);
    return finalizeAnnotationResult(
      result.matches,
      [result],
      query.length,
      preparedRecords.length,
      1,
      startedAt,
      runtimeOptions
    );
  }

  const desiredWorkers = Math.min(
    runtimeOptions.maxWorkers,
    Math.max(1, Math.ceil(preparedRecords.length / runtimeOptions.recordsPerWorker))
  );
  const chunks = splitIntoChunks(preparedRecords, desiredWorkers);
  const chunkResults = await Promise.all(
    chunks.map((chunk) => runWorkerChunk(query, chunk, runtimeOptions))
  );

  return finalizeAnnotationResult(
    chunkResults.flatMap((chunk) => chunk.matches || []),
    chunkResults,
    query.length,
    preparedRecords.length,
    chunks.length,
    startedAt,
    runtimeOptions
  );
}

function annotateCircularPlasmidSequenceSync(querySequence, databaseRecords, options = {}) {
  const runtimeOptions = resolveRuntimeOptions({ ...options, maxWorkers: 1 });
  const query = normalizeDnaSequence(querySequence);
  if (!query.length) {
    return buildEmptyAnnotationResult(0, runtimeOptions, 0);
  }

  const preparedRecords = prepareDatabaseRecords(databaseRecords, runtimeOptions);
  if (!preparedRecords.length) {
    return buildEmptyAnnotationResult(query.length, runtimeOptions, 0);
  }

  const startedAt = Date.now();
  const result = scanDatabaseChunk(query, preparedRecords, runtimeOptions);
  return finalizeAnnotationResult(
    result.matches,
    [result],
    query.length,
    preparedRecords.length,
    1,
    startedAt,
    runtimeOptions
  );
}

module.exports = {
  DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS,
  annotateCircularPlasmidSequence,
  annotateCircularPlasmidSequenceSync,
  normalizeDnaSequence,
  reverseComplementDna
};
