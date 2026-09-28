'use strict';

const fs = require('fs/promises');
const path = require('path');
const { readSqliteBundleIndex } = require('./storage-sql-read');

// The chemicals index is the only copy of the lab chemical inventory. The bundle
// reader degrades an unreadable index to "empty", which suits a derived index but
// here would let the next save overwrite the damaged file with an empty one. So
// an unreadable chemicals index is moved aside, and the save starts a new file;
// if it cannot be moved, nothing may write over it for the rest of the session.
const UNREADABLE_CODE = 'CHEMICAL_INDEX_UNREADABLE';
const blockedPaths = new Set();
const pendingAlerts = new Map();

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function readChemicalIndex(sqlitePath) {
  const data = await readSqliteBundleIndex(sqlitePath);
  const key = path.resolve(String(sqlitePath || ''));
  if (!data.unreadable && !data.permissionDenied) {
    if (data.exists) {
      blockedPaths.delete(key);
    }
    return data;
  }
  const movedPath = `${sqlitePath}.corrupt-${formatTimestamp()}`;
  let alert;
  try {
    await fs.rename(sqlitePath, movedPath);
    blockedPaths.delete(key);
    alert = `The chemical inventory file could not be read, so it was moved to ${path.basename(movedPath)} instead of being overwritten. Chemicals start empty; restore that file to recover them.`;
  } catch (error) {
    blockedPaths.add(key);
    alert = `The chemical inventory file ${path.basename(sqlitePath)} could not be read or moved aside (${String(error?.code || error?.message || error)}). Chemical changes will not be saved until it can be read again.`;
  }
  pendingAlerts.set(key, alert);
  return { ...data, alert };
}

function assertChemicalIndexWritable(sqlitePath) {
  if (blockedPaths.has(path.resolve(String(sqlitePath || '')))) {
    const error = new Error(`Refusing to overwrite the unreadable chemical inventory file ${sqlitePath}.`);
    error.code = UNREADABLE_CODE;
    throw error;
  }
}

// Delivered once, with the import that feeds the renderer's state.
function takeChemicalIndexAlerts(sqlitePath) {
  const key = path.resolve(String(sqlitePath || ''));
  const alert = pendingAlerts.get(key);
  pendingAlerts.delete(key);
  return alert ? [alert] : [];
}

module.exports = {
  CHEMICAL_INDEX_UNREADABLE_CODE: UNREADABLE_CODE,
  assertChemicalIndexWritable,
  readChemicalIndex,
  takeChemicalIndexAlerts
};
