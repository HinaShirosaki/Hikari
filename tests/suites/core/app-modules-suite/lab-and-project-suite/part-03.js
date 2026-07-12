module.exports = function registerAppLabAndProjectSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('biology-notebook prefers stored protocol snapshots over live protocol records for saved pages', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-experiment-name',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'protocol-1',
        name: 'Live Protocol Name',
        steps: [
          {
            id: 'step-live',
            text: 'Live library step.',
            placeholders: []
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Stored Snapshot Name',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Stored Snapshot Name',
          steps: [
            {
              id: 'step-saved',
              text: 'Stored notebook step with {{ph:volume}}.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Stored Snapshot Name');
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, true);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Stored notebook step with/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /data-nb-key-ref="step-saved:volume"/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, />15 mL</);
  assert.doesNotMatch(document.getElementById('biology-notebook-steps').innerHTML, /Live library step/);
  assert.equal(document.getElementById('biology-notebook-page-starter').hidden, true);

  trigger(document.getElementById('biology-notebook-protocol-title'), 'dblclick');
  assert.equal(document.getElementById('biology-notebook-protocol-title').hidden, true);
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, false);
  document.getElementById('biology-notebook-experiment-name').value = 'Renamed transformation page';
  trigger(document.getElementById('biology-notebook-experiment-name'), 'keydown', { key: 'Enter' });
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, true);
  assert.equal(document.getElementById('biology-notebook-protocol-title').hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Renamed transformation page');
});
test('biology-notebook edits only the saved page protocol copy and keeps the original protocol unchanged', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  let persistCalls = 0;
  let notebookChangedCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'protocol-1',
        name: 'Source Protocol',
        steps: [
          {
            id: 'step-saved',
            text: 'Add {{ph:volume}} buffer.',
            placeholders: [
              { id: 'volume', name: 'Volume' }
            ]
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Source Protocol',
        experimentName: 'Source Protocol',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Source Protocol',
          steps: [
            {
              id: 'step-saved',
              text: 'Add {{ph:volume}} buffer.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  trigger(document.getElementById('biology-notebook-edit-protocol-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-protocol-editor').hidden, false);
  assert.equal(document.getElementById('biology-notebook-page-protocol-name').value, 'Source Protocol');
  assert.match(document.getElementById('biology-notebook-page-protocol-steps').value, /Add \[Volume\] buffer\./);

  document.getElementById('biology-notebook-page-protocol-name').value = 'Edited Page Copy';
  document.getElementById('biology-notebook-page-protocol-steps').value = '• Add [Sample volume] buffer.\n• Mix thoroughly.';
  trigger(document.getElementById('biology-notebook-apply-protocol-edit-btn'), 'click');

  assert.equal(state.protocols[0].name, 'Source Protocol');
  assert.equal(state.protocols[0].steps.length, 1);
  assert.equal(state.protocols[0].steps[0].text, 'Add {{ph:volume}} buffer.');

  assert.equal(state.notebookEntries[0].protocolName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].experimentName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.name, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps.length, 2);
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].id, 'step-saved');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].id, 'volume');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].name, 'Sample volume');
  assert.equal(state.notebookEntries[0].values['step-saved:volume'], '15 mL');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Sample volume/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Mix thoroughly\./);
  assert.ok(persistCalls >= 1);
  assert.ok(notebookChangedCalls >= 1);
});
test('biology-notebook saves and reopens multiple result tables with Tabulator', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-add-table-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn',
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table',
    'biology-notebook-result-table-status',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.host = host;
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      this.events = {};
      MockTabulator.instances.push(this);
    }

    destroy() {
      this.destroyed = true;
    }

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }

    on(eventName, handler) {
      this.events[eventName] = handler;
    }
  }

  let persistCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Expression Readout',
        steps: [
          { id: 's1', text: 'Capture result table.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {},
      Tabulator: MockTabulator
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-result-table-wrap').hidden, false);
  assert.equal(document.getElementById('biology-notebook-add-table-btn').hidden, false);

  let tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const firstField = tableInstance.columns[0].field;
  tableInstance.columns[0].title = 'Sample';
  tableInstance.data[0][firstField] = 'A1';

  trigger(document.getElementById('biology-notebook-add-table-column-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const lastField = tableInstance.columns[tableInstance.columns.length - 1].field;
  tableInstance.columns[tableInstance.columns.length - 1].title = 'OD600';
  tableInstance.data[0][lastField] = '0.82';

  trigger(document.getElementById('biology-notebook-add-table-row-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  tableInstance.data[tableInstance.data.length - 1][firstField] = 'Control';

  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
  const secondTableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const secondField = secondTableInstance.columns[0].field;
  secondTableInstance.columns[0].title = 'Condition';
  secondTableInstance.data[0][secondField] = 'Induced';

  document.getElementById('biology-notebook-result').value = 'Measured expression panel.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].resultTables.length, 2);
  assert.equal(state.notebookEntries[0].resultTable.columns.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.rows.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.columns[0].title, 'Sample');
  assert.equal(state.notebookEntries[0].resultTable.columns[3].title, 'OD600');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[0].field], 'A1');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[3].field], '0.82');
  assert.equal(state.notebookEntries[0].resultTable.rows[3][state.notebookEntries[0].resultTable.columns[0].field], 'Control');
  assert.equal(state.notebookEntries[0].resultTables[1].columns[0].title, 'Condition');
  assert.equal(state.notebookEntries[0].resultTables[1].rows[0][state.notebookEntries[0].resultTables[1].columns[0].field], 'Induced');

  notebook.openEntry(state.notebookEntries[0].id);
  const reopenedTables = MockTabulator.instances.slice(-2);
  assert.equal(reopenedTables.length, 2);
  assert.equal(reopenedTables[0].columns.length, 4);
  assert.equal(reopenedTables[0].columns[0].title, 'Sample');
  assert.equal(reopenedTables[0].columns[3].title, 'OD600');
  assert.equal(reopenedTables[0].data[0][reopenedTables[0].columns[0].field], 'A1');
  assert.equal(reopenedTables[0].data[0][reopenedTables[0].columns[3].field], '0.82');
  assert.equal(reopenedTables[1].columns[0].title, 'Condition');
  assert.equal(reopenedTables[1].data[0][reopenedTables[1].columns[0].field], 'Induced');
  assert.match(document.getElementById('biology-notebook-result-table-status').textContent, /2 tables/i);
  assert.ok(persistCalls >= 1);
});

test('biology-notebook creates a result table from a placeholder variable', () => {
  const document = createMockDocument([
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table',
    'biology-notebook-result-table-status',
    'biology-notebook-add-table-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn'
  ]);

  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.host = host;
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      MockTabulator.instances.push(this);
    }

    destroy() {}

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }
  }

  const resultTableModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'result-table-controller.js'), {});
  const resultTableController = resultTableModule.createResultTableController({
    host: document.getElementById('biology-notebook-result-table'),
    statusEl: document.getElementById('biology-notebook-result-table-status'),
    wrapEl: document.getElementById('biology-notebook-result-table-wrap'),
    addBtn: document.getElementById('biology-notebook-add-table-btn'),
    addRowBtn: document.getElementById('biology-notebook-add-table-row-btn'),
    addColBtn: document.getElementById('biology-notebook-add-table-column-btn'),
    removeBtn: document.getElementById('biology-notebook-remove-table-btn'),
    createId: (() => {
      let index = 0;
      return () => `placeholder-${index += 1}`;
    })(),
    TabulatorLib: MockTabulator
  });

  resultTableController.onAddFromPlaceholder({
    name: 'Incubation temperature',
    value: '37 °C'
  });

  const table = resultTableController.getCurrentTables()[0];
  assert.equal(table.columns.map((column) => column.title).join('|'), 'Variable|Value');
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][table.columns[0].field], 'Incubation temperature');
  assert.equal(table.rows[0][table.columns[1].field], '37 °C');
  assert.equal(MockTabulator.instances.length, 1);
});

test('biology-notebook placeholder context menu exposes the table action for regular variables', () => {
  const action = {
    closest(selector) {
      return selector === '[data-placeholder-add-table]' ? action : null;
    }
  };
  const menu = {
    hidden: true,
    style: {},
    listeners: {},
    setAttribute() {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    querySelector(selector) {
      return selector === '[data-placeholder-add-table]' ? action : null;
    }
  };
  const document = {
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: { append() {} },
    createElement() {
      return menu;
    }
  };
  const menuModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'sample-link-menu.js'), {});
  let receivedState = null;
  const controller = menuModule.createSampleLinkMenuController({
    doc: document,
    win: { innerWidth: 800, innerHeight: 600 },
    safeText: shared.safeText,
    onAddTable: (state) => { receivedState = state; }
  });
  const wrap = {
    dataset: { placeholderName: 'Incubation temperature' },
    querySelector: () => ({ value: '37 °C' })
  };
  const token = { dataset: { nbKeyRef: 'step-1:temperature' } };

  controller.open({ wrap, token, x: 100, y: 100 });
  menu.listeners.click({
    target: action,
    preventDefault() {}
  });

  assert.equal(receivedState.key, 'step-1:temperature');
  assert.equal(receivedState.placeholderName, 'Incubation temperature');
  assert.equal(receivedState.value, '37 °C');
  assert.equal(menu.hidden, true);
});
test('biology-notebook sidebar records bench calculations and inserts readable notes', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-mobile-toggle',
    'biology-notebook-tool-workspace',
    'biology-notebook-tool-calculations',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]'
      ? document.getElementById('biology-notebook-tool-sidebar')
      : null
  );

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Bench Prep',
        steps: [
          { id: 's1', text: 'Prepare reaction.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };
  let idIndex = 0;
  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => `generated-${idIndex += 1}`,
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  document.getElementById('biology-notebook-tool-mass-concentration').value = '10';
  document.getElementById('biology-notebook-tool-mass-concentration-unit').value = 'mM';
  document.getElementById('biology-notebook-tool-mass-mw').value = '58.44';
  document.getElementById('biology-notebook-tool-mass-volume').value = '1';
  document.getElementById('biology-notebook-tool-mass-volume-unit').value = 'L';
  document.getElementById('biology-notebook-tool-mass-output-unit').value = 'mg';
  trigger(document.getElementById('biology-notebook-tool-mass-volume'), 'input');
  trigger(document.getElementById('biology-notebook-tool-insert-notes-btn'), 'click');

  trigger(document.getElementById('biology-notebook-tool-tab-buffer'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, false);
  document.getElementById('biology-notebook-tool-buffer-volume').value = '1000';
  document.getElementById('biology-notebook-tool-buffer-name-1').value = 'NaCl';
  document.getElementById('biology-notebook-tool-buffer-mw-1').value = '58.44';
  document.getElementById('biology-notebook-tool-buffer-stock-1').value = '';
  document.getElementById('biology-notebook-tool-buffer-final-1').value = '150 mM';
  trigger(document.getElementById('biology-notebook-tool-buffer-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-buffer-output-1').textContent, /8766 mg/i);
  trigger(document.getElementById('biology-notebook-tool-record-btn'), 'click');

  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Water';
  document.getElementById('biology-notebook-tool-reaction-name-1').value = 'ATP';
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  document.getElementById('biology-notebook-tool-reaction-final-1').value = '1 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-reaction-output-1').textContent, /10 uL/i);
  assert.match(document.getElementById('biology-notebook-tool-reaction-solvent-output').textContent, /90 uL/i);
  trigger(document.getElementById('biology-notebook-tool-record-btn'), 'click');

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].toolCalculations.length, 3);
  assert.match(state.notebookEntries[0].result, /Molarity - Mass: Mass needed: 584\.4 mg/i);
  assert.match(state.notebookEntries[0].toolCalculations[1].result, /NaCl: 8766 mg/i);
  assert.match(state.notebookEntries[0].toolCalculations[2].result, /Water: 90 uL/i);
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[1].table.headers), ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume']);
  assert.equal(state.notebookEntries[0].toolCalculations[1].table.rows[0][0], 'NaCl');
  assert.match(state.notebookEntries[0].toolCalculations[1].table.rows[0][4], /8766 mg/i);
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[2].table.headers), ['Item', 'Stock Conc.', 'Final Conc.', 'Volume']);
  assert.equal(state.notebookEntries[0].toolCalculations[2].table.rows[0][0], 'ATP');
  assert.equal(state.notebookEntries[0].toolCalculations[2].table.footerRows[0][0], 'Water');
  assert.match(state.notebookEntries[0].toolCalculations[2].table.footerRows[0][3], /90 uL/i);

  notebook.openEntry(state.notebookEntries[0].id);
  const renderedCalculations = document.getElementById('biology-notebook-tool-calculations').innerHTML;
  assert.match(renderedCalculations, /Molarity - Mass/);
  assert.match(renderedCalculations, /Buffer Preparer/);
  assert.match(renderedCalculations, /Fixed Volume Reaction/);
  assert.match(renderedCalculations, /biology-notebook-tool-calculation-table/);
  assert.doesNotMatch(renderedCalculations, /NaCl: 8766 mg/i);
  assert.doesNotMatch(renderedCalculations, /Water: 90 uL/i);
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /Tool calculations: 3 calculations/i);
});
  }
};
