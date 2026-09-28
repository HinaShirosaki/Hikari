'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { loadSqlJs } = require('../../../../lib/sqlite.js');

const MAX_RESULT_BYTES = 48000;

function jsonValue(value) {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value) : value.toString();
  }
  if (value instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  return value;
}

async function query() {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(workerData.bytes);
  try {
    // No writes, attachments, extension loading, or database export are exposed.
    // The connection is a disposable in-memory snapshot of experiments.sqlite.
    db.run('PRAGMA query_only = ON; PRAGMA hard_heap_limit = 67108864;');
    let statementSql = '';
    for (const statement of db.iterateStatements(workerData.sql)) {
      if (statementSql) throw new Error('Submit exactly one SELECT statement, optionally with a WITH clause.');
      statementSql = statement.getSQL();
    }
    const prefix = statementSql.replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/u, '');
    if (!/^(?:SELECT|WITH)\b/iu.test(prefix)) {
      throw new Error('Only SELECT queries, optionally with a WITH clause, are allowed.');
    }
    // A subquery must be a SELECT even when its first keyword is WITH. This
    // rejects WITH ... DELETE/UPDATE ... RETURNING before stepping the query.
    const statement = db.prepare(`SELECT * FROM (\n${statementSql.replace(/;\s*$/u, '')}\n)`);
    try {
      statement.bind(workerData.parameters);
      const columns = statement.getColumnNames();
      if (!columns.length) throw new Error('The statement must return query results.');
      const rows = [];
      let size = Buffer.byteLength(JSON.stringify(columns, null, 6));
      if (size > MAX_RESULT_BYTES) throw new Error('Column names exceed the response budget; select fewer columns.');
      let truncated = false;
      let truncationReason = '';
      while (statement.step()) {
        if (rows.length >= workerData.limit) {
          truncated = true;
          truncationReason = 'row_limit';
          break;
        }
        const row = statement.get(null, { useBigInt: true }).map(jsonValue);
        size += Buffer.byteLength(JSON.stringify(row, null, 6)) + 1;
        if (size > MAX_RESULT_BYTES) {
          truncated = true;
          truncationReason = 'response_size';
          break;
        }
        rows.push(row);
      }
      return { ok: true, status: 'queried', columns, rows, row_count: rows.length,
        truncated, ...(truncationReason ? { truncation_reason: truncationReason } : {}) };
    } finally { statement.free(); }
  } finally { db.close(); }
}

query().then(
  (result) => parentPort.postMessage(result),
  (error) => parentPort.postMessage({ ok: false, status: 'query_failed', error: String(error?.message || error).slice(0, 1000) })
);
