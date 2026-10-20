module.exports = function registerCursorMenuTests(context = {}) {
  const { assert, path, loadEsmStyleModule, createMockDocument, trigger, flushAsync, test } = context.scope;
  const root = context.__dirname || process.cwd();
  const load = (file) => loadEsmStyleModule(path.join(root, 'src/renderer/modules/sequence-viewer', file));
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const { rotateCircularSequenceRecord } = load('sequence-origin.js');
  const { complementBase } = load('shared.js');
  const { buildRecordGenbankText } = load('storage.js');
  const { parseGenBankRecords } = load('parsing.js');

  function featureSequence(record, feature) {
    const bases = feature.segments.map(segment => record.sequence.slice(segment.start, segment.end)).join('');
    return feature.strand === -1 ? [...bases].reverse().map(complementBase).join('') : bases;
  }

  test('[EDGE] setting plasmid origin preserves joined and reverse-strand feature sequences at every base', () => {
    const sequence = 'ATGAAACCCGGGTTTAAACGTCAGTGCATGCTAGCAT';
    const record = { name: 'origin_fixture', topology: 'circular', sequence,
      quality: Array.from({ length: sequence.length }, (_, i) => String.fromCharCode(33 + i)).join(''),
      features: [
        { id: 'plus', name: 'plus', type: 'cds', strand: 1, locationText: '3..17', segments: [{ start: 2, end: 17 }] },
        { id: 'minus', name: 'minus', type: 'cds', strand: -1, segments: [{ start: 9, end: 24 }] },
        { id: 'wrap', name: 'wrap', type: 'cds', strand: 1, segments: [{ start: sequence.length - 8, end: sequence.length }, { start: 0, end: 7 }] },
        { id: 'wrap-minus', name: 'wrap-minus', type: 'cds', strand: -1, segments: [{ start: sequence.length - 8, end: sequence.length }, { start: 0, end: 7 }] },
        { id: 'joined', name: 'joined', type: 'cds', strand: -1, segments: [{ start: 1, end: 7 }, { start: 20, end: 29 }] },
        { id: 'full', name: 'full', type: 'misc_feature', strand: 1, segments: [{ start: 0, end: sequence.length }] }
      ] };
    const before = JSON.stringify(record);
    for (let origin = 0; origin < sequence.length; origin++) {
      const rotated = rotateCircularSequenceRecord(record, origin);
      assert.equal(rotated.sequence, sequence.slice(origin) + sequence.slice(0, origin));
      assert.equal(rotated.quality, record.quality.slice(origin) + record.quality.slice(0, origin));
      assert.equal(rotated.name, record.name);
      assert.equal(rotated.features.length, record.features.length);
      const restored = parseGenBankRecords(buildRecordGenbankText(rotated)).records[0];
      assert.equal(restored.sequence, rotated.sequence);
      record.features.forEach((feature, index) => {
        const expected = featureSequence(record, feature);
        assert.equal(featureSequence(rotated, rotated.features[index]), expected, `${feature.id}, origin ${origin}`);
        assert.equal(featureSequence(restored, restored.features[index]), expected, `GenBank ${feature.id}, origin ${origin}`);
        assert.equal(rotated.features[index].id, feature.id);
        assert.equal(rotated.features[index].strand, feature.strand);
      });
    }
    assert.equal(JSON.stringify(record), before, 'rotation must leave the source record intact');
    assert.equal(rotateCircularSequenceRecord(record, sequence.length), record, 'end boundary is already the start');
    assert.throws(() => rotateCircularSequenceRecord({ ...record, topology: 'linear' }, 4), /Only circular/);
    assert.throws(() => rotateCircularSequenceRecord(record, null), /cursor position/);
    assert.throws(() => rotateCircularSequenceRecord(record, sequence.length + 1), /cursor position/);
  });

  test('[EDGE] changing plasmid origin saves the reindexed record and clears coordinate-dependent workflows', async () => {
    const { createSequenceEditActions } = load('runtime/sequence-edit-workflow.js');
    const { createInitialSequenceViewerState } = load('runtime/config.js');
    const state = createInitialSequenceViewerState();
    state.records = [{ name: 'saved_plasmid', topology: 'circular', sequence: 'AAAACCCCGGGG', features: [
      { id: 'feature', strand: -1, segments: [{ start: 2, end: 8 }] }
    ] }];
    state.activeEntryId = 'saved-entry';
    state.sequenceEditDesignSource = { editedSequence: state.records[0].sequence };
    state.cloningDesign = { plan: 'old coordinates' };
    state.vectorBuilder.insertTarget = { start: 4, end: 7 };
    state.sequenceSelectionAnchor = 2;
    state.sequenceSelectionFocus = 5;
    const saved = [];
    const ctx = { state, actions: {
      getSelectedRecord: () => state.records[0],
      resetAlignmentState: ({ preserveSessions }) => { assert.equal(preserveSessions, true); },
      persistFeatureMutation: async (record, message) => { saved.push({ record, message }); }
    }, controllers: { detail: {
      clearSequenceSelection: () => { state.sequenceSelectionAnchor = null; state.sequenceSelectionFocus = null; },
      hideFeatureContextMenu() {}, hideFeatureEditor() {}
    } } };
    await createSequenceEditActions(ctx).setSequenceOrigin(4);
    assert.equal(state.records[0].sequence, 'CCCCGGGGAAAA');
    assert.deepEqual(plain(state.records[0].features[0].segments), [{ start: 10, end: 12 }, { start: 0, end: 4 }]);
    assert.equal(state.sequenceCursorBase, 0);
    assert.equal(state.sequenceSelectionAnchor, null);
    assert.equal(state.sequenceEditDesignSource, null);
    assert.deepEqual(plain(state.cloningDesign), {});
    assert.equal(state.vectorBuilder.insertTarget, null);
    assert.equal(state.activeEntryId, 'saved-entry');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].record, state.records[0]);
    assert.match(saved[0].message, /former base 5/);
  });

  test('[EDGE] cursor context menu rotates circular sequences and inserts at the captured boundary', async () => {
    const ids = [
      'sequence-viewer-sequence-host', 'sequence-viewer-feature-context-menu', 'sequence-viewer-stat-length',
      'sequence-viewer-sequence-edit-overlay', 'sequence-viewer-sequence-edit-form', 'sequence-viewer-sequence-edit-title',
      'sequence-viewer-sequence-edit-note', 'sequence-viewer-sequence-edit-textarea', 'sequence-viewer-sequence-edit-input-wrap',
      'sequence-viewer-sequence-edit-delete-message', 'sequence-viewer-sequence-edit-confirm'
    ];
    const document = createMockDocument(ids);
    const { initSequenceViewer } = loadEsmStyleModule(path.join(root, 'src/renderer/modules/sequence-viewer/public-api.js'), { document });
    const viewer = initSequenceViewer();
    const host = document.getElementById('sequence-viewer-sequence-host');
    const menu = document.getElementById('sequence-viewer-feature-context-menu');
    const overlay = document.getElementById('sequence-viewer-sequence-edit-overlay');
    const line = { dataset: { lineStart: '0', lineEnd: '12' }, querySelector: () => ({
      getBoundingClientRect: () => ({ left: 20, width: 96 })
    }) };
    const target = { closest: selector => selector === '.sequence-viewer-dual-line' ? line : null };
    const clickAction = action => trigger(menu, 'click', { target: { closest: selector =>
      selector === '[data-sequence-cursor-action]' ? { dataset: { sequenceCursorAction: action } } : null } });
    viewer.loadFromExternal({ name: 'cursor_plasmid', topology: 'circular', sequence: 'AAAACCCCGGGG', features: [] });
    trigger(host, 'contextmenu', { target, clientX: 52, clientY: 84 });
    assert.equal(menu.hidden, false);
    assert.doesNotMatch(menu.innerHTML, /(?:Before|After) base/);
    assert.match(menu.innerHTML, /Set Sequence Start Here/);
    clickAction('set-origin');
    await flushAsync();
    assert.equal(menu.hidden, true);
    assert.ok(host.innerHTML.replace(/<[^>]*>/g, '').includes('CCCCGGGGAAAA'));
    assert.equal(document.getElementById('sequence-viewer-stat-length').textContent, '12');

    trigger(host, 'contextmenu', { target, clientX: 52, clientY: 84 });
    trigger(host, 'mouseleave');
    trigger(host, 'mousemove', { target, clientX: 84 });
    clickAction('insert');
    assert.equal(overlay.hidden, false);
    assert.equal(document.getElementById('sequence-viewer-sequence-edit-title').textContent, 'Insert Bases');
    assert.equal(document.getElementById('sequence-viewer-sequence-edit-textarea').value, '');
    document.getElementById('sequence-viewer-sequence-edit-textarea').value = 'AT';
    trigger(document.getElementById('sequence-viewer-sequence-edit-form'), 'submit');
    await flushAsync();
    assert.equal(overlay.hidden, true);
    assert.ok(host.innerHTML.replace(/<[^>]*>/g, '').includes('CCCCATGGGGAAAA'));

    viewer.loadFromExternal({ name: 'linear_sequence', topology: 'linear', sequence: 'AAAACCCCGGGG', features: [] });
    trigger(host, 'contextmenu', { target, clientX: 52, clientY: 84 });
    assert.match(menu.innerHTML, /Insert Sequence/);
    assert.doesNotMatch(menu.innerHTML, /set-origin/);
    clickAction('set-origin');
    await flushAsync();
    assert.ok(host.innerHTML.replace(/<[^>]*>/g, '').includes('AAAACCCCGGGG'));
  });
};
