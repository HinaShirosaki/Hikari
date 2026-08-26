module.exports = function registerAppAssaySuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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

test('assay-analysis log-concentration methods skip non-positive concentration points', () => {
  const observations = buildStandardCurveObservations({
    concentrations: [-5, -1, 0],
    replicates: 2
  });
  const methods = [
    'standard_curve_4pl_log_concentration',
    'standard_curve_5pl_log_concentration',
    'standard_curve_semilog_line'
  ];

  methods.forEach((method) => {
    const result = assayAnalysis.analyzeAssayData({ method, observations });
    assert.equal(result.rows.length, 0, `expected no fitted rows for ${method}`);
    assert.match(result.summary, /skipped/i);
  });
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
  assert.match(resultsList.innerHTML, /data-assay-results-select="assay-2"/);
  assert.match(resultsList.innerHTML, /aria-label="Analyze Current assay"/);
  assert.match(resultsList.innerHTML, /class="assay-browser-item is-active"/);
  assert.match(resultsList.innerHTML, /aria-pressed="true"/);
  assert.match(resultsList.innerHTML, /data-assay-delete="assay-2"/);
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

test('assay treats loading a saved plate as a clean setup and results baseline', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'assay',
    'index.js'
  ), 'utf8');

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

  }
};
