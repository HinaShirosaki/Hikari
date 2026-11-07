// node node_modules/electron/cli.js tests/workspace-file-access-electron.cjs
// Real preload/IPC, rendered source controls and stdio -> authenticated HTTP ->
// main-process file service. All writes use a disposable workspace and profile.
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = process.env.HIKARI_TEST_APP_ROOT || path.resolve(__dirname, '..');
const fromApp = file => require(path.join(root, file));
const { createWorkspaceFileService } = fromApp('src/main/agent/file-access/service.js');
const { createMainMcpService } = fromApp('src/main/core/services/create-mcp-service.js');
const { registerAgentFileIpc } = fromApp('src/main/ipc/register-agent-file-ipc.js');
const { buildHikariCodexMcpConfigBlock } = fromApp('src/main/agent/codex-agent/runtime-files.js');
const { FILE_ACCESS } = fromApp('src/shared/ipc/channels.js');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-file-ui-'));
const workspace = path.join(scratch, 'workspace');
const profile = path.join(scratch, 'profile');
fs.mkdirSync(workspace);
fs.mkdirSync(profile);
fs.mkdirSync(path.join(workspace, 'notes'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
let win;
let client;
let fullAccessResponse = 0;
const service = createWorkspaceFileService({ getStorageRoot: () => workspace, privateDirectory: profile,
  onChange: () => win?.webContents.send(FILE_ACCESS.CHANGED) });
registerAgentFileIpc({ ipcMain, fileAccess: service, getMainWindow: () => win,
  dialog: { showOpenDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: fullAccessResponse }) } });
const mcp = createMainMcpService({ fileAccess: service, ipcMain, getMainWindow: () => win,
  getWorkingDirectory: () => profile, processObject: { env: {} } });
const run = script => win.webContents.executeJavaScript(script);
async function waitFor(script) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await run(script)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${script}`);
}
async function connect() {
  await client?.close();
  const { token } = await service.beginSession({ id: 'rendered-qa', write: true });
  const block = buildHikariCodexMcpConfigBlock({ workspace: profile,
    mcpHostUrl: mcp.mcpHost.getHostUrl(), mcpToken: mcp.mcpHost.getToken(),
    envOverrides: { HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({ fileAccessToken: token }) } });
  const command = JSON.parse(block.match(/^command = (.+)$/m)[1]);
  const args = JSON.parse(block.match(/^args = (.+)$/m)[1]);
  const inlineEnv = block.match(/^env = \{ (.*) \}$/m)[1];
  const env = Object.fromEntries([...inlineEnv.matchAll(/(\w+) = ("(?:\\.|[^"\\])*")/gu)]
    .map(match => [match[1], JSON.parse(match[2])]));
  assert.equal(block.includes(token), false, 'capabilities must not be persisted in shared configuration');
  // Equivalent to the provider's per-invocation Codex -c override.
  env.HIKARI_FILE_ACCESS_TOKEN = token;
  const transport = new StdioClientTransport({ command, args, env, cwd: profile, stderr: 'pipe' });
  client = new Client({ name: 'workspace-files-qa', version: '1.0.0' });
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'workspace_files'));
}
async function call(args) {
  const result = await client.callTool({ name: 'workspace_files', arguments: args });
  return result.structuredContent || JSON.parse(result.content.find(item => item.type === 'text').text);
}
// A hidden window's first capture can come back empty on Windows; retry briefly.
async function shot(dir, name) {
  let png = Buffer.alloc(0);
  for (let attempt = 0; attempt < 10 && !png.length; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 100));
    png = (await win.webContents.capturePage()).toPNG();
  }
  assert.ok(png.length, `empty screenshot: ${name}`);
  fs.writeFileSync(path.join(dir, name), png);
}
async function assertVisibleActions() {
  const bounds = await run(`Array.from(document.querySelectorAll('#agent-codex-permission-picker button')).map(button => {
    const r = button.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, top: r.top, buttonWidth: r.width, buttonHeight: r.height, width: innerWidth, height: innerHeight };
  })`);
  assert.ok(bounds.length);
  for (const b of bounds) assert.ok(b.buttonWidth > 10 && b.buttonHeight > 10 && b.left >= 0 && b.right <= b.width && b.top >= 0 && b.bottom <= b.height, JSON.stringify(b));
}
async function main() {
  await app.whenReady();
  const fixture = path.join(scratch, 'fixture.html');
  const url = file => pathToFileURL(path.join(root, file)).href;
  const generated = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const start = generated.indexOf('<section id="agent-view"');
  const end = generated.indexOf('<section id=', start + 30);
  assert.ok(start >= 0 && end > start);
  const agent = generated.slice(start, end);
  // Real source markup/styles and controller modules; no fake DOM or fake IPC.
  fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}"></head>
    <body data-agent-availability="connected" style="overflow:auto;padding:20px"><section id="settings-fixture" class="panel"><div id="setting-agent-file-access"></div></section>
    ${agent}
    <script type="module">
      import { createFileAccessSettings } from '${url('src/renderer/modules/settings/file-access-controller.js')}';
      import { bindCodexPermissionPicker } from '${url('src/renderer/modules/agent-chat/codex-permission-picker.js')}';
      const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const get = id => document.getElementById(id);
      window.settings = createFileAccessSettings({ api: window.hikariApi, element: get('setting-agent-file-access'), escapeHtml: safe });
      bindCodexPermissionPicker({ document, api: window.hikariApi });
      await window.settings.render(); window.ready = true;
    </script></body></html>`);
  win = new BrowserWindow({ width: 1120, height: 850, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(root, 'src/main/preload.js')
  } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(fixture);
  await waitFor('window.ready');
  await waitFor(`!document.getElementById('agent-codex-permission-btn').disabled`);
  assert.equal(await run(`document.getElementById('agent-codex-permission-current').textContent`), 'Read Only');
  assert.equal((await mcp.initialize()).ok, true);
  await connect();
  const args = { action: 'create', path: 'notes/review.txt', content: 'Reviewed through Electron\n<script>unsafe()</script>', request_id: 'render-1' };
  const proposal = await call(args);
  assert.equal(proposal.status, 'awaiting_approval', JSON.stringify(proposal));
  assert.equal(fs.existsSync(path.join(workspace, args.path)), false);
  await run(`window.settings.render()`);
  await run(`new Promise(resolve => setTimeout(resolve, 150))`);
  assert.equal(await run(`document.querySelectorAll('#setting-agent-file-access script').length`), 0);
  assert.equal(await run(`document.querySelectorAll('#setting-agent-file-access details, #setting-agent-file-access [data-agent-review-card]').length`), 0,
    'Settings must not render file approval or history cards');
  const artifacts = path.resolve(__dirname, '../artifacts/workspace-file-access');
  fs.mkdirSync(artifacts, { recursive: true });
  await shot(artifacts, 'settings-day.png');
  await run(`document.body.classList.add('theme-night')`);
  await run(`new Promise(resolve => setTimeout(resolve, 150))`);
  await shot(artifacts, 'settings-night.png');
  await run(`document.getElementById('settings-fixture').hidden = true; document.getElementById('agent-view').classList.add('is-active')`);
  win.setContentSize(640, 800);
  const openPicker = `document.getElementById('agent-codex-permission-picker').showPopover()`;
  await run(openPicker);
  assert.equal(await run(`document.querySelectorAll('[data-codex-preset]').length`), 4);
  assert.equal(await run(`document.getElementById('agent-file-changes-btn')`), null);
  await assertVisibleActions();
  await shot(artifacts, 'codex-permissions-640.png');
  async function selectPreset(preset, active = preset) {
    await run(`${openPicker}; document.querySelector('[data-codex-preset="${preset}"]').click()`);
    await waitFor(`!document.getElementById('agent-codex-permission-picker').matches(':popover-open')`);
    assert.equal((await run(`window.hikariApi.getAgentCodexPermission()`)).preset, active);
    assert.equal(await run(`document.querySelector('[data-codex-preset][aria-pressed="true"]').dataset.codexPreset`), active);
  }
  await selectPreset('default');
  await selectPreset('approve-for-me');
  await selectPreset('full-access', 'approve-for-me');
  fullAccessResponse = 1;
  await selectPreset('full-access');
  await selectPreset('read-only');

  const status = await service.status();
  await run(`window.hikariApi.agentFilesReview(${JSON.stringify({ root_id: status.root_id, id: proposal.proposal_id, decision: 'once' })})`);
  assert.equal(fs.readFileSync(path.join(workspace, args.path), 'utf8'), args.content);
  assert.equal((await call(args)).status, 'completed', 'legacy stdio retries see the IPC approval');
  await run(`window.hikariApi.agentFilesSettings(${JSON.stringify({ root_id: status.root_id, action: 'mode', mode: 'workspace-write' })})`);
  assert.equal((await call({ action: 'status' })).status, 'session_expired');
  await connect();
  assert.equal((await call({ action: 'create', path: 'notes/automatic.txt', content: 'permitted', request_id: 'auto-1' })).status, 'completed');
  const trash = await call({ action: 'trash', path: 'notes/automatic.txt', request_id: 'trash-1' });
  assert.equal(trash.status, 'awaiting_approval');
  await run(`window.hikariApi.agentFilesReview(${JSON.stringify({ root_id: status.root_id, id: trash.proposal_id, decision: 'deny' })})`);
  assert.equal(fs.readFileSync(path.join(workspace, 'notes/automatic.txt'), 'utf8'), 'permitted');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, actualPreloadIpc: true, stdioHttpFileService: true,
    fourPermissionPresets: true, fullAccessConfirmation: true, modeInvalidation: true, artifacts }));
  await client.close(); client = null;
  await mcp.stop();
  win.destroy();
  // Windows keeps the live profile locked until Electron exits; leave the temp dir then.
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  app.quit();
}
main().catch(async error => { console.error(error); await client?.close(); await mcp.stop(); app.exit(1); });
setTimeout(() => { console.error('Workspace file UI test timed out'); app.exit(1); }, 60000).unref();
