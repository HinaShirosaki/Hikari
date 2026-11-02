'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 120000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow, ipcMain } = require('electron');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plate-agent-flow-'));
  app.setPath('userData', path.join(temp, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const output = path.join(root, 'artifacts/plate-agent-flow');
  fs.mkdirSync(output, { recursive: true });
  const url = file => pathToFileURL(path.join(root, file)).href;
  const { AGENT, AGENT_PROGRESS_EVENT } = require('../src/shared/ipc/channels.js');
  const { createAgentAssayTableRuntime } = require('../src/main/agent/tools/agent-assay-table.js');
  const { createAgentPlotlyGraphRuntime } = require('../src/main/agent/tools/agent-plotly-graph.js');
  const { createAgentControllerCore } = require('../src/main/ipc/register-agent-ipc/agent-controller-core.js');
  const { registerAgentChatHandler } = require('../src/main/ipc/register-agent-ipc/agent-chat-handler.js');
  const { createAgentLifecycleService } = require('../src/main/ipc/register-agent-ipc/agent-lifecycle-service.js');
  const { createAgentChatLogRuntime } = require('../src/main/agent/context/agent-chat-log.js');
  const { runPythonSandbox } = require('../src/main/agent/tools/agent-python-sandbox.js');
  const observability = require('../src/main/agent/shared/agent-observability.js');
  const cleanText = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
  const tables = createAgentAssayTableRuntime({ runPythonSandbox, sandboxRoot: temp });
  const graphs = createAgentPlotlyGraphRuntime();
  let release, stagedRows = 0, done = false;
  const core = createAgentControllerCore({
    deps: { LLM_PROVIDERS: { CODEX: 'codex' }, getStorageRoot: () => temp }, cleanText,
    controllerUtils: { resolveAgentLlmSource: () => ({ provider: 'codex' }), createAgentLlmTraceContext: () => ({}), extractConversation: () => [] },
    lifecycleService: { normalizeJsonPayload: value => value || {}, asArray: value => Array.isArray(value) ? value : [] },
    agentToolRuntime: { normalizeAgentSnapshot: value => value, runAgentTool: (_name, args) => tables.execute(args) },
    observability, setCodexCliModel() {}, setCodexCliReasoningEffort() {},
    codexAgentRuntime: { run: async input => {
      const tableId = JSON.parse(input.message.match(/table_id=("[^"]+")/)[1]);
      const source = tables.getTable({ table_id: tableId });
      stagedRows = source.rows.length;
      await new Promise(resolve => { release = resolve; });
      const computed = await tables.execute({ action: 'python', table_id: tableId, code: [
        'import json', 'from pathlib import Path', "t=json.loads(Path('input_table.json').read_text())",
        "assert len(t['rows'])==1536 and not t['preview_truncated']",
        "Path('output_table.json').write_text(json.dumps({'rows':[{'n':len(t['rows'])}]}))"
      ].join('\n') });
      assert.equal(computed.table.rows[0].n, 1536, JSON.stringify(computed));
      const graph = await graphs.execute({ action: 'create', name: 'Complete 1536-well response',
        data: [{ type: 'scatter', mode: 'markers', x: source.rows.map((_, i) => i), y: source.rows.map(row => Number(row.result)), text: source.rows.map(row => row.well) }],
        layout: { title: { text: 'Complete 1536-well response' }, xaxis: { title: { text: 'Well index' } }, yaxis: { title: { text: 'Response' } } } });
      input.emitAgentProgress({ stage: 'tool_call_completed', tool_name: 'plotly_graph', status: 'completed', meta: { plotly_graph_artifact: graph.graph } });
      done = true;
      return { ok: true, codex_agent: { answer: 'Plotted all 1536 wells.', status: 'completed' } };
    } }
  });
  const chatLog = createAgentChatLogRuntime();
  registerAgentChatHandler({ ipcMain, cleanText,
    controllerUtils: { buildAgentLogRequestId: () => 'electron-plate-request', extractConversation: () => [],
      summarizeLlmForAgentLog: () => ({}), summarizeAgentResultForLog: () => ({ ok: true }) },
    observability, agentChatLogRuntime: chatLog, getAgentChatSessionStoragePath: () => temp,
    lifecycleService: createAgentLifecycleService({ cleanText }), runAgentController: core.runAgentControllerCore });
  ipcMain.handle(AGENT.CHAT_LOG_CREATE_SESSION, (_event, payload) => chatLog.createSession({ ...payload, storagePath: temp }));
  const preload = path.join(temp, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('hikariApi',{
    agentChat:payload=>ipcRenderer.invoke(${JSON.stringify(AGENT.CHAT)},payload),
    agentChatLogCreateSession:payload=>ipcRenderer.invoke(${JSON.stringify(AGENT.CHAT_LOG_CREATE_SESSION)},payload),
    onAgentProgress:handler=>ipcRenderer.on(${JSON.stringify(AGENT_PROGRESS_EVENT)},(_event,payload)=>handler(payload))});`);
  let html = require('./support/assay-workspace-qa.cjs')({ root, url });
  const layout = Array.from({ length: 1536 }, (_, i) => ({ well: `${i / 48 < 26 ? String.fromCharCode(65 + Math.floor(i / 48)) : 'A' + String.fromCharCode(65 + Math.floor(i / 48) - 26)}${i % 48 + 1}`, sampleId: 'Screen sample ' + 'S'.repeat(120), concentration: String(i % 48) }));
  const results = Object.fromEntries(layout.map((item, i) => [item.well, String(i)]));
  html = html.replace(/const layout=\[\],results=\{\};[\s\S]*?(?=const state=)/, `const layout=${JSON.stringify(layout)},results=${JSON.stringify(results)};`)
    .replace("plateType:'96',sampleAxis:'row',wellLayout:layout,resultValues:results}],", "plateType:'1536',sampleAxis:'row',wellLayout:layout,resultValues:results},{id:'other-plate',name:'Other plate',plateType:'6',wellLayout:[{well:'A1',sampleId:'Other',concentration:'1'}],resultValues:{A1:'999'}}],")
    .replace('onAssayModeChanged:mode=>', 'onActiveAssayChanged:()=>window.qaChat?.render(),onAssayModeChanged:mode=>');
  html += `<script type="module">
    import {initAgentChat} from '${url('src/renderer/modules/agent-chat/index.js')}';
    import {createScopedAgentChatState} from '${url('src/renderer/modules/agent-chat/scoped-state.js')}';
    while(!window.qa) await new Promise(resolve=>setTimeout(resolve,10));
    qa.state.settings.storagePath=${JSON.stringify(temp)};
    const state=createScopedAgentChatState(qa.state,{getScopeContext:()=>qa.module.getAgentChatContext()});
    window.qaChat=initAgentChat({document,windowObject:window,idPrefix:'agent-rail',loadPersistentSessions:false,state,
      persist:()=>localStorage.setItem('assay-workspace-state',JSON.stringify(qa.state)),createId:()=>crypto.randomUUID(),safeText:value=>String(value),
      onPlotlyGraphArtifact:artifact=>qa.module.renderAgentPlotlyGraph(artifact)});
    window.qaChat.render();window.qaChatReady=true;
  </script>`;
  const fixture = path.join(temp, 'index.html'); fs.writeFileSync(fixture, html);
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  const errors = []; win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const exec = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}\n${errors.join('\n')}`); });
  const wait = async condition => { const end = Date.now() + 30000; while (!await condition()) { if (Date.now() > end) throw new Error('Timed out waiting for Plate UI'); await new Promise(resolve => setTimeout(resolve, 40)); } };
  try {
    await win.loadFile(fixture); await wait(() => exec('window.qaChatReady===true'));
    await exec("document.getElementById('agent-rail-message-input').value='Plot every well';document.getElementById('agent-rail-send-btn').click()");
    await wait(() => Boolean(release)); assert.equal(stagedRows, 1536);
    await exec("var select=document.getElementById('assay-results-assay-select');select.value='other-plate';select.dispatchEvent(new Event('change',{bubbles:true}))");
    release(); await wait(() => done);
    await wait(() => exec("qa.state.paperAgentChatSessions['assay:qa-workspace-assay']?.messages.at(-1)?.role==='assistant'"));
    assert.equal(await exec("Boolean(document.querySelector('[data-assay-agent-plotly-chart]'))"), false, 'background result must not replace another plate');
    await exec("var select=document.getElementById('assay-results-assay-select');select.value='qa-workspace-assay';select.dispatchEvent(new Event('change',{bubbles:true}))");
    const rendered = () => exec("document.querySelector('[data-assay-agent-plotly-chart]')?.data?.[0]?.y?.length===1536");
    await wait(rendered);
    assert.equal(await exec("document.querySelector('[data-assay-agent-plotly-chart]').data[0].text.at(-1)"), 'AF48');
    fs.writeFileSync(path.join(output, 'returned-1536-plate.png'), (await win.webContents.capturePage()).toPNG());
    await win.reload(); await wait(() => exec('window.qaChatReady===true')); await wait(rendered);
    const svg = await exec("Plotly.toImage(document.querySelector('[data-assay-agent-plotly-chart]'),{format:'svg'})");
    assert.ok(decodeURIComponent(svg).includes('Complete 1536-well response'));
    assert.deepEqual(errors, []);
    console.log(`Plate Electron flow passed: 1536 real grid rows → chat IPC → complete Python input → Plotly; background plate switch, return, reload and SVG export. Screenshots: ${output}`);
  } finally { win.destroy(); app.quit(); }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
