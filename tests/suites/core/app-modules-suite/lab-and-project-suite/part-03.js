module.exports = function registerAppLabAndProjectSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('biology-notebook prefers stored protocol snapshots over live protocol records for saved pages', () => {
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
      enanaApi: {}
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
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Stored notebook step with/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /data-nb-key-ref="step-saved:volume"/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, />15 mL</);
  assert.doesNotMatch(document.getElementById('biology-notebook-steps').innerHTML, /Live library step/);
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
      enanaApi: {}
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
test('biology-notebook saves and reopens result tables with Tabulator', async () => {
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
      enanaApi: {},
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

  document.getElementById('biology-notebook-result').value = 'Measured expression panel.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].resultTable.columns.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.rows.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.columns[0].title, 'Sample');
  assert.equal(state.notebookEntries[0].resultTable.columns[3].title, 'OD600');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[0].field], 'A1');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[3].field], '0.82');
  assert.equal(state.notebookEntries[0].resultTable.rows[3][state.notebookEntries[0].resultTable.columns[0].field], 'Control');

  notebook.openEntry(state.notebookEntries[0].id);
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  assert.equal(tableInstance.columns.length, 4);
  assert.equal(tableInstance.columns[0].title, 'Sample');
  assert.equal(tableInstance.columns[3].title, 'OD600');
  assert.equal(tableInstance.data[0][tableInstance.columns[0].field], 'A1');
  assert.equal(tableInstance.data[0][tableInstance.columns[3].field], '0.82');
  assert.match(document.getElementById('biology-notebook-result-table-status').textContent, /4 columns x 4 rows/i);
  assert.ok(persistCalls >= 1);
});
  }
};