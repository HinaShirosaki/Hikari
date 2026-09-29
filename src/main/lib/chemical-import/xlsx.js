'use strict';

const zlib = require('node:zlib');
const { ZIP_CENTRAL_DIRECTORY_SIGNATURE, ZIP_EOCD_SIGNATURE, ZIP_LOCAL_FILE_SIGNATURE } = require('./constants.js');
const { buildParsedTable, decodeXmlEntities, decodeZipName } = require('./table-text.js');

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

// <tag ...>body</tag> and the self-closing <tag .../>, which Excel writes for an
// empty cell that only carries a style. A pattern that insisted on the closing
// tag ran on into the next element, so a styled blank cell took its
// neighbour's value and that value vanished from its own column.
function xmlElements(xml, tag) {
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  return [...String(xml || '').matchAll(pattern)].map((match) => ({ attrs: match[1], body: match[2] || '' }));
}

function elementText(xml) {
  return xmlElements(xml, 't').map((element) => decodeXmlEntities(element.body)).join('');
}

function parseSharedStrings(xml) {
  return xmlElements(xml, 'si').map((si) => elementText(si.body));
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
    return elementText(body);
  }
  const raw = decodeXmlEntities(xmlElements(body, 'v')[0]?.body || '');
  if (type === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }
  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE';
  }
  return raw;
}

function parseSheetXml(xml, sharedStrings) {
  return xmlElements(xml, 'row').map((row) => {
    const cells = [];
    let sequentialColumn = 0;
    xmlElements(row.body, 'c').forEach(({ attrs: attrText, body }) => {
      const attrs = parseXmlAttributes(attrText);
      const explicitIndex = columnIndexFromCellRef(attrs.r);
      const columnIndex = explicitIndex >= 0 ? explicitIndex : sequentialColumn;
      cells[columnIndex] = textFromCellXml(body, attrs, sharedStrings);
      sequentialColumn = columnIndex + 1;
    });
    return cells;
  });
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

module.exports = {
  parseXlsx,
  parseXlsxSheets,
  parseXmlAttributes
};
