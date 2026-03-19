module.exports = function registerContractsSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('view constants and index navigation stay in sync', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const viewValues = Object.values(shared.VIEWS);
  const sectionViews = new Set([...html.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
  const navViews = new Set([...html.matchAll(/data-view=\"([^\"]+)\"/g)].map((match) => match[1]));

  const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
  const navRequiredViews = nonHomeViews.filter((value) => value !== shared.VIEWS.PERSONAL_INVENTORY);
  const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
  const missingNav = navRequiredViews.filter((value) => !navViews.has(value));
  const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

  assert.deepEqual(missingSections, []);
  assert.deepEqual(missingNav, []);
  assert.deepEqual(unknownNav, []);
});

test('sample and inventory use a merged navigation entry', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(
    html,
    /<button class="app-nav-btn" type="button" data-view="sample-registry-view">Sample &amp; Inventory<\/button>/
  );
  assert.equal(/<button[^>]+data-view="personal-inventory-view"/.test(html), false);
  assert.match(
    html,
    /<button class="tile" data-view="sample-registry-view">[\s\S]*?<span class="label">Sample &amp; Inventory<\/span>[\s\S]*?<\/button>/
  );
});

test('renderer routes personal inventory aliases to merged sample workspace', () => {
  const source = readSource('src/renderer/renderer.js');
  assert.match(
    source,
    /function normalizeViewId\(viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/
  );
  assert.match(source, /\['inventory', \{ viewId: VIEWS\.SAMPLE_REGISTRY, inputId: 'sample-search', label: 'Sample & Inventory' \}\]/);
  assert.match(source, /const showSampleInventoryWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
  assert.match(
    source,
    /if \(nextView === VIEWS\.SAMPLE_REGISTRY\) \{\s*personalInventory\.renderSections\(\);\s*sampleRegistry\.render\(\);\s*\}/
  );
});

test('renderer defines sequence viewer aliases and showView render hook', () => {
  const source = readSource('src/renderer/renderer.js');
  assert.match(source, /\['sequence', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /\['seqviewer', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /\['sequence-viewer', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /if \(nextView === VIEWS\.SEQUENCE_VIEWER\) \{\s*sequenceViewer\?\.render\?\.\(\);\s*\}/);
});

test('tool-box exposes optional sequence viewer handoff callback contract', () => {
  const source = readSource('src/renderer/modules/tool-box.js');
  assert.match(source, /export function initToolBox\(options = \{\}\)/);
  assert.match(source, /const onOpenSequenceViewer = typeof options\?\.onOpenSequenceViewer === 'function'/);
  assert.match(source, /plannotate-open-sequence-viewer/);
});

test('sequence viewer uses bottom feature track without table dependency', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const viewerSource = readSource('src/renderer/modules/sequence-viewer.js');
  assert.match(html, /id="sequence-viewer-feature-rail-host"/);
  assert.match(html, /id="sequence-viewer-feature-detail"/);
  assert.equal(html.includes('sequence-viewer-feature-table-body'), false);
  assert.equal(viewerSource.includes('featureTableBody'), false);
});

test('sequence viewer home workspace includes toolbar, library filter, and preview ids', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="sequence-viewer-home-workspace"/);
  assert.match(html, /id="sequence-viewer-home-paste-btn"/);
  assert.match(html, /id="sequence-viewer-home-open-btn"/);
  assert.equal(html.includes('id="sequence-viewer-home-import-btn"'), false);
  assert.match(html, /id="sequence-viewer-library-filter-saved"/);
  assert.match(html, /id="sequence-viewer-library-filter-temporary"/);
  assert.match(html, /id="sequence-viewer-library-list"/);
  assert.match(html, /id="sequence-viewer-preview-host"/);
  assert.match(html, /id="sequence-viewer-back-btn"/);
  assert.match(html, /id="sequence-viewer-save-btn"/);
});

test('ketcher embedded page uses portable static path resolution', () => {
  const html = fs.readFileSync(path.join(__dirname, 'ketcher-embedded.html'), 'utf8');
  assert.equal(html.includes('/Users/'), false);
  assert.equal(html.includes('C:\\\\Users'), false);
  assert.match(
    html,
    /new URL\('\.\/vendor\/ketcher-src\/packages\/release\/index\.html', window\.location\.href\)/
  );
});

test('forge config prunes dev deps and ignores build artifacts', () => {
  assert.equal(forgeConfig.packagerConfig.asar, true);
  assert.equal(forgeConfig.packagerConfig.prune, true);
  assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
  const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
  assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\.DS_Store/);
  assert.match(ignoreAsText, /enana-data\(\?:\\\.ena\)\?\\\.json/);
});

test('telegram bridge keeps only supported renderer IPC channel', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.equal(telegramBotSource.includes('telegram-message'), false);
  assert.equal(preloadSource.includes('onTelegramCommand'), true);
});

test('main and preload expose sequence library IPC bridge', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(mainSource, /require\('\.\/helpers\/main\/sequence-library'\)/);
  assert.match(mainSource, /ipcMain\.handle\('sequence-library:list'/);
  assert.match(mainSource, /ipcMain\.handle\('sequence-library:get'/);
  assert.match(mainSource, /ipcMain\.handle\('sequence-library:upsert'/);
  assert.match(mainSource, /ipcMain\.handle\('sequence-library:promote'/);
  assert.match(mainSource, /ipcMain\.handle\('sequence-library:delete'/);
  assert.match(preloadSource, /sequenceLibraryList:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:list', payload\)/);
  assert.match(preloadSource, /sequenceLibraryGet:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:get', payload\)/);
  assert.match(preloadSource, /sequenceLibraryUpsert:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:upsert', payload\)/);
});

test('telegram bot writes events to data/telegram-events.log by default', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
  assert.match(telegramBotSource, /data', 'telegram-events\.log'/);
  assert.equal(telegramBotSource.includes('telegram-messages.log'), false);
});

test('main agent chat logging records request/result/error with redacted API key metadata', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log';/);
  assert.match(mainSource, /ENANA_AGENT_CHAT_LOG_PATH/);
  assert.match(mainSource, /void ensureAgentChatLogFile\(getAgentChatLogPath\(\)\);/);
  assert.match(mainSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
  assert.equal(mainSource.includes('apiKey: cleanText(source.apiKey'), false);
  assert.match(mainSource, /type: 'agent-chat-request'/);
  assert.match(mainSource, /type: 'agent-chat-result'/);
  assert.match(mainSource, /type: 'agent-chat-error'/);
});

test('main agent chat includes lifecycle recorder, validation gate, and replay IPC handlers', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /const \{ validateAndGateResponse \} = require\('\.\/helpers\/agent\/agent-validation-safety'\)/);
  assert.match(mainSource, /createLifecycleRecorder/);
  assert.match(mainSource, /recordLifecycleEvent/);
  assert.match(mainSource, /appendLogWithRotation/);
  assert.match(mainSource, /applyValidationGateToOutput\(/);
  assert.match(mainSource, /stage: 'validation_completed'/);
  assert.match(mainSource, /ipcMain\.handle\('agent:logs:list-requests'/);
  assert.match(mainSource, /ipcMain\.handle\('agent:logs:replay'/);
  assert.match(mainSource, /stage: 'tool_call_started'/);
  assert.match(mainSource, /stage: 'tool_call_completed'/);
  assert.match(mainSource, /stage: 'tool_call_failed'/);
});

test('agent chat contract exposes optional routing payload', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const agentChat = (contract.functions || []).find((fn) => fn.name === 'agent_chat');
  assert.equal(Boolean(agentChat), true);
  const props = agentChat.output_schema?.properties || {};
  assert.equal(Boolean(props.routing), true);
  assert.equal(props.routing.type, 'object');
  assert.equal(Boolean(props.notebookDraft), true);
  assert.equal(props.notebookDraft.type, 'object');
  assert.equal(Boolean(props.response_type), true);
  assert.equal(Boolean(props.confidence_label), true);
  assert.equal(Boolean(props.source_summary), true);
  assert.equal(Boolean(props.unresolved_fields), true);
  assert.equal(Boolean(props.validation), true);
  assert.equal(Boolean(props.provenance), true);
});

test('agent log replay/list IPC functions are present in contract and preload bridge', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const listFn = (contract.functions || []).find((fn) => fn.name === 'agent_logs_list_requests');
  const replayFn = (contract.functions || []).find((fn) => fn.name === 'agent_logs_replay');
  assert.equal(Boolean(listFn), true);
  assert.equal(Boolean(replayFn), true);
  assert.equal(listFn.channel, 'agent:logs:list-requests');
  assert.equal(replayFn.channel, 'agent:logs:replay');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(preloadSource, /agentLogsListRequests:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('agent:logs:list-requests'\)/);
  assert.match(preloadSource, /agentLogsReplay:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:logs:replay', payload\)/);
});

test('toolbox_plannotate contract enforces plain-text sequence input for LLM tool calls', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'toolbox_plannotate');
  assert.equal(Boolean(tool), true);
  const schema = tool.input_schema || {};
  assert.equal(Array.isArray(schema.required), true);
  assert.equal(schema.required.includes('sequence_text'), true);
  const props = schema.properties || {};
  assert.equal(Boolean(props.sequence_text), true);
  assert.equal(props.sequence_text.type, 'string');
  assert.equal(Boolean(props.file_path), false);
  assert.equal(Boolean(props.file_text), false);
  assert.equal(Boolean(props.file_bytes_base64), false);
});

test('search_workflows contract exposes workflow retrieval schema', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'search_workflows');
  assert.equal(Boolean(tool), true);
  assert.equal(Array.isArray(tool.input_schema?.required), true);
  assert.equal(tool.input_schema.required.includes('query'), true);
  const itemSchema = tool.output_schema?.properties?.items?.items || {};
  const required = Array.isArray(itemSchema.required) ? itemSchema.required : [];
  assert.equal(required.includes('id'), true);
  assert.equal(required.includes('name'), true);
  assert.equal(required.includes('project_name'), true);
  assert.equal(required.includes('block_count'), true);
  assert.equal(required.includes('link_count'), true);
  assert.equal(required.includes('steps_preview'), true);
  assert.equal(required.includes('updated_at'), true);
});

test('search_inventory contract preserves required query and supports parser search metadata fields', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'search_inventory');
  assert.equal(Boolean(tool), true);
  assert.equal(Array.isArray(tool.input_schema?.required), true);
  assert.equal(tool.input_schema.required.includes('query'), true);
  const inputProps = tool.input_schema?.properties || {};
  assert.equal(Boolean(inputProps.normalized_query), true);
  assert.equal(Boolean(inputProps.candidate_terms), true);
  assert.equal(Boolean(inputProps.aliases), true);
  assert.equal(Boolean(inputProps.search_mode), true);
  assert.equal(Boolean(inputProps.search_terms), true);
});

test('search_papers contract preserves required fields and exposes Phase 7 optional metadata', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'search_papers');
  assert.equal(Boolean(tool), true);
  const itemSchema = tool.output_schema?.properties?.items?.items || {};
  const required = Array.isArray(itemSchema.required) ? itemSchema.required : [];
  assert.equal(required.includes('id'), true);
  assert.equal(required.includes('title'), true);
  assert.equal(required.includes('summary'), true);
  assert.equal(required.includes('methods'), true);
  const properties = itemSchema.properties || {};
  assert.equal(Boolean(properties.availability_status), true);
  assert.equal(Boolean(properties.deep_read_ready), true);
  assert.equal(Boolean(properties.ingestion_status), true);
  assert.equal(Boolean(properties.key_figures), true);
  assert.equal(Boolean(properties.linked_project_name), true);
  assert.equal(Boolean(properties.updated_at), true);
});

test('search_web contract exposes hybrid web fallback schema', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'search_web');
  assert.equal(Boolean(tool), true);
  assert.equal(Array.isArray(tool.input_schema?.required), true);
  assert.equal(tool.input_schema.required.includes('query'), true);
  const itemSchema = tool.output_schema?.properties?.items?.items || {};
  const required = Array.isArray(itemSchema.required) ? itemSchema.required : [];
  assert.equal(required.includes('title'), true);
  assert.equal(required.includes('url'), true);
  assert.equal(required.includes('snippet'), true);
  assert.equal(required.includes('source_domain'), true);
});

test('run_python_sandbox contract includes optional artifact fields without breaking required base fields', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'run_python_sandbox');
  assert.equal(Boolean(tool), true);
  const inputProps = tool.input_schema?.properties || {};
  assert.equal(Boolean(inputProps.code), true);
  assert.equal(Boolean(inputProps.artifact_paths), true);
  assert.equal(Boolean(inputProps.persist_artifacts), true);
  const itemSchema = tool.output_schema?.properties?.items?.items || {};
  const required = Array.isArray(itemSchema.required) ? itemSchema.required : [];
  assert.equal(required.includes('run_id'), true);
  assert.equal(required.includes('status'), true);
  const outputProps = itemSchema.properties || {};
  assert.equal(Boolean(outputProps.artifact_count), true);
  assert.equal(Boolean(outputProps.result_files), true);
  assert.equal(Boolean(outputProps.result_file_records), true);
});

test('main agent controller output includes routing metadata fields', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /routing:\s*normalizeRoutingForAgentLog\(source\.routing\)/);
  assert.match(mainSource, /normalizeNotebookDraftPayload\(source\.notebookDraft\)/);
  assert.match(mainSource, /const \{ finalizeAgentResponse \} = require\('\.\/helpers\/agent\/agent-response-layer'\)/);
  assert.match(mainSource, /applyResponseLayerToOutput\(/);
  assert.match(mainSource, /response_type:\s*normalized\.response_type/);
  assert.match(mainSource, /confidence_label:\s*normalized\.confidence_label/);
  assert.match(mainSource, /source_summary:\s*normalized\.source_summary/);
  assert.match(mainSource, /unresolved_fields:\s*normalized\.unresolved_fields/);
  assert.match(mainSource, /validation:\s*validationGate\.validation/);
  assert.match(mainSource, /provenance:\s*validationGate\.provenance/);
  assert.match(mainSource, /maybeBuildNotebookDraft\(/);
  assert.match(mainSource, /buildNotebookDraftSummary\(/);
  assert.match(mainSource, /routing,/);
  assert.match(mainSource, /intermediateStates,/);
  assert.match(mainSource, /toolTrace/);
  assert.match(mainSource, /buildRoutingDecisionFromIntentParser\(/);
  assert.match(mainSource, /requestIntentParserPayload\(/);
  assert.match(mainSource, /normalizeIntentParserPayload\(/);
  assert.match(mainSource, /executeToolCall\(/);
  assert.match(mainSource, /runAgentToolDispatchLegacy\(/);
  assert.match(mainSource, /tool_selection_rationale/);
  assert.match(mainSource, /selector score=/);
});

test('main agent controller hard-errors when intent parser output is invalid', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(!parserResult\?\.ok \|\| !parserResult\?\.payload\)/);
  assert.match(mainSource, /ok:\s*false/);
  assert.match(mainSource, /Intent parser failed:/);
});

test('main search_protocols tool path uses SQLite-backed protocol index ranking', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(name === 'search_protocols'\)[\s\S]*searchProtocolsIndex\(/);
  assert.match(mainSource, /Matched protocol index \(SQLite\) with deterministic JS ranking/);
});

test('sqlite index module exposes per-data-file bundle naming', () => {
  const bundle = agentSqliteIndex.getBundlePaths({
    dataFilePath: '/tmp/enana-data.ena.json'
  });
  assert.equal(bundle.sqlitePath, '/tmp/enana-data.index.sqlite');
  assert.equal(bundle.protocolsPath, '/tmp/enana-data.protocols.json');
  assert.equal(bundle.notebookPagesPath, '/tmp/enana-data.notebook-pages.json');
  assert.equal(bundle.legacyProtocolsPath, '/tmp/protocols.json');
  assert.equal(bundle.legacyNotebookPagesPath, '/tmp/notebook-pages.json');
});

test('sqlite index module syncs and retrieves inventory/protocol/notebook search rows', async () => {
  const tempDir = path.join(__dirname, 'tmp', 'sqlite-index-test');
  await fsPromises.rm(tempDir, { recursive: true, force: true });
  await fsPromises.mkdir(tempDir, { recursive: true });
  const dataFilePath = path.join(tempDir, 'bundle.ena.json');
  const snapshot = {
    protocols: [
      {
        id: 'pr1',
        name: 'Cell Prep',
        category: 'cell',
        steps: [
          'Seed cells in media',
          'Harvest [cell line] cells'
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'n1',
        protocolId: 'pr1',
        protocolName: 'Cell Prep',
        projectId: 'p1',
        projectName: 'Cancer Study',
        result: 'Observed 85% viability.',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    labInventory: {
      chemicals: [
        {
          id: 'c1',
          name: 'Tris-HCl',
          amount: '250 g',
          cas: '1185-53-1',
          supplier: 'Sigma',
          location: 'Shelf A'
        }
      ],
      blocks: [],
      lastLocationNumber: 0
    },
    inventory: {
      'Room Temp': [
        {
          id: 'p1',
          name: 'PEI',
          quantity: '2 bottles',
          location: 'Cabinet 4'
        }
      ]
    }
  };

  await agentSqliteIndex.syncBundleFromSnapshot({
    dataFilePath,
    snapshot,
    fallbackDataFilePath: dataFilePath
  });

  const protocolSearch = await agentSqliteIndex.searchProtocolsIndex({
    dataFilePath,
    query: 'cell prep',
    limit: 3,
    snapshot: {}
  });
  assert.equal(protocolSearch.usedSqlite, true);
  assert.equal(protocolSearch.items.length > 0, true);
  assert.equal(protocolSearch.items[0].name, 'Cell Prep');

  const notebookSearch = await agentSqliteIndex.searchNotebookEntriesIndex({
    dataFilePath,
    query: 'viability',
    limit: 3,
    snapshot: {}
  });
  assert.equal(notebookSearch.usedSqlite, true);
  assert.equal(notebookSearch.items.length > 0, true);
  assert.equal(notebookSearch.items[0].id, 'n1');

  const inventorySearch = await agentSqliteIndex.searchInventoryIndex({
    dataFilePath,
    query: 'tris',
    limit: 3,
    searchTerms: ['Tris-HCl'],
    snapshot: {}
  });
  assert.equal(inventorySearch.usedSqlite, true);
  assert.equal(inventorySearch.items.some((item) => item.name === 'Tris-HCl'), true);

  const hydrated = await agentSqliteIndex.hydrateSnapshotFromBundle({
    dataFilePath,
    snapshot: {},
    fallbackDataFilePath: dataFilePath,
    legacyChemicalsPath: ''
  });
  assert.equal(Array.isArray(hydrated.snapshot.protocols), true);
  assert.equal(hydrated.snapshot.protocols.length, 1);
  assert.equal(hydrated.snapshot.labInventory.chemicals.length, 1);

  await fsPromises.rm(tempDir, { recursive: true, force: true });
});

test('sequence library helper creates storage folder, sqlite db, and status-filtered entries', async () => {
  const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-'));
  try {
    const firstSaved = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'VectorA',
      status: 'saved',
      sourceFormat: 'fasta',
      topology: 'circular',
      sequenceLength: 1200,
      featureCount: 2,
      gbkText: 'LOCUS       VectorA           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n',
      htmlText: '<html><body>preview A</body></html>'
    });

    const secondSaved = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'VectorA',
      status: 'saved',
      sourceFormat: 'fasta',
      topology: 'circular',
      sequenceLength: 1300,
      featureCount: 3,
      gbkText: 'LOCUS       VectorB           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n',
      htmlText: '<html><body>preview B</body></html>'
    });

    const temporary = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'DraftVector',
      status: 'temporary',
      sourceFormat: 'genbank',
      topology: 'linear',
      sequenceLength: 900,
      featureCount: 1,
      gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 gggggggggg\n//\n',
      htmlText: '<html><body>preview draft</body></html>'
    });

    assert.equal(firstSaved.entry.name, 'VectorA');
    assert.equal(secondSaved.entry.name, 'VectorA_2');
    assert.equal(temporary.entry.status, 'temporary');

    const savedList = await sequenceLibrary.listSequenceEntries({
      storagePath: storageRoot,
      status: 'saved'
    });
    assert.equal(savedList.entries.length, 2);

    const tempList = await sequenceLibrary.listSequenceEntries({
      storagePath: storageRoot,
      status: 'temporary'
    });
    assert.equal(tempList.entries.length, 1);

    const sqlitePath = path.join(storageRoot, 'SequenceViewer', 'sequence-library.sqlite');
    const stat = await fsPromises.stat(sqlitePath);
    assert.equal(stat.isFile(), true);
  } finally {
    await fsPromises.rm(storageRoot, { recursive: true, force: true });
  }
});

test('sequence library helper returns stored GBK/HTML and promotes temporary entries to saved names', async () => {
  const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-promote-'));
  try {
    const saved = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'Reference',
      status: 'saved',
      sourceFormat: 'genbank',
      topology: 'circular',
      sequenceLength: 1000,
      featureCount: 0,
      gbkText: 'LOCUS       Reference         10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n',
      htmlText: '<html><body>reference</body></html>'
    });

    const temp = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'Reference',
      status: 'temporary',
      sourceFormat: 'genbank',
      topology: 'linear',
      sequenceLength: 800,
      featureCount: 0,
      gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n',
      htmlText: '<html><body>draft</body></html>'
    });

    const promoted = await sequenceLibrary.promoteSequenceEntry({
      storagePath: storageRoot,
      id: temp.entry.id,
      name: 'Reference'
    });
    assert.equal(promoted.entry.status, 'saved');
    assert.equal(promoted.entry.name, 'Reference_2');

    const fetched = await sequenceLibrary.getSequenceEntry({
      storagePath: storageRoot,
      id: saved.entry.id,
      includeGbk: true,
      includeHtml: true
    });
    assert.match(String(fetched.gbkText || ''), /LOCUS\s+Reference/);
    assert.match(String(fetched.htmlText || ''), /reference/);
  } finally {
    await fsPromises.rm(storageRoot, { recursive: true, force: true });
  }
});

test('main wires sqlite index module for save/load and retrieval paths', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-sqlite-index'\)/);
  assert.match(mainSource, /syncBundleFromSnapshot\(/);
  assert.match(mainSource, /hydrateSnapshotFromBundle\(/);
  assert.match(mainSource, /searchInventoryIndex\(/);
  assert.match(mainSource, /searchNotebookEntriesIndex\(/);
  assert.match(mainSource, /searchProtocolsIndex\(/);
});

test('main search_workflows tool path and project evidence hook use Phase 6 module', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(name === 'search_workflows'\)[\s\S]*retrieveProjectEvidence\(/);
  assert.match(mainSource, /maybeCollectProjectEvidence\(/);
  assert.match(mainSource, /buildProjectRecordIndex\(/);
  assert.match(mainSource, /project_evidence/);
});

test('main search_papers tool path and paper evidence hook use Phase 7 module', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(name === 'search_papers'\)[\s\S]*buildPaperSearchableDocs\(/);
  assert.match(mainSource, /if \(name === 'search_papers'\)[\s\S]*retrievePaperCandidates\(/);
  assert.match(mainSource, /maybeCollectPaperEvidence\(/);
  assert.match(mainSource, /paper_evidence/);
});

test('main Phase 8+9 wiring keeps orchestration in helper modules and adds search_web dispatch', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-phase89-runtime'\)/);
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-python'\)/);
  assert.match(mainSource, /buildPythonCodegenPrompt\(/);
  assert.match(mainSource, /runPlannedPythonTask\(/);
  assert.match(mainSource, /postProcessPythonToolResult\(/);
  assert.match(mainSource, /runHybridWebFallback\(/);
  assert.match(mainSource, /if \(name === 'search_web'\)/);
  assert.match(mainSource, /searchWebResults\(/);
  assert.match(mainSource, /'search_web'/);
});

test('telegram bot internals normalize search and module parsing', () => {
  const internals = telegramBot._internals || {};
  assert.equal(typeof internals.getCommandArgs, 'function');
  assert.equal(typeof internals.getSearchTarget, 'function');
  assert.equal(typeof internals.splitFirstToken, 'function');

  assert.equal(internals.getCommandArgs('/search assay kinase inhibitor'), 'assay kinase inhibitor');
  assert.equal(internals.normalizeTokenKey('Sample Registry'), 'sample-registry');
  assert.equal(internals.getSearchTarget('assays').type, 'search-assays');
  assert.equal(internals.getSearchTarget('chemicals').type, 'search-chemicals');
  assert.deepEqual(
    internals.splitFirstToken('assay kinase inhibitor'),
    { first: 'assay', rest: 'kinase inhibitor' }
  );
});

test('telegram bot internals suggest module names for typos', () => {
  const internals = telegramBot._internals || {};
  assert.equal(typeof internals.getModuleSuggestions, 'function');
  assert.equal(typeof internals.getModuleCatalog, 'function');
  assert.equal(typeof internals.levenshteinDistance, 'function');
  assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'protocols'));
  assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'projects'));
  assert.ok(internals.getModuleSuggestions('protcols').includes('protocols'));
  assert.equal(internals.levenshteinDistance('assay', 'asay'), 1);
});

test('package manifest includes scripts and dependencies required for portable installs', () => {
  assert.equal(packageManifest.scripts['build:ui'], 'node scripts/build-ui.mjs');
  assert.equal(packageManifest.scripts['check:dom-ids'], 'node scripts/check-dom-ids.mjs');
  assert.equal(packageManifest.scripts.start, 'npm run build:ui && electron-forge start');
  assert.equal(packageManifest.scripts.test, 'npm run build:ui && npm run check:dom-ids && node test.js');
  assert.equal(packageManifest.scripts.dist, 'npm run build:ui && electron-forge make');
  assert.equal(packageManifest.scripts['package:app'], 'npm run build:ui && electron-forge package');
  assert.equal(packageManifest.scripts.package, 'npm run build:ui && electron-forge package');
  assert.equal(packageManifest.scripts.make, 'npm run build:ui && electron-forge make');
  assert.equal(packageManifest.dependencies.telegraf, '^4.16.3');
  assert.equal(packageManifest.dependencies['electron-squirrel-startup'], '^1.0.1');
  assert.equal(packageManifest.devDependencies.electron, '^40.7.0');
  assert.equal(Boolean(packageManifest.devDependencies['@electron-forge/cli']), true);
});

test('DOM id references in source map to markup or approved dynamic IDs', () => {
  const sourceFiles = [
    path.join(__dirname, 'src', 'renderer', 'renderer.js'),
    ...fs.readdirSync(path.join(__dirname, 'src', 'renderer', 'modules'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(__dirname, 'src', 'renderer', 'modules', name))
  ];
  const htmlFiles = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'ketcher-embedded.html')
  ];

  const referencedIds = new Set();
  sourceFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = re.exec(source))) {
      referencedIds.add(match[1]);
    }
  });

  const markupIds = new Set();
  htmlFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const re = /id\s*=\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(source))) {
      markupIds.add(match[1]);
    }
  });

  const allowedDynamic = new Set([
    'exit-btn',
    'sample-loc-freezer',
    'sample-loc-rack',
    'sample-loc-box',
    'sample-loc-position',
    'sample-loc-fridge',
    'sample-loc-shelf',
    'sample-loc-desiccator',
    'sample-loc-desiccator-position',
    'sample-loc-cabinet',
    'sample-loc-cabinet-slot'
  ]);

  const missing = [...referencedIds].filter((id) => !markupIds.has(id));
  const unexpected = missing.filter((id) => !allowedDynamic.has(id));
  assert.deepEqual(unexpected, []);
});

  }
};
