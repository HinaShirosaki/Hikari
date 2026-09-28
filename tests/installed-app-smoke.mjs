// Drives an installed Hikari started with --remote-debugging-port=9333 on a clean
// machine (see .github/workflows/windows-install-smoke.yml). Not part of test.js.
//   node tests/installed-app-smoke.mjs opening        first launch shows the storage setup page
//   node tests/installed-app-smoke.mjs codex-missing  Settings reports no Codex CLI + install command
//   node tests/installed-app-smoke.mjs codex-found    Codex CLI discovered after install, no restart
//   node tests/installed-app-smoke.mjs mcp <storage>  live Codex MCP config reaches the running app
// Screenshots go to $SMOKE_SHOT_DIR (default: cwd).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [step, arg] = process.argv.slice(2);
const shotDir = process.env.SMOKE_SHOT_DIR || process.cwd();

async function connect() {
  const deadline = Date.now() + 60_000;
  let seen = 'nothing listening';
  for (;;) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
      seen = JSON.stringify(targets.map((t) => `${t.type} ${t.url}`));
    } catch { /* app still starting */ }
    if (Date.now() > deadline) throw new Error(`No Hikari renderer on 127.0.0.1:9333 (saw: ${seen})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', function on(event) {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', on);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, `${name}.png`), Buffer.from(data, 'base64'));
}
async function waitFor(expression, what) {
  const deadline = Date.now() + 30_000;
  // The page may still be loading (elements missing) right after a launch.
  while (!(await evaluate(expression).catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Spawn the [mcp_servers.hikari] entry exactly as Codex would and talk JSON-RPC to it.
async function callHikariMcp(configPath, tool, args, { token } = {}) {
  const block = fs.readFileSync(configPath, 'utf8').split('[mcp_servers.hikari]')[1];
  const command = JSON.parse(block.match(/^command = (.+)$/m)[1]);
  const commandArgs = JSON.parse(block.match(/^args = (.+)$/m)[1]);
  const env = {};
  for (const [, key, value] of (block.match(/^env = \{ (.*) \}$/m)?.[1] || '').matchAll(/(\w+) = ("(?:[^"\\]|\\.)*")/g)) {
    env[key] = /_MCP_TOKEN$/.test(key) && token ? token : JSON.parse(value);
  }
  // Codex gives stdio MCP servers only an allowlist of its own environment plus the config's env.
  const passed = process.platform === 'win32'
    ? ['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'USERNAME', 'USERDOMAIN', 'USERPROFILE', 'HOMEDRIVE',
      'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TZ'];
  const base = Object.fromEntries(passed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const child = spawn(command, commandArgs, { env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (code, signal) => { stderr += `\n[server exited: code=${code} signal=${signal}]`; });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (d) => {
    buffer += d;
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); }
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out. stderr: ${stderr.slice(-800)}`)), 60_000);
    pending.set(myId, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = (await rpc('tools/list', {})).result?.tools?.map((t) => t.name) || [];
    const call = await rpc('tools/call', { name: tool, arguments: args });
    return { command, server: init.result?.serverInfo?.name, tools, result: call.result?.structuredContent || call.result || call.error };
  } finally {
    child.stdin.end();
    setTimeout(() => child.kill(), 2000).unref();
  }
}

const settingsCodex = `document.querySelector('[data-app-id=settings]').click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('[data-settings-target=llm]').click();`;

if (step === 'opening') {
  await waitFor(`!document.getElementById('storage-setup-page').hidden`, 'the storage setup page');
  const page = await evaluate(`({
    shellHidden: document.querySelector('.app-shell').hidden,
    heading: document.querySelector('#storage-setup-page h1')?.textContent.trim(),
    button: document.getElementById('storage-setup-choose').textContent.trim(),
    focused: document.activeElement?.id,
    status: document.getElementById('storage-setup-status').textContent.trim()
  })`);
  console.log(page);
  await shot('01-opening-page');
  assert.equal(page.shellHidden, true);
  assert.equal(page.button, 'Choose Folder');
  assert.equal(page.status, '');
} else if (step === 'codex-missing' || step === 'codex-found') {
  await waitFor(`!document.querySelector('.app-shell').hidden && !!document.querySelector('[data-app-id=settings]')`, 'the workspace to open');
  await evaluate(`(async () => { ${settingsCodex}
    document.getElementById('check-codex-cli-btn')?.click();
    await new Promise((r) => setTimeout(r, 3000)); })()`);
  const status = await evaluate(`hikariApi.getCodexLlmStatus().then((s) => ({
    cliAvailable: s.cliAvailable, cliPath: s.cliPath, cliMessage: s.cliMessage, cliInstallCommand: s.cliInstallCommand,
    ui: document.getElementById('setting-codex-status').textContent.trim() }))`);
  console.log(status);
  await shot(step === 'codex-missing' ? '02-codex-missing' : '03-codex-found');
  if (step === 'codex-missing') {
    assert.equal(status.cliAvailable, false);
    assert.match(status.cliInstallCommand, /chatgpt\.com\/codex\/install/);
  } else {
    assert.equal(status.cliAvailable, true, status.cliMessage);
    assert.ok(fs.existsSync(status.cliPath), `cliPath does not exist: ${status.cliPath}`);
  }
} else if (step === 'mcp') {
  const setup = await evaluate(`hikariApi.getCodexDesktopMcpSetupPrompt({ storagePath: ${JSON.stringify(arg || '')} })`);
  assert.equal(setup.ok, true, setup.error);
  console.log('managed config:', setup.managedConfigPath);
  // Codex itself must parse what Hikari wrote (Windows paths inside TOML strings).
  const { cliPath } = await evaluate('hikariApi.getCodexLlmStatus()');
  if (cliPath) {
    const listed = execFileSync(cliPath, ['mcp', 'list'], {
      env: { ...process.env, CODEX_HOME: path.dirname(setup.managedConfigPath) }, encoding: 'utf8'
    });
    console.log(listed.trim());
    assert.match(listed, /^hikari\s/m);
  }
  // Sequence tools run inside the MCP process; protocol_lookup goes through the app's host.
  const live = await callHikariMcp(setup.managedConfigPath, 'protocol_lookup', { query: 'PCR' });
  console.log('command:', live.command, '| server:', live.server, '| tools:', live.tools.length, '| protocol_lookup:', live.result.status);
  assert.equal(live.server, 'hikari-agent-mcp');
  assert.ok(live.tools.includes('protocol_lookup'));
  assert.equal(live.result.ok, true, JSON.stringify(live.result));
  const denied = await callHikariMcp(setup.managedConfigPath, 'protocol_lookup', { query: 'PCR' }, { token: 'wrong' });
  assert.equal(denied.result.ok, false, 'a wrong MCP token must be rejected by the host');
  console.log('wrong token rejected:', String(denied.result.summary).slice(0, 120));
} else {
  throw new Error(`Unknown step: ${step}`);
}
ws.close();
