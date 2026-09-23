'use strict';

const fs = require('fs/promises');
const path = require('path');
const { cleanText, ensureObject, loadSqlJs, readJsonFile } = require('../storage-utils');
const { NOTEBOOK_PAGE_FILE_NAME } = require('./constants.js');
const { isPermissionDeniedError } = require('./folder-names.js');

function readSqlRows(db, sql, values = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(values);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

async function readWorkflowStatusIndex(sqlitePath) {
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (!bytes.length) {
      return {
        exists: true,
        templateRows: [],
        workflowRows: []
      };
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const templateRows = readSqlRows(db, 'SELECT * FROM workflow_templates', []);
      const workflowRows = readSqlRows(db, 'SELECT * FROM workflow_runs', []);
      return {
        exists: true,
        templateRows,
        workflowRows
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        templateRows: [],
        workflowRows: [],
        warnings: []
      };
    }
    if (isPermissionDeniedError(error)) {
      return {
        exists: false,
        templateRows: [],
        workflowRows: [],
        warnings: [`Permission denied reading workflow status index ${sqlitePath}: ${String(error?.message || error)}`]
      };
    }
    // The workflow index is rebuilt from the run folders on every sync, so an
    // unreadable one degrades to "no index" rather than failing the load.
    return {
      exists: false,
      templateRows: [],
      workflowRows: [],
      warnings: [`Ignoring unreadable workflow status index ${sqlitePath}: ${String(error?.message || error)}`]
    };
  }
}

async function readNotebookEntriesForWorkflowFolder(workflowFolderPath) {
  const notebookRoot = path.join(workflowFolderPath, 'Notebook');
  const out = [];
  async function walk(currentPath) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== NOTEBOOK_PAGE_FILE_NAME) {
        continue;
      }
      const payload = await readJsonFile(absPath);
      if (!payload.ok) {
        continue;
      }
      const notebookEntry = ensureObject(payload.data?.notebookEntry);
      const notebookId = cleanText(notebookEntry.id, 220);
      if (!notebookId) {
        continue;
      }
      out.push({
        ...notebookEntry,
        storageFolder: path.dirname(absPath)
      });
    }
  }
  await walk(notebookRoot);
  return out;
}

module.exports = {
  readNotebookEntriesForWorkflowFolder,
  readWorkflowStatusIndex
};
