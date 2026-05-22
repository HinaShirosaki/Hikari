'use strict';

const { WORKER_MODE } = require('./constants');
const { resolveRuntimeOptions } = require('./records');
const { scanDatabaseChunk } = require('./scanner');

let workerThreads = null;
try {
  workerThreads = require('worker_threads');
} catch {
  workerThreads = null;
}

if (
  workerThreads
  && workerThreads.isMainThread === false
  && workerThreads.workerData?.mode === WORKER_MODE
) {
  try {
    const result = scanDatabaseChunk(
      workerThreads.workerData.querySequence,
      workerThreads.workerData.records,
      resolveRuntimeOptions(workerThreads.workerData.options)
    );
    workerThreads.parentPort.postMessage({ ok: true, result });
  } catch (error) {
    workerThreads.parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error || 'Unknown worker error.')
    });
  }
}
