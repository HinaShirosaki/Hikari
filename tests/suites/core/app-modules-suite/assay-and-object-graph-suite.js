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

test('rebuildObjectGraph creates cross-module links used by queries', () => {
  const state = {
    members: [{ id: 'm1', name: 'Alice' }],
    projects: [{ id: 'p1', name: 'Project 1' }],
    protocols: [{ id: 'pr1', name: 'Protocol 1' }],
    workflowTemplates: [
      {
        id: 'wt1',
        name: 'Template 1',
        blocks: [{ id: 'tb1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    workflows: [
      {
        id: 'w1',
        name: 'Workflow 1',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [{ id: 'b1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    instruments: [{ id: 'i1', name: 'HPLC' }],
    papers: [
      {
        id: 'pa1',
        title: 'Paper 1',
        methodsExtract: [{ title: 'Method A' }],
        keyReagents: [{ name: 'Reagent A' }]
      }
    ],
    paperExperimentLinks: [{ paperId: 'pa1', entryId: 'n1', projectId: 'p1', note: 'linked' }],
    labInventory: {
      chemicals: [{ id: 'c1', name: 'Acetone' }]
    },
    samples: [
      {
        id: 's1',
        code: 'S-1',
        name: 'Sample 1',
        location: { storageType: 'fridge', fridge: 'F1', shelf: 'Top' },
        chemicalLinks: ['c1'],
        inventoryLink: { containerId: 'box1', section: '-20 Degree', wellIndex: 5 }
      }
    ],
    inventory: {
      '-20 Degree': [
        {
          id: 'box1',
          name: 'Box 1',
          type: 'box81',
          wells: [{ name: 'A1', content: 'Material' }]
        }
      ]
    },
    notebookEntries: [
      {
        id: 'n1',
        projectId: 'p1',
        protocolId: 'pr1',
        protocolName: 'Protocol 1',
        updatedAt: '2026-01-15T00:00:00.000Z',
        references: {
          instrumentId: 'i1',
          chemicalIds: ['c1'],
          sampleIds: ['S-1'],
          paperIds: ['pa1'],
          peopleIds: ['m1'],
          reagentLots: ['lot-42']
        },
        synthesisOutcome: {
          producedCompoundCode: 'CMP-1',
          purityPercent: 98,
          usedInAssay: 'yes'
        },
        resultFiles: ['result.txt']
      }
    ],
    assays: [
      {
        id: 'a1',
        name: 'Assay 1',
        projectId: 'p1',
        notebookEntryId: 'n1',
        sampleAxis: 'row',
        concentrationAxis: 'col',
        plateType: '96'
      }
    ],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel 1',
        projectId: 'p1',
        notebookEntryId: 'n1',
        analysisType: 'western',
        report: { confidence: { score: 0.9 } }
      }
    ]
  };

  const graph = objectGraph.rebuildObjectGraph(state);
  assert.equal(Boolean(graph.nodes['project:p1']), true);
  assert.equal(Boolean(graph.nodes['notebook_entry:n1']), true);
  assert.equal(Boolean(graph.nodes['workflow:w1']), true);
  assert.equal(Boolean(graph.nodes['workflow_block:w1:block:b1']), true);
  assert.equal(Boolean(graph.nodes['workflow_template:wt1']), true);
  assert.equal(Boolean(graph.nodes['workflow_template_block:wt1:block:tb1']), true);
  assert.equal(Boolean(graph.nodes['reagent_lot:lot-42']), true);
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow:w1' && edge.to === 'notebook_entry:n1' && edge.relation === 'links_notebook_page'),
    true
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w1:block:b1' && edge.to === 'person:m1' && edge.relation === 'assigned_to'),
    true
  );

  state.objectGraph = graph;
  const lotMatches = objectGraph.queryNotebookEntriesByRelation(state, {
    relation: 'uses_reagent_lot',
    targetType: 'reagent_lot',
    targetId: 'lot-42'
  });
  assert.equal(lotMatches.length, 1);
  assert.equal(lotMatches[0].id, 'n1');

  const usage = objectGraph.queryInstrumentUsageInRange(
    state,
    'i1',
    '2026-01-01T00:00:00.000Z',
    '2026-01-31T23:59:59.000Z'
  );
  assert.equal(usage.length, 1);
  assert.equal(usage[0].id, 'n1');
  assert.equal(objectGraph.queryInstrumentUsageInRange(state, 'i1', 'bad', 'date').length, 0);
});

test('rebuildObjectGraph supports plain-text workflow blocks without protocol edges', () => {
  const state = {
    members: [{ id: 'm1', name: 'Alice' }],
    workflowTemplates: [
      {
        id: 'wt-text',
        name: 'Text Template',
        blocks: [{ id: 'tb-text', type: 'text', text: 'Mix gently', assigneeId: 'm1' }],
        links: []
      }
    ],
    workflows: [
      {
        id: 'w-text',
        name: 'Text Workflow',
        projectId: '',
        notebookEntryIds: [],
        blocks: [{ id: 'b-text', type: 'text', text: 'Incubate 10 min', assigneeId: 'm1' }],
        links: []
      }
    ]
  };

  const graph = objectGraph.rebuildObjectGraph(state);
  assert.equal(Boolean(graph.nodes['workflow_block:w-text:block:b-text']), true);
  assert.equal(Boolean(graph.nodes['workflow_template_block:wt-text:block:tb-text']), true);
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w-text:block:b-text' && edge.relation === 'assigned_to' && edge.to === 'person:m1'),
    true
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w-text:block:b-text' && edge.relation === 'uses_protocol'),
    false
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_template_block:wt-text:block:tb-text' && edge.relation === 'uses_protocol'),
    false
  );
});

  }
};
