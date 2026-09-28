module.exports = function registerEdgeSequenceViewerInteractionsSuiteKeyboardEditingAndCloningNotebook(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    path,
    loadEsmStyleModule,
    createMockDocument,
    trigger,
    flushAsync,
    test
  } = scope;
function stripHtmlTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
function createRecordServices(state) {
  return {
    ensureProjectRecord(record) {
      const existing = state.projects.find((project) => (
        project.source === record.source || project.name === record.name
      ));
      if (existing) return existing;
      state.projects.push(record);
      return record;
    },
    saveProtocolRecord(record) {
      const index = state.protocols.findIndex((protocol) => protocol.id === record.id);
      if (index >= 0) {
        state.protocols[index] = { ...state.protocols[index], ...record };
        return state.protocols[index];
      }
      state.protocols.push(record);
      return record;
    }
  };
}
test('[EDGE] sequence-viewer keyboard inserts at cursor and confirms selected-base deletion', async () => {
  const ids = [
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
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-sequence-edit-overlay',
    'sequence-viewer-sequence-edit-form',
    'sequence-viewer-sequence-edit-title',
    'sequence-viewer-sequence-edit-note',
    'sequence-viewer-sequence-edit-input-wrap',
    'sequence-viewer-sequence-edit-textarea',
    'sequence-viewer-sequence-edit-delete-message',
    'sequence-viewer-sequence-edit-confirm',
    'sequence-viewer-sequence-edit-close',
    'sequence-viewer-sequence-edit-cancel'
  ];
  const listeners = {};
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    {
      document,
      addEventListener(type, listener) {
        listeners[type] = [...(listeners[type] || []), listener];
      },
      setTimeout(callback) {
        callback();
      }
    }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'keyboard_insert_delete',
    sequence: 'ACGTACGTACGT',
    source: 'external',
    features: []
  });

  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const editOverlay = document.getElementById('sequence-viewer-sequence-edit-overlay');
  const editForm = document.getElementById('sequence-viewer-sequence-edit-form');
  const editTitle = document.getElementById('sequence-viewer-sequence-edit-title');
  const editTextarea = document.getElementById('sequence-viewer-sequence-edit-textarea');
  const deleteMessage = document.getElementById('sequence-viewer-sequence-edit-delete-message');
  const statLength = document.getElementById('sequence-viewer-stat-length');

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '12' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 96 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };
  const dispatchGlobalKeydown = (event) => {
    (listeners.keydown || []).forEach((listener) => {
      listener({
        preventDefault() {},
        stopPropagation() {},
        target: {},
        ...event
      });
    });
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 52, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'c' });

  assert.equal(Boolean(editOverlay.hidden), false);
  assert.equal(editTitle.textContent, 'Insert Bases');
  assert.equal(editTextarea.value, 'C');

  editTextarea.value = 'TT';
  // Edits re-render the sequence; the viewport must not jump back to the top.
  sequenceHost.scrollTop = 120;
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(sequenceHost.scrollTop, 120);
  assert.equal(statLength.textContent, '14');
  assert.equal(stripHtmlTags(sequenceHost.innerHTML).includes('ACGTTTACGTACGT'), true);

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 28, target: lineTarget });
  trigger(sequenceHost, 'mousemove', { clientX: 60, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'Delete' });

  assert.equal(Boolean(editOverlay.hidden), false);
  assert.equal(editTitle.textContent, 'Delete Bases');
  assert.equal(Boolean(deleteMessage.hidden), false);
  assert.equal(stripHtmlTags(deleteMessage.innerHTML), 'Delete 4 bp?');

  sequenceHost.scrollTop = 120;
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(sequenceHost.scrollTop, 120);
  assert.equal(Boolean(editOverlay.hidden), true);
  assert.equal(statLength.textContent, '10');
  assert.equal(stripHtmlTags(sequenceHost.innerHTML).includes('ATACGTACGT'), true);
});
test('[EDGE] sequence-viewer right-click changes a translated amino acid through its codon', async () => {
  const ids = [
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
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-orf-toggle'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  const sequence = `ATG${'AAA'.repeat(80)}TAA`;
  viewer.loadFromExternal({
    name: 'amino_acid_edit',
    sequence,
    source: 'external',
    features: []
  });

  const orfToggle = document.getElementById('sequence-viewer-orf-toggle');
  const featureRail = document.getElementById('sequence-viewer-feature-rail-host');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const contextMenu = document.getElementById('sequence-viewer-feature-context-menu');

  orfToggle.checked = true;
  trigger(orfToggle, 'change');
  const orfFeatureTarget = {
    closest(selector) {
      return selector === '[data-feature-index]'
        ? { dataset: { featureIndex: '0' } }
        : null;
    }
  };
  trigger(featureRail, 'click', { target: orfFeatureTarget });

  assert.match(sequenceHost.innerHTML, /data-aa="K"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon="AAA"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon-positions="3,4,5"/);

  let contextMenuPrevented = false;
  const aminoAcidTarget = {
    dataset: {
      aa: 'K',
      aaCodon: 'AAA',
      aaCodonPositions: '3,4,5',
      aaStrand: '1'
    },
    closest(selector) {
      return selector === '[data-aa-codon-positions]' ? this : null;
    }
  };
  trigger(sequenceHost, 'contextmenu', {
    target: aminoAcidTarget,
    clientX: 120,
    clientY: 80,
    preventDefault() {
      contextMenuPrevented = true;
    }
  });

  assert.equal(contextMenuPrevented, true);
  assert.equal(Boolean(contextMenu.hidden), false);
  assert.match(contextMenu.innerHTML, /Change to \(uses the codon with the fewest DNA substitutions\)/);
  assert.match(contextMenu.innerHTML, /data-sequence-aa-replacement="E"/);
  assert.match(contextMenu.innerHTML, /Glutamic acid \(E\) - GAA/);

  const glutamateTarget = {
    dataset: { sequenceAaReplacement: 'E' },
    closest(selector) {
      return selector === '[data-sequence-aa-replacement]' ? this : null;
    }
  };
  trigger(contextMenu, 'click', { target: glutamateTarget });
  await flushAsync();
  await flushAsync();

  assert.equal(Boolean(contextMenu.hidden), true);
  assert.match(sequenceHost.innerHTML, /data-aa="E"/);
  assert.match(sequenceHost.innerHTML, /data-aa-codon="GAA"/);
  assert.match(document.querySelector('[data-hikari-transient-toast]').textContent, /Changed amino acid K \(AAA\) to E \(GAA\) at bases 4-6/);
});
test('[EDGE] sequence-viewer detail cloning design renders primers and sends a thermocycle page to Notebook', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-cloning-design-workspace',
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
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host',
    'sequence-viewer-feature-context-menu',
    'sequence-viewer-feature-editor-overlay',
    'sequence-viewer-sequence-edit-overlay',
    'sequence-viewer-sequence-edit-form',
    'sequence-viewer-sequence-edit-title',
    'sequence-viewer-sequence-edit-note',
    'sequence-viewer-sequence-edit-input-wrap',
    'sequence-viewer-sequence-edit-textarea',
    'sequence-viewer-sequence-edit-delete-message',
    'sequence-viewer-sequence-edit-confirm',
    'sequence-viewer-sequence-edit-close',
    'sequence-viewer-sequence-edit-cancel',
    'sequence-viewer-cloning-design-btn',
    'sequence-viewer-cloning-design-back-btn',
    'sequence-viewer-cloning-design-status',
    'sequence-viewer-cloning-design-run-btn',
    'sequence-viewer-cloning-design-strategy-list',
    'sequence-viewer-cloning-design-edit-summary',
    'sequence-viewer-cloning-design-range-panel',
    'sequence-viewer-cloning-design-insert-start',
    'sequence-viewer-cloning-design-insert-end',
    'sequence-viewer-cloning-design-result'
  ];
  let copiedText = '';
  let persistCalls = 0;
  let notebookRefreshCalls = 0;
  let generatedId = 0;
  const appState = {
    projects: [],
    protocols: [],
    notebookEntries: []
  };
  const listeners = {};
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    {
      document,
      addEventListener(type, listener) {
        listeners[type] = [...(listeners[type] || []), listener];
      },
      setTimeout(callback) {
        callback();
      },
      navigator: {
        clipboard: {
          writeText: async (value) => {
            copiedText = String(value || '');
          }
        }
      }
    }
  );
  const viewer = moduleWithDom.initSequenceViewer({
    state: appState,
    ...createRecordServices(appState),
    persist() {
      persistCalls += 1;
    },
    createId() {
      generatedId += 1;
      return `cloning_detail_${generatedId}`;
    },
    onNotebookEntriesChanged() {
      notebookRefreshCalls += 1;
    }
  });
  viewer.loadFromExternal({
    name: 'cloning_design_edit',
    topology: 'circular',
    sequence: 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
      + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA',
    source: 'external',
    features: []
  });

  const cloningDesignBtn = document.getElementById('sequence-viewer-cloning-design-btn');
  const cloningWorkspace = document.getElementById('sequence-viewer-cloning-design-workspace');
  const detailWorkspace = document.getElementById('sequence-viewer-detail-workspace');
  const sequenceHost = document.getElementById('sequence-viewer-sequence-host');
  const editForm = document.getElementById('sequence-viewer-sequence-edit-form');
  const editTextarea = document.getElementById('sequence-viewer-sequence-edit-textarea');
  const resultHost = document.getElementById('sequence-viewer-cloning-design-result');
  const strategyList = document.getElementById('sequence-viewer-cloning-design-strategy-list');
  const runButton = document.getElementById('sequence-viewer-cloning-design-run-btn');

  assert.equal(Boolean(cloningDesignBtn.hidden), true);

  const lineElement = {
    dataset: { lineStart: '0', lineEnd: '49' },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { left: 20, width: 392 };
        }
      };
    }
  };
  const lineTarget = {
    closest(selector) {
      if (selector === '.sequence-viewer-dual-line') {
        return lineElement;
      }
      return null;
    }
  };
  const dispatchGlobalKeydown = (event) => {
    (listeners.keydown || []).forEach((listener) => {
      listener({
        preventDefault() {},
        stopPropagation() {},
        target: {},
        ...event
      });
    });
  };

  trigger(sequenceHost, 'mousedown', { button: 0, clientX: 300, target: lineTarget });
  trigger(sequenceHost, 'mouseup', { target: lineTarget });
  dispatchGlobalKeydown({ key: 'c' });

  editTextarea.value = 'ATGCGTACGATCCGATGCTAGCTACGATCGTACCTGACTGATCGTAGCTA';
  trigger(editForm, 'submit');
  await flushAsync();

  assert.equal(Boolean(cloningDesignBtn.hidden), false);

  trigger(cloningDesignBtn, 'click');
  assert.equal(Boolean(cloningWorkspace.hidden), false);
  assert.equal(Boolean(detailWorkspace.hidden), true);
  assert.equal(appState.notebookEntries.length, 0);
  trigger(strategyList, 'click', {
    target: {
      closest(selector) {
        return selector === '[data-cloning-design-strategy]'
          ? { dataset: { cloningDesignStrategy: 'q5-kld' } }
          : null;
      }
    }
  });
  trigger(runButton, 'click');
  assert.equal(resultHost.innerHTML.includes('sequence-viewer-cloning-design-primer-table'), true, resultHost.innerHTML);
  // Bench-style name: the record (no CDS here), what the edit does, then F.
  assert.match(resultHost.innerHTML, /cloning_design_edit .*ins50 F/);
  assert.equal(resultHost.innerHTML.includes('tile_outer_left'), false);
  // The PCR page, plus the KLD tube the Q5/KLD route ends in.
  assert.equal(appState.notebookEntries.length, 2);
  assert.deepEqual(
    Array.from(appState.protocols).map((protocol) => protocol.name),
    ['PCR Thermocycle Program', 'KLD Treatment']
  );
  assert.equal(appState.projects.length, 1);
  assert.equal(persistCalls, 1);
  assert.equal(notebookRefreshCalls, 1);
  const notebookEntry = appState.notebookEntries[0];
  assert.equal(notebookEntry.projectName, 'Sequence Viewer');
  assert.equal(notebookEntry.protocolName, 'PCR Thermocycle Program');
  assert.match(notebookEntry.experimentName, /cloning_design_edit .*cloning primer design/);
  assert.match(notebookEntry.result, /PCR thermocycle programs/);
  assert.match(notebookEntry.result, /Ta: \d+ C/);
  assert.match(notebookEntry.result, /Extension time: \d+(?: s| min(?: \d+ s)?) at 72 C/);
  assert.equal(
    notebookEntry.protocolSnapshot.steps.some((step) => /Annealing \(Ta\) - \d+ C - 20 s/.test(step.text)),
    true
  );
  assert.equal(
    notebookEntry.protocolSnapshot.steps.some((step) => /Extension - 72 C - \d+(?: min)?(?: \d+ s)?/.test(step.text)),
    true
  );
  assert.equal(notebookEntry.resultTable.rows.length >= 2, true);
  const cloningCopyButtons = resultHost.querySelectorAll('[data-sequence-primer-copy]');
  assert.equal(cloningCopyButtons.length >= 4, true);
  trigger(resultHost, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-sequence-primer-copy]') {
          return cloningCopyButtons[1];
        }
        return null;
      }
    }
  });
  await flushAsync();
  assert.equal(copiedText, cloningCopyButtons[1].dataset.sequencePrimerCopy);
});
test('[EDGE] sequence-viewer two-step cloning notebook keeps distinct PCR thermocycle programs', () => {
  const notebookModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design-notebook.js')
  );
  const sequence = 'A'.repeat(6000);
  const source = {
    recordName: 'two_step_vector',
    originalSequence: sequence,
    editedSequence: sequence,
    editRequest: {
      type: 'point-mutation',
      start: 3001,
      end: 3001,
      originalSequence: 'A',
      editedSequence: 'C'
    }
  };
  const displayPlan = {
    strategy: 'two-step-ligation',
    feasible: true,
    primers: [
      { name: 'mutagenesis_F', role: 'mutagenesis-forward', sequence: 'ACGT'.repeat(6), length: 24, tm: 62, gcContent: 50, groupLabel: 'PCR 1' },
      { name: 'site_R', role: 'restriction-reverse', sequence: 'TGCA'.repeat(6), length: 24, tm: 64, gcContent: 50, groupLabel: 'PCR 1' },
      { name: 'site_F', role: 'restriction-forward', sequence: 'GATC'.repeat(6), length: 24, tm: 60, gcContent: 50, groupLabel: 'PCR 2' }
    ],
    plans: [{
      label: 'Megaprimer restriction cloning',
      plan: {
        restrictionEnzymeSelection: [
          { name: 'Upstream', site: 'AAAAAA', segments: [{ start: 100, end: 106 }] },
          { name: 'Downstream', site: 'CCCCCC', segments: [{ start: 5100, end: 5106 }] }
        ],
        stepByStepProcedure: []
      }
    }],
    summary: { templateLength: 6000, resultLength: 6000, insertLength: 5006 },
    warnings: []
  };
  const state = { projects: [], protocols: [], notebookEntries: [] };
  let nextId = 0;
  const created = notebookModule.createSequenceViewerCloningDesignNotebookPage({
    state,
    ...createRecordServices(state),
    source,
    record: { name: source.recordName, sequence, topology: 'circular' },
    displayPlan,
    createId: () => `two_step_${++nextId}`
  });

  assert.equal(created.pcrPrograms.length, 2);
  assert.equal(created.pcrPrograms.map((program) => program.annealingTemperature).join(','), '65,63');
  assert.equal(created.pcrPrograms.map((program) => program.extensionSeconds).join(','), '65,155');
  assert.equal(created.pcrPrograms[1].primerNames.includes('Purified PCR 1 megaprimer'), true);
  assert.equal(
    created.entry.protocolSnapshot.steps.some((step) => /PCR 1: Repeat for 30 cycles:.*Annealing \(Ta\) - 65 C.*Extension - 72 C - 1 min 5 s/.test(step.text)),
    true
  );
  assert.equal(
    created.entry.protocolSnapshot.steps.some((step) => /PCR 2: Repeat for 30 cycles:.*Annealing \(Ta\) - 63 C.*Extension - 72 C - 2 min 35 s/.test(step.text)),
    true
  );

  // The program says how to run the PCR; the page also has to say what goes in
  // the tube, as one fixed-volume reaction.
  assert.equal(created.entry.toolCalculations.length, 1);
  const reaction = created.entry.toolCalculations[0];
  assert.equal(reaction.id, 'sequence-viewer-pcr-fixed-reaction');
  assert.equal(reaction.title, 'Fixed Volume Reaction');
  assert.deepEqual(Array.from(reaction.table.headers), ['Item', 'Stock Conc.', 'Final Conc.', 'Volume', 'Note']);
  assert.deepEqual(Array.from(reaction.table.rows).map((row) => row[0]), [
    'Forward primer',
    'Reverse primer',
    'dNTP mix',
    'Q5 High-Fidelity DNA Polymerase (or validated equivalent)',
    '5x polymerase buffer',
    'Template DNA (10 ng)'
  ]);
  assert.equal(reaction.table.metaRows[0][1], '50 uL');
  // Two PCRs on this route, so the table says it is set up once for each.
  assert.equal(reaction.table.metaRows[1][1], 'PCR 1, PCR 2');
  assert.equal(reaction.table.footerRows[0][0], 'Nuclease-free water');

  // The template is a mass, given as a final concentration in the same two
  // columns every other reagent uses. What the miniprep came out at is not
  // known here, so the volume and the water stay as formulas rather than being
  // guessed at.
  const templateRow = Array.from(reaction.table.rows).find((row) => /Template DNA/.test(row[0]));
  assert.equal(templateRow[1], '');
  assert.equal(templateRow[2], '0.2 ng/uL');
  assert.match(templateRow[3], /0\.2 ng\/uL x 50 uL \/ \[stock concentration\]/);
  assert.match(reaction.table.footerRows[0][3], /50 uL - .*\[Template DNA \(10 ng\) volume\]/);

  // A note logged against a row is the one part of the table a person wrote.
  reaction.inputs.reagents[5].note = '12 ng from pKD13 miniprep';
  reaction.table.rows[5][4] = '12 ng from pKD13 miniprep';

  // Re-running the design replaces that table instead of stacking another, and
  // carries the logged note onto the fresh one.
  notebookModule.createSequenceViewerCloningDesignNotebookPage({
    state,
    ...createRecordServices(state),
    source,
    record: { name: source.recordName, sequence, topology: 'circular' },
    displayPlan,
    entryId: created.entry.id,
    createId: () => `two_step_${++nextId}`
  });
  assert.equal(state.notebookEntries[0].toolCalculations.length, 1);
  assert.equal(
    state.notebookEntries[0].toolCalculations[0].table.rows[5][4],
    '12 ng from pKD13 miniprep'
  );
});
test('[EDGE] cloning reaction pages preserve executed records and calculate molar inputs', () => {
  const reactionModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-reaction-steps.js')
  );
  const pageModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-step-pages.js')
  );
  const steps = reactionModule.buildCloningReactionSteps({
    strategy: 'overlap-extension',
    displayPlan: {
      plans: [{ plan: { restrictionEnzymeSelection: [{ name: 'EcoRI' }, { name: 'XhoI' }] } }]
    },
    pcrPrograms: [{ label: 'Vector flank PCR' }, { label: 'Insert PCR' }]
  });
  const fusion = steps.find((step) => step.id === 'overlap-fusion');
  const ligation = steps.find((step) => step.id === 'ligation');
  const forwardPrimer = fusion.reagents.find((row) => /Outer forward primer/.test(row.name));
  const reversePrimer = fusion.reagents.find((row) => /Outer reverse primer/.test(row.name));
  assert.equal(forwardPrimer.stockConcentration, '10 uM');
  assert.equal(forwardPrimer.finalConcentration, '0.5 uM');
  assert.equal(reversePrimer.finalConcentration, '0.5 uM');
  assert.match(fusion.steps.join(' '), /two 2\.5 uL outer-primer aliquots/);
  assert.match(fusion.steps.join(' '), /final volume of 50 uL/);

  const insert = ligation.reagents.find((row) => /Digested insert/.test(row.name));
  assert.equal(Object.hasOwn(insert, 'manualVolumeValue'), false);
  assert.match(insert.volumeFormula, /3 x 50 ng x insert length bp/);
  assert.equal(
    fusion.reagents.filter((row) => /Purified .*amplicon/.test(row.name))
      .every((row) => !row.manualVolumeValue && /Target pmol/.test(row.volumeFormula)),
    true
  );

  const state = { protocols: [], notebookEntries: [] };
  let nextId = 0;
  const sync = (nextSteps, nowIso) => pageModule.syncCloningReactionStepPages({
    state,
    createId: () => `reaction_page_${++nextId}`,
    nowIso,
    project: { id: 'project_1', name: 'Cloning Project' },
    source: 'sequence-viewer-cloning-design',
    pageKey: 'design_1',
    subjectName: 'Construct A',
    strategy: 'overlap-extension',
    steps: nextSteps
  });
  const firstPages = sync([ligation], '2026-08-26T10:00:00.000Z');
  const executed = firstPages[0];
  executed.notebookState = 'executed';
  executed.executedAt = '2026-08-26T10:30:00.000Z';
  executed.toolCalculations.push({ id: 'manual-yield', type: 'formula', title: 'Manual yield' });
  const executedSnapshot = JSON.stringify(executed);

  const refreshedLigation = {
    ...ligation,
    purpose: `${ligation.purpose} Refreshed design text.`
  };
  const secondPages = sync([refreshedLigation], '2026-08-26T11:00:00.000Z');
  assert.equal(state.notebookEntries.length, 2);
  assert.equal(JSON.stringify(executed), executedSnapshot);
  assert.notEqual(secondPages[0].id, executed.id);
  assert.equal(secondPages[0].notebookState, 'planned');
  assert.equal(secondPages[0].toolCalculations.some((calculation) => calculation.id === 'manual-yield'), false);

  secondPages[0].toolCalculations.push({ id: 'manual-note', type: 'formula', title: 'Bench note' });
  const thirdPages = sync([refreshedLigation], '2026-08-26T12:00:00.000Z');
  assert.equal(state.notebookEntries.length, 2);
  assert.equal(thirdPages[0].toolCalculations.filter((calculation) => calculation.id === 'manual-note').length, 1);
  const refreshedCalculation = thirdPages[0].toolCalculations
    .find((calculation) => calculation.id === 'cloning-reaction-ligation-fixed-reaction');
  const insertRow = refreshedCalculation.table.rows
    .find((row) => /Digested insert/.test(row[0]));
  assert.match(insertRow[3], /3 x 50 ng x insert length bp/);
});
test('[EDGE] regenerating a design leaves executed cloning pages untouched', () => {
  const designModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design-notebook.js')
  );
  const builderModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );

  // Mark every page of a saved design as run at the bench, with the hand-entered
  // values and as-run snapshot a real record carries.
  const markExecuted = (entries) => entries.map((entry) => {
    entry.notebookState = 'executed';
    entry.executedAt = '2026-08-26T10:30:00.000Z';
    entry.values = { benchNote: 'used 43 ng backbone' };
    entry.result = 'BENCH RESULT: 12 colonies';
    entry.protocolSnapshot = { ...entry.protocolSnapshot, name: 'AS-RUN SNAPSHOT' };
    return JSON.stringify(entry);
  });

  const state = { projects: [], protocols: [], notebookEntries: [] };
  let nextId = 0;
  const createId = () => `design_id_${nextId += 1}`;
  const source = {
    recordName: 'pTest',
    editRequest: { type: 'insertion', start: 10, end: 20 },
    originalSequence: 'A'.repeat(300)
  };
  const record = { name: 'pTest', sequence: 'A'.repeat(320), features: [] };
  const displayPlan = {
    feasible: true,
    strategy: 'two-step-ligation',
    primers: [
      { name: 'F1', sequence: 'ATGCATGCATGCATGCATGC', role: 'forward', tm: 60 },
      { name: 'R1', sequence: 'GCATGCATGCATGCATGCAT', role: 'reverse', tm: 60 }
    ],
    summary: { templateLength: 300, resultLength: 320 },
    plans: []
  };
  const design = (entryId = '') => designModule.createSequenceViewerCloningDesignNotebookPage({
    state, createId, entryId, source, record, displayPlan, ...createRecordServices(state)
  });

  const first = design();
  // The design page plus the digest and ligation tubes it ends in.
  assert.equal(state.notebookEntries.length, 3);
  const snapshots = markExecuted(state.notebookEntries);

  // Regenerating by stored id must not write over the executed record.
  const second = design(first.entry.id);
  assert.notEqual(second.entry.id, first.entry.id);
  assert.equal(second.entry.notebookState, 'planned');
  assert.equal(second.entry.executedAt, '');
  assert.deepEqual(state.notebookEntries.slice(0, 3).map((entry) => JSON.stringify(entry)), snapshots);

  // A third run reuses the planned pages instead of piling up new ones.
  const before = state.notebookEntries.length;
  const third = design(second.entry.id);
  assert.equal(third.entry.id, second.entry.id);
  assert.equal(state.notebookEntries.length, before);

  const builderState = { projects: [], protocols: [], notebookEntries: [] };
  let builderNextId = 0;
  const backboneSequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const insertSequence = 'ATGCGTACGATCCGATGCTAGCTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCG';
  const build = (entryId = '') => builderModule.createProteinBuilderCloningNotebookPage({
    state: builderState,
    ...createRecordServices(builderState),
    createId: () => `builder_id_${builderNextId += 1}`,
    entryId,
    constructName: 'His6-TEV-POI',
    backbone: {
      hostVectorName: 'Host Backbone', topology: 'circular', variantMode: 'gibson', backboneSequence
    },
    dnaConstruct: {
      sequence: insertSequence,
      length: insertSequence.length,
      parts: [{ label: 'POI', dnaSequence: insertSequence }]
    },
    assembledRecord: {
      name: 'His6-TEV-POI (Host Backbone)',
      sequence: `${backboneSequence}${insertSequence}`
    }
  });

  const builderFirst = build();
  const builderSnapshots = markExecuted(builderState.notebookEntries);
  const builderSecond = build(builderFirst.entry.id);
  assert.notEqual(builderSecond.entry.id, builderFirst.entry.id);
  assert.equal(builderSecond.entry.notebookState, 'planned');
  assert.equal(builderSecond.entry.executedAt, '');
  assert.deepEqual(
    builderState.notebookEntries.slice(0, builderSnapshots.length).map((entry) => JSON.stringify(entry)),
    builderSnapshots
  );
});
test('[EDGE] sequence-viewer cloning notebook sizes each assembly PCR independently', () => {
  const notebookModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design-notebook.js')
  );
  const displayPlan = {
    strategy: 'gibson',
    primers: [
      { name: 'vector_F', tm: 61, groupLabel: 'Vector PCR', ampliconLength: 3050 },
      { name: 'vector_R', tm: 62, groupLabel: 'Vector PCR', ampliconLength: 3050 },
      { name: 'insert_F', tm: 60, groupLabel: 'Insert PCR', ampliconLength: 100 },
      { name: 'insert_R', tm: 63, groupLabel: 'Insert PCR', ampliconLength: 100 }
    ],
    summary: { templateLength: 3150, resultLength: 3150, insertLength: 100 }
  };
  const programs = notebookModule.buildSequenceViewerPcrPrograms({ displayPlan });

  assert.equal(programs.length, 2);
  assert.deepEqual(Array.from(programs.map((program) => program.ampliconLength)), [3050, 100]);
  assert.deepEqual(Array.from(programs.map((program) => program.extensionSeconds)), [95, 30]);
  assert.deepEqual(Array.from(programs.map((program) => program.primerNames.join(','))), ['vector_F,vector_R', 'insert_F,insert_R']);
});
test('[EDGE] sequence-viewer Q5 notebook program uses Tm plus 3 and 25 cycles', () => {
  const notebookModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design-notebook.js')
  );
  const programs = notebookModule.buildSequenceViewerPcrPrograms({
    displayPlan: {
      strategy: 'q5-kld',
      primers: [
        { name: 'q5_F', tm: 60.4, groupLabel: 'Whole-plasmid PCR' },
        { name: 'q5_R', tm: 61.5, groupLabel: 'Whole-plasmid PCR' }
      ],
      summary: { templateLength: 3000, resultLength: 3000 }
    }
  });

  assert.equal(programs[0].annealingTemperature, 63);
  assert.equal(programs[0].steps.find((step) => step.label === 'Annealing (Ta)').cycles, '25');
  assert.match(programs[0].notes[0], /plus 3 C/);
});
};
