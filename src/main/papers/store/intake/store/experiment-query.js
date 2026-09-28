'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const QUERY_TIMEOUT_MS = 3000;
let activeQueries = 0;

// Running synchronous WASM in a worker lets the deadline interrupt recursive
// CTEs and expensive joins without blocking the app or the MCP server.
async function runExperimentSql({ bytes, sql, parameters = [], limit = 50, timeoutMs = QUERY_TIMEOUT_MS }) {
  if (activeQueries >= 2) return { ok: false, status: 'query_busy', error: 'Two experiment queries are already running; retry after they finish.' };
  activeQueries += 1;
  try {
    return await new Promise((resolve) => {
      const worker = new Worker(path.join(__dirname, 'experiment-query-worker.js'), {
        workerData: { bytes, sql, parameters, limit },
        transferList: [bytes.buffer],
        resourceLimits: { maxOldGenerationSizeMb: 64 }
      });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().then(() => resolve(result), () => resolve(result));
      };
      const timer = setTimeout(() => finish({ ok: false, status: 'query_timeout',
        error: 'Experiment SQL exceeded its time limit; narrow the query.' }), timeoutMs);
      worker.once('message', finish);
      worker.once('error', (error) => finish({ ok: false, status: 'query_failed', error: String(error.message).slice(0, 1000) }));
      worker.once('exit', (code) => finish({ ok: false, status: 'query_failed', error: `Experiment SQL worker exited before returning a result (code ${code}).` }));
    });
  } finally { activeQueries -= 1; }
}

module.exports = { runExperimentSql, QUERY_TIMEOUT_MS };
