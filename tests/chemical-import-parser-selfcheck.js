// Run: node tests/chemical-import-parser-selfcheck.js
'use strict';

const assert = require('node:assert/strict');
const { parseAssayResultImportFile } = require('../src/main/lib/chemical-import-parser.js');

// Stored (uncompressed) zip; the reader does not check CRCs, so they stay zero.
function storedZip(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text]) => {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

// Excel writes a styled empty cell as <c r="B2" s="1"/>. The value after it
// must stay in its own column, not slide into the blank one.
const xlsx = storedZip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Plate" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Well</t></si><si><t/></si><si><r><t>OD</t></r><r><t>600</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="inlineStr"><is><t>Note</t></is></c></row>'
    + '<row r="2" spans="1:3"/>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>A1</t></is></c><c r="B3" s="1"/><c r="C3"><v>0.734</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>A2</t></is></c><c r="B4"><v>0.512</v></c><c r="C4" s="1"/><c r="D4"><v>9.99</v></c></row>'
    + '</sheetData></worksheet>'
});
assert.deepEqual(parseAssayResultImportFile({ fileName: 'plate.xlsx', buffer: xlsx }).tables[0].rows, [
  ['Well', 'OD600', 'Note'],
  ['A1', '', '0.734'],
  ['A2', '0.512', '', '9.99']
]);

// Minimal OLE compound file holding one stream in regular sectors.
function compoundFile(streamName, stream) {
  const sectorCount = Math.ceil(stream.length / 512);
  const header = Buffer.alloc(512, 0xFF);
  header.fill(0, 0, 76);
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(0, 56); // no mini stream: every stream uses regular sectors
  header.writeUInt32LE(0xFFFFFFFE, 60);
  header.writeUInt32LE(0xFFFFFFFE, 68);
  header.writeUInt32LE(0, 76); // the FAT is sector 0
  const fat = Buffer.alloc(512, 0xFF);
  fat.writeUInt32LE(0xFFFFFFFD, 0);
  fat.writeUInt32LE(0xFFFFFFFE, 4);
  for (let index = 0; index < sectorCount; index += 1) {
    fat.writeUInt32LE(index === sectorCount - 1 ? 0xFFFFFFFE : 3 + index, (2 + index) * 4);
  }
  const directory = Buffer.alloc(512, 0);
  [['Root Entry', 5, 0xFFFFFFFE, 0], [streamName, 2, 2, stream.length]].forEach(([name, type, start, size], index) => {
    const at = index * 128;
    const nameBytes = Buffer.from(`${name}\0`, 'utf16le');
    nameBytes.copy(directory, at);
    directory.writeUInt16LE(nameBytes.length, at + 64);
    directory[at + 66] = type;
    directory.writeUInt32LE(start, at + 116);
    directory.writeUInt32LE(size, at + 120);
  });
  const body = Buffer.alloc(sectorCount * 512);
  stream.copy(body);
  return Buffer.concat([header, fat, directory, body]);
}

function record(id, ...chunks) {
  const data = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}
const u16 = (...values) => Buffer.from(new Uint16Array(values).buffer);
const u32 = (...values) => Buffer.from(new Uint32Array(values).buffer);

// The first shared string fills the SST record and ends in a CONTINUE record,
// which opens with a width flag (here: the rest is UTF-16).
const longText = 'A'.repeat(8215);
const sst = record(0x00FC, u32(3, 3), u16(8215), [0x00], 'A'.repeat(8213));
const sstContinue = record(0x003C, [0x01], Buffer.from('AA', 'utf16le'), u16(4), [0x00], 'Well', u16(5), [0x00], 'OD600');
// A FORMULA with a text result keeps the text in the STRING record after it.
const textFormula = record(0x0006, u16(1, 1, 0), [0x00, 0, 0, 0, 0, 0, 0xFF, 0xFF], u16(0), u32(0), u16(0));
const errorFormula = record(0x0006, u16(1, 3, 0), [0x02, 0, 0x2A, 0, 0, 0, 0xFF, 0xFF], u16(0), u32(0), u16(0));
const workbook = Buffer.concat([
  record(0x0809, u16(0x0600, 0x0005), Buffer.alloc(12)),
  sst,
  sstContinue,
  record(0x000A),
  record(0x0809, u16(0x0600, 0x0010), Buffer.alloc(12)),
  record(0x00FD, u16(0, 0, 0), u32(1)),
  record(0x00FD, u16(0, 1, 0), u32(2)),
  record(0x00FD, u16(1, 0, 0), u32(0)),
  textFormula,
  record(0x0207, u16(4), [0x00], 'high'),
  record(0x0205, u16(1, 2, 0), [0x07, 0x01]),
  errorFormula,
  record(0x000A)
]);
assert.deepEqual(parseAssayResultImportFile({ fileName: 'plate.xls', buffer: compoundFile('Workbook', workbook) }).tables[0].rows, [
  ['Well', 'OD600'],
  [longText, 'high', '#DIV/0!', '#N/A']
]);

console.log('chemical-import-parser self-check passed');
