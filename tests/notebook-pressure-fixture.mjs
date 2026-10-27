// Fictional records in the real notebook UI; desktop storage stays in memory.
import { initLabNotebook } from '../src/renderer/modules/biology-notebook/index.js';
import { defaultState } from '../src/renderer/modules/app-state/index.js';
import { applyAppearanceToDocument } from '../src/renderer/app/appearance.js';
import { buildSerialDilutionGroups, buildSerialDilutionSummaryModel } from '../src/renderer/modules/assay/serial-dilution-model.js';
import { exportNotebookEntryPdf, exportProjectNotebookEntriesPdf } from '../src/renderer/modules/pdf-export/index.js';
import { calculateBufferRecipe } from '../src/renderer/lib/bench-calculations.js';
import { buildBufferCalculationTable } from '../src/renderer/lib/notebook-tool-calculations.js';

const check = (value, message) => { if (!value) throw new Error(message); };
const el = id => document.getElementById('biology-notebook-' + id);
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const input = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event('input', { bubbles: true })); };
const safeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const state = structuredClone(defaultState);
Object.assign(state, { projects: [{ id: 'pressure', name: 'Notebook pressure test', description: 'Fictional mixed-content export fixture.' }], protocols: [], notebookEntries: [], assays: [], gelAnalyses: [], workflows: [], samples: [], papers: [] });
state.settings.storagePath = '/pressure-fixture';
state.settings.plugins = [];
const protocol = { id: 'protocol', name: 'Mixed content notebook', steps: [
  { text: 'Prepare {{ph:protein}} in {{ph:buffer}}.', placeholders: [{ id: 'protein', name: 'Protein' }, { id: 'buffer', name: 'Buffer' }] },
  { text: 'Dilute to {{ph:concentration}} and incubate for 30 min at 4 °C.', placeholders: [{ id: 'concentration', name: 'Concentration' }] },
  { text: 'Record the reaction, collect the gel image, and compare the assay dilution series.', placeholders: [] }
] };
state.protocols.push(protocol);
state.inventory['-80 Degree'] = [{ id: 'box', name: 'Protein box', type: 'box25', wells: [{ name: 'A1' }] }];
state.samples.push({ id: 'protein', code: 'PR-001', name: 'Model protein alpha', type: 'protein', inventoryLink: { section: '-80 Degree', containerId: 'box', wellIndex: 0 } });
let serial = 0;
const files = new Map();
const pdfWrites = [];
const reports = [];
let exportLabel = 'mixed-letter';
let persists = 0;
let storageSnapshot = null;
const persist = () => { persists++; storageSnapshot = JSON.parse(JSON.stringify(state)); };
window.hikariApi = {
  ensureStorageDirectory: async () => ({ ok: true }),
  storeImportedFile: async ({ targetFolder, fileName, dataBase64 }) => {
    if (fileName === 'failed-import.txt') return { ok: false, error: 'Pressure fixture: simulated import failure.' };
    const filePath = targetFolder + '/' + fileName;
    files.set(filePath, dataBase64);
    return { ok: true, fileName, filePath };
  },
  readFileBase64: async filePath => files.has(filePath) ? { ok: true, dataBase64: files.get(filePath) } : { ok: false },
  listPaperFindingTasks: async () => ({ ok: true, tasks: [] })
};

const RealJsPdf = window.jspdf.jsPDF;
window.jspdf.jsPDF = function (...args) {
  const doc = new RealJsPdf(...args);
  const draws = [];
  const originalText = doc.text;
  doc.text = (text, x, y, options = {}) => {
    for (const [index, part] of (Array.isArray(text) ? text : [text]).entries()) {
      const width = doc.getTextWidth(String(part));
      const left = x - (options.align === 'right' ? width : options.align === 'center' ? width / 2 : 0);
      draws.push({ text: String(part), x: left, y: y + index * doc.getFontSize() * 1.15, width, size: doc.getFontSize(), page: doc.internal.getCurrentPageInfo().pageNumber, pageWidth: doc.internal.pageSize.getWidth(), pageHeight: doc.internal.pageSize.getHeight() });
    }
    return originalText.call(doc, text, x, y, options);
  };
  doc.save = () => {
    reports.push({ label: exportLabel, pages: doc.internal.getNumberOfPages(), draws });
    pdfWrites.push(window.pressureApi.qaSavePdf(exportLabel, Array.from(new Uint8Array(doc.output('arraybuffer')))));
  };
  return doc;
};

function figure(width, height, title, plot = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
  ctx.strokeRect(32, 32, width - 64, height - 64);
  ctx.fillStyle = '#172554'; ctx.font = Math.max(18, Math.min(width, height) / 16) + 'px Arial';
  ctx.fillText(title, 50, 85, width - 90);
  if (plot) {
    ctx.beginPath(); ctx.moveTo(90, 140); ctx.lineTo(90, height - 70); ctx.lineTo(width - 60, height - 70); ctx.stroke();
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 6; ctx.beginPath();
    for (let i = 0; i <= 50; i++) { const x = 100 + i * (width - 190) / 50; const y = height - 95 - (height - 240) / (1 + Math.exp(-(i - 25) / 5)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#475569';
    for (let i = 0; i < 7; i++) ctx.fillRect(70 + i * (width - 140) / 7, height * (0.3 + (i % 3) * 0.16), Math.max(5, (width - 140) / 10), 10);
  }
  return canvas.toDataURL('image/png');
}

function table(columnCount, rowCount) {
  const columns = Array.from({ length: columnCount }, (_, i) => ({ field: 'c' + i, title: i === 0 ? 'Sample condition' : 'Measurement ' + i }));
  const rows = Array.from({ length: rowCount }, (_, r) => Object.fromEntries([['id', 'row' + r], ...columns.map((c, i) => [c.field, i === 0 ? 'Clone ' + (r + 1) : String(((r + 1) * (i + 2) / 7).toFixed(3))])]));
  return { columns, rows };
}

function assayFor(rows, columns, entryId = '') {
  const types = { 6: '6', 12: '12', 24: '24', 48: '48', 96: '96', 384: '384', 1536: '1536' };
  const rowName = index => index < 26 ? String.fromCharCode(65 + index) : 'A' + String.fromCharCode(65 + index - 26);
  const wellLayout = Array.from({ length: rows * columns }, (_, i) => ({ well: rowName(Math.floor(i / columns)) + (i % columns + 1), sampleId: 'Protein-' + (Math.floor(i / columns) + 1), concentration: (100 / 2 ** (i % columns)).toPrecision(3) + ' uM' }));
  const groups = buildSerialDilutionGroups({ layout: wellLayout, sampleAxis: 'row', concentrationUnit: 'uM', findInventorySampleRecordBySampleId: () => null });
  const serialDilutionSummary = buildSerialDilutionSummaryModel({ groups, sampleAxis: 'row', volumePerWellUl: 100, concentrationUnit: 'uM', getSerialDilutionStockValue: () => '10 mM' });
  return { id: 'assay-' + rows * columns, notebookEntryId: entryId, name: 'Protein dose response', assayNumber: 'ASSAY-027', plateType: types[rows * columns], plateRows: rows, plateColumns: columns, plateLabel: rows * columns + ' well', sampleAxis: 'row', concentrationAxis: 'column', wellLayout, serialDilutionSummary, updatedAt: '2026-10-27T16:00:00Z', latestAnalysis: { method: 'dose_response', summary: 'Fictional response, R2 = 0.998.', chartDataUrl: figure(1200, 650, 'Dose response - fictional fixture', true) } };
}

applyAppearanceToDocument({ mode: 'day', fontSize: 16 });
const notebook = initLabNotebook({ state, persist, createId: () => 'qa-' + (++serial), safeText,
  onNotebookEntriesChanged() {},
  onCreateLinkedAssay: ({ notebookEntryId }) => { state.assays.push(assayFor(8, 12, notebookEntryId)); },
  onCreateLinkedGel: ({ notebookEntryId }) => { state.gelAnalyses.push({ id: 'gel', notebookEntryId, name: 'Purification gel', analysisType: 'gel', updatedAt: '2026-10-27T16:00:00Z', previewImageDataUrl: figure(1000, 420, 'Purification gel - fictional fixture') }); }
});

async function run() {
  notebook.renderProjectOptions(); notebook.renderProtocolOptions('protocol');
  el('project-select').value = 'pressure'; el('protocol-select').value = 'protocol'; notebook.onProtocolChange();
  el('result').value = 'Initial observation: clear sample. Concentration 10 µM; recovery >= 90%.\nSecond line: check alpha/beta response at 4 °C.';
  const hidden = document.querySelector('[data-nb-key="buffer"]'); hidden.value = 'PBS';
  const concentration = document.querySelector('[data-nb-key="concentration"]'); concentration.value = '10 µM';
  const proteinWrap = document.querySelector('[data-placeholder-name="Protein"]');
  proteinWrap.querySelector('[data-inline-token]').click();
  const editor = proteinWrap.querySelector('[data-inline-input]'); editor.value = 'PR-001'; editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(el('result').value.includes('-80 Degree / Protein box / A1'), 'Placeholder selection appends the sample location');
  const draftAppends = await Promise.all([1, 2].map(i => notebook.appendAgentNotebookContent({ proposal_id: 'draft-' + i, content_markdown: 'Draft append ' + i + ': notebook append queue.' })));
  check(draftAppends.every(item => item.ok), 'Draft appends succeed');
  check(await notebook.saveUnsavedChanges(), 'Initial save succeeds');
  const entryId = state.notebookEntries[0].id;
  const appends = await Promise.all([1, 2, 3].map(i => notebook.appendAgentNotebookContent({ proposal_id: 'append-' + i, notebook_entry_id: entryId, section_title: 'Observation ' + i, content_markdown: 'Saved append ' + i + ': independent observation. Keep all previous content.' })));
  check(appends.every(item => item.ok), 'Overlapping saved appends all succeed');
  await notebook.appendAgentNotebookContent({ proposal_id: 'append-1', notebook_entry_id: entryId, content_markdown: 'Saved append 1: independent observation.' });
  check((el('result').value.match(/Saved append 1:/g) || []).length === 1, 'Duplicate append is idempotent');

  el('tool-fold-toggle').click(); el('tool-tab-buffer').click();
  input('tool-buffer-volume', '100'); input('tool-buffer-volume-unit', 'mL');
  input('tool-buffer-name-1', 'NaCl'); input('tool-buffer-mw-1', '58.44'); input('tool-buffer-final-1', '150 mM'); input('tool-buffer-note-1', 'Lot 22B - verified balance');
  input('tool-buffer-name-2', 'Tris'); input('tool-buffer-mw-2', '121.14'); input('tool-buffer-final-2', '20 mM');
  el('tool-tab-reaction').click();
  input('tool-reaction-total-volume', '100 uL'); input('tool-reaction-fill-name', 'Water');
  input('tool-reaction-name-1', 'ATP'); input('tool-reaction-stock-1', '10 mM'); input('tool-reaction-final-1', '1 mM'); input('tool-reaction-note-1', 'Tube A7');
  el('tool-tab-reaction').click();
  el('add-molarity-btn').click(); await pause();
  const grid = window.Tabulator.findTable(document.querySelector('.spreadsheet-table'))[0];
  const columns = grid.getColumns().map(c => c.getField()).filter(Boolean);
  const first = grid.getData()[0];
  await grid.updateData([{ id: first.id, [columns[0]]: 'NaCl', [columns[1]]: '58.44', [columns[2]]: '584.4', [columns[3]]: '100' }]);

  const transfer = new DataTransfer();
  transfer.items.add(new File([await (await fetch(figure(900, 300, 'Wide attachment - lane labels'))).blob()], 'gel-wide.png', { type: 'image/png' }));
  transfer.items.add(new File([await (await fetch(figure(650, 1600, 'Tall scan - sample record'))).blob()], 'scan-tall.png', { type: 'image/png' }));
  transfer.items.add(new File(['well,value\nA1,0.82\nA2,0.66'], 'assay-raw-results.csv', { type: 'text/csv' }));
  transfer.items.add(new File(['%PDF-1.4\nFixture filename only'], 'instrument-report.pdf', { type: 'application/pdf' }));
  el('result-file').files = transfer.files; el('result-file').dispatchEvent(new Event('change', { bubbles: true }));
  check(await notebook.saveUnsavedChanges(), 'Mixed tools/tables/files save');
  el('add-assay-btn').click(); await pause(); el('add-gel-btn').click(); await pause();
  await notebook.renderLinkedPreviews(state.notebookEntries[0]); await pause();
  notebook.openEntry(entryId); await pause();
  const mixed = state.notebookEntries[0];
  check(mixed.toolCalculations.length === 2, 'Both notebook tools survive reopening');
  check(mixed.resultFiles.length === 4 && mixed.resultFileRecords.length === 4, 'Four files survive reopening');
  check(mixed.resultTables.length === 1, 'Molarity table survives reopening');
  check(document.querySelectorAll('.biology-notebook-attachment img').length === 2, 'Both image attachments render');
  check(el('linked-results').textContent.includes('Serial Dilution'), 'Assay and dilution plan render');
  check(el('linked-results').textContent.includes('Purification gel'), 'Gel preview renders');
  check(storageSnapshot.notebookEntries[0].result.includes('Saved append 3'), 'Appended notes persisted');
  await notebook.saveUnsavedChanges();
  exportLabel = 'mixed-letter'; el('export-btn').click();
  for (let i = 0; i < 50 && !reports.some(r => r.label === exportLabel); i++) await pause();
  check(reports.some(r => r.label === exportLabel), 'Export button produces the mixed page PDF');
  const fixture = { entry: mixed, protocol, linkedAssay: state.assays[0], linkedGel: state.gelAnalyses[0], linkedGelPreviewImage: state.gelAnalyses[0].previewImageDataUrl, resultFileImages: mixed.resultFileRecords.filter(r => r.mimeType.startsWith('image/')).map(r => ({ name: r.name, dataUrl: 'data:' + r.mimeType + ';base64,' + files.get(r.path) })) };
  for (const [label, pdfSettings] of [['mixed-a4', { pageSize: 'a4', stapleEdge: 'top' }], ['mixed-a5', { pageSize: 'a5', stapleEdge: 'left' }], ['mixed-legal', { pageSize: 'legal' }]]) {
    exportLabel = label; check(await exportNotebookEntryPdf({ ...fixture, pdfSettings }), label + ' exports');
  }
  const base = { ...mixed, result: 'Pressure fixture: every record must stay within the page.', toolCalculations: [], resultFiles: [], resultFileRecords: [], resultTables: [], resultTable: null };
  const tall = table(3, 3); tall.rows[1].c1 = Array.from({ length: 160 }, (_, i) => 'Line ' + i + ': long cell content that must continue on the next PDF page.').join('\n');
  const wide = table(24, 10);
  const longNotes = Array.from({ length: 70 }, (_, i) => 'Append ' + i + ': Recorded sample quality and transfer volumes. Keep this observation together with its supporting results and preserve every line.').join('\n\n');
  const markdownNotes = '## Appended measurements\n\n- Recovery >= 90%\n- Incubation at 4 °C\n\n| Sample | Concentration | Note |\n| --- | --- | --- |\n| Clone A | 10 µM | Clear |\n| Clone B | 5 µM | Repeat |\n\nFinal observation: all rows are retained.';
  for (const [label, entry] of [['long-cell', { ...base, resultTables: [tall] }], ['wide-table', { ...base, resultTables: [wide] }], ['long-notes', { ...base, result: longNotes }], ['markdown-append', { ...base, result: markdownNotes }], ['many-rows', { ...base, resultTables: [table(8, 120)] }], ['long-title-a5', { ...base, experimentName: 'Very long notebook page title '.repeat(8), projectName: 'Long project name '.repeat(7) }]]) {
    exportLabel = label; check(await exportNotebookEntryPdf({ entry, protocol, pdfSettings: label.includes('a5') ? { pageSize: 'a5', stapleEdge: 'top' } : {} }), label + ' exports');
  }
  for (const [rows, columns] of [[2, 3], [3, 4], [4, 6], [6, 8], [8, 12], [16, 24], [32, 48]]) {
    exportLabel = 'plate-' + rows * columns;
    check(await exportNotebookEntryPdf({ entry: base, protocol, linkedAssay: { ...assayFor(rows, columns), serialDilutionSummary: null, latestAnalysis: null } }), exportLabel + ' exports');
  }
  exportLabel = 'plate-irregular';
  check(await exportNotebookEntryPdf({ entry: base, protocol, linkedAssay: { ...assayFor(16, 24), serialDilutionSummary: null, latestAnalysis: null,
    wellLayout: [{ well: 'A1', sampleId: 'Long sample identity that must remain readable', concentration: '100 uM' }, { well: 'P24', sampleId: 'Last well marker', concentration: '0.25 nM' }] } }), 'Irregular sparse plate exports');
  const bufferResult = calculateBufferRecipe({ volumeValue: '100', volumeUnit: 'mL', rows: Array.from({ length: 32 }, (_, index) => ({ rowIndex: index + 1, name: 'Ingredient ' + (index + 1), molecularWeight: '58.44', finalConcentration: '1 mM', stockConcentration: '', note: 'Lot ' + (index + 1) + ' - sample source and balance record.' })) });
  exportLabel = 'tool-stress';
  check(await exportNotebookEntryPdf({ entry: { ...base, toolCalculations: [{ id: 'buffer-stress', type: 'buffer', mode: 'recipe', title: '32 ingredient buffer recipe', inputs: bufferResult.inputs, result: bufferResult.resultText, table: buildBufferCalculationTable(bufferResult) }] }, protocol }), 'Long tool recipe exports');
  const oversizedHeader = table(3, 1);
  oversizedHeader.columns[1].title = 'Scientific measurement with a detailed descriptive heading '.repeat(35) + 'LAST_HEADER_WORD';
  exportLabel = 'oversized-header-a5';
  check(await exportNotebookEntryPdf({ entry: { ...base, resultTables: [oversizedHeader] }, protocol, pdfSettings: { pageSize: 'a5', stapleEdge: 'left' } }), 'Oversized header completes without losing its full title');
  exportLabel = 'tool-heading-boundary';
  check(await exportNotebookEntryPdf({ entry: { ...base, result: Array.from({ length: 26 }, (_, i) => 'Observation ' + i + ': sample remains clear.').join('\n'), toolCalculations: [mixed.toolCalculations[0]] },
    protocol: { steps: [{ text: 'Record the sample measurements.', placeholders: [] }] } }), 'Tool at a page boundary exports');
  exportLabel = 'project-bundle';
  check(await exportProjectNotebookEntriesPdf({ project: state.projects[0], entries: [mixed, { ...base, id: 'followup', experimentName: 'Follow-up notes', result: longNotes.slice(0, 1000) }], protocolsByEntryId: new Map([[mixed.id, protocol], ['followup', protocol]]), linkedAssayByEntryId: new Map([[mixed.id, state.assays[0]]]), resultFileImagesByEntryId: new Map([[mixed.id, fixture.resultFileImages]]) }), 'Project bundle exports');
  const appended = await notebook.appendAgentNotebookContent({ proposal_id: 'after-mixed', notebook_entry_id: entryId, content_markdown: markdownNotes });
  check(appended.ok && appended.saved, 'Structured notes append after tools, files and linked results');
  notebook.openEntry(entryId); await pause();
  const reopened = state.notebookEntries[0];
  check(reopened.result.includes('Clone B') && reopened.toolCalculations.length === 2 && reopened.resultFiles.length === 4 && reopened.resultTables.length === 1 && reopened.sampleLinks.length === 1, 'Appending preserves every other notebook content type');
  check(state.assays[0].notebookEntryId === entryId && state.gelAnalyses[0].notebookEntryId === entryId, 'Appending preserves assay and gel links');
  const failedTransfer = new DataTransfer(); failedTransfer.items.add(new File(['Failure fixture'], 'failed-import.txt', { type: 'text/plain' }));
  el('result-file').files = failedTransfer.files;
  const beforeFailure = JSON.stringify(state.notebookEntries[0]);
  check(!await notebook.saveUnsavedChanges(), 'Failed file import aborts the save');
  check(JSON.stringify(state.notebookEntries[0]) === beforeFailure, 'Failed import preserves saved notes, files, tables and tools');
  el('result-file').value = ''; el('result-file').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-hikari-transient-toast]').hidden = true;
  el('tool-collapse-btn').click();
  state.notebookEntries.push({ ...base, id: 'wide-ui', experimentName: 'Wide sheet and long text', resultTables: [wide] });
  state.notebookEntries.push({ ...base, id: 'many-ui', experimentName: '120 measurement rows', resultTables: [table(8, 120)] });
  await Promise.all(pdfWrites);
  window.pressure = { notebook, state, reports, mixedId: entryId, table, pause };
  return { persists, appends: 6, files: mixed.resultFiles.length, tools: mixed.toolCalculations.length, reports };
}

window.pressureRun = run;
window.pressureReady = true;
