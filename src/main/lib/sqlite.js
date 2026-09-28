'use strict';

const path = require('node:path');
const { resolveSqlJsWasmJsPath } = require('./sqljs-path.js');

const SQLJS_WASM_JS_PATH = resolveSqlJsWasmJsPath(__dirname);
let sqlJsInitPromise = null;

async function loadSqlJs() {
  if (!sqlJsInitPromise) {
    sqlJsInitPromise = (async () => {
      const initSqlJs = require(SQLJS_WASM_JS_PATH);
      return initSqlJs({
        locateFile: (fileName) => path.join(path.dirname(SQLJS_WASM_JS_PATH), fileName)
      });
    })();
  }
  return sqlJsInitPromise;
}

function querySqlRows(db, sql, values = []) {
  const statement = db.prepare(sql);
  const rows = [];
  try {
    statement.bind(values);
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

function querySqlRow(db, sql, values = []) {
  return querySqlRows(db, sql, values)[0] || null;
}

function readSqliteTableNames(db) {
  return new Set(
    querySqlRows(db, "SELECT name FROM sqlite_master WHERE type='table'")
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean)
  );
}

module.exports = {
  SQLJS_WASM_JS_PATH,
  loadSqlJs,
  querySqlRow,
  querySqlRows,
  readSqliteTableNames
};
