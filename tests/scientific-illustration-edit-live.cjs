// Opt-in live user-prompt QA. Uses signed-in Codex usage only with --live.
// node node_modules/electron/cli.js tests/scientific-illustration-edit-live.cjs --live --seed=/path/to/vesicle-document.json
// Seed is a saved plugin read response: membrane, receptor-1/2/3, direction-arrow,
// vesicle and label-membrane/receptor/vesicle. No generated fixture is committed.
// All artwork, sessions and credentials are copied to a disposable profile.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
if (!process.argv.includes('--live')) { console.log('Live edit QA requires --live.'); app.exit(0); }
const seedArgument = process.argv.find(arg => arg.startsWith('--seed='));
if (!seedArgument?.slice(7)) { console.error('Live edit QA requires --seed=/path/to/vesicle-document.json.'); app.exit(2); }
const seedPath = path.resolve(seedArgument.slice(7));
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
const output = path.join(repo, 'artifacts/scientific-illustration-edit-live');
const home = path.join(temp, 'codex-home');
const model = process.argv.find(arg => arg.startsWith('--model='))?.slice(8) || 'gpt-6.1-sol';
app.setPath('userData', path.join(temp, 'profile')); app.setPath('sessionData', path.join(temp, 'session'));
app.on('window-all-closed', () => {});
const evidence = { started_at: new Date().toISOString(), runtime, model, temp, runs: [], calls: [], checks: [] };
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
    illustration_id: result.illustration_id, inspection_id: result.inspection_id,
    inspection: result.inspection, error: result.error };
  evidence.calls.push(item);
  console.log(JSON.stringify({ run: item.run, origin, action: request.action, ok: item.ok, status: item.status }));
}
async function snapshot(name, inspectionRunId = '') {
  const read = await canvas({ action: 'read', illustration_id: targetId }, inspectionRunId);
  const render = await canvas({ action: 'render', illustration_id: targetId, canvas: 'both' });
  assert.ok(read.ok && render.ok, 'Snapshot read/render failed');
  for (const preview of render.previews || []) {
    const data = preview.data_url || preview.dataUrl;
    if (data) await fs.writeFile(path.join(output, `${name}-${preview.canvas}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(read, null, 2));
  return read;
}
function sameExcept(actual, previous, allowed) {
  const omit = value => Object.fromEntries(Object.entries(value).filter(([key]) => !allowed.includes(key)));
  assert.deepEqual(omit(actual), omit(previous));
}
async function submit(id, prompt) {
  activeRun = { id, prompt, source: 'agent-rail', started_at: new Date().toISOString() };
  evidence.runs.push(activeRun); await save();
  assert.ok(await evaluate('document.getElementById("prompt-form").hidden'), 'Existing illustrations must use the rail composer');
  await win.webContents.executeJavaScript('qaRailRuntime.open()');
  await win.webContents.executeJavaScript(`document.getElementById('agent-rail-message-input').value=${JSON.stringify(prompt)};document.getElementById('agent-rail-send-btn').click()`);
  await waitFor(() => Boolean(activeRun.request), 'User prompt did not reach the real agent IPC');
  await waitFor(() => Boolean(activeRun.result || activeRun.error), 'Live edit timed out', 420000);
  if (activeRun.error) throw new Error(activeRun.error);
  check(activeRun.request.message === prompt, `${id}: the visible prompt reaches the agent unchanged`);
  check(activeRun.request.agent.pluginCanvasIllustrationId === targetId, `${id}: the request pins the existing illustration`);
  assert.equal(activeRun.result.ok, true, activeRun.result.error || `${id}: agent did not complete`);
  evidence.checks.push(`${id}: the real agent completes successfully`);
  await waitFor(() => win.webContents.executeJavaScript('document.getElementById("agent-rail-status").textContent==="Complete."'), 'Chat did not complete');
  const after = await snapshot(id, activeRun.inspectionRunId);
  check(after.inspection.complete === true && after.inspection.revision === after.revision, `${id}: mandatory inspection covers the latest revision`);
  const calls = evidence.calls.filter(call => call.run === id && call.origin === 'agent');
  check(calls.some(call => call.request.action === 'read' && call.ok), `${id}: agent reads the existing figure and contract`);
  check(calls.some(call => call.request.action === 'render' && call.request.canvas === 'both' && call.ok), `${id}: agent renders both canvases`);
  check(calls.some(call => call.request.action === 'inspect' && call.ok), `${id}: agent submits a successful review`);
  check(calls.filter(call => !['list', 'asset_list'].includes(call.request.action)).every(call => call.request.illustration_id === targetId), `${id}: every agent canvas request targets the same figure`);
  await save();
  return after;
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
  assert.deepEqual(seed.objects.map(object => object.id), ['membrane', 'receptor-1', 'receptor-2', 'receptor-3', 'direction-arrow', 'vesicle', 'label-membrane', 'label-receptor', 'label-vesicle'], 'Seed must contain the expected nine-component vesicle schematic');
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
  evidence.plugin_files = Object.fromEntries(await Promise.all((await fs.readdir(pluginPath)).filter(name => /\.(mjs|json|html|css)$/.test(name)).map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(pluginPath, name))).digest('hex')])));
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
        cwd: storage, timeoutMs: 360000, enableWebSearch: false });
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
  evidence.seed = { path: seedPath, original_illustration_id: seed.illustration_id };
  let current = await canvas({ action: 'read' });
  current = await canvas({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: randomUUID(), operations: [{ op: 'title', title: seed.title }, ...Object.entries(seed.canvases).map(([canvas, patch]) => ({ op: 'canvas', canvas, patch })), ...seed.objects.map(object => ({ op: 'upsert', object }))] });
  check(current.ok, 'Existing saved illustration is copied into disposable storage');
  const untouched = await canvas({ action: 'read' }); const untouchedId = untouched.illustration_id;
  current = await canvas({ action: 'duplicate', illustration_id: untouchedId, expected_library_revision: untouched.library_revision, request_id: randomUUID(), title: `${seed.title} — edit test` });
  check(current.ok, 'Test edits a duplicate and keeps another saved figure as a control'); targetId = current.illustration_id;
  await win.webContents.executeJavaScript(`document.body.dataset.activeView='plugin-scientific-illustration-view';qaRailRuntime.syncState(document.body.dataset.activeView)`);
  const before = await snapshot('before');
  evidence.target_illustration_id = targetId;
  const prompt = 'In this existing illustration, move the round vesicle and its label 60 canvas units to the right. Rename the label "Transport vesicle", make the label purple (#7c3aed), and widen its text box only if needed to fit. Recolor only the vesicle\'s large outer circle fill to pale purple (#c4b5fd), preserving the dark border, white inner ring and orange cargo dots. Keep every other component, the canvas size, title and complexity unchanged.';
  const after = await submit('edit', prompt);
  assert.deepEqual(after.objects.map(object => object.id), before.objects.map(object => object.id));
  check(true, 'Edit preserves every object ID and paint order');
  const previous = Object.fromEntries(before.objects.map(object => [object.id, object]));
  const edited = Object.fromEntries(after.objects.map(object => [object.id, object]));
  for (const object of after.objects) {
    if (object.id === 'vesicle') {
      check(object.x === previous.vesicle.x + 60, 'Vesicle moves exactly 60 units right');
      sameExcept(object, previous.vesicle, ['x', 'svg']);
      check(object.svg === previous.vesicle.svg.replace('fill="#bce8dc"', 'fill="#c4b5fd"'), 'Only the requested vesicle fill changes; ring, border and cargo remain intact');
    } else if (object.id === 'label-vesicle') {
      check(object.x === previous['label-vesicle'].x + 60 && object.text === 'Transport vesicle' && object.color.toLowerCase() === '#7c3aed', 'Independent label moves, renames and recolors as requested');
      sameExcept(object, previous['label-vesicle'], ['x', 'text', 'color', 'width']);
    } else assert.deepEqual(object, previous[object.id]);
  }
  check(true, 'All seven unrelated components stay byte-for-byte identical');
  assert.deepEqual(after.canvases, before.canvases); assert.deepEqual(after.groups, before.groups);
  check(after.title === before.title && after.complexity === before.complexity, 'Canvas sizes, groups, title and complexity remain unchanged');
  const followup = 'Now make that Transport vesicle label bold (weight 700) and reduce its font size to 22. Keep its position, color and all other artwork unchanged.';
  const followed = await submit('followup', followup);
  const changedLabel = followed.objects.find(object => object.id === 'label-vesicle');
  check(changedLabel.fontWeight === 700 && changedLabel.fontSize === 22, 'Follow-up prompt updates the existing label through the agent rail');
  sameExcept(changedLabel, edited['label-vesicle'], ['fontWeight', 'fontSize']);
  for (const object of followed.objects.filter(object => object.id !== 'label-vesicle')) assert.deepEqual(object, edited[object.id]);
  assert.deepEqual(followed.canvases, after.canvases);
  check(evidence.runs[0].request.chatSessionId === evidence.runs[1].request.chatSessionId && evidence.runs[0].result.codex_session_id === evidence.runs[1].result.codex_session_id, 'Follow-up resumes the same illustration-scoped Hikari and Codex sessions');
  const library = await canvas({ action: 'list' });
  check(library.illustrations.length === 2, 'Agent edits in place without creating another illustration');
  await canvas({ action: 'open', illustration_id: untouchedId, expected_library_revision: library.library_revision, request_id: randomUUID() });
  const control = await canvas({ action: 'read', illustration_id: untouchedId });
  for (const field of ['revision', 'objects', 'groups', 'canvases', 'title', 'complexity']) assert.deepEqual(control[field], untouched[field]);
  check(true, 'The other saved illustration is unchanged');
  const listing = await canvas({ action: 'list' });
  await canvas({ action: 'open', illustration_id: targetId, expected_library_revision: listing.library_revision, request_id: randomUUID() });
  await fs.writeFile(path.join(output, 'workspace.png'), (await win.webContents.capturePage()).toPNG());
  evidence.ok = true; evidence.completed_at = new Date().toISOString(); await save();
  await fs.writeFile(path.join(output, 'report.md'), `# Live existing-illustration edit QA\n\nPassed ${evidence.checks.length} checks with ${model} (Codex CLI ${version}) and installed Figura ${evidence.plugin_version}.\n\nRuntime: ${runtime}. Hidden Electron source-host fixture; real plugin workspace, scoped chat rail, request builder, preload IPC, Codex agent runtime and live MCP. Chat log persistence and unrelated controller routing use the fixture. User artwork/storage were never opened or edited.\n\n## Initial prompt\n\n${prompt}\n\n## Follow-up in agent rail\n\n${followup}\n\nBoth requests modified the same existing illustration. All nine object IDs and paint order survived. Seven unrelated components and the second saved illustration stayed identical. Both live agent runs rendered main and scratch and submitted inspection for the latest revision.\n\nEvidence: evaluation.json, before.json, edit.json, followup.json and their main/scratch PNGs.\n`);
  console.log(`Passed ${evidence.checks.length} live edit checks. Evidence: ${output}`);
}
run().catch(async error => {
  evidence.ok = false; evidence.error = error.message;
  console.error(error.stack); await save().catch(() => {}); process.exitCode = 1;
}).finally(async () => {
  await service?.stop().catch(() => {}); await registry?.close?.().catch(() => {});
  win?.destroy(); await fs.rm(home, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
