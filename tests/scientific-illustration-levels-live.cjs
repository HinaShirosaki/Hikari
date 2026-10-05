// Opt-in live percentage and complex hybrid QA. Real signed-in Codex; private
// installed-plugin profile, scoped chat, native image generation, MCP and inspection.
// node node_modules/electron/cli.js tests/scientific-illustration-levels-live.cjs --live
// --case=<id> reruns a single case; --model=<id> never silently substitutes.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
if (!process.argv.includes('--live')) { console.log('Live illustration level QA requires --live.'); app.exit(0); }
const repo = path.resolve(__dirname, '..');
const runtime = path.resolve(process.env.HIKARI_PLUGIN_QA_ROOT || repo);
const { AGENT, STORAGE } = require(path.join(runtime, 'src/shared/ipc/channels.js'));
const { registerPluginIpc } = require(path.join(runtime, 'src/main/ipc/register-plugin-ipc.js'));
const { createMainMcpService } = require(path.join(runtime, 'src/main/core/services/create-mcp-service.js'));
const { createAgentMcpHost } = require(path.join(runtime, 'src/main/agent/mcp-contract/host.js'));
const { createCodexAgentRuntime } = require(path.join(runtime, 'src/main/agent/codex-agent/runtime.js'));
const { requestCodexCliText } = require(path.join(runtime, 'src/main/lib/codex-cli-provider.js'));
const { prepareCodexRuntime } = require(path.join(runtime, 'src/main/lib/codex-cli-provider/runtime-gateway.js'));
const { requestCodexCliCatalog } = require(path.join(runtime, 'src/main/lib/codex-cli-provider/catalog.js'));
const { HIKARI_MCP_TOOL_NAMES } = require(path.join(runtime, 'src/main/agent/mcp-contract/instructions.js'));
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'illustration-edit-live-'));
const cases = require('./scientific-illustration-level-cases.cjs');
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
const selected = selectedCase ? cases.filter(item => item.id === selectedCase) : cases;
if (!selected.length) throw new Error('Unknown --case');
const output = path.join(repo, 'artifacts', `scientific-illustration-levels-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const home = path.join(temp, 'codex-home');
const model = process.argv.find(arg => arg.startsWith('--model='))?.slice(8) || 'gpt-6.1-sol';
app.setPath('userData', path.join(temp, 'profile')); app.setPath('sessionData', path.join(temp, 'session'));
app.on('window-all-closed', () => {});
const evidence = { started_at: new Date().toISOString(), runtime, model, temp, cases: selected, runs: [], calls: [], checks: [] };
let win, frame, service, registry, agent, activeRun, targetId;
const codexSessions = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = () => fs.writeFile(path.join(output, 'evaluation.json'), JSON.stringify(evidence, null, 2));
const check = (condition, description) => { assert.ok(condition, description); evidence.checks.push(description); };
const canvas = (request, inspectionRunId = '') => service.requestPluginCanvas({ plugin_id: 'scientific-illustration', request, inspectionRunId });
const evaluate = code => frame.executeJavaScript(code);
async function waitFor(predicate, description, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(100); }
  throw new Error(description);
}
function recordCall(origin, args, result) {
  const request = args.request || {};
  const item = { run: activeRun?.id, origin, request,
    ok: result.ok, status: result.status, revision: result.revision,
    illustration_id: result.illustration_id, imported_assets: Object.keys(args.assets || {}), inspection_id: result.inspection_id,
    inspection: result.inspection, error: result.error };
  evidence.calls.push(item);
  console.log(JSON.stringify({ run: item.run, origin, action: request.action, ok: item.ok, status: item.status }));
}
async function snapshot(name, inspectionRunId = '') {
  const read = await canvas({ action: 'read', illustration_id: targetId, include_assets: true }, inspectionRunId);
  const render = await canvas({ action: 'render', illustration_id: targetId, canvas: 'both' });
  assert.ok(read.ok && render.ok, 'Snapshot read/render failed');
  for (const preview of render.previews || []) {
    const data = preview.data_url || preview.dataUrl;
    if (data) await fs.writeFile(path.join(output, `${name}-${preview.canvas}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  for (const object of read.objects.filter(item => item.type === 'raster')) {
    const extension = object.dataUrl.startsWith('data:image/jpeg;') ? 'jpg' : object.dataUrl.startsWith('data:image/webp;') ? 'webp' : 'png';
    await fs.writeFile(path.join(output, `${name}-${object.id}.${extension}`), Buffer.from(object.dataUrl.split(',')[1], 'base64'));
  }
  const document = { ...read, objects: read.objects.map(({ dataUrl, ...object }) => ({ ...object, ...(dataUrl ? { assetBytes: Buffer.byteLength(dataUrl.split(',')[1], 'base64') } : {}) })) };
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(document, null, 2));
  return read;
}
async function submit(id, prompt) {
  activeRun = { id, prompt, source: 'starter-prompt', started_at: new Date().toISOString() };
  evidence.runs.push(activeRun); await save();
  await win.webContents.executeJavaScript('qaRailRuntime.setExpanded(false)');
  await waitFor(() => evaluate('!document.getElementById("prompt-form").hidden'), 'Empty illustration starter must be visible');
  await evaluate(`document.getElementById('prompt').value=${JSON.stringify(prompt)};document.getElementById('prompt-form').requestSubmit()`);
  await waitFor(() => Boolean(activeRun.request), 'User prompt did not reach the real agent IPC');
  await waitFor(() => Boolean(activeRun.result || activeRun.error), 'Live drawing timed out', 660000);
  if (activeRun.error) throw new Error(activeRun.error);
  check(activeRun.request.message === prompt, `${id}: the visible prompt reaches the agent unchanged`);
  check(activeRun.request.agent.pluginCanvasIllustrationId === targetId, `${id}: the request pins the intended illustration`);
  assert.equal(activeRun.result.ok, true, activeRun.result.error || `${id}: agent did not complete`);
  evidence.checks.push(`${id}: the real agent completes successfully`);
  await waitFor(() => win.webContents.executeJavaScript('document.getElementById("agent-rail-status").textContent==="Complete."'), 'Chat did not complete');
  const after = await snapshot(id, activeRun.inspectionRunId);
  check(after.inspection.complete === true && after.inspection.revision === after.revision, `${id}: mandatory inspection covers the latest revision`);
  const calls = evidence.calls.filter(call => call.run === id && call.origin === 'agent');
  check(calls.some(call => call.request.action === 'read' && call.ok), `${id}: agent reads the selected figure and contract`);
  check(calls.some(call => call.request.action === 'render' && call.request.canvas === 'both' && call.ok), `${id}: agent renders both canvases`);
  check(calls.some(call => call.request.action === 'inspect' && call.ok), `${id}: agent submits a successful review`);
  check(calls.filter(call => !['list', 'asset_list'].includes(call.request.action)).every(call => call.request.illustration_id === targetId), `${id}: every agent canvas request targets the same figure`);
  await save();
  activeRun.answer = activeRun.result.codex_agent?.answer || activeRun.result.parser?.reasoning_summary;
  activeRun.session = activeRun.result.codex_session_id;
  activeRun.ok = activeRun.result.ok;
  delete activeRun.result;
  await save();
  return after;
}
async function filesUnder(folder) {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(target));
    else result.push(target);
  }
  return result;
}
async function collectCalls(home) {
  // The native transcript is stronger evidence than a model's stated plan.
  const calls = [];
  for (const file of (await filesUnder(path.join(home, 'sessions'))).filter(f => f.endsWith('.jsonl'))) {
    for (const line of (await fs.readFile(file, 'utf8')).split('\n')) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      const item = entry.payload;
      if (entry.type !== 'response_item' || !['function_call', 'custom_tool_call'].includes(item?.type)) continue;
      let args = item.arguments || item.input || '';
      const source = typeof args === 'string' ? args : JSON.stringify(args);
      try { args = JSON.parse(args); } catch { /* custom tools may use freeform */ }
      calls.push({ timestamp: entry.timestamp, session: path.basename(file), name: item.name,
        arguments: /plugin_canvas|image_gen|view_image/.test(item.name || '') ? args : '[omitted]', call_id: item.call_id,
        nested_tools: [...new Set(source.match(/tools\.[a-zA-Z0-9_]+/g) || [])],
        canvas_actions: [...source.matchAll(/["']?action["']?\s*:\s*["']([^"']+)["']/g)].map(match => match[1]),
        imports_native_image: /["']?source["']?\s*:\s*["']codex["']/.test(source),
        emits_images: /\b(?:image|generatedImage)\s*\(/.test(source) });
    }
  }
  return calls;
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(home);
  const authHome = process.env.HIKARI_CODEX_AUTH_HOME || path.join(os.homedir(), 'Library/Application Support/Hikari/Config/codex-cli-home');
  const prepared = await prepareCodexRuntime({ env: { ...process.env, HIKARI_CODEX_HOME: authHome, CODEX_HOME: authHome }, cwd: temp });
  const { invocation, version } = prepared;
  evidence.cli = { ...invocation, version };
  if (invocation.argsPrefix.length) { process.env.HIKARI_CODEX_CLI = invocation.argsPrefix[0]; process.env.HIKARI_CODEX_NODE_PATH = invocation.command; }
  else process.env.HIKARI_CODEX_CLI = invocation.command;
  await fs.copyFile(path.join(authHome, 'auth.json'), path.join(home, 'auth.json'));
  await fs.chmod(path.join(home, 'auth.json'), 0o600);
  process.env.HIKARI_CODEX_HOME = home; process.env.CODEX_HOME = home;
  delete process.env.HIKARI_FILE_ACCESS_TOKEN;
  const catalog = await requestCodexCliCatalog({ cwd: temp });
  await fs.writeFile(path.join(output, 'model-catalog.json'), JSON.stringify(catalog, null, 2));
  check(catalog.ok && catalog.models.some(entry => entry.id === model), 'Requested model appears in the effective CLI live catalog');
  console.log(`Live catalog accepts ${model}; Codex CLI ${version}.`); await save();
  await app.whenReady();
  const storage = path.join(temp, 'storage'); await fs.mkdir(storage);
  const pluginPath = path.join(temp, 'installed/scientific-illustration');
  await fs.cp(path.join(repo, 'plugins/scientific-illustration'), pluginPath, { recursive: true });
  evidence.plugin_version = JSON.parse(await fs.readFile(path.join(pluginPath, 'plugin.json'), 'utf8')).version;
  const pluginFiles = (await filesUnder(pluginPath)).filter(name => /\.(mjs|json|html|css)$/.test(name));
  evidence.plugin_files = Object.fromEntries(await Promise.all(pluginFiles.map(async file => [path.relative(pluginPath, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
  registry = registerPluginIpc({ ipcMain, session, fs, dialog });
  ipcMain.handle(STORAGE.AUTO_SAVE, async (_event, { data }) => {
    const filePath = path.join(storage, 'experiment-log.json');
    await fs.writeFile(filePath, JSON.stringify(data));
    return { ok: true, filePath };
  });
  service = createMainMcpService({ ipcMain, getMainWindow: () => win, getWorkingDirectory: () => storage,
    createMcpHost: options => createAgentMcpHost({ ...options, runTool: async (toolId, ...args) => {
      const result = await options.runTool(toolId, ...args);
      if (toolId === 'plugin-canvas' && activeRun) recordCall('agent', args[0], result);
      return result;
    } }) });
  check((await service.initialize()).ok, 'Private live MCP host starts');
  agent = createCodexAgentRuntime({ requestCodexAgentText: requestCodexCliText, getWorkingDirectory: () => storage,
    requestPluginCanvas: async args => {
      if (activeRun) activeRun.inspectionRunId = args.inspectionRunId;
      const result = await service.requestPluginCanvas(args);
      if (activeRun) recordCall('host-inspection-gate', args, result);
      return result;
    } });
  // Keep production plugin bridge, scoped chat, request builder and preload.
  // This fixture's IPC maps the resulting payload directly into the real agent
  // runtime; only chat-log persistence and unrelated controller routing are omitted.
  ipcMain.handle(AGENT.CHAT_LOG_CREATE_SESSION, () => ({ ok: true, session: { id: randomUUID() } }));
  ipcMain.handle(AGENT.CHAT, async (_event, payload) => {
    const current = activeRun;
    current.request = { message: payload.message, chatSessionId: payload.chatSessionId,
      llm: payload.llm, agent: payload.agent, conversation: payload.conversation };
    try {
      const result = await agent.run({ model: payload.llm.model, reasoningEffort: payload.llm.reasoningEffort,
        message: payload.message, recoveryConversation: payload.conversation, snapshot: payload.stateSnapshot,
        agent: payload.agent, chatSessionId: payload.chatSessionId, codexSessionId: codexSessions.get(payload.chatSessionId) || '',
        cwd: storage, timeoutMs: 600000, enableWebSearch: false });
      if (result.codex_session_id) codexSessions.set(payload.chatSessionId, result.codex_session_id);
      current.result = result; await save();
      return { ...result, chat_session: { id: payload.chatSessionId } };
    } catch (error) { current.error = error.message; await save(); return { ok: false, error: error.message }; }
  });
  const url = relative => pathToFileURL(path.join(runtime, relative)).href;
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    document.body.dataset.agentAvailability='connected';
    import {createPluginBridge} from ${JSON.stringify(url('src/renderer/app/plugin-bridge.js'))};
    import {installPlugins} from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    import {createPluginPromptHandler,createPluginChatContextHandler} from ${JSON.stringify(url('src/renderer/app/plugin-agent.js'))};
    import {createAgentRailScopeContextGetter} from ${JSON.stringify(url('src/renderer/module-manifests/agent-chat-rail.js'))};
    import {createAgentChatRail} from ${JSON.stringify(url('src/renderer/app/navigation-shell/agent-rail.js'))};
    import {createScopedAgentChatState} from ${JSON.stringify(url('src/renderer/modules/agent-chat/scoped-state.js'))};
    import {initAgentChat} from ${JSON.stringify(url('src/renderer/modules/agent-chat/index.js'))};
    const inspected=await hikariApi.inspectPluginFolder(${JSON.stringify(pluginPath)});if(!inspected.ok)throw Error(inspected.error);
    window.qaState={settings:{storagePath:${JSON.stringify(storage)},plugins:[{...inspected,enabled:true}],llm:{provider:'codex',model:${JSON.stringify(model)},reasoningEffort:'low'},agent:{disabledMcpToolNames:${JSON.stringify(HIKARI_MCP_TOOL_NAMES.filter(name => name !== 'plugin_canvas'))}}},notebookEntries:[]};
    window.qaRegistry=[];
    const state=createScopedAgentChatState(qaState,{getScopeContext:createAgentRailScopeContextGetter({},document)});window.qaScopedState=state;
    const rail=initAgentChat({document,windowObject:window,idPrefix:'agent-rail',loadPersistentSessions:false,state,persist:()=>{},createId:()=>crypto.randomUUID(),safeText:String,refreshPersistentSessionsOnReply:false});window.qaRail=rail;
    const railRuntime=createAgentChatRail({VIEWS:{PAPERS:'papers-view'},documentObject:document,getActiveViewId:()=>document.body.dataset.activeView,getAppForView:id=>qaRegistry.find(app=>app.viewId===id),resolveNavigationViewId:id=>id,moduleRuntime:{renderAgentChatRail:()=>rail.render()},sharedLeftRailRuntime:{syncWidth(){}}});railRuntime.init();window.qaRailRuntime=railRuntime;
    const setChatContext=createPluginChatContextHandler({documentObject:document,getModuleRuntime:()=>({modules:{agentChatRail:rail}})});
    const prompt=createPluginPromptHandler({state:qaState,setChatContext,getNavigation:()=>({showView:id=>{document.body.dataset.activeView=id;railRuntime.syncState(id);},openAgentChatRail:()=>railRuntime.open()}),getModuleRuntime:()=>({modules:{agentChatRail:rail}})});
    const bridge=createPluginBridge({state:qaState,windowObject:window,persist:()=>{},api:hikariApi,onPluginPrompt:prompt,onPluginChatContext:setChatContext});
    hikariApi.onPluginCanvasRequest(async request=>hikariApi.respondToPluginCanvasRequest({id:request.id,result:await bridge.requestCanvas(request)}));
    installPlugins({state:qaState,documentObject:document,appRegistry:qaRegistry,bridge,api:hikariApi});
  `);
  await fs.writeFile(path.join(temp, 'index.html'), `<!DOCTYPE html><style>body{margin:0}.workspace-main{height:100vh}.view,.plugin-view__main,iframe{width:100%;height:100%;border:0}iframe{display:block}</style><div hidden><select id="agent-rail-project-select"></select><div id="agent-rail-chat-history"></div><textarea id="agent-rail-message-input"></textarea><button id="agent-rail-send-btn">Send</button><div id="agent-rail-session-list"></div><p id="agent-rail-status"></p></div><div class="workspace-main"></div><script type="module" src="host.mjs"></script>`);
  win = new BrowserWindow({ show: false, width: 1300, height: 1000, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(runtime, 'src/main/preload.js') } });
  await win.loadFile(path.join(temp, 'index.html'));
  await waitFor(async () => {
    frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
    return frame && await evaluate('Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false);
  }, 'Plugin did not load');
  await evaluate('illustrationWorkspace.ready.then(()=>true)');
  for (const test of selected) {
    activeRun = null;
    const listing = await canvas({ action: 'list' });
    let current = await canvas({ action: 'create', title: test.title, expected_library_revision: listing.library_revision, request_id: randomUUID() });
    check(current.ok, `${test.id}: disposable illustration created`); targetId = current.illustration_id;
    current = await canvas({ action: 'apply', illustration_id: targetId, expected_revision: current.revision, request_id: randomUUID(), operations: [
      { op: 'canvas', canvas: 'main', patch: { width: test.width || 1600, height: test.height || 1000 } },
      { op: 'complexity', complexity: test.complexity || 'standard' },
      { op: 'image_generation', imageGenerationPercent: test.percent }
    ] });
    check(current.ok && current.imageGenerationPercent === test.percent, `${test.id}: saved target reaches the installed plugin`);
    console.log(JSON.stringify({ phase: 'drawing', id: test.id, percent: test.percent, complexity: current.complexity, canvas: current.canvases.main }));
    try {
      const after = await submit(test.id, test.prompt);
      const vectors = after.objects.filter(item => item.type === 'vector'), rasters = after.objects.filter(item => item.type === 'raster'), labels = after.objects.filter(item => item.type === 'text');
      activeRun.layer_counts = { vector: vectors.length, raster: rasters.length, text: labels.length };
      check(after.imageGenerationPercent === test.percent, `${test.id}: agent preserves the user target`);
      check(after.complexity === (test.complexity || 'standard') && after.canvases.main.width === (test.width || 1600) && after.canvases.main.height === (test.height || 1000), `${test.id}: detail level and canvas size stay unchanged`);
      check(labels.length > 0 && test.labels.every(label => labels.some(item => item.text.toLowerCase().includes(label.toLowerCase()))), `${test.id}: requested labels are independent text objects`);
      check(rasters.every(item => item.textFree === true), `${test.id}: every imported raster has text-free confirmation`);
      const primitives = after.objects.filter(item => /arrow|leader|panel|frame|connector|scale.bar/i.test(`${item.id} ${item.name}`));
      activeRun.schematic_components = primitives.map(({ id, name, type }) => ({ id, name, type }));
      check(primitives.length > 0 && primitives.every(item => item.type === 'vector'), `${test.id}: arrows and panel geometry remain vector layers`);
      check(test.percent === 0 ? rasters.length === 0 && vectors.length > 0 : rasters.length > 0 && vectors.length > 0, `${test.id}: actual placed artwork matches the expected SVG or hybrid choice`);
      if (test.percent === 100) check(rasters.length >= 2, `${test.id}: both blood-cell subjects have independent generated artwork`);
      if (test.id === 'complex-hybrid-secretion') check(vectors.filter(item => /panel|frame/i.test(`${item.id} ${item.name}`)).length >= 3, `${test.id}: all three panel frames remain separate SVG objects`);
      activeRun.passed = true;
    } catch (error) {
      if (!activeRun) activeRun = { id: test.id, prompt: test.prompt };
      activeRun.passed = false; activeRun.error = error.message;
      console.error(JSON.stringify({ id: test.id, error: error.message }));
      await snapshot(`${test.id}-failed`, activeRun.inspectionRunId).catch(() => {});
    }
    activeRun.ended_at = new Date().toISOString();
    const calls = await collectCalls(home);
    const from = Date.parse(activeRun.started_at), to = Date.parse(activeRun.ended_at);
    const trace = calls.filter(call => Date.parse(call.timestamp) >= from && Date.parse(call.timestamp) <= to);
    activeRun.native_generation_calls = trace.filter(call => /image_gen|imagegen/.test(call.name || '') || call.nested_tools.some(name => /image_gen|imagegen/.test(name))).length;
    activeRun.native_import_trace = trace.some(call => call.imports_native_image);
    if (test.percent === 0 && activeRun.native_generation_calls !== 0) { activeRun.passed = false; activeRun.error = '0% unexpectedly invoked native image generation'; }
    if (test.percent > 0 && (!activeRun.native_generation_calls || !activeRun.native_import_trace)) { activeRun.passed = false; activeRun.error ||= 'Generated raster source was not proven by the native transcript'; }
    delete activeRun.result;
    await save();
    console.log(JSON.stringify({ phase: 'evaluated', id: test.id, passed: activeRun.passed, layers: activeRun.layer_counts, native_calls: activeRun.native_generation_calls, error: activeRun.error }));
    if (activeRun.error && /model.*(unsupported|not supported|not found)|authentication|unauthorized|not signed in/i.test(activeRun.error)) break;
  }
  evidence.completed_at = new Date().toISOString(); evidence.calls_native = await collectCalls(home);
  evidence.ok = evidence.runs.length === selected.length && evidence.runs.every(item => item.passed);
  await save();
  const rows = evidence.runs.map(item => {
    const test = selected.find(test => test.id === item.id), count = item.layer_counts || {};
    return `| ${test.percent}% | ${test.title} | ${count.vector || 0} | ${count.raster || 0} | ${count.text || 0} | ${item.native_generation_calls || 0} | ${item.passed ? 'Passed' : item.error || 'Failed'} |`;
  });
  await fs.writeFile(path.join(output, 'report.md'), `# Live illustration level and complex hybrid tests\n\nModel: ${model}; Codex CLI ${version}; installed Scientific Illustration ${evidence.plugin_version}.\n\nRuntime: ${runtime}. Real scoped prompt submission, plugin workspace, preload IPC, native Codex runtime and MCP, in disposable profile/storage. User figures were not opened or edited. Percentages are approximate visual preferences; these checks prove renderer decisions, imported layer types, independent labels and mandatory inspection, not exact pixel-area shares.\n\n| Target | Figure | SVG | Raster | Text | Native generation calls | Result |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n${selected.map(test => `## ${test.title} (${test.percent}%)\n\n${test.prompt}\n`).join('\n')}\nEvidence: evaluation.json, per-figure JSON snapshots, generated components, and main/scratch previews. Visual review remains separate from these structural checks.\n`);
  console.log(`Live level tests finished. Evidence: ${output}`);
  if (!evidence.ok) process.exitCode = 1;
}
run().catch(async error => {
  evidence.ok = false; evidence.error = error.message;
  console.error(error.stack); await save().catch(() => {}); process.exitCode = 1;
}).finally(async () => {
  await service?.stop().catch(() => {}); await registry?.close?.().catch(() => {});
  win?.destroy(); await fs.rm(home, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
