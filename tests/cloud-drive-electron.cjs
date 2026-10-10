// Run after build:ui. Uses real renderer/preload/storage/cloud IPC with two
// in-memory cloud providers and a disposable profile; never signs in to a real account.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const root = path.resolve(process.env.HIKARI_TEST_APP_ROOT || path.join(__dirname, '..'));
const fromApp = file => require(path.join(root, file));
const { STORAGE, SYSTEM } = fromApp('src/shared/ipc/channels');
const { registerDataIpc } = fromApp('src/main/ipc/register-data-ipc');
const { registerCloudDriveIpc } = fromApp('src/main/ipc/register-cloud-drive-ipc');
const { createCloudDriveService } = fromApp('src/main/cloud-drive/service');
const { createMainDataHelpers } = fromApp('src/main/data/data-helpers');
const { hashBytes, scanWorkspace } = fromApp('src/main/cloud-drive/workspace-files');
const storage = fromApp('src/main/storage');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-cloud-ui-'));
const workspace = path.join(scratch, 'workspace');
const pointer = path.join(scratch, 'profile', 'Config', 'last-storage-root.json');
fs.mkdirSync(workspace); fs.mkdirSync(path.dirname(pointer), { recursive: true });
fs.writeFileSync(pointer, JSON.stringify({ storagePath: workspace }));
fs.writeFileSync(path.join(workspace, 'research.md'), '# Local research\n');
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
let win;
let finishLogin;
let loginMode = 'complete';
let configuredRoot = workspace;
let failSync = false;
const workspaces = new Map();
const tokens = new Map();
const clientEnv = { HIKARI_GOOGLE_DRIVE_CLIENT_ID: '', HIKARI_DROPBOX_APP_KEY: '' };
const cloudDrive = createCloudDriveService({
  directory: path.join(scratch, 'cloud-profile'), getStorageRoot: () => configuredRoot,
  credentialStore: { available: () => true, get: async provider => tokens.get(provider),
    set: async (provider, value) => { if (value) tokens.set(provider, value); else tokens.delete(provider); } },
  env: clientEnv,
  openExternal: async () => {},
  authorizeImpl: async ({ config, signal }) => {
    if (loginMode === 'wait') await new Promise((resolve, reject) => {
      finishLogin = resolve;
      signal.addEventListener('abort', () => reject(new Error('Cloud sign-in canceled.')), { once: true });
    });
    return { clientId: config.clientId, accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 3600000 };
  },
  providerFactory: () => ({
    account: async () => ({ id: 'ui-user', name: 'scientist@example.test' }),
    listWorkspaces: async () => [...workspaces.values()].map(remote => remote.workspace),
    createWorkspace: async name => {
      const workspace = { id: randomUUID(), name };
      workspaces.set(workspace.id, { workspace, objects: new Map(), commits: new Map() }); return workspace;
    },
    openWorkspace: async connection => {
      const remote = workspaces.get(connection.id);
      return {
        listCommits: async () => [...remote.commits.keys()].map(name => ({ id: name, name })),
        readCommit: async reference => remote.commits.get(reference.id),
        putCommit: async (name, bytes) => { if (failSync) throw new Error('Fixture offline'); remote.commits.set(name, Buffer.from(bytes)); },
        hasObject: hash => remote.objects.has(hash),
        getObject: async hash => remote.objects.get(hash),
        putObject: async (hash, bytes) => { if (failSync) throw new Error('Fixture offline'); remote.objects.set(hash, Buffer.from(bytes)); }
      };
    }
  }),
  onChange: () => win?.webContents.send(STORAGE.CLOUD_CHANGED)
});
const handlers = new Map();
registerDataIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  fs: fs.promises, ...storage, getStorageRoot: () => configuredRoot,
  setStorageRoot: next => { configuredRoot = next; }, getStorageRootPointerPath: () => pointer,
  getDefaultDataFilePath: () => path.join(scratch, 'profile', 'hikari-data.json'),
  mainDataHelpers: createMainDataHelpers({ fs: fs.promises, path, ...storage }),
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } });
registerCloudDriveIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler),
  on: (...args) => ipcMain.on(...args), removeListener: (...args) => ipcMain.removeListener(...args) }, cloudDrive,
  getMainWindow: () => win });
const registered = new Set();
function registerChannels(value) {
  if (typeof value !== 'string') { Object.values(value || {}).forEach(registerChannels); return; }
  if (registered.has(value)) return;
  registered.add(value);
  ipcMain.handle(value, (event, payload) => handlers.has(value) ? handlers.get(value)(event, payload) : { ok: true });
}
registerChannels(fromApp('src/shared/ipc/channels'));
ipcMain.on(SYSTEM.REPORT_ERROR, () => {});
const run = async script => {
  try { return await win.webContents.executeJavaScript(script); }
  catch (error) { throw new Error(`${error.message}\nScript: ${script}`, { cause: error }); }
};
async function waitFor(script) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await run(script)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${script}`);
}
const row = provider => `document.querySelector('[data-cloud-provider="${provider}"]')`;
const button = (provider, action) => `${row(provider)}.querySelector('[data-cloud-action="${action}"]')`;
async function click(provider, action) {
  await waitFor(`!${button(provider, action)}.disabled && ${button(provider, action)}.getClientRects().length > 0`);
  await run(`${button(provider, action)}.click()`);
}
async function complete(provider, action) {
  await click(provider, action);
  await waitFor(`${row(provider)}.getAttribute('aria-busy') === 'false' && !document.getElementById('cloud-drive-sync-dialog').open`);
}
async function remoteVersion(remote, files, contents = {}) {
  for (const bytes of Object.values(contents)) remote.objects.set(hashBytes(bytes), bytes);
  const previous = JSON.parse([...remote.commits.values()].at(-1));
  const manifest = Buffer.from(JSON.stringify({ schema: 1, files })); remote.objects.set(hashBytes(manifest), manifest);
  const commit = { schema: 1, id: `${Date.now()}-${randomUUID()}`, parents: [previous.id], manifest: hashBytes(manifest) };
  remote.commits.set(`${commit.id}.json`, Buffer.from(JSON.stringify(commit)));
}
async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width: 1100, height: 850, show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(root, 'src/main/preload.js')
  } });
  const moduleErrors = [];
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && /Module .*failed|Failed to initialize Hikari/.test(event.message)) moduleErrors.push(event.message);
  });
  await win.loadFile(path.join(root, 'index.html'));
  await waitFor(`document.documentElement.classList.contains('app-ready') && document.getElementById('storage-setup-page').hidden`);
  await waitFor(`!document.getElementById('app-loading-cover') || getComputedStyle(document.getElementById('app-loading-cover')).visibility === 'hidden'`);
  await run(`document.querySelector('[data-view="setting-view"]').click()`);
  const artifacts = path.join(os.tmpdir(), 'hikari-cloud-drive-qa'); fs.mkdirSync(artifacts, { recursive: true });
  const cloudNav = `document.querySelector('[data-settings-target="cloud-drives"]')`;
  assert.equal(await run(`${cloudNav}.getClientRects().length > 0`), true, 'Cloud drives must appear in the Settings sidebar');
  await run(`${cloudNav}.click()`);
  await waitFor(`document.getElementById('setting-cloud-drives').getClientRects().length > 0`);
  assert.equal(await run(`${cloudNav}.getAttribute('aria-current')`), 'page');
  for (const provider of ['google-drive', 'dropbox']) {
    await waitFor(`${row(provider)}.querySelector('[data-cloud-status]').textContent.includes('unavailable in this build')`);
    assert.equal(await run(`${button(provider, 'connect')}.disabled && ${button(provider, 'connect')}.getClientRects().length > 0`), true);
  }
  await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync(path.join(artifacts, 'unconfigured.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('[data-settings-target="storage"]').click()`);
  assert.equal(await run(`document.getElementById('storage-form').getClientRects().length > 0 && document.getElementById('setting-cloud-drives').getClientRects().length === 0`), true);
  await run(`${cloudNav}.click()`);
  clientEnv.HIKARI_GOOGLE_DRIVE_CLIENT_ID = 'ui-google';
  clientEnv.HIKARI_DROPBOX_APP_KEY = 'ui-dropbox';
  win.webContents.send(STORAGE.CLOUD_CHANGED);
  await waitFor(`!${button('google-drive', 'connect')}.disabled`);
  loginMode = 'wait';
  await click('google-drive', 'connect');
  await waitFor(`!${button('google-drive', 'cancel')}.hidden`);
  await click('google-drive', 'cancel');
  await waitFor(`${row('google-drive')}.getAttribute('aria-busy') === 'false'`);
  assert.match(await run(`${row('google-drive')}.querySelector('[data-cloud-status]').textContent`), /canceled/);
  await click('google-drive', 'connect');
  await waitFor(`!${button('google-drive', 'cancel')}.hidden`);
  finishLogin();
  await waitFor(`!${button('google-drive', 'link')}.disabled`);
  await complete('google-drive', 'link');
  assert.equal(workspaces.size, 1);
  assert.match(await run(`${row('google-drive')}.querySelector('[data-cloud-status]').textContent`), /Last synced/);
  const remote = [...workspaces.values()][0];
  const baseline = JSON.parse(remote.objects.get(JSON.parse([...remote.commits.values()].at(-1)).manifest));
  const bytes = Buffer.from('# Cloud research\n');
  await remoteVersion(remote, { ...baseline.files, 'research.md': { hash: hashBytes(bytes), size: bytes.length } }, { research: bytes });
  await complete('google-drive', 'sync');
  assert.equal(fs.readFileSync(path.join(workspace, 'research.md'), 'utf8'), '# Cloud research\n');
  fs.writeFileSync(path.join(workspace, 'research.md'), '# Local conflict\n');
  const incoming = Buffer.from('# Remote conflict\n');
  await remoteVersion(remote, { ...baseline.files, 'research.md': { hash: hashBytes(incoming), size: incoming.length } }, { research: incoming });
  await complete('google-drive', 'sync');
  assert.equal(await run(`!${row('google-drive')}.querySelector('[data-cloud-conflicts]').hidden`), true);
  await complete('google-drive', 'keep-cloud');
  assert.equal(fs.readFileSync(path.join(workspace, 'research.md'), 'utf8'), '# Remote conflict\n',
    await run(`${row('google-drive')}.querySelector('[data-cloud-status]').textContent`));
  failSync = true;
  fs.writeFileSync(path.join(workspace, 'new.md'), 'offline change');
  await complete('google-drive', 'sync');
  assert.match(await run(`${row('google-drive')}.querySelector('[data-cloud-status]').textContent`), /offline/);
  assert.equal(fs.readFileSync(path.join(workspace, 'new.md'), 'utf8'), 'offline change');
  failSync = false;
  await complete('google-drive', 'sync');
  const seed = path.join(scratch, 'cloud-seed');
  await storage.syncBundleFromSnapshot({ snapshot: { settings: { storagePath: seed },
    protocols: [{ id: 'cloud-protocol', name: 'Cloud protocol', purpose: 'Downloaded scientific record',
      createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z',
      materials: 'Buffer', steps: [{ id: 'cloud-step', text: 'Mix the buffer.', placeholders: [] }] }] } });
  const seedFiles = await scanWorkspace(seed);
  const protocolPath = Object.keys(seedFiles).find(file => file.startsWith('Protocol/') && file.endsWith('/protocol.md'));
  assert.ok(protocolPath);
  const protocolBytes = fs.readFileSync(path.join(seed, protocolPath));
  const current = JSON.parse(remote.objects.get(JSON.parse([...remote.commits.values()].at(-1)).manifest));
  await remoteVersion(remote, { ...current.files, [protocolPath]: seedFiles[protocolPath] }, { protocol: protocolBytes });
  await complete('google-drive', 'sync');
  assert.match(await run(`document.getElementById('protocol-list').textContent`), /Cloud protocol/);
  loginMode = 'complete';
  await complete('dropbox', 'connect');
  await complete('dropbox', 'link');
  assert.equal(workspaces.size, 2);
  await run(`document.getElementById('setting-cloud-drives').scrollIntoView({block:'center'})`);
  fs.writeFileSync(path.join(artifacts, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
  win.setSize(520, 900);
  await run(`import('./src/renderer/app/appearance.js').then(({applyAppearanceToDocument}) => applyAppearanceToDocument({mode:'night',fontSize:16}, document, 16))`);
  await waitFor(`getComputedStyle(${button('google-drive', 'unlink')}).color === 'rgb(230, 231, 235)'`);
  await run(`document.getElementById('setting-cloud-drives').scrollIntoView({block:'center'})`);
  assert.equal(await run(`[...document.querySelectorAll('.settings-cloud-drive')].every(row => { const box = row.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })`), true);
  fs.writeFileSync(path.join(artifacts, 'narrow-night.png'), (await win.webContents.capturePage()).toPNG());
  await complete('dropbox', 'unlink'); await complete('dropbox', 'disconnect');
  assert.equal((await cloudDrive.status()).providers.find(item => item.id === 'dropbox').connected, false);
  assert.ok(Object.keys(await scanWorkspace(workspace)).length);
  assert.deepEqual(moduleErrors, []);
  console.log(`PASS: real renderer/preload/IPC sign-in, cancel, both providers, upload/download, conflicts, offline recovery, disconnect, and responsive layout. Screenshots: ${artifacts}`);
  cloudDrive.stop(); win.destroy(); await fs.promises.rm(scratch, { recursive: true, force: true }); app.quit();
}
main().catch(error => { cloudDrive.stop(); console.error(error); app.exit(1); });
setTimeout(() => { console.error('Cloud drive UI test timed out'); app.exit(1); }, 90000).unref();
