module.exports = function registerEdgeSequenceViewerWorkspaceSuiteVectorBuilder(context = {}) {
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
  'sequence-viewer-vector-builder-primers-toggle',
  'sequence-viewer-primers-toggle',
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
  'sequence-viewer-vector-builder-sequence-edit-note',
  'sequence-viewer-vector-builder-sequence-edit-cancel',
  'sequence-viewer-protein-builder-insert-vector-btn',
  'sequence-viewer-protein-builder-assemble-btn',
  'sequence-viewer-cloning-design-back-btn',
  'sequence-viewer-cloning-design-status',
  'sequence-viewer-cloning-design-run-btn',
  'sequence-viewer-cloning-design-strategy-list',
  'sequence-viewer-cloning-design-edit-summary',
  'sequence-viewer-cloning-design-range-panel',
  'sequence-viewer-cloning-design-insert-start',
  'sequence-viewer-cloning-design-insert-end',
  'sequence-viewer-cloning-design-result',
  'sequence-viewer-primer-design-overlay',
  'sequence-viewer-primer-design-title',
  'sequence-viewer-primer-design-note',
  'sequence-viewer-primer-design-result',
  'sequence-viewer-primer-design-close',
  'sequence-viewer-primer-design-dismiss',
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

function bootVectorBuilder(features, options = {}, recordOverrides = {}) {
  const document = createMockDocument(VECTOR_BUILDER_IDS);
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = viewerModule.initSequenceViewer(options);
  viewer.loadFromExternal({
    name: 'pVector',
    sequence: 'ATGGCGCATCATCATCATCATCATTAAGGCCTTAACCGGTTACGTACGTAAGGCCTTAACC',
    topology: 'circular',
    source: 'external',
    features,
    ...recordOverrides
  });
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  return { document, viewer };
}

test('[EDGE] protein builder common blocks are unique and buildable into DNA', () => {
  const blocks = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'assembly-model.js')
  );
  const sequenceCalc = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'sequence.js')
  );

  const groups = {
    tag: blocks.PROTEIN_ASSEMBLY_TAGS,
    linker: blocks.PROTEIN_ASSEMBLY_LINKERS,
    cleavage: blocks.PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
    peptide2a: blocks.PROTEIN_ASSEMBLY_SELF_CLEAVING
  };
  const seenKeys = new Set();
  let count = 0;

  Object.entries(groups).forEach(([type, items]) => {
    assert.equal(Array.isArray(items) && items.length > 0, true, `${type} group is empty`);
    items.forEach((item) => {
      count += 1;
      const key = `${type}:${item.id}`;
      // Rows are looked up by `type:id`, so a duplicate would silently shadow.
      assert.equal(seenKeys.has(key), false, `duplicate block ${key}`);
      seenKeys.add(key);
      assert.equal(Boolean(item.label), true, `${key} has no label`);

      // Every block has to survive reverse translation, or adding it to a chain
      // produces a construct that cannot be built into DNA.
      assert.match(item.sequence, /^[ACDEFGHIKLMNPQRSTVWY]+$/, `${key} has non-standard residues`);
      const dna = sequenceCalc.reverseTranslateProteinSequence(item.sequence);
      assert.equal(Boolean(dna?.ok), true, `${key} failed reverse translation`);
      assert.equal(dna.dna.length, item.sequence.length * 3, `${key} produced the wrong codon count`);
    });
  });

  assert.equal(count > 40, true, 'expected the expanded block library');
  // 2A peptides skip between the final Gly and Pro; a sequence not ending NPGP
  // would not separate the products.
  groups.peptide2a.forEach((item) => {
    assert.match(item.sequence, /NPGP$/, `${item.label} does not end in the NPG/P skip motif`);
    // The GSG spacer is part of the block, not something the user adds.
    assert.match(item.sequence, /^GSG/, `${item.label} is missing its GSG spacer`);
  });
  // The default chain references these by id; renaming either would break startup.
  assert.equal(groups.tag.some((item) => item.id === 'his6'), true);
  assert.equal(groups.cleavage.some((item) => item.id === 'tev'), true);
});

test('[EDGE] protein builder reports 2A peptides as multiple products', () => {
  const construct = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'protein-construct.js')
  );

  const withoutSkip = construct.buildConstruct({
    activeDnaSource: { label: 'POI', proteinSequence: 'MAAAKLLL' },
    rows: [{ type: 'poi' }, { type: 'tag', label: '6xHis', sequence: 'HHHHHH' }]
  });
  assert.equal(withoutSkip.productCount, 1);
  assert.equal(withoutSkip.warnings.some((w) => /2A/.test(w)), false);

  const withSkip = construct.buildConstruct({
    activeDnaSource: { label: 'POI', proteinSequence: 'MAAAKLLL' },
    rows: [
      { type: 'poi' },
      { type: 'peptide2a', label: 'P2A', sequence: 'ATNFSLLKQAGDVEENPGP' },
      { type: 'tag', label: 'FLAG', sequence: 'DYKDDDDK' }
    ]
  });

  // The chain still builds as one ORF, but it must not be reported as one
  // protein: 2A skipping yields two polypeptides.
  assert.equal(withSkip.ok, true);
  assert.equal(withSkip.length, 8 + 19 + 8);
  assert.equal(withSkip.selfCleavingCount, 1);
  assert.equal(withSkip.productCount, 2);
  assert.match(
    withSkip.warnings.find((w) => /2A peptide/.test(w)) || '',
    /separates into 2 polypeptides/
  );

  // Two 2A blocks means three products.
  const twoSkips = construct.buildConstruct({
    activeDnaSource: { label: 'POI', proteinSequence: 'MAAA' },
    rows: [
      { type: 'poi' },
      { type: 'peptide2a', label: 'P2A', sequence: 'ATNFSLLKQAGDVEENPGP' },
      { type: 'poi' },
      { type: 'peptide2a', label: 'T2A', sequence: 'EGRGSLLTCGDVEENPGP' },
      { type: 'tag', label: 'FLAG', sequence: 'DYKDDDDK' }
    ]
  });
  assert.equal(twoSkips.productCount, 3);
});

test('[EDGE] sequence-viewer alignment workspace surfaces its status and reset control', () => {
  // These elements were referenced by the alignment controller but absent from
  // the markup, so query parsing, run status and Reset were all inert.
  const ids = [
    'sequence-viewer-alignment-workspace',
    'sequence-viewer-alignment-open-btn',
    'sequence-viewer-alignment-status',
    'sequence-viewer-alignment-reset-btn',
    'sequence-viewer-alignment-query-status',
    'sequence-viewer-alignment-query-summary',
    'sequence-viewer-alignment-query-file-name',
    'sequence-viewer-alignment-query-textarea',
    'sequence-viewer-alignment-run-btn',
    'sequence-viewer-status',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = viewerModule.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'pRef',
    sequence: 'ATGGCGCATCATCATCATCATCATTAAGGCCTTAACC',
    topology: 'circular',
    source: 'external',
    features: []
  });

  viewer.openSequencingAlignmentWorkspace();

  // Opening reports through the alignment status line, and Reset starts
  // disabled because there is nothing loaded to clear yet.
  assert.equal(document.getElementById('sequence-viewer-alignment-workspace').hidden, false);
  assert.match(document.getElementById('sequence-viewer-alignment-status').textContent, /\S/);
  assert.equal(document.getElementById('sequence-viewer-alignment-reset-btn').disabled, true);
  assert.equal(
    document.getElementById('sequence-viewer-alignment-query-file-name').textContent,
    'No query file selected'
  );
  assert.equal(
    document.getElementById('sequence-viewer-alignment-query-summary').textContent,
    'No query loaded.'
  );
  assert.match(document.getElementById('sequence-viewer-alignment-query-status').textContent, /\S/);
});

test('[EDGE] sequence-viewer status feedback uses a transient notice and Vector Builder note', () => {
  // setStatus() is shared by Annotate, backbone recognition, and Vector Builder
  // actions. The main workspace reports through the transient notice system.
  const document = createMockDocument([...VECTOR_BUILDER_IDS, 'sequence-viewer-vector-builder-status-note']);
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
    features: [{ name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] }]
  });

  const vectorStatus = document.getElementById('sequence-viewer-vector-builder-status-note');

  // Opening Vector Builder uses the shared notification system while the
  // Vector Builder retains its local note.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Vector Builder open for pVector/);
  assert.match(vectorStatus.textContent, /Vector Builder open for pVector/);
});

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
  // The derived sequence title may retain His6 as the deleted target; the
  // feature label itself must be gone from the map.
  assert.equal(/vector-map__label-text[^>]*>His6<\/text>/.test(map.innerHTML), false);
});

test('[EDGE] sequence-viewer Vector Builder cloning design sends the shared thermocycle page to Notebook', async () => {
  const template = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const insertion = 'ATGCGTACGATCCGATGCTAGCTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCG';
  let generatedId = 0;
  let persistCalls = 0;
  let notebookRefreshCalls = 0;
  const appState = {
    projects: [],
    protocols: [],
    notebookEntries: []
  };
  const { document } = bootVectorBuilder([
    { name: 'Edit site', type: 'misc_feature', strand: 1, source: 'external', segments: [{ start: 6, end: 22 }] }
  ], {
    state: appState,
    persist() {
      persistCalls += 1;
    },
    createId() {
      generatedId += 1;
      return `cloning_vector_${generatedId}`;
    },
    onNotebookEntriesChanged() {
      notebookRefreshCalls += 1;
    }
  }, {
    name: 'pVector_cloning_design',
    sequence: template
  });

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const editForm = document.getElementById('sequence-viewer-vector-builder-sequence-edit-form');
  const editTextarea = document.getElementById('sequence-viewer-vector-builder-sequence-edit-textarea');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  trigger(contextMenu, 'click', { target: contextActionTarget('insert-bases-three') });
  editTextarea.value = insertion;
  trigger(editForm, 'submit', { preventDefault() {} });
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-vector-builder-cloning-design-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-cloning-design-strategy-list'), 'click', {
    target: {
      closest(selector) {
        return selector === '[data-cloning-design-strategy]'
          ? { dataset: { cloningDesignStrategy: 'q5-kld' } }
          : null;
      }
    }
  });
  trigger(document.getElementById('sequence-viewer-cloning-design-run-btn'), 'click', { preventDefault() {} });

  assert.equal(document.getElementById('sequence-viewer-cloning-design-workspace').hidden, false);
  assert.equal(appState.notebookEntries.length, 1);
  assert.equal(persistCalls, 1);
  assert.equal(notebookRefreshCalls, 1);
  const notebookEntry = appState.notebookEntries[0];
  assert.equal(notebookEntry.protocolName, 'PCR Thermocycle Program');
  assert.match(notebookEntry.result, /Sequence Viewer cloning design/);
  assert.match(notebookEntry.result, /Ta: \d+ C/);
  assert.match(notebookEntry.result, /Extension time:/);
  assert.equal(notebookEntry.sequenceViewerCloningDesign.primerCount >= 2, true);
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
            { id: 'feat_empty', name: 'No sequence', type: 'CDS', sequence: '', sequenceLength: 0, hostCount: 1 },
            { id: 'feat_primer', name: 'M13 tag primer', type: 'primer_bind', sequence: 'GTAAAACGACGGCCAGT', sequenceLength: 17, hostCount: 4 }
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
  // Primer binding sites are annealing marks, not construct parts to splice in.
  assert.equal(/M13 tag primer/.test(results.innerHTML), false);

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

test('[EDGE] sequence-viewer vector builder inserts on the chosen side, in strand order', async () => {
  // His6 is forward 7-24; Terminator is reverse 31-50.
  const { document } = bootVectorBuilder([
    { name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
    { name: 'Terminator', type: 'terminator', strand: -1, source: 'external', segments: [{ start: 30, end: 50 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const note = document.getElementById('sequence-viewer-vector-builder-sequence-edit-note');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });

  // A span offers both sides; the caret-only case keeps a single entry.
  assert.match(contextMenu.innerHTML, /Insert Bases Before 5'\.\.\./);
  assert.match(contextMenu.innerHTML, /Insert Bases After 3'\.\.\./);
  assert.match(contextMenu.innerHTML, /Insert Protein Construct Before 5'/);
  assert.match(contextMenu.innerHTML, /Insert Protein Construct After 3'/);

  // Forward feature: 5' is the low coordinate (base 7), 3' the high one (24).
  trigger(contextMenu, 'click', { target: contextActionTarget('insert-bases-five') });
  assert.match(note.innerHTML, /\b7\b/);
  trigger(document.getElementById('sequence-viewer-vector-builder-sequence-edit-cancel'), 'click');

  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  trigger(contextMenu, 'click', { target: contextActionTarget('insert-bases-three') });
  assert.match(note.innerHTML, /\b25\b/);
  trigger(document.getElementById('sequence-viewer-vector-builder-sequence-edit-cancel'), 'click');

  // Reverse feature: the sides swap, because 5' sits at the higher coordinate.
  trigger(map, 'mousedown', { button: 0, target: featureTarget(1) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(1) });
  trigger(contextMenu, 'click', { target: contextActionTarget('insert-bases-five') });
  assert.match(note.innerHTML, /\b51\b/);
  trigger(document.getElementById('sequence-viewer-vector-builder-sequence-edit-cancel'), 'click');

  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(1) });
  trigger(contextMenu, 'click', { target: contextActionTarget('insert-bases-three') });
  assert.match(note.innerHTML, /\b31\b/);
});

test('[EDGE] sequence-viewer Primers toggle hides primers in both workspaces and keeps both boxes in step', () => {
  const { document } = bootVectorBuilder([
    { name: 'His6', type: 'CDS', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
    { name: 'M13 fwd', type: 'primer_bind', strand: 1, source: 'external', segments: [{ start: 30, end: 50 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const vectorToggle = document.getElementById('sequence-viewer-vector-builder-primers-toggle');
  const detailToggle = document.getElementById('sequence-viewer-primers-toggle');

  assert.match(map.innerHTML, /vector-map__primer/);
  assert.equal(vectorToggle.checked, true);

  vectorToggle.checked = false;
  trigger(vectorToggle, 'change');

  // The primer track is gone but the feature itself still renders, and hiding
  // must renumber cleanly rather than leave His6 pointing at the primer's index.
  assert.equal(/vector-map__primer/.test(map.innerHTML), false);
  assert.match(map.innerHTML, /data-feature-index="0"/);
  assert.equal(/data-feature-index="1"/.test(map.innerHTML), false);
  assert.equal(detailToggle.checked, false, 'detail toolbar box should follow the vector builder box');

  detailToggle.checked = true;
  trigger(detailToggle, 'change');
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });

  assert.match(map.innerHTML, /vector-map__primer/);
  assert.equal(vectorToggle.checked, true, 'vector builder box should follow the detail toolbar box');
});

test('[EDGE] sequence-viewer vector builder refuses to replace a primer binding site', () => {
  const { document } = bootVectorBuilder([
    { name: 'M13 fwd', type: 'primer_bind', strand: 1, source: 'external', segments: [{ start: 6, end: 24 }] },
    { name: 'Terminator', type: 'terminator', strand: -1, source: 'external', segments: [{ start: 30, end: 50 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const overlay = document.getElementById('sequence-viewer-vector-builder-feature-replace-overlay');
  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  trigger(contextMenu, 'click', { target: contextActionTarget('replace-feature') });

  // The primer is the only feature in range, so there is nothing to replace.
  assert.equal(overlay.hidden, true);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Primer binding sites cannot be replaced/);
});

test('[EDGE] sequence-viewer vector builder designs primers on the map and annotates them', async () => {
  const { document } = bootVectorBuilder([
    { name: 'Whole insert', type: 'misc_feature', strand: 1, source: 'external', segments: [{ start: 0, end: 61 }] }
  ]);

  const map = document.getElementById('sequence-viewer-vector-builder-map');
  const contextMenu = document.getElementById('sequence-viewer-vector-builder-context-menu');
  const overlay = document.getElementById('sequence-viewer-primer-design-overlay');
  const result = document.getElementById('sequence-viewer-primer-design-result');

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  assert.match(contextMenu.innerHTML, /Design Primer/);

  trigger(contextMenu, 'click', { target: contextActionTarget('design-primer') });
  await flushAsync();

  // The dialog is shared with the detail workspace, so it has to be reachable
  // while only the vector builder is visible.
  assert.equal(Boolean(overlay.hidden), false);
  assert.match(result.innerHTML, /Pcr Forward/);
  assert.match(result.innerHTML, /Pcr Reverse/);

  // Designing writes the pair onto the record, so the map redraws with the
  // primer track — the toggle's own track, only drawn for primer_bind features.
  assert.match(map.innerHTML, /vector-map__primer/);
  assert.match(map.innerHTML, /pVector 1-61 F/);
  assert.match(map.innerHTML, /pVector 1-61 R/);

  // Going back must not drag the dialog into the detail workspace.
  trigger(document.getElementById('sequence-viewer-vector-builder-back-btn'), 'click', { preventDefault() {} });
  assert.equal(Boolean(overlay.hidden), true);
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

  trigger(map, 'mousedown', { button: 0, target: featureTarget(0) });
  trigger(map, 'contextmenu', { clientX: 40, clientY: 40, target: featureTarget(0) });
  trigger(contextMenu, 'click', { target: contextActionTarget('protein-replace') });

  // Picking a site on the map hands off to Protein Builder with that target, and
  // the stored-backbone assembly steps aside while a vector target is pending.
  assert.equal(builderWorkspace.hidden, false);
  assert.equal(insertBtn.hidden, false);
  assert.equal(assembleBtn.hidden, true);
});

  }
};
