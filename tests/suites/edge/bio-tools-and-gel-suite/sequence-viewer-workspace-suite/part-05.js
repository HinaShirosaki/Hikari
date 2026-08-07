module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer protein builder only lists recognized backbone selections for plasmid assembly', async () => {
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
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
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
    hikariApi: {
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

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });

  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  constructNameInput.value = 'GFP Insert';
  trigger(document.getElementById('sequence-viewer-protein-builder-form'), 'input', { target: constructNameInput });
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
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
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
    hikariApi: {
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

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });

  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  constructNameInput.value = 'GFP Insert';
  trigger(document.getElementById('sequence-viewer-protein-builder-form'), 'input', { target: constructNameInput });
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
  }
};
