module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart06(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  const upsertBackboneCalls = [];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryUpsertBackbone: async (payload) => {
        upsertBackboneCalls.push(payload);
        return {
          ok: true,
          id: 'recognized_backbone_host',
          filePath: '/tmp/sequence-viewer-tests/SequenceViewer/protein-builder-backbones.json',
          relativePath: 'SequenceViewer/protein-builder-backbones.json'
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
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Review promoter \/ ORF candidates/i);

  trigger(dialogApplyBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(Number(statFeatures.textContent || 0), initialFeatureCount);
  assert.equal(featureRailHost.innerHTML.includes('T7 promoter'), false);
  assert.equal(featureRailHost.innerHTML.includes('Backbone (HostVector)'), false);
  assert.equal(featureDetail.innerHTML.includes('Insert (HostVector)'), false);
  assert.equal(upsertBackboneCalls.length, 1);
  assert.equal(upsertBackboneCalls[0].storagePath, '/tmp/sequence-viewer-tests');
  assert.equal(upsertBackboneCalls[0].backbone?.recognition?.variant_mode, 'gibson');
  assert.equal(upsertBackboneCalls[0].backbone?.recognition?.promoter_name, 'T7 promoter');
  assert.equal(upsertBackboneCalls[0].backbone?.backbone?.sequence_length, 24);
  assert.equal(upsertBackboneCalls[0].backbone?.insert?.sequence_length, 6);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Stored a Protein Builder backbone selection/i);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /original sequence was left unchanged/i);
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
    hikariApi: {
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
    name: 'annotate_me',
    sequence: 'GGGTTGACCATGAAAGGGTAA',
    source: 'external',
    features: []
  });

  const annotateBtn = document.getElementById('sequence-viewer-annotate-btn');
  const featureRailHost = document.getElementById('sequence-viewer-feature-rail-host');
  const featureDetail = document.getElementById('sequence-viewer-feature-detail');
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
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Save the record to persist changes/);
});
test('[EDGE] sequence-viewer annotation includes the active saved entry and reports existing matches accurately', async () => {
  const annotationModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'annotation.js')
  );
  const record = {
    name: 'already_annotated',
    sequence: 'GGGTTGACATATAATCCC',
    topology: 'linear',
    features: [{
      id: 'existing_promoter',
      name: 'StrongPromoter',
      type: 'promoter',
      strand: 1,
      source: 'genbank',
      segments: [{ start: 3, end: 15 }]
    }]
  };
  const state = {
    records: [record],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    activeEntryId: 'seq_self',
    isAnnotating: false
  };
  const annotateCalls = [];
  const statuses = [];
  const controller = annotationModule.createSequenceViewerAnnotationController({
    state,
    getSelectedRecord: () => state.records[0],
    getStoragePath: () => '/tmp/sequence-viewer-tests',
    getBridge: () => ({
      sequenceLibraryAnnotate: async (payload) => {
        annotateCalls.push(payload);
        return {
          ok: true,
          dnaMatches: [{
            featureId: 'feature_promoter',
            name: 'StrongPromoter',
            type: 'promoter',
            strand: 1,
            segments: [{ start: 3, end: 15 }]
          }],
          proteinMatches: []
        };
      }
    }),
    detailController: {
      clearSequenceSelection() {},
      hideFeatureContextMenu() {},
      hideFeatureEditor() {},
      renderActiveRecord() {},
      syncActionButtonsState() {}
    },
    setStatus: (message) => statuses.push(message)
  });

  await controller.annotateCurrentRecord();

  assert.equal(annotateCalls.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(annotateCalls[0], 'excludeEntryId'), false);
  assert.equal(state.records[0].features.length, 1);
  assert.equal(state.records[0].features[0].source, 'genbank');
  assert.match(statuses.at(-1), /1 SQL-backed annotation match is already present/i);
  assert.doesNotMatch(statuses.at(-1), /No SQL-backed annotations matched/i);
});
test('[EDGE] sequence-viewer clears the successful saved annotation status', async () => {
  const annotationModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'annotation.js')
  );
  const persistenceModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'runtime', 'library-persistence.js')
  );
  const record = {
    name: 'Protein_Builder__4',
    sequence: 'GGGTTGACATATAATCCC',
    topology: 'linear',
    sourceFormat: 'genbank',
    features: []
  };
  const state = {
    records: [record],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    activeEntryId: 'seq_saved',
    activeEntryStatus: 'saved',
    isAnnotating: false
  };
  const statuses = [];
  const bridge = {
    sequenceLibraryAnnotate: async () => ({
      ok: true,
      dnaMatches: [{
        featureId: 'feature_promoter',
        name: 'StrongPromoter',
        type: 'promoter',
        strand: 1,
        segments: [{ start: 3, end: 15 }]
      }],
      proteinMatches: []
    }),
    sequenceLibraryUpsert: async () => ({
      ok: true,
      entry: { id: 'seq_saved', name: 'Protein_Builder__4', status: 'saved' }
    })
  };
  const actions = {
    getBridge: () => bridge,
    getStoragePath: () => '/tmp/sequence-viewer-tests',
    setAlignmentSessions() {},
    setStatus: (message) => statuses.push(message)
  };
  const persistence = persistenceModule.createLibraryPersistenceActions({
    state,
    actions,
    controllers: { home: { refreshLibraryEntries: async () => {} } }
  });
  const controller = annotationModule.createSequenceViewerAnnotationController({
    state,
    getSelectedRecord: () => state.records[0],
    getStoragePath: actions.getStoragePath,
    getBridge: actions.getBridge,
    persistFeatureMutation: persistence.persistFeatureMutation,
    detailController: {
      clearSequenceSelection() {},
      findFeatureIndexByIdentity: () => 0,
      getVisibleFeaturesForRecord: (current) => current.features,
      hideFeatureContextMenu() {},
      hideFeatureEditor() {},
      renderActiveRecord() {},
      syncActionButtonsState() {}
    },
    setStatus: actions.setStatus
  });

  await controller.annotateCurrentRecord();

  assert.equal(state.records[0].features.length, 1);
  assert.equal(statuses.at(-1), '');
  assert.equal(statuses.some((message) => /Saved to Protein_Builder__4/i.test(message)), false);
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
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
  assert.equal(document.getElementById('sequence-viewer-alignment-active-note').textContent, '');
});
  }
};
