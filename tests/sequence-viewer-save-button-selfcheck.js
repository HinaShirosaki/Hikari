const assert = require('node:assert/strict');
const path = require('node:path');
const {
  createMockDocument,
  flushAsync,
  loadEsmStyleModule,
  trigger
} = require('./support/runtime.js');

const ids = [
  'sequence-viewer-home-workspace',
  'sequence-viewer-detail-workspace',
  'sequence-viewer-home-status',
  'sequence-viewer-library-filter-saved',
  'sequence-viewer-library-filter-temporary',
  'sequence-viewer-library-list',
  'sequence-viewer-preview-host',
  'sequence-viewer-home-paste-btn',
  'sequence-viewer-home-open-btn',
  'sequence-viewer-home-open-input',
  'sequence-viewer-form',
  'sequence-viewer-mode-paste',
  'sequence-viewer-mode-file',
  'sequence-viewer-paste-panel',
  'sequence-viewer-file-panel',
  'sequence-viewer-textarea',
  'sequence-viewer-file-input',
  'sequence-viewer-file-choose',
  'sequence-viewer-file-name',
  'sequence-viewer-load-btn',
  'sequence-viewer-save-btn',
  'sequence-viewer-annotate-btn',
  'sequence-viewer-status',
  'sequence-viewer-messages',
  'sequence-viewer-record-select',
  'sequence-viewer-stat-format',
  'sequence-viewer-stat-length',
  'sequence-viewer-stat-topology',
  'sequence-viewer-stat-gc',
  'sequence-viewer-stat-ambiguous',
  'sequence-viewer-stat-quality',
  'sequence-viewer-stat-features',
  'sequence-viewer-stat-restriction-sites',
  'sequence-viewer-feature-rail-host',
  'sequence-viewer-feature-detail',
  'sequence-viewer-sequence-host'
];

const upsertCalls = [];
const document = createMockDocument(ids);
const window = {
  hikariApi: {
    sequenceLibraryList: async () => ({ ok: true, entries: [] }),
    sequenceLibraryUpsert: async (payload) => {
      upsertCalls.push(payload);
      return { ok: true, entry: { id: 'entry_saved', name: payload.name, status: payload.status } };
    }
  }
};
const localStorage = {
  getItem(key) {
    return key === 'hikari_state_v1'
      ? JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } })
      : null;
  }
};

async function main() {
  const viewer = loadEsmStyleModule(
    path.join(__dirname, '..', 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  viewer.initSequenceViewer();

  const saveBtn = document.getElementById('sequence-viewer-save-btn');
  assert.equal(Boolean(saveBtn.hidden), true, 'Save stays hidden with no record loaded');

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  document.getElementById('sequence-viewer-textarea').value = '>seq1\nACGTACGTAC\n';
  trigger(document.getElementById('sequence-viewer-form'), 'submit');
  await flushAsync();

  assert.equal(Boolean(saveBtn.hidden), false, 'Save shows for an unsaved record');

  trigger(saveBtn, 'click');
  await flushAsync();

  assert.equal(upsertCalls.length, 1, 'Save persists the record once');
  assert.equal(upsertCalls[0].status, 'saved', 'Save persists with saved status');
  assert.equal(Boolean(saveBtn.hidden), true, 'Save hides once the record is saved');

  console.log('sequence-viewer-save-button-selfcheck: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
