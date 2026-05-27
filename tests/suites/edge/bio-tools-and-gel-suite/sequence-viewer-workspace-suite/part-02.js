module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  }
};