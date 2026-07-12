module.exports = function registerAppAssayAndObjectGraphSuite(context = {}) {
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

    const row = result.rows[0];
    assert.ok(String(row[0] || '').trim().length > 0, `expected non-empty series label for ${method}`);
    assert.ok(Number.isFinite(Number(row[1])), `expected numeric point count for ${method}`);
    assert.ok(Number.isFinite(Number(row[3])), `expected numeric r2 for ${method}`);
    assert.ok(Number.isFinite(Number(row[4])), `expected numeric rmse for ${method}`);
    assert.equal(typeof row[5], 'string');
    assert.equal(typeof row[6], 'string');
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
