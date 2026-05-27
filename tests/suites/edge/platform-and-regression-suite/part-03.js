module.exports = function registerPlatformAndRegressionSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
const sourceCache = new Map();
function readSource(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!sourceCache.has(filePath)) {
    sourceCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return sourceCache.get(filePath);
}

function hasEdge(graph, from, relation, to) {
  return graph.edges.some((edge) => edge.from === from && edge.relation === relation && edge.to === to);
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(Number.isFinite(actual), true, `Expected finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

function buildObjectGraphFixture() {
  return {
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
    labInventory: { chemicals: [{ id: 'c1', name: 'Acetone' }] },
    samples: [
      {
        id: 's1',
        code: 'S-1',
        name: 'Sample 1',
        location: { storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' },
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
    assays: [{ id: 'a1', name: 'Assay 1', projectId: 'p1', notebookEntryId: 'n1' }],
    gelAnalyses: [{ id: 'g1', name: 'Gel 1', projectId: 'p1', notebookEntryId: 'n1', report: { confidence: { score: 0.9 } } }]
  };
}

const normalizedArrayKeys = [
  'instruments',
  'projects',
  'workflows',
  'workflowTemplates',
  'journalClubs',
  'papers',
  'paperExperimentLinks',
  'notebookEntries',
  'assays',
  'gelAnalyses',
  'samples',
  'messages'
];
[
  ['/tmp/name.', '/tmp/fallback.json', '/tmp/name..json'],
  ['/tmp/.hidden', '/tmp/fallback.json', '/tmp/.hidden.json'],
  ['/tmp/valid.ENA', '/tmp/fallback.json', '/tmp/valid.ENA'],
  ['/tmp/valid.Json', '/tmp/fallback.json', '/tmp/valid.Json'],
  ['/tmp/with spaces', '/tmp/fallback.ena', '/tmp/with spaces.json'],
  ['/tmp/multi.part.name', '/tmp/fallback.ena', '/tmp/multi.part.name.json'],
  ['  /tmp/trailing-space   ', '/tmp/fallback.ena', '/tmp/trailing-space.json'],
  ['', '/tmp/fallback.without.ext', '/tmp/fallback.without.ext.json'],
  [null, '/tmp/fallback.with.dot.', '/tmp/fallback.with.dot..json'],
  [undefined, '/tmp/only', '/tmp/only.json'],
  ['', '  ', ''],
  ['   ', '   ', '']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[EDGE] normalizeDataFilePath extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});
[
  ['a'.repeat(120), 'a'.repeat(120)],
  ['a b c d e', 'a_b_c_d_e'],
  ['___', 'plasmid'],
  ['.....', '.....'],
  ['abc/def?ghi', 'abc_def_ghi'],
  [' leading-and-trailing ', 'leading-and-trailing'],
  ['UPPER lower MIXED', 'UPPER_lower_MIXED'],
  ['multiple   spaces', 'multiple_spaces'],
  ['name-with-dash', 'name-with-dash'],
  ['name_with_underscore', 'name_with_underscore'],
  ['name.with.dot', 'name.with.dot'],
  ['$', 'plasmid'],
  ['\n\t', 'plasmid'],
  ['__alpha__beta__', 'alpha__beta'],
  ['A/B\\C:D*E?F"G<H>I|J', 'A_B_C_D_E_F_G_H_I_J']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeOutputName extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeOutputName(input), expected);
  });
});
[
  ['_alpha', '_alpha'],
  [' alpha beta ', 'alphabeta'],
  ['-x-y-z-', '-x-y-z-'],
  ['A.B.C', 'A.B.C'],
  ['A/B/C', 'ABC'],
  ['***suffix***', 'suffix'],
  ['123', '123'],
  ['__', '__'],
  ['\nA\tB\r', 'AB'],
  ['汉字', ''],
  [Symbol.for('x'), 'Symbolx']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeSuffix extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeSuffix(input), expected);
  });
});
[
  { section: '-20 Degree', location: { storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' }, node: 'location:F1 -> R1 -> B1 -> A1' },
  { section: '4 Degree', location: { storageType: 'fridge', fridge: 'FR1', shelf: 'S2' }, node: 'location:FR1 -> S2' },
  { section: 'Room Temp', location: { storageType: 'desiccator', desiccator: 'DS1', position: 'P2' }, node: 'location:DS1 -> P2' },
  { section: 'Room Temp', location: { storageType: 'cabinet', cabinet: 'CAB1', slot: 'SLOT3' }, node: 'location:CAB1 -> SLOT3' },
  { section: 'Room Temp', location: { storageType: 'other', text: 'Bench A' }, node: null },
  { section: 'Room Temp', location: {}, node: null }
].forEach((scenario, idx) => {
  test(`[EDGE] rebuildObjectGraph location normalization case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    state.samples = [{
      id: `s-${idx + 1}`,
      code: `S-${idx + 1}`,
      name: `Sample ${idx + 1}`,
      location: scenario.location,
      chemicalLinks: [],
      inventoryLink: null
    }];
    const graph = objectGraph.rebuildObjectGraph(state);
    if (!scenario.node) {
      assert.equal(Object.keys(graph.nodes).some((key) => key.startsWith('location:')), false);
      return;
    }
    assert.equal(Boolean(graph.nodes[scenario.node]), true);
  });
});
[
  { relation: 'uses_project', targetType: 'project', targetId: 'p1', expected: ['n1'] },
  { relation: 'uses_protocol', targetType: 'protocol', targetId: 'pr1', expected: ['n1'] },
  { relation: 'uses_instrument', targetType: 'instrument', targetId: 'i1', expected: ['n1'] },
  { relation: 'links_notebook_page', targetType: 'notebook_entry', targetId: 'n1', expected: [] },
  { relation: '', targetType: 'project', targetId: 'p1', expected: [] },
  { relation: 'uses_project', targetType: '', targetId: 'p1', expected: [] },
  { relation: 'uses_project', targetType: 'project', targetId: '', expected: [] },
  { relation: 'uses_project', targetType: 'project', targetId: 'missing', expected: [] },
  { relation: 'uses_sample', targetType: 'sample', targetId: 'missing', expected: [] },
  { relation: 'uses_reagent_lot', targetType: 'reagent_lot', targetId: 'lot-42', expected: ['n1'] },
  { relation: 'performed_by', targetType: 'person', targetId: 'm1', expected: ['n1'] },
  { relation: 'references_paper', targetType: 'paper', targetId: 'pa1', expected: ['n1'] }
].forEach((item, idx) => {
  test(`[EDGE] queryNotebookEntriesByRelation matrix case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const rows = objectGraph.queryNotebookEntriesByRelation(state, item);
    assert.equal(JSON.stringify(rows.map((row) => row.id)), JSON.stringify(item.expected));
  });
});
[
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 1],
  ['i1', '2026-01-14T23:59:59.000Z', '2026-01-15T00:00:00.000Z', 1],
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:01.000Z', 1],
  ['i1', '2026-01-15T00:00:01.000Z', '2026-01-16T00:00:00.000Z', 0],
  ['i1', '2026-01-01T00:00:00.000Z', '2026-01-14T23:59:59.000Z', 0],
  ['missing', '2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z', 0],
  ['i1', '2026-01-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0],
  ['i1', 'bad', '2026-01-01T00:00:00.000Z', 0],
  ['i1', '2026-01-01T00:00:00.000Z', 'bad', 0]
].forEach(([instrumentId, startIso, endIso, expectedCount], idx) => {
  test(`[EDGE] queryInstrumentUsageInRange boundary case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const rows = objectGraph.queryInstrumentUsageInRange(state, instrumentId, startIso, endIso);
    assert.equal(rows.length, expectedCount);
  });
});
  }
};