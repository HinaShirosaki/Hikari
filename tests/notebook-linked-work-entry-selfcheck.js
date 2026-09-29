// Add samples / Add assay auto-save a page only when the viewer is showing one.
// On the project dashboard the protocol dropdown still holds the last protocol,
// so an ungated save minted a stray page (and left the rail highlighting it).
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMockDocument, flushAsync, loadEsmStyleModule, trigger } = require('./support/runtime.js');

const document = createMockDocument([]);
const assayCalls = [];
const gelCalls = [];
document.getElementById('biology-notebook-quick-sample-overlay').hidden = true;

const state = {
  projects: [{ id: 'p1', name: 'Atlas' }],
  protocols: [{ id: 'pr1', name: 'Viability Assay', steps: [{ id: 's1', text: 'Measure viability.', placeholders: [] }] }],
  notebookEntries: [{
    id: 'n1',
    notebookType: 'biology',
    projectId: 'p1',
    projectName: 'Atlas',
    protocolId: 'pr1',
    protocolName: 'Viability Assay',
    experimentName: 'Page One',
    values: {},
    result: '',
    resultFiles: [],
    resultFileRecords: [],
    sampleLinks: [],
    updatedAt: '2026-03-20T00:00:00.000Z',
    notebookState: 'planned'
  }],
  samples: [],
  inventory: {
    '-20 Degree': [{
      id: 'box-1',
      name: 'Cloning Box',
      type: 'box25',
      wells: Array.from({ length: 25 }, (_item, index) => ({ name: `W${index + 1}`, content: '' }))
    }]
  },
  assays: [],
  settings: { storagePath: '' }
};

const notebookModule = loadEsmStyleModule(
  path.join(__dirname, '..', 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'),
  { document, window: { hikariApi: {}, addEventListener() {} } }
);

const notebook = notebookModule.initLabNotebook({
  state,
  persist: () => {},
  createId: (() => { let index = 0; return () => `new-${index += 1}`; })(),
  safeText: (value) => String(value == null ? '' : value).replace(/[&<>"]/g, ''),
  notebookType: 'biology',
  onCreateLinkedAssay: (payload) => assayCalls.push(payload),
  onCreateLinkedGel: (payload) => gelCalls.push(payload),
  onNotebookEntriesChanged: () => {}
});

const rail = document.getElementById('biology-notebook-entry-list');
const activeRows = () => (
  rail.innerHTML.match(/class="[^"]*biology-notebook-page-row[^"]*\bis-active\b[^"]*"/g) || []
).length;

function addSample(name) {
  trigger(document.getElementById('biology-notebook-add-samples-btn'), 'click');
  document.getElementById('biology-notebook-quick-sample-name').value = name;
  trigger(document.getElementById('biology-notebook-quick-sample-form'), 'submit');
  return flushAsync();
}

(async () => {
  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  trigger(rail, 'click', { target: { dataset: { notebookEntryId: 'n1' } } });
  await flushAsync();
  trigger(document.getElementById('biology-notebook-add-assay-btn'), 'click');
  trigger(document.getElementById('biology-notebook-add-gel-btn'), 'click');
  await flushAsync();
  assert.equal(assayCalls[0].notebookEntryId, 'n1');
  assert.equal(assayCalls[0].projectId, 'p1');
  assert.equal(gelCalls[0].notebookEntryId, 'n1');
  state.assays.push({ id: 'a1', notebookEntryId: 'n1', name: 'Attached assay' });
  state.settings.pluginStorage = { gel: { gelAnalyses: [
    { id: 'g1', notebookEntryId: 'n1', name: 'Attached gel' }
  ] } };
  await notebook.renderLinkedPreviews();
  assert.match(document.getElementById('biology-notebook-linked-results').innerHTML, /Attached assay/);
  assert.match(document.getElementById('biology-notebook-linked-results').innerHTML, /Attached gel/);
  await addSample('Plasmid A');
  assert.equal(state.samples.length, 1);
  assert.equal(state.notebookEntries.length, 1, 'an open page takes the sample without creating another page');
  assert.equal(activeRows(), 1);

  trigger(rail, 'click', { target: { dataset: { notebookProjectId: 'p1', notebookProjectName: 'Atlas' } } });
  await flushAsync();
  assert.equal(document.getElementById('biology-notebook-protocol-area').hidden, true);
  assert.equal(activeRows(), 0);

  trigger(document.getElementById('biology-notebook-add-assay-btn'), 'click');
  trigger(document.getElementById('biology-notebook-add-gel-btn'), 'click');
  await flushAsync();
  assert.equal(assayCalls.length, 1);
  assert.equal(gelCalls.length, 1);

  await addSample('Plasmid B');
  assert.equal(state.notebookEntries.length, 1, 'the project dashboard must not mint a stray page');
  assert.equal(state.samples.length, 1, 'no sample is stored without a page to link it to');
  assert.equal(activeRows(), 0, 'the rail keeps highlighting the dashboard, not a page');
  assert.match(
    document.getElementById('biology-notebook-quick-sample-status').textContent,
    /Open a notebook page/
  );

  console.log('notebook linked work entry selfcheck OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
