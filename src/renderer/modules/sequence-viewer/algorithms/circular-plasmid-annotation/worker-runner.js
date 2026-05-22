'use strict';

const path = require('path');
const { scanDatabaseChunk } = require('./scanner');
const { WORKER_MODE } = require('./constants');

let workerThreads = null;
try {
  workerThreads = require('worker_threads');
} catch {
  workerThreads = null;
}

function canUseWorkerThreads() {
  return Boolean(workerThreads?.Worker);
}

async function runWorkerChunk(querySequence, records, options) {
  if (!canUseWorkerThreads()) {
    return scanDatabaseChunk(querySequence, records, options);
  }

  return new Promise((resolve, reject) => {
    const worker = new workerThreads.Worker(path.join(__dirname, 'worker.js'), {
      workerData: {
        mode: WORKER_MODE,
        querySequence,
        records,
        options
      }
    });

    worker.once('message', (message) => {
      if (message?.ok) {
        resolve(message.result);
        return;
      }
      reject(new Error(message?.error || 'Circular plasmid annotation worker failed.'));
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Circular plasmid annotation worker exited with code ${code}.`));
      }
    });
  });
}

module.exports = {
  canUseWorkerThreads,
  runWorkerChunk
};
