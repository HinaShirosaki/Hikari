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
  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');

  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(Boolean(loadBtn.hidden), true);
  assert.equal(Boolean(annotateBtn.disabled), false);
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
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [] }),
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

test('[EDGE] sequence-viewer backbone recognition adds backbone and insert features to the current record', async () => {
  const ids = [
    'sequence-viewer-recognize-backbone-btn',
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
  const document = createMockDocument(ids);
  const window = {
    enanaApi: {
      sequenceLibraryRecognizeBackbone: async (payload) => {
        recognizeCalls.push(payload);
        return {
          ok: true,
          match: {
            hostVectorId: 'entry_host',
            hostVectorName: 'HostVector',
            hostVectorStatus: 'saved',
            orientation: 'forward',
            backboneLength: 24,
            insertLength: 6,
            hostCoverage: 1,
            backboneSegments: [{ start: 0, end: 16 }, { start: 22, end: 30 }],
            insertSegments: [{ start: 16, end: 22 }]
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
  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount + 2);
  assert.match(featureRailHost.innerHTML, /Backbone \(HostVector\)/);
  assert.match(featureRailHost.innerHTML, /Insert \(HostVector\)/);
  assert.match(featureDetail.innerHTML, /Insert \(HostVector\)/);
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
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(Boolean(alignmentWorkspace.hidden), false);

  viewer.closeSequencingAlignmentWorkspace();
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(Boolean(alignmentWorkspace.hidden), true);
});

test('[EDGE] sequence-viewer sequencing alignment workspace loads multi-record inputs and renders alignment results', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-alignment-workspace',
    'sequence-viewer-status',
    'sequence-viewer-alignment-status',
    'sequence-viewer-alignment-reference-file-name',
    'sequence-viewer-alignment-reference-summary',
    'sequence-viewer-alignment-reference-status',
    'sequence-viewer-alignment-reference-record-wrap',
    'sequence-viewer-alignment-reference-record-select',
    'sequence-viewer-alignment-query-file-name',
    'sequence-viewer-alignment-query-summary',
    'sequence-viewer-alignment-query-status',
    'sequence-viewer-alignment-query-record-wrap',
    'sequence-viewer-alignment-query-record-select',
    'sequence-viewer-alignment-run-btn',
    'sequence-viewer-alignment-reset-btn',
    'sequence-viewer-alignment-summary',
    'sequence-viewer-alignment-pretty',
    'sequence-viewer-alignment-differences'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.openSequencingAlignmentWorkspace();

  await viewer.loadSequencingAlignmentReference({
    name: 'reference.fasta',
    text: `
>ref_a
TTTT
>ref_b
GGGACGTACGTCCC
`
  });
  await viewer.loadSequencingAlignmentQuery({
    name: 'query.fasta',
    text: `
>query_a
TTTT
>query_b
ACGTACGT
`
  });

  const referenceSelect = document.getElementById('sequence-viewer-alignment-reference-record-select');
  const querySelect = document.getElementById('sequence-viewer-alignment-query-record-select');
  const referenceWrap = document.getElementById('sequence-viewer-alignment-reference-record-wrap');
  const queryWrap = document.getElementById('sequence-viewer-alignment-query-record-wrap');

  assert.equal(Boolean(referenceWrap.hidden), false);
  assert.equal(Boolean(queryWrap.hidden), false);
  assert.match(referenceSelect.innerHTML, /ref_a/);
  assert.match(referenceSelect.innerHTML, /ref_b/);
  assert.match(querySelect.innerHTML, /query_a/);
  assert.match(querySelect.innerHTML, /query_b/);
  assert.match(document.getElementById('sequence-viewer-alignment-reference-summary').textContent, /ref_a/);
  assert.match(document.getElementById('sequence-viewer-alignment-query-summary').textContent, /query_a/);

  referenceSelect.value = '1';
  trigger(referenceSelect, 'change');
  querySelect.value = '1';
  trigger(querySelect, 'change');

  await viewer.runSequencingAlignment();

  const summaryHtml = document.getElementById('sequence-viewer-alignment-summary').innerHTML;
  const prettyHtml = document.getElementById('sequence-viewer-alignment-pretty').innerHTML;
  const differencesHtml = document.getElementById('sequence-viewer-alignment-differences').innerHTML;

  assert.match(summaryHtml, /ref_b/);
  assert.match(summaryHtml, /query_b/);
  assert.match(summaryHtml, /forward/);
  assert.match(summaryHtml, /100\.00%/);
  assert.match(prettyHtml, /ACGTACGT/);
  assert.match(differencesHtml, /No mismatches or indels/);
});
  }
};
