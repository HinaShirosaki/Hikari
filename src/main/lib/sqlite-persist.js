'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// A temporary older than this cannot belong to a save still in flight, so it is
// wreckage from a crash and safe to remove. Concurrent saves of the same
// database are minutes-fresh and never swept.
// ponytail: age alone, so wreckage survives until some save runs an hour later.
// Check whether the pid in the name is still alive (as operation-lock.js does)
// if that delay ever matters.
const STALE_TEMPORARY_AGE_MS = 60 * 60 * 1000;

function temporaryPrefix(sqlitePath) {
  return `${path.basename(sqlitePath)}.`;
}

// A rename cannot be interrupted, but a SIGKILL between the write and the
// rename leaves the temporary behind, and these are full database images sitting
// in the folder the user browses. Nothing else ever cleans them up.
async function removeStaleTemporaries(sqlitePath) {
  const folderPath = path.dirname(sqlitePath);
  const prefix = temporaryPrefix(sqlitePath);
  let names;
  try {
    names = await fs.readdir(folderPath);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_TEMPORARY_AGE_MS;
  await Promise.all(names
    .filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'))
    .map(async (name) => {
      const candidate = path.join(folderPath, name);
      try {
        const stat = await fs.stat(candidate);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(candidate, { force: true });
        }
      } catch {
        // Raced with another sweep or with the writer that owns it. Leave it.
      }
    }));
}

// sql.js hands back the whole database image on every save, so a plain
// writeFile truncates the live file before the new bytes land: a crash in that
// window loses the entire database rather than one record. Write beside the
// target and rename it into place, which is atomic on the same volume.
//
// The temporary name carries pid + random bytes because the storage bundles are
// written without a lock, so two saves of the same path can overlap.
async function persistSqliteDatabase(sqlitePath, db) {
  const bytes = db.export();
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  const temporaryPath = `${sqlitePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryPath, Buffer.from(bytes));
    await fs.rename(temporaryPath, sqlitePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  await removeStaleTemporaries(sqlitePath);
}

module.exports = { persistSqliteDatabase, removeStaleTemporaries };
