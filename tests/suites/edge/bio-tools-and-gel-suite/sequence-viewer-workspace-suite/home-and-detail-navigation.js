module.exports = function registerEdgeSequenceViewerWorkspaceSuiteHomeAndDetailNavigation(context = {}) {
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
  assert.equal(document.querySelector('[data-hikari-transient-toast]'), null);
});
test('[EDGE] sequence-viewer refreshes the library from the live storage root after a folder switch', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-status',
    'sequence-viewer-record-select',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const listCalls = [];
  let storagePath = '/old/root';
  const apiBridge = {
    sequenceLibraryList: async (payload) => {
      listCalls.push(payload);
      const isNewRoot = payload.storagePath === '/new/root';
      return {
        ok: true,
        entries: [{
          id: isNewRoot ? 'new-entry' : 'old-entry',
          name: isNewRoot ? 'New root sequence' : 'Old root sequence',
          status: 'saved'
        }]
      };
    },
    sequenceLibraryGet: async (payload) => ({
      ok: true,
      entry: {
        id: payload.id,
        name: payload.id === 'new-entry' ? 'New root sequence' : 'Old root sequence',
        status: 'saved'
      }
    })
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer({
    apiBridge,
    getStoragePath: () => storagePath,
    homeViewId: 'sequence-viewer-view'
  });
  await flushAsync();

  storagePath = '/new/root';
  viewer.render({ activeViewId: 'sequence-viewer-view' });
  await flushAsync();
  await flushAsync();

  assert.equal(listCalls.at(-1).storagePath, '/new/root');
  assert.match(document.getElementById('sequence-viewer-library-list').innerHTML, /New root sequence/);
  assert.doesNotMatch(document.getElementById('sequence-viewer-library-list').innerHTML, /Old root sequence/);
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
    'sequence-viewer-detail-new-btn',
    'sequence-viewer-detail-open-btn',
    'sequence-viewer-detail-open-input',
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
  const detailNewBtn = document.getElementById('sequence-viewer-detail-new-btn');
  const detailOpenBtn = document.getElementById('sequence-viewer-detail-open-btn');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');
  const pastePanel = document.getElementById('sequence-viewer-paste-panel');

  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(Boolean(detailNewBtn.hidden), false);
  assert.equal(Boolean(detailOpenBtn.hidden), false);
  assert.equal(Boolean(loadBtn.hidden), true);

  trigger(detailNewBtn, 'click');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.equal(Boolean(loadBtn.hidden), false);
  assert.equal(Boolean(pastePanel.hidden), false);
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-home-vector-builder-btn',
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();
  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');

  const homeWorkspace = document.getElementById('sequence-viewer-home-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  assert.equal(Boolean(homeWorkspace.hidden), true);
  assert.equal(Boolean(detailWorkspace.hidden), false);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Paste sequence text/i);
});
test('[EDGE] sequence-viewer New action uses navigation callback', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-paste-btn'
  ];
  const document = createMockDocument(ids);
  const transitions = [];
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer({
    onNavigateDetail: () => transitions.push('detail'),
    onNavigateHome: () => transitions.push('home')
  });

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  assert.deepEqual(transitions, ['detail']);
});
test('[EDGE] sequence-viewer library native dblclick opens detail while single click only previews', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-status',
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
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async (payload) => {
        if (payload?.includeGbk) {
          return { ok: true, entry, gbkText };
        }
        return { ok: true, entry };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
  }
};
