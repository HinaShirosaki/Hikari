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
    hikariApi: {
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
  assert.match(sequenceHost.innerHTML, /sequence-viewer-alignment-query-row/);
  const topRowIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-strand-row-top');
  const queryRowIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-alignment-query-row');
  const bottomRowIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-strand-row-bottom');
  assert.equal(topRowIndex < queryRowIndex && queryRowIndex < bottomRowIndex, true);

  alignmentToggle.checked = false;
  trigger(alignmentToggle, 'change');
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-alignment-query-row/);

  alignmentToggle.checked = true;
  trigger(alignmentToggle, 'change');
  assert.match(sequenceHost.innerHTML, /sequence-viewer-seq-highlight-alignment/);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-alignment-query-row/);
});
test('[EDGE] sequence-viewer detail view no longer includes the standalone alignment trace panel', () => {
  const detailViewSource = readSource('ui/html/views/sequence-viewer-detail-view.html');
  const publicApiSource = readSource('src/renderer/modules/sequence-viewer/public-api.js');
  assert.doesNotMatch(detailViewSource, /sequence-viewer-alignment-trace-panel/);
  assert.doesNotMatch(detailViewSource, /sequence-viewer-alignment-trace-host/);
  assert.doesNotMatch(publicApiSource, /renderAlignmentTracePanelHtml/);
});
test('[EDGE] sequence-viewer shows the AB1 chromatogram inline for an active sequencing alignment', async () => {
  const document = createMockDocument();
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer({ document });
  const referenceSequence = 'ACGT'.repeat(70);
  const querySequence = `${referenceSequence.slice(0, 10)}T${referenceSequence.slice(11)}`;
  const positions = Array.from({ length: querySequence.length }, (_item, index) => 2 + (index * 3));
  const sampleCount = positions[positions.length - 1] + 4;
  const channels = ['A', 'C', 'G', 'T'].map((base) => {
    const values = Array.from({ length: sampleCount }, () => 0);
    for (let index = 0; index < querySequence.length; index += 1) {
      const position = positions[index];
      const matchesBase = querySequence[index] === base;
      values[position] = matchesBase ? 9 : 1;
      if (matchesBase && position > 0) {
        values[position - 1] = 3;
      }
      if (matchesBase && position + 1 < values.length) {
        values[position + 1] = 3;
      }
    }
    return { base, values };
  });
  viewer.loadFromExternal({
    name: 'RefSeq',
    sequence: referenceSequence,
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
      sequence: querySequence,
      quality: 'I'.repeat(querySequence.length),
      trace: {
        positions,
        channels
      }
    }
  });
  const result = await viewer.runSequencingAlignment();
  await flushAsync();

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  assert.equal(Boolean(result), true);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-inline-trace-row/);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-inline-trace-svg/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-inline-alignment-trace/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-alignment-trace-scroll/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-trace-base-call/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-trace-base-tick/);
  assert.doesNotMatch(sequenceHost.innerHTML, /sequence-viewer-trace-diff-mismatch/);
  assert.equal((sequenceHost.innerHTML.match(/sequence-viewer-inline-trace-row/g) || []).length > 1, true);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-trace-line-a/);
  assert.match(sequenceHost.innerHTML, /sequence-viewer-alignment-query-base-mismatch/);
  const topIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-strand-row-top');
  const traceIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-inline-trace-row');
  const queryIndex = sequenceHost.innerHTML.indexOf('sequence-viewer-alignment-query-row');
  assert.equal(topIndex < traceIndex && traceIndex < queryIndex, true);
});
  }
};
