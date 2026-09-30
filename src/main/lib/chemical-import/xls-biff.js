'use strict';

const { maybeParseHtmlTable, maybeParseHtmlTables, maybeParseSpreadsheetMl, maybeParseSpreadsheetMlTables } = require('./html-tables.js');
const { readOleCompoundFile } = require('./ole-compound-file.js');
const { buildParsedTable } = require('./table-text.js');

function readBiff8String(buffer, offset, characterCount = null) {
  let cursor = offset;
  const charCount = characterCount == null ? buffer.readUInt16LE(cursor) : characterCount;
  if (characterCount == null) {
    cursor += 2;
  }
  const options = buffer[cursor] || 0;
  cursor += 1;
  const isWide = (options & 0x01) === 0x01;
  const hasRichText = (options & 0x08) === 0x08;
  const hasAsianPhonetic = (options & 0x04) === 0x04;
  let richTextRuns = 0;
  let phoneticBytes = 0;
  if (hasRichText) {
    richTextRuns = buffer.readUInt16LE(cursor);
    cursor += 2;
  }
  if (hasAsianPhonetic) {
    phoneticBytes = buffer.readUInt32LE(cursor);
    cursor += 4;
  }
  const byteLength = charCount * (isWide ? 2 : 1);
  const text = isWide
    ? buffer.subarray(cursor, cursor + byteLength).toString('utf16le')
    : buffer.subarray(cursor, cursor + byteLength).toString('latin1');
  cursor += byteLength + (richTextRuns * 4) + phoneticBytes;
  return {
    text,
    nextOffset: cursor
  };
}

// SST text runs on from the SST record into the CONTINUE records after it. A
// string cut mid-characters resumes after a one-byte flag giving the width of
// the rest; gluing the records together read that flag as a character and
// misaligned every string after it.
function parseSst(records) {
  const chunks = records.map((record) => record.data);
  let chunkIndex = 0;
  let data = chunks[0];
  let offset = 8;
  const nextChunk = () => {
    chunkIndex += 1;
    data = chunks[chunkIndex] || Buffer.alloc(0);
    offset = 0;
    return chunkIndex < chunks.length;
  };
  const skip = (length) => {
    let remaining = length;
    while (remaining > data.length - offset) {
      remaining -= data.length - offset;
      if (!nextChunk()) {
        return;
      }
    }
    offset += remaining;
  };
  const uniqueCount = data.length >= 8 ? data.readUInt32LE(4) : 0;
  const strings = [];
  try {
    while (!uniqueCount || strings.length < uniqueCount) {
      if (offset >= data.length && !nextChunk()) {
        break;
      }
      const charCount = data.readUInt16LE(offset);
      const options = data[offset + 2];
      offset += 3;
      const richTextRuns = options & 0x08 ? data.readUInt16LE(offset) : 0;
      offset += options & 0x08 ? 2 : 0;
      const phoneticBytes = options & 0x04 ? data.readUInt32LE(offset) : 0;
      offset += options & 0x04 ? 4 : 0;
      let wide = (options & 0x01) === 0x01;
      let remaining = charCount;
      let text = '';
      while (remaining > 0) {
        if (offset >= data.length) {
          if (!nextChunk()) {
            break;
          }
          wide = (data[0] & 0x01) === 0x01;
          offset = 1;
        }
        const width = wide ? 2 : 1;
        const count = Math.min(remaining, Math.floor((data.length - offset) / width));
        if (!count) {
          offset = data.length;
          continue;
        }
        text += data.toString(wide ? 'utf16le' : 'latin1', offset, offset + (count * width));
        offset += count * width;
        remaining -= count;
      }
      strings.push(text);
      skip((richTextRuns * 4) + phoneticBytes);
    }
  } catch {
    // A malformed table keeps the strings read before the damage.
  }
  return strings;
}

const BIFF_ERROR_TEXT = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0F: '#VALUE!', 0x17: '#REF!', 0x1D: '#NAME?', 0x24: '#NUM!', 0x2A: '#N/A' };

function decodeRk(raw) {
  let value;
  if (raw & 0x02) {
    value = raw >> 2;
  } else {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(raw & 0xFFFFFFFC, 4);
    value = buffer.readDoubleLE(0);
  }
  return raw & 0x01 ? value / 100 : value;
}

function cellValueText(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}

function setBiffCell(rows, rowIndex, columnIndex, value) {
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || rowIndex < 0 || columnIndex < 0) {
    return;
  }
  if (!rows[rowIndex]) {
    rows[rowIndex] = [];
  }
  rows[rowIndex][columnIndex] = cellValueText(value);
}

function readBiffRecords(workbookStream) {
  const records = [];
  for (let offset = 0; offset + 4 <= workbookStream.length;) {
    const id = workbookStream.readUInt16LE(offset);
    const length = workbookStream.readUInt16LE(offset + 2);
    const dataOffset = offset + 4;
    if (dataOffset + length > workbookStream.length) {
      break;
    }
    records.push({
      id,
      data: workbookStream.subarray(dataOffset, dataOffset + length),
      offset
    });
    offset = dataOffset + length;
  }
  return records;
}

function parseBiffSheetName(recordData) {
  if (!recordData || recordData.length < 8) {
    return '';
  }
  const nameLength = recordData[6] || 0;
  const options = recordData[7] || 0;
  const isWide = (options & 0x01) === 0x01;
  const start = 8;
  const byteLength = nameLength * (isWide ? 2 : 1);
  if (start + byteLength > recordData.length) {
    return '';
  }
  return isWide
    ? recordData.subarray(start, start + byteLength).toString('utf16le')
    : recordData.subarray(start, start + byteLength).toString('latin1');
}

function parseBiffWorkbookSheetNames(records) {
  return records
    .filter((record) => record.id === 0x0085)
    .map((record) => parseBiffSheetName(record.data))
    .filter(Boolean);
}

function parseBiffSharedStrings(records) {
  const sstRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].id === 0x00FC) {
      sstRecords.push(records[index]);
      let cursor = index + 1;
      while (records[cursor]?.id === 0x003C) {
        sstRecords.push(records[cursor]);
        cursor += 1;
      }
      break;
    }
  }
  return sstRecords.length ? parseSst(sstRecords) : [];
}

function applyBiffCellRecord(rows, record, sharedStrings) {
  const data = record.data;
  if (record.id === 0x00FD && data.length >= 10) {
    const row = data.readUInt16LE(0);
    const col = data.readUInt16LE(2);
    const sstIndex = data.readUInt32LE(6);
    setBiffCell(rows, row, col, sharedStrings[sstIndex] || '');
  } else if (record.id === 0x0203 && data.length >= 14) {
    setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
  } else if (record.id === 0x027E && data.length >= 10) {
    setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), decodeRk(data.readUInt32LE(6)));
  } else if (record.id === 0x00BD && data.length >= 6) {
    const row = data.readUInt16LE(0);
    const firstCol = data.readUInt16LE(2);
    let cursor = 4;
    let column = firstCol;
    while (cursor + 6 <= data.length - 2) {
      setBiffCell(rows, row, column, decodeRk(data.readUInt32LE(cursor + 2)));
      cursor += 6;
      column += 1;
    }
  } else if (record.id === 0x0204 && data.length >= 9) {
    const parsed = readBiff8String(data, 6);
    setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), parsed.text);
  } else if (record.id === 0x0205 && data.length >= 8) {
    const value = data[7] ? BIFF_ERROR_TEXT[data[6]] || '#ERROR' : (data[6] ? 'TRUE' : 'FALSE');
    setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), value);
  } else if (record.id === 0x0006 && data.length >= 14) {
    const row = data.readUInt16LE(0);
    const col = data.readUInt16LE(2);
    if (data.readUInt16LE(12) !== 0xFFFF) {
      setBiffCell(rows, row, col, data.readDoubleLE(6));
    } else if (data[6] === 0x00) {
      // A text result is not in the FORMULA record: the STRING record after it holds it.
      return { row, col };
    } else if (data[6] === 0x01) {
      setBiffCell(rows, row, col, data[8] ? 'TRUE' : 'FALSE');
    } else if (data[6] === 0x02) {
      setBiffCell(rows, row, col, BIFF_ERROR_TEXT[data[8]] || '#ERROR');
    }
  }
  return null;
}

function parseBiffWorkbookSheets(workbookStream) {
  const records = readBiffRecords(workbookStream);
  const sharedStrings = parseBiffSharedStrings(records);
  const sheetNames = parseBiffWorkbookSheetNames(records);
  const sheets = [];
  let activeRows = null;
  let activeSheetIndex = -1;
  let pendingFormulaCell = null;

  for (const record of records) {
    if (record.id === 0x0809) {
      const type = record.data.length >= 4 ? record.data.readUInt16LE(2) : 0;
      if (type === 0x0010) {
        activeSheetIndex += 1;
        activeRows = [];
      }
      continue;
    }
    if (record.id === 0x000A && activeRows) {
      sheets.push(buildParsedTable(activeRows, {
        format: 'xls',
        sheetName: sheetNames[activeSheetIndex] || `Sheet ${activeSheetIndex + 1}`
      }));
      activeRows = null;
      continue;
    }
    if (!activeRows) {
      continue;
    }
    if (record.id === 0x0207 && pendingFormulaCell && record.data.length >= 3) {
      setBiffCell(activeRows, pendingFormulaCell.row, pendingFormulaCell.col, readBiff8String(record.data, 0).text);
      pendingFormulaCell = null;
      continue;
    }
    pendingFormulaCell = applyBiffCellRecord(activeRows, record, sharedStrings) || pendingFormulaCell;
  }

  if (activeRows) {
    sheets.push(buildParsedTable(activeRows, {
      format: 'xls',
      sheetName: sheetNames[activeSheetIndex] || `Sheet ${activeSheetIndex + 1}`
    }));
  }
  return sheets.filter((sheet) => Array.isArray(sheet?.tableRows) && sheet.tableRows.length);
}

function parseBiffWorkbook(workbookStream) {
  return parseBiffWorkbookSheets(workbookStream)[0] || buildParsedTable([], { format: 'xls' });
}

function parseXls(buffer) {
  const htmlTable = maybeParseHtmlTable(buffer);
  if (htmlTable) {
    return htmlTable;
  }
  const spreadsheetMl = maybeParseSpreadsheetMl(buffer);
  if (spreadsheetMl) {
    return spreadsheetMl;
  }

  const ole = readOleCompoundFile(buffer);
  const workbookEntry = ole.entries.find((entry) => /^(Workbook|Book)$/i.test(entry.name));
  if (!workbookEntry) {
    throw new Error('XLS file did not contain a Workbook stream.');
  }
  return parseBiffWorkbook(ole.readStream(workbookEntry));
}

function parseXlsSheets(buffer) {
  const htmlTables = maybeParseHtmlTables(buffer);
  if (htmlTables.length) {
    return htmlTables;
  }
  const spreadsheetMlTables = maybeParseSpreadsheetMlTables(buffer);
  if (spreadsheetMlTables.length) {
    return spreadsheetMlTables;
  }

  const ole = readOleCompoundFile(buffer);
  const workbookEntry = ole.entries.find((entry) => /^(Workbook|Book)$/i.test(entry.name));
  if (!workbookEntry) {
    throw new Error('XLS file did not contain a Workbook stream.');
  }
  return parseBiffWorkbookSheets(ole.readStream(workbookEntry));
}

module.exports = {
  parseXls,
  parseXlsSheets
};
