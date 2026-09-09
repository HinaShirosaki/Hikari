'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { resolveLibraryPaths } = require('./paths');
const held = new AsyncLocalStorage();
// sql.js loads a complete database image. Serialize readers that reconcile records
// as well as writers, including MCP server processes outside the Electron process.
async function withLibraryLock(storagePath, action) {
  if (!String(storagePath || '').trim()) throw new Error('Missing sequence storage path.');
  const root = resolveLibraryPaths(storagePath).libraryRoot;
  if (held.getStore() === root) return action();
  await fs.mkdir(root, { recursive: true });
  let lockPath = path.join(root, '.operation-lock');
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(path.join(lockPath, 'owner'), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(path.join(lockPath, 'owner'), 'utf8').catch(() => ''));
      let stale = false;
      if (pid) { try { process.kill(pid, 0); } catch (e) { stale = e.code === 'ESRCH'; } }
      const stat = await fs.stat(lockPath).catch(() => null);
      if (!pid) stale = stat && Date.now() - stat.mtimeMs > 30000;
      if (stale && stat) {
        // All recoverers advance to the same generation. Deleting a dead lock
        // here races with another recoverer acquiring that path and can admit
        // two SQL.js writers. Abandoned generations stay outside entry storage.
        const generation = createHash('sha256').update(`${lockPath}:${stat.ino}:${stat.birthtimeMs}`).digest('hex').slice(0, 24);
        lockPath = path.join(root, `.operation-lock-${generation}`);
        continue;
      }
      if (Date.now() >= deadline) throw Object.assign(new Error('Sequence library is busy. Retry this request.'), { code: 'library_busy' });
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  try { return await held.run(root, action); }
  finally { await fs.rm(lockPath, { recursive: true, force: true }); }
}
module.exports = { withLibraryLock };
