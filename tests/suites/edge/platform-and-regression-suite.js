module.exports = function registerPlatformAndRegressionSuite(context = {}) {
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

normalizedArrayKeys.forEach((key) => {
  test(`[P0] normalizeState resets invalid "${key}" to []`, () => {
    const normalized = shared.normalizeState({ [key]: { bad: true } });
    assert.equal(Array.isArray(normalized[key]), true);
    assert.equal(normalized[key].length, 0);
  });
});

normalizedArrayKeys.forEach((key) => {
  test(`[P1] normalizeState preserves valid array for "${key}"`, () => {
    const payload = [{ id: `${key}-1` }];
    const normalized = shared.normalizeState({ [key]: payload });
    if (key === 'papers') {
      assert.equal(normalized[key].length, 1);
      assert.equal(normalized[key][0].id, 'papers-1');
      assert.equal(Array.isArray(normalized[key][0].comments), true);
      assert.equal(normalized[key][0].comments.length, 0);
      return;
    }
    assert.deepEqual(normalized[key], payload);
  });
});

test('[P1] normalizeState adds empty comments array to papers missing comment data', () => {
  const normalized = shared.normalizeState({
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas'
      }
    ]
  });
  assert.equal(Array.isArray(normalized.papers[0].comments), true);
  assert.equal(normalized.papers[0].comments.length, 0);
});

test('[P0] normalizeState drops malformed nested paper comments', () => {
  const normalized = shared.normalizeState({
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas',
        comments: [
          null,
          { id: '', pageNumber: 1, anchorX: 0.5, anchorY: 0.5, text: 'missing id' },
          { id: 'bad-page', pageNumber: 0, anchorX: 0.5, anchorY: 0.5, text: 'bad page' },
          { id: 'good', pageNumber: 2, anchorX: 1.7, anchorY: -1, text: 'valid after clamp', author: '' }
        ]
      }
    ]
  });
  assert.equal(normalized.papers[0].comments.length, 1);
  assert.equal(normalized.papers[0].comments[0].id, 'good');
  assert.equal(normalized.papers[0].comments[0].pageNumber, 2);
  assert.equal(normalized.papers[0].comments[0].anchorX, 1);
  assert.equal(normalized.papers[0].comments[0].anchorY, 0);
  assert.equal(normalized.papers[0].comments[0].author, 'Local user');
});

test('[P1] pdf viewer comment anchors normalize to unit coordinates and percent positions', () => {
  const anchor = papersPdfViewerInternals.computePdfAnchorFromClientPoint({
    clientX: 60,
    clientY: 45,
    rect: {
      left: 10,
      top: 20,
      width: 200,
      height: 100
    }
  });
  assertClose(anchor.anchorX, 0.25);
  assertClose(anchor.anchorY, 0.25);

  const clamped = papersPdfViewerInternals.computePdfAnchorFromClientPoint({
    clientX: 999,
    clientY: -50,
    rect: {
      left: 10,
      top: 20,
      width: 200,
      height: 100
    }
  });
  assert.equal(clamped.anchorX, 1);
  assert.equal(clamped.anchorY, 0);

  const position = papersPdfViewerInternals.getPdfCommentPinPosition(0.25, 0.75);
  assert.equal(position.left, '25.000%');
  assert.equal(position.top, '75.000%');
});

test('[P0] normalizeState resets invalid knowledgeChats object', () => {
  const normalized = shared.normalizeState({ knowledgeChats: 'bad' });
  assert.equal(typeof normalized.knowledgeChats, 'object');
  assert.equal(Array.isArray(normalized.knowledgeChats), false);
  assert.equal(Object.keys(normalized.knowledgeChats).length, 0);
});

test('[P0] normalizeState normalizes agentChat defaults', () => {
  const normalized = shared.normalizeState({ agentChat: { projectId: 123, messages: 'bad' } });
  assert.equal(normalized.agentChat.projectId, '123');
  assert.equal(normalized.agentChat.currentSessionId, '');
  assert.equal(Array.isArray(normalized.agentChat.sessions), true);
  assert.equal(normalized.agentChat.sessions.length, 0);
  assert.equal(Array.isArray(normalized.agentChat.messages), true);
  assert.equal(normalized.agentChat.messages.length, 0);
});

test('[P1] normalizeState preserves provided agentChat messages array', () => {
  const payload = [{ id: 'm1', role: 'user', text: 'hello' }];
  const normalized = shared.normalizeState({
    agentChat: {
      projectId: 'p1',
      currentSessionId: 'chat-1',
      sessions: [{ id: 'chat-1', title: 'Saved Chat' }],
      messages: payload
    }
  });
  assert.equal(normalized.agentChat.projectId, 'p1');
  assert.equal(normalized.agentChat.currentSessionId, 'chat-1');
  assert.equal(normalized.agentChat.sessions.length, 1);
  assert.deepEqual(normalized.agentChat.messages, payload);
});

test('[P0] normalizeState keeps default inventory locations when invalid', () => {
  const normalized = shared.normalizeState({ settings: { inventoryLocations: 'bad' } });
  assert.deepEqual(normalized.settings.inventoryLocations, shared.defaultState.settings.inventoryLocations);
});

test('[P1] normalizeState preserves explicit inventory locations array', () => {
  const normalized = shared.normalizeState({ settings: { inventoryLocations: ['Freezer A', 'Fridge B'] } });
  assert.deepEqual(normalized.settings.inventoryLocations, ['Freezer A', 'Fridge B']);
});

test('[P1] normalizeState keeps startup defaults when settings.startup is missing', () => {
  const normalized = shared.normalizeState({ settings: {} });
  assert.deepEqual(normalized.settings.startup, shared.defaultState.settings.startup);
});

test('[P0] normalizeState falls back to home-view for invalid startup defaultViewId', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'unknown-view-id',
        rememberLastView: true,
        autoLoadDataFileOnLaunch: true
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'home-view');
  assert.equal(normalized.settings.startup.rememberLastView, true);
  assert.equal(normalized.settings.startup.autoLoadDataFileOnLaunch, true);
});

test('[P0] normalizeState resets invalid startup flags to defaults', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'assay-view',
        rememberLastView: 'yes',
        autoLoadDataFileOnLaunch: 1
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'assay-view');
  assert.equal(
    normalized.settings.startup.rememberLastView,
    shared.defaultState.settings.startup.rememberLastView
  );
  assert.equal(
    normalized.settings.startup.autoLoadDataFileOnLaunch,
    shared.defaultState.settings.startup.autoLoadDataFileOnLaunch
  );
});

test('[P1] normalizeState migrates legacy endpoint from llm.api URL', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'https://example.com/v1' } } });
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://example.com/v1');
  assert.equal(normalized.settings.llm.apiKey, '');
  assert.equal(normalized.settings.llm.provider, 'openai');
});

test('[P1] normalizeState treats codex:// legacy llm.api as endpoint', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'codex', api: 'codex://cli' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(normalized.settings.llm.apiEndpoint, 'codex://cli');
  assert.equal(normalized.settings.llm.apiKey, '');
});

test('[P1] normalizeState keeps explicit llm.apiKey over legacy llm.api key', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'legacy-key', apiKey: 'new-key' } } });
  assert.equal(normalized.settings.llm.apiKey, 'new-key');
});

test('[P1] normalizeState trims llm.apiEndpoint whitespace', () => {
  const normalized = shared.normalizeState({ settings: { llm: { apiEndpoint: '  https://api.example/v1  ' } } });
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://api.example/v1');
});

test('[P1] normalizeState keeps explicit llm.provider', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'claude' } } });
  assert.equal(normalized.settings.llm.provider, 'claude');
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://api.anthropic.com/v1/messages');
});

test('[P1] normalizeState infers llm.provider from endpoint', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'gemini');
});

test('[P1] normalizeState infers llm.provider from codex endpoint', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'codex://cli'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'codex');
});

test('[P1] normalizeState preserves supported llm reasoning effort values', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh'
      }
    }
  });
  assert.equal(normalized.settings.llm.reasoningEffort, 'xhigh');
});

test('[P1] normalizeState clears unsupported llm reasoning effort values for the selected model', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        provider: 'codex',
        model: 'gpt-5.1-codex-mini',
        reasoningEffort: 'xhigh'
      }
    }
  });
  assert.equal(normalized.settings.llm.reasoningEffort, '');
});

test('[P1] normalizeState does not mutate defaultState arrays', () => {
  const normalized = shared.normalizeState({});
  normalized.members.push({ id: 'm1' });
  assert.equal(shared.defaultState.members.length, 0);
});

test('[P1] normalizeState merges objectGraph from source', () => {
  const normalized = shared.normalizeState({
    objectGraph: {
      nodes: { 'project:p1': { uid: 'project:p1' } },
      edges: [{ from: 'a', to: 'b', relation: 'r' }]
    }
  });
  assert.equal(Boolean(normalized.objectGraph.nodes['project:p1']), true);
  assert.equal(normalized.objectGraph.edges.length, 1);
});

[
  ['plain text', 'plain text'],
  ['<tag>', '&lt;tag&gt;'],
  ['Tom & Jerry', 'Tom &amp; Jerry'],
  ['"quoted"', '&quot;quoted&quot;'],
  ["it's", 'it&#39;s'],
  [null, ''],
  [123, '123']
].forEach(([input, expected], idx) => {
  test(`[P0] safeText case ${idx + 1}`, () => {
    assert.equal(shared.safeText(input), expected);
  });
});

[
  ['abc', 'abc'],
  ['a"b', 'a\\"b'],
  ['a\\b', 'a\\\\b'],
  ['"\\', '\\"\\\\'],
  ['', ''],
  [123, '123']
].forEach(([input, expected], idx) => {
  test(`[P1] cssEscape case ${idx + 1}`, () => {
    assert.equal(shared.cssEscape(input), expected);
  });
});

[
  'protocol_share_sent',
  'protocol_share_imported',
  'protocol_share_link_copied',
  'protocol_share_link_imported'
].forEach((eventName) => {
  test(`[P0] trackGrowthEvent increments counter "${eventName}"`, () => {
    const state = {};
    shared.trackGrowthEvent(state, eventName, { source: 'unit' });
    assert.equal(state.growthMetrics.counters[eventName], 1);
    assert.equal(state.growthMetrics.events.length, 1);
    assert.equal(state.growthMetrics.events[0].name, eventName);
  });
});

test('[P1] trackGrowthEvent records unknown events without counter mutation', () => {
  const state = {};
  shared.trackGrowthEvent(state, 'unknown_event', { a: 1 });
  assert.equal(state.growthMetrics.counters.protocol_share_sent, 0);
  assert.equal(state.growthMetrics.events.length, 1);
  assert.equal(state.growthMetrics.events[0].name, 'unknown_event');
});

test('[P1] trackGrowthEvent clones props object', () => {
  const state = {};
  const props = { a: 1 };
  shared.trackGrowthEvent(state, 'unknown_event', props);
  props.a = 2;
  assert.equal(state.growthMetrics.events[0].props.a, 1);
});

test('[P1] createId returns non-empty token containing "-" separator', () => {
  const value = shared.createId();
  assert.equal(typeof value, 'string');
  assert.equal(value.includes('-'), true);
  assert.ok(value.length > 8);
});

[
  ['a.json', true],
  ['a.JSON', true],
  ['a.ena', true],
  ['a.ENA', true],
  ['a.json ', true],
  [' a.ena', true],
  ['a.txt', false],
  ['a.json.bak', false],
  ['json', false],
  ['', false]
].forEach(([input, expected], idx) => {
  test(`[P0] hasSupportedDataExtension case ${idx + 1}`, () => {
    assert.equal(mainUtils.hasSupportedDataExtension(input), expected);
  });
});

[
  ['/tmp/a.json', '/tmp/fallback.json', '/tmp/a.json'],
  ['/tmp/a', '/tmp/fallback.json', '/tmp/a.json'],
  ['', '/tmp/fallback.json', '/tmp/fallback.json'],
  ['', '/tmp/fallback', '/tmp/fallback.json'],
  ['/tmp/a.ena', '', '/tmp/a.ena'],
  ['/tmp/a.JSON', '', '/tmp/a.JSON'],
  ['  /tmp/a  ', '', '/tmp/a.json'],
  ['', '', ''],
  [null, '/tmp/fallback.ena', '/tmp/fallback.ena'],
  [undefined, '/tmp/fallback', '/tmp/fallback.json']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[P0] normalizeDataFilePath case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});

[
  ['My Plasmid', 'My_Plasmid'],
  ['  spaced name  ', 'spaced_name'],
  ['A/B:C', 'A_B_C'],
  ['___abc___', 'abc'],
  ['a.b-c_d', 'a.b-c_d'],
  ['***', 'plasmid'],
  ['', 'plasmid'],
  [null, 'plasmid'],
  ['alpha beta gamma', 'alpha_beta_gamma'],
  ['中文', 'plasmid']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeOutputName default fallback case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeOutputName(input), expected);
  });
});

test('[P1] sanitizeOutputName uses custom fallback when normalized output is empty', () => {
  assert.equal(mainUtils.sanitizeOutputName('***', 'fallback_name'), 'fallback_name');
});

[
  [' _pL ann!* ', '_pLann'],
  ['suffix-1', 'suffix-1'],
  ['A.B_C', 'A.B_C'],
  ['   ', ''],
  [null, '_pLann'],
  [undefined, '_pLann'],
  ['x/y:z', 'xyz'],
  ['"quoted"', 'quoted']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeSuffix case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeSuffix(input), expected);
  });
});

[
  ['', ''],
  ['   ', ''],
  ['>already\nACGT\n', '>already\nACGT'],
  ['acgt', '>sequence\nACGT\n'],
  ['ac gt 123', '>sequence\nACGT\n'],
  ['n-n-n', '>sequence\nNNN\n'],
  ['abc!def', '>sequence\nABCDEF\n'],
  ['a'.repeat(80), `>sequence\n${'A'.repeat(80)}\n`],
  ['a'.repeat(81), `>sequence\n${'A'.repeat(80)}\nA\n`],
  ['a'.repeat(160), `>sequence\n${'A'.repeat(80)}\n${'A'.repeat(80)}\n`]
].forEach(([input, expected], idx) => {
  test(`[P0] normalizeSequenceInput case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});

const expectedGraphRelations = [
  ['workflow:w1', 'uses_project', 'project:p1'],
  ['workflow:w1', 'links_notebook_page', 'notebook_entry:n1'],
  ['workflow:w1', 'has_block', 'workflow_block:w1:block:b1'],
  ['workflow_block:w1:block:b1', 'uses_protocol', 'protocol:pr1'],
  ['workflow_block:w1:block:b1', 'assigned_to', 'person:m1'],
  ['workflow_template:wt1', 'has_block', 'workflow_template_block:wt1:block:tb1'],
  ['workflow_template_block:wt1:block:tb1', 'uses_protocol', 'protocol:pr1'],
  ['workflow_template_block:wt1:block:tb1', 'suggested_assignee', 'person:m1'],
  ['paper:pa1', 'describes_method', 'method:pa1:method:1'],
  ['paper:pa1', 'mentions_reagent', 'reagent:pa1:reagent:1'],
  ['sample:S-1', 'stored_at', 'location:F1 -> R1 -> B1 -> A1'],
  ['sample:S-1', 'related_chemical', 'chemical:c1'],
  ['sample:S-1', 'stored_in_container', 'container:box1'],
  ['sample:box1:well:1', 'stored_in', 'container:box1'],
  ['notebook_entry:n1', 'uses_project', 'project:p1'],
  ['notebook_entry:n1', 'uses_protocol', 'protocol:pr1'],
  ['notebook_entry:n1', 'uses_instrument', 'instrument:i1'],
  ['notebook_entry:n1', 'uses_chemical', 'chemical:c1'],
  ['notebook_entry:n1', 'uses_sample', 'sample:S-1'],
  ['notebook_entry:n1', 'references_paper', 'paper:pa1'],
  ['notebook_entry:n1', 'performed_by', 'person:m1'],
  ['notebook_entry:n1', 'uses_reagent_lot', 'reagent_lot:lot-42'],
  ['notebook_entry:n1', 'produces_compound', 'compound:CMP-1'],
  ['notebook_entry:n1', 'has_attachment', 'file:n1:result.txt'],
  ['assay:a1', 'uses_project', 'project:p1'],
  ['assay:a1', 'links_notebook_page', 'notebook_entry:n1'],
  ['gel_analysis:g1', 'uses_project', 'project:p1'],
  ['gel_analysis:g1', 'links_notebook_page', 'notebook_entry:n1'],
  ['paper:pa1', 'inspires_experiment', 'notebook_entry:n1']
];

expectedGraphRelations.forEach(([from, relation, to], idx) => {
  test(`[P0] rebuildObjectGraph relation case ${idx + 1}`, () => {
    const graph = objectGraph.rebuildObjectGraph(buildObjectGraphFixture());
    assert.equal(hasEdge(graph, from, relation, to), true);
  });
});

[
  [{ storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' }, 'location:F1 -> R1 -> B1 -> A1'],
  [{ storageType: 'fridge', fridge: 'FR1', shelf: 'Top' }, 'location:FR1 -> Top'],
  [{ storageType: 'desiccator', desiccator: 'D2', position: 'P3' }, 'location:D2 -> P3'],
  [{ storageType: 'cabinet', cabinet: 'CAB', slot: 'S1' }, 'location:CAB -> S1']
].forEach(([location, expectedNode], idx) => {
  test(`[P1] rebuildObjectGraph builds location node case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    state.samples = [{ id: 's1', code: 'S-1', name: 'Sample', location, chemicalLinks: [], inventoryLink: null }];
    const graph = objectGraph.rebuildObjectGraph(state);
    assert.equal(Boolean(graph.nodes[expectedNode]), true);
  });
});

[
  ['uses_chemical', 'chemical', 'c1', ['n1']],
  ['uses_sample', 'sample', 'S-1', ['n1']],
  ['uses_reagent_lot', 'reagent_lot', 'lot-42', ['n1']],
  ['references_paper', 'paper', 'pa1', ['n1']],
  ['performed_by', 'person', 'm1', ['n1']],
  ['uses_project', 'project', 'missing', []],
  ['missing_relation', 'chemical', 'c1', []]
].forEach(([relation, targetType, targetId, expectedIds], idx) => {
  test(`[P0] queryNotebookEntriesByRelation case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const entries = objectGraph.queryNotebookEntriesByRelation(state, { relation, targetType, targetId });
    assert.equal(JSON.stringify(entries.map((item) => item.id)), JSON.stringify(expectedIds));
  });
});

[
  ['i1', '2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.000Z', ['n1']],
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z', ['n1']],
  ['i1', 'bad', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-01T00:00:00.000Z', 'bad', []],
  ['i2', '2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-16T00:00:00.000Z', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-31T23:59:59.000Z', '2026-01-01T00:00:00.000Z', []]
].forEach(([instrumentId, startIso, endIso, expectedIds], idx) => {
  test(`[P0] queryInstrumentUsageInRange case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const entries = objectGraph.queryInstrumentUsageInRange(state, instrumentId, startIso, endIso);
    assert.equal(JSON.stringify(entries.map((item) => item.id)), JSON.stringify(expectedIds));
  });
});

const moduleExportContracts = [
  ['src/renderer/modules/agent-chat.js', /export function initAgentChat/],
  ['src/renderer/modules/assay.js', /export function initAssay/],
  ['src/renderer/modules/assay-analysis.js', /export function analyzeAssayData/],
  ['src/renderer/modules/biology-notebook.js', /export function initLabNotebook/],
  ['src/renderer/modules/buffer-compounds.js', /export const BUFFER_COMPOUNDS/],
  ['src/renderer/modules/collaboration-management.js', /export function initCollaborationManagement/],
  ['src/renderer/modules/gel-analysis.js', /export function initGelAnalysis/],
  ['src/renderer/modules/instrument-management.js', /export function initInstrumentManagement/],
  ['src/renderer/modules/lab-common-inventory.js', /export function initLabCommonInventory/],
  ['src/renderer/modules/lab-management.js', /export function initLabManagement/],
  ['src/renderer/modules/lab-notebook.js', /export function initLabNotebook/],
  ['src/renderer/modules/object-graph.js', /export function createUid/],
  ['src/renderer/modules/object-graph.js', /export function rebuildObjectGraph/],
  ['src/renderer/modules/papers-management.js', /export function initPapersManagement/],
  ['src/renderer/modules/personal-inventory.js', /export function initPersonalInventory/],
  ['src/renderer/modules/project-management.js', /export function initProjectManagement/],
  ['src/renderer/modules/protocol-management.js', /export function initProtocolManagement/],
  ['src/renderer/modules/sample-registry.js', /export function initSampleRegistry/],
  ['src/renderer/modules/settings.js', /export function initSettings/],
  ['src/renderer/modules/tool-box.js', /export function initToolBox/],
  ['src/renderer/modules/workflow-management.js', /export function initWorkflowManagement/]
];

moduleExportContracts.forEach(([relativePath, pattern], idx) => {
  test(`[P1] module export contract case ${idx + 1} (${relativePath})`, () => {
    assert.match(readSource(relativePath), pattern);
  });
});

const removedCodeGuards = [
  ['src/renderer/modules/shared.js', /LAB_NOTEBOOK/, false],
  ['src/main/lib/telegramBot.js', /telegram-message/, false],
  ['src/main/preload.js', /onTelegramMessage/, false],
  ['ketcher-embedded.html', /\/Users\//, false],
  ['ketcher-embedded.html', /file:\/\//, false],
  ['index.html', /lab-notebook-view/, false],
  ['src/renderer/renderer.js', /VIEWS\.LAB_NOTEBOOK/, false],
  ['forge.config.js', /enana-data/, true],
  ['package.json', /"build:ui": "node scripts\/build-ui\.mjs"/, true],
  ['package.json', /"check:dom-ids": "node scripts\/check-dom-ids\.mjs"/, true],
  ['package.json', /"dist": "npm run build:ui && electron-forge make"/, true],
  ['package.json', /"package:app": "npm run build:ui && electron-forge package"/, true],
  ['src/renderer/modules/agent-chat.js', /apiKey: String\(state\.settings\?\.llm\?\.apiKey/, true]
];

removedCodeGuards.forEach(([relativePath, pattern, shouldMatch], idx) => {
  test(`[P1] regression guard case ${idx + 1} (${relativePath})`, () => {
    const source = readSource(relativePath);
    assert.equal(pattern.test(source), shouldMatch);
  });
});

const indexHtmlSource = readSource('index.html');
const appRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
const sectionViews = new Set([...indexHtmlSource.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
const navViews = new Set((appRegistry.apps || []).map((app) => app.viewId));
const nonHomeViews = Object.values(shared.VIEWS).filter((viewId) => viewId !== shared.VIEWS.HOME);

nonHomeViews.forEach((viewId) => {
  test(`[P0] index section exists for ${viewId}`, () => {
    assert.equal(sectionViews.has(viewId), true);
  });
});

const navExpectedViews = nonHomeViews.filter((viewId) => viewId !== shared.VIEWS.PERSONAL_INVENTORY);
navExpectedViews.forEach((viewId) => {
  test(`[P0] app registry entry exists for ${viewId}`, () => {
    assert.equal(navViews.has(viewId), true);
  });
});

Object.entries(shared.TITLES).forEach(([viewId, title], idx) => {
  test(`[P1] title text exists for mapped view case ${idx + 1} (${viewId})`, () => {
    assert.equal(typeof title, 'string');
    assert.ok(title.trim().length > 0);
  });
});

const extraInvalidValues = [null, undefined, '', '[]', 0, 1, true, false, () => 1, Symbol.for('x')];
normalizedArrayKeys.forEach((key) => {
  extraInvalidValues.forEach((value, idx) => {
    test(`[EDGE] normalizeState invalid type matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      assert.equal(Array.isArray(normalized[key]), true);
      assert.equal(normalized[key].length, 0);
    });
  });
});

normalizedArrayKeys.forEach((key) => {
  [
    [{ id: `${key}-a` }],
    [{ id: `${key}-a` }, { id: `${key}-b` }],
    [1, 2, 3]
  ].forEach((value, idx) => {
    test(`[EDGE] normalizeState valid array matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      if (key === 'papers' && idx < 2) {
        assert.equal(normalized[key].length, value.length);
        normalized[key].forEach((item, itemIndex) => {
          assert.equal(item.id, value[itemIndex].id);
          assert.equal(Array.isArray(item.comments), true);
          assert.equal(item.comments.length, 0);
        });
        return;
      }
      assert.deepEqual(normalized[key], value);
    });
  });
});

[
  '<script>',
  '<IMG SRC=x onerror=alert(1)>',
  '&already&escaped',
  'a"b"c',
  "apostrophe's test",
  '<<>>',
  '汉字<script>',
  '\nline\nbreak',
  '`code`',
  '<svg><path/></svg>',
  String.raw`slash\quote"combo`,
  '<a href="javascript:alert(1)">x</a>'
].forEach((input, idx) => {
  test(`[EDGE] safeText strips dangerous chars case ${idx + 1}`, () => {
    const output = shared.safeText(input);
    assert.equal(output.includes('<'), false);
    assert.equal(output.includes('>'), false);
  });
});

[
  '"',
  '\\',
  '\\"',
  'abc\\"def',
  'path\\to\\dir',
  'mix"and\\slash',
  '',
  'simple',
  '""""',
  '\\\\\\\\'
].forEach((input, idx) => {
  test(`[EDGE] cssEscape escapes quote/slash matrix case ${idx + 1}`, () => {
    const output = shared.cssEscape(input);
    assert.equal(/(^|[^\\])"/.test(output), false);
    assert.equal(output.includes('\\'), input.includes('\\') || input.includes('"'));
  });
});

[
  ['.json', true],
  ['.ena', true],
  ['file.', false],
  ['file..json', true],
  ['archive.tar.json', true],
  ['archive.tar.ena', true],
  [' spaced .json', true],
  ['a/b/c.ENA', true],
  ['A/B/C.Json', true],
  ['name\n.json', true],
  ['name\t.ena', true],
  ['sample.Json ', true],
  ['sample.Ena ', true],
  ['samplejson', false],
  ['sampleena', false],
  ['sample.jso', false],
  ['sample.en', false],
  ['sample.jpeg', false],
  ['sample.enaa', false],
  ['sample.jsonl', false],
  ['  ', false],
  ['a.🧪', false],
  ['A.JSON.BAK', false],
  ['a..ena', true],
  ['a..json', true],
  ['../relative/file.ena', true],
  ['../relative/file.json', true],
  ['C:\\temp\\file.json', true],
  ['C:\\temp\\file.ena', true],
  ['file.JSON\n', true]
].forEach(([input, expected], idx) => {
  test(`[EDGE] hasSupportedDataExtension extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.hasSupportedDataExtension(input), expected);
  });
});

for (let length = 1; length <= 120; length += 3) {
  test(`[EDGE] normalizeSequenceInput wrap behavior len ${length}`, () => {
    const source = 'acgt'.repeat(Math.ceil(length / 4)).slice(0, length);
    const output = mainUtils.normalizeSequenceInput(source);
    const lines = output.trim().split('\n');
    assert.equal(lines[0], '>sequence');
    const seq = lines.slice(1).join('');
    assert.equal(seq, source.toUpperCase());
    lines.slice(1).forEach((line) => {
      assert.ok(line.length <= 80);
    });
  });
}

[
  ['>h\nacgt\nnn\n', '>h\nacgt\nnn'],
  ['>h\r\nACGT\r\n', '>h\r\nACGT'],
  ['>h\n', '>h'],
  ['>header with space\nACGT', '>header with space\nACGT'],
  ['>\nACGT', '>\nACGT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] normalizeSequenceInput fasta passthrough case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});

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
