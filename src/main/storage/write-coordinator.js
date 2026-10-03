'use strict';

const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { withFileLock } = require('../lib/shared-json-file');

const heldRoots = new AsyncLocalStorage();

// A snapshot save writes and prunes several folders. Individual atomic renames
// cannot stop an older snapshot from deleting records saved by a newer one.
function withStorageRootWrite(storagePath, work) {
  if (!String(storagePath || '').trim()) return work();
  const resolved = path.resolve(storagePath);
  const root = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const inherited = heldRoots.getStore();
  if (inherited?.get(root)?.active) return work();
  return withFileLock(`storage-root:${root}`, async () => {
    const token = { active: true };
    const held = new Map(inherited);
    held.set(root, token);
    try {
      return await heldRoots.run(held, work);
    } finally {
      // Detached background work must not inherit permission to skip the queue
      // after the save that owned this critical section has completed.
      token.active = false;
    }
  });
}

module.exports = { withStorageRootWrite };
