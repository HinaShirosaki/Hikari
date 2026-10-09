const assert = require('node:assert/strict');
const path = require('node:path');
const {
  createMockDocument,
  flushAsync,
  loadEsmStyleModule,
  trigger
} = require('./support/runtime.js');

const ids = [
  'biology-notebook-quick-sample-overlay',
  'biology-notebook-quick-sample-form',
  'biology-notebook-quick-sample-close-btn',
  'biology-notebook-quick-sample-cancel-btn',
  'biology-notebook-quick-sample-location-list',
  'biology-notebook-quick-sample-container',
  'biology-notebook-quick-sample-grid',
  'biology-notebook-quick-sample-grid-label',
  'biology-notebook-quick-sample-name',
  'biology-notebook-quick-sample-code',
  'biology-notebook-quick-sample-type',
  'biology-notebook-quick-sample-lot',
  'biology-notebook-quick-sample-concentration',
  'biology-notebook-quick-sample-status',
  'biology-notebook-quick-sample-submit-btn'
];
const document = createMockDocument(ids);
const overlay = document.getElementById('biology-notebook-quick-sample-overlay');
overlay.hidden = true;
const state = {
  settings: {},
  notebookEntries: [{ id: 'note-1', notebookType: 'biology', sampleLinks: [] }],
  inventory: {
    '-20 Degree': [{
      id: 'box-1',
      name: 'Cloning Box',
      type: 'box25',
      wells: Array.from({ length: 25 }, (_item, index) => ({ name: `W${index + 1}`, content: '' }))
    }]
  },
  samples: [{
    id: 'existing',
    code: 'S-OLD',
    name: 'Existing sample',
    type: 'plasmid',
    inventoryLink: { section: '-20 Degree', containerId: 'box-1', wellIndex: 0 }
  }]
};
let createdPayload = null;
const quickSampleModule = loadEsmStyleModule(path.join(
  __dirname,
  '..',
  'src',
  'renderer',
  'modules',
  'biology-notebook',
  'samples',
  'quick-sample-controller.js'
));
const controller = quickSampleModule.createNotebookQuickSampleController({
  doc: document,
  state,
  safeText: (value) => String(value || '').replace(/[&<>"]/g, ''),
  createId: () => 'quick-sample-1',
  ensureEntry: async () => state.notebookEntries[0],
  onCreated: async (payload) => {
    createdPayload = payload;
  }
});

(async () => {
  controller.open();
  assert.equal(overlay.hidden, false);
  assert.equal(document.getElementById('biology-notebook-quick-sample-container').value, '-20 Degree::box-1');
  assert.match(document.getElementById('biology-notebook-quick-sample-location-list').innerHTML, /data-quick-sample-location="-20 Degree"[^>]*aria-selected="true"/);
  assert.equal(document.getElementById('biology-notebook-quick-sample-grid-label').textContent, 'Cloning Box · W2');
  assert.equal((document.getElementById('biology-notebook-quick-sample-grid').innerHTML.match(/data-quick-sample-well=/g) || []).length, 25);
  assert.match(document.getElementById('biology-notebook-quick-sample-grid').innerHTML, /is-occupied/);

  const locationTarget = (locationName) => ({
    dataset: { quickSampleLocation: locationName },
    closest(selector) {
      return selector === '[data-quick-sample-location]' ? this : null;
    }
  });
  trigger(document.getElementById('biology-notebook-quick-sample-location-list'), 'click', { target: locationTarget('Room Temp') });
  assert.equal(document.getElementById('biology-notebook-quick-sample-container').value, '');
  assert.equal(document.getElementById('biology-notebook-quick-sample-grid-label').textContent, 'Choose a container');
  document.getElementById('biology-notebook-quick-sample-name').value = 'Homeless sample';
  assert.equal(await controller.submit(), null, 'a sample needs a container');
  assert.equal(state.samples.length, 1);
  trigger(document.getElementById('biology-notebook-quick-sample-location-list'), 'click', { target: locationTarget('-20 Degree') });
  assert.equal(document.getElementById('biology-notebook-quick-sample-container').value, '-20 Degree::box-1');
  assert.equal(document.getElementById('biology-notebook-quick-sample-grid-label').textContent, 'Cloning Box · W2');

  const wellTarget = {
    dataset: { quickSampleWell: '4' },
    closest(selector) {
      return selector === '[data-quick-sample-well]' ? this : null;
    }
  };
  trigger(document.getElementById('biology-notebook-quick-sample-grid'), 'click', { target: wellTarget });
  assert.equal(document.getElementById('biology-notebook-quick-sample-grid-label').textContent, 'Cloning Box · W5');

  document.getElementById('biology-notebook-quick-sample-name').value = 'Notebook plasmid';
  document.getElementById('biology-notebook-quick-sample-code').value = 'NB-PLASMID-1';
  document.getElementById('biology-notebook-quick-sample-type').value = 'plasmid';
  document.getElementById('biology-notebook-quick-sample-lot').value = 'LOT-7';
  document.getElementById('biology-notebook-quick-sample-concentration').value = '80 ng/uL';
  trigger(document.getElementById('biology-notebook-quick-sample-form'), 'submit');
  await flushAsync();
  await flushAsync();

  assert.equal(state.samples.length, 2);
  assert.equal(state.samples[1].id, 'quick-sample-1');
  assert.equal(state.samples[1].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[1].inventoryLink.containerId, 'box-1');
  assert.equal(state.samples[1].inventoryLink.wellIndex, 4);
  assert.equal(state.samples[1].location.position, 'W5');
  assert.equal(createdPayload.sampleLink.source, 'notebook-quick-add');
  assert.equal(createdPayload.sampleLink.sampleCode, 'NB-PLASMID-1');
  assert.match(createdPayload.note, /Saved sample NB-PLASMID-1 - Notebook plasmid/);
  assert.equal(overlay.hidden, true);
  console.log('notebook quick sample selfcheck OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
