import {
  parseWellId,
  toRowLabel
} from './plate-model.js';

function normalizeImportCell(value) {
  return String(value ?? '').trim();
}

function trimTrailingEmptyImportCells(row) {
  const next = Array.isArray(row) ? row.map(normalizeImportCell) : [];
  while (next.length && !next[next.length - 1]) {
    next.pop();
  }
  return next;
}

function normalizeImportRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(trimTrailingEmptyImportCells)
    .filter((row) => row.some(Boolean));
}

function maxImportColumnCount(rows) {
  return rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
}

function numericImportValue(value) {
  const text = normalizeImportCell(value).replace(/,/g, '');
  if (!text || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function oneBasedIntegerLabel(value) {
  const parsed = numericImportValue(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isContinuousOneBased(values, length) {
  if (!Array.isArray(values) || values.length < length || length <= 0) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    if (oneBasedIntegerLabel(values[index]) !== index + 1) {
      return false;
    }
  }
  return true;
}

function isPlateRowLabelSequence(values, length) {
  if (!Array.isArray(values) || values.length < length || length <= 0) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    if (normalizeImportCell(values[index]).toUpperCase() !== toRowLabel(index)) {
      return false;
    }
  }
  return true;
}

function importColumnLetter(columnIndex) {
  let value = columnIndex + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label || 'A';
}

function importCellAddress(rowIndex, columnIndex) {
  return `${importColumnLetter(columnIndex)}${rowIndex + 1}`;
}

function sliceImportMatrix(rows, startRowIndex, startColumnIndex, rowCount, columnCount) {
  const matrix = [];
  for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
    const sourceRow = rows[startRowIndex + rowOffset] || [];
    const nextRow = [];
    for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
      nextRow.push(normalizeImportCell(sourceRow[startColumnIndex + columnOffset]));
    }
    matrix.push(nextRow);
  }
  return matrix;
}

function summarizeImportMatrix(matrix) {
  let nonBlankCount = 0;
  let numericCount = 0;
  matrix.forEach((row) => {
    row.forEach((cell) => {
      if (!normalizeImportCell(cell)) {
        return;
      }
      nonBlankCount += 1;
      if (numericImportValue(cell) !== null) {
        numericCount += 1;
      }
    });
  });
  const totalCount = matrix.reduce((total, row) => total + row.length, 0);
  return {
    totalCount,
    nonBlankCount,
    numericCount,
    nonBlankRatio: totalCount ? nonBlankCount / totalCount : 0,
    numericRatio: nonBlankCount ? numericCount / nonBlankCount : 0
  };
}

function scoreImportCandidate({ matrix, rows, startRowIndex, startColumnIndex, rowCount, columnCount }) {
  const stats = summarizeImportMatrix(matrix);
  if (!stats.nonBlankCount || !stats.numericCount) {
    return null;
  }
  if (stats.numericRatio < 0.45 && stats.numericCount < Math.max(3, Math.ceil(stats.totalCount * 0.2))) {
    return null;
  }

  const rowAbove = startRowIndex > 0
    ? (rows[startRowIndex - 1] || []).slice(startColumnIndex, startColumnIndex + columnCount)
    : [];
  const leftColumn = startColumnIndex > 0
    ? rows.slice(startRowIndex, startRowIndex + rowCount).map((row) => row?.[startColumnIndex - 1])
    : [];
  const firstRow = matrix[0] || [];
  const firstColumn = matrix.map((row) => row[0]);
  const hasNumberedColumnHeader = isContinuousOneBased(rowAbove, columnCount);
  const hasLetteredRowHeader = isPlateRowLabelSequence(leftColumn, rowCount);
  const hasNumberedRowHeader = isContinuousOneBased(leftColumn, rowCount);
  const dataStartsWithNumberedHeader = isContinuousOneBased(firstRow, columnCount);
  const dataStartsWithRowHeader = isPlateRowLabelSequence(firstColumn, rowCount) || isContinuousOneBased(firstColumn, rowCount);

  let score = (stats.numericRatio * 90) + (stats.nonBlankRatio * 35) + Math.min(stats.numericCount, stats.totalCount);
  if (stats.nonBlankRatio >= 0.95) {
    score += 12;
  }
  if (hasNumberedColumnHeader) {
    score += 40;
  }
  if (hasLetteredRowHeader) {
    score += 36;
  } else if (hasNumberedRowHeader) {
    score += 18;
  }
  if (!hasNumberedColumnHeader && !hasLetteredRowHeader && !hasNumberedRowHeader && startRowIndex === 0 && startColumnIndex === 0) {
    score += 8;
  }
  if (dataStartsWithNumberedHeader) {
    score -= 55;
  }
  if (dataStartsWithRowHeader) {
    score -= 55;
  }

  return {
    ...stats,
    score,
    hasNumberedColumnHeader,
    hasLetteredRowHeader,
    hasNumberedRowHeader,
    dataStartsWithNumberedHeader,
    dataStartsWithRowHeader
  };
}

export function detectAssayResultMatrixCandidates(tables, def) {
  const rowCount = Number(def?.rows);
  const columnCount = Number(def?.columns);
  if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount <= 0 || columnCount <= 0) {
    return [];
  }

  const candidates = [];
  (Array.isArray(tables) ? tables : []).forEach((table, tableIndex) => {
    const rows = normalizeImportRows(table?.rows);
    const width = maxImportColumnCount(rows);
    if (rows.length < rowCount || width < columnCount) {
      return;
    }
    const maxStartRow = rows.length - rowCount;
    const maxStartColumn = width - columnCount;
    for (let startRowIndex = 0; startRowIndex <= maxStartRow; startRowIndex += 1) {
      for (let startColumnIndex = 0; startColumnIndex <= maxStartColumn; startColumnIndex += 1) {
        const matrix = sliceImportMatrix(rows, startRowIndex, startColumnIndex, rowCount, columnCount);
        const scored = scoreImportCandidate({
          matrix,
          rows,
          startRowIndex,
          startColumnIndex,
          rowCount,
          columnCount
        });
        if (!scored || scored.score < 35) {
          continue;
        }
        const startAddress = importCellAddress(startRowIndex, startColumnIndex);
        const endAddress = importCellAddress(startRowIndex + rowCount - 1, startColumnIndex + columnCount - 1);
        candidates.push({
          id: `table-${tableIndex + 1}-${startRowIndex}-${startColumnIndex}`,
          tableId: String(table?.id || `table-${tableIndex + 1}`),
          tableName: String(table?.name || table?.sheetName || `Sheet ${tableIndex + 1}`).trim() || `Sheet ${tableIndex + 1}`,
          format: String(table?.format || '').trim(),
          startRowIndex,
          startColumnIndex,
          rangeLabel: `${startAddress}:${endAddress}`,
          rows: rowCount,
          columns: columnCount,
          matrix,
          ...scored
        });
      }
    }
  });

  candidates.sort((left, right) => right.score - left.score);
  const bestScore = candidates[0]?.score ?? 0;
  const seenTableIds = new Set();
  const selected = [];
  candidates.forEach((candidate) => {
    const tableId = candidate.tableId || candidate.tableName;
    const isBestForTable = !seenTableIds.has(tableId);
    if (isBestForTable) {
      seenTableIds.add(tableId);
    }
    if (!isBestForTable && candidate.score < Math.max(35, bestScore - 18)) {
      return;
    }
    selected.push(candidate);
  });
  return selected.slice(0, 12);
}

export function getAssayResultImportTarget(layout, fallbackDef) {
  const mappedCells = (Array.isArray(layout) ? layout : [])
    .map((item) => parseWellId(item?.well))
    .filter(Boolean);
  if (!mappedCells.length) {
    return {
      rows: Number(fallbackDef?.rows) || 0,
      columns: Number(fallbackDef?.columns) || 0,
      startRowIndex: 0,
      startColumnIndex: 0,
      source: 'plate'
    };
  }

  const rowIndexes = mappedCells.map((item) => item.rowIndex);
  const columnIndexes = mappedCells.map((item) => item.columnIndex);
  const startRowIndex = Math.min(...rowIndexes);
  const endRowIndex = Math.max(...rowIndexes);
  const startColumnIndex = Math.min(...columnIndexes);
  const endColumnIndex = Math.max(...columnIndexes);
  return {
    rows: (endRowIndex - startRowIndex) + 1,
    columns: (endColumnIndex - startColumnIndex) + 1,
    startRowIndex,
    startColumnIndex,
    source: 'mapped'
  };
}
