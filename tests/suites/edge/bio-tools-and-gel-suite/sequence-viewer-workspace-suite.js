module.exports = function registerEdgeSequenceViewerWorkspaceSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer initializes home workspace and keeps detail workspace hidden by default', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const openBtn = document.getElementById('sequence-viewer-home-open-btn');
  const homeStatus = document.getElementById('sequence-viewer-home-status');

  assert.equal(Boolean(homeWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(Boolean(openBtn.disabled), false);
  assert.match(homeStatus.textContent, /New or Open|Storage Folder Path|storage path|storage/i);
});

test('[EDGE] sequence-viewer loadFromExternal switches to detail workspace', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-home-import-btn',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-input',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-import-input',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'imported',
    sequence: 'ACGTACGTACGT',
    topology: 'circular',
    source: 'external',
    features: []
  });

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
});

test('[EDGE] sequence-viewer render sync returns to the home workspace when the home shell is reopened from detail', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer({
    homeViewId: 'sequence-viewer-view',
    detailViewId: 'sequence-viewer-detail-view'
  });
  viewer.loadFromExternal({
    name: 'imported',
    sequence: 'ACGTACGTACGT',
    topology: 'circular',
    source: 'external',
    features: []
  });

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);

  viewer.render({ activeViewId: 'sequence-viewer-view' });

  assert.equal(Boolean(homeWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
});

test('[EDGE] sequence-viewer render sync keeps Protein Builder visible inside the home shell', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-protein-builder-confirmation',
    'sequence-viewer-protein-builder-confirmation-summary',
    'sequence-viewer-protein-builder-confirmation-back-btn',
    'sequence-viewer-protein-builder-confirmation-confirm-btn',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-home-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer({
    homeViewId: 'sequence-viewer-view',
    detailViewId: 'sequence-viewer-detail-view'
  });
  viewer.loadFromExternal({
    name: 'imported',
    sequence: 'ACGTACGTACGT',
    topology: 'circular',
    source: 'external',
    features: []
  });

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');
  await flushAsync();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const builderWorkspace = document.getElementById('sequence-viewer-protein-builder-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(builderWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);

  viewer.render({ activeViewId: 'sequence-viewer-view' });

  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(builderWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
});

test('[EDGE] sequence-viewer home paste button opens detail workspace even with empty text', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-home-import-btn',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-input',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-import-input',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();
  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const status = document.getElementById('sequence-viewer-status');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.match(status.textContent, /Paste sequence text/i);
});

test('[EDGE] sequence-viewer New and Back actions use navigation callbacks', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-back-btn'
  ];
  const document = createMockDocument(ids);
  const transitions = [];
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer({
    onNavigateDetail: () => transitions.push('detail'),
    onNavigateHome: () => transitions.push('home')
  });

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  trigger(document.getElementById('sequence-viewer-back-btn'), 'click');
  assert.deepEqual(transitions, ['detail', 'home']);
});

test('[EDGE] sequence-viewer library native dblclick opens detail while single click only previews', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host'
  ];
  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 8,
    featureCount: 0,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const gbkText = `
LOCUS       ENTRYONE         8 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
ORIGIN
        1 acgtacgt
//
`;
  const document = createMockDocument(ids);
  const transitions = [];
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        if (payload?.includeGbk) {
          return { ok: true, entry, gbkText };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer({
    onNavigateDetail: () => transitions.push('detail')
  });
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  const eventTarget = {
    closest() {
      return { dataset: { sequenceEntryId: 'entry_1' } };
    }
  };

  trigger(libraryList, 'click', { target: eventTarget, detail: 1 });
  await flushAsync();
  assert.equal(transitions.length, 0);

  trigger(libraryList, 'dblclick', { target: eventTarget, detail: 2 });
  await flushAsync();
  await flushAsync();
  assert.equal(transitions.length, 1);
});

test('[EDGE] sequence-viewer library rows render only sequence names in the left rail', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host'
  ];
  const entry = {
    id: 'entry_1',
    name: 'pcDNA3.1-GFP_1-10_',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 6076,
    featureCount: 20,
    updatedAt: '2026-04-17T14:20:00.000Z'
  };
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] })
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  assert.match(libraryList.innerHTML, /sequence-viewer-library-item-name/);
  assert.match(libraryList.innerHTML, /pcDNA3\.1-GFP_1-10_/);
  assert.doesNotMatch(libraryList.innerHTML, /sequence-viewer-library-item-meta/);
  assert.doesNotMatch(libraryList.innerHTML, /6076|6,076|bp|features|updated/i);
});

test('[EDGE] sequence-viewer opens detail workspace when a library row is double-activated by quick repeated click', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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

  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 8,
    featureCount: 0,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const gbkText = `
LOCUS       ENTRYONE         8 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
ORIGIN
        1 acgtacgt
//
`;
  const getCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        getCalls.push(payload);
        if (payload?.includeGbk) {
          return { ok: true, entry, gbkText };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };

  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  const clickTarget = {
    closest() {
      return { dataset: { sequenceEntryId: 'entry_1' } };
    }
  };

  trigger(libraryList, 'click', { target: clickTarget });
  trigger(libraryList, 'click', { target: clickTarget });
  await flushAsync();
  await flushAsync();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(getCalls.some((payload) => Boolean(payload?.includeGbk)), true);
});

test('[EDGE] sequence-viewer hides input composer after successful load', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = '>seq1\nACGTACGT\n';
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');

  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');

  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(Boolean(loadBtn.hidden), true);
});

test('[EDGE] sequence-viewer importing GenBank with features stores a temporary library entry for feature indexing', async () => {
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
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const listCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async ({ status }) => {
        listCalls.push(status);
        return {
          ok: true,
          entries: status === 'temporary'
            ? [{
              id: 'entry_imported',
              name: 'Imported',
              status: 'temporary',
              topology: 'circular',
              sequenceLength: 12,
              featureCount: 1,
              updatedAt: '2026-01-01T00:00:00'
            }]
            : []
        };
      },
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_imported',
            name: payload.name || 'Imported',
            status: 'temporary'
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `
LOCUS       IMPORTED        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="shared_prom"
ORIGIN
        1 atgcgatttaaa
//
`;
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length, 1);
  assert.equal(Array.isArray(upsertCalls[0].features), true);
  assert.equal(upsertCalls[0].features.length, 1);
  assert.equal(upsertCalls[0].features[0].name, 'shared_prom');
  assert.equal(upsertCalls[0].sequence, 'ATGCGATTTAAA');
  assert.equal(upsertCalls[0].status, 'temporary');
  assert.equal(listCalls.includes('temporary'), true);
  assert.match(document.getElementById('sequence-viewer-library-list').innerHTML, /Imported/);
});

test('[EDGE] sequence-viewer importing a single GenBank record keeps it visible from the temporary library on return home', async () => {
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
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const listCalls = [];
  const upsertCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async ({ status }) => {
        listCalls.push(status);
        return {
          ok: true,
          entries: status === 'temporary'
            ? [{
              id: 'entry_plain_gbk',
              name: 'plain_gbk',
              status: 'temporary',
              topology: 'linear',
              sequenceLength: 12,
              featureCount: 0,
              updatedAt: '2026-01-01T00:00:00'
            }]
            : []
        };
      },
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_plain_gbk',
            name: payload.name || 'plain_gbk',
            status: 'temporary'
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `
LOCUS       PLAIN_GBK       12 bp    DNA     linear  SYN 01-JAN-2026
DEFINITION  plain_gbk.
ORIGIN
        1 atgcgatttaaa
//
`;
  trigger(document.getElementById('sequence-viewer-load-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].sequence, 'ATGCGATTTAAA');
  assert.equal(upsertCalls[0].status, 'temporary');
  assert.equal(listCalls.includes('temporary'), true);
  assert.match(document.getElementById('sequence-viewer-library-list').innerHTML, /plain_gbk/i);
});

test('[EDGE] sequence-viewer feature search can trace a stored feature back to its host vector', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-feature-search-input',
    'sequence-viewer-feature-search-btn',
    'sequence-viewer-feature-search-status',
    'sequence-viewer-feature-search-results',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const entry = {
    id: 'entry_1',
    name: 'Entry One',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 12,
    featureCount: 1,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const searchCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        if (payload?.includeGbk) {
          return {
            ok: true,
            entry,
            gbkText: `
LOCUS       ENTRYONE        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="shared_prom"
ORIGIN
        1 atgcgatttaaa
//
`
          };
        }
        return { ok: true, entry, htmlText: '<html><body>preview</body></html>' };
      },
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            {
              id: 'feature_1',
              name: 'shared_prom',
              type: 'promoter',
              sequence: 'ATGCGA',
              hostCount: 1,
              hosts: [
                {
                  hostVectorId: 'entry_1',
                  hostVectorName: 'Entry One',
                  hostVectorStatus: 'saved',
                  locations: [{ startPos: 1, endPos: 6, strand: 1 }]
                }
              ]
            }
          ]
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const searchInput = document.getElementById('sequence-viewer-feature-search-input');
  const searchResults = document.getElementById('sequence-viewer-feature-search-results');
  searchInput.value = 'shared_prom';
  trigger(document.getElementById('sequence-viewer-feature-search-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'shared_prom');
  assert.equal(searchResults.innerHTML.includes('shared_prom'), true);
  assert.equal(searchResults.innerHTML.includes('Entry One'), true);

  const clickTarget = {
    closest() {
      return { dataset: { featureHostEntryId: 'entry_1', featureHostStatus: 'saved' } };
    }
  };
  trigger(searchResults, 'click', { target: clickTarget });
  await flushAsync();
  await flushAsync();

  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(detailWorkspace.hidden), false);
});

test('[EDGE] sequence-viewer protein builder searches stored features and adds translated blocks to the chain', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-save-btn'
  ];
  const searchCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            {
              id: 'feature_protein_tag',
              name: 'stored_affinity_tag',
              type: 'cds',
              sequence: 'ATGGCCGAA',
              sequenceLength: 9,
              hostCount: 2,
              hosts: []
            }
          ]
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-home-protein-builder-btn'), 'click');
  assert.equal(Boolean(document.getElementById('sequence-viewer-protein-builder-workspace').hidden), false);

  const searchInput = document.getElementById('sequence-viewer-protein-builder-feature-search-input');
  searchInput.value = 'stored_affinity_tag';
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'stored_affinity_tag');
  assert.equal(document.getElementById('sequence-viewer-protein-builder-feature-search-results').innerHTML.includes('stored_affinity_tag'), true);

  const addFeatureTarget = {
    closest(selector) {
      if (selector === '[data-protein-builder-feature-add-id]') {
        return { dataset: { proteinBuilderFeatureAddId: 'feature_protein_tag' } };
      }
      return null;
    }
  };
  trigger(document.getElementById('sequence-viewer-protein-builder-feature-search-results'), 'click', { target: addFeatureTarget });
  await flushAsync();

  const workflowHtml = document.getElementById('sequence-viewer-protein-builder-workflow').innerHTML;
  const sequenceHtml = document.getElementById('sequence-viewer-protein-builder-sequence').innerHTML;
  assert.equal(workflowHtml.includes('stored_affinity_tag'), true);
  assert.equal(sequenceHtml.includes('MAE'), true);
});

test('[EDGE] sequence-viewer protein builder can build DNA and reuse POI DNA from the current vector', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-protein-builder-confirmation',
    'sequence-viewer-protein-builder-confirmation-summary',
    'sequence-viewer-protein-builder-confirmation-back-btn',
    'sequence-viewer-protein-builder-confirmation-confirm-btn',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'vector_with_poi',
    sequence: 'GGGATGTTATTATTACCC',
    topology: 'linear',
    source: 'external',
    features: [
      {
        id: 'poi_feature',
        name: 'PoiCds',
        type: 'cds',
        strand: 1,
        translation: 'MLLL',
        segments: [{ start: 3, end: 15 }]
      }
    ]
  });

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');

  const builderForm = document.getElementById('sequence-viewer-protein-builder-form');
  const poiInput = document.getElementById('sequence-viewer-protein-builder-poi-sequence');
  poiInput.value = 'MLLL';
  trigger(builderForm, 'input', { target: poiInput });
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-protein-builder-build-dna-btn'), 'click');
  await flushAsync();

  const dnaMeta = document.getElementById('sequence-viewer-protein-builder-dna-meta');
  const dnaSequence = document.getElementById('sequence-viewer-protein-builder-dna-sequence');
  const builderStatus = document.getElementById('sequence-viewer-protein-builder-status');

  assert.match(dnaMeta.textContent, /nt/);
  assert.equal(dnaSequence.innerHTML.includes('ATGTTATTATTA'), true);
  assert.match(builderStatus.textContent, /Reused POI DNA from current vector CDS PoiCds/i);
});

test('[EDGE] sequence-viewer protein builder can open an assembled plasmid from a stored backbone', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-assemble-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-protein-builder-assembly-overlay',
    'sequence-viewer-protein-builder-assembly-subtitle',
    'sequence-viewer-protein-builder-assembly-close-btn',
    'sequence-viewer-protein-builder-assembly-list',
    'sequence-viewer-protein-builder-assembly-summary',
    'sequence-viewer-protein-builder-assembly-apply-btn',
    'sequence-viewer-protein-builder-assembly-cancel-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-clear-btn',
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
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryListBackbones: async () => ({
        ok: true,
        results: [
          {
            id: 'stored_backbone_1',
            hostVectorName: 'HostVector',
            sourceRecordName: 'HostVector',
            backboneName: 'Backbone (HostVector)',
            backboneSequence: 'ATGCGTACGCTAGTTACC',
            backboneLength: 18,
            insertionOffset: 10,
            insertLength: 6,
            variantMode: 'restriction',
            updatedAt: '2026-04-23T12:00:00.000Z'
          }
        ]
      })
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const appState = { projects: [], protocols: [], notebookEntries: [] };
  let persisted = false;
  let notebookChangedCount = 0;
  let nextId = 0;
  const viewer = moduleWithDom.initSequenceViewer({
    state: appState,
    persist: () => {
      persisted = true;
    },
    createId: () => `protein-builder-test-id-${nextId += 1}`,
    onNotebookEntriesChanged: () => {
      notebookChangedCount += 1;
    }
  });
  viewer.loadFromExternal({
    name: 'vector_with_poi',
    sequence: 'GGGATGTTATTATTACCC',
    topology: 'linear',
    source: 'external',
    features: [
      {
        id: 'poi_feature',
        name: 'PoiCds',
        type: 'cds',
        strand: 1,
        translation: 'MLLL',
        segments: [{ start: 3, end: 15 }]
      }
    ]
  });

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');

  const builderForm = document.getElementById('sequence-viewer-protein-builder-form');
  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  const poiInput = document.getElementById('sequence-viewer-protein-builder-poi-sequence');
  constructNameInput.value = 'GFP Insert';
  trigger(builderForm, 'input', { target: constructNameInput });
  poiInput.value = 'MLLL';
  trigger(builderForm, 'input', { target: poiInput });
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-protein-builder-assemble-btn'), 'click');
  await flushAsync();
  await flushAsync();

  const assemblyOverlay = document.getElementById('sequence-viewer-protein-builder-assembly-overlay');
  const assemblyList = document.getElementById('sequence-viewer-protein-builder-assembly-list');
  const assemblySummary = document.getElementById('sequence-viewer-protein-builder-assembly-summary');
  const confirmationBanner = document.getElementById('sequence-viewer-protein-builder-confirmation');
  const confirmationSummary = document.getElementById('sequence-viewer-protein-builder-confirmation-summary');
  const textarea = document.getElementById('sequence-viewer-textarea');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
  const pastePanel = document.getElementById('sequence-viewer-paste-panel');
  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  assert.equal(Boolean(assemblyOverlay.hidden), false);
  assert.match(assemblyList.innerHTML, /HostVector/);
  assert.match(assemblySummary.innerHTML, /Estimated Circular Plasmid/i);

  const backboneTarget = {
    closest(selector) {
      if (selector === '[data-protein-builder-backbone-id]') {
        return { dataset: { proteinBuilderBackboneId: 'stored_backbone_1' } };
      }
      return null;
    }
  };
  trigger(assemblyList, 'click', { target: backboneTarget });
  trigger(document.getElementById('sequence-viewer-protein-builder-assembly-apply-btn'), 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(Boolean(document.getElementById('sequence-viewer-detail-workspace').hidden), false);
  assert.equal(Boolean(confirmationBanner.hidden), false);
  assert.equal(confirmationSummary.innerHTML.includes('HostVector'), true);
  assert.equal(document.getElementById('sequence-viewer-save-name').value, 'GFP Insert (HostVector)');
  assert.match(document.getElementById('sequence-viewer-status').textContent, /Review the assembled plasmid.*HostVector.*confirm the construct/i);
  assert.match(document.getElementById('sequence-viewer-stat-topology').textContent, /circular/i);
  assert.equal(Boolean(loadBtn.hidden), true);
  assert.equal(Boolean(pastePanel.hidden), true);
  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(textarea.value, '');
  assert.equal(appState.notebookEntries.length, 1);
  const notebookEntryId = appState.notebookEntries[0].id;

  trigger(document.getElementById('sequence-viewer-protein-builder-confirmation-confirm-btn'), 'click');
  await flushAsync();

  assert.equal(Boolean(confirmationBanner.hidden), true);
  assert.match(document.getElementById('sequence-viewer-status').textContent, /Construct confirmed.*cloning plan.*PCR program/i);
  assert.equal(persisted, true);
  assert.equal(notebookChangedCount >= 2, true);
  assert.equal(appState.notebookEntries.length, 1);
  assert.equal(appState.notebookEntries[0].id, notebookEntryId);
  assert.match(appState.notebookEntries[0].result, /Protein Builder cloning assembly design/i);
  assert.match(appState.notebookEntries[0].result, /PCR program/i);
  assert.match(appState.notebookEntries[0].result, /Primers/i);
  assert.equal(appState.notebookEntries[0].resultTable.rows.length > 0, true);
});

test('[EDGE] sequence-viewer protein builder only lists recognized backbone selections for plasmid assembly', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-protein-builder-confirmation',
    'sequence-viewer-protein-builder-confirmation-summary',
    'sequence-viewer-protein-builder-confirmation-back-btn',
    'sequence-viewer-protein-builder-confirmation-confirm-btn',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-assemble-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-protein-builder-assembly-overlay',
    'sequence-viewer-protein-builder-assembly-subtitle',
    'sequence-viewer-protein-builder-assembly-close-btn',
    'sequence-viewer-protein-builder-assembly-list',
    'sequence-viewer-protein-builder-assembly-summary',
    'sequence-viewer-protein-builder-assembly-apply-btn',
    'sequence-viewer-protein-builder-assembly-cancel-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-clear-btn',
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
  const sequenceLibraryGetCalls = [];
  const sequenceLibraryListCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryListBackbones: async () => ({
        ok: true,
        results: []
      }),
      sequenceLibraryList: async (payload) => {
        sequenceLibraryListCalls.push(payload);
        return {
          ok: true,
          entries: [
            {
              id: 'entry_backbone_1',
              name: 'pETDuet-1-NdeI-F',
              status: 'saved',
              topology: 'circular',
              sequenceLength: 24,
              updatedAt: '2026-04-23T15:00:00.000Z'
            }
          ]
        };
      },
      sequenceLibraryGet: async (payload) => {
        sequenceLibraryGetCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_backbone_1',
            name: 'pETDuet-1-NdeI-F',
            status: 'saved',
            topology: 'circular'
          },
          gbkText: `LOCUS       pETDuet-1-NdeI-F 24 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="T7 promoter"
     CDS             14..20
                     /label="AmpR"
ORIGIN
        1 atgcgtacgctagttaccggttaa
//
`
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'vector_with_poi',
    sequence: 'GGGATGTTATTATTACCC',
    topology: 'linear',
    source: 'external',
    features: [
      {
        id: 'poi_feature',
        name: 'PoiCds',
        type: 'cds',
        strand: 1,
        translation: 'MLLL',
        segments: [{ start: 3, end: 15 }]
      }
    ]
  });

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');

  const builderForm = document.getElementById('sequence-viewer-protein-builder-form');
  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  const poiInput = document.getElementById('sequence-viewer-protein-builder-poi-sequence');
  constructNameInput.value = 'GFP Insert';
  trigger(builderForm, 'input', { target: constructNameInput });
  poiInput.value = 'MLLL';
  trigger(builderForm, 'input', { target: poiInput });
  await flushAsync();

  const sequenceLibraryListCallsBeforeAssembly = sequenceLibraryListCalls.length;
  const sequenceLibraryGetCallsBeforeAssembly = sequenceLibraryGetCalls.length;
  trigger(document.getElementById('sequence-viewer-protein-builder-assemble-btn'), 'click');
  await flushAsync();
  await flushAsync();

  const assemblyOverlay = document.getElementById('sequence-viewer-protein-builder-assembly-overlay');
  const assemblyList = document.getElementById('sequence-viewer-protein-builder-assembly-list');
  assert.equal(Boolean(assemblyOverlay.hidden), false);
  assert.match(assemblyList.innerHTML, /No stored backbones yet/i);
  assert.doesNotMatch(assemblyList.innerHTML, /pETDuet-1-NdeI-F/);
  assert.doesNotMatch(assemblyList.innerHTML, /Saved Sequence Library entry/i);
  assert.equal(sequenceLibraryListCalls.length, sequenceLibraryListCallsBeforeAssembly);
  assert.equal(sequenceLibraryGetCalls.length, sequenceLibraryGetCallsBeforeAssembly);
});

test('[EDGE] sequence-viewer protein builder does not hydrate saved library entries as assembly backbones', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-poi-name',
    'sequence-viewer-protein-builder-poi-sequence',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
    'sequence-viewer-protein-builder-add-poi-btn',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-assemble-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-btn',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-protein-builder-assembly-overlay',
    'sequence-viewer-protein-builder-assembly-subtitle',
    'sequence-viewer-protein-builder-assembly-close-btn',
    'sequence-viewer-protein-builder-assembly-list',
    'sequence-viewer-protein-builder-assembly-summary',
    'sequence-viewer-protein-builder-assembly-apply-btn',
    'sequence-viewer-protein-builder-assembly-cancel-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-clear-btn',
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
  const sequenceLibraryGetCalls = [];
  const sequenceLibraryListCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryListBackbones: async () => ({
        ok: true,
        results: []
      }),
      sequenceLibraryList: async (payload) => {
        sequenceLibraryListCalls.push(payload);
        return {
          ok: true,
          entries: [
            {
              id: 'entry_saved_backbone',
              name: 'StoredVector',
              status: 'saved',
              topology: 'circular',
              sequenceLength: 24,
              featureCount: 4,
              updatedAt: '2026-04-25T12:00:00.000Z'
            }
          ]
        };
      },
      sequenceLibraryGet: async (payload) => {
        sequenceLibraryGetCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_saved_backbone',
            name: 'StoredVector',
            status: 'saved',
            topology: 'circular',
            updatedAt: '2026-04-25T12:00:00.000Z'
          },
          gbkText: `LOCUS       StoredVector              24 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..10
                     /label="T7 promoter"
     insert          11..14
                     /label="Legacy Insert"
     backbone        join(1..10,15..24)
                     /label="Backbone (StoredVector)"
     cds             15..24
                     /label="AmpR"
ORIGIN
        1 aaaaaaaaaaccccgggggggggg
//
`
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'vector_with_poi',
    sequence: 'GGGATGTTATTATTACCC',
    topology: 'linear',
    source: 'external',
    features: [
      {
        id: 'poi_feature',
        name: 'PoiCds',
        type: 'cds',
        strand: 1,
        translation: 'MLLL',
        segments: [{ start: 3, end: 15 }]
      }
    ]
  });

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');

  const builderForm = document.getElementById('sequence-viewer-protein-builder-form');
  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  const poiInput = document.getElementById('sequence-viewer-protein-builder-poi-sequence');
  constructNameInput.value = 'GFP Insert';
  trigger(builderForm, 'input', { target: constructNameInput });
  poiInput.value = 'MLLL';
  trigger(builderForm, 'input', { target: poiInput });
  await flushAsync();

  const sequenceLibraryListCallsBeforeAssembly = sequenceLibraryListCalls.length;
  const sequenceLibraryGetCallsBeforeAssembly = sequenceLibraryGetCalls.length;
  trigger(document.getElementById('sequence-viewer-protein-builder-assemble-btn'), 'click');
  await flushAsync();
  await flushAsync();

  const assemblyOverlay = document.getElementById('sequence-viewer-protein-builder-assembly-overlay');
  const assemblyList = document.getElementById('sequence-viewer-protein-builder-assembly-list');
  assert.equal(Boolean(assemblyOverlay.hidden), false);
  assert.match(assemblyList.innerHTML, /No stored backbones yet/i);
  assert.doesNotMatch(assemblyList.innerHTML, /StoredVector/);
  assert.doesNotMatch(assemblyList.innerHTML, /Saved Sequence Library entry/i);
  assert.equal(sequenceLibraryListCalls.length, sequenceLibraryListCallsBeforeAssembly);
  assert.equal(sequenceLibraryGetCalls.length, sequenceLibraryGetCallsBeforeAssembly);
});

test('[EDGE] sequence-viewer backbone recognition stores a Protein Builder artifact without annotating the original sequence', async () => {
  const ids = [
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-backbone-dialog-overlay',
    'sequence-viewer-backbone-dialog-candidates',
    'sequence-viewer-backbone-dialog-summary',
    'sequence-viewer-backbone-dialog-preview',
    'sequence-viewer-backbone-dialog-apply-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
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
  const recognizeCalls = [];
  const writeJsonCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      writeJsonFile: async (payload) => {
        writeJsonCalls.push(payload);
        return {
          ok: true,
          filePath: '/tmp/sequence-viewer-tests/SequenceViewer/protein-builder/backbones/derived_vector.recognized-backbone.json'
        };
      },
      sequenceLibraryRecognizeBackbone: async (payload) => {
        recognizeCalls.push(payload);
        return {
          ok: true,
          match: {
            hostVectorId: 'entry_host',
            hostVectorName: 'HostVector',
            hostVectorStatus: 'saved',
            hostCoverage: 1,
            orientation: 'forward',
            backboneLength: 24,
            insertLength: 6,
            backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
            insertSegments: [{ start: 16, end: 22 }],
            candidateSelections: [
              {
                id: 'candidate_1',
                label: 'T7 promoter',
                promoter: {
                  name: 'T7 promoter',
                  strand: 1,
                  gapToOrf: 6,
                  segments: [{ start: 0, end: 10 }]
                },
                orf: {
                  name: 'Nearest ORF (2 aa)',
                  strand: 1,
                  length: 6,
                  segments: [{ start: 16, end: 22 }]
                },
                variants: {
                  gibson: {
                    source: 'promoter_orf',
                    backboneLength: 24,
                    insertLength: 6,
                    backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
                    insertSegments: [{ start: 16, end: 22 }],
                    startCodon: 'ATG',
                    stopCodon: 'TAA'
                  },
                  restriction: {
                    source: 'promoter_orf',
                    backboneLength: 24,
                    insertLength: 10,
                    backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
                    insertSegments: [{ start: 14, end: 24 }],
                    startCodon: 'ATG',
                    stopCodon: 'TAA',
                    upstreamSite: {
                      name: 'NdeI',
                      segments: [{ start: 14, end: 20 }]
                    },
                    downstreamSite: {
                      name: 'XhoI',
                      segments: [{ start: 22, end: 28 }]
                    },
                    siteExtensionApplied: true
                  }
                }
              }
            ],
            selectedCandidateId: 'candidate_1',
            promoter: {
              name: 'T7 promoter',
              strand: 1,
              gapToOrf: 6,
              segments: [{ start: 0, end: 10 }]
            },
            orf: {
              name: 'Nearest ORF (2 aa)',
              strand: 1,
              length: 6,
              segments: [{ start: 16, end: 22 }]
            },
            variants: {
              gibson: {
                source: 'promoter_orf',
                backboneLength: 24,
                insertLength: 6,
                backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
                insertSegments: [{ start: 16, end: 22 }],
                startCodon: 'ATG',
                stopCodon: 'TAA'
              }
            }
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'derived_vector',
    sequence: 'ATGCGTACGCTAGTTAGGAACCCCGGATCA',
    source: 'external',
    features: []
  });

  const recognizeBtn = document.getElementById('sequence-viewer-recognize-backbone-btn');
  const dialogOverlay = document.getElementById('sequence-viewer-backbone-dialog-overlay');
  const dialogCandidates = document.getElementById('sequence-viewer-backbone-dialog-candidates');
  const dialogApplyBtn = document.getElementById('sequence-viewer-backbone-dialog-apply-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const status = document.getElementById('sequence-viewer-status');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  trigger(recognizeBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(recognizeCalls.length, 1);
  assert.equal(recognizeCalls[0].sequence, 'ATGCGTACGCTAGTTAGGAACCCCGGATCA');
  assert.equal(recognizeCalls[0].excludeEntryId, '');
  assert.equal(Boolean(dialogOverlay.hidden), false);
  assert.match(dialogCandidates.innerHTML, /T7 promoter/);
  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount);
  assert.match(status.textContent, /Review promoter \/ ORF candidates/i);

  trigger(dialogApplyBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount);
  assert.equal(featureRailHost.innerHTML.includes('T7 promoter'), false);
  assert.equal(featureRailHost.innerHTML.includes('Backbone (HostVector)'), false);
  assert.equal(featureDetail.innerHTML.includes('Insert (HostVector)'), false);
  assert.equal(writeJsonCalls.length, 1);
  assert.equal(writeJsonCalls[0].targetFolder, 'SequenceViewer/protein-builder/backbones');
  assert.match(String(writeJsonCalls[0].fileName || ''), /recognized-backbone\.json$/);
  assert.equal(writeJsonCalls[0].data?.recognition?.variant_mode, 'gibson');
  assert.equal(writeJsonCalls[0].data?.recognition?.promoter_name, 'T7 promoter');
  assert.equal(writeJsonCalls[0].data?.backbone?.sequence_length, 24);
  assert.equal(writeJsonCalls[0].data?.insert?.sequence_length, 6);
  assert.match(status.textContent, /Stored a Protein Builder backbone file/i);
  assert.match(status.textContent, /original sequence was left unchanged/i);
});

test('[EDGE] sequence-viewer annotate button adds SQL DNA and CDS features to the current record', async () => {
  const ids = [
    'sequence-viewer-annotate-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-clear-btn',
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
  const annotateCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryAnnotate: async (payload) => {
        annotateCalls.push(payload);
        return {
          ok: true,
          dnaMatches: [{
            featureId: 'feature_promoter',
            name: 'StrongPromoter',
            type: 'promoter',
            strand: 1,
            sequenceLength: 12,
            hosts: [{ hostVectorId: 'host_1', hostVectorName: 'VectorHost', hostVectorStatus: 'saved' }],
            segments: [{ start: 3, end: 15 }]
          }],
          proteinMatches: [{
            name: 'ReporterCds',
            type: 'cds',
            strand: 1,
            translation: 'MKG',
            proteinSequence: 'MKG',
            hosts: [{ hostVectorId: 'host_1', hostVectorName: 'VectorHost', hostVectorStatus: 'saved' }],
            orfFrame: '+1',
            orfLengthNt: 12,
            orfLengthAa: 3,
            startCodon: 'ATG',
            stopCodon: 'TAA',
            segments: [{ start: 15, end: 27 }]
          }]
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'annotate_me',
    sequence: 'GGGTTGACCATGAAAGGGTAA',
    source: 'external',
    features: []
  });

  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
  const status = document.getElementById('sequence-viewer-status');
  const statFeatures = document.getElementById('sequence-viewer-stat-features');
  const initialFeatureCount = Number(statFeatures.textContent || 0);

  trigger(annotateBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(annotateCalls.length, 1);
  assert.equal(annotateCalls[0].sequence, 'GGGTTGACCATGAAAGGGTAA');
  assert.equal(annotateCalls[0].topology, 'linear');
  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount + 2);
  assert.match(featureRailHost.innerHTML, /StrongPromoter/);
  assert.match(featureRailHost.innerHTML, /ReporterCds/);
  assert.match(featureDetail.innerHTML, /ReporterCds/);
  assert.match(status.textContent, /Save the record to persist changes/);
});

test('[EDGE] sequence-viewer keeps the sequencing alignment workspace hidden until opened by the new methods', () => {
  const document = createMockDocument([
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-alignment-workspace',
    'sequence-viewer-status',
    'sequence-viewer-alignment-status'
  ]);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const alignmentWorkspace = document.getElementById('sequence-viewer-alignment-workspace');

  assert.equal(Boolean(homeWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(Boolean(alignmentWorkspace.hidden), true);

  viewer.openSequencingAlignmentWorkspace();
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(Boolean(alignmentWorkspace.hidden), false);

  viewer.closeSequencingAlignmentWorkspace();
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(Boolean(alignmentWorkspace.hidden), true);
});

test('[EDGE] sequence-viewer sequencing alignment workspace loads multi-record inputs and applies the selected alignment', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-alignment-workspace',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-status',
    'sequence-viewer-sequence-host',
    'sequence-viewer-alignment-status',
    'sequence-viewer-alignment-query-file-name',
    'sequence-viewer-alignment-query-summary',
    'sequence-viewer-alignment-query-status',
    'sequence-viewer-alignment-query-record-wrap',
    'sequence-viewer-alignment-query-record-select',
    'sequence-viewer-alignment-run-btn',
    'sequence-viewer-alignment-reset-btn'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'ref_b',
    sequence: 'GGGACGTACGTCCC',
    topology: 'linear',
    source: 'external',
    features: []
  });
  viewer.openSequencingAlignmentWorkspace();

  await viewer.loadSequencingAlignmentQuery({
    name: 'query.fasta',
    text: `
>query_a
TTTT
>query_b
ACGTACGT
`
  });

  const querySelect = document.getElementById('sequence-viewer-alignment-query-record-select');
  const queryWrap = document.getElementById('sequence-viewer-alignment-query-record-wrap');

  assert.equal(Boolean(queryWrap.hidden), false);
  assert.match(querySelect.innerHTML, /query_a/);
  assert.match(querySelect.innerHTML, /query_b/);
  assert.match(document.getElementById('sequence-viewer-alignment-query-summary').textContent, /query_a/);

  querySelect.value = '1';
  trigger(querySelect, 'change');

  await viewer.runSequencingAlignment();

  assert.equal(Boolean(document.getElementById('sequence-viewer-alignment-workspace').hidden), true);
  assert.equal(document.getElementById('sequence-viewer-alignment-toggle').disabled, false);
  assert.equal(document.getElementById('sequence-viewer-alignment-toggle').checked, true);
  assert.match(document.getElementById('sequence-viewer-alignment-active-note').textContent, /query_b|visible/i);
});

test('[EDGE] sequence-viewer alignment button opens the workspace, auto-loads the current reference, and persists pasted alignments with that reference', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-alignment-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-back-btn',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-recognize-backbone-btn',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-toggle',
    'sequence-viewer-alignment-session-select',
    'sequence-viewer-alignment-active-note',
    'sequence-viewer-clear-btn',
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
    'sequence-viewer-sequence-host',
    'sequence-viewer-alignment-close-btn',
    'sequence-viewer-alignment-status',
    'sequence-viewer-alignment-query-mode-paste',
    'sequence-viewer-alignment-query-mode-file',
    'sequence-viewer-alignment-query-paste-panel',
    'sequence-viewer-alignment-query-file-panel',
    'sequence-viewer-alignment-query-textarea',
    'sequence-viewer-alignment-query-input',
    'sequence-viewer-alignment-query-choose',
    'sequence-viewer-alignment-query-file-name',
    'sequence-viewer-alignment-query-summary',
    'sequence-viewer-alignment-query-status',
    'sequence-viewer-alignment-query-record-wrap',
    'sequence-viewer-alignment-query-record-select',
    'sequence-viewer-alignment-run-btn',
    'sequence-viewer-alignment-reset-btn'
  ];
  const upsertCalls = [];
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [] }),
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_alignment_ref',
            name: payload.name || 'RefSeq',
            status: payload.status || 'temporary'
          },
          alignments: Array.isArray(payload.alignmentSessions)
            ? payload.alignmentSessions.map((session, index) => ({
              ...session,
              id: session.id || `alignment_${index + 1}`,
              updatedAt: '2026-03-29T12:00:00.000Z'
            }))
            : []
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'enana_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document, window, localStorage }
  );
  const viewer = moduleWithDom.initSequenceViewer({
    document,
    window,
    localStorage
  });
  const alignmentOpenBtn = document.getElementById('sequence-viewer-alignment-open-btn');
  const alignmentQueryTextarea = document.getElementById('sequence-viewer-alignment-query-textarea');
  const alignmentRunBtn = document.getElementById('sequence-viewer-alignment-run-btn');
  const alignmentToggle = document.getElementById('sequence-viewer-alignment-toggle');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  viewer.loadFromExternal({
    name: 'RefSeq',
    sequence: 'GGGACGTACGTCCC',
    topology: 'linear',
    source: 'external',
    features: []
  });

  trigger(alignmentOpenBtn, 'click');
  assert.equal(Boolean(document.getElementById('sequence-viewer-alignment-workspace').hidden), false);

  alignmentQueryTextarea.value = '>trace_1\nACGTTCGT\n';
  trigger(alignmentQueryTextarea, 'input');

  trigger(alignmentRunBtn, 'click');
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length >= 2, true);
  const finalUpsert = upsertCalls[upsertCalls.length - 1];
  assert.equal(Array.isArray(finalUpsert.alignmentSessions), true);
  assert.equal(finalUpsert.alignmentSessions.length, 1);
  assert.equal(finalUpsert.alignmentSessions[0].queryRecord.name, 'trace_1');
  assert.equal(finalUpsert.alignmentSessions[0].result.mismatchCount, 1);
  assert.equal(Boolean(document.getElementById('sequence-viewer-alignment-workspace').hidden), true);
  assert.equal(alignmentToggle.disabled, false);
  assert.equal(alignmentToggle.checked, true);
  assert.match(document.getElementById('sequence-viewer-alignment-active-note').textContent, /trace_1|visible/i);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);

  alignmentToggle.checked = false;
  trigger(alignmentToggle, 'change');
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);

  alignmentToggle.checked = true;
  trigger(alignmentToggle, 'change');
  assert.match(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);
});
  }
};
