// Source or packaged runtime: HIKARI_PLUGIN_QA_ROOT=<app's Resources/app.asar>.
// Hidden window, temporary profile/storage, and a fixture model response.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { verifyPlacement } = require('./scientific-illustration-placement.cjs');
const { verifyCanvasInteraction } = require('./scientific-illustration-interaction.cjs');
const { verifyTextResize } = require('./scientific-illustration-text-resize.cjs');
const { verifyTextBounds } = require('./scientific-illustration-text-bounds.cjs');
const { verifyRailFolding } = require('./scientific-illustration-rail.cjs');
const { verifyCanvasLayout } = require('./scientific-illustration-layout.cjs');
const { verifyGrouping } = require('./scientific-illustration-grouping.cjs');
const { verifyReusableAssets } = require('./scientific-illustration-assets.cjs');
const { verifyAreaSelection } = require('./scientific-illustration-selection.cjs');
const { verifySharedWorkspaceTools } = require('./scientific-illustration-workspace-tools.cjs');
const { verifyImageGenerationPreference } = require('./scientific-illustration-image-preference.cjs');
const { verifySourceActions } = require('./scientific-illustration-source-actions.cjs');
const { verifyAutomaticAssets } = require('./scientific-illustration-auto-assets.cjs');
const { verifyImportCrop } = require('./scientific-illustration-import-crop.cjs');
const { verifyPowerPoint } = require('./scientific-illustration-powerpoint.cjs');
const { verifyRotation } = require('./scientific-illustration-rotation.cjs');
const { verifyClipboard } = require('./scientific-illustration-clipboard.cjs');
const { verifySystemHistory } = require('./scientific-illustration-history.cjs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const repo = path.resolve(__dirname, '..');
const runtime = path.resolve(process.env.HIKARI_PLUGIN_QA_ROOT || repo);
const sharedToolsQA = process.env.HIKARI_SHARED_TOOLS_QA_ONLY === '1';
const sourceActionsQA = process.env.HIKARI_SOURCE_ACTIONS_QA_ONLY === '1';
const automaticAssetsQA = process.env.HIKARI_AUTOMATIC_ASSETS_QA_ONLY === '1';
const { registerPluginIpc } = require(path.join(runtime, 'src/main/ipc/register-plugin-ipc.js'));
const { createMainMcpService } = require(path.join(runtime, 'src/main/core/services/create-mcp-service.js'));
const { createAgentMcpStdioServer } = require(path.join(runtime, 'src/main/agent/mcp-contract/stdio-server.js'));
const { createCodexAgentRuntime } = require(path.join(runtime, 'src/main/agent/codex-agent/runtime.js'));
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'illustration-host-qa-'));
app.setPath('userData', path.join(temp, 'profile')); app.setPath('sessionData', path.join(temp, 'session'));
app.on('window-all-closed', () => {});
let win, registry, service, server, client, frame, runTool;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const evaluate = code => frame.executeJavaScript(code);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i += 1) { if (await predicate()) return; await pause(50); }
  throw new Error(message);
}
async function run() {
  await app.whenReady();
  const storage = path.join(temp, 'storage'); await fs.mkdir(storage);
  if (sourceActionsQA) {
    const folder = path.join(storage, 'KnowledgeBase/papers.md/source-fixture');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'Receptor uptake.md'), '# Receptor uptake\n\nThe ligand binds one membrane receptor. The occupied receptor enters a clathrin-coated vesicle.\n\nOnly the receptor and ligand are internalized; no kinase cascade is described.');
    const { STORAGE } = require(path.join(runtime, 'src/shared/ipc/channels.js'));
    ipcMain.handle(STORAGE.READ_FILE_BYTES, async (_event, payload) => {
      if (payload.path !== path.join(folder, 'Receptor uptake.md')) return { ok: false, error: 'ENOENT' };
      return { ok: true, bytes: await fs.readFile(payload.path) };
    });
  }
  const pluginPath = path.join(temp, 'installed', 'scientific-illustration');
  await fs.cp(process.env.HIKARI_PLUGIN_QA_SOURCE || path.join(repo, 'plugins/scientific-illustration'), pluginPath, { recursive: true });
  registry = registerPluginIpc({ ipcMain, session, fs, dialog: { ...dialog,
    showSaveDialog: async options => {
      const mode = await win?.webContents.executeJavaScript('window.qaExportDialogMode || ""');
      if (mode === 'cancel') return { canceled: true };
      if (mode === 'fail') throw new Error('Injected export disk failure');
      return { canceled: false, filePath: path.join(temp, path.basename(options.defaultPath)) };
    } } });
  const url = relative => pathToFileURL(path.join(runtime, relative)).href;
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    // This fixture supplies a connected, local stub agent.
    document.body.dataset.agentAvailability='connected';
    import { createPluginBridge } from ${JSON.stringify(url('src/renderer/app/plugin-bridge.js'))};
    import { createUndoService } from ${JSON.stringify(url('src/renderer/services/undoService.js'))};
    import { createPluginHistoryDelegate } from ${JSON.stringify(pathToFileURL(path.join(repo, 'src/renderer/app/plugin-history.js')).href)};
    import { installPlugins } from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    import { createPluginPromptHandler, createPluginChatContextHandler } from ${JSON.stringify(url('src/renderer/app/plugin-agent.js'))};
    import { createAgentRailScopeContextGetter } from ${JSON.stringify(url('src/renderer/module-manifests/agent-chat-rail.js'))};
    import { createAgentChatRail } from ${JSON.stringify(url('src/renderer/app/navigation-shell/agent-rail.js'))};
    import { createScopedAgentChatState } from ${JSON.stringify(url('src/renderer/modules/agent-chat/scoped-state.js'))};
    import { initAgentChat } from ${JSON.stringify(url('src/renderer/modules/agent-chat/index.js'))};
    window.qaInspected=await hikariApi.inspectPluginFolder(${JSON.stringify(pluginPath)});
    if(!qaInspected.ok) throw new Error(qaInspected.error);
    window.qaState={settings:{storagePath:${JSON.stringify(storage)},plugins:[{...qaInspected,enabled:true}]},notebookEntries:[]};
    window.qaRegistry=[];window.qaRequests=[];window.failSave=false;window.failIndex=false;
    const state=createScopedAgentChatState(qaState,{getScopeContext:createAgentRailScopeContextGetter({},document)});
    window.qaScopedState=state;
    const rail=initAgentChat({document,windowObject:{hikariApi:{
      agentChatLogCreateSession:async()=>{if(window.qaDelaySession)await new Promise(resolve=>window.qaReleaseSession=resolve);return {ok:true,session:{id:crypto.randomUUID()}};},
      agentChatLogListSessions:async()=>{throw new Error('Scoped chat must not load all storage sessions');},
      agentChatLogGetSession:async()=>{throw new Error('Unexpected session load');},
      agentChat:async payload=>{qaRequests.push(payload);if(window.qaDelayReply)await new Promise(resolve=>window.qaReleaseReply=resolve);return {ok:true,chat_session:{id:payload.chatSessionId},parser:{reasoning_summary:'Fixture response'}};}
    }},idPrefix:'agent-rail',loadPersistentSessions:false,state,persist:()=>{},createId:()=>crypto.randomUUID(),safeText:String});
    window.qaRail=rail;
    const railRuntime=createAgentChatRail({VIEWS:{PAPERS:'papers-view'},documentObject:document,
      getActiveViewId:()=>document.body.dataset.activeView,getAppForView:id=>qaRegistry.find(app=>app.viewId===id),
      resolveNavigationViewId:id=>id,moduleRuntime:{renderAgentChatRail:()=>rail.render()},sharedLeftRailRuntime:{syncWidth(){}}});
    railRuntime.init();window.qaRailRuntime=railRuntime;
    const setChatContext=createPluginChatContextHandler({documentObject:document,getModuleRuntime:()=>({modules:{agentChatRail:rail}})});
    const prompt=createPluginPromptHandler({state:qaState,setChatContext,getNavigation:()=>({showView:id=>{document.body.dataset.activeView=id;railRuntime.syncState(id);},openAgentChatRail:()=>{window.qaRailOpened=true;railRuntime.open();}}),getModuleRuntime:()=>({modules:{agentChatRail:rail}})});
    let historyService;
    const bridge=createPluginBridge({state:qaState,windowObject:window,persist:()=>{},onPluginPrompt:prompt,onPluginChatContext:setChatContext,
      onFrameHistoryChanged:()=>historyService?.syncButtons(),
      onPluginActivate:plugin=>{document.body.dataset.activeView='plugin-'+plugin.id+'-view';railRuntime.syncState(document.body.dataset.activeView);},
      api:{...hikariApi,writePluginFile:payload=>failSave||(failIndex&&payload.path==='library.json')||(window.qaFailAssets&&payload.path==='reusable-assets.json')||(window.qaFailGroupAck&&payload.path.startsWith('illustrations/'))?Promise.resolve({ok:false,error:'Injected disk failure'}):hikariApi.writePluginFile(payload)}});
    window.qaBridge=bridge;
    window.qaHostHistoryState={value:0};
    window.qaHistoryDelegate=createPluginHistoryDelegate({documentObject:document,windowObject:window,bridge,onChange:()=>historyService?.syncButtons()});
    window.qaUndoService=historyService=createUndoService({state:qaHostHistoryState,persistState:()=>{},renderAll:()=>{},documentObject:document,delegate:qaHistoryDelegate});
    window.addEventListener('hikari:left-rail-width-changed',()=>bridge.broadcastAppContext('layout'));
    hikariApi.onPluginCanvasRequest(async request=>hikariApi.respondToPluginCanvasRequest({id:request.id,result:await bridge.requestCanvas(request)}));
    installPlugins({state:qaState,documentObject:document,appRegistry:qaRegistry,bridge,api:hikariApi});
    document.body.dataset.activeView=qaRegistry[0].viewId;
    document.getElementById(qaRegistry[0].viewId).classList.add('is-active');
    railRuntime.syncState(qaRegistry[0].viewId);
  `);
  const historyControls='<div class="topbar-history-controls" role="group" aria-label="Undo and redo" style="position:fixed;left:16px;bottom:16px;z-index:1000"><button id="global-undo-btn" aria-label="Undo" disabled>↶</button><button id="global-redo-btn" aria-label="Redo" disabled>↷</button></div>';
  if (sharedToolsQA) {
    // Packages contain the generated shell rather than the UI source fragments.
    const shellPath = path.join(runtime, 'ui/html/shell/end.html');
    const shell = fsSync.readFileSync(fsSync.existsSync(shellPath) ? shellPath : path.join(runtime, 'index.html'), 'utf8');
    const railStart = shell.indexOf('<aside id="universal-agent-chat-rail"');
    const railMarkup = shell.slice(railStart, shell.indexOf('</aside>', railStart) + 8);
    await fs.writeFile(path.join(temp, 'index.html'), `<!DOCTYPE html><link rel="stylesheet" href="${url('styles.css')}"><style>body{margin:0;height:100vh}.workspace-main{height:100%;padding:0}.view,.plugin-view__main,iframe{width:100%;height:100%;border:0}iframe{display:block}</style>${historyControls}<div class="workspace-shell"><div class="workspace-main"></div>${railMarkup}</div><script type="module" src="host.mjs"></script>`);
  } else {
  await fs.writeFile(path.join(temp, 'index.html'), `<!DOCTYPE html><style>body{margin:0}.workspace-main{height:100vh}.view,.plugin-view__main,iframe{width:100%;height:100%;border:0}iframe{display:block}</style>${historyControls}<div hidden><select id="agent-rail-project-select"></select><div id="agent-rail-chat-history"></div><textarea id="agent-rail-message-input"></textarea><button id="agent-rail-send-btn">Send</button><div id="agent-rail-quick-prompts"><button data-agent-suggest-prompt="Summarize workspace">Old prompt</button></div><div id="agent-rail-session-list"></div><p id="agent-rail-status"></p></div><div class="workspace-main"></div><script type="module" src="host.mjs"></script>`);
  }
  win = new BrowserWindow({ show: false, width: 1300, height: 1000, webPreferences: {
    // Hidden fixtures still need animation frames for layout/context observers.
    backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(runtime, 'src/main/preload.js') } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Content-Security-Policy')) {
    errors.push(event.message); if (sourceActionsQA) console.error('Source QA renderer:', event.message);
  } });
  service = createMainMcpService({ ipcMain, getMainWindow: () => win, createMcpHost: options => {
    runTool = options.runTool; return { close: async () => {} }; } });
  await win.loadFile(path.join(temp, 'index.html'));
  for (let i = 0; i < 100; i += 1) {
    frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
    if (frame && await evaluate('Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) break;
    await pause(50);
  }
  check(frame, `Plugin failed to load: ${errors.join('\n')}`);
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  check(await evaluate('!document.querySelector("#undo,#redo") && !document.getElementById("canvas-empty").hidden') && await win.webContents.executeJavaScript('document.getElementById("global-undo-btn").disabled && document.getElementById("global-redo-btn").disabled'), 'Empty workspace uses disabled system history controls without duplicate plugin buttons');
  check(await evaluate('document.getElementById("layer-inspector").hidden && document.getElementById("layer-inspector").inert'), 'New illustrations start with the canvas dominant and Layers folded');
  await fs.writeFile(path.join(temp, 'empty.png'), (await win.webContents.capturePage()).toPNG());
  check(await win.webContents.executeJavaScript('qaInspected.permissions.includes("agent:chat") && qaInspected.permissions.includes("agent:canvas") && qaInspected.permissions.includes("layout")'), 'Installer IPC accepts agent and existing layout permissions');
  check(await win.webContents.executeJavaScript('qaRegistry[0].agentChatRail'), 'Installed plugin enables its own chat rail');
  check(await evaluate('document.querySelectorAll(".canvas-stage svg").length===2'), 'Both canvases render');
  check(await evaluate('document.getElementById("scratch-workspace").hidden && document.getElementById("scratch-canvas").getBoundingClientRect().height===0 && document.getElementById("toggle-scratch").getAttribute("aria-expanded")==="false"'), 'Only main canvas is visible on initial load');
  const nativeHome = path.join(temp, 'codex-home');
  const nativeImageFolder = path.join(nativeHome, 'generated_images');
  await fs.mkdir(nativeImageFolder, { recursive: true });
  const mcpEnv = { HIKARI_CODEX_HOME: nativeHome, ...(automaticAssetsQA ? { HIKARI_CODEX_REQUEST_CONTEXT: JSON.stringify({ pluginInspectionRunId: 'automatic-assets-run' }) } : {}) };
  server = createAgentMcpStdioServer({ runTool, workspacePath: storage, env: mcpEnv });
  client = new Client({ name: 'illustration-host-qa', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  check((await client.listTools()).tools.some(tool => tool.name === 'plugin_canvas'), 'MCP advertises plugin_canvas');
  const tool = async (request, assets) => {
    const result = await client.callTool({ name: 'plugin_canvas', arguments: { plugin_id: 'scientific-illustration', request, ...(assets ? { assets } : {}) } });
    return { ...result.structuredContent, content: result.content };
  };
  if (sourceActionsQA) {
    await verifySourceActions({ tool, evaluate, check, win, pause, temp, runtime });
    check(errors.length === 0, `No renderer errors: ${errors.join('\n')}`);
    console.log(JSON.stringify({ ok: true, sourceActions: true, checks, temp })); return;
  }
  if (automaticAssetsQA) {
    await verifyAutomaticAssets({ tool, evaluate, check, win, pause, temp, runtime, nativeImageFolder });
    check(errors.length === 0, `No renderer errors: ${errors.join('\n')}`);
    console.log(JSON.stringify({ ok: true, automaticAssets: true, checks, temp })); return;
  }
  if (process.env.HIKARI_ASSET_IMPORT_QA_ONLY === '1') {
    await verifyImportCrop({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura asset import/crop: ${checks} checks passed. Screenshots: ${temp}`); return;
  }
  if (process.env.HIKARI_POWERPOINT_QA_ONLY === '1') {
    await verifyPowerPoint({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura PowerPoint export: ${checks} checks passed. Runtime: ${runtime}. Artifacts: ${temp}`); return;
  }
  if (process.env.HIKARI_ROTATION_QA_ONLY === '1') {
    await verifyRotation({ tool, evaluate, check, win, pause, temp });
    await verifyCanvasInteraction({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura rotation and canvas interaction: ${checks} checks passed. Runtime: ${runtime}. Artifacts: ${temp}`); return;
  }
  if (process.env.HIKARI_CLIPBOARD_QA_ONLY === '1') {
    await verifyClipboard({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura clipboard: ${checks} checks passed. Runtime: ${runtime}. Artifacts: ${temp}`); return;
  }
  if (process.env.HIKARI_HISTORY_QA_ONLY === '1') {
    await verifySystemHistory({ tool, evaluate, check, win, pause });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura system history: ${checks} checks passed. Runtime: ${runtime}. Artifacts: ${temp}`); return;
  }
  await verifyImageGenerationPreference({ tool, evaluate, check, win, pause, temp });
  if (sharedToolsQA) {
    await verifySharedWorkspaceTools({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura shared tools: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
    return;
  }
  if (process.env.HIKARI_GROUPING_QA_ONLY === '1') {
    await verifyGrouping({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura grouping: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
    return;
  }
  if (process.env.HIKARI_ASSETS_QA_ONLY === '1') {
    await verifyReusableAssets({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura reusable assets: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
    return;
  }
  if (process.env.HIKARI_SELECTION_QA_ONLY === '1') {
    await verifyAreaSelection({ tool, evaluate, check, win, pause, temp });
    check(errors.length === 0, errors.join('\n'));
    console.log(`Figura area selection: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
    return;
  }
  let current = await tool({ action: 'read' });
  check(current.ok && current.agent_contract.request_schema.properties.operations, 'Read discovers the plugin-owned schema');
  check(current.complexity === 'standard' && await evaluate('document.getElementById("complexity").value==="standard" && document.getElementById("complexity").options.length===3'), 'Three complexity levels default to Standard');
  check(current.scratch_visible === false && current.agent_contract.request_schema.properties.action.enum.includes('scratch'), 'Agent discovers on-demand scratch controls');
  const scratch = visible => tool({ action: 'scratch', illustration_id: current.illustration_id, visible });
  const summoned = await scratch(true);
  check(summoned.ok && summoned.scratch_visible && summoned.revision === current.revision && await evaluate('!document.getElementById("scratch-workspace").hidden'), 'Agent summons scratch without changing artwork revision');
  check((await scratch(false)).scratch_visible === false && await evaluate('document.getElementById("scratch-workspace").hidden'), 'Agent closes the scratch canvas');
  const apply = operations => ({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
  // Exercise the native tool's file handoff with fixture pixels, no live model.
  const nativeImagePath = path.join(nativeImageFolder, 'component.png');
  const nativePixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(nativeImagePath, nativePixels);
  const nativeAssets = [{ id: 'native-image', source: 'codex', path: nativeImagePath }];
  const nativeObject = { id: 'native-component', type: 'raster', canvas: 'scratch', x: 38, y: 28, width: 120, height: 80, textFree: true };
  current = await tool(apply([{ op: 'upsert', object: nativeObject, raster_asset: 'native-image' },
    { op: 'upsert', object: { id: 'native-label', type: 'text', text: 'Component', x: 38, y: 120 } }]), nativeAssets);
  check(current.ok && current.objects.length === 2 && current.objects[0].type === 'raster', 'Native Codex file imports from outside Hikari storage with a separate text label');
  const multipleAssets = Array.from({ length: 12 }, (_, i) => ({ id: `native-image-${i}`, source: 'codex', path: nativeImagePath }));
  current = await tool(apply(multipleAssets.map((asset, i) => ({ op: 'upsert', raster_asset: asset.id,
    object: { ...nativeObject, id: `native-component-${i}`, x: 20 + i * 15, width: 12, height: 12 } }))), multipleAssets);
  check(current.ok && current.objects.filter(object => object.type === 'raster').length === 13, 'One real MCP request imports more than eight native generated assets and persists each editable raster');
  current = await tool(apply(multipleAssets.map((asset, i) => ({ op: 'delete', id: `native-component-${i}` }))));
  check(current.objects[0].width === 120 && current.objects[0].height === 120, 'Raster import fits the box height to the image aspect ratio');
  check(await evaluate('document.querySelector("#scratch-canvas [data-object-id=native-component] image").getAttribute("href").startsWith("data:image/png;base64,")'), 'Native raster paints as embedded image bytes on scratch');
  current = await tool(apply([{ op: 'transfer', id: 'native-component', canvas: 'main' },
    { op: 'update', id: 'native-component', patch: { x: 210, y: 140, width: 240, height: 160, rotation: 15 } }]));
  const nativeResult = current.objects.find(object => object.id === 'native-component');
  check(nativeResult.canvas === 'main' && nativeResult.x === 210 && nativeResult.width === 240 && nativeResult.rotation === 15
    && current.objects.find(object => object.id === 'native-label').canvas === 'main', 'Native component geometry edits independently of its label');
  await fs.unlink(nativeImagePath);
  await evaluate('location.reload()'); await pause(350);
  frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  current = await tool({ action: 'read', include_assets: true });
  check(current.objects.find(object => object.id === 'native-component').dataUrl.endsWith(nativePixels.toString('base64')), 'Native component persists after the original Codex output is deleted and plugin reloads');
  check((await tool({ action: 'render', canvas: 'both' })).content.filter(item => item.type === 'image').length === 2, 'Native component remains visible in MCP readback after reload');
  current = await tool(apply([{ op: 'delete', id: 'native-component' }, { op: 'delete', id: 'native-label' }]));
  const batch = apply([
    { op: 'upsert', object: { id: 'cell', type: 'vector', canvas: 'scratch', x: 25, y: 25, width: 160, height: 160, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#dce9e0" stroke="#587a64" stroke-width="2"/><circle cx="50" cy="50" r="17" fill="#a9c8b4" stroke="#587a64"/></svg>' } },
    { op: 'upsert', object: { id: 'label', type: 'text', text: 'Cell', x: 380, y: 350, width: 160, height: 50, align: 'middle', fontSize: 24, fontWeight: 600 } }
  ]);
  current = await tool(batch); check(current.ok && current.persisted, 'Agent edits are persisted');
  check(await evaluate('document.getElementById("scratch-workspace").hidden'), 'Editing hidden scratch artwork does not reopen it');
  check((await tool(batch)).status === 'already_applied', 'Identical retry is idempotent');
  check((await tool({ ...batch, request_id: randomUUID() })).status === 'revision_conflict', 'Stale edits are rejected');
  current = await tool(apply([{ op: 'transfer', id: 'cell', canvas: 'main', copy: true, new_id: 'cell-main' }, { op: 'update', id: 'cell-main', patch: { x: 380, y: 170 } }]));
  check(current.objects.length === 3, 'Scratch component copies independently to main');
  const bad = await tool(apply([{ op: 'upsert', object: { id: 'bad', type: 'vector', svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Forbidden</text></svg>' } }]));
  check(!bad.ok && (await tool({ action: 'read' })).revision === current.revision, 'Text-bearing SVG is rejected atomically');
  const images = await tool({ action: 'render', canvas: 'both' });
  check(images.content.filter(item => item.type === 'image').length === 2, 'MCP renders native images of both canvases');
  check(images.scratch_visible === false, 'Agent can render scratch while its panel is closed');
  check(!JSON.stringify(images.previews).includes('data_url'), 'Binary previews stay out of JSON');
  await evaluate('document.getElementById("toggle-scratch").click()');
  await waitFor(async () => (await tool({ action: 'read' })).scratch_visible, 'Manual scratch toggle did not open');
  check(await evaluate('document.getElementById("scratch-canvas").getBoundingClientRect().height>0'), 'User can summon scratch manually');
  await evaluate('document.getElementById("close-scratch").click()');
  await waitFor(async () => !(await tool({ action: 'read' })).scratch_visible, 'Manual close did not hide scratch');
  const afterClose = await tool({ action: 'read' });
  check(afterClose.revision === current.revision && afterClose.objects.some(object => object.canvas === 'scratch'), 'Closing scratch preserves its contents and revision');
  await evaluate('document.querySelector("[data-layer-id=cell] .layer-select").click()');
  await waitFor(async () => (await tool({ action: 'read' })).scratch_visible, 'Scratch layer selection did not open its canvas');
  check(await evaluate('document.querySelector("button[data-canvas=scratch]").getAttribute("aria-pressed")==="true"'), 'Selecting a scratch layer opens its editable canvas');
  await evaluate('document.getElementById("close-scratch").click()');
  await waitFor(async () => !(await tool({ action: 'read' })).scratch_visible, 'Close after selection did not hide scratch');
  check(await evaluate('document.querySelector("button[data-canvas=main]").getAttribute("aria-pressed")==="true" && document.getElementById("properties").hidden'), 'Closing scratch returns manual editing to main');
  await win.webContents.executeJavaScript('document.querySelector("iframe").hidden=true');
  check((await tool({ action: 'render' })).content.filter(item => item.type === 'image').length === 2, 'Agent sees hidden canvases');
  await win.webContents.executeJavaScript('document.querySelector("iframe").hidden=false');
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  check(await evaluate('document.getElementById("prompt-form").hidden && document.getElementById("prompt-form").getBoundingClientRect().height===0'), 'A populated illustration has no bottom composer even with chat folded');
  const promptSceneObjects = current.objects;
  current = await tool(apply(current.objects.map(object => ({ op: 'delete', id: object.id }))));
  await waitFor(async () => await evaluate('!document.getElementById("prompt-form").hidden'), 'Removing all components did not restore the starting composer');
  const userPrompts = [
    'Draw a cell with separate labels',
    'Draw a cell.\nUse the title "Cell cycle" and separate SVG arrows.',
    'Draw a cell with separate labels. '.padEnd(2300, 'x')
  ];
  for (const [index, complexity] of ['simple', 'standard', 'detailed'].entries()) {
    await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
    await waitFor(async () => await evaluate('!document.getElementById("prompt-form").hidden'), 'Closed chat did not restore compact canvas composer');
    const imagePercent = [0, 50, 100][index];
    await evaluate(`document.getElementById("complexity").value=${JSON.stringify(complexity)};document.getElementById("complexity").dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("image-generation-enabled").checked=true;document.getElementById("image-generation-percent").value=${JSON.stringify(String(imagePercent))};document.getElementById("image-generation-percent").dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("prompt").value=${JSON.stringify(userPrompts[index])};document.getElementById("prompt-form").requestSubmit()`);
    await waitFor(async () => await win.webContents.executeJavaScript(`qaRequests.length===${index + 1}`), 'Complexity prompt did not reach the agent');
    await waitFor(async () => await evaluate('!document.getElementById("generate").disabled'), 'Prompt submission did not finish');
    await pause(100);
    current = await tool({ action: 'read' });
    const label = complexity[0].toUpperCase() + complexity.slice(1);
    check(current.complexity === complexity && current.agent_contract.instructions.includes(`Complexity: ${label}.`), `${complexity} complexity saves before Send and exposes matching instructions on read`);
    check(current.imageGenerationPercent === imagePercent && current.agent_contract.instructions.includes(`Image generation target: ${imagePercent}%`), `${imagePercent}% target selected immediately before Send saves and reaches the agent's read contract`);
    check(await win.webContents.executeJavaScript(`qaRequests[${index}].message===${JSON.stringify(userPrompts[index])}
      &&qaRequests[${index}].conversation.filter(message=>message.role==="user").at(-1).text===${JSON.stringify(userPrompts[index])}
      &&qaScopedState.agentChat.messages.filter(message=>message.role==="user").at(-1).text===${JSON.stringify(userPrompts[index])}
      &&document.querySelectorAll('#agent-rail-chat-history .agent-chat-item-user .agent-chat-body')[${index}].textContent===${JSON.stringify(userPrompts[index])}`), `${complexity} sends, persists and displays only the user's prompt, including newlines and maximum length`);
    check(await win.webContents.executeJavaScript(`qaRequests[${index}].agent.sessionPrompt.includes('plugin-owned contract')
      &&qaRequests[${index}].agent.sessionPrompt.includes(${JSON.stringify(`"illustration_id":"${current.illustration_id}"`)})`), `${complexity} keeps the canvas target and contract discovery in separate agent context`);
  }
  check(await win.webContents.executeJavaScript(`qaRailOpened && qaRequests[0].message===${JSON.stringify(userPrompts[0])} && qaRequests[0].agent.sessionPrompt.includes("plugin-owned contract")`), 'User prompt and separate plugin scope reach the real chat request builder');
  check(await win.webContents.executeJavaScript('qaRequests[0].agent.pluginCanvasId==="scientific-illustration"'), 'Plugin chat carries structured canvas scope for completion enforcement');
  check(await win.webContents.executeJavaScript(`qaState.paperAgentChatSessions[${JSON.stringify(`plugin:scientific-illustration:item:${current.illustration_id}`)}].messages.some(message=>message.role==="assistant" && message.text==="Fixture response")`), 'Fixture model response is saved in the illustration chat');
  check(await win.webContents.executeJavaScript(`qaRequests.every(request=>request.chatSessionId===qaRequests[0].chatSessionId && request.agent.pluginCanvasIllustrationId===${JSON.stringify(current.illustration_id)})`), 'Same figure reuses only its own saved session and pins its canvas target');
  check(await win.webContents.executeJavaScript('document.getElementById("agent-rail-quick-prompts").hidden && [...document.querySelectorAll("[data-agent-suggest-prompt]")].every(button=>button.hidden)'), 'Figura hides all prefilled prompt suggestions');
  await waitFor(async () => await evaluate('document.getElementById("prompt-form").hidden'), 'Opening the host rail did not hide the redundant prompt');
  check(await evaluate('document.getElementById("prompt-form").getBoundingClientRect().height===0 && document.querySelector(".toolbar #complexity").getBoundingClientRect().height>0 && document.getElementById("prompt").value===""'), 'Open rail removes the canvas prompt and keeps complexity in the toolbar; accepted prompts clear');
  check((await evaluate('HikariPlugin.hikari.call("app.info")')).layout.agentChatRail.expanded, 'Plugin can read the actual host rail expansion state');
  await fs.writeFile(path.join(temp, 'chat-open-canvas.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await waitFor(async () => await evaluate('!document.getElementById("prompt-form").hidden'), 'Folded chat did not restore the canvas prompt');
  const closedCanvasHeight = await evaluate('document.querySelector(".main-stage-wrap").getBoundingClientRect().height');
  check(await evaluate('document.getElementById("prompt-form").getBoundingClientRect().height<54 && !document.getElementById("complexity").closest("#prompt-form")'), 'Closed chat uses a single compact prompt row with complexity kept outside');
  await evaluate('document.getElementById("prompt").value="Unsent canvas idea"');
  await win.webContents.executeJavaScript('qaRailRuntime.open()');
  await waitFor(async () => await evaluate('document.getElementById("prompt-form").hidden'), 'Reopened chat did not hide the canvas prompt');
  check(await evaluate(`document.querySelector(".main-stage-wrap").getBoundingClientRect().height>${closedCanvasHeight}+30`), 'Hiding the extra composer gives its height back to the canvas');
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await waitFor(async () => await evaluate('!document.getElementById("prompt-form").hidden'), 'Closing chat did not restore the unsent draft');
  check(await evaluate('document.getElementById("prompt").value==="Unsent canvas idea"'), 'Toggling chat preserves an unsent canvas draft');
  await evaluate('document.getElementById("prompt").value=""');
  current = await tool(apply(promptSceneObjects.map(object => ({ op: 'upsert', object }))));
  check(await evaluate('document.getElementById("prompt-form").hidden'), 'Adding components hides the starting composer without a host layout event');
  await evaluate('illustrationWorkspace.history("undo")');
  await waitFor(async () => await evaluate('!document.getElementById("prompt-form").hidden'), 'Undo to an empty illustration did not restore the starting composer');
  await evaluate('illustrationWorkspace.history("redo")');
  await waitFor(async () => await evaluate('document.getElementById("prompt-form").hidden'), 'Redo to a populated illustration did not hide the starting composer');
  current = await tool({ action: 'read' });
  current = await tool(apply(current.objects.filter(object => object.canvas === 'main').map(object => ({ op: 'delete', id: object.id }))));
  check(current.objects.length===1 && current.objects[0].canvas==='scratch' && await evaluate('document.getElementById("prompt-form").hidden && document.getElementById("scratch-workspace").hidden'), 'Hidden scratch components also keep the illustration composer closed');
  current = await tool(apply(promptSceneObjects.filter(object => object.canvas === 'main').map(object => ({ op: 'upsert', object }))));
  await win.webContents.executeJavaScript('qaRailRuntime.open()');
  await waitFor(async () => (await evaluate('HikariPlugin.hikari.call("app.info")')).layout.agentChatRail.expanded, 'Chat rail did not open for an existing illustration');
  const beforeRailEdit = await win.webContents.executeJavaScript('qaRequests.length');
  check((await win.webContents.executeJavaScript('qaRail.submitExternalMessage("Move the existing cell slightly right",{waitForCompletion:true})')).ok, 'Existing illustration accepts an edit through its agent rail');
  check(await win.webContents.executeJavaScript(`qaRequests.length===${beforeRailEdit+1} && qaRequests.at(-1).agent.pluginCanvasIllustrationId===${JSON.stringify(current.illustration_id)}`), 'Rail edit retains the correct illustration scope');
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await pause(80);
  check(await evaluate('document.getElementById("prompt-form").hidden'), 'Folding chat after an existing-figure edit does not restore the bottom composer');
  await win.webContents.executeJavaScript('window.failSave=true');
  check(!(await tool(apply([{ op: 'title', title: 'Unsaved' }]))).ok, 'Disk failures are reported');
  await win.webContents.executeJavaScript('window.failSave=false');
  check((await tool({ action: 'read' })).revision === current.revision, 'Disk failure preserves the prior figure');
  await evaluate('document.querySelector("[data-layer-id=label] .layer-select").click();const input=document.querySelector("#properties [name=fontSize]");input.value="36";input.dispatchEvent(new Event("change",{bubbles:true}))');
  current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'label').fontSize === 36, 'User controls and agent share editable text objects');
  check(await evaluate('!document.getElementById("text-properties").hidden && document.getElementById("vector-properties").hidden && !document.querySelector(".geometry-options").open'), 'Selected text shows formatting before optional geometry');
  check(await win.webContents.executeJavaScript('(()=>{const history=qaBridge.getFrameHistory(document.querySelector("iframe.plugin-frame").contentWindow);return history.canUndo && !history.canRedo})()'), 'Plugin API reports available edits to system history');
  for (const style of ['bold', 'italic', 'underline']) {
    await evaluate(`document.querySelector('[data-text-style="${style}"]').click()`);
    current = await tool({ action: 'read' });
  }
  await evaluate('document.querySelector("[data-align=end]").click()');
  current = await tool({ action: 'read' });
  const formatted = current.objects.find(object => object.id === 'label');
  check(formatted.fontWeight === 700 && formatted.italic && formatted.underline && formatted.align === 'end', 'Compact text formatting updates independent layer properties');
  await evaluate('illustrationWorkspace.history("undo")');
  current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'label').align === 'middle' && await win.webContents.executeJavaScript('qaBridge.getFrameHistory(document.querySelector("iframe.plugin-frame").contentWindow).canRedo'), 'Undo restores formatting and reports redo to Hikari');
  await evaluate('illustrationWorkspace.history("redo")');
  current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'label').align === 'end', 'Redo restores formatting');
  current = await tool(apply([{ op: 'update', id: 'label', patch: { fontWeight: 600, italic: false, underline: false, align: 'middle' } }]));
  await evaluate('document.querySelector("[data-layer-id=label] .layer-visibility").focus();document.querySelector("[data-layer-id=label] .layer-visibility").click()');
  current = await tool({ action: 'read' });
  check(!current.objects.find(object => object.id === 'label').visible && await evaluate('!document.querySelector("#main-canvas [data-object-id=label]") && document.activeElement.dataset.layerAction==="visibility"'), 'Layer visibility hides canvas artwork and preserves keyboard focus');
  await evaluate('document.querySelector("[data-layer-id=label] .layer-visibility").click()');
  current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'label').visible, 'Hidden layers remain selectable and can be shown');
  await evaluate('document.querySelector("[data-layer-id=cell-main] .layer-select").click();const fill=document.querySelector("#properties [name=fill]");fill.value="#ff0000";fill.dispatchEvent(new Event("change",{bubbles:true}))');
  current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'cell-main').fill === '#ff0000', 'Vector color override updates artwork');
  await evaluate('(()=>{const fill=document.querySelector("#properties [name=fill]");fill.value="";fill.dispatchEvent(new Event("change",{bubbles:true}))})()');
  current = await tool({ action: 'read' });
  check(!Object.hasOwn(current.objects.find(object => object.id === 'cell-main'), 'fill') && await evaluate('document.querySelector("#main-canvas [data-object-id=cell-main] circle").getAttribute("fill")==="#dce9e0"'), 'Clearing a vector override restores its original colors');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  check(await evaluate('document.getElementById("properties").hidden'), 'Escape clears the current selection');
  await evaluate('document.querySelector("#main-canvas [data-object-id=label]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
  check(await evaluate('document.activeElement.id==="label-content" && document.getElementById("label-content").selectionEnd===4'), 'Double-clicking text opens its separate editable label');
  await evaluate('document.getElementById("export-menu").open=true'); await pause(40);
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  check(await evaluate('!document.getElementById("export-menu").open && document.activeElement===document.querySelector("#export-menu summary")'), 'Escape closes menus and restores trigger focus');
  await evaluate('document.querySelector("[data-layer-id=cell-main] .layer-select").click()');
  await pause(100);
  const beforeDrag = current.objects.find(object => object.id === 'cell-main');
  const hit = await evaluate('(()=>{const r=document.querySelector("#main-canvas [data-object-id=cell-main]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, x, y, buttons = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(30);
  };
  await evaluate('window.qaPointers=[];for(const type of ["pointerdown","pointermove","pointerup"])document.addEventListener(type,event=>qaPointers.push({type,id:event.target.closest("[data-object-id]")?.dataset.objectId,x:event.clientX,y:event.clientY}),true)');
  await mouse('mouseMoved', hit.x, hit.y);
  await mouse('mousePressed', hit.x, hit.y, 1);
  await mouse('mouseMoved', hit.x + 24, hit.y + 18, 1);
  await mouse('mouseReleased', hit.x + 24, hit.y + 18);
  await pause(80); current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'cell-main').x > beforeDrag.x, `Canvas drag moves the component at the fitted scale: ${JSON.stringify({ hit, beforeDrag, after: current.objects.find(object => object.id === 'cell-main'), events: await evaluate('qaPointers'), status: await evaluate('document.getElementById("status").textContent') })}`);
  const handle = await evaluate('(()=>{const r=document.querySelector("#main-canvas [data-resize-direction=se]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:r.width}})()');
  check(Math.abs(handle.width - 9) < 0.2, 'Resize handle keeps a usable screen size at canvas scale');
  await mouse('mousePressed', handle.x, handle.y, 1);
  await mouse('mouseMoved', handle.x + 24, handle.y + 18, 1);
  await mouse('mouseReleased', handle.x + 24, handle.y + 18);
  win.webContents.debugger.detach();
  await pause(80); current = await tool({ action: 'read' });
  check(current.objects.find(object => object.id === 'cell-main').width > beforeDrag.width, 'Resize gesture changes the selected component');
  current = await tool(apply([{ op: 'update', id: 'cell-main', patch: { x: beforeDrag.x, y: beforeDrag.y, width: beforeDrag.width, height: beforeDrag.height } }]));
  current = await tool(apply([{ op: 'title', title: 'Cell signaling' }]));
  const originalId = current.illustration_id;
  const originalChatSession = await win.webContents.executeJavaScript('qaScopedState.agentChat.currentSessionId');
  const originalReplyCount = await win.webContents.executeJavaScript('qaScopedState.agentChat.messages.filter(message=>message.role==="assistant").length');
  await win.webContents.executeJavaScript('document.getElementById("agent-rail-message-input").value="Unsent figure-specific change"');
  await scratch(true);
  const revision = current.revision; await evaluate('location.reload()'); await pause(350);
  frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  check((await tool({ action: 'read' })).revision === revision, 'Reload preserves the document');
  check((await tool({ action: 'read' })).scratch_visible === false && await evaluate('document.getElementById("scratch-workspace").hidden'), 'Reload hides scratch even when it contains saved components');
  const pluginStorage = path.join(storage, 'Plugins/scientific-illustration');
  const index = JSON.parse(await fs.readFile(path.join(pluginStorage, 'library.json'), 'utf8'));
  const saved = JSON.parse(await fs.readFile(path.join(pluginStorage, index.illustrations.find(item => item.id === originalId).path), 'utf8'));
  check(saved.revision === revision, 'Scene is saved in the plugin file namespace');
  check(await evaluate('document.querySelector(".illustration-row.is-active").textContent==="Cell signaling"'), 'Illustration rail reflects the current title');
  await evaluate('document.getElementById("duplicate-illustration").click()');
  await waitFor(async () => (await tool({ action: 'list' })).illustrations.length === 2, 'Duplicate illustration did not save');
  current = await tool({ action: 'read' });
  check(current.illustration_id !== originalId && current.objects.length === 3 && current.title === 'Cell signaling copy', 'UI duplicates independent scenes');
  await waitFor(async () => await win.webContents.executeJavaScript(`qaScopedState.agentChatContext.pluginContextId===${JSON.stringify(current.illustration_id)}`), 'Chat did not follow duplicate selection');
  check(await win.webContents.executeJavaScript('qaScopedState.agentChat.messages.length===0 && !qaScopedState.agentChat.currentSessionId && !document.getElementById("agent-rail-message-input").value'), 'Duplicated figures start with empty independent chats and drafts');
  await evaluate('document.getElementById("new-illustration").click()');
  await waitFor(async () => (await tool({ action: 'list' })).illustrations.length === 3, 'New illustration did not save');
  current = await tool({ action: 'read' });
  check(current.objects.length === 0, 'New illustration starts with two empty canvases');
  check(await evaluate('!document.getElementById("prompt-form").hidden'), 'Switching to a new empty illustration restores its starting composer');
  const freshFigureId = current.illustration_id;
  check(await win.webContents.executeJavaScript('qaScopedState.agentChat.messages.length===0 && !qaScopedState.agentChat.currentSessionId'), 'New illustrations also start with empty chats');
  const beforeDelayedCreate = await win.webContents.executeJavaScript('qaRequests.length');
  await win.webContents.executeJavaScript('window.qaDelaySession=true;void qaRail.submitExternalMessage("Draw this new figure").then(result=>window.qaDelayedSubmit=result)');
  await waitFor(async () => await win.webContents.executeJavaScript('Boolean(window.qaReleaseSession)'), 'Session creation did not enter delayed fixture');
  let pendingSelection = await tool({ action: 'list' });
  await tool({ action: 'open', illustration_id: originalId, expected_library_revision: pendingSelection.library_revision, request_id: randomUUID() });
  await waitFor(async () => await win.webContents.executeJavaScript(`qaScopedState.agentChatContext.pluginContextId===${JSON.stringify(originalId)}`), 'Selection did not change during session creation');
  check(await evaluate('document.getElementById("prompt-form").hidden'), 'Switching back to an existing illustration hides the starting composer');
  await win.webContents.executeJavaScript('window.qaDelaySession=false;window.qaReleaseSession()');
  await waitFor(async () => await win.webContents.executeJavaScript('Boolean(window.qaDelayedSubmit)'), 'Delayed submission did not settle');
  check(await win.webContents.executeJavaScript(`!qaDelayedSubmit.ok && qaRequests.length===${beforeDelayedCreate} && qaScopedState.agentChat.currentSessionId===${JSON.stringify(originalChatSession)} && qaScopedState.agentChat.messages.filter(message=>message.role==="assistant").length===${originalReplyCount}`), 'Switching during session creation cannot submit against or overwrite another figure');
  pendingSelection = await tool({ action: 'list' });
  current = await tool({ action: 'open', illustration_id: freshFigureId, expected_library_revision: pendingSelection.library_revision, request_id: randomUUID() });
  await waitFor(async () => await win.webContents.executeJavaScript(`qaScopedState.agentChatContext.pluginContextId===${JSON.stringify(freshFigureId)}`), 'Selection did not return to new figure');
  await win.webContents.executeJavaScript('document.getElementById("agent-rail-message-input").value=""');
  check((await win.webContents.executeJavaScript('qaRail.submitExternalMessage("Draw a different figure",{waitForCompletion:true})')).ok, 'New figure accepts its own completed conversation');
  const freshChatSession = await win.webContents.executeJavaScript('qaScopedState.agentChat.currentSessionId');
  check(await win.webContents.executeJavaScript(`qaScopedState.agentChat.currentSessionId!==${JSON.stringify(originalChatSession)} && qaRequests.at(-1).conversation.length===1 && qaRequests.at(-1).conversation[0].text==="Draw a different figure" && qaScopedState.agentChat.messages.length===2`), 'The second figure uses a distinct saved session and sends only its own history');
  check((await tool({ action: 'read', illustration_id: originalId })).status === 'illustration_changed', 'Agent requests cannot target the wrong selected illustration');
  check((await tool({ action: 'scratch', illustration_id: originalId, visible: true })).status === 'illustration_changed', 'Scratch summons also guard against changed illustration selection');
  await evaluate('document.getElementById("illustration-search").value="SIGNALING";document.getElementById("illustration-search").dispatchEvent(new Event("input"))');
  check(await evaluate('document.querySelectorAll(".illustration-row").length===2'), 'Rail searches illustration titles without case sensitivity');
  await evaluate(`document.querySelector('[data-illustration-id="${originalId}"]').click()`);
  await waitFor(async () => (await tool({ action: 'list' })).active_illustration_id === originalId, 'Rail selection did not open');
  current = await tool({ action: 'read' });
  check(current.revision === revision && current.objects.length === 3, 'Selecting an illustration restores its own editable objects');
  await waitFor(async () => await win.webContents.executeJavaScript(`qaScopedState.agentChatContext.pluginContextId===${JSON.stringify(originalId)}`), 'Chat did not follow original figure');
  check(await win.webContents.executeJavaScript(`qaScopedState.agentChat.currentSessionId===${JSON.stringify(originalChatSession)} && qaScopedState.agentChat.messages.filter(message=>message.role==="assistant").length===${originalReplyCount} && document.getElementById("agent-rail-message-input").value==="Unsent figure-specific change"`), 'Returning to the figure restores its own history, Codex session and draft');
  await win.webContents.executeJavaScript('document.getElementById("agent-rail-message-input").value="";window.qaDelayReply=true');
  check((await win.webContents.executeJavaScript('qaRail.submitExternalMessage("Add an arrow to this figure")')).ok, 'A figure-specific delayed request is accepted');
  await waitFor(async () => await win.webContents.executeJavaScript('Boolean(window.qaReleaseReply)'), 'Delayed agent reply did not start');
  let selection = await tool({ action: 'list' });
  await tool({ action: 'open', illustration_id: freshFigureId, expected_library_revision: selection.library_revision, request_id: randomUUID() });
  await waitFor(async () => await win.webContents.executeJavaScript(`qaScopedState.agentChatContext.pluginContextId===${JSON.stringify(freshFigureId)}`), 'Chat did not switch during request');
  await win.webContents.executeJavaScript('window.qaDelayReply=false;window.qaReleaseReply()');
  await pause(100);
  check(await win.webContents.executeJavaScript(`qaScopedState.agentChat.currentSessionId===${JSON.stringify(freshChatSession)} && qaScopedState.agentChat.messages.length===2 && qaScopedState.agentChat.sessions.length===1 && qaState.paperAgentChatSessions[${JSON.stringify(`plugin:scientific-illustration:item:${originalId}`)}].messages.filter(message=>message.role==="assistant").length===${originalReplyCount+1}`), 'A late response stays with its originating figure and does not import shared session lists');
  check(await win.webContents.executeJavaScript('!document.getElementById("agent-rail-send-btn").disabled'), 'A running request in another figure does not lock the new chat');
  selection = await tool({ action: 'list' });
  current = await tool({ action: 'open', illustration_id: originalId, expected_library_revision: selection.library_revision, request_id: randomUUID() });
  const libraryState = await tool({ action: 'list' });
  const created = await tool({ action: 'create', title: 'Agent figure', expected_library_revision: libraryState.library_revision, request_id: randomUUID() });
  check(created.ok && created.illustrations.length === 4, 'MCP creates saved illustrations through the plugin contract');
  current = await tool({ action: 'open', illustration_id: originalId, expected_library_revision: created.library_revision, request_id: randomUUID() });
  check(current.ok && current.illustration_id === originalId, 'MCP opens saved illustrations');
  await win.webContents.executeJavaScript('window.failIndex=true');
  const failedCommit = await tool(apply([{ op: 'title', title: 'Failed index' }]));
  check(!failedCommit.ok, 'A failed library index commit is reported');
  await win.webContents.executeJavaScript('window.failIndex=false');
  await evaluate('location.reload()'); await pause(350);
  frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  current = await tool({ action: 'read' });
  check(current.revision === revision && current.title === 'Cell signaling' && current.illustrations.length === 4, 'Reload after an index failure keeps the committed scene and library');
  check(current.complexity === 'detailed' && await evaluate('document.getElementById("complexity").value==="detailed"'), 'Saved complexity restores in the composer after reload');
  await evaluate('document.fonts.ready.then(()=>true)');
  const day = await evaluate('({background:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,size:getComputedStyle(document.body).fontSize,rail:document.querySelector(".illustrations-rail").getBoundingClientRect().width})');
  check(day.background === 'rgb(252, 251, 248)' && day.font.startsWith('Inter') && day.size === '13px' && day.rail === 280, 'Day palette, typography and rail geometry match Hikari');
  check(await evaluate('[...document.querySelectorAll(".canvas-stage")].every(stage=>getComputedStyle(stage).backgroundColor==="rgba(0, 0, 0, 0)")'), 'Main and scratch have no separate canvas backdrop in day mode');
  const apiLayout = await evaluate('HikariPlugin.hikari.call("app.setLeftRailWidth",{width:320})');
  await pause(100);
  check(apiLayout.leftRail.width === 320 && await evaluate('document.querySelector(".illustrations-rail").getBoundingClientRect().width===320'), 'Existing layout API updates the plugin rail');
  check(await win.webContents.executeJavaScript('localStorage.getItem("hikari_shared_left_rail_width_v2")==="320"'), 'Rail resizing persists in the host shared layout');
  await evaluate('document.querySelector(".app-left-rail-handle").dispatchEvent(new PointerEvent("pointerdown",{clientX:320,bubbles:true}));document.dispatchEvent(new PointerEvent("pointermove",{clientX:300}));document.dispatchEvent(new PointerEvent("pointerup"))');
  await waitFor(async () => await win.webContents.executeJavaScript('localStorage.getItem("hikari_shared_left_rail_width_v2")==="300"'), 'Divider gesture did not persist');
  check(await evaluate('document.querySelector(".illustrations-rail").getBoundingClientRect().width===300'), 'Rail divider gesture commits through the existing public API');
  await evaluate('HikariPlugin.hikari.call("app.setLeftRailWidth",{width:280})');
  await verifyRailFolding({ tool, evaluate, check, win, pause, temp, reloadPlugin: async () => {
    await evaluate('location.reload()'); await pause(350);
    frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
    await evaluate('illustrationWorkspace.ready.then(()=>true)');
  } });
  await verifyCanvasLayout({ tool, evaluate, check, win, pause, temp });
  await evaluate('document.querySelector("[data-layer-id=label] .layer-select").click()');
  await pause(100);
  await fs.writeFile(path.join(temp, 'day.png'), (await win.webContents.capturePage()).toPNG());
  await scratch(true); await pause(80);
  await fs.writeFile(path.join(temp, 'scratch.png'), (await win.webContents.capturePage()).toPNG());
  await scratch(false);
  await win.webContents.executeJavaScript('qaState.settings.appearance={mode:"night",fontSize:20};qaBridge.broadcastAppContext("appearance")');
  await pause(100);
  const night = await evaluate('({background:getComputedStyle(document.body).backgroundColor,size:getComputedStyle(document.body).fontSize,night:document.body.classList.contains("theme-night")})');
  check(night.background === 'rgb(19, 20, 23)' && night.size === '16.25px' && night.night, 'Appearance events update night mode and host font scale');
  check(await evaluate('[...document.querySelectorAll(".canvas-stage")].every(stage=>getComputedStyle(stage).backgroundColor==="rgba(0, 0, 0, 0)")'), 'Main and scratch have no separate canvas backdrop in night mode');
  await fs.writeFile(path.join(temp, 'night.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript('qaState.settings.appearance={mode:"day",fontSize:16};qaBridge.broadcastAppContext("appearance")');
  win.setSize(480, 800); await pause(80);
  await fs.writeFile(path.join(temp, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  const narrow = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].filter(node=>node.getBoundingClientRect().right>innerWidth).slice(0,15).map(node=>({tag:node.tagName,id:node.id,cls:node.getAttribute("class"),right:node.getBoundingClientRect().right}))})');
  check(narrow.scroll <= narrow.width, `Narrow layout fits: ${JSON.stringify(narrow)}`);
  check(await evaluate('document.querySelector(".illustrations-rail").getBoundingClientRect().bottom<=document.querySelector(".workspace").getBoundingClientRect().top'), 'Narrow layout keeps the illustration list above the editor');
  win.setSize(320, 800); await pause(100);
  for (const expanded of [false, true]) {
    await win.webContents.executeJavaScript(`qaRailRuntime.setExpanded(${expanded})`); await pause(50);
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth && document.getElementById("complexity").getBoundingClientRect().right<=innerWidth && document.getElementById("prompt-form").hidden'), `320px populated layout keeps controls in bounds without a bottom composer with chat ${expanded ? 'open' : 'closed'}`);
  }
  await fs.writeFile(path.join(temp, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
  await verifyCanvasInteraction({ tool, evaluate, check, win, pause, temp });
  await verifyTextResize({ tool, evaluate, check, win, pause, temp });
  await verifyTextBounds({ tool, evaluate, check, win, pause, temp });
  await verifyGrouping({ tool, evaluate, check, win, pause, temp });
  await verifyPlacement({ tool, evaluate, check, win, pause, temp });
  const review = { layout: 'Inspected both previews for clipping and overlap.', labels: 'Text stays separate and legible.',
    artwork: 'Vector and raster artwork are text-free.', science: 'This fixture has no scientific mechanism to verify.' };
  current = await tool({ action: 'read' });
  const inspect = (render, extra = {}) => tool({ action: 'inspect', illustration_id: current.illustration_id,
    expected_revision: render.revision, inspection_id: render.inspection?.inspection_id || 'missing', review, ...extra });
  check(current.inspection.required && !current.inspection.complete, 'Inspection is required and incomplete on the current scene');
  check(!(await inspect(current)).ok, 'An agent cannot inspect without a render receipt');
  const mainOnly = await tool({ action: 'render', canvas: 'main' });
  check(!mainOnly.inspection.inspection_id, 'Main-only readback does not satisfy the both-canvas requirement');
  const reviewedImages = await tool({ action: 'render', canvas: 'both' });
  check(reviewedImages.content.filter(item => item.type === 'image').length === 2 && !reviewedImages.inspection.complete, 'Inspection images are delivered but render alone is insufficient');
  check(!(await inspect(reviewedImages, { review: { ...review, science: '' } })).ok, 'Review requires every observation field');
  check((await inspect(reviewedImages)).inspection.complete, 'Agent review completes the inspection for that revision');
  current = await tool(apply([{ op: 'title', title: 'Changed after inspection' }]));
  check(!(await inspect(reviewedImages)).ok && !(await tool({ action: 'inspection_status' })).inspection.complete, 'An edit invalidates the prior inspection');
  await evaluate('illustrationWorkspace.history("undo")'); current = await tool({ action: 'read' });
  check(!current.inspection.complete, 'Undo still requires a fresh inspection');
  const beforeReload = await tool({ action: 'render', canvas: 'both' }); await inspect(beforeReload);
  await evaluate('location.reload()'); await pause(350);
  frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  check(!(await inspect(beforeReload)).ok, 'Reload cannot reuse an old render receipt');

  let modelCalls = 0;
  const neverInspects = createCodexAgentRuntime({ requestPluginCanvas: service.requestPluginCanvas,
    requestCodexAgentText: async args => {
      modelCalls += 1; Object.assign(mcpEnv, args.envOverrides);
      return { text: 'Done without inspection.', metadata: { session_id: 'fixture-session' } };
    } });
  const agentInput = { message: 'Update the illustration', agent: { pluginCanvasId: 'scientific-illustration' } };
  const blocked = await neverInspects.run(agentInput);
  check(blocked.ok === false && blocked.status === 'inspection_required' && modelCalls === 2, 'Real canvas state blocks agent completion after one failed follow-up');
  modelCalls = 0;
  const doesInspect = createCodexAgentRuntime({ requestPluginCanvas: service.requestPluginCanvas,
    requestCodexAgentText: async args => {
      modelCalls += 1; Object.assign(mcpEnv, args.envOverrides);
      current = await tool({ action: 'read' });
      await tool({ action: 'asset_list' });
      if (modelCalls === 1) await tool(apply([{ op: 'title', title: 'Mandatory inspection fixture' }]));
      else {
        const result = await inspect(await tool({ action: 'render', canvas: 'both' }));
        check(result.ok, 'Inspection receipt crosses the actual MCP and frame bridges in the same agent run');
      }
      return { text: 'Inspected the illustration.', metadata: { session_id: 'fixture-session' } };
    } });
  const accepted = await doesInspect.run(agentInput);
  check(accepted.ok && modelCalls === 2, 'Completion succeeds only after the follow-up inspection reaches the canvas');
  delete mcpEnv.HIKARI_CODEX_REQUEST_CONTEXT;
  await verifyReusableAssets({ tool, evaluate, check, win, pause, temp });
  await verifyAreaSelection({ tool, evaluate, check, win, pause, temp });
  check(errors.length === 0, errors.join('\n'));
  console.log(`Figura host: ${checks} checks passed. Runtime: ${runtime}. Screenshots: ${temp}`);
}
const timeout = setTimeout(() => { console.error('Plugin test timed out'); app.exit(1); }, 120000);
run().then(() => 0, error => { console.error(error.stack || error); return 1; }).then(async code => {
  clearTimeout(timeout); await client?.close(); await server?.close(); await service?.stop(); win?.destroy(); await registry?.closeAll(); app.exit(code);
});
