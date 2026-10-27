// Real jsPDF regression checks for oversized headers and tool page boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');
const { loadEsmStyleModule } = require('./support/runtime.js');
const root = path.resolve(__dirname, '..');
const output = process.argv.includes('--write-artifacts')
  ? path.join(root, 'artifacts/notebook-pressure/fixed-boundaries') : '';
if (output) fs.mkdirSync(output, { recursive: true });
let latest;

function RecordingPdf(...args) {
  const doc = new jsPDF(...args);
  const draws = [];
  const text = doc.text;
  const addPage = doc.addPage;
  let additions = 0;
  doc.addPage = (...params) => {
    assert.ok(++additions < 30, 'Pagination must make progress instead of adding pages forever');
    return addPage.apply(doc, params);
  };
  doc.text = (value, x, y, options = {}) => {
    const width = doc.getTextWidth(String(value));
    draws.push({ text: String(value), x: x - (options.align === 'right' ? width : options.align === 'center' ? width / 2 : 0),
      y, width, page: doc.internal.getCurrentPageInfo().pageNumber,
      pageWidth: doc.internal.pageSize.getWidth(), pageHeight: doc.internal.pageSize.getHeight() });
    return text.call(doc, value, x, y, options);
  };
  doc.save = () => {};
  latest = { doc, draws };
  return doc;
}

const { exportNotebookEntryPdf } = loadEsmStyleModule(path.join(root, 'src/renderer/modules/pdf-export/index.js'), {
  window: { jspdf: { jsPDF: RecordingPdf } }
});
const protocol = { steps: [{ text: 'Record the sample measurements.', placeholders: [] }] };
const base = { id: 'pagination', projectName: 'Pressure review', protocolName: 'Boundary test', experimentName: 'Heading boundary review',
  updatedAt: '2026-10-27T18:00:00Z', notebookState: 'executed', values: {}, result: 'Header pressure case.', resultTables: [], resultFiles: [] };
const tool = { id: 'buffer', type: 'buffer', title: 'Buffer Preparer', result: 'Recipe', table: {
  headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume', 'Note'],
  metaRows: [['Volume', '100 mL', 'pH', '7.4', '', '']],
  rows: [['NaCl', '58.44', '', '150 mM', '876.6 mg', 'Lot 22B - verified balance'], ['Tris', '121.14', '', '20 mM', '242.3 mg', '']],
  footerRows: [['Solvent to add 100 mL', '', '', '', '', '']]
} };

function checkBounds() {
  for (const draw of latest.draws) {
    if (!draw.text.trim()) continue;
    const footer = Math.abs(draw.y - (draw.pageHeight - 40)) < 0.1;
    assert.ok(draw.x >= 18 && draw.x + draw.width <= draw.pageWidth - 18, 'Text must fit the page width: ' + draw.text);
    assert.ok(draw.y >= 18 && (footer || draw.y <= draw.pageHeight - 60), 'Text must stay above the footer: ' + draw.text);
  }
}

function save(name) {
  if (output) fs.writeFileSync(path.join(output, name + '.pdf'), Buffer.from(latest.doc.output('arraybuffer')));
}

async function run() {
  let cases = 0;
  for (const pdfSettings of [{ pageSize: 'letter' }, { pageSize: 'a5' }, { pageSize: 'a5', stapleEdge: 'left' }, { pageSize: 'a5', stapleEdge: 'top' }]) {
    const longHeader = 'Scientific measurement with a detailed descriptive heading '.repeat(35) + 'LAST_HEADER_WORD';
    const secondHeader = 'Independent column description '.repeat(100) + 'SECOND_HEADER_END';
    const table = { columns: [{ field: 'sample', title: 'Sample' }, { field: 'value', title: longHeader }, { field: 'extra', title: secondHeader }],
      rows: [{ id: 'r1', sample: 'A1', value: '12.5', extra: 'FINAL_ROW_VALUE' }] };
    assert.equal(await exportNotebookEntryPdf({ entry: { ...base, resultTables: [table] }, protocol, pdfSettings }), true);
    const fullText = latest.draws.map(draw => draw.text).join(' ');
    assert.ok(fullText.includes('LAST_HEADER_WORD') && fullText.includes('SECOND_HEADER_END'), 'Full long headings must be retained');
    assert.ok(fullText.includes('FINAL_ROW_VALUE'), 'Data below oversized headings must be exported');
    assert.ok(fullText.includes('Full column headings'), 'Short repeated headers must identify their full descriptions');
    checkBounds();
    if (pdfSettings.stapleEdge === 'left') save('long-header-fixed-a5');
    cases++;
  }

  for (const pdfSettings of [{ pageSize: 'letter' }, { pageSize: 'a5', stapleEdge: 'left' }]) {
    for (let lines = 15; lines <= 36; lines++) {
      const result = Array.from({ length: lines }, (_, index) => 'Observation ' + index + ': sample remains clear.').join('\n');
      assert.equal(await exportNotebookEntryPdf({ entry: { ...base, result, toolCalculations: [tool] }, protocol, pdfSettings }), true);
      const group = latest.draws.find(draw => draw.text === 'Tool Calculation');
      const title = latest.draws.find(draw => draw.text === 'Buffer Preparer');
      const metadata = latest.draws.find(draw => draw.text === 'Volume: 100 mL | pH: 7.4');
      const header = latest.draws.find(draw => draw.text === 'MW');
      assert.ok(header, 'Tool table header must be present');
      const firstRow = latest.draws.find(draw => draw.text === 'NaCl');
      for (const draw of [group, title, metadata, firstRow]) {
        assert.ok(draw, 'Tool section must retain its heading, metadata and first row');
        assert.equal(draw.page, header.page, 'Tool headings and metadata must share the first table page');
      }
      checkBounds();
      if (lines === 26 && pdfSettings.pageSize === 'letter') save('tool-heading-fixed');
      cases++;
    }
  }
  console.log('Notebook PDF pagination selfcheck passed: ' + cases + ' real exports, full long headings and tool boundary placement.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
