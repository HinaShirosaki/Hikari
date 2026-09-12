module.exports = function registerPlatformAndRegressionSuiteStateNormalization(context = {}) {
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

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(Number.isFinite(actual), true, `Expected finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
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
test('[P1] normalizeState drops retired derived and feature state', () => {
  const normalized = shared.normalizeState({
    objectGraph: { nodes: { stale: true } },
    synthesisChemistryDrafts: { stale: { title: 'Retired draft' } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'objectGraph'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'synthesisChemistryDrafts'), false);
});
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
  assert.equal(Array.isArray(normalized.agentChat.folders), true);
  assert.equal(Object.keys(normalized.agentChat.sessionFolderIds).length, 0);
  assert.equal(normalized.agentChat.selectedFolderId, 'general');
  assert.equal(Array.isArray(normalized.agentChat.expandedFolderIds), true);
  assert.equal(normalized.agentChat.expandedFolderIds.length, 0);
  assert.equal(normalized.agentChat.folderExpansionInitialized, false);
});
test('[P1] normalizeState preserves provided agentChat messages array', () => {
  const payload = [{ id: 'm1', role: 'user', text: 'hello' }];
  const normalized = shared.normalizeState({
    agentChat: {
      projectId: 'p1',
      currentSessionId: 'chat-1',
      sessions: [{ id: 'chat-1', title: 'Saved Chat' }],
      folders: [{ id: 'folder-1', name: 'Planning' }],
      sessionFolderIds: { 'chat-1': 'custom:folder-1' },
      selectedFolderId: 'custom:folder-1',
      expandedFolderIds: ['custom:folder-1'],
      messages: payload
    }
  });
  assert.equal(normalized.agentChat.projectId, 'p1');
  assert.equal(normalized.agentChat.currentSessionId, 'chat-1');
  assert.equal(normalized.agentChat.sessions.length, 1);
  assert.equal(normalized.agentChat.folders.length, 1);
  assert.equal(normalized.agentChat.sessionFolderIds['chat-1'], 'custom:folder-1');
  assert.equal(normalized.agentChat.selectedFolderId, 'custom:folder-1');
  assert.equal(normalized.agentChat.expandedFolderIds[0], 'custom:folder-1');
  assert.equal(normalized.agentChat.folderExpansionInitialized, true);
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
test('[P1] normalizeState normalizes multiple preferred journals from list and legacy strings', () => {
  const normalized = shared.normalizeState({
    settings: {
      preferredJournals: ['Nature Biotechnology; Cell', ' nature biotechnology '],
      preferredJournal: 'Science\nCell'
    }
  });
  assert.deepEqual(normalized.settings.preferredJournals, ['Nature Biotechnology', 'Cell', 'Science']);
  assert.equal(normalized.settings.preferredJournal, 'Nature Biotechnology; Cell; Science');
});
test('[P0] normalizeState keeps default sample inventory locations when invalid', () => {
  const normalized = shared.normalizeState({ settings: { sampleInventoryLocations: 'bad' } });
  assert.deepEqual(
    Array.from(normalized.settings.sampleInventoryLocations),
    Array.from(shared.defaultState.settings.sampleInventoryLocations)
  );
});
test('[P1] normalizeState dedupes explicit sample inventory locations', () => {
  const normalized = shared.normalizeState({
    settings: {
      sampleInventoryLocations: ['Freezer A', ' freezer a ', 'Fridge B']
    }
  });
  assert.deepEqual(Array.from(normalized.settings.sampleInventoryLocations), ['Freezer A', 'Fridge B']);
});
test('[P1] normalizeState merges sample type label overrides', () => {
  const normalized = shared.normalizeState({
    settings: {
      sampleTypeLabels: {
        plasmid: 'Construct',
        cell_line: ''
      }
    }
  });
  assert.equal(normalized.settings.sampleTypeLabels.plasmid, 'Construct');
  assert.equal(normalized.settings.sampleTypeLabels.cell_line, shared.defaultState.settings.sampleTypeLabels.cell_line);
});
test('[P1] normalizeState preserves custom sample types and hidden defaults', () => {
  const normalized = shared.normalizeState({
    settings: {
      sampleTypeLabels: {
        custom_tissue: 'Tissue'
      },
      sampleTypeHidden: ['antibody', 'invalid', 'antibody']
    }
  });
  assert.equal(normalized.settings.sampleTypeLabels.custom_tissue, 'Tissue');
  assert.deepEqual(Array.from(normalized.settings.sampleTypeHidden), ['antibody']);
});
test('[P1] normalizeState preserves the Hatsune Miku appearance theme', () => {
  const normalized = shared.normalizeState({
    settings: {
      appearance: {
        mode: 'miku'
      }
    }
  });
  assert.equal(normalized.settings.appearance.mode, 'miku');
});
test('[P0] normalizeState resets unsupported appearance themes to day', () => {
  const normalized = shared.normalizeState({
    settings: {
      appearance: {
        mode: 'unknown-theme'
      }
    }
  });
  assert.equal(normalized.settings.appearance.mode, 'day');
});
test('[P1] normalizeState keeps startup defaults when settings.startup is missing', () => {
  const normalized = shared.normalizeState({ settings: {} });
  assert.equal(normalized.settings.startup.defaultViewId, shared.defaultState.settings.startup.defaultViewId);
  assert.equal(normalized.settings.startup.rememberLastView, shared.defaultState.settings.startup.rememberLastView);
});
test('[P1] normalizeState keeps notebook PDF export defaults when settings are missing', () => {
  const normalized = shared.normalizeState({ settings: {} });
  assert.equal(normalized.settings.notebookPdf.pageSize, 'letter');
  assert.equal(normalized.settings.notebookPdf.stapleEdge, 'none');
});
test('[P1] normalizeState preserves supported notebook PDF page and staple settings', () => {
  const normalized = shared.normalizeState({
    settings: {
      notebookPdf: {
        pageSize: 'A4',
        stapleEdge: 'TOP'
      }
    }
  });
  assert.equal(normalized.settings.notebookPdf.pageSize, 'a4');
  assert.equal(normalized.settings.notebookPdf.stapleEdge, 'top');
});
test('[P0] normalizeState resets unsupported notebook PDF settings to defaults', () => {
  const normalized = shared.normalizeState({
    settings: {
      notebookPdf: {
        pageSize: 'poster',
        stapleEdge: 'right'
      }
    }
  });
  assert.equal(normalized.settings.notebookPdf.pageSize, 'letter');
  assert.equal(normalized.settings.notebookPdf.stapleEdge, 'none');
});
test('[P0] normalizeState falls back to home-view for invalid startup defaultViewId', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'unknown-view-id',
        rememberLastView: true
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'home-view');
  assert.equal(normalized.settings.startup.rememberLastView, true);
});
test('[P0] normalizeState resets invalid startup flags to defaults', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'assay-view',
        rememberLastView: 'yes'
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'assay-view');
  assert.equal(
    normalized.settings.startup.rememberLastView,
    shared.defaultState.settings.startup.rememberLastView
  );
});
test('[P1] normalizeState forces legacy API endpoint settings onto the Codex release agent', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'https://example.com/v1' } } });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiKey'), false);
  assert.equal(normalized.settings.llm.provider, 'codex');
});
test('[P1] normalizeState treats codex:// legacy llm.api as a Codex agent marker', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'codex', api: 'codex://cli' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiKey'), false);
});
test('[P1] normalizeState clears API credentials while the release agent is Codex-only', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'legacy-key', apiKey: 'new-key' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiKey'), false);
});
test('[P1] normalizeState clears API endpoints while the release agent is Codex-only', () => {
  const normalized = shared.normalizeState({ settings: { llm: { apiEndpoint: '  https://api.example/v1  ' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
});
test('[P1] normalizeState replaces an explicit API provider with Codex in release builds', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'claude' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
});
test('[P1] normalizeState replaces an inferred API provider with Codex in release builds', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
});
test('[P1] normalizeState infers llm.provider from legacy codex marker without keeping an endpoint', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'codex://cli'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.settings.llm, 'apiEndpoint'), false);
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
  ['a.ena', false],
  ['a.ENA', false],
  ['a.json ', true],
  [' a.ena', false],
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
  ['/tmp/a.ena', '', '/tmp/a.ena.json'],
  ['/tmp/a.JSON', '', '/tmp/a.JSON'],
  ['  /tmp/a  ', '', '/tmp/a.json'],
  ['', '', ''],
  [null, '/tmp/fallback.ena', '/tmp/fallback.ena.json'],
  [undefined, '/tmp/fallback', '/tmp/fallback.json']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[P0] normalizeDataFilePath case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});
  }
};
