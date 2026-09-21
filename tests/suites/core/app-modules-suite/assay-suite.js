module.exports = function registerAppAssaySuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    fs,
    path,
    loadEsmStyleModule,
    MockElement,
    createMockDocument,
    test,
    assayAnalysis
  } = scope;
function buildStandardCurveObservations({
  sampleId = 'Std',
  concentrations = [0.1, 0.3, 1, 3, 10, 30],
  replicates = 2
} = {}) {
  const observations = [];
  concentrations.forEach((concentration, concentrationIndex) => {
    const signal = 10 + (90 / (1 + Math.exp(1.3 * (1.1 - Math.log10(Math.max(concentration, 1e-6))))));
    for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex += 1) {
      const offset = (replicateIndex % 2 === 0 ? -1 : 1) * 0.6;
      observations.push({
        well: `A${(concentrationIndex * replicates) + replicateIndex + 1}`,
        response: signal + offset,
        rowIndex: 0,
        rowLabel: 'A',
        columnIndex: concentrationIndex,
        columnNumber: concentrationIndex + 1,
        rawSampleId: sampleId,
        sampleId,
        sampleValue: Number.NaN,
        rawConcentration: String(concentration),
        concentrationLabel: String(concentration),
        concentrationValue: concentration
      });
    }
  });
  return observations;
}

test('assay-analysis standard curve methods produce fitted rows and line chart models', () => {
  const observations = buildStandardCurveObservations();
  const methods = [
    'standard_curve_line',
    'standard_curve_4pl_log_concentration',
    'standard_curve_4pl_concentration',
    'standard_curve_5pl_log_concentration',
    'standard_curve_5pl_concentration',
    'standard_curve_semilog_line',
    'standard_curve_hyperbola',
    'standard_curve_quadratic',
    'standard_curve_cubic',
    'standard_curve_pade_11'
  ];

  methods.forEach((method) => {
    const result = assayAnalysis.analyzeAssayData({ method, observations });
    assert.equal(result.rows.length, 1, `expected one fitted row for ${method}`);
    assert.equal(result.headers.includes('R²'), true, `expected R² column for ${method}`);
    assert.equal(result.headers.includes('RMSE'), true, `expected RMSE column for ${method}`);
    assert.equal(result.chartModel?.chartType, 'line', `expected line chart for ${method}`);
    assert.equal(Array.isArray(result.chartModel?.series), true, `expected chart series for ${method}`);
    assert.ok(result.chartModel.series.length >= 1, `expected non-empty chart series for ${method}`);

    // Index by header: analyses may add their own columns (e.g. sigmoidal potency).
    const row = result.rows[0];
    const cell = (header) => row[result.headers.indexOf(header)];
    assert.ok(String(row[0] || '').trim().length > 0, `expected non-empty series label for ${method}`);
    assert.ok(Number.isFinite(Number(cell('Points'))), `expected numeric point count for ${method}`);
    assert.ok(Number.isFinite(Number(cell('R²'))), `expected numeric r2 for ${method}`);
    assert.ok(Number.isFinite(Number(cell('RMSE'))), `expected numeric rmse for ${method}`);
    assert.equal(typeof cell('Equation'), 'string');
    assert.equal(typeof cell('Parameters'), 'string');
  });
});

test('assay-analysis fits the concentration axis as measured, non-positive values included', () => {
  // The log10 X transform is gone, so nothing filters out zero or negative
  // concentrations any more -- they are ordinary points on the axis as measured.
  const observations = buildStandardCurveObservations({
    concentrations: [-5, -1, 0, 2, 6, 10],
    replicates: 2
  });
  const fitted = assayAnalysis.analyzeAssayData({ method: 'standard_curve_semilog_line', observations });
  assert.equal(fitted.rows.length, 1, 'a linear fit keeps every concentration point');
  assert.doesNotMatch(fitted.summary, /skipped/i);

  // Too few distinct X values is still a real reason to skip a series.
  const sparse = assayAnalysis.analyzeAssayData({
    method: 'standard_curve_4pl_concentration',
    observations: buildStandardCurveObservations({ concentrations: [1, 2], replicates: 2 })
  });
  assert.equal(sparse.rows.length, 0, 'a 4PL still needs at least four points');
  assert.match(sparse.summary, /skipped/i);
});

test('assay result paste notifies the agent rail context immediately', () => {
  const { createAssayResultsManager } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'results-manager.js'
  ));
  const runtime = {
    currentLayout: [
      { well: 'A1', sampleId: 'A', concentration: '10000' },
      { well: 'A2', sampleId: 'A', concentration: '9000' }
    ],
    currentResults: {},
    resultPasteAnchor: { rowIndex: 0, columnIndex: 0 }
  };
  let refreshCount = 0;
  let prevented = false;
  const manager = createAssayResultsManager({
    runtime,
    elements: {
      assayResultTable: { innerHTML: '' }
    },
    TabulatorLib: null,
    isMappedWell: (well) => well === 'A1' || well === 'A2',
    getCurrentDefinition: () => ({ rows: 1, columns: 2 }),
    getSampleAxis: () => 'row',
    filterAndNormalizeResults: (results) => ({ ...results }),
    setResultStatus: () => {},
    clearAnalysisOutput: () => {},
    onAnalysisConfigChange: () => {},
    parseResultImportFile: null,
    persistResultAttachment: null,
    onResultImportApplied: null,
    onResultsChanged: () => {
      refreshCount += 1;
    }
  });

  manager.onResultTablePaste({
    target: {
      closest: (selector) => (selector === '#assay-result-table' ? {} : null)
    },
    clipboardData: {
      getData: () => '0.11\t0.22'
    },
    preventDefault: () => {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(JSON.stringify(runtime.currentResults), JSON.stringify({ A1: '0.11', A2: '0.22' }));
  assert.equal(refreshCount, 1);
});

test('assay preserves restored result values while the result grid is still initializing', () => {
  const document = createMockDocument();
  const { createAssayResultsManager } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'results-manager.js'
  ), { document });
  const resultTable = new MockElement('assay-result-table');
  resultTable.append = () => {};

  class InitializingTabulator {
    static instance = null;

    constructor(_host, options = {}) {
      this.initialized = false;
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.events = {};
      InitializingTabulator.instance = this;
    }

    on(eventName, handler) {
      this.events[eventName] = handler;
    }

    getRanges() {
      return [];
    }

    getRows() {
      if (!this.initialized) {
        return [];
      }
      return this.data.map((row) => ({
        getData: () => ({ ...row }),
        getCells: () => []
      }));
    }

    getColumns() {
      return [];
    }
  }

  const restoredResults = { A1: '0.11', A2: '0.22' };
  const runtime = {
    currentLayout: [
      { well: 'A1', sampleId: 'A', concentration: '10000' },
      { well: 'A2', sampleId: 'A', concentration: '9000' }
    ],
    currentResults: { ...restoredResults },
    resultPasteAnchor: { rowIndex: 0, columnIndex: 0 }
  };
  const manager = createAssayResultsManager({
    runtime,
    elements: { assayResultTable: resultTable },
    TabulatorLib: InitializingTabulator,
    isMappedWell: (well) => well === 'A1' || well === 'A2',
    getCurrentDefinition: () => ({ rows: 1, columns: 2 }),
    getSampleAxis: () => 'row',
    filterAndNormalizeResults: (results) => ({ ...results }),
    setResultStatus: () => {},
    clearAnalysisOutput: () => {},
    onAnalysisConfigChange: () => {},
    parseResultImportFile: null,
    persistResultAttachment: null,
    onResultImportApplied: null,
    onResultsChanged: () => {}
  });

  manager.renderResultTable();
  assert.equal(InitializingTabulator.instance.initialized, false);
  assert.deepEqual(manager.syncCurrentResultsFromGrid(), restoredResults);
  assert.deepEqual(runtime.currentResults, restoredResults);

  InitializingTabulator.instance.initialized = true;
  assert.deepEqual(manager.syncCurrentResultsFromGrid(), restoredResults);

  InitializingTabulator.instance.data[0].c1 = '0.33';
  assert.deepEqual(manager.syncCurrentResultsFromGrid(), { A1: '0.33', A2: '0.22' });
});

test('assay dilution fill commits generated concentrations before the layout re-reads the plate', () => {
  const concentrationUtils = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'concentration-utils.js'
  ));
  const shared = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'shared.js'
  ));
  const { createConcentrationFill } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'layout',
    'concentration-fill.js'
  ), {
    ...concentrationUtils,
    ...shared
  });

  const concentrationInputs = [
    { value: '1 uM' },
    { value: '' },
    { value: '' }
  ];
  let axisValues = {
    sampleValues: ['Sample'],
    concentrationValues: concentrationInputs.map((input) => input.value)
  };
  let statusMessage = '';
  const readPlateAxisValues = () => ({
    sampleValues: axisValues.sampleValues.slice(),
    concentrationValues: concentrationInputs.map((input) => input.value)
  });
  const fill = createConcentrationFill({
    runtime: {},
    assayFillModeInput: { value: 'factor' },
    assayDilutionFactorInput: { value: '2', hidden: false },
    assayPlatePreview: {
      querySelector(selector) {
        assert.match(selector, /data-axis-dimension="column"/);
        const index = Number(selector.match(/data-axis-index="(\d+)"/)?.[1]);
        return concentrationInputs[index] || null;
      }
    },
    serialDilution: { isOpen: () => false, render() {} },
    getSampleAxis: () => 'row',
    getConcentrationUnit: () => 'uM',
    getAxisTemplateValues: readPlateAxisValues,
    syncAxisTemplateValues(values) {
      axisValues = {
        sampleValues: values.sampleValues.slice(),
        concentrationValues: values.concentrationValues.slice()
      };
    },
    setLayoutFromAxisAndOverrides() {
      axisValues = readPlateAxisValues();
    },
    renderPlatePreview() {},
    renderResultTable() {},
    setLayoutStatus(message) {
      statusMessage = message;
    }
  });

  fill.onFillConcentrations();

  assert.deepEqual(concentrationInputs.map((input) => input.value), ['1 uM', '0.5 uM', '0.25 uM']);
  assert.deepEqual(axisValues.concentrationValues, ['1 uM', '0.5 uM', '0.25 uM']);
  assert.equal(statusMessage, 'Auto-filled 2 concentration steps at a 1:2 dilution.');
});

test('assay browser renders the Setup list and selectable Analyze list from the same assays', () => {
  const shared = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'shared.js'
  ));
  const { createAssayBrowserView } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'ui',
    'browser-view.js'
  ), shared);
  const setupList = { innerHTML: '' };
  const resultsList = { innerHTML: '' };
  const setupCount = { textContent: '' };
  const resultsCount = { textContent: '' };
  const state = {
    assays: [
      { id: 'assay-1', name: 'Older assay', updatedAt: '2026-07-20T12:00:00.000Z' },
      { id: 'assay-2', name: 'Current assay', updatedAt: '2026-07-21T12:00:00.000Z' }
    ],
    notebookEntries: []
  };
  const view = createAssayBrowserView({
    elements: {
      assayList: setupList,
      assayBrowserCount: setupCount,
      assaySearchInput: { value: '' },
      assayResultsList: resultsList,
      assayResultsBrowserCount: resultsCount,
      assayResultsSearchInput: { value: '' }
    },
    state,
    safeText: (value) => String(value),
    runtime: { activeResultsAssayId: 'assay-2' },
    ensureState() {}
  });

  view.renderList();

  assert.equal(setupCount.textContent, '2');
  assert.equal(resultsCount.textContent, '2');
  assert.match(setupList.innerHTML, /Current assay/);
  assert.match(setupList.innerHTML, /data-assay-edit="assay-2"/);
  assert.match(setupList.innerHTML, /data-assay-edit="assay-2"[^>]*aria-label="Edit Current assay"[^>]*data-hover-caption="Edit"/);
  assert.match(resultsList.innerHTML, /data-assay-results-select="assay-2"/);
  assert.match(resultsList.innerHTML, /aria-label="Analyze Current assay"/);
  assert.match(resultsList.innerHTML, /class="assay-browser-item is-active"/);
  assert.match(resultsList.innerHTML, /aria-pressed="true"/);
  assert.match(resultsList.innerHTML, /data-assay-delete="assay-2"/);
  assert.match(resultsList.innerHTML, /data-assay-delete="assay-2"[^>]*aria-label="Delete Current assay"[^>]*data-hover-caption="Delete"/);
});

test('assay analysis grouping keeps manual specs hidden without rendering summary chips', () => {
  const { createAssayResultsManager } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'results-manager.js'
  ));
  const rowGroups = new MockElement('assay-analysis-row-groups');
  const columnGroups = new MockElement('assay-analysis-column-groups');
  rowGroups.value = 'Control: A,B';
  columnGroups.value = 'Early: 1,2';

  const manager = createAssayResultsManager({
    runtime: { currentLayout: [], currentResults: {}, resultPasteAnchor: { rowIndex: 0, columnIndex: 0 } },
    elements: {
      assayAnalysisRowGroupsInput: rowGroups,
      assayAnalysisColumnGroupsInput: columnGroups,
      assayResultTable: { innerHTML: '' }
    },
    TabulatorLib: null,
    isMappedWell: () => true,
    getCurrentDefinition: () => ({ rows: 8, columns: 12 }),
    getSampleAxis: () => 'row',
    filterAndNormalizeResults: (results) => ({ ...results }),
    setResultStatus: () => {},
    clearAnalysisOutput: () => {},
    onAnalysisConfigChange: () => {},
    parseResultImportFile: null,
    persistResultAttachment: null,
    onResultImportApplied: null,
    onResultsChanged: () => {}
  });

  const analysisGroups = manager.refreshAnalysisGroupDisplay();
  assert.equal(analysisGroups.row.groups[0].label, 'Control');
  assert.equal(analysisGroups.row.groups[0].members.join(','), 'A,B');
  assert.equal(analysisGroups.column.groups[0].label, 'Early');
  assert.equal(analysisGroups.column.groups[0].members.join(','), '1,2');

  const viewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'assay-view.html'), 'utf8');
  assert.match(viewSource, /id="assay-analysis-row-groups" type="hidden"/);
  assert.match(viewSource, /id="assay-analysis-column-groups" type="hidden"/);
  assert.doesNotMatch(viewSource, /<textarea[^>]+id="assay-analysis-(?:row|column)-groups"/);
  assert.doesNotMatch(viewSource, /assay-analysis-group-visualization/);
});

test('assay agent TSV formatter preserves object-row cells', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'agent',
    'context.js'
  ), 'utf8');

  assert.match(source, /row && typeof row === 'object' \? row : \{\}/);
  assert.doesNotMatch(source, /const source = Array\.isArray\(row\) \? row : \{\};/);
});

test('assay setup suppresses the universal agent chat rail while analysis keeps it available', () => {
  const { createAssayFormAndList } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'workspace',
    'form-and-list.js'
  ));
  const runtime = { assayMode: 'create', activeResultsAssayId: '' };
  const createLayout = { hidden: false };
  const resultsLayout = { hidden: true };
  const createButton = new MockElement('assay-mode-create-btn');
  const resultsButton = new MockElement('assay-mode-results-btn');
  const createRail = { prepend() {} };
  const resultsRail = { prepend() {} };
  const observedModes = [];
  const manager = createAssayFormAndList({
    runtime,
    elements: {
      assayCreateLayout: createLayout,
      assayResultsLayout: resultsLayout,
      assayModeCreateBtn: createButton,
      assayModeResultsBtn: resultsButton,
      assayModeSwitch: {},
      assayCreateRail: createRail,
      assayResultsRail: resultsRail,
      assayResultsAssaySelect: { value: '' }
    },
    layoutManager: {
      renderPlateDefinition() {},
      renderPlatePreview() {}
    },
    onAssayModeChanged: (mode) => observedModes.push(mode),
    notifyActiveAssayChanged() {},
    renderResultsAssayOptions() {},
    clearActiveAssayInfo() {}
  });

  manager.setAssayMode('create');
  assert.equal(createLayout.hidden, false);
  assert.equal(resultsLayout.hidden, true);
  assert.equal(observedModes.at(-1), 'create');

  manager.setAssayMode('results');
  assert.equal(createLayout.hidden, true);
  assert.equal(resultsLayout.hidden, false);
  assert.equal(observedModes.at(-1), 'results');

  const { assayManifest } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'module-manifests',
    'assay.js'
  ));
  const assayView = { dataset: {} };
  const dispatchedEvents = [];
  class TestCustomEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const manifestOptions = assayManifest.createOptions({
    state: {},
    persist() {},
    createId() {},
    safeText: (value) => String(value ?? ''),
    rendererServices: { analysis: { handleAssaysChanged() {} } },
    modules: {},
    rootDocument: {
      defaultView: { CustomEvent: TestCustomEvent },
      getElementById: () => assayView,
      dispatchEvent: (event) => dispatchedEvents.push(event.type)
    }
  });
  manifestOptions.onAssayModeChanged('create');
  assert.equal(assayView.dataset.agentChatRail, 'disabled');
  manifestOptions.onAssayModeChanged('results');
  assert.equal(assayView.dataset.agentChatRail, 'enabled');
  assert.deepEqual(dispatchedEvents, [
    'hikari:agent-chat-rail-availability-changed',
    'hikari:agent-chat-rail-availability-changed'
  ]);

  const { isAgentChatRailAvailable } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'app',
    'navigation-shell.js'
  ));
  assert.equal(isAgentChatRailAvailable({ agentChatRail: true }, { dataset: { agentChatRail: 'disabled' } }), false);
  assert.equal(isAgentChatRailAvailable({ agentChatRail: true }, { dataset: { agentChatRail: 'enabled' } }), true);
  assert.equal(isAgentChatRailAvailable({ agentChatRail: false }, { dataset: { agentChatRail: 'enabled' } }), false);
});

test('assay analysis split initializes chart collaborators before the extracted surface', () => {
  const { createAssayAnalysisView } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'analysis-view.js'
  ));
  const runtime = {};
  const view = createAssayAnalysisView({
    runtime,
    elements: {},
    safeText: (value) => String(value ?? ''),
    TabulatorLib: null,
    getCurrentDefinition: () => ({ rows: 1, columns: 1 }),
    syncCurrentResultsFromGrid: () => ({}),
    getResultValueCount: () => 0,
    buildResultGridSignature: () => '',
    buildResultGridColumns: () => [],
    buildResultGridData: () => [],
    getResultGridHeight: () => 200
  });

  assert.equal(typeof view.getChartStyle, 'function');
  view.loadChartStyle({ title: 'Split-safe chart' });
  assert.equal(runtime.chartStyle.title, 'Split-safe chart');
  view.destroy();
});

test('assay analysis hides successful status copy while retaining saved analysis metadata', () => {
  const document = createMockDocument();
  const { createAssayAnalysisView } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'analysis-view.js'
  ), { document });
  const summary = new MockElement('assay-analysis-summary');
  const table = new MockElement('assay-analysis-table');
  const input = (value = '') => {
    const element = new MockElement();
    element.value = value;
    return element;
  };
  const runtime = {
    currentLayout: [
      { well: 'A1', sampleId: 'Series', concentration: '1' },
      { well: 'A2', sampleId: 'Series', concentration: '2' }
    ],
    currentResults: { A1: '2', A2: '4' }
  };
  let savedAnalysis = null;
  const view = createAssayAnalysisView({
    runtime,
    elements: {
      assayAnalysisAsymmetricInput: input(),
      assayAnalysisColumnGroupsInput: input(),
      assayAnalysisErrorBarsInput: input(),
      assayAnalysisErrorBarsField: new MockElement(),
      assayAnalysisGroupByInput: input('auto'),
      assayAnalysisKindInput: input('linear'),
      assayAnalysisPolyOrderField: new MockElement(),
      assayAnalysisPolyOrderInput: input('2'),
      assayAnalysisSubtotalsField: new MockElement(),
      assayAnalysisSubtotalsInput: input(),
      assayAnalysisSummary: summary,
      assayAnalysisRowGroupsInput: input(),
      assayAnalysisTable: table,
      assayAnalysisXAxisField: new MockElement(),
      assayAnalysisXAxisInput: input('concentration'),
      assayAnalysisXTransformField: new MockElement(),
      assayAnalysisXTransformInput: input('none')
    },
    safeText: (value) => String(value ?? ''),
    TabulatorLib: null,
    getCurrentDefinition: () => ({ rows: 1, columns: 2 }),
    syncCurrentResultsFromGrid: () => runtime.currentResults,
    getResultValueCount: () => Object.keys(runtime.currentResults).length,
    buildResultGridSignature: () => '',
    buildResultGridColumns: () => [],
    buildResultGridData: () => [],
    getResultGridHeight: () => 200,
    onAnalysisRendered: (record) => {
      savedAnalysis = record;
    }
  });

  view.renderAnalysis();

  assert.equal(summary.textContent, '', 'successful analysis does not add redundant rail status copy');
  assert.match(table.innerHTML, /<td>Linear<\/td>/, 'the result table still identifies the fitted model');
  assert.match(savedAnalysis.summary, /^Linear fitted for 1 series/, 'the saved analysis retains its full summary');
  assert.doesNotMatch(savedAnalysis.summary, /Rows:/, 'the UI-only row count is not persisted');
  view.destroy();
});

test('assay group selection stays silent but missing selections still explain the blocked action', () => {
  const document = createMockDocument();
  const { createAssayResultsManager } = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'results-manager.js'
  ), { document });
  const selectionStatus = new MockElement('assay-analysis-selection-status');
  const resultTable = new MockElement('assay-result-table');
  resultTable.append = () => {};

  class RangeTabulator {
    static instance = null;

    constructor() {
      this.events = {};
      this.ranges = [];
      RangeTabulator.instance = this;
    }

    on(eventName, handler) {
      this.events[eventName] = handler;
    }

    getRanges() {
      return this.ranges;
    }

    getRows() {
      return [];
    }

    getColumns() {
      return [];
    }

    destroy() {}
  }

  const manager = createAssayResultsManager({
    runtime: { currentLayout: [], currentResults: {}, resultPasteAnchor: { rowIndex: 0, columnIndex: 0 } },
    elements: {
      assayAnalysisSelectionStatus: selectionStatus,
      assayAnalysisRowGroupsInput: new MockElement(),
      assayAnalysisColumnGroupsInput: new MockElement(),
      assayResultTable: resultTable
    },
    TabulatorLib: RangeTabulator,
    isMappedWell: () => true,
    getCurrentDefinition: () => ({ rows: 8, columns: 12 }),
    getSampleAxis: () => 'row',
    filterAndNormalizeResults: (results) => ({ ...results }),
    setResultStatus: () => {},
    clearAnalysisOutput: () => {},
    onAnalysisConfigChange: () => {},
    parseResultImportFile: null,
    persistResultAttachment: null,
    onResultImportApplied: null,
    onResultsChanged: () => {}
  });

  manager.renderResultTable();
  RangeTabulator.instance.ranges = [{
    getRows: () => [{ getData: () => ({ rowLabel: 'B' }) }],
    getColumns: () => []
  }];
  RangeTabulator.instance.events.rangeAdded();
  assert.equal(selectionStatus.textContent, '', 'the selected-range hint remains hidden');

  RangeTabulator.instance.ranges = [];
  manager.onAddSelectedRowGroup();
  assert.equal(selectionStatus.textContent, 'Select at least one row before adding a group.');
  assert.equal(selectionStatus.classList.contains('is-error'), true, 'a blocked action reads as an error, not a note');
});

test('assay treats loading a saved plate as a clean setup and results baseline', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'assay', 'index.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'assay', 'workspace', 'form-and-list.js'), 'utf8')
  ].join('\n');

  assert.match(source, /function markLoadedAssayDraftsSaved\(\)\s*\{\s*markCreateDraftSaved\(\);\s*markResultsDraftSaved\(\);\s*\}/s);
  assert.match(source, /function loadAssayForResults\([\s\S]*?markLoadedAssayDraftsSaved\(\);[\s\S]*?notifyActiveAssayChanged\(\);\s*\}/);
  assert.match(source, /function editAssay\([\s\S]*?markLoadedAssayDraftsSaved\(\);[\s\S]*?notifyActiveAssayChanged\(\);\s*\}/);
});

test('assay analysis accepts agent Plotly graph artifacts for workspace rendering', () => {
  const analysisViewModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'analysis-view.js'
  ));
  const artifact = analysisViewModule.normalizeAgentPlotlyGraphArtifact({
    graph: {
      id: 'g1',
      figure: {
        data: [{ type: 'bar', x: ['A1', 'A2'], y: [0.2, 0.7], name: 'Result' }],
        layout: { title: { text: 'Filled assay plate' } },
        config: { responsive: true }
      },
      inspection: { issues: [] }
    }
  });

  assert.equal(artifact.id, 'g1');
  assert.equal(artifact.name, 'Filled assay plate');
  assert.equal(artifact.figure.data[0].type, 'bar');
  assert.equal(artifact.figure.layout.title.text, 'Filled assay plate');
});

};
