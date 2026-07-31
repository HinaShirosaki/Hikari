module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer library search filters the library list by name', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-library-search-input',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select'
  ];
  const entries = [
    { id: 'entry_1', name: 'Alpha Vector', status: 'saved' },
    { id: 'entry_2', name: 'Beta Plasmid', status: 'saved' }
  ];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries }),
      sequenceLibraryGet: async () => ({
        ok: true,
        entry: entries[0]
      })
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
  moduleWithDom.initSequenceViewer();
  await flushAsync();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  assert.equal(libraryList.innerHTML.includes('Alpha Vector'), true);
  assert.equal(libraryList.innerHTML.includes('Beta Plasmid'), true);

  const searchInput = document.getElementById('sequence-viewer-library-search-input');
  searchInput.value = 'beta';
  trigger(searchInput, 'input');
  await flushAsync();

  assert.equal(libraryList.innerHTML.includes('Beta Plasmid'), true);
  assert.equal(libraryList.innerHTML.includes('Alpha Vector'), false);

  searchInput.value = 'nothing-here';
  trigger(searchInput, 'input');
  await flushAsync();

  assert.equal(libraryList.innerHTML.includes('No sequences match'), true);
});
test('[EDGE] sequence-viewer protein builder searches stored features and adds translated blocks to the chain', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-vector-builder-btn',
    'sequence-viewer-detail-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-status',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
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
    hikariApi: {
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
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-detail-protein-builder-btn'), 'click');
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
test('[EDGE] sequence-viewer protein builder can build DNA from the active vector source', async () => {
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
    'sequence-viewer-protein-builder-reset-btn',
    'sequence-viewer-protein-builder-add-custom-btn',
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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

  await flushAsync();

  trigger(document.getElementById('sequence-viewer-protein-builder-build-dna-btn'), 'click');
  await flushAsync();

  const dnaMeta = document.getElementById('sequence-viewer-protein-builder-dna-meta');
  const dnaSequence = document.getElementById('sequence-viewer-protein-builder-dna-sequence');
  const builderStatus = document.getElementById('sequence-viewer-protein-builder-status');

  assert.match(dnaMeta.textContent, /nt/);
  assert.equal(dnaSequence.innerHTML.includes('ATGTTATTATTA'), true);
  assert.match(builderStatus.textContent, /Reused active DNA from current vector CDS PoiCds/i);
});
  }
};
