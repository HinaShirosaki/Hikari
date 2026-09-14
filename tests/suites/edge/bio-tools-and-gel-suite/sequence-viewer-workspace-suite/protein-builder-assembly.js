module.exports = function registerEdgeSequenceViewerWorkspaceSuiteProteinBuilderAssembly(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer protein builder can open an assembled plasmid from a stored backbone', async () => {
  const storedBackboneSequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-cloning-design-workspace',
    'sequence-viewer-cloning-design-strategy-list',
    'sequence-viewer-cloning-design-back-btn',
    'sequence-viewer-cloning-design-confirm-btn',
    'sequence-viewer-vector-builder-btn',
    'sequence-viewer-vector-builder-protein-builder-btn',
    'sequence-viewer-protein-builder-back-btn',
    'sequence-viewer-protein-builder-form',
    'sequence-viewer-protein-builder-name',
    'sequence-viewer-protein-builder-build-dna-btn',
    'sequence-viewer-protein-builder-assemble-btn',
    'sequence-viewer-protein-builder-common-blocks',
    'sequence-viewer-protein-builder-feature-search-input',
    'sequence-viewer-protein-builder-feature-search-status',
    'sequence-viewer-protein-builder-feature-search-results',
    'sequence-viewer-protein-builder-meta',
    'sequence-viewer-protein-builder-workflow',
    'sequence-viewer-protein-builder-sequence',
    'sequence-viewer-protein-builder-dna-meta',
    'sequence-viewer-protein-builder-dna-sequence',
    'sequence-viewer-protein-builder-assembly-overlay',
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
    hikariApi: {
      sequenceLibraryListBackbones: async () => ({
        ok: true,
        results: [
          {
            id: 'stored_backbone_1',
            hostVectorName: 'HostVector',
            sourceRecordName: 'HostVector',
            backboneName: 'Backbone (HostVector)',
            backboneSequence: storedBackboneSequence,
            backboneLength: storedBackboneSequence.length,
            insertionOffset: 70,
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

  // Protein Builder is reached through Vector Builder now.
  trigger(document.getElementById('sequence-viewer-vector-builder-btn'), 'click', { preventDefault() {} });
  trigger(document.getElementById('sequence-viewer-vector-builder-protein-builder-btn'), 'click', { preventDefault() {} });

  const constructNameInput = document.getElementById('sequence-viewer-protein-builder-name');
  assert.equal(constructNameInput.value, '6xHis–TEV–PoiCds');
  constructNameInput.value = 'GFP Insert';
  trigger(document.getElementById('sequence-viewer-protein-builder-form'), 'input', { target: constructNameInput });
  await flushAsync();

  trigger(document.getElementById('sequence-viewer-protein-builder-assemble-btn'), 'click');
  await flushAsync();
  await flushAsync();

  const assemblyOverlay = document.getElementById('sequence-viewer-protein-builder-assembly-overlay');
  const assemblyList = document.getElementById('sequence-viewer-protein-builder-assembly-list');
  const assemblySummary = document.getElementById('sequence-viewer-protein-builder-assembly-summary');
  const confirmationBanner = document.getElementById('sequence-viewer-protein-builder-confirmation');
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

  assert.equal(Boolean(document.getElementById('sequence-viewer-detail-workspace').hidden), true);
  assert.equal(Boolean(document.getElementById('sequence-viewer-cloning-design-workspace').hidden), false);
  assert.equal(Boolean(confirmationBanner.hidden), true);
  assert.match(document.getElementById('sequence-viewer-cloning-design-strategy-list').innerHTML, /data-cloning-design-strategy="restriction-ligation"/);
  assert.doesNotMatch(document.getElementById('sequence-viewer-cloning-design-strategy-list').innerHTML, /data-cloning-design-strategy="whole-plasmid"/);
  assert.match(document.getElementById('sequence-viewer-stat-topology').textContent, /circular/i);
  assert.equal(Boolean(loadBtn.hidden), true);
  assert.equal(Boolean(pastePanel.hidden), true);
  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(textarea.value, '');
  // This fixture has no compatible restriction sites. Stay on its supported
  // route instead of silently falling back to Gibson or saving an invalid plan.
  assert.equal(Boolean(document.getElementById('sequence-viewer-cloning-design-confirm-btn').disabled), true);
  assert.equal(appState.notebookEntries.length, 0);
  assert.equal(persisted, false);
  assert.equal(notebookChangedCount, 0);
  trigger(document.getElementById('sequence-viewer-cloning-design-back-btn'), 'click', { preventDefault() {} });
  assert.equal(Boolean(document.getElementById('sequence-viewer-detail-workspace').hidden), false);
  assert.equal(Boolean(document.getElementById('sequence-viewer-cloning-design-workspace').hidden), true);
});
test('[EDGE] sequence-viewer protein builder confirm uses edited final sequence for cloning primers', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-protein-builder-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-cloning-design-workspace',
    'sequence-viewer-cloning-design-strategy-list',
    'sequence-viewer-cloning-design-back-btn',
    'sequence-viewer-cloning-design-confirm-btn',
    'sequence-viewer-protein-builder-confirmation',
    'sequence-viewer-protein-builder-confirmation-summary',
    'sequence-viewer-protein-builder-confirmation-back-btn',
    'sequence-viewer-protein-builder-confirmation-confirm-btn',
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
    'sequence-viewer-save-name',
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
  const appState = { projects: [], protocols: [], notebookEntries: [] };
  let persisted = false;
  let changedCount = 0;
  const viewer = moduleWithDom.initSequenceViewer({
    state: appState,
    persist: () => {
      persisted = true;
    },
    createId: () => 'edited-final-plan-id',
    onNotebookEntriesChanged: () => {
      changedCount += 1;
    }
  });
  const leftFlank = 'ATGCGTACGATCGTACGATCGTACGATCGA';
  const rightFlank = 'GTGCTAGCTGGCCAGACATGATAAGATACATTG';
  const upstreamBackbone = `TTTTTATATATATATATATAT${leftFlank}`;
  const downstreamBackbone = `${rightFlank}GGCCGATATATATATATCGCGCGC`;
  const originalTag = 'ATGCACCACCACCACCACCACGAAAACCTGTACTTC';
  const editedTag = `${originalTag}GCCGCC`;
  const sourceCds = 'CAGGGCGCGTTTACCGTGACCGTGCCGAAAGATCTGTACGTGGTGGAATACGGCAGCAACATGACC';
  const originalInsert = `${originalTag}${sourceCds}`;
  const editedInsert = `${editedTag}${sourceCds}`;
  const backboneSequence = `${upstreamBackbone}${downstreamBackbone}`;
  const originalSequence = `${upstreamBackbone}${originalInsert}${downstreamBackbone}`;
  const editedSequence = `${upstreamBackbone}${editedInsert}${downstreamBackbone}`;
  const confirmation = {
    recordName: 'Tagged-POI (Host Backbone)',
    constructName: 'Tagged-POI',
    backboneName: 'Host Backbone',
    plasmidLength: originalSequence.length,
    insertLength: originalInsert.length,
    notebookEntryId: 'edited-final-plan',
    cloningDesignSource: {
      constructName: 'Tagged-POI',
      backbone: {
        hostVectorName: 'Host Backbone',
        topology: 'circular',
        variantMode: 'gibson',
        insertionOffset: upstreamBackbone.length,
        backboneSequence
      },
      dnaConstruct: {
        sequence: originalInsert,
        length: originalInsert.length,
        parts: [
          { label: '6xHis-TEV', dnaSequence: originalTag, length: originalTag.length },
          { label: 'PD-L1', dnaSequence: sourceCds, templateSequence: sourceCds, length: sourceCds.length }
        ]
      },
      assembledRecord: {
        name: 'Tagged-POI (Host Backbone)',
        sequence: originalSequence,
        topology: 'circular',
        features: []
      }
    }
  };

  viewer.loadFromExternal({
    name: 'Tagged-POI (Host Backbone)',
    sequence: editedSequence,
    topology: 'circular',
    source: 'protein_builder',
    features: [
      {
        id: 'protein_builder_backbone',
        name: 'Backbone (Host Backbone)',
        type: 'backbone',
        strand: 1,
        source: 'protein_builder',
        segments: [
          { start: 0, end: upstreamBackbone.length },
          { start: upstreamBackbone.length + editedInsert.length, end: editedSequence.length }
        ]
      },
      {
        id: 'protein_builder_insert',
        name: 'Tagged-POI',
        type: 'insert',
        strand: 1,
        source: 'protein_builder',
        segments: [{ start: upstreamBackbone.length, end: upstreamBackbone.length + editedInsert.length }]
      }
    ]
  }, {
    proteinBuilderConfirmation: confirmation
  });

  await flushAsync();
  assert.equal(Boolean(document.getElementById('sequence-viewer-cloning-design-workspace').hidden), false);
  assert.match(document.getElementById('sequence-viewer-cloning-design-strategy-list').innerHTML, /data-cloning-design-strategy="gibson"/);

  assert.equal(persisted, true);
  assert.equal(changedCount, 1);
  assert.equal(appState.notebookEntries.length, 2);
  assert.equal(appState.notebookEntries[1].cloningReactionStep.stepId, 'gibson');
  assert.equal(appState.notebookEntries[0].proteinBuilderCloningDesign.insertLength, editedInsert.length);
  assert.equal(appState.notebookEntries[0].proteinBuilderCloningDesign.assembledLength, editedSequence.length);
  // The edited 42 nt tag is shared across the vector and insert primers while
  // both annealing regions stay on the selected physical templates.
  const forwardPrimer = appState.notebookEntries[0].resultTable.rows.find((row) => row.name === '6xHis Tagged-POI F');
  assert.equal(Boolean(forwardPrimer), true);
  assert.equal(appState.notebookEntries[0].resultTable.rows.length, 4);
  assert.equal(appState.notebookEntries[0].resultTable.rows.every((row) => Number(row.length) <= 60), true);
  assert.match(appState.notebookEntries[0].result, /Shares introduction of the 42 nt added flank/i);
  assert.doesNotMatch(appState.notebookEntries[0].result, /must be ordered as synthetic DNA/i);
});
  }
};
