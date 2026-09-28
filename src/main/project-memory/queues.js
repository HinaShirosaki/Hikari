'use strict';

const path = require('node:path');

const projectMemoryQueues = new Map();
const projectGenerationQueues = new Map();
const latestProjectMemoryInputs = new Map();

// The returned promise rejects on failure; the queued one never does, or one bad
// job would take the rest of the chain down with it.
function enqueueSerialWork(queues, projectKey, work) {
  const previous = queues.get(projectKey) || Promise.resolve();
  const result = previous.then(work);
  const tracked = result.catch(() => {}).finally(() => {
    if (queues.get(projectKey) === tracked) {
      queues.delete(projectKey);
    }
  });
  queues.set(projectKey, tracked);
  return result;
}

// Two queues, because they have very different durations. Anything that
// read-modify-writes MEMORY.md or the conclusion cache goes here: short file
// work only, so a sync is never held up for long.
function enqueueProjectMemoryWork(projectKey, work) {
  return enqueueSerialWork(projectMemoryQueues, projectKey, work);
}

// Model calls go here instead. They still run one batch at a time per project,
// but a save only ever waits on the commit above, never on a generation. Only
// this direction is allowed: a generation may await the file queue, never the
// reverse, so the two can not deadlock.
function enqueueProjectGenerationWork(projectKey, work) {
  return enqueueSerialWork(projectGenerationQueues, projectKey, work);
}

async function waitForProjectMemoryQueue(projectKeyOrFolderPath) {
  const projectKey = path.resolve(String(projectKeyOrFolderPath || ''));
  // Generations first: a batch ends by queueing a render, so draining the file
  // queue alone can return before that render has even been queued.
  while (projectGenerationQueues.has(projectKey) || projectMemoryQueues.has(projectKey)) {
    await projectGenerationQueues.get(projectKey);
    await projectMemoryQueues.get(projectKey);
  }
}

module.exports = {
  enqueueProjectGenerationWork,
  enqueueProjectMemoryWork,
  latestProjectMemoryInputs,
  waitForProjectMemoryQueue
};
