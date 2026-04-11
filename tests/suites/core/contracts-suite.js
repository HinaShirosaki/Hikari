module.exports = function registerContractsSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
const agentPath = (...parts) => path.join(agentDir, ...parts);
const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-agent-ipc', ...parts);
test('view constants, index sections, and app registry stay in sync', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
  const viewValues = Object.values(shared.VIEWS);
  const sectionViews = new Set([...html.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
  const navViews = new Set((registry.apps || []).map((app) => app.viewId));

  const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
  const navRequiredViews = nonHomeViews.filter((value) => value !== shared.VIEWS.PERSONAL_INVENTORY);
  const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
  const missingNav = navRequiredViews.filter((value) => !navViews.has(value));
  const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

  assert.deepEqual(missingSections, []);
  assert.deepEqual(missingNav, []);
  assert.deepEqual(unknownNav, []);
  assert.match(html, /id="app-dock-nav"/);
  assert.match(html, /id="app-more-menu"/);
});

test('sample and inventory use a merged navigation entry', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
  const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
  assert.ok(sampleEntry);
  assert.equal(sampleEntry.viewId, 'sample-registry-view');
  assert.equal(sampleEntry.label, 'Sample & Inventory');
  assert.equal(sampleEntry.placement, 'dock');
  assert.equal(registry.apps.some((app) => app.viewId === 'personal-inventory-view'), false);
});

test('renderer routes personal inventory aliases to merged sample workspace', () => {
  const source = readSource('src/renderer/renderer.js');
  const moduleRuntimeSource = readSource('src/renderer/module-runtime.js');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
  const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
  assert.match(
    source,
    /function normalizeViewId\(viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/
  );
  assert.ok(sampleEntry);
  assert.ok(sampleEntry.aliases.includes('inventory'));
  assert.equal(sampleEntry.searchInputId, 'sample-search');
  assert.match(source, /const SEARCH_SCOPE_TARGETS = buildSearchScopeMap\(APP_REGISTRY\);/);
  assert.match(source, /const showSampleInventoryWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
  assert.match(
    source,
    /moduleRuntime\.renderView\(nextView\);/
  );
  assert.match(
    moduleRuntimeSource,
    /function renderSampleRegistryWorkspace\(modules\) \{\s*modules\.personalInventory\.renderSections\(\);\s*modules\.sampleRegistry\.render\(\);\s*\}/
  );
  assert.match(
    moduleRuntimeSource,
    /\[views\.SAMPLE_REGISTRY,\s*\(\)\s*=>\s*renderSampleRegistryWorkspace\(modules\)\]/
  );
});

test('renderer defines sequence viewer aliases and showView render hook', () => {
  const source = readSource('src/renderer/renderer.js');
  const moduleRuntimeSource = readSource('src/renderer/module-runtime.js');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
  const sequenceEntry = registry.apps.find((app) => app.id === 'sequence-viewer');
  assert.ok(sequenceEntry);
  assert.ok(sequenceEntry.aliases.includes('sequence'));
  assert.ok(sequenceEntry.aliases.includes('seqviewer'));
  assert.match(source, /const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';/);
  assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
  assert.match(
    moduleRuntimeSource,
    /if \(viewId === views\.SEQUENCE_VIEWER \|\| viewId === sequenceViewerDetailViewId\) \{\s*modules\.sequenceViewer\?\.\s*render\?\.\(\);\s*return;\s*\}/
  );
  assert.match(
    moduleRuntimeSource,
    /sequenceViewer:\s*initAndRegisterModule\(moduleRegistry,\s*'sequenceViewer',\s*initSequenceViewer,\s*\{\s*onNavigateHome:\s*\(\)\s*=>\s*\{\s*showView\(views\.SEQUENCE_VIEWER\);/
  );
  assert.match(
    moduleRuntimeSource,
    /onNavigateDetail:\s*\(\)\s*=>\s*\{\s*showView\(sequenceViewerDetailViewId\);/
  );
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
  assert.match(homeBlock, /id="sequence-viewer-protein-builder-workspace"/);
  assert.match(homeBlock, /id="sequence-viewer-home-paste-btn"/);
  assert.match(homeBlock, /id="sequence-viewer-home-open-btn"/);
  assert.match(homeBlock, /id="sequence-viewer-home-protein-builder-btn"/);
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
  assert.match(detailBlock, /id="sequence-viewer-detail-protein-builder-btn"/);
  assert.match(detailBlock, /id="sequence-viewer-save-btn"/);
  assert.match(detailBlock, /id="sequence-viewer-recognize-backbone-btn"/);
  assert.match(detailBlock, /id="sequence-viewer-orf-toggle"/);
  assert.match(detailBlock, /id="sequence-viewer-restriction-neb-toggle"/);
  assert.match(detailBlock, /id="sequence-viewer-restriction-thermo-toggle"/);
});

test('tool box no longer exposes the protein builder subview', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const source = readSource('src/renderer/modules/tool-box.js');
  assert.equal(html.includes('tool-protein-assembly-view'), false);
  assert.equal(html.includes('Protein Assembler'), false);
  assert.equal(source.includes('initProteinAssemblyTool'), false);
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

test('main sql.js helpers resolve the bundled vendor asset from package-safe paths', () => {
  const { resolveSqlJsWasmJsPath } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'sqljs-path.js'));
  const resolved = resolveSqlJsWasmJsPath(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle'));
  assert.equal(resolved.endsWith(path.join('vendor', 'sqljs', 'sql-wasm.js')), true);
  assert.equal(fs.existsSync(resolved), true);
});

test('telegram bridge keeps only supported renderer IPC channel', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.equal(telegramBotSource.includes('telegram-message'), false);
  assert.equal(preloadSource.includes('onTelegramCommand'), true);
});

test('main composes dedicated IPC registrars with generic tool runtime support', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-data-ipc.js'), 'utf8');
  const agentRegistrarSource = fs.readFileSync(agentRegistrarPath('index.js'), 'utf8');
  const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-system-ipc.js'), 'utf8');
  const toolLoadingSource = fs.readFileSync(agentPath('tools', 'agent-tool-loading.js'), 'utf8');
  const toolExecutionSource = fs.readFileSync(agentPath('tools', 'agent-tool-execution.js'), 'utf8');
  const toolProviderSource = fs.readFileSync(agentPath('tools', 'agent-tool-provide.js'), 'utf8');
  const runtimeSupportSource = fs.readFileSync(agentPath('runtime', 'agent-runtime-support.js'), 'utf8');
  const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');

  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainSource, /registerDataIpc/);
  assert.match(mainSource, /registerAgentIpc/);
  assert.match(mainSource, /registerSystemIpc/);
  assert.match(mainAgentServicesSource, /createAgentToolCallRuntime/);
  assert.match(mainAgentServicesSource, /createAgentToolProviderRuntime/);
  assert.match(mainAgentServicesSource, /agent-tool-loading\.js/);
  assert.match(mainAgentServicesSource, /agent-tool-execution\.js/);
  assert.match(mainAgentServicesSource, /createAgentRuntimeSupport/);
  assert.match(mainAgentServicesSource, /sharedLlmTransportDeps/);
  assert.match(mainAgentServicesSource, /sharedAgentLlmDeps/);
  assert.match(mainAgentServicesSource, /registerAgentToolExecutors/);
  assert.match(dataRegistrarSource, /function registerDataIpc\(deps = \{\}\)/);
  assert.match(agentRegistrarSource, /function registerAgentIpc\(deps = \{\}\)/);
  assert.match(systemRegistrarSource, /function registerSystemIpc\(deps = \{\}\)/);
  assert.match(toolLoadingSource, /function normalizeToolInvocationArgs\(rawArgs\)/);
  assert.match(toolExecutionSource, /function createAgentToolCallRuntime\(deps = \{\}\)/);
  assert.match(toolProviderSource, /function createAgentToolProviderRuntime\(deps = \{\}\)/);
  assert.match(runtimeSupportSource, /function createAgentRuntimeSupport\(deps = \{\}\)/);
  assert.match(llmBridgeSource, /function createAgentLlmProviderBridge\(deps = \{\}\)/);
});

test('agent shared text helpers and codex IPC no longer clip long prompts by default', () => {
  const llmUtilsSource = fs.readFileSync(agentPath('shared', 'agent-llm-utils.js'), 'utf8');
  const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
  const chatLogSource = fs.readFileSync(agentPath('context', 'agent-chat-log.js'), 'utf8');
  const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-system-ipc.js'), 'utf8');
  assert.doesNotMatch(llmUtilsSource, /text\.slice\(0,\s*maxLength\)/);
  assert.doesNotMatch(llmBridgeSource, /text\.slice\(0,\s*maxLength\)/);
  assert.doesNotMatch(chatLogSource, /text\.slice\(0,\s*maxLength\)/);
  assert.doesNotMatch(systemRegistrarSource, /promptRaw\.length > 120000/);
});

test('main and preload expose sequence library IPC bridge through the data registrar', () => {
  const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-data-ipc.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:list'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:get'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:upsert'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:promote'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:delete'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:search-features'/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('sequence-library:recognize-backbone'/);
  assert.match(preloadSource, /sequenceLibraryList:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:list', payload\)/);
  assert.match(preloadSource, /sequenceLibraryGet:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:get', payload\)/);
  assert.match(preloadSource, /sequenceLibraryUpsert:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:upsert', payload\)/);
  assert.match(preloadSource, /sequenceLibrarySearchFeatures:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:search-features', payload\)/);
  assert.match(preloadSource, /sequenceLibraryRecognizeBackbone:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('sequence-library:recognize-backbone', payload\)/);
});

test('main and preload expose storage root import IPC bridge through the data registrar', () => {
  const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-data-ipc.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(dataRegistrarSource, /ipcMain\.handle\('storage:import-root'/);
  assert.match(dataRegistrarSource, /importStorageRoot\(\{ storagePath \}\)/);
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

test('storage bundle helper sync + hydrate roundtrip restores protocols notebook inventory and samples from sidecars/sqlite', async () => {
  const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
  const { createAgentLookupRuntime } = require(agentPath('runtime', 'agent-lookup-runtime.js'));
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
      samples: [
        {
          id: 'sample-1',
          code: 'S-001',
          name: 'Atlas construct',
          type: 'plasmid',
          lot: 'L1',
          concentration: '1 mg/mL',
          notes: 'seed stock',
          location: {
            storageType: 'room',
            box: 'Plasmid Box',
            position: 'A1'
          },
          inventoryLink: {
            section: 'Room Temp',
            containerId: 'box-1',
            wellIndex: 0
          },
          chemicalLinks: ['chem-1'],
          updatedAt: '2026-03-20T11:00:00.000Z'
        }
      ],
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
    assert.equal(Array.isArray(hydrated.snapshot?.samples), true);
    assert.equal(hydrated.snapshot.samples.length, 1);
    assert.equal(hydrated.snapshot.samples[0].id, 'sample-1');
    assert.equal(hydrated.snapshot?.settings?.appearance?.uiStyle, 'classic');

    const lookupRuntime = createAgentLookupRuntime({
      getBundlePaths: bundleHelpers.getBundlePaths,
      hydrateSnapshotFromBundle: bundleHelpers.hydrateSnapshotFromBundle,
      syncBundleFromSnapshot: bundleHelpers.syncBundleFromSnapshot
    });
    const inventorySearch = await lookupRuntime.searchInventoryIndex({
      dataFilePath,
      snapshot: compactSnapshot,
      query: 'Atlas construct',
      searchTerms: ['atlas', 'construct'],
      limit: 6
    });
    assert.equal(inventorySearch.usedSqlite, true);
    assert.equal(inventorySearch.items.some((item) => item.kind === 'personal_sample'), true);

    const recordSearch = await lookupRuntime.searchRecordIndex({
      dataFilePath,
      snapshot: compactSnapshot,
      query: 'Protein Purification',
      searchTerms: ['protein', 'purification'],
      limit: 6
    });
    assert.equal(recordSearch.usedSqlite, true);
    assert.equal(recordSearch.items.length > 0, true);
    assert.equal(recordSearch.items.some((item) => item.record_type === 'protocol'), true);
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});

test('workflow root storage sync writes template/run folders and hydrates workflows notebook pages plus related papers', async () => {
  const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
  const workflowStorage = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'workflow-storage.js'));
  const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'workflow-root-storage-'));
  const dataFilePath = path.join(tempDir, 'workflow-example.ena.json');
  try {
    const snapshot = {
      projects: [
        {
          id: 'project-1',
          name: 'Atlas'
        }
      ],
      workflowTemplates: [
        {
          id: 'template-1',
          name: 'Protein Expression',
          description: 'Root workflow template',
          blocks: [
            { id: 'block-a', protocolId: 'protocol-1' }
          ],
          links: [],
          createdAt: '2026-04-10T10:00:00.000Z',
          updatedAt: '2026-04-10T10:00:00.000Z'
        }
      ],
      workflows: [
        {
          id: 'workflow-1',
          templateId: 'template-1',
          name: 'Histagged protein preparation',
          description: 'Run 1',
          projectId: 'project-1',
          notebookEntryIds: ['note-1'],
          blocks: [
            { id: 'block-a', protocolId: 'protocol-1' }
          ],
          links: [],
          entries: [
            {
              id: 'entry-1',
              name: 'Clone 12',
              stepStates: {
                'block-a': {
                  status: 'completed',
                  notebookEntryId: 'note-1',
                  resultFiles: ['gel.png'],
                  resultFileRecords: [
                    {
                      name: 'gel.png',
                      path: '/tmp/original/gel.png',
                      relativePath: 'Workflow/Protein_Expression__template-1/Histagged_protein_preparation__workflow-1/Results/Clone_12__entry-1/Transform__block-a/ResultFiles/gel.png',
                      size: 1234,
                      importedAt: '2026-04-10T10:05:00.000Z'
                    }
                  ],
                  completedAt: '2026-04-10T10:06:00.000Z',
                  updatedAt: '2026-04-10T10:06:00.000Z'
                }
              },
              createdAt: '2026-04-10T10:00:00.000Z',
              updatedAt: '2026-04-10T10:06:00.000Z'
            }
          ],
          createdAt: '2026-04-10T10:00:00.000Z',
          updatedAt: '2026-04-10T10:06:00.000Z'
        }
      ],
      notebookEntries: [
        {
          id: 'note-1',
          projectId: 'project-1',
          projectName: 'Atlas',
          protocolId: 'protocol-1',
          protocolName: 'Transformation',
          result: 'Expression confirmed.',
          resultFiles: ['gel.png'],
          resultFileRecords: [
            {
              name: 'gel.png',
              path: '/tmp/original/gel.png',
              relativePath: 'Workflow/Protein_Expression__template-1/Histagged_protein_preparation__workflow-1/Notebook/Clone_12__entry-1/Transformation__block-a/ResultFiles/gel.png',
              size: 1234,
              importedAt: '2026-04-10T10:05:00.000Z'
            }
          ],
          workflowContext: {
            workflowId: 'workflow-1',
            workflowName: 'Histagged protein preparation',
            workflowEntryId: 'entry-1',
            workflowEntryName: 'Clone 12',
            workflowBlockId: 'block-a',
            workflowBlockTitle: 'Transformation'
          },
          createdAt: '2026-04-10T10:00:00.000Z',
          updatedAt: '2026-04-10T10:06:00.000Z'
        }
      ],
      papers: [
        {
          id: 'paper-1',
          title: 'Relevant Expression Paper',
          linkedType: 'project',
          linkedId: 'project-1',
          linkedName: 'Atlas',
          storedFilePath: '/tmp/original/paper.pdf',
          storedRelativePath: 'Project/Atlas/Papers/paper.pdf',
          pdfDataUrl: 'data:application/pdf;base64,QQ==',
          createdAt: '2026-04-10T10:00:00.000Z',
          updatedAt: '2026-04-10T10:06:00.000Z'
        }
      ],
      paperExperimentLinks: [
        {
          paperId: 'paper-1',
          entryId: 'note-1',
          projectId: 'project-1',
          note: 'Supports workflow step'
        }
      ],
      settings: {
        storagePath: tempDir
      }
    };

    await bundleHelpers.syncBundleFromSnapshot({
      dataFilePath,
      snapshot
    });

    const folderLayout = workflowStorage.buildWorkflowFolderLayout({
      storagePath: tempDir,
      template: snapshot.workflowTemplates[0],
      workflow: snapshot.workflows[0]
    });
    const notebookFolder = path.join(
      folderLayout.notebookFolderPath,
      workflowStorage.buildEntryFolderName('Clone 12', 'entry-1'),
      workflowStorage.buildBlockFolderName('Transformation', 'block-a')
    );
    await fsPromises.access(path.join(folderLayout.templateFolderPath, 'template.json'));
    await fsPromises.access(path.join(folderLayout.workflowFolderPath, 'workflow.json'));
    await fsPromises.access(path.join(folderLayout.relatedPapersFolderPath, 'related-papers.json'));
    await fsPromises.access(path.join(notebookFolder, 'page.json'));
    await fsPromises.access(path.join(folderLayout.workflowRootPath, 'workflow-status.sqlite'));

    const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
      dataFilePath,
      snapshot: {
        settings: { storagePath: tempDir },
        workflowTemplates: [],
        workflows: [],
        notebookEntries: [],
        papers: [],
        paperExperimentLinks: []
      }
    });

    assert.equal(hydrated.snapshot.workflowTemplates.length, 1);
    assert.equal(hydrated.snapshot.workflows.length, 1);
    assert.equal(hydrated.snapshot.notebookEntries.length, 1);
    assert.equal(hydrated.snapshot.papers.length, 1);
    assert.equal(hydrated.snapshot.paperExperimentLinks.length, 1);
    assert.equal(hydrated.snapshot.workflows[0].entries[0].stepStates['block-a'].resultFileRecords[0].path, '');
    assert.equal(hydrated.snapshot.papers[0].pdfDataUrl, '');
    assert.equal(hydrated.snapshot.notebookEntries[0].storageFolder.includes(`${path.sep}Workflow${path.sep}`), true);

    const imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
    assert.equal(imported.summary.workflowTemplates, 1);
    assert.equal(imported.summary.workflows, 1);
    assert.equal(imported.summary.papers, 1);
    assert.equal(imported.statePatch.workflowTemplates.length, 1);
    assert.equal(imported.statePatch.workflows.length, 1);
    assert.equal(imported.statePatch.notebookEntries.length, 1);
    assert.equal(imported.statePatch.papers.length, 1);
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

test('chemical inventory sync uses sqlite-only bundle writes instead of a chemical json file', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-data-ipc.js'), 'utf8');
  const chemicalInventorySource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-common-inventory.js'), 'utf8');
  assert.match(preloadSource, /syncSqliteBundle:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('storage:sync-sqlite-bundle', payload\)/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\('storage:sync-sqlite-bundle'/);
  assert.match(chemicalInventorySource, /window\.enanaApi\?\.syncSqliteBundle/);
  assert.match(chemicalInventorySource, /const targetPath = `\$\{normalizedRoot\}\/enana-chemicals\.index\.sqlite`;/);
  assert.equal(chemicalInventorySource.includes('enana-chemicals.ena.json'), false);
});

test('chemical bundle hydration/import no longer depends on legacy chemical json fallback', () => {
  const hydrationSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'storage-hydration.js'), 'utf8');
  const importSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'storage-import.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.equal(hydrationSource.includes('legacyChemicalsPath'), false);
  assert.equal(hydrationSource.includes('hydrateFromLegacyChemicals'), false);
  assert.equal(mainSource.includes('CHEMICALS_DATA_FILE_PATH'), false);
  assert.match(importSource, /isSqliteBundleCandidateName/);
  assert.match(importSource, /getBundlePathsFromSqlitePath/);
  assert.match(importSource, /kind:\s*'sqlite_only_bundle'/);
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
  const appPathsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'app-paths.js'), 'utf8');
  const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
  assert.match(mainSource, /const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log';/);
  assert.match(mainSource, /void ensureAgentChatLogFile\(getAgentChatLogPath\(\)\);/);
  assert.match(mainSource, /createMainAppPaths/);
  assert.match(appPathsSource, /ENANA_AGENT_CHAT_LOG_PATH/);
  assert.match(controllerUtilsSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
  assert.equal(controllerUtilsSource.includes('apiKey: cleanText(source.apiKey'), false);
  assert.match(agentChatHandlerSource, /type: 'agent-chat-request'/);
  assert.match(agentChatHandlerSource, /type: 'agent-chat-result'/);
  assert.match(agentChatHandlerSource, /type: 'agent-chat-error'/);
});

test('agent registrar keeps intent-only lifecycle stages and replay IPC handlers', () => {
  const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
  const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
  const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
  const combinedSource = `${agentChatHandlerSource}\n${controllerCoreSource}\n${logHandlersSource}`;
  assert.match(agentChatHandlerSource, /createLifecycleRecorder/);
  assert.match(agentChatHandlerSource, /recordLifecycleEvent/);
  assert.match(agentChatHandlerSource, /appendAgentChatLogEntry/);
  assert.match(controllerCoreSource, /stage: 'controller_intent_only_selected'/);
  assert.match(controllerCoreSource, /stage: 'controller_intent_only'/);
  assert.match(controllerCoreSource, /stage: 'parser_completed'/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:logs:list-requests'/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:logs:replay'/);
  assert.equal(/agent-validation-safety/.test(combinedSource), false);
});

test('agent no longer depends on a serialized io contract file', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  const promptsSource = fs.readFileSync(path.join(__dirname, 'data', 'llm-prompts.json'), 'utf8');
  assert.equal(mainSource.includes('agent-io-contract.json'), false);
  assert.equal(mainSource.includes("agent:get-io-contract"), false);
  assert.equal(preloadSource.includes('getAgentIoContract'), false);
  assert.equal(promptsSource.includes('agent-io-contract.json'), false);
});

test('agent runtime support keeps snapshot normalization and synthesis helpers outside main', () => {
  const runtimeSupportSource = fs.readFileSync(agentPath('runtime', 'agent-runtime-support.js'), 'utf8');
  assert.match(runtimeSupportSource, /function normalizeAgentSnapshot\(rawSnapshot\)/);
  assert.match(runtimeSupportSource, /function buildAgentSystemPrompt\(projectName, prompts\)/);
  assert.match(runtimeSupportSource, /function buildAgentSynthesisPrompt\(_requiresApproval, prompts\)/);
  assert.match(runtimeSupportSource, /function normalizeAgentOutput\(raw, fallbackText\)/);
});

test('generic agent tool catalog keeps key retrieval and execution tools', () => {
  const toolsCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tools.json'),
    'utf8'
  ));
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'inventory-lookup'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'record-lookup'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'python-sandbox'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
});

test('agent log replay and developer tool smoke-test IPC bridges remain wired without contract file', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
  const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /createAgentToolSmokeTestRuntime/);
  assert.match(mainSource, /registerAgentIpc/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:developer:test-tools'/);
  assert.match(logHandlersSource, /agentToolSmokeTestRuntime\.runTool/);
  assert.match(logHandlersSource, /normalizedPayload\?\.toolName/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:logs:list-requests'/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:logs:replay'/);
  assert.match(agentChatHandlerSource, /agent-progress/);
  assert.match(agentChatHandlerSource, /clientRequestId/);
  assert.match(agentChatHandlerSource, /request_id:/);
  assert.match(preloadSource, /agentDeveloperTestTools:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:developer:test-tools', payload\)/);
  assert.match(preloadSource, /agentLogsListRequests:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('agent:logs:list-requests'\)/);
  assert.match(preloadSource, /agentLogsReplay:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:logs:replay', payload\)/);
  assert.match(preloadSource, /onAgentProgress:\s*\(handler\)\s*=>\s*\{/);
  assert.match(preloadSource, /ipcRenderer\.on\('agent-progress', listener\)/);
});

test('agent chat session log IPC bridges are wired through agent registrar and preload', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const logHandlersSource = fs.readFileSync(agentRegistrarPath('agent-log-handlers.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /createAgentChatLogRuntime/);
  assert.match(mainSource, /registerAgentIpc/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:chat-log:create-session'/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:chat-log:list-sessions'/);
  assert.match(logHandlersSource, /ipcMain\.handle\('agent:chat-log:get-session'/);
  assert.match(preloadSource, /agentChatLogCreateSession:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:chat-log:create-session', payload\)/);
  assert.match(preloadSource, /agentChatLogListSessions:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:chat-log:list-sessions', payload\)/);
  assert.match(preloadSource, /agentChatLogGetSession:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('agent:chat-log:get-session', payload\)/);
});

test('agent registrar controller output returns parser payload and optional developer trace', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
  const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
  assert.match(controllerCoreSource, /const result = \{\s*ok: true,\s*parser: parserResult\.payload\s*\}/);
  assert.match(dispatcherSource, /if \(parserPayload\.primary_intent === 'protocol_to_notebook'\)/);
  assert.match(dispatcherSource, /result\.protocol_to_notebook = protocolNotebookResult/);
  assert.match(dispatcherSource, /if \(parserPayload\.primary_intent === 'notebook_draft'\)/);
  assert.match(dispatcherSource, /result\.notebook_draft =/);
  assert.match(dispatcherSource, /runTrackedTool\('notebook-draft'/);
  assert.match(dispatcherSource, /if \(parserPayload\.primary_intent === 'inventory_lookup'\)/);
  assert.match(dispatcherSource, /result\.inventory_lookup = inventoryLookupResult/);
  assert.match(dispatcherSource, /if \(parserPayload\.primary_intent === 'record_lookup'\)/);
  assert.match(dispatcherSource, /result\.record_lookup = recordLookupResult/);
  assert.match(dispatcherSource, /protocolNotebookRuntime\.runFlow\(/);
  assert.match(dispatcherSource, /protocolNotebookRuntime\.hasPendingSession\(/);
  assert.match(dispatcherSource, /stage: 'protocol_to_notebook_followup'/);
  assert.match(dispatcherSource, /stage: 'inventory_lookup_completed'/);
  assert.match(dispatcherSource, /stage: 'record_lookup_completed'/);
  assert.match(mainAgentServicesSource, /createAgentLookupRuntime/);
  assert.match(mainAgentServicesSource, /buildInventorySearchTerms/);
  assert.match(mainAgentServicesSource, /createProtocolNotebookRuntime/);
  assert.match(mainAgentServicesSource, /createNotebookDraftRuntime/);
  assert.match(controllerCoreSource, /if \(executionFlags\.developerMode === true\) \{\s*result\.developer_trace = asArray\(traceContext\?\.rows\);/);
  assert.match(controllerCoreSource, /requestIntentParserPayload\(/);
  assert.match(mainAgentServicesSource, /createAgentControllerUtils/);
  assert.match(controllerUtilsSource, /normalizeIntentParserPayload/);
  assert.match(controllerCoreSource, /runAgentControllerCore\(/);
  assert.equal(/controller_intent_only_selected/.test(controllerCoreSource), true);
  assert.equal(/controller_intent_only/.test(controllerCoreSource), true);
});

test('main agent logs persist redacted llm traces and replay wiring', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
  const observabilitySource = fs.readFileSync(agentPath('shared', 'agent-observability.js'), 'utf8');
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /createAgentControllerUtils/);
  assert.match(controllerUtilsSource, /SENSITIVE_TRACE_KEYS/);
  assert.match(controllerUtilsSource, /redactTracePayload/);
  assert.match(controllerUtilsSource, /type: 'agent-llm-trace'/);
  assert.match(observabilitySource, /const traces = rows/);
  assert.match(observabilitySource, /trace_stages/);
  assert.match(observabilitySource, /trace_request_payload_count/);
  assert.match(observabilitySource, /trace_response_payload_count/);
});

test('protocol runtimes preserve placeholder-fill and tie-break prompt guidance after extraction', () => {
  const protocolNotebookSource = fs.readFileSync(
    agentPath('runtime', 'agent-protocol-notebook.js'),
    'utf8'
  );
  const protocolNotebookContextSource = fs.readFileSync(
    agentPath('runtime', 'agent-protocol-notebook-context-control.js'),
    'utf8'
  );
  const protocolMatchingSource = fs.readFileSync(
    agentPath('tools', 'agent-protocol-matching.js'),
    'utf8'
  );
  const notebookGenerationSource = fs.readFileSync(
    agentPath('tools', 'agent-notebook-generation.js'),
    'utf8'
  );
  assert.match(protocolNotebookSource, /createProtocolNotebookContextControl/);
  assert.match(protocolNotebookSource, /protocolNotebookContextControl\.syncActionContext\(/);
  assert.match(protocolNotebookSource, /createProtocolMatchingRuntime/);
  assert.match(protocolNotebookSource, /createNotebookGenerationRuntime/);
  assert.match(protocolNotebookContextSource, /function createProtocolNotebookContextControl\(deps = \{\}\)/);
  assert.match(protocolNotebookContextSource, /function syncActionContext\(sessionKey, input = \{\}\)/);
  assert.match(protocolNotebookContextSource, /function closeContext\(sessionKey\)/);
  assert.match(notebookGenerationSource, /Extract exact value spans from the latest user text/);
  assert.match(notebookGenerationSource, /latest user message is a direct answer/);
  assert.match(notebookGenerationSource, /filled_values\.placeholder_key must exactly match one of the provided placeholder_key values/);
  assert.match(notebookGenerationSource, /Ask follow_up_questions only when ambiguity remains/);
  assert.match(notebookGenerationSource, /Example single-turn:/);
  assert.match(notebookGenerationSource, /Example follow-up:/);
  assert.match(protocolMatchingSource, /do not be over-cautious/);
  assert.match(protocolNotebookSource, /resolveAgentRuntimeFactory/);
});

test('agent registrar hard-errors when intent parser output is invalid', () => {
  const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
  assert.match(controllerCoreSource, /if \(!parserResult\?\.ok \|\| !parserResult\?\.payload\)/);
  assert.match(controllerCoreSource, /ok:\s*false/);
  assert.match(controllerCoreSource, /Intent parser failed:/);
});

test('science controller path is wired through the agent registrar and shared reasoning loop', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /createScienceReasoningLoopRuntime/);
  assert.match(mainAgentServicesSource, /continueAgentSessionWithUserMessage/);
  assert.match(dispatcherSource, /buildScienceRoutingFromParser/);
  assert.match(dispatcherSource, /result\.general_science_question\s*=\s*await scienceReasoningLoopRuntime\.runGeneralScienceQuestion/);
  assert.match(dispatcherSource, /result\.project_science_question\s*=\s*await scienceReasoningLoopRuntime\.runProjectScienceQuestion/);
  assert.match(dispatcherSource, /result\.result_analysis\s*=\s*await scienceReasoningLoopRuntime\.runResultAnalysis/);
  assert.match(dispatcherSource, /stage:\s*'science_intent_start'/);
  assert.match(dispatcherSource, /stage:\s*'science_intent_completed'/);
});

test('purchase recommendation runtime and external-link bridge are wired across main and renderer contracts', () => {
  const purchaseSource = fs.readFileSync(
    agentPath('tools', 'agent-purchase-recommendation.js'),
    'utf8'
  );
  const executorsSource = fs.readFileSync(
    agentPath('tools', 'register-agent-tool-executors.js'),
    'utf8'
  );
  const dispatcherSource = fs.readFileSync(agentRegistrarPath('agent-intent-dispatcher.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'preload.js'), 'utf8');
  const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-system-ipc.js'), 'utf8');

  assert.match(purchaseSource, /function createPurchaseRecommendationRuntime\(deps = \{\}\)/);
  assert.match(purchaseSource, /createAgentLlmRuntimeHelpers/);
  assert.match(purchaseSource, /function extractProductFromHtml\(html = '', pageUrl = ''\)/);
  assert.match(purchaseSource, /async function execute\(input = \{\}\)/);
  assert.match(mainAgentServicesSource, /createPurchaseRecommendationRuntime/);
  assert.match(mainAgentServicesSource, /const purchaseRecommendationRuntime = createPurchaseRecommendationRuntime/);
  assert.match(mainAgentServicesSource, /purchaseRecommendationRuntime,/);
  assert.match(executorsSource, /registerToolExecutor\('purchase-recommendation'/);
  assert.match(dispatcherSource, /parserPayload\.primary_intent === 'purchase_recommendation'/);
  assert.match(dispatcherSource, /runTrackedTool\('purchase-recommendation', \{\s*query:/);
  assert.match(dispatcherSource, /required_terms:\s*parseCompactList\(parserPayload\?\.entities\?\.required_attributes/);
  assert.match(dispatcherSource, /stage:\s*'purchase_recommendation_started'/);
  assert.match(dispatcherSource, /stage:\s*'purchase_recommendation_completed'/);
  assert.match(preloadSource, /openExternalUrl:\s*\(url\)\s*=>\s*ipcRenderer\.invoke\('system:open-external-url', \{ url \}\)/);
  assert.match(systemRegistrarSource, /ipcMain\.handle\('system:open-external-url'/);
  assert.match(systemRegistrarSource, /shell\.openExternal\(url\)/);
  assert.match(mainSource, /registerSystemIpc\(\{[\s\S]*shell,/);
});

test('agent tool loading and execution helpers expose catalogs and generic executor registry', () => {
  const loadingSource = fs.readFileSync(
    agentPath('tools', 'agent-tool-loading.js'),
    'utf8'
  );
  const executionSource = fs.readFileSync(
    agentPath('tools', 'agent-tool-execution.js'),
    'utf8'
  );
  const wrapperSource = fs.readFileSync(
    agentPath('tools', 'agent-tool-call.js'),
    'utf8'
  );
  const toolsCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tools.json'),
    'utf8'
  ));
  const toolCallCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tool-call.json'),
    'utf8'
  ));
  assert.equal(Array.isArray(toolsCatalog), true);
  assert.equal(Boolean(toolCallCatalog.$defs), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'python-sandbox'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'sub-agent'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'memory'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-analysis'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
  assert.equal(Boolean(toolCallCatalog['python-sandbox']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['sub-agent']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog.memory?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['literature-search']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['purchase-recommendation']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['paper-download']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['paper-analysis']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['notebook-draft']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['protocol-generation']?.input_schema), true);
  assert.equal(typeof toolCallCatalog['inventory-lookup']?.description, 'string');
  assert.equal(typeof toolCallCatalog.memory?.description, 'string');
  assert.equal(typeof toolCallCatalog['literature-search']?.description, 'string');
  assert.equal(typeof toolCallCatalog['purchase-recommendation']?.description, 'string');
  assert.equal(typeof toolCallCatalog['paper-download']?.description, 'string');
  assert.equal(typeof toolCallCatalog['notebook-draft']?.description, 'string');
  assert.equal(typeof toolCallCatalog['protocol-generation']?.description, 'string');
  assert.match(executionSource, /const toolExecutors = new Map\(\);/);
  assert.match(executionSource, /function registerToolExecutor\(toolName, executor\)/);
  assert.match(executionSource, /function getToolExecutor\(toolName\)/);
  assert.match(loadingSource, /Short description:/);
  assert.doesNotMatch(loadingSource, /Usage: \$/m);
  assert.match(executionSource, /Object\.entries\(ensureObject\(deps\.toolExecutors\)\)/);
  assert.match(wrapperSource, /agent-tool-loading\.js/);
  assert.match(wrapperSource, /agent-tool-execution\.js/);
  assert.equal(executionSource.includes('createDefaultAgentToolBindingBundle'), false);
  assert.equal(/["']inventory-lookup["']/.test(executionSource), false);
  assert.equal(/["']record-lookup["']/.test(executionSource), false);
  assert.equal(/["']protocol-matching["']/.test(executionSource), false);
  assert.equal(/["']notebook-generation["']/.test(executionSource), false);
  assert.equal(/["']python-sandbox["']/.test(executionSource), false);
  assert.equal(/["']sub-agent["']/.test(executionSource), false);
  assert.equal(/["']memory["']/.test(executionSource), false);
  assert.equal(/["']literature-search["']/.test(executionSource), false);
  assert.equal(/["']purchase-recommendation["']/.test(executionSource), false);
  assert.equal(/["']paper-download["']/.test(executionSource), false);
  assert.equal(/["']paper-analysis["']/.test(executionSource), false);
  assert.equal(/["']protocol-generation["']/.test(executionSource), false);
});

test('agent helper cleanup keeps the categorized folder structure and core modules', () => {
  const expectedFiles = [
    ['Readme.md'],
    ['intent', 'agent-intent-parser.js'],
    ['intent', 'agent-intent.json'],
    ['shared', 'agent-llm-provider-bridge.js'],
    ['shared', 'agent-llm-utils.js'],
    ['shared', 'agent-controller-utils.js'],
    ['shared', 'agent-observability.js'],
    ['runtime', 'agent-lookup-runtime.js'],
    ['runtime', 'agent-protocol-notebook.js'],
    ['runtime', 'agent-protocol-notebook-context-control.js'],
    ['runtime', 'science-reasoning-loop', 'index.js'],
    ['runtime', 'science-reasoning-loop', 'current-scientific-state.js'],
    ['runtime', 'science-reasoning-loop', 'input-clarification.js'],
    ['runtime', 'science-reasoning-loop', 'final-synthesis.js'],
    ['runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'],
    ['runtime', 'science-reasoning-loop', 'loop-exit-judge.js'],
    ['runtime', 'science-reasoning-loop', 'support.js'],
    ['deep-research', 'index.js'],
    ['deep-research', 'step-1-clarify-question.js'],
    ['deep-research', 'step-2-ask-targeted-follow-up.js'],
    ['deep-research', 'step-3-draft-research-plan.js'],
    ['deep-research', 'step-4-execute-plan.js'],
    ['deep-research', 'step-5-assemble-final-answer.js'],
    ['deep-research', 'context-control.js'],
    ['deep-research', 'accuracy-preservation.js'],
    ['deep-research', 'sub-agent-usage.js'],
    ['deep-research', 'final-synthesis-quality.js'],
    ['tools', 'Tools.json'],
    ['tools', 'Tool-call.json'],
    ['tools', 'agent-tool-provide.js'],
    ['tools', 'agent-tool-loading.js'],
    ['tools', 'agent-tool-execution.js'],
    ['tools', 'agent-tool-call.js'],
    ['tools', 'agent-notebook-generation.js'],
    ['tools', 'agent-notebook-draft.js'],
    ['tools', 'agent-protocol-matching.js'],
    ['tools', 'agent-protocol-generation.js'],
    ['tools', 'agent-literature-search.js'],
    ['tools', 'agent-purchase-recommendation.js'],
    ['tools', 'agent-paper-context-loader.js'],
    ['tools', 'agent-paper-download.js'],
    ['tools', 'agent-paper-analysis.js'],
    ['tools', 'agent-python-sandbox.js'],
    ['tools', 'agent-sub-agent.js'],
    ['context', 'agent-context-management.js'],
    ['context', 'agent-memory.js'],
    ['context', 'agent-chat-log.js']
  ];
  expectedFiles.forEach((parts) => {
    assert.equal(fs.existsSync(agentPath(...parts)), true, `Expected ${parts.join('/')} in agent helpers.`);
  });
  assert.equal(fs.existsSync(agentPath('agent-python.js')), false);

  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.equal(/agent-routing/.test(mainSource), false);
  assert.equal(/agent-response-layer/.test(mainSource), false);
  assert.equal(/agent-validation-safety/.test(mainSource), false);
  assert.equal(/agent-sqlite-index/.test(mainSource), false);
  assert.equal(/agent-phase89-runtime/.test(mainSource), false);
});

test('science reasoning helper exports shared loop runtime and renderer consumes science payloads', () => {
  const helperSource = fs.readFileSync(
    agentPath('runtime', 'science-reasoning-loop', 'index.js'),
    'utf8'
  );
  const rendererSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'),
    'utf8'
  );
  const responseSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat-response.js'),
    'utf8'
  );
  assert.match(helperSource, /const SCIENCE_REASONING_INTENTS = Object\.freeze/);
  assert.match(helperSource, /const SCIENCE_REASONING_POLICIES = Object\.freeze/);
  assert.match(helperSource, /const SCIENCE_RESULT_EVALUATION_SCHEMA =/);
  assert.match(helperSource, /function createScienceReasoningLoopRuntime\(deps = \{\}\)/);
  assert.match(helperSource, /async function runIntentLoop\(input = \{\}\)/);
  assert.match(helperSource, /async function runGeneralScienceQuestion\(input = \{\}\)/);
  assert.match(helperSource, /async function runProjectScienceQuestion\(input = \{\}\)/);
  assert.match(helperSource, /async function runResultAnalysis\(input = \{\}\)/);
  assert.match(responseSource, /export function summarizeScienceResult/);
  assert.match(responseSource, /export function normalizeAgentResponse/);
  assert.match(responseSource, /const scienceAnswerText = summarizeScienceResult\(generalScienceQuestion\)/);
  assert.match(rendererSource, /normalizeAgentResponse/);
  assert.match(rendererSource, /general_science_question/);
  assert.match(rendererSource, /project_science_question/);
  assert.match(rendererSource, /result_analysis/);
});

test('deep research helper exports stepwise runtime and the app wires the toggle and routing', () => {
  const helperSource = fs.readFileSync(
    agentPath('deep-research', 'index.js'),
    'utf8'
  );
  const step4Source = fs.readFileSync(
    agentPath('deep-research', 'step-4-execute-plan.js'),
    'utf8'
  );
  const step5Source = fs.readFileSync(
    agentPath('deep-research', 'step-5-assemble-final-answer.js'),
    'utf8'
  );
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const agentRegistrarSource = fs.readFileSync(agentRegistrarPath('index.js'), 'utf8');
  const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), 'utf8');
  const sharedSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'shared.js'), 'utf8');
  const agentViewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'agent-view.html'), 'utf8');

  assert.match(helperSource, /const DEEP_RESEARCH_INTENTS = Object\.freeze/);
  assert.match(helperSource, /function createDeepResearchRuntime\(deps = \{\}\)/);
  assert.match(helperSource, /runStep1ClarifyQuestion/);
  assert.match(helperSource, /runStep5AssembleFinalAnswer/);
  assert.match(step4Source, /async function runStep4ExecutePlan\(input = \{\}, deps = \{\}\)/);
  assert.match(step5Source, /async function runStep5AssembleFinalAnswer\(input = \{\}, deps = \{\}\)/);
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /createDeepResearchRuntime/);
  assert.match(mainAgentServicesSource, /const deepResearchRuntime = createDeepResearchRuntime/);
  assert.match(agentRegistrarSource, /deepResearchRuntime: deps\.deepResearchRuntime/);
  assert.match(controllerCoreSource, /payload\?\.agent\?\.deepResearchEnabled === true/);
  assert.match(rendererSource, /agent-deep-research-toggle-btn/);
  assert.match(rendererSource, /deepResearchEnabled: state\.agentChat\.deepResearchEnabled === true/);
  assert.match(sharedSource, /deepResearchEnabled: false/);
  assert.match(sharedSource, /deepResearchEnabled: source\.agentChat\?\.deepResearchEnabled === true/);
  assert.match(agentViewSource, /id="agent-deep-research-toggle-btn"/);
});

test('sub-agent helper exports reusable runtime and action contract', () => {
  const source = fs.readFileSync(
    agentPath('tools', 'agent-sub-agent.js'),
    'utf8'
  );
  const toolCallCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tool-call.json'),
    'utf8'
  ));
  assert.match(source, /const SUB_AGENT_ACTIONS = Object\.freeze/);
  assert.match(source, /function createAgentSubAgentRuntime\(deps = \{\}\)/);
  assert.match(source, /async function createSubAgent\(input = \{\}\)/);
  assert.match(source, /async function sendSubAgentMessage\(input = \{\}\)/);
  assert.match(source, /function deleteSubAgent\(input = \{\}\)/);
  assert.deepEqual(toolCallCatalog['sub-agent']?.input_schema?.properties?.action?.enum, ['create', 'message', 'delete', 'get', 'list']);
});

test('context management and memory helpers export reusable runtimes with layered and action-based contracts', () => {
  const contextSource = fs.readFileSync(
    agentPath('context', 'agent-context-management.js'),
    'utf8'
  );
  const registrySource = fs.readFileSync(
    agentPath('context', 'agent-context-registry.js'),
    'utf8'
  );
  const memorySource = fs.readFileSync(
    agentPath('context', 'agent-memory.js'),
    'utf8'
  );
  const toolsCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tools.json'),
    'utf8'
  ));
  const toolCallCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tool-call.json'),
    'utf8'
  ));

  assert.match(contextSource, /const CONTEXT_LAYER_IDS = Object\.freeze/);
  assert.match(contextSource, /const CONTEXT_MODES = Object\.freeze/);
  assert.match(contextSource, /const CONTEXT_REGISTRY_SECTIONS = Object\.freeze/);
  assert.match(contextSource, /function createAgentContextManagementRuntime\(deps = \{\}\)/);
  assert.match(contextSource, /function startTask\(input = \{\}\)/);
  assert.match(contextSource, /function completeTask\(input = \{\}\)/);
  assert.match(contextSource, /function buildContextRegistry\(input = \{\}\)/);
  assert.match(contextSource, /function buildContextEnvelope\(input = \{\}\)/);
  assert.match(contextSource, /function getContextRegistry\(sessionId\)/);
  assert.match(registrySource, /function createAgentContextRegistryRuntime\(deps = \{\}\)/);
  assert.match(memorySource, /const MEMORY_ACTIONS = Object\.freeze/);
  assert.match(memorySource, /function createAgentMemoryRuntime\(deps = \{\}\)/);
  assert.match(memorySource, /async function remember\(input = \{\}\)/);
  assert.match(memorySource, /async function recall\(input = \{\}\)/);
  assert.match(memorySource, /async function forget\(input = \{\}\)/);
  assert.match(memorySource, /async function list\(input = \{\}\)/);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'memory'), true);
  assert.deepEqual(toolCallCatalog.memory?.input_schema?.properties?.action?.enum, ['recall', 'remember', 'forget', 'list']);
});

test('agent chat log helper exports reusable session log runtime and renderer consumes session UI ids', () => {
  const helperSource = fs.readFileSync(
    agentPath('context', 'agent-chat-log.js'),
    'utf8'
  );
  const rendererSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'),
    'utf8'
  );
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(helperSource, /const CHAT_LOG_FOLDER_NAME = 'chat_log';/);
  assert.match(helperSource, /const CHAT_LOG_INDEX_FILE_NAME = 'index\.json';/);
  assert.match(helperSource, /const CHAT_LOG_EVENT_TYPES = Object\.freeze/);
  assert.match(helperSource, /function createAgentChatLogRuntime\(deps = \{\}\)/);
  assert.match(helperSource, /async function createSession\(input = \{\}\)/);
  assert.match(helperSource, /async function listSessions\(input = \{\}\)/);
  assert.match(helperSource, /async function getSession\(input = \{\}\)/);
  assert.match(rendererSource, /agentChatLogListSessions/);
  assert.match(rendererSource, /agentChatLogGetSession/);
  assert.match(rendererSource, /agentChatLogCreateSession/);
  assert.match(rendererSource, /function renderSessionList\(\)/);
  assert.match(html, /id="agent-session-list"/);
  assert.match(html, /id="agent-new-chat-btn"/);
});

test('literature, paper context, paper analysis, and protocol generation helpers expose reusable runtimes and registered tools', () => {
  const literatureSource = fs.readFileSync(
    agentPath('tools', 'agent-literature-search.js'),
    'utf8'
  );
  const paperContextSource = fs.readFileSync(
    agentPath('tools', 'agent-paper-context-loader.js'),
    'utf8'
  );
  const paperDownloadSource = fs.readFileSync(
    agentPath('tools', 'agent-paper-download.js'),
    'utf8'
  );
  const paperSource = fs.readFileSync(
    agentPath('tools', 'agent-paper-analysis.js'),
    'utf8'
  );
  const protocolSource = fs.readFileSync(
    agentPath('tools', 'agent-protocol-generation.js'),
    'utf8'
  );
  const llmUtilsSource = fs.readFileSync(
    agentPath('shared', 'agent-llm-utils.js'),
    'utf8'
  );
  const mainAgentServicesSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'),
    'utf8'
  );
  const toolsCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tools.json'),
    'utf8'
  ));
  const toolCallCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tool-call.json'),
    'utf8'
  ));

  assert.match(literatureSource, /const LITERATURE_SOURCES = Object\.freeze/);
  assert.match(literatureSource, /function createLiteratureSearchRuntime\(deps = \{\}\)/);
  assert.match(literatureSource, /function buildLiteratureQuery\(input = \{\}\)/);
  assert.match(literatureSource, /async function searchLiterature\(input = \{\}\)/);
  assert.match(paperContextSource, /const PAPER_CONTEXT_SOURCE_ORDER = Object\.freeze/);
  assert.match(paperContextSource, /function createPaperContextLoaderRuntime\(deps = \{\}\)/);
  assert.match(paperContextSource, /async function loadPaperContexts\(input = \{\}\)/);
  assert.equal(paperContextSource.includes('paper-download'), false);
  assert.equal(paperContextSource.includes('storage_path'), false);
  assert.equal(readSource('src/main/helpers/agent/tools/agent-literature-search.js').includes("require('../shared/agent-llm-utils.js')"), true);
  assert.match(paperDownloadSource, /const PAPER_DOWNLOAD_ACTIONS = Object\.freeze/);
  assert.match(paperDownloadSource, /function createPaperDownloadRuntime\(deps = \{\}\)/);
  assert.match(paperDownloadSource, /function extractPaperDownloadTargets\(input = \{\}\)/);
  assert.match(paperDownloadSource, /async function downloadPaper\(input = \{\}\)/);
  assert.match(paperDownloadSource, /browser-assisted download session/i);
  assert.match(paperSource, /function createPaperAnalysisRuntime\(deps = \{\}\)/);
  assert.match(paperSource, /createProtocolGenerationRuntime/);
  assert.match(paperSource, /async function analyzePaper\(input = \{\}\)/);
  assert.match(protocolSource, /function createProtocolGenerationRuntime\(deps = \{\}\)/);
  assert.match(protocolSource, /async function generateProtocol\(input = \{\}\)/);
  assert.match(protocolSource, /troubleshooting/);
  assert.match(protocolSource, /\{\{ph:/);
  assert.match(llmUtilsSource, /pdfDataUrl/);
  assert.match(llmUtilsSource, /fileName/);
  assert.match(llmUtilsSource, /input_file/);
  assert.match(llmUtilsSource, /inlineData/);
  assert.match(llmUtilsSource, /document/);
  assert.match(mainAgentServicesSource, /createPaperContextLoaderRuntime/);
  assert.match(mainAgentServicesSource, /paperContextLoaderRuntime/);
  assert.equal(readSource('src/main/helpers/agent/tools/agent-paper-analysis.js').includes("require('../shared/agent-llm-utils.js')"), true);
  assert.equal(readSource('src/main/helpers/agent/tools/agent-protocol-generation.js').includes("require('../shared/agent-llm-utils.js')"), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'literature-search'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-download'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'paper-analysis'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'notebook-draft'), true);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'protocol-generation'), true);
  assert.equal(Boolean(toolCallCatalog['literature-search']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['paper-download']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['paper-analysis']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['notebook-draft']?.input_schema), true);
  assert.equal(Boolean(toolCallCatalog['protocol-generation']?.input_schema), true);
});

test('purchase recommendation helper exposes reusable runtime and tool contracts', () => {
  const purchaseSource = fs.readFileSync(
    agentPath('tools', 'agent-purchase-recommendation.js'),
    'utf8'
  );
  const toolsCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tools.json'),
    'utf8'
  ));
  const toolCallCatalog = JSON.parse(fs.readFileSync(
    agentPath('tools', 'Tool-call.json'),
    'utf8'
  ));

  assert.match(purchaseSource, /function createPurchaseRecommendationRuntime\(deps = \{\}\)/);
  assert.match(purchaseSource, /function buildSearchQuery\(input = \{\}\)/);
  assert.match(purchaseSource, /function extractProductFromHtml\(html = '', pageUrl = ''\)/);
  assert.match(purchaseSource, /const completeJsonLdProduct =/);
  assert.match(purchaseSource, /readMetaContent\(html, 'property', 'og:image'\)/);
  assert.match(purchaseSource, /follow_up_questions/);
  assert.equal(toolsCatalog.some((entry) => entry?.name === 'purchase-recommendation'), true);
  assert.equal(Boolean(toolCallCatalog['purchase-recommendation']?.input_schema), true);
  assert.equal(typeof toolCallCatalog['purchase-recommendation']?.description, 'string');
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

test('sequence library helper indexes feature sequences and traces them back to host vectors', async () => {
  const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-feature-search-'));
  try {
    const first = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'VectorAlpha',
      status: 'saved',
      sourceFormat: 'genbank',
      topology: 'circular',
      sequence: 'ATGCGATTTAAA',
      sequenceLength: 12,
      featureCount: 1,
      features: [
        {
          name: 'SharedProm',
          type: 'promoter',
          strand: 1,
          source: 'import',
          segments: [{ start: 0, end: 6 }]
        }
      ],
      gbkText: 'LOCUS       VectorAlpha       12 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgatttaaa\n//\n',
      htmlText: '<html><body>alpha</body></html>'
    });

    const second = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'VectorBeta',
      status: 'temporary',
      sourceFormat: 'genbank',
      topology: 'linear',
      sequence: 'CCCATGCGAGGG',
      sequenceLength: 12,
      featureCount: 1,
      features: [
        {
          name: 'SharedProm',
          type: 'promoter',
          strand: 1,
          source: 'annotation',
          segments: [{ start: 3, end: 9 }]
        }
      ],
      gbkText: 'LOCUS       VectorBeta        12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 cccatgcgaggg\n//\n',
      htmlText: '<html><body>beta</body></html>'
    });

    const byName = await sequenceLibrary.searchSequenceFeatures({
      storagePath: storageRoot,
      query: 'SharedProm'
    });
    assert.equal(byName.results.length, 1);
    assert.equal(byName.results[0].sequence, 'ATGCGA');
    assert.equal(byName.results[0].hostCount, 2);
    assert.equal(byName.results[0].hosts.some((host) => host.hostVectorId === first.entry.id), true);
    assert.equal(byName.results[0].hosts.some((host) => host.hostVectorId === second.entry.id), true);

    const firstHost = byName.results[0].hosts.find((host) => host.hostVectorId === first.entry.id);
    assert.equal(firstHost.locations[0].startPos, 1);
    assert.equal(firstHost.locations[0].endPos, 6);

    const bySequence = await sequenceLibrary.searchSequenceFeatures({
      storagePath: storageRoot,
      query: 'TGCGA'
    });
    assert.equal(bySequence.results.length, 1);
    assert.equal(bySequence.results[0].name, 'SharedProm');

    await sequenceLibrary.deleteSequenceEntry({
      storagePath: storageRoot,
      id: second.entry.id
    });

    const afterDelete = await sequenceLibrary.searchSequenceFeatures({
      storagePath: storageRoot,
      query: 'SharedProm'
    });
    assert.equal(afterDelete.results.length, 1);
    assert.equal(afterDelete.results[0].hostCount, 1);
    assert.equal(afterDelete.results[0].hosts[0].hostVectorId, first.entry.id);
  } finally {
    await fsPromises.rm(storageRoot, { recursive: true, force: true });
  }
});

test('sequence library helper recognizes stored backbone and insert from a derived vector', async () => {
  const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-backbone-recognition-'));
  try {
    const hostSequence = 'ATGCGTACGCTAGTTACCGGATCA';
    const querySequence = 'ATGCGTACGCTAGTTAGGAACCCCGGATCA';
    const saved = await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'HostVector',
      status: 'saved',
      sourceFormat: 'genbank',
      topology: 'circular',
      sequence: hostSequence,
      sequenceLength: hostSequence.length,
      featureCount: 0,
      features: [],
      gbkText: 'LOCUS       HostVector       24 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgtacgctagttaccggatca\n//\n',
      htmlText: '<html><body>host</body></html>'
    });

    const result = await sequenceLibrary.recognizeSequenceBackbone({
      storagePath: storageRoot,
      sequence: querySequence
    });

    assert.equal(result.match?.hostVectorId, saved.entry.id);
    assert.equal(result.match?.hostVectorName, 'HostVector');
    assert.equal(result.match?.backboneLength, hostSequence.length);
    assert.equal(result.match?.insertLength, 6);
    assert.equal(
      JSON.stringify(result.match?.backboneSegments),
      JSON.stringify([{ start: 0, end: 16 }, { start: 22, end: 30 }])
    );
    assert.equal(
      JSON.stringify(result.match?.insertSegments),
      JSON.stringify([{ start: 16, end: 22 }])
    );
  } finally {
    await fsPromises.rm(storageRoot, { recursive: true, force: true });
  }
});

test('sequence library helper exposes Gibson and restriction variants for promoter-anchored expression inserts', async () => {
  const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-expression-backbone-'));
  try {
    const promoter = 'TAATACGACTCACTATAGG';
    const upstreamSite = 'CATATG';
    const downstreamSite = 'CTCGAG';
    const suffix = 'GCGTACCGGATCCGTTAAACCGGATCA';
    const hostSequence = `${promoter}${upstreamSite}${downstreamSite}${suffix}`;
    const querySequence = `${promoter}${upstreamSite}AAACCCGGGTAA${downstreamSite}${suffix}`;
    const gibsonInsert = 'ATGAAACCCGGGTAA';
    const restrictionInsert = `${upstreamSite}AAACCCGGGTAA${downstreamSite}`;
    const promoterLength = promoter.length;

    await sequenceLibrary.upsertSequenceEntry({
      storagePath: storageRoot,
      name: 'T7ExpressionHost',
      status: 'saved',
      sourceFormat: 'genbank',
      topology: 'circular',
      sequence: hostSequence,
      sequenceLength: hostSequence.length,
      featureCount: 1,
      features: [],
      gbkText: `LOCUS       T7ExpressionHost ${String(hostSequence.length).padStart(8, ' ')} bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..${promoterLength}
                     /label="T7 promoter"
                     /note="promoter for recombinant protein expression"
ORIGIN
        1 ${hostSequence.toLowerCase()}
//
`,
      htmlText: '<html><body>host</body></html>'
    });

    const result = await sequenceLibrary.recognizeSequenceBackbone({
      storagePath: storageRoot,
      sequence: querySequence
    });

    assert.equal(result.match?.hostVectorName, 'T7ExpressionHost');
    assert.equal(result.match?.insertLength, 12);
    assert.equal(result.match?.promoter?.name, 'T7 promoter');
    assert.equal(result.match?.variants?.gibson?.source, 'promoter_orf');
    assert.equal(result.match?.variants?.gibson?.insertSequence, gibsonInsert);
    assert.equal(
      result.match?.variants?.gibson?.backboneSequence,
      `${promoter}CAT${downstreamSite}${suffix}`
    );
    assert.equal(
      JSON.stringify(result.match?.variants?.gibson?.insertSegments),
      JSON.stringify([{ start: promoterLength + 3, end: promoterLength + 18 }])
    );
    assert.equal(result.match?.variants?.restriction?.insertSequence, restrictionInsert);
    assert.equal(result.match?.variants?.restriction?.backboneSequence, hostSequence);
    assert.equal(result.match?.variants?.restriction?.upstreamSite?.name, 'NdeI');
    assert.equal(result.match?.variants?.restriction?.downstreamSite?.name, 'XhoI');
    assert.equal(
      JSON.stringify(result.match?.variants?.restriction?.insertSegments),
      JSON.stringify([{ start: promoterLength, end: promoterLength + restrictionInsert.length }])
    );
  } finally {
    await fsPromises.rm(storageRoot, { recursive: true, force: true });
  }
});

test('main wires intent parser + observability paths for parser-only controller', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const controllerCoreSource = fs.readFileSync(agentRegistrarPath('agent-controller-core.js'), 'utf8');
  const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
  const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
  const sessionRuntimeSource = fs.readFileSync(agentPath('runtime', 'agent-session-runtime.js'), 'utf8');
  assert.match(mainSource, /createMainAgentServices/);
  assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/intent\/agent-intent-parser'\)/);
  assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/shared\/agent-observability'\)/);
  assert.match(mainAgentServicesSource, /require\('\.\.\/agent\/shared\/agent-controller-utils'\)/);
  assert.match(mainSource, /registerAgentIpc/);
  assert.match(controllerCoreSource, /requestIntentParserPayload\(/);
  assert.match(llmBridgeSource, /function createAgentLlmProviderBridge\(deps = \{\}\)/);
  assert.match(controllerUtilsSource, /requestStructuredJsonPayload\(/);
  assert.match(controllerUtilsSource, /createAgentLlmRuntimeHelpers/);
  assert.match(sessionRuntimeSource, /agent-llm-provider-bridge\.js/);
  assert.match(controllerUtilsSource, /recordAgentLlmTrace/);
  assert.match(sessionRuntimeSource, /recordAgentLlmTrace\(/);
  assert.equal(/agent-sqlite-index/.test(mainSource), false);
  assert.equal(/agent-phase89-runtime/.test(mainSource), false);
});

test('agent lookup runtime composes reusable inventory and record helpers', () => {
  const source = readSource('src/main/helpers/agent/runtime/agent-lookup-runtime.js');
  assert.match(source, /resolveAgentRuntimeFactory/);
  assert.match(source, /require\('\.\.\/tools\/agent-inventory-lookup'\)/);
  assert.match(source, /require\('\.\.\/tools\/agent-record-lookup\.js'\)/);
  assert.match(source, /createAgentInventoryLookupRuntime\(\{/);
  assert.match(source, /createAgentRecordLookupRuntime\(sharedLookupDeps\)/);
  assert.match(source, /searchInventoryIndex:\s*inventoryLookupRuntime\.searchInventoryIndex/);
  assert.match(source, /searchRecordIndex:\s*recordLookupRuntime\.searchRecordIndex/);
});

test('agent runtime registry registers and resolves named runtime factories', () => {
  const {
    createAgentRuntimeRegistry,
    resolveAgentRuntimeFactory
  } = require(agentPath('shared', 'agent-runtime-registry.js'));
  const registry = createAgentRuntimeRegistry();
  const sentinel = () => ({ ok: true });

  assert.equal(registry.registerRuntimeFactory('Notebook-Generation', sentinel), true);
  assert.equal(registry.hasRuntimeFactory('notebook-generation'), true);
  assert.equal(registry.getRuntimeFactory('notebook-generation'), sentinel);
  assert.equal(resolveAgentRuntimeFactory({ runtimeRegistry: registry }, 'NOTEBOOK-GENERATION'), sentinel);
  assert.equal(registry.unregisterRuntimeFactory('notebook-generation'), true);
  assert.equal(registry.hasRuntimeFactory('notebook-generation'), false);
});

test('agent lookup runtime can use registry-provided helper factories', async () => {
  const { createAgentLookupRuntime } = require(agentPath('runtime', 'agent-lookup-runtime.js'));
  const requestedFactories = [];
  const lookupRuntime = createAgentLookupRuntime({
    getAgentRuntimeFactory: (runtimeName) => {
      requestedFactories.push(runtimeName);
      if (runtimeName === 'inventory-lookup') {
        return () => ({
          async searchInventoryIndex({ query } = {}) {
            return {
              status: 'matched',
              source: 'registry_inventory',
              items: [{ id: 'inv-1', name: String(query || '') }]
            };
          },
          async executeInventoryLookup() {
            return {
              status: 'matched',
              items: []
            };
          }
        });
      }
      if (runtimeName === 'record-lookup') {
        return () => ({
          async searchRecordIndex({ query } = {}) {
            return {
              status: 'matched',
              source: 'registry_record',
              items: [{ id: 'rec-1', name: String(query || '') }]
            };
          },
          async executeRecordLookup() {
            return {
              status: 'matched',
              items: []
            };
          }
        });
      }
      return null;
    }
  });

  const inventorySearch = await lookupRuntime.searchInventoryIndex({
    query: 'Atlas construct'
  });
  const recordSearch = await lookupRuntime.searchRecordIndex({
    query: 'Protein Purification'
  });

  assert.deepEqual(requestedFactories, ['inventory-lookup', 'record-lookup']);
  assert.equal(inventorySearch.source, 'registry_inventory');
  assert.equal(recordSearch.source, 'registry_record');
});

test('main registers shared agent runtime factories before composing higher-level runtimes', () => {
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  assert.match(mainAgentServicesSource, /createAgentRuntimeRegistry/);
  assert.match(mainAgentServicesSource, /registerRuntimeFactory\('inventory-lookup', createAgentInventoryLookupRuntime\)/);
  assert.match(mainAgentServicesSource, /registerRuntimeFactory\('record-lookup', createAgentRecordLookupRuntime\)/);
  assert.match(mainAgentServicesSource, /registerRuntimeFactory\('protocol-matching', createProtocolMatchingRuntime\)/);
  assert.match(mainAgentServicesSource, /registerRuntimeFactory\('notebook-generation', createNotebookGenerationRuntime\)/);
  assert.match(mainAgentServicesSource, /getAgentRuntimeFactory:\s*agentRuntimeRegistry\.getRuntimeFactory/);
});

test('science runtimes use canonical catalog tools and main wires their schemas and executors', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
  const { SCIENCE_REASONING_POLICIES } = require(agentPath('runtime', 'science-reasoning-loop', 'index.js'));
  const { DEEP_RESEARCH_POLICIES } = require(agentPath('deep-research', 'index.js'));
  const { getToolInputSchemas } = require(agentPath('tools', 'agent-tool-loading.js'));
  const { REASONING_ENTRY_TOOL_SCOPES } = require(agentPath('tools', 'agent-tool-provide.js'));

  Object.values(SCIENCE_REASONING_POLICIES).forEach((policy) => {
    assert.equal(policy.tool_scope, null);
    const resolved = getToolInputSchemas(policy.tool_scope);
    assert.equal(resolved.length > 0, true);
  });
  Object.values(DEEP_RESEARCH_POLICIES).forEach((policy) => {
    assert.equal(policy.tool_scope, null);
    const resolved = getToolInputSchemas(policy.tool_scope);
    assert.equal(resolved.length > 0, true);
  });
  assert.deepEqual(
    SCIENCE_REASONING_POLICIES.general_science_question.tool_scope,
    REASONING_ENTRY_TOOL_SCOPES.science_reasoning_entry.general_science_question
  );
  assert.deepEqual(
    DEEP_RESEARCH_POLICIES.result_analysis.tool_scope,
    REASONING_ENTRY_TOOL_SCOPES.deep_research_entry.result_analysis
  );

  assert.equal(mainSource.includes('createMainAgentServices'), true);
  assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('inventory-lookup'"), false);
  assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('record-lookup'"), false);
  assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('literature-search'"), false);
  assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('purchase-recommendation'"), false);
  assert.equal(mainAgentServicesSource.includes("genericAgentToolRuntime.registerToolExecutor('python-sandbox'"), false);
  assert.equal(mainAgentServicesSource.includes('registerAgentToolExecutors({'), true);
  assert.equal(mainAgentServicesSource.includes('const agentToolProviderRuntime = createAgentToolProviderRuntime'), true);
  assert.equal(mainAgentServicesSource.includes('toolProvider: agentToolProviderRuntime'), true);
  assert.equal(mainAgentServicesSource.includes('runTool: agentToolRuntime.runAgentTool'), true);
});

test('main no longer wires legacy routing and phase orchestration helpers', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
  assert.equal(/require\('\.\/helpers\/agent\/agent-routing'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-paper-analysis'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-project-retrieval'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-response-layer'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-validation-safety'/.test(mainSource), false);
  assert.equal(/require\('\.\/helpers\/agent\/agent-phase89-runtime'/.test(mainSource), false);
  assert.equal(/requestIntentParserPayload\(/.test(mainSource), false);
  assert.equal(/runAgentToolDispatchLegacy\(/.test(mainSource), false);
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

test('telegram bot project parsing avoids hardcoded target shorthands', () => {
  const internals = telegramBot._internals || {};
  assert.equal(typeof internals.parseProjectFromText, 'function');
  assert.equal(internals.parseProjectFromText('run this for project Atlas'), 'Atlas');
  assert.equal(internals.parseProjectFromText('run this on EGFR'), null);
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
  const resolveLocalImport = (fromPath, specifier) => {
    const raw = String(specifier || '').trim();
    if (!raw.startsWith('.')) {
      return '';
    }
    const candidate = path.resolve(path.dirname(fromPath), raw);
    return path.extname(candidate) ? candidate : `${candidate}.js`;
  };
  const collectLocalImportSpecifiers = (source) => {
    const specifiers = new Set();
    const importRegex = /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;
    let match;
    while ((match = importRegex.exec(source))) {
      if (String(match[1] || '').startsWith('.')) {
        specifiers.add(match[1]);
      }
    }
    return [...specifiers];
  };
  const collectReachableSourceFiles = (entryPath, visited = new Set()) => {
    if (!entryPath || visited.has(entryPath) || !fs.existsSync(entryPath) || !entryPath.endsWith('.js')) {
      return [];
    }
    visited.add(entryPath);
    const source = fs.readFileSync(entryPath, 'utf8');
    const files = [entryPath];
    collectLocalImportSpecifiers(source).forEach((specifier) => {
      const resolvedPath = resolveLocalImport(entryPath, specifier);
      if (!resolvedPath) {
        return;
      }
      files.push(...collectReachableSourceFiles(resolvedPath, visited));
    });
    return files;
  };
  const sourceFiles = collectReachableSourceFiles(path.join(__dirname, 'src', 'renderer', 'renderer.js'));
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
