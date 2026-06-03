module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart07(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  assert.equal(document.getElementById('sequence-viewer-alignment-active-note').textContent, '');
  assert.match(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);

  alignmentToggle.checked = false;
  trigger(alignmentToggle, 'change');
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);

  alignmentToggle.checked = true;
  trigger(alignmentToggle, 'change');
  assert.match(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);
});
test('[EDGE] sequence-viewer shows the AB1 chromatogram panel for an active sequencing alignment', async () => {
  const document = createMockDocument([
    'sequence-viewer-alignment-trace-panel',
    'sequence-viewer-alignment-trace-host'
  ]);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer({ document });
  viewer.loadFromExternal({
    name: 'RefSeq',
    sequence: 'GGGACGTACGTCCC',
    topology: 'linear',
    source: 'external',
    features: []
  });

  viewer.openSequencingAlignmentWorkspace();
  await viewer.loadSequencingAlignmentQuery({
    name: 'trace_ab1.ab1',
    sourceKind: 'file',
    record: {
      name: 'trace_ab1',
      sourceFormat: 'ab1',
      topology: 'linear',
      sequence: 'ACGTTCGT',
      quality: 'IIIIIIII',
      trace: {
        positions: [2, 5, 8, 11, 14, 17, 20, 23],
        channels: [
          { base: 'A', values: [0, 9, 2, 1, 0, 1, 0, 0, 6, 1, 0, 0, 0, 0, 1, 0, 9, 2, 0, 0, 0, 0, 0, 0] },
          { base: 'C', values: [0, 1, 7, 1, 0, 8, 2, 0, 1, 9, 1, 0, 0, 2, 8, 1, 0, 7, 2, 0, 0, 8, 2, 0] },
          { base: 'G', values: [0, 0, 1, 8, 0, 1, 7, 1, 0, 1, 8, 1, 0, 0, 2, 8, 0, 1, 8, 1, 0, 1, 7, 1] },
          { base: 'T', values: [0, 0, 0, 1, 7, 1, 0, 8, 2, 0, 1, 9, 2, 0, 8, 1, 0, 0, 2, 9, 1, 0, 1, 8] }
        ]
      }
    }
  });
  const result = await viewer.runSequencingAlignment();
  await flushAsync();

  const panel = document.getElementById('sequence-viewer-alignment-trace-panel');
  const host = document.getElementById('sequence-viewer-alignment-trace-host');
  assert.equal(Boolean(result), true);
  assert.equal(Boolean(panel.hidden), false);
  assert.match(host.innerHTML, /trace_ab1/);
  assert.match(host.innerHTML, /sequence-viewer-alignment-trace-svg/);
  assert.match(host.innerHTML, /sequence-viewer-trace-line-a/);
  assert.match(host.innerHTML, /sequence-viewer-trace-diff-mismatch/);
});
  }
};
