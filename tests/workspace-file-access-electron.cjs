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
const service = createWorkspaceFileService({ getStorageRoot: () => workspace, privateDirectory: profile,
  onChange: () => win?.webContents.send(FILE_ACCESS.CHANGED) });
registerAgentFileIpc({ ipcMain, fileAccess: service, getMainWindow: () => win,
  dialog: { showOpenDialog: async () => ({ canceled: true }) } });
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
async function assertVisibleActions() {
  const bounds = await run(`Array.from(document.querySelectorAll('#agent-review-track [data-agent-review-card]:not([hidden]) [data-file-decision]')).map(button => {
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
    <body style="overflow:auto;padding:20px"><section id="settings-fixture" class="panel"><div id="setting-agent-file-access"></div></section>
    ${agent}<p id="test-status" role="status"></p>
    <script type="module">
      import { createFileAccessSettings } from '${url('src/renderer/modules/settings/file-access-controller.js')}';
      import { createAgentReviewOverlayController } from '${url('src/renderer/modules/agent-chat/review-overlay.js')}';
      const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const get = id => document.getElementById(id);
      window.settings = createFileAccessSettings({ api: window.hikariApi, element: get('setting-agent-file-access'), escapeHtml: safe });
      window.review = createAgentReviewOverlayController({ dom: {
        reviewOverlay: get('agent-review-overlay'), reviewTrack: get('agent-review-track'),
        reviewPageLabel: get('agent-review-page-label'), reviewPrevBtn: get('agent-review-prev-btn'),
        reviewNextBtn: get('agent-review-next-btn'), reviewCloseBtn: get('agent-review-close-btn')
      }, state: {}, safeText: safe, fileAccessApi: window.hikariApi, setStatus: text => { get('test-status').textContent = text; } });
      get('agent-file-changes-btn').addEventListener('click', () => window.review.openFileChanges());
      await window.settings.render(); window.ready = true;
    </script></body></html>`);
  win = new BrowserWindow({ width: 1120, height: 850, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, preload: path.join(root, 'src/main/preload.js')
  } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(fixture);
  await waitFor('window.ready');
  assert.equal(await run(`document.querySelector('[data-file-mode]').value`), 'read-only');
  assert.equal((await mcp.initialize()).ok, true);
  await connect();
  const args = { action: 'create', path: 'notes/review.txt', content: 'Reviewed through Electron\n<script>unsafe()</script>', request_id: 'render-1' };
  const proposal = await call(args);
  assert.equal(proposal.status, 'awaiting_approval', JSON.stringify(proposal));
  assert.equal(fs.existsSync(path.join(workspace, args.path)), false);
  await waitFor(`document.querySelector('[data-file-decision="once"]')`);
  await run(`window.settings.render()`);
  await run(`new Promise(resolve => setTimeout(resolve, 150))`);
  assert.equal(await run(`document.querySelectorAll('#setting-agent-file-access script').length`), 0);
  const artifacts = path.resolve(__dirname, '../artifacts/workspace-file-access');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'settings-day.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.body.classList.add('theme-night')`);
  await run(`new Promise(resolve => setTimeout(resolve, 150))`);
  fs.writeFileSync(path.join(artifacts, 'settings-night.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.getElementById('settings-fixture').hidden = true; document.getElementById('agent-view').classList.add('is-active'); window.review.openFileChanges()`);
  await waitFor(`!document.getElementById('agent-review-overlay').hidden`);
  win.setContentSize(640, 800);
  await run(`new Promise(resolve => setTimeout(resolve, 150))`);
  await assertVisibleActions();
  fs.writeFileSync(path.join(artifacts, 'approval-640.png'), (await win.webContents.capturePage()).toPNG());
  await run(`window.review.close(); document.getElementById('settings-fixture').hidden = false; document.querySelector('#setting-agent-file-access [data-file-decision="once"]').click()`);
  await waitFor(`document.querySelector('[data-file-decision="undo"]')`);
  assert.equal(fs.readFileSync(path.join(workspace, args.path), 'utf8'), args.content);
  assert.equal((await call(args)).status, 'completed', 'stdio retries see the UI approval');
  await run(`document.getElementById('settings-fixture').hidden = true; document.getElementById('agent-view').classList.add('is-active'); document.getElementById('agent-file-changes-btn').click()`);
  await waitFor(`!document.getElementById('agent-review-overlay').hidden`);
  for (const width of [1120, 640]) {
    win.setContentSize(width, 800);
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await assertVisibleActions();
    await run(`new Promise(resolve => setTimeout(resolve, 150))`);
    fs.writeFileSync(path.join(artifacts, `review-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await run(`document.querySelector('#agent-review-track [data-file-decision="undo"]').click()`);
  await waitFor(`document.getElementById('test-status').textContent === 'File change restored.'`);
  assert.equal(fs.existsSync(path.join(workspace, args.path)), false);
  await run(`window.review.close(); document.getElementById('settings-fixture').hidden = false;
    const select = document.querySelector('[data-file-mode]'); select.value = 'workspace-write'; select.dispatchEvent(new Event('change', { bubbles: true }))`);
  await waitFor(`!document.querySelector('[data-file-mode]').disabled`);
  assert.equal((await service.status()).mode, 'workspace-write');
  assert.equal((await call({ action: 'status' })).status, 'session_expired');
  await connect();
  assert.equal((await call({ action: 'create', path: 'notes/automatic.txt', content: 'permitted', request_id: 'auto-1' })).status, 'completed');
  const trash = await call({ action: 'trash', path: 'notes/automatic.txt', request_id: 'trash-1' });
  assert.equal(trash.status, 'awaiting_approval');
  await waitFor(`document.querySelector('[data-file-id="${trash.proposal_id}"][data-file-decision="deny"]')`);
  await run(`document.querySelector('[data-file-id="${trash.proposal_id}"][data-file-decision="deny"]').click()`);
  await waitFor(`!document.querySelector('[data-file-id="${trash.proposal_id}"]')`);
  assert.equal(fs.readFileSync(path.join(workspace, 'notes/automatic.txt'), 'utf8'), 'permitted');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, root, rendered: ['day', 'night', '1120px', '640px'],
    actualPreloadIpc: true, stdioHttpFileService: true, approveDenyUndo: true, modeInvalidation: true, artifacts }));
  await client.close(); client = null;
  await mcp.stop();
  win.destroy();
  fs.rmSync(scratch, { recursive: true, force: true });
  app.quit();
}
main().catch(async error => { console.error(error); await client?.close(); await mcp.stop(); app.exit(1); });
setTimeout(() => { console.error('Workspace file UI test timed out'); app.exit(1); }, 60000).unref();
