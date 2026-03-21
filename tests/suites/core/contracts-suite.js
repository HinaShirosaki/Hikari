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
  assert.match(source, /const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';/);
  assert.match(source, /if \(nextView === VIEWS\.SEQUENCE_VIEWER \|\| nextView === SEQUENCE_VIEWER_DETAIL_VIEW_ID\) \{\s*sequenceViewer\?\.render\?\.\(\);\s*\}/);
  assert.match(source, /sequenceViewer = initSequenceViewer\(\{\s*onNavigateHome:\s*\(\)\s*=>\s*\{\s*showView\(VIEWS\.SEQUENCE_VIEWER\);/);
  assert.match(source, /onNavigateDetail:\s*\(\)\s*=>\s*\{\s*showView\(SEQUENCE_VIEWER_DETAIL_VIEW_ID\);/);
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

test('sequence viewer splits home and detail pages and removes home top caption/meta', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const homeStart = html.indexOf('<section id="sequence-viewer-view" class="view">');
  const detailStart = html.indexOf('<section id="sequence-viewer-detail-view" class="view">');
  assert.equal(homeStart >= 0, true);
  assert.equal(detailStart > homeStart, true);

  const homeBlock = html.slice(homeStart, detailStart);
  const detailBlock = html.slice(detailStart);

  assert.match(homeBlock, /id="sequence-viewer-home-workspace"/);
  assert.match(homeBlock, /id="sequence-viewer-home-paste-btn"/);
  assert.match(homeBlock, /id="sequence-viewer-home-open-btn"/);
  assert.equal(homeBlock.includes('id="sequence-viewer-home-import-btn"'), false);
  assert.match(homeBlock, /id="sequence-viewer-library-filter-saved"/);
  assert.match(homeBlock, /id="sequence-viewer-library-filter-temporary"/);
  assert.match(homeBlock, /id="sequence-viewer-library-list"/);
  assert.match(homeBlock, /id="sequence-viewer-preview-host"/);
  assert.equal(homeBlock.includes('<h2>Sequence Viewer</h2>'), false);
  assert.equal(homeBlock.includes('id="sequence-viewer-preview-meta"'), false);
  assert.equal(homeBlock.includes('id="sequence-viewer-detail-workspace"'), false);

  assert.match(detailBlock, /id="sequence-viewer-detail-workspace"/);
  assert.match(detailBlock, /id="sequence-viewer-back-btn"/);
  assert.match(detailBlock, /id="sequence-viewer-save-btn"/);
  assert.match(detailBlock, /id="sequence-viewer-orf-toggle"/);
});

test('sequence viewer map preview renderer omits metadata text overlays', () => {
  const source = readSource('src/renderer/modules/sequence-viewer.js');
  assert.equal(source.includes('sequence-viewer-preview-meta'), false);
  assert.equal(source.includes('toLocaleString()} bp</text>'), false);
  assert.equal(source.includes("normalizeTopology(record?.topology || 'linear'))}</text>"), false);
});

test('sequence viewer input panels force-hide when hidden attribute is set', () => {
  const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'sequence-viewer-view.css'), 'utf8');
  assert.match(css, /\.sequence-viewer-input-panel\[hidden\]\s*\{\s*display:\s*none !important;/);
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

test('main and preload expose storage root import IPC bridge', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(mainSource, /ipcMain\.handle\('storage:import-root'/);
  assert.match(mainSource, /importStorageRoot\(\{ storagePath \}\)/);
  assert.match(preloadSource, /importStorageRoot:\s*\(storagePath\)\s*=>\s*ipcRenderer\.invoke\('storage:import-root', \{ storagePath \}\)/);
});

test('data-helpers default bundle hydrator preserves parsed snapshot settings', async () => {
  const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data-helpers.js'));
  const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'data-helpers-default-hydrate-'));
  const dataFilePath = path.join(tempDir, 'state.json');
  try {
    const snapshot = {
      settings: {
        appearance: {
          uiStyle: 'classic',
          themeColor: '#123456'
        }
      }
    };
    await fsPromises.writeFile(dataFilePath, JSON.stringify(snapshot, null, 2), 'utf8');
    const helpers = createMainDataHelpers({
      fs: fsPromises,
      path,
      hasSupportedDataExtension: mainUtils.hasSupportedDataExtension,
      normalizeDataFilePath: mainUtils.normalizeDataFilePath,
      writeSnapshot: async () => {},
      getDefaultDataFilePath: () => dataFilePath
    });
    const result = await helpers.autoLoadDataFile(dataFilePath);
    assert.equal(result.ok, true);
    assert.equal(result.data?.settings?.appearance?.uiStyle, 'classic');
    assert.equal(result.data?.settings?.appearance?.themeColor, '#123456');
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('storage bundle helper sync + hydrate roundtrip restores protocols notebook and inventory from sidecars/sqlite', async () => {
  const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
  const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-bundle-roundtrip-'));
  const dataFilePath = path.join(tempDir, 'example.ena.json');
  try {
    const sourceSnapshot = {
      protocols: [
        {
          id: 'protocol-1',
          name: 'Protein Purification',
          purpose: 'Affinity purification flow.',
          steps: ['Bind sample', 'Wash', 'Elute'],
          materials: ['Buffer A']
        }
      ],
      notebookEntries: [
        {
          id: 'note-1',
          protocolId: 'protocol-1',
          protocolName: 'Protein Purification',
          projectId: 'proj-1',
          projectName: 'Atlas',
          result: 'Yield improved by 20%.',
          updatedAt: '2026-03-20T10:00:00.000Z'
        }
      ],
      labInventory: {
        chemicals: [
          {
            id: 'chem-1',
            name: 'Imidazole',
            casNumber: '288-32-4',
            amountInStock: '500 g',
            location: 'Shelf 4',
            vendor: 'TCI'
          }
        ],
        blocks: [
          {
            index: 1,
            timestamp: '2026-03-20T10:00:00.000Z',
            action: 'UPSERT_CHEMICAL',
            hash: 'hash-1'
          }
        ],
        lastLocationNumber: 7,
        locationCodeMap: { shelf4: 'D' },
        locationCodeNextByLocation: { shelf4: 8 }
      },
      inventory: {
        'Room Temp': [
          {
            id: 'box-1',
            name: 'Plasmid Box',
            type: 'box81'
          }
        ]
      },
      settings: {
        appearance: {
          uiStyle: 'classic',
          themeColor: '#336699'
        }
      }
    };
    await bundleHelpers.syncBundleFromSnapshot({
      dataFilePath,
      snapshot: sourceSnapshot
    });

    const compactSnapshot = {
      settings: {
        appearance: {
          uiStyle: 'classic',
          themeColor: '#336699'
        }
      },
      protocols: [],
      notebookEntries: [],
      labInventory: {
        chemicals: [],
        blocks: [],
        lastLocationNumber: 0,
        locationCodeMap: {},
        locationCodeNextByLocation: {}
      },
      inventory: {}
    };
    const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
      dataFilePath,
      snapshot: compactSnapshot
    });
    assert.equal(Array.isArray(hydrated.snapshot?.protocols), true);
    assert.equal(hydrated.snapshot.protocols.length, 1);
    assert.equal(Array.isArray(hydrated.snapshot?.notebookEntries), true);
    assert.equal(hydrated.snapshot.notebookEntries.length, 1);
    assert.equal(Array.isArray(hydrated.snapshot?.labInventory?.chemicals), true);
    assert.equal(hydrated.snapshot.labInventory.chemicals.length, 1);
    assert.equal(Array.isArray(hydrated.snapshot?.inventory?.['Room Temp']), true);
    assert.equal(hydrated.snapshot.inventory['Room Temp'].length, 1);
    assert.equal(hydrated.snapshot?.settings?.appearance?.uiStyle, 'classic');
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('storage root importer reads Testdata-like bundles and writes manifest with non-zero summary counts', async () => {
  const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
  const fixtureRoot = path.join(__dirname, 'Testdata');
  const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-import-fixture-'));
  try {
    await fsPromises.cp(fixtureRoot, tempDir, { recursive: true });
    const result = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
    assert.equal(result.summary.protocols > 0, true);
    assert.equal(result.summary.notebookEntries > 0, true);
    assert.equal(result.summary.chemicals > 0, true);
    assert.equal(result.summary.sequenceEntries > 0, true);
    assert.equal(result.summary.personalInventoryContainers > 0, true);
    assert.equal(Array.isArray(result.statePatch?.protocols), true);
    assert.equal(result.statePatch.protocols.length > 0, true);
    const manifestPath = path.join(tempDir, 'enana-storage-manifest.json');
    const manifestRaw = await fsPromises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    assert.equal(manifest.summary.sequenceEntries > 0, true);
    assert.equal(Array.isArray(manifest.discovered_files), true);
    assert.equal(manifest.discovered_files.length > 0, true);
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('renderer storage import wiring runs on save callback and startup hydration path', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'renderer.js'), 'utf8');
  assert.match(rendererSource, /onStoragePathSaved:\s*async\s*\(storagePath\)\s*=>\s*\{\s*const result = await runStorageRootImport\(storagePath, \{ persistMergedState: true \}\);/);
  assert.match(rendererSource, /async function hydrateStateFromStorageRoot\(\)/);
  assert.match(rendererSource, /await hydrateStateFromDataFile\(\);\s*await hydrateStateFromStorageRoot\(\);/);
  assert.match(rendererSource, /mergeStorageImportPatch\(result\.statePatch\);/);
  assert.equal(/state\.settings\s*=\s*result\.statePatch\.settings/.test(rendererSource), false);
});

test('telegram bot writes events to data/telegram-events.log by default', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
  assert.match(telegramBotSource, /data', 'telegram-events\.log'/);
  assert.equal(telegramBotSource.includes('telegram-messages.log'), false);
});

test('main agent chat logging records request/result/error with redacted API key metadata', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-controller-utils.js'), 'utf8');
  assert.match(mainSource, /const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log';/);
  assert.match(mainSource, /ENANA_AGENT_CHAT_LOG_PATH/);
  assert.match(mainSource, /void ensureAgentChatLogFile\(getAgentChatLogPath\(\)\);/);
  assert.match(controllerUtilsSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
  assert.equal(controllerUtilsSource.includes('apiKey: cleanText(source.apiKey'), false);
  assert.match(mainSource, /type: 'agent-chat-request'/);
  assert.match(mainSource, /type: 'agent-chat-result'/);
  assert.match(mainSource, /type: 'agent-chat-error'/);
});

test('main agent chat uses intent-only lifecycle stages and replay IPC handlers', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /createLifecycleRecorder/);
  assert.match(mainSource, /recordLifecycleEvent/);
  assert.match(mainSource, /appendLogWithRotation/);
  assert.match(mainSource, /stage: 'controller_intent_only_selected'/);
  assert.match(mainSource, /stage: 'controller_intent_only'/);
  assert.match(mainSource, /stage: 'parser_completed'/);
  assert.match(mainSource, /ipcMain\.handle\('agent:logs:list-requests'/);
  assert.match(mainSource, /ipcMain\.handle\('agent:logs:replay'/);
  assert.equal(/agent-validation-safety/.test(mainSource), false);
});

test('agent chat contract exposes parser-first output schema', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const agentChat = (contract.functions || []).find((fn) => fn.name === 'agent_chat');
  assert.equal(Boolean(agentChat), true);
  const inputProps = agentChat.input_schema?.properties || {};
  assert.equal(Boolean(inputProps.agent), true);
  assert.equal(inputProps.agent.type, 'object');
  assert.equal(Boolean(inputProps.agent.properties?.developerMode), true);
  assert.equal(Boolean(inputProps.agent.properties?.useRefactoredPipeline), false);
  const props = agentChat.output_schema?.properties || {};
  assert.equal(Boolean(props.parser), true);
  assert.equal(props.parser.type, 'object');
  assert.equal(Boolean(props.parser.properties?.primary_intent), true);
  assert.equal(Boolean(props.parser.properties?.needs_clarification), true);
  assert.equal(Boolean(props.parser.properties?.clarification_reason), true);
  assert.equal(Boolean(props.parser.properties?.entities), true);
  assert.equal(Boolean(props.parser.properties?.inventory_search), true);
  assert.equal(Boolean(props.parser.properties?.protocol_candidates), true);
  assert.equal(Boolean(props.parser.properties?.reasoning_summary), true);
  assert.equal(Boolean(props.protocol_to_notebook), true);
  assert.equal(props.protocol_to_notebook.type, 'object');
  assert.equal(Boolean(props.developer_trace), true);
  assert.equal(props.developer_trace.type, 'array');
  assert.equal(Boolean(props.routing), false);
  assert.equal(Boolean(props.validation), false);
  assert.equal(Boolean(props.provenance), false);
  assert.equal(Boolean(props.confidence), false);
  assert.equal(Boolean(props.controller_version), false);
});

test('agent log replay/list IPC functions are present in contract and preload bridge', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const listFn = (contract.functions || []).find((fn) => fn.name === 'agent_logs_list_requests');
  const replayFn = (contract.functions || []).find((fn) => fn.name === 'agent_logs_replay');
  assert.equal(Boolean(listFn), true);
  assert.equal(Boolean(replayFn), true);
  assert.equal(listFn.channel, 'agent:logs:list-requests');
  assert.equal(replayFn.channel, 'agent:logs:replay');
  assert.equal(Boolean(replayFn.output_schema?.properties?.traces), true);
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

test('main agent controller output returns parser payload and optional developer trace', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-controller-utils.js'), 'utf8');
  assert.match(mainSource, /const result = \{\s*ok: true,\s*parser: parserResult\.payload\s*\}/);
  assert.match(mainSource, /if \(parserResult\.payload\.primary_intent === 'protocol_to_notebook'\)/);
  assert.match(mainSource, /result\.protocol_to_notebook = protocolNotebookResult/);
  assert.match(mainSource, /protocolNotebookRuntime\.runFlow\(/);
  assert.match(mainSource, /protocolNotebookRuntime\.hasPendingSession\(/);
  assert.match(mainSource, /stage: 'protocol_to_notebook_followup'/);
  assert.match(mainSource, /createProtocolNotebookRuntime/);
  assert.match(mainSource, /if \(executionFlags\.developerMode === true\) \{\s*result\.developer_trace = asArray\(traceContext\?\.rows\);/);
  assert.match(mainSource, /requestIntentParserPayload\(/);
  assert.match(mainSource, /createAgentControllerUtils/);
  assert.match(controllerUtilsSource, /normalizeIntentParserPayload/);
  assert.match(mainSource, /runAgentControllerCore\(/);
  assert.equal(/controller_intent_only_selected/.test(mainSource), true);
  assert.equal(/controller_intent_only/.test(mainSource), true);
});

test('main agent logs persist redacted llm traces and replay wiring', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-controller-utils.js'), 'utf8');
  const observabilitySource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-observability.js'), 'utf8');
  assert.match(mainSource, /createAgentControllerUtils/);
  assert.match(controllerUtilsSource, /SENSITIVE_TRACE_KEYS/);
  assert.match(controllerUtilsSource, /redactTracePayload/);
  assert.match(controllerUtilsSource, /type: 'agent-llm-trace'/);
  assert.match(observabilitySource, /const traces = rows/);
  assert.match(observabilitySource, /trace_stages/);
  assert.match(observabilitySource, /trace_request_payload_count/);
  assert.match(observabilitySource, /trace_response_payload_count/);
});

test('protocol notebook prompts enforce exact placeholder mapping and follow-up completion guidance', () => {
  const protocolRuntimeSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-protocol-notebook.js'),
    'utf8'
  );
  assert.match(protocolRuntimeSource, /Extract exact value spans from the latest user text/);
  assert.match(protocolRuntimeSource, /latest user message is a direct answer/);
  assert.match(protocolRuntimeSource, /filled_values\.placeholder_key must exactly match one of the provided placeholder_key values/);
  assert.match(protocolRuntimeSource, /Ask follow_up_questions only when ambiguity remains/);
  assert.match(protocolRuntimeSource, /Example single-turn:/);
  assert.match(protocolRuntimeSource, /Example follow-up:/);
  assert.match(protocolRuntimeSource, /do not be over-cautious/);
});

test('main agent controller hard-errors when intent parser output is invalid', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /if \(!parserResult\?\.ok \|\| !parserResult\?\.payload\)/);
  assert.match(mainSource, /ok:\s*false/);
  assert.match(mainSource, /Intent parser failed:/);
});

test('agent helper cleanup keeps intent parser, protocol notebook runtime, observability, controller utils, and python helpers', () => {
  const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
  const expected = new Set([
    'Readme.md',
    'agent-intent-parser.js',
    'agent-controller-utils.js',
    'agent-protocol-notebook.js',
    'agent-observability.js',
    'agent-python.js'
  ]);
  const entries = fs.readdirSync(agentDir).filter((name) => name.endsWith('.js') || name === 'Readme.md');
  assert.deepEqual(new Set(entries), expected);

  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.equal(/agent-routing/.test(mainSource), false);
  assert.equal(/agent-response-layer/.test(mainSource), false);
  assert.equal(/agent-validation-safety/.test(mainSource), false);
  assert.equal(/agent-sqlite-index/.test(mainSource), false);
  assert.equal(/agent-phase89-runtime/.test(mainSource), false);
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

test('main wires intent parser + observability paths for parser-only controller', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-intent-parser'\)/);
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-observability'\)/);
  assert.match(mainSource, /require\('\.\/helpers\/agent\/agent-controller-utils'\)/);
  assert.match(mainSource, /requestIntentParserPayload\(/);
  assert.match(mainSource, /recordAgentLlmTrace\(/);
  assert.equal(/agent-sqlite-index/.test(mainSource), false);
  assert.equal(/agent-phase89-runtime/.test(mainSource), false);
});

test('main no longer wires legacy routing and phase orchestration helpers', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.equal(/require\('\.\/helpers\/agent\/agent-routing'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-paper-analysis'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-project-retrieval'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-response-layer'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-validation-safety'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-phase89-runtime'/.test(mainSource), false);
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
