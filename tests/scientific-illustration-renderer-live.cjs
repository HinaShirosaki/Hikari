// Optional paid/live evaluation. No inference without --live.
// node node_modules/electron/cli.js tests/scientific-illustration-renderer-live.cjs --live
// HIKARI_PLUGIN_QA_ROOT may identify an exact packaged app.asar runtime.
// --model=<explicitly selected model>; --plan-only omits drawing/generation.
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
if (!process.argv.includes('--live')) { console.log('Live evaluation requires --live; uses signed-in Codex usage.'); app.exit(0); }
const repo = path.resolve(__dirname, '..');
const runtime = process.env.HIKARI_PLUGIN_QA_ROOT || repo;
const { registerPluginIpc } = require(path.join(runtime, 'src/main/ipc/register-plugin-ipc.js'));
const { createMainMcpService } = require(path.join(runtime, 'src/main/core/services/create-mcp-service.js'));
const { createCodexAgentRuntime, buildCodexMcpContext } = require(path.join(runtime, 'src/main/agent/codex-agent/runtime.js'));
const { requestCodexCliText } = require(path.join(runtime, 'src/main/lib/codex-cli-provider.js'));
const { HIKARI_MCP_TOOL_NAMES } = require(path.join(runtime, 'src/main/agent/mcp-contract/instructions.js'));
const { prepareCodexRuntime } = require(path.join(runtime, 'src/main/lib/codex-cli-provider/runtime-gateway.js'));
const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'illustration-renderer-live-'));
const output = path.join(repo, 'artifacts/scientific-illustration-renderer-live');
const modelArgument = process.argv.find(arg => arg.startsWith('--model='));
const model = modelArgument ? modelArgument.slice('--model='.length) : 'gpt-6.1-sol';
if (!/^gpt-[a-z0-9.-]+$/.test(model)) throw new Error('Invalid --model');
const cases = [
  { id: 'flat-exact', prompt: 'A clean flat cell membrane schematic with exactly three receptors, one bound ligand and one budding vesicle; each receptor can be moved independently.', expected: 'svg' },
  { id: 'photorealistic', prompt: 'An isolated photorealistic red blood cell portrait with biconcave anatomy, natural soft surface detail and studio lighting. Educational illustration, not an actual microscopy image.', expected: 'image_gen' },
  { id: 'hybrid', prompt: 'A realistically textured mitochondrion portrait with dimensional organic surface detail, plus a simple directional arrow and the label Mitochondrion; arrow and label must remain independently editable. No measured data or molecular-structure claims.', expected: 'hybrid' },
  { id: 'detailed-exact', prompt: 'Detailed complexity: a five-stage endocytosis pathway with twelve repeated schematic receptors, precise stage connections and individually editable membrane and vesicle components.', expected: 'svg' },
  { id: 'ambiguous', prompt: 'A professional textbook mitochondrion cross-section showing inner membrane folds with clear readable labels.', expected: 'svg' },
  { id: 'quantitative', prompt: 'A bar chart with exactly three values 2, 4 and 8, editable axes and labels, and a 10 micrometre scale bar in a diagram with known 1 canvas unit per micrometre scaling.', expected: 'svg' },
  { id: 'editable-features', prompt: 'A cell diagram whose nucleus, membrane and four organelles can each be independently moved and recolored after creation.', expected: 'svg' }
];
const evidence = { model, started_at: new Date().toISOString(), runtime, cases, events: [], runs: [] };
let win, frame, service, registry, phase = 'setup';
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('sessionData', path.join(temp, 'session'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = async () => fs.writeFile(path.join(output, 'evaluation.json'), JSON.stringify(evidence, null, 2));
const canvas = (request, inspectionRunId = '') => service.requestPluginCanvas({ plugin_id: 'scientific-illustration', request, inspectionRunId });
function onStream(event) {
  // Omit prose/reasoning, env, auth, output data and all base64 from stream logs.
  if (!['codex_tool_call', 'codex_cli_display'].includes(event.type)) return;
  const item = { phase, type: event.type, tool_name: event.tool_name || event.toolName || '',
    status: event.status || '', event_type: event.event_type || event.eventType || '',
    display_kind: event.display_kind || event.displayKind || '' };
  evidence.events.push(item);
  if (item.tool_name && event.type === 'codex_tool_call') console.log(JSON.stringify(item));
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
async function snapshotRun(id, result, inspectionRunId) {
  const read = await canvas({ action: 'read', include_assets: true }, inspectionRunId);
  const rendered = await canvas({ action: 'render', canvas: 'both', illustration_id: read.illustration_id }, inspectionRunId);
  // Direct host render includes its previews; MCP converts them to image blocks.
  for (const preview of rendered.previews || []) {
    const data = preview.data_url || preview.dataUrl;
    if (data) await fs.writeFile(path.join(output, `${id}-${preview.canvas}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  const document = { ...read };
  document.objects = read.objects.map(({ dataUrl, ...object }) => object);
  for (const object of read.objects.filter(o => o.type === 'raster')) {
    const extension = object.dataUrl.startsWith('data:image/jpeg;') ? 'jpg' : object.dataUrl.startsWith('data:image/webp;') ? 'webp' : 'png';
    await fs.writeFile(path.join(output, `${id}-${object.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`), Buffer.from(object.dataUrl.split(',')[1], 'base64'));
  }
  await fs.writeFile(path.join(output, `${id}-document.json`), JSON.stringify(document, null, 2));
  await fs.writeFile(path.join(output, `${id}-workspace.png`), (await win.webContents.capturePage()).toPNG());
  const summary = { id, ok: result.ok, status: result.status, error: result.error,
    model: result.model, session: result.codex_session_id, inspection: read.inspection,
    objects: read.objects.map(({ id, type, name, text, canvas }) => ({ id, type, name, text, canvas })),
    answer: result.codex_agent?.answer || result.parser?.reasoning_summary };
  evidence.runs.push(summary); await save();
  return summary;
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  const home = path.join(temp, 'codex-home'); await fs.mkdir(home);
  const originalHome = process.env.HIKARI_CODEX_AUTH_HOME || path.join(os.homedir(), 'Library/Application Support/Hikari/Config/codex-cli-home');
  // Changing CODEX_HOME also changes managed CLI discovery. Resolve the normal
  // Hikari executable first, then retain it while isolating credentials/storage.
  const originalEnv = { ...process.env, HIKARI_CODEX_HOME: originalHome, CODEX_HOME: originalHome };
  const { invocation, version } = await prepareCodexRuntime({ env: originalEnv, cwd: temp });
  evidence.cli = { ...invocation, version };
  if (invocation.argsPrefix.length) {
    process.env.HIKARI_CODEX_CLI = invocation.argsPrefix[0];
    process.env.HIKARI_CODEX_NODE_PATH = invocation.command;
  } else process.env.HIKARI_CODEX_CLI = invocation.command;
  await fs.copyFile(path.join(originalHome, 'auth.json'), path.join(home, 'auth.json'));
  await fs.chmod(path.join(home, 'auth.json'), 0o600);
  process.env.HIKARI_CODEX_HOME = home;
  process.env.CODEX_HOME = home;
  delete process.env.HIKARI_FILE_ACCESS_TOKEN;
  await app.whenReady();
  const storage = path.join(temp, 'storage'); await fs.mkdir(storage);
  const pluginPath = path.join(temp, 'installed/scientific-illustration');
  await fs.cp(path.join(repo, 'plugins/scientific-illustration'), pluginPath, { recursive: true });
  const plugin = JSON.parse(await fs.readFile(path.join(pluginPath, 'plugin.json'), 'utf8'));
  evidence.plugin_version = plugin.version;
  if (runtime.endsWith('app.asar')) evidence.runtime_sha256 = createHash('sha256').update(await require('original-fs').promises.readFile(runtime)).digest('hex');
  registry = registerPluginIpc({ ipcMain, session, fs, dialog });
  const url = relative => pathToFileURL(path.join(runtime, relative)).href;
  await fs.writeFile(path.join(temp, 'host.mjs'), `
    import {createPluginBridge} from ${JSON.stringify(url('src/renderer/app/plugin-bridge.js'))};
    import {installPlugins} from ${JSON.stringify(url('src/renderer/app/plugin-loader.js'))};
    const inspected=await hikariApi.inspectPluginFolder(${JSON.stringify(pluginPath)});
    if(!inspected.ok)throw new Error(inspected.error);
    window.qaState={settings:{storagePath:${JSON.stringify(storage)},plugins:[{...inspected,enabled:true}]},notebookEntries:[]};
    window.qaRegistry=[];
    const bridge=createPluginBridge({state:qaState,windowObject:window,persist:()=>{},api:hikariApi,onPluginChatContext:()=>({ok:true})});
    hikariApi.onPluginCanvasRequest(async request=>hikariApi.respondToPluginCanvasRequest({id:request.id,result:await bridge.requestCanvas(request)}));
    installPlugins({state:qaState,documentObject:document,appRegistry:qaRegistry,bridge,api:hikariApi});
  `);
  await fs.writeFile(path.join(temp, 'index.html'), '<!DOCTYPE html><style>body{margin:0}.workspace-main{height:100vh}.view,.plugin-view__main,iframe{width:100%;height:100%;border:0}iframe{display:block}</style><div class="workspace-main"></div><script type="module" src="host.mjs"></script>');
  win = new BrowserWindow({ show: false, width: 1300, height: 1000, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(runtime, 'src/main/preload.js') } });
  service = createMainMcpService({ ipcMain, getMainWindow: () => win, getWorkingDirectory: () => storage });
  assert.equal((await service.initialize()).ok, true, 'Private MCP host must start');
  await win.loadFile(path.join(temp, 'index.html'));
  for (let i = 0; i < 100; i += 1) {
    frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('http://127.0.0.1'));
    if (frame && await frame.executeJavaScript('Boolean(window.illustrationWorkspace?.getDocument())').catch(() => false)) break;
    await pause(50);
  }
  assert.ok(frame, 'Plugin iframe must load');
  await frame.executeJavaScript('illustrationWorkspace.ready.then(()=>true)');
  let current = await canvas({ action: 'read' }); assert.equal(current.ok, true);
  const snapshot = { settings: { storagePath: storage, agent: {
    disabledMcpToolNames: HIKARI_MCP_TOOL_NAMES.filter(name => name !== 'plugin_canvas') } } };
  const planningPrompt = `Test renderer decisions without drawing. First read plugin_canvas plugin_id:"scientific-illustration", request:{action:"read"}; use its full agent_contract.instructions. For each independent request below, decide the renderer per component and explain briefly. Do not generate any images or edit canvases in this planning step. Set renderer to svg, image_gen or hybrid; give independent text labels their own layers, not baked artwork. If ambiguous, describe the initial choice and what would change it.\n${JSON.stringify(cases.map(({ id, prompt }) => ({ id, prompt })))}`;
  const schema = { type: 'object', additionalProperties: false, required: ['decisions'], properties: {
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'renderer', 'reason', 'components'], properties: {
        id: { type: 'string' }, renderer: { type: 'string', enum: ['svg', 'image_gen', 'hybrid'] },
        reason: { type: 'string' }, components: { type: 'array', items: { type: 'object', additionalProperties: false,
          required: ['component', 'renderer'], properties: { component: { type: 'string' },
            renderer: { type: 'string', enum: ['svg', 'image_gen', 'text'] } } } }
      } } } } };
  phase = 'planning'; evidence.planning_prompt = planningPrompt; await save();
  console.log(`Planning seven renderer decisions with ${model}.`);
  const ctx = JSON.stringify(buildCodexMcpContext({ model, cwd: storage, snapshot }));
  const planning = await requestCodexCliText({ prompt: planningPrompt, model, reasoningEffort: 'low', cwd: storage,
    enableImageGeneration: true, enableWebSearch: false, timeoutMs: 240000, outputSchema: schema,
    envOverrides: { HIKARI_AGENT_MCP_REQUEST_CONTEXT: ctx, HIKARI_CODEX_REQUEST_CONTEXT: ctx },
    stream: true, onStream, returnMetadata: true });
  const decisions = JSON.parse(planning.text).decisions;
  evidence.decisions = cases.map(test => ({ id: test.id, expected: test.expected,
    ...decisions.find(decision => decision.id === test.id),
    passed: decisions.find(decision => decision.id === test.id)?.renderer === test.expected }));
  evidence.planning_session = planning.metadata.session_id;
  console.log(JSON.stringify({ planning: evidence.decisions.map(({ id, renderer, passed }) => ({ id, renderer, passed })) }));
  await save();
  assert.equal(new Set(decisions.map(decision => decision.id)).size, cases.length, 'Decide every case exactly once');
  assert.ok(evidence.decisions.every(decision => decision.passed), 'One or more renderer decisions differ from the held-out expectations');
  if (!process.argv.includes('--plan-only')) {
    let activeInspectionRunId = '';
    const agent = createCodexAgentRuntime({ requestCodexAgentText: args => requestCodexCliText({ ...args, onStream: event => { onStream(event); args.onStream?.(event); } }),
      requestPluginCanvas: args => { activeInspectionRunId = args.inspectionRunId; return service.requestPluginCanvas(args); }, getWorkingDirectory: () => storage });
    const draw = async (id, message) => {
      phase = id;
      evidence.runs_pending = { id, message }; await save();
      const result = await agent.run({ model, reasoningEffort: 'low', timeoutMs: 540000,
        cwd: storage, snapshot, enableWebSearch: false, chatSessionId: randomUUID(), message,
        agent: { pluginCanvasId: 'scientific-illustration', pluginCanvasIllustrationId: current.illustration_id,
          sessionPrompt: 'Use plugin_canvas to read the Scientific Illustration plugin-owned contract before drawing. Follow its renderer, independent layers and mandatory visual inspection instructions. Work only in this illustration. This is a short disposable test: at most one native image-generation attempt for the figure; report a failed attempt instead of repeatedly retrying.' } });
      const summary = await snapshotRun(id, result, activeInspectionRunId);
      assert.equal(summary.ok, true, summary.error || `${id} agent failed`);
      assert.equal(summary.inspection.complete, true, 'Mandatory agent inspection must pass');
      return summary;
    };
    const svgPrompt = 'Draw a clean flat schematic of vesicle budding, showing one membrane segment with exactly three individually editable receptors and one separate round vesicle. Place separate labels Membrane, Receptor and Vesicle plus a simple directional arrow. Keep the layout compact and legible. No measured scale or molecular-structure claim.';
    console.log('Drawing an unhinted schematic case.');
    const svg = await draw('svg-execution', svgPrompt);
    assert.ok(svg.objects.some(o => o.type === 'vector'), 'Schematic must contain SVG');
    assert.ok(!svg.objects.some(o => o.type === 'raster'), 'Schematic should not use raster');
    current = await canvas({ action: 'read' });
    const created = await canvas({ action: 'create', title: 'Live photorealistic renderer evaluation',
      expected_library_revision: current.library_revision, request_id: randomUUID() });
    assert.equal(created.ok, true); current = await canvas({ action: 'read' });
    const rasterPrompt = 'Make a photorealistic oblique portrait of a red blood cell with recognizable biconcave anatomy, soft natural membrane detail and studio lighting. This is educational artwork, not a microscopy photograph or a measured specimen. Isolate the cell on the canvas and add one simple directional arrow and the label Red blood cell, each independently editable. No scale bar, no other labels.';
    console.log('Drawing an unhinted photorealistic case.');
    const raster = await draw('imagegen-execution', rasterPrompt);
    assert.ok(raster.objects.some(o => o.type === 'raster'), 'Realistic portrait must contain a generated raster');
    assert.ok(raster.objects.some(o => o.type === 'vector'), 'Arrow must remain vector');
    assert.ok(raster.objects.some(o => o.type === 'text'), 'Label must be independent text');
    current = await canvas({ action: 'read' });
    const detailedFigure = await canvas({ action: 'create', title: 'Live detailed pathway evaluation',
      expected_library_revision: current.library_revision, request_id: randomUUID() });
    assert.equal(detailedFigure.ok, true); current = await canvas({ action: 'read' });
    current = await canvas({ action: 'apply', expected_revision: current.revision, request_id: randomUUID(),
      operations: [{ op: 'complexity', complexity: 'detailed' }] });
    assert.equal(current.ok, true);
    const detailedPrompt = 'Draw clathrin-mediated endocytosis in four numbered stages: ligand binding to receptors on a flat plasma membrane, a clathrin-coated pit, a budding vesicle constricted by a dynamin neck, and an uncoated vesicle moving into the cytoplasm. Label the key structures.';
    console.log('Drawing a Detailed schematic case.');
    const detailed = await draw('detailed-execution', detailedPrompt);
    assert.ok(!detailed.objects.some(o => o.type === 'raster'), 'Detailed schematic should not use raster');
  }
  evidence.calls = await collectCalls(home);
  evidence.native_generation_calls = evidence.calls.filter(call => /image_gen/.test(call.name || '')
    || call.nested_tools.some(name => /image_gen/.test(name))).length;
  assert.equal(evidence.native_generation_calls, process.argv.includes('--plan-only') ? 0 : 1,
    'Only the photorealistic execution should invoke native image generation, exactly once');
  evidence.completed_at = new Date().toISOString(); delete evidence.runs_pending;
  evidence.result = 'completed'; await save();
  console.log(`Evidence saved to ${output}`);
}
run().then(() => finish(0), async error => {
  evidence.result = 'failed'; evidence.error = error.message;
  const home = path.join(temp, 'codex-home'); evidence.calls = await collectCalls(home).catch(() => []);
  await save().catch(() => {}); console.error(error.stack); await finish(1);
});
async function finish(code) {
  await service?.stop().catch(() => {}); await registry?.close?.(); win?.destroy();
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
}
