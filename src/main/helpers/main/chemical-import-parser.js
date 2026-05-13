'use strict';

const zlib = require('node:zlib');

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const OLE_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const FREESECT = 0xFFFFFFFF;
const ENDOFCHAIN = 0xFFFFFFFE;
const FATSECT = 0xFFFFFFFD;
const DIFSECT = 0xFFFFFFFC;

function trimTrailingEmptyCells(row) {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length && !String(next[next.length - 1] ?? '').trim()) {
    next.pop();
  }
  return next;
}

function normalizeTableRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => trimTrailingEmptyCells(row.map((cell) => String(cell ?? '').trim())))
    .filter((row) => row.some((cell) => String(cell || '').trim()));
}

function buildParsedTable(rows, metadata = {}) {
  const normalizedRows = normalizeTableRows(rows);
  const headers = normalizedRows[0] || [];
  const dataRows = normalizedRows.slice(1);
  return {
    headers,
    rows: dataRows,
    tableRows: normalizedRows,
    rowCount: dataRows.length,
    ...metadata
  };
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)));
}

function decodeZipName(buffer) {
  return buffer.toString('utf8');
}

function parseDelimitedText(rawText, delimiter = '') {
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  const sample = text.slice(0, 4096);
  const resolvedDelimiter = delimiter || [
    { value: ',', count: (sample.match(/,/g) || []).length },
    { value: '\t', count: (sample.match(/\t/g) || []).length },
    { value: ';', count: (sample.match(/;/g) || []).length }
  ].sort((a, b) => b.count - a.count)[0]?.value || ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === resolvedDelimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return buildParsedTable(rows, {
    format: resolvedDelimiter === '\t' ? 'tsv' : 'csv'
  });
}

function findZipEocd(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xFFFF - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocdOffset = findZipEocd(buffer);
  if (eocdOffset < 0) {
    throw new Error('XLSX file is not a valid zip archive.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('XLSX central directory is invalid.');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = decodeZipName(buffer.subarray(offset + 46, offset + 46 + fileNameLength));

    if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new Error(`XLSX local file header is invalid for ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported XLSX compression method ${compressionMethod}.`);
    }
    entries.set(name.replace(/\\/g, '/'), {
      name,
      data,
      uncompressedSize
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readXmlEntry(entries, name) {
  const entry = entries.get(name);
  return entry ? entry.data.toString('utf8') : '';
}

function parseXmlAttributes(source) {
  const attrs = {};
  String(source || '').replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_match, key, value) => {
    attrs[key] = decodeXmlEntities(value);
    return '';
  });
  return attrs;
}

function normalizeZipPath(basePath, target) {
  const cleanTarget = String(target || '').replace(/\\/g, '/');
  if (!cleanTarget) {
    return '';
  }
  if (cleanTarget.startsWith('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }
  const parts = `${basePath.replace(/\/[^/]*$/, '')}/${cleanTarget}`.split('/');
  const resolved = [];
  parts.forEach((part) => {
    if (!part || part === '.') {
      return;
    }
    if (part === '..') {
      resolved.pop();
      return;
    }
    resolved.push(part);
  });
  return resolved.join('/');
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }
  const strings = [];
  const siMatches = xml.match(/<si\b[\s\S]*?<\/si>/g) || [];
  siMatches.forEach((si) => {
    const parts = [];
    si.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_match, text) => {
      parts.push(decodeXmlEntities(text));
      return '';
    });
    strings.push(parts.join(''));
  });
  return strings;
}

function parseWorkbookSheetTarget(entries) {
  return parseWorkbookSheetTargets(entries)[0] || { path: 'xl/worksheets/sheet1.xml', name: 'Sheet1' };
}

function parseWorkbookSheetTargets(entries) {
  const workbookXml = readXmlEntry(entries, 'xl/workbook.xml');
  const relsXml = readXmlEntry(entries, 'xl/_rels/workbook.xml.rels');
  const rels = new Map();
  relsXml.replace(/<Relationship\b([^>]*)\/?>/g, (_match, attrText) => {
    const attrs = parseXmlAttributes(attrText);
    if (attrs.Id && attrs.Target) {
      rels.set(attrs.Id, normalizeZipPath('xl/workbook.xml', attrs.Target));
    }
    return '';
  });

  const sheetMatches = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)];
  if (!sheetMatches.length) {
    return [{ path: 'xl/worksheets/sheet1.xml', name: 'Sheet1' }];
  }
  return sheetMatches.map((match, index) => {
    const attrs = parseXmlAttributes(match[1]);
    const relId = attrs['r:id'] || attrs.id || '';
    const relTarget = relId ? rels.get(relId) : '';
    return {
      path: relTarget || `xl/worksheets/sheet${index + 1}.xml`,
      name: attrs.name || `Sheet${index + 1}`
    };
  });
}

function columnIndexFromCellRef(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0] || '';
  if (!letters) {
    return -1;
  }
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = (value * 26) + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
}

function textFromCellXml(body, attrs, sharedStrings) {
  const type = attrs.t || '';
  if (type === 'inlineStr') {
    const parts = [];
    body.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_match, text) => {
      parts.push(decodeXmlEntities(text));
      return '';
    });
    return parts.join('');
  }
  const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const raw = valueMatch ? decodeXmlEntities(valueMatch[1]) : '';
  if (type === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }
  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE';
  }
  return raw;
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowMatches = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  rowMatches.forEach((rowXml) => {
    const cells = [];
    let sequentialColumn = 0;
    rowXml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (_match, attrText, body) => {
      const attrs = parseXmlAttributes(attrText);
      const explicitIndex = columnIndexFromCellRef(attrs.r);
      const columnIndex = explicitIndex >= 0 ? explicitIndex : sequentialColumn;
      cells[columnIndex] = textFromCellXml(body, attrs, sharedStrings);
      sequentialColumn = columnIndex + 1;
      return '';
    });
    rows.push(cells);
  });
  return rows;
}

function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readXmlEntry(entries, 'xl/sharedStrings.xml'));
  const sheet = parseWorkbookSheetTarget(entries);
  const sheetXml = readXmlEntry(entries, sheet.path);
  if (!sheetXml) {
    throw new Error('XLSX workbook did not contain a readable worksheet.');
  }
  return buildParsedTable(parseSheetXml(sheetXml, sharedStrings), {
    format: 'xlsx',
    sheetName: sheet.name
  });
}

function parseXlsxSheets(buffer) {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(readXmlEntry(entries, 'xl/sharedStrings.xml'));
  return parseWorkbookSheetTargets(entries)
    .map((sheet) => {
      const sheetXml = readXmlEntry(entries, sheet.path);
      if (!sheetXml) {
        return null;
      }
      return buildParsedTable(parseSheetXml(sheetXml, sharedStrings), {
        format: 'xlsx',
        sheetName: sheet.name
      });
    })
    .filter(Boolean);
}

function parseHtmlTableRows(tableHtml) {
  const rows = [];
  (tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).forEach((rowHtml) => {
    const row = [];
    rowHtml.replace(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi, (_match, cellHtml) => {
      row.push(decodeXmlEntities(cellHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim());
      return '';
    });
    rows.push(row);
  });
  return rows;
}

function maybeParseHtmlTables(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!/^<(!doctype\s+html|html|table)\b/i.test(text)) {
    return [];
  }
  const tableMatches = text.match(/<table\b[\s\S]*?<\/table>/gi) || [text];
  return tableMatches.map((table, index) => buildParsedTable(parseHtmlTableRows(table), {
    format: 'html-xls',
    sheetName: `Table ${index + 1}`
  }));
}

function maybeParseHtmlTable(buffer) {
  return maybeParseHtmlTables(buffer)[0] || null;
}

function parseSpreadsheetMlRows(source) {
  const rows = [];
  (source.match(/<Row\b[\s\S]*?<\/Row>/gi) || []).forEach((rowXml) => {
    const row = [];
    let currentIndex = 0;
    rowXml.replace(/<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi, (_match, attrText, cellXml) => {
      const attrs = parseXmlAttributes(attrText);
      const explicitIndex = Number(attrs['ss:Index'] || attrs.Index || 0);
      if (Number.isFinite(explicitIndex) && explicitIndex > 0) {
        currentIndex = explicitIndex - 1;
      }
      const valueMatch = cellXml.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
      row[currentIndex] = valueMatch ? decodeXmlEntities(valueMatch[1]).trim() : '';
      currentIndex += 1;
      return '';
    });
    rows.push(row);
  });
  return rows;
}

function maybeParseSpreadsheetMlTables(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!/^<\?xml/i.test(text) || !/<Workbook\b/i.test(text)) {
    return [];
  }
  const worksheetMatches = text.match(/<Worksheet\b[\s\S]*?<\/Worksheet>/gi) || [];
  if (!worksheetMatches.length) {
    return [buildParsedTable(parseSpreadsheetMlRows(text), {
      format: 'xml-xls',
      sheetName: 'Sheet 1'
    })];
  }
  return worksheetMatches.map((worksheetXml, index) => {
    const attrs = parseXmlAttributes(worksheetXml.match(/<Worksheet\b([^>]*)>/i)?.[1] || '');
    return buildParsedTable(parseSpreadsheetMlRows(worksheetXml), {
      format: 'xml-xls',
      sheetName: attrs['ss:Name'] || attrs.Name || `Sheet ${index + 1}`
    });
  });
}

function maybeParseSpreadsheetMl(buffer) {
  return maybeParseSpreadsheetMlTables(buffer)[0] || null;
}

function sectorOffset(sector, sectorSize) {
  return 512 + (sector * sectorSize);
}

function readSector(buffer, sector, sectorSize) {
  const offset = sectorOffset(sector, sectorSize);
  return buffer.subarray(offset, offset + sectorSize);
}

function readSectorChain(buffer, fat, startSector, sectorSize, maxBytes = Infinity) {
  const chunks = [];
  const seen = new Set();
  let sector = startSector;
  let remaining = maxBytes;
  while (
    sector !== ENDOFCHAIN
    && sector !== FREESECT
    && sector !== FATSECT
    && sector !== DIFSECT
    && Number.isInteger(sector)
    && sector >= 0
    && !seen.has(sector)
    && remaining > 0
  ) {
    seen.add(sector);
    const chunk = readSector(buffer, sector, sectorSize);
    chunks.push(remaining === Infinity ? chunk : chunk.subarray(0, remaining));
    remaining -= chunk.length;
    sector = fat[sector];
  }
  return Buffer.concat(chunks).subarray(0, maxBytes === Infinity ? undefined : maxBytes);
}

function parseDirectoryEntries(directoryStream) {
  const entries = [];
  for (let offset = 0; offset + 128 <= directoryStream.length; offset += 128) {
    const entry = directoryStream.subarray(offset, offset + 128);
    const nameLength = entry.readUInt16LE(64);
    const rawName = nameLength >= 2
      ? entry.subarray(0, nameLength - 2).toString('utf16le')
      : '';
    const type = entry[66];
    const startSector = entry.readUInt32LE(116);
    const sizeLow = entry.readUInt32LE(120);
    const sizeHigh = entry.readUInt32LE(124);
    const size = sizeHigh ? (sizeHigh * 0x100000000) + sizeLow : sizeLow;
    if (rawName) {
      entries.push({
        name: rawName,
        type,
        startSector,
        size
      });
    }
  }
  return entries;
}

function readOleCompoundFile(buffer) {
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
    throw new Error('XLS file is not a valid OLE compound file.');
  }

  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDirectorySector = buffer.readUInt32LE(48);
  const miniStreamCutoff = buffer.readUInt32LE(56);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const miniFatSectorCount = buffer.readUInt32LE(64);
  const firstDifatSector = buffer.readUInt32LE(68);
  const difatSectorCount = buffer.readUInt32LE(72);
  const difat = [];

  for (let index = 0; index < 109; index += 1) {
    const sector = buffer.readUInt32LE(76 + (index * 4));
    if (sector !== FREESECT) {
      difat.push(sector);
    }
  }

  let difatSector = firstDifatSector;
  for (let index = 0; index < difatSectorCount && difatSector !== ENDOFCHAIN; index += 1) {
    const sector = readSector(buffer, difatSector, sectorSize);
    const entriesPerSector = (sectorSize / 4) - 1;
    for (let entryIndex = 0; entryIndex < entriesPerSector; entryIndex += 1) {
      const value = sector.readUInt32LE(entryIndex * 4);
      if (value !== FREESECT) {
        difat.push(value);
      }
    }
    difatSector = sector.readUInt32LE(sectorSize - 4);
  }

  const fat = [];
  difat.slice(0, fatSectorCount || difat.length).forEach((sectorIndex) => {
    const sector = readSector(buffer, sectorIndex, sectorSize);
    for (let offset = 0; offset < sector.length; offset += 4) {
      fat.push(sector.readUInt32LE(offset));
    }
  });

  const directoryStream = readSectorChain(buffer, fat, firstDirectorySector, sectorSize);
  const entries = parseDirectoryEntries(directoryStream);
  const rootEntry = entries.find((entry) => entry.type === 5);
  const miniStream = rootEntry
    ? readSectorChain(buffer, fat, rootEntry.startSector, sectorSize, rootEntry.size)
    : Buffer.alloc(0);

  const miniFat = [];
  if (firstMiniFatSector !== ENDOFCHAIN && miniFatSectorCount > 0) {
    const miniFatStream = readSectorChain(buffer, fat, firstMiniFatSector, sectorSize, miniFatSectorCount * sectorSize);
    for (let offset = 0; offset + 4 <= miniFatStream.length; offset += 4) {
      miniFat.push(miniFatStream.readUInt32LE(offset));
    }
  }

  function readMiniStream(startSector, size) {
    const chunks = [];
    const seen = new Set();
    let sector = startSector;
    let remaining = size;
    while (
      sector !== ENDOFCHAIN
      && sector !== FREESECT
      && Number.isInteger(sector)
      && sector >= 0
      && !seen.has(sector)
      && remaining > 0
    ) {
      seen.add(sector);
      const offset = sector * miniSectorSize;
      const chunk = miniStream.subarray(offset, offset + Math.min(miniSectorSize, remaining));
      chunks.push(chunk);
      remaining -= chunk.length;
      sector = miniFat[sector];
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  function readStream(entry) {
    if (!entry || entry.type !== 2) {
      return Buffer.alloc(0);
    }
    if (entry.size < miniStreamCutoff && miniStream.length && miniFat.length) {
      return readMiniStream(entry.startSector, entry.size);
    }
    return readSectorChain(buffer, fat, entry.startSector, sectorSize, entry.size);
  }

  return {
    entries,
    readStream
  };
}

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

function parseSst(records) {
  const parts = [];
  records.forEach((record, index) => {
    parts.push(index === 0 ? record.data.subarray(8) : record.data);
  });
  const data = Buffer.concat(parts);
  const strings = [];
  let offset = 0;
  while (offset + 3 <= data.length) {
    try {
      const parsed = readBiff8String(data, offset);
      strings.push(parsed.text);
      if (parsed.nextOffset <= offset) {
        break;
      }
      offset = parsed.nextOffset;
    } catch {
      break;
    }
  }
  return strings;
}

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
    setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), data[6] ? 'TRUE' : 'FALSE');
  } else if (record.id === 0x0006 && data.length >= 14) {
    const marker = data[12];
    if (marker !== 0xFF) {
      setBiffCell(rows, data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
    }
  }
}

function parseBiffWorkbookSheets(workbookStream) {
  const records = readBiffRecords(workbookStream);
  const sharedStrings = parseBiffSharedStrings(records);
  const sheetNames = parseBiffWorkbookSheetNames(records);
  const sheets = [];
  let activeRows = null;
  let activeSheetIndex = -1;

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
    applyBiffCellRecord(activeRows, record, sharedStrings);
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
