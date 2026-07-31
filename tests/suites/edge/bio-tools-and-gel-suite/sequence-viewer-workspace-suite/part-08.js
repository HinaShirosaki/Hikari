module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart08(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {

const VECTOR_BUILDER_IDS = [
  'sequence-viewer-home-workspace',
  'sequence-viewer-detail-workspace',
  'sequence-viewer-protein-builder-workspace',
  'sequence-viewer-cloning-design-workspace',
  'sequence-viewer-vector-builder-workspace',
  'sequence-viewer-vector-builder-btn',
  'sequence-viewer-vector-builder-back-btn',
  'sequence-viewer-vector-builder-title',
  'sequence-viewer-vector-builder-cutters-toggle',
  'sequence-viewer-vector-builder-protein-builder-btn',
  'sequence-viewer-vector-builder-cloning-design-btn',
  'sequence-viewer-vector-builder-map',
  'sequence-viewer-vector-builder-sequence',
  'sequence-viewer-vector-builder-context-menu',
  'sequence-viewer-vector-builder-feature-replace-overlay',
  'sequence-viewer-vector-builder-feature-replace-form',
  'sequence-viewer-vector-builder-feature-replace-select',
  'sequence-viewer-vector-builder-feature-replace-search',
  'sequence-viewer-vector-builder-feature-replace-search-btn',
  'sequence-viewer-vector-builder-feature-replace-status',
  'sequence-viewer-vector-builder-feature-replace-results',
  'sequence-viewer-vector-builder-sequence-edit-overlay',
  'sequence-viewer-vector-builder-sequence-edit-form',
  'sequence-viewer-vector-builder-sequence-edit-textarea',
  'sequence-viewer-protein-builder-vector-target',
  'sequence-viewer-protein-builder-insert-vector-btn',
  'sequence-viewer-protein-builder-assemble-btn',
  'sequence-viewer-status',
  'sequence-viewer-sequence-host',
  'sequence-viewer-feature-rail-host',
  'sequence-viewer-feature-detail'
];

// The mock DOM only resolves [data-*] selectors, so a map click is simulated by
// handing the handler a target whose closest() reports the arc it landed on.
function featureTarget(index) {
  return {
    closest(selector) {
      if (selector === '[data-feature-index]') {
        return { dataset: { featureIndex: String(index) } };
      }
      return null;
    }
  };
}

function contextActionTarget(action) {
  return {
    closest(selector) {
      if (selector === '[data-vector-action]') {
        return { dataset: { vectorAction: action } };
      }
      return null;
    }
  };
}

function bootVectorBuilder(features) {
  const document = createMockDocument(VECTOR_BUILDER_IDS);
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = viewerModule.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'pVector',
    sequence: 'ATGGCGCATCATCATCATCATCATTAAGGCCTTAACCGGTTACGTACGTAAGGCCTTAACC',
    topology: 'circular',
    source: 'external',
    features
  });
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  return { document, viewer };
}

test('[EDGE] sequence-viewer home Vector Builder button opens the previewed library entry', async () => {
  const entry = {
    id: 'entry_vb',
    name: 'pHomeVector',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 60,
    featureCount: 1,
    updatedAt: '2026-03-01T00:00:00.000Z'
  };
  const gbkText = [
    'LOCUS       pHomeVector       60 bp    DNA     circular SYN 01-JAN-2026',
    'FEATURES             Location/Qualifiers',
    '     CDS             7..24',
    '                     /label="His6"',
    'ORIGIN',
    '        1 atggcgcatc atcatcatca tcattaaggc cttaaccggt tacgtacgta aggccttaac',
    '//',
    ''
  ].join('\n');

  const document = createMockDocument([
    ...VECTOR_BUILDER_IDS,
    'sequence-viewer-home-vector-builder-btn',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host'
  ]);
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] }),
      sequenceLibraryGet: async () => ({ ok: true, entry, gbkText })
    }
  };
  const localStorage = {
    getItem: (key) => (key === 'hikari_state_v1'
      ? JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } })
      : null)
  };
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  viewerModule.initSequenceViewer();
  await flushAsync();
  await flushAsync();

  // The home preview draws straight from the entry's stored GBK, no iframe.
  const previewHost = document.getElementById('sequence-viewer-preview-host');
  assert.match(previewHost.innerHTML, /vector-map__backbone/);
  assert.equal(/<iframe/.test(previewHost.innerHTML), false);

  trigger(document.getElementById('sequence-viewer-home-vector-builder-btn'), 'click', { preventDefault() {} });
  await flushAsync();
  await flushAsync();

  assert.equal(document.getElementById('sequence-viewer-vector-builder-workspace').hidden, false);
  assert.equal(document.getElementById('sequence-viewer-vector-builder-title').textContent, 'pHomeVector');
  assert.match(document.getElementById('sequence-viewer-vector-builder-map').innerHTML, /data-feature-index="0"/);
});

test('[EDGE] sequence-viewer vector builder renders an interactive circular map and selects features', () => {
  const { document } = bootVectorBuilder([
    { name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
    { name: 'Terminator', type: 'terminator', strand: -1, source: 'external', segments: [{ start: 30, end: 50 }] }
  ]);

  const workspace = document.getElementById('sequence-viewer-vector-builder-workspace');
  const map = document.getElementById('sequence-viewer-vector-builder-map');
  assert.equal(workspace.hidden, false);
  assert.equal(document.getElementById('sequence-viewer-vector-builder-title').textContent, 'pVector');
  // Arcs are clickable and carry the index the editing controllers resolve on.
  assert.match(map.innerHTML, /data-feature-index="0"/);
  assert.match(map.innerHTML, /data-feature-index="1"/);
  assert.match(map.innerHTML, /vector-map__backbone/);
  assert.equal(/NaN/.test(map.innerHTML), false);
  // Nothing selected yet, so no feature carries the active outline.
  assert.equal(/vector-map__feature--active/.test(map.innerHTML), false);

  trigger(map, 'mousedown', { button: 0, target: featureTarget(1) });

  // Selection now shows only on the feature itself -- there is no detail panel.
  assert.match(map.innerHTML, /vector-map__feature--active/);
  assert.match(map.innerHTML, /vector-map__label--active/);
});

test('[EDGE] sequence-viewer vector builder deletes a feature and its bases from the circular map', async () => {
  const { document } = bootVectorBuilder([
    { name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
    { name: 'Terminator', type: 'terminator', strand: -1, source: 'external', segments: [{ start: 30, end: 50 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const editForm = document.getElementById('sequence-viewer-vector-builder-sequence-edit-form');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });

  assert.equal(contextMenu.hidden, false);
  // The selected feature supplies the range, so the menu offers its exact span.
  assert.match(contextMenu.innerHTML, /Delete Bases \(18 bp\)/);
  assert.match(contextMenu.innerHTML, /Insert Protein Construct/);
  // Feature annotation actions live in the detail workspace, not on the map.
  assert.equal(/data-vector-action="add-feature"/.test(contextMenu.innerHTML), false);
  assert.equal(/data-vector-action="edit-feature"/.test(contextMenu.innerHTML), false);
  assert.equal(/data-vector-action="remove-annotation"/.test(contextMenu.innerHTML), false);

  trigger(contextMenu, 'click', { target: contextActionTarget('delete-bases') });
  trigger(editForm, 'submit', { preventDefault() {} });
  await flushAsync();

  // 61 bp minus the 18 bp feature; the CDS annotation goes with its bases while
  // the downstream terminator survives and shifts back by 18.
  assert.match(map.innerHTML, /43 bp/);
  assert.equal(/data-feature-index="1"/.test(map.innerHTML), false);
  assert.match(map.innerHTML, /Terminator/);
  assert.equal(/His6/.test(map.innerHTML), false);
});

test('[EDGE] sequence-viewer vector builder swaps in a feature from the stored database', async () => {
  const searchCalls = [];
  const document = createMockDocument(VECTOR_BUILDER_IDS);
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [] }),
      sequenceLibrarySearchFeatures: async (payload) => {
        searchCalls.push(payload);
        return {
          ok: true,
          results: [
            { id: 'feat_flag', name: 'FLAG tag', type: 'CDS', sequence: 'GATTACAAAGAT', sequenceLength: 12, hostCount: 2 },
            { id: 'feat_empty', name: 'No sequence', type: 'CDS', sequence: '', sequenceLength: 0, hostCount: 1 }
          ]
        };
      }
    }
  };
  const localStorage = {
    getItem: (key) => (key === 'hikari_state_v1'
      ? JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } })
      : null)
  };
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  const viewer = viewerModule.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'pVector',
    sequence: 'ATGGCGCATCATCATCATCATCATTAAGGCCTTAACCGGTTACGTACGTAAGGCCTTAACC',
    topology: 'circular',
    source: 'external',
    features: [
      { name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
      { name: 'Terminator', type: 'terminator', strand: -1, source: 'external', segments: [{ start: 30, end: 50 }] }
    ]
  });
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const overlay = document.getElementById('sequence-viewer-vector-builder-feature-replace-overlay');
  const results = document.getElementById('sequence-viewer-vector-builder-feature-replace-results');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });

  // The base-level replace was superseded by the feature-level one.
  assert.match(contextMenu.innerHTML, /Replace Feature\.\.\./);
  assert.equal(/data-vector-action="replace-bases"/.test(contextMenu.innerHTML), false);

  trigger(contextMenu, 'click', { target: contextActionTarget('replace-feature') });
  assert.equal(overlay.hidden, false);
  assert.match(
    document.getElementById('sequence-viewer-vector-builder-feature-replace-note').textContent,
    /Replacing His6 at 7-24 \(18 bp\)/
  );

  document.getElementById('sequence-viewer-vector-builder-feature-replace-search').value = 'flag';
  trigger(document.getElementById('sequence-viewer-vector-builder-feature-replace-search-btn'), 'click', { preventDefault() {} });
  await flushAsync();
  await flushAsync();

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'flag');
  assert.match(results.innerHTML, /FLAG tag/);
  assert.match(results.innerHTML, /in 2 vectors/);
  // A stored feature with no sequence cannot be spliced, so it is filtered out.
  assert.equal(/No sequence/.test(results.innerHTML), false);

  trigger(results, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-vector-replace-feature-id]') {
          return { dataset: { vectorReplaceFeatureId: 'feat_flag' } };
        }
        return null;
      }
    }
  });
  await flushAsync();

  assert.equal(overlay.hidden, true);
  // 18 bp swapped for the stored 12 bp leaves 61 - 6 = 55 bp, carrying the
  // stored feature's name; the downstream feature survives the length change.
  assert.match(map.innerHTML, /55 bp/);
  assert.match(map.innerHTML, /FLAG tag/);
  assert.equal(/His6/.test(map.innerHTML), false);
  assert.match(map.innerHTML, /Terminator/);
});

test('[EDGE] sequence-viewer vector builder folds Protein Builder in as an on-map insert designer', async () => {
  const { document } = bootVectorBuilder([
    { name: 'MCS', type: 'misc_feature', strand: 1, source: 'external', segments: [{ start: 24, end: 30 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const builderWorkspace = document.getElementById('sequence-viewer-protein-builder-workspace');
  const insertBtn = document.getElementById('sequence-viewer-protein-builder-insert-vector-btn');
  const assembleBtn = document.getElementById('sequence-viewer-protein-builder-assemble-btn');
  const targetNote = document.getElementById('sequence-viewer-protein-builder-vector-target');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  trigger(contextMenu, 'click', { target: contextActionTarget('protein-replace') });

  // Picking a site on the map hands off to Protein Builder with that target, and
  // the stored-backbone assembly steps aside while a vector target is pending.
  assert.equal(builderWorkspace.hidden, false);
  assert.equal(insertBtn.hidden, false);
  assert.equal(assembleBtn.hidden, true);
  assert.match(targetNote.textContent, /Replace 25-30 \(6 bp\)/);
  assert.match(targetNote.textContent, /pVector/);
});

  }
};
