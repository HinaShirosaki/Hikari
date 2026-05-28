module.exports = function registerUiAndLayoutContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'main.js'),
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'app', 'main-runtime.js'),
      readLocalSource('src', 'main', 'ipc', 'index.js')
    ].join('\n');
    const readPreloadSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'agent-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'llm-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'sequence-library-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'storage-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'system-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'telegram-api.js')
    ].join('\n');
    const readRendererShellSource = () => [
      readLocalSource('src', 'renderer', 'app', 'start-renderer-app.js'),
      readLocalSource('src', 'renderer', 'app', 'navigation-shell.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-search.js')
    ].join('\n');

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

    test('universal agent chat rail is shell-scoped and registry gated', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const generatedRegistry = readLocalSource('src', 'renderer', 'modules', 'app-registry.generated.js');
      const rendererShellSource = readRendererShellSource();
      const moduleRuntimeSource = readSource('src/renderer/module-runtime.js');
      const domBindingsSource = readLocalSource('src', 'renderer', 'modules', 'agent-chat', 'dom-bindings.js');
      const coreCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'base', 'core.css'), 'utf8');

      assert.match(html, /id="universal-agent-chat-rail"/);
      assert.match(html, /id="agent-rail-chat-history"/);
      assert.equal((registry.apps || []).every((app) => app.agentChatRail !== true), true);
      assert.match(generatedRegistry, /"agentChatRail": false/);
      assert.match(rendererShellSource, /app\?\.agentChatRail === true/);
      assert.match(rendererShellSource, /agentChatRail\.hidden = !enabled/);
      assert.match(rendererShellSource, /moduleRuntime\.renderAgentChatRail\?\.\(\)/);
      assert.match(moduleRuntimeSource, /idPrefix:\s*'agent-rail'/);
      assert.match(moduleRuntimeSource, /loadPersistentSessions:\s*false/);
      assert.match(domBindingsSource, /const id = \(suffix\) => `\$\{idPrefix\}-\$\{suffix\}`;/);
      assert.match(coreCss, /body\.has-agent-chat-rail \.workspace-shell/);
    });

    test('renderer routes personal inventory aliases to merged sample workspace', () => {
      const source = readRendererShellSource();
      const moduleRuntimeSource = readSource('src/renderer/module-runtime.js');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
      assert.match(source, /function normalizeViewId\(VIEWS, viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/);
      assert.ok(sampleEntry);
      assert.ok(sampleEntry.aliases.includes('inventory'));
      assert.equal(sampleEntry.searchInputId, 'sample-search');
      assert.match(source, /const searchScopeTargets = buildSearchScopeMap\(\{\s*apps: APP_REGISTRY,/);
      assert.match(source, /const showSampleInventoryWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
      assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
      assert.match(moduleRuntimeSource, /function renderSampleRegistryWorkspace\(modules\) \{\s*modules\.personalInventory\.renderSections\(\);\s*modules\.sampleRegistry\.render\(\);\s*\}/);
      assert.match(moduleRuntimeSource, /\[views\.SAMPLE_REGISTRY,\s*\(\)\s*=>\s*renderSampleRegistryWorkspace\(modules\)\]/);
    });

    test('renderer defines sequence viewer aliases and showView render hook', () => {
      const source = readRendererShellSource();
      const moduleRuntimeSource = readSource('src/renderer/module-runtime.js');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sequenceEntry = registry.apps.find((app) => app.id === 'sequence-viewer');
      assert.ok(sequenceEntry);
      assert.ok(sequenceEntry.aliases.includes('sequence'));
      assert.ok(sequenceEntry.aliases.includes('seqviewer'));
      assert.match(source, /const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';/);
      assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
      assert.match(moduleRuntimeSource, /if \(viewId === views\.SEQUENCE_VIEWER \|\| viewId === sequenceViewerDetailViewId\) \{\s*modules\.sequenceViewer\?\.\s*render\?\.\(\{\s*activeViewId:\s*viewId\s*\}\);\s*return;\s*\}/);
      assert.match(moduleRuntimeSource, /sequenceViewer:\s*initAndRegisterModule\(moduleRegistry,\s*'sequenceViewer',\s*initSequenceViewer,\s*\{\s*homeViewId:\s*views\.SEQUENCE_VIEWER,\s*detailViewId:\s*sequenceViewerDetailViewId,\s*onNavigateHome:\s*\(\)\s*=>\s*\{\s*showView\(views\.SEQUENCE_VIEWER\);/);
      assert.match(moduleRuntimeSource, /onNavigateDetail:\s*\(\)\s*=>\s*\{\s*showView\(sequenceViewerDetailViewId\);/);
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
      assert.equal(detailBlock.includes('id="sequence-viewer-back-btn"'), false);
      assert.equal(detailBlock.includes('Back to Library'), false);
      assert.match(detailBlock, /id="sequence-viewer-detail-protein-builder-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-save-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-annotate-btn"/);
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

    test('sequence viewer home sidebar owns scrolling instead of nesting it inside the library list', () => {
      const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'sequence-viewer-view.css'), 'utf8');
      assert.match(css, /\.sequence-viewer-home-sidebar,\s*\.sequence-viewer-home-main\s*\{[\s\S]*min-height:\s*0;/);
      assert.match(css, /\.sequence-viewer-home-sidebar\s*\{[\s\S]*scrollbar-width:\s*thin;/);
      assert.match(css, /\.sequence-viewer-home-sidebar::-webkit-scrollbar/);
      assert.match(css, /\.sequence-viewer-library-list\s*\{[\s\S]*max-height:\s*none;/);
      assert.match(css, /\.sequence-viewer-library-list\s*\{[\s\S]*overflow:\s*visible;/);
    });

    test('papers PDF text layer keeps native browser selection stable during drag', () => {
      const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'papers-view.css'), 'utf8');
      const pageRecordsSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer-page-records.js');
      const renderingSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer-rendering.js');
      const viewerSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer.js');
      const selectionSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer-text-selection.js');
      assert.match(pageRecordsSource, /className\s*=\s*'papers-viewer-text-layer textLayer'/);
      assert.match(pageRecordsSource, /textSelectionCleanup/);
      assert.match(renderingSource, /bindPdfTextLayerSelection/);
      assert.match(selectionSource, /endOfContent/);
      assert.match(selectionSource, /range\.compareBoundaryPoints/);
      assert.match(selectionSource, /endDiv\.style\.userSelect\s*=\s*'text'/);
      assert.match(viewerSource, /selectionPointerDown/);
      assert.match(viewerSource, /doc\.addEventListener\('selectionchange', schedulePendingSelectionUpdate\)/);
      assert.match(css, /\.papers-viewer-text-layer\s*\{[\s\S]*overflow:\s*clip;/);
      assert.match(css, /\.papers-viewer-text-layer\s*\{[\s\S]*--text-scale-factor:/);
      assert.match(css, /\.papers-viewer-text-layer br::selection\s*\{[\s\S]*background:\s*transparent;/);
      assert.match(css, /\.papers-viewer-text-layer \.endOfContent\s*\{[\s\S]*inset:\s*100% 0 0;/);
      assert.match(css, /\.papers-viewer-text-layer\.selecting \.endOfContent\s*\{[\s\S]*top:\s*0;/);
      assert.doesNotMatch(css, /\.papers-viewer-text-layer span\s*\{[\s\S]*font-family:\s*var\(--font-app\)/);
    });

    test('papers PDF first-load sizing stays inside the app shell', () => {
      const coreCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'base', 'core.css'), 'utf8');
      const papersCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'papers-view.css'), 'utf8');
      const viewerSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer.js');
      assert.match(coreCss, /html\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
      assert.match(coreCss, /body\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
      assert.match(papersCss, /\.papers-viewer-workspace\s*\{[\s\S]*overflow:\s*hidden;/);
      assert.match(viewerSource, /function getElementLayoutWidth\(element\)/);
      assert.match(viewerSource, /const layoutWidth = \[\s*stage,\s*workspace,\s*shell\s*\]/);
      assert.match(viewerSource, /Math\.max\(layoutWidth - horizontalPadding, 320\)/);
    });

    test('ketcher embedded page uses portable static path resolution', () => {
      const html = fs.readFileSync(path.join(__dirname, 'ketcher-embedded.html'), 'utf8');
      assert.equal(html.includes('/Users/'), false);
      assert.equal(html.includes('C:\\\\Users'), false);
      assert.match(html, /new URL\('\.\/vendor\/ketcher-src\/packages\/release\/index\.html', window\.location\.href\)/);
    });

    test('forge config prunes dev deps and ignores build artifacts', () => {
      assert.equal(Boolean(forgeConfig.packagerConfig.asar), true);
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /src\/main\/helpers\/agent/
      );
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /node_modules\/@modelcontextprotocol\/sdk/
      );
      assert.equal(forgeConfig.packagerConfig.prune, true);
      assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
      const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
      assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\.DS_Store/);
      assert.match(ignoreAsText, /hikari-data\(\?:\\\.ena\)\?\\\.json/);
    });

    test('main sql.js helpers resolve the bundled vendor asset from package-safe paths', () => {
      const { resolveSqlJsWasmJsPath } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'sqljs-path.js'));
      const resolved = resolveSqlJsWasmJsPath(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle'));
      assert.equal(resolved.endsWith(path.join('vendor', 'sqljs', 'sql-wasm.js')), true);
      assert.equal(fs.existsSync(resolved), true);
    });

    test('main window keeps split preload CommonJS modules available', () => {
      const source = fs.readFileSync(path.join(__dirname, 'src', 'main', 'windows', 'create-main-window.js'), 'utf8');
      assert.match(source, /contextIsolation:\s*true/);
      assert.match(source, /nodeIntegration:\s*false/);
      assert.match(source, /sandbox:\s*false/);
      assert.match(source, /preload:\s*preloadPath/);
    });

    test('telegram bridge keeps only supported renderer IPC channel', () => {
      const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.equal(telegramBotSource.includes('telegram-message'), false);
      assert.equal(preloadSource.includes('onTelegramCommand'), true);
    });

    test('main composes dedicated IPC registrars with generic tool runtime support', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', ...parts);
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'), 'utf8');
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const agentRegistrarSource = fs.readFileSync(agentRegistrarPath('index.js'), 'utf8');
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
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
      assert.match(mainAgentServicesSource, /llmProviderBridge/);
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
      assert.doesNotMatch(llmBridgeSource, /function startToolSession\(/);
    });

    test('agent shared text helpers no longer clip long prompts by default', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const llmUtilsSource = fs.readFileSync(agentPath('shared', 'agent-llm-utils.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      const chatLogSource = fs.readFileSync(agentPath('context', 'agent-chat-log.js'), 'utf8');
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
      assert.doesNotMatch(llmUtilsSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(llmBridgeSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(chatLogSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(systemRegistrarSource, /promptRaw\.length > 120000/);
    });

    test('settings expose Codex login recovery controls through preload and system IPC', () => {
      const mainSource = readMainProcessSource();
      const preloadSource = readPreloadSource();
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
      const settingsSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'settings', 'index.js'), 'utf8');
      const settingsHtml = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'setting-view.html'), 'utf8');

      assert.match(mainSource, /launchCodexCliLogin/);
      assert.match(mainSource, /clearCodexCliStoredLogin/);
      assert.match(preloadSource, /loginCodexLlm:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(LLM\.CODEX_LOGIN\)/);
      assert.match(preloadSource, /clearCodexLlmLogin:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(LLM\.CODEX_CLEAR_LOGIN\)/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_LOGIN/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_CLEAR_LOGIN/);
      assert.match(settingsSource, /window\.enanaApi\?\.loginCodexLlm/);
      assert.match(settingsSource, /window\.enanaApi\?\.clearCodexLlmLogin/);
      assert.match(settingsHtml, /id="setting-codex-status"/);
      assert.match(settingsHtml, /id="start-codex-login-btn"/);
      assert.match(settingsHtml, /id="clear-codex-login-btn"/);
    });

    test('main and preload expose sequence library IPC bridge through the data registrar', () => {
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.LIST/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.GET/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.UPSERT/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.PROMOTE/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.DELETE/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.SEARCH_FEATURES/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.ANNOTATE/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(SEQUENCE_LIBRARY\.RECOGNIZE_BACKBONE/);
      assert.match(preloadSource, /sequenceLibraryList:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.LIST, payload\)/);
      assert.match(preloadSource, /sequenceLibraryGet:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.GET, payload\)/);
      assert.match(preloadSource, /sequenceLibraryUpsert:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.UPSERT, payload\)/);
      assert.match(preloadSource, /sequenceLibrarySearchFeatures:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.SEARCH_FEATURES, payload\)/);
      assert.match(preloadSource, /sequenceLibraryAnnotate:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.ANNOTATE, payload\)/);
      assert.match(preloadSource, /sequenceLibraryRecognizeBackbone:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.RECOGNIZE_BACKBONE, payload\)/);
    });

    test('main and preload expose storage root import IPC bridge through the data registrar', () => {
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.IMPORT_ROOT/);
      assert.match(dataRegistrarSource, /importStorageRoot\(\{ storagePath \}\)/);
      assert.match(preloadSource, /importStorageRoot:\s*\(storagePath\)\s*=>\s*ipcRenderer\.invoke\(STORAGE\.IMPORT_ROOT, \{ storagePath \}\)/);
    });
  }
};
