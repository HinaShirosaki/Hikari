'use strict';

const { normalizeTableRows, parseDelimitedText } = require('./chemical-import/table-text.js');
const { parseXls, parseXlsSheets } = require('./chemical-import/xls-biff.js');
const { parseXlsx, parseXlsxSheets } = require('./chemical-import/xlsx.js');

function parseChemicalImportFile({ fileName = '', dataBase64 = '', buffer = null } = {}) {
  const sourceBuffer = buffer
    ? Buffer.from(buffer)
    : Buffer.from(String(dataBase64 || ''), 'base64');
  if (!sourceBuffer.length) {
    throw new Error('Import file is empty.');
  }

  const extension = String(fileName || '').toLowerCase().split('.').pop();
  if (extension === 'csv') {
    return parseDelimitedText(sourceBuffer.toString('utf8'), ',');
  }
  if (extension === 'tsv') {
    return parseDelimitedText(sourceBuffer.toString('utf8'), '\t');
  }
  if (extension === 'xlsx') {
    return parseXlsx(sourceBuffer);
  }
  if (extension === 'xls') {
    return parseXls(sourceBuffer);
  }

  const textPreview = sourceBuffer.toString('utf8', 0, Math.min(sourceBuffer.length, 256)).trim();
  if (textPreview.includes(',') || textPreview.includes('\t')) {
    return parseDelimitedText(sourceBuffer.toString('utf8'));
  }
  throw new Error('Unsupported chemical import file type. Use .csv, .xls, or .xlsx.');
}

function tableForAssayResultImport(table, index = 0) {
  const tableRows = normalizeTableRows(
    Array.isArray(table?.tableRows)
      ? table.tableRows
      : [table?.headers || [], ...(Array.isArray(table?.rows) ? table.rows : [])]
  );
  return {
    id: `table-${index + 1}`,
    name: String(table?.sheetName || table?.name || `Sheet ${index + 1}`).trim() || `Sheet ${index + 1}`,
    format: String(table?.format || '').trim(),
    rows: tableRows,
    rowCount: tableRows.length,
    columnCount: tableRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
  };
}

function parseAssayResultImportFile({ fileName = '', dataBase64 = '', buffer = null } = {}) {
  const sourceBuffer = buffer
    ? Buffer.from(buffer)
    : Buffer.from(String(dataBase64 || ''), 'base64');
  if (!sourceBuffer.length) {
    throw new Error('Result import file is empty.');
  }

  const extension = String(fileName || '').toLowerCase().split('.').pop();
  let tables = [];
  if (extension === 'csv') {
    tables = [parseDelimitedText(sourceBuffer.toString('utf8'), ',')];
  } else if (extension === 'tsv') {
    tables = [parseDelimitedText(sourceBuffer.toString('utf8'), '\t')];
  } else if (extension === 'xlsx') {
    tables = parseXlsxSheets(sourceBuffer);
  } else if (extension === 'xls') {
    tables = parseXlsSheets(sourceBuffer);
  } else {
    const textPreview = sourceBuffer.toString('utf8', 0, Math.min(sourceBuffer.length, 256)).trim();
    if (textPreview.includes(',') || textPreview.includes('\t')) {
      tables = [parseDelimitedText(sourceBuffer.toString('utf8'))];
    }
  }

  const resultTables = tables
    .map((table, index) => tableForAssayResultImport(table, index))
    .filter((table) => table.rows.length && table.columnCount);
  if (!resultTables.length) {
    throw new Error('No readable result table was found. Use .csv, .xls, or .xlsx.');
  }
  return {
    fileName: String(fileName || '').trim(),
    tables: resultTables
  };
}

module.exports = {
  parseChemicalImportFile,
  parseAssayResultImportFile,
  __private: {
    parseDelimitedText,
    parseXlsx,
    parseXlsxSheets,
    parseXls,
    parseXlsSheets,
    normalizeTableRows
  }
};
