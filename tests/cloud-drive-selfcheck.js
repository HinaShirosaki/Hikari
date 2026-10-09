'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { createCloudDriveService } = require('../src/main/cloud-drive/service');
const { createCredentialStore } = require('../src/main/cloud-drive/credentials');
const { createCloudHttp } = require('../src/main/cloud-drive/http');
const { authorize } = require('../src/main/cloud-drive/oauth');
const { getClientConfig } = require('../src/main/cloud-drive/config');
const { hashBytes, contentHash, scanWorkspace, validateFiles, mergeFiles } = require('../src/main/cloud-drive/workspace-files');
const { createGoogleDrive } = require('../src/main/cloud-drive/google-drive');
const { createDropbox, headerJson } = require('../src/main/cloud-drive/dropbox');
const { registerCloudDriveIpc } = require('../src/main/ipc/register-cloud-drive-ipc');
const { registerDataIpc } = require('../src/main/ipc/register-data-ipc');
const { STORAGE } = require('../src/shared/ipc/channels');

const environment = { HIKARI_GOOGLE_DRIVE_CLIENT_ID: 'fixture-google', HIKARI_DROPBOX_APP_KEY: 'fixture-dropbox' };
const scratchPromise = fs.mkdtemp(path.join(os.tmpdir(), 'hikari-cloud-drive-'));
let checks = 0;
async function check(name, work) { await work(); checks++; console.log(`PASS: ${name}`); }
const file = text => ({ hash: hashBytes(Buffer.from(text)), size: Buffer.byteLength(text) });

function memoryDrive() {
  const workspaces = new Map();
  let accountId = 'fixture-account';
  let beforeCommit = null;
  let failUploads = false;
  return {
    setAccount: id => { accountId = id; },
    failUploads: value => { failUploads = value; },
    onCommit: callback => { beforeCommit = callback; },
    workspaces,
    account: async () => ({ id: accountId, name: 'scientist@example.test' }),
    listWorkspaces: async () => [...workspaces.values()].map(item => item.workspace),
    createWorkspace: async name => {
      const workspace = { id: randomUUID(), name };
      workspaces.set(workspace.id, { workspace, objects: new Map(), commits: new Map() });
      return workspace;
    },
    openWorkspace: async workspace => {
      const remote = workspaces.get(workspace.id);
      return {
        listCommits: async () => [...remote.commits.keys()].map(name => ({ id: name, name })),
        readCommit: async reference => remote.commits.get(reference.id),
        putCommit: async (name, bytes) => {
          if (beforeCommit) await beforeCommit(remote, name, bytes);
          if (failUploads) throw new Error('Fixture offline');
          remote.commits.set(name, Buffer.from(bytes));
        },
        hasObject: hash => remote.objects.has(hash),
        getObject: async hash => { if (!remote.objects.has(hash)) throw new Error('Fixture missing object'); return Buffer.from(remote.objects.get(hash)); },
        putObject: async (hash, bytes) => { if (failUploads) throw new Error('Fixture offline'); remote.objects.set(hash, Buffer.from(bytes)); }
      };
    }
  };
}
function credentialFixture() {
  const records = new Map();
  return { available: () => true, get: async provider => records.get(provider) || null,
    set: async (provider, value) => { if (value) records.set(provider, value); else records.delete(provider); } };
}

async function main() {
  const scratch = await scratchPromise;
  const drive = memoryDrive();
  const rootA = path.join(scratch, 'a');
  const rootB = path.join(scratch, 'b');
  await fs.mkdir(rootA); await fs.mkdir(rootB);
  let activeA = rootA;
  const services = [];
  const makeService = (label, root, options = {}) => {
    const service = createCloudDriveService({ directory: path.join(scratch, `${label}-profile`),
      getStorageRoot: root, credentialStore: credentialFixture(), providerFactory: () => drive,
      authorizeImpl: async ({ config }) => ({ clientId: config.clientId, accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600000 }),
      openExternal: async () => {}, env: environment, ...options });
    services.push(service); return service;
  };
  const a = makeService('a', () => activeA);
  const b = makeService('b', () => rootB);
  let workspace;
  let baselineCommit;
  try {
    await check('portable paths reject traversal, collisions, reserved names, and excluded credentials', async () => {
      for (const unsafe of ['../escape', '/absolute', 'C:/escape', '.git/config', '.env', 'folder\\escape', 'x/CON.txt', 'x./y']) {
        assert.throws(() => validateFiles({ [unsafe]: file('x') }));
      }
      assert.throws(() => validateFiles({ 'A.txt': file('a'), 'a.txt': file('b') }));
      assert.throws(() => validateFiles({ 'parent': file('a'), 'parent/child': file('b') }));
      const merged = mergeFiles({ 'a.md': file('old') }, { 'a.md': file('local') }, [{ 'a.md': file('remote') }]);
      assert.deepEqual(merged.conflicts, ['a.md']);
    });
    await check('routine save timestamps do not create conflicts, while scientific changes still do', async () => {
      const bytes = (savedAt, name) => Buffer.from(JSON.stringify({ schema_name: 'hikari_assay', updated_at: savedAt,
        assay: { id: 'a', name, updatedAt: 'record-timestamp', wells: [{ value: 42 }] } }));
      const descriptor = content => ({ hash: hashBytes(content), size: content.length, contentHash: contentHash('Plates/a/assay.json', content) });
      const original = descriptor(bytes('one', 'Original'));
      const local = descriptor(bytes('two', 'Original'));
      const cloud = descriptor(bytes('three', 'Original'));
      assert.notEqual(original.hash, local.hash); assert.equal(original.contentHash, local.contentHash);
      assert.deepEqual(mergeFiles({ 'Plates/a/assay.json': original }, { 'Plates/a/assay.json': local }, [{ 'Plates/a/assay.json': cloud }]).conflicts, []);
      const edited = descriptor(bytes('four', 'Changed'));
      assert.notEqual(edited.contentHash, original.contentHash);
      const plain = Buffer.from('{"updated_at":"one","value":42}');
      assert.equal(contentHash('other.json', plain), hashBytes(plain), 'unrecognized JSON retains byte identity');
    });
    await check('encrypted credentials stay out of workspace state and refuse plaintext backends', async () => {
      const key = randomBytes(32);
      const safeStorage = {
        isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
        encryptString: text => {
          const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
          const data = Buffer.concat([cipher.update(text), cipher.final()]);
          return Buffer.concat([iv, cipher.getAuthTag(), data]);
        },
        decryptString: bytes => {
          const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
          cipher.setAuthTag(bytes.subarray(12, 28));
          return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
        }
      };
      const directory = path.join(scratch, 'secure');
      const store = createCredentialStore({ directory, safeStorage });
      await store.set('dropbox', { accessToken: 'SECRET-TOKEN', refreshToken: 'SECRET-REFRESH' });
      assert.equal((await store.get('dropbox')).accessToken, 'SECRET-TOKEN');
      const saved = await fs.readFile(path.join(directory, 'cloud-credentials.json'), 'utf8');
      assert.equal(saved.includes('SECRET'), false);
      safeStorage.getSelectedStorageBackend = () => 'basic_text';
      assert.equal(store.available(), false);
      await assert.rejects(store.set('dropbox', { accessToken: 'leak' }), /unavailable/);
      await store.set('dropbox', null);
      assert.equal(await store.get('dropbox'), null);
    });
    await check('sign in, new workspace upload, byte-exact attachments, and unchanged sync', async () => {
      assert.equal((await a.connect('google-drive')).ok, true);
      await fs.mkdir(path.join(rootA, 'Project', '研究'), { recursive: true });
      await fs.writeFile(path.join(rootA, 'Project', '研究', 'page.md'), '# Experiment\n<!-- hikari-record:v2 -->\n');
      await fs.writeFile(path.join(rootA, 'image.png'), Buffer.from([0, 255, 25, 0, 90]));
      await fs.writeFile(path.join(rootA, '.env'), 'excluded-secret');
      workspace = (await a.linkWorkspace({ provider: 'google-drive' })).workspace;
      const initial = await a.sync({ provider: 'google-drive' });
      assert.equal(initial.ok, true);
      const remote = drive.workspaces.get(workspace.id);
      baselineCommit = JSON.parse([...remote.commits.values()][0]);
      const manifest = JSON.parse(remote.objects.get(baselineCommit.manifest));
      assert.equal(Object.hasOwn(manifest.files, '.env'), false);
      const count = remote.commits.size;
      assert.equal((await a.sync({ provider: 'google-drive' })).ok, true);
      assert.equal(remote.commits.size, count, 'unchanged sync must not publish another version');
      await b.connect('google-drive');
      await b.linkWorkspace({ provider: 'google-drive', workspaceId: workspace.id });
      const pulled = await b.sync({ provider: 'google-drive' });
      assert.equal(pulled.ok, true); assert.equal(pulled.downloaded, 2);
      assert.deepEqual(await fs.readFile(path.join(rootB, 'image.png')), await fs.readFile(path.join(rootA, 'image.png')));
      assert.equal(await fs.readFile(path.join(rootB, 'Project', '研究', 'page.md'), 'utf8'), '# Experiment\n<!-- hikari-record:v2 -->\n');
    });
    await check('remote updates wait for manual sync and deletion uses the shared baseline', async () => {
      await fs.writeFile(path.join(rootA, 'Project', '研究', 'page.md'), '# Remote edit\n');
      await fs.rm(path.join(rootA, 'image.png'));
      assert.equal((await a.sync({ provider: 'google-drive', background: true })).ok, true);
      assert.equal((await b.sync({ provider: 'google-drive', background: true })).updatesAvailable, true);
      assert.equal(await fs.readFile(path.join(rootB, 'Project', '研究', 'page.md'), 'utf8'), '# Experiment\n<!-- hikari-record:v2 -->\n');
      const sync = await b.sync({ provider: 'google-drive' });
      assert.equal(sync.ok, true);
      await assert.rejects(fs.access(path.join(rootB, 'image.png')));
      assert.ok(sync.recoveryPath);
    });
    await check('conflicts preserve both sides, stale approval is rejected, and explicit local resolution succeeds', async () => {
      const pageA = path.join(rootA, 'Project', '研究', 'page.md');
      const pageB = path.join(rootB, 'Project', '研究', 'page.md');
      await fs.writeFile(pageA, '# Cloud change\n');
      await a.sync({ provider: 'google-drive' });
      await fs.writeFile(pageB, '# Local change\n');
      const before = drive.workspaces.get(workspace.id).commits.size;
      const conflict = await b.sync({ provider: 'google-drive' });
      assert.equal(conflict.ok, false); assert.deepEqual(conflict.conflicts, ['Project/研究/page.md']);
      assert.equal(drive.workspaces.get(workspace.id).commits.size, before);
      assert.equal(await fs.readFile(pageB, 'utf8'), '# Local change\n');
      await fs.writeFile(pageB, '# Newer local change\n');
      const stale = await b.sync({ provider: 'google-drive', resolution: 'local', conflictId: conflict.conflictId });
      assert.equal(stale.ok, false); assert.ok(stale.conflictId !== conflict.conflictId);
      await fs.writeFile(path.join(rootB, 'unrelated-save.md'), 'unrelated saved content');
      const resolved = await b.sync({ provider: 'google-drive', resolution: 'local', conflictId: stale.conflictId });
      assert.equal(resolved.ok, true);
      assert.equal(await fs.readFile(pageB, 'utf8'), '# Newer local change\n');
      assert.equal((await a.sync({ provider: 'google-drive' })).ok, true);
      assert.equal(await fs.readFile(pageA, 'utf8'), '# Newer local change\n');
    });
    await check('simultaneous disjoint cloud branches merge without reverting the other device', async () => {
      const remote = drive.workspaces.get(workspace.id);
      const current = JSON.parse([...remote.commits.values()].at(-1));
      const base = JSON.parse(remote.objects.get(current.manifest)).files;
      async function branch(name, text) {
        const bytes = Buffer.from(text); remote.objects.set(hashBytes(bytes), bytes);
        const files = { ...base, [name]: file(text) };
        const manifest = Buffer.from(JSON.stringify({ schema: 1, files }));
        remote.objects.set(hashBytes(manifest), manifest);
        const commit = { schema: 1, id: `${Date.now()}-${randomUUID()}`, parents: [current.id], manifest: hashBytes(manifest) };
        remote.commits.set(`${commit.id}.json`, Buffer.from(JSON.stringify(commit)));
      }
      await branch('device-one.md', 'one'); await branch('device-two.md', 'two');
      const result = await b.sync({ provider: 'google-drive' });
      assert.equal(result.ok, true);
      assert.equal(await fs.readFile(path.join(rootB, 'device-one.md'), 'utf8'), 'one');
      assert.equal(await fs.readFile(path.join(rootB, 'device-two.md'), 'utf8'), 'two');
      assert.equal(await fs.readFile(path.join(rootB, 'Project', '研究', 'page.md'), 'utf8'), '# Newer local change\n');
    });
    await check('offline upload, root switch, symlinks, and live database journals do not acknowledge sync', async () => {
      await fs.writeFile(path.join(rootB, 'offline.md'), 'saved locally');
      drive.failUploads(true);
      const failed = await b.sync({ provider: 'google-drive' });
      assert.equal(failed.ok, false); assert.match(failed.error, /offline/);
      assert.equal(await fs.readFile(path.join(rootB, 'offline.md'), 'utf8'), 'saved locally');
      drive.failUploads(false);
      await fs.writeFile(path.join(rootA, 'switch.md'), 'a');
      drive.onCommit(async () => { activeA = rootB; });
      const switched = await a.sync({ provider: 'google-drive' });
      assert.equal(switched.ok, false); assert.match(switched.error, /Workspace changed/);
      activeA = rootA; drive.onCommit(null);
      await fs.symlink(path.join(rootB, 'offline.md'), path.join(rootA, 'linked.md'));
      await assert.rejects(scanWorkspace(rootA), /symbolic links/);
      await fs.rm(path.join(rootA, 'linked.md'));
      await fs.writeFile(path.join(rootA, 'external.sqlite-wal'), 'live WAL');
      await assert.rejects(scanWorkspace(rootA), /journal/);
      await fs.rm(path.join(rootA, 'external.sqlite-wal'));
    });
    await check('different accounts detach old cloud links and disconnect preserves local and cloud files', async () => {
      const previousSize = drive.workspaces.size;
      drive.setAccount('another-account');
      assert.equal((await b.connect('google-drive')).ok, true);
      assert.equal((await b.status()).providers.find(item => item.id === 'google-drive').workspace, null);
      await b.disconnect('google-drive');
      assert.equal((await b.status()).providers.find(item => item.id === 'google-drive').connected, false);
      assert.equal(drive.workspaces.size, previousSize);
      assert.equal(await fs.readFile(path.join(rootB, 'offline.md'), 'utf8'), 'saved locally');
    });
    await check('new edits during a sync stop publication and replacement', async () => {
      const cRoot = path.join(scratch, 'c'); await fs.mkdir(cRoot);
      const c = makeService('c', () => cRoot);
      await c.connect('google-drive'); await c.linkWorkspace({ provider: 'google-drive', workspaceId: workspace.id });
      const remote = drive.workspaces.get(workspace.id);
      const count = remote.commits.size;
      const result = await c.sync({ provider: 'google-drive', beforeApply: async () => { throw new Error('New editor changes'); } });
      assert.equal(result.ok, false); assert.equal(result.localFilesChanged, false);
      assert.equal(remote.commits.size, count);
      assert.equal(Object.keys(await scanWorkspace(cRoot)).length, 0);
    });
    await check('successful local saves schedule automatic uploads and failed saves do not', async () => {
      const dRoot = path.join(scratch, 'd'); await fs.mkdir(dRoot);
      const d = makeService('d', () => dRoot, { debounceMs: 10 });
      await d.connect('dropbox');
      const linked = await d.linkWorkspace({ provider: 'dropbox', name: 'Automatic uploads' });
      const remote = drive.workspaces.get(linked.workspace.id);
      const handlers = new Map(); let saveOk = true; let scheduled = 0;
      registerDataIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, fs,
        mainDataHelpers: { autoSaveDataFile: async () => ({ ok: saveOk }) },
        onWorkspaceSaved: root => { scheduled++; d.schedule(root); } });
      const save = () => handlers.get(STORAGE.AUTO_SAVE)({}, { data: { settings: { storagePath: dRoot } } });
      await fs.writeFile(path.join(dRoot, 'automatic.md'), 'first');
      await save();
      for (let attempt = 0; attempt < 100 && remote.commits.size === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(remote.commits.size, 1);
      saveOk = false;
      await fs.writeFile(path.join(dRoot, 'automatic.md'), 'second');
      assert.equal((await save()).ok, false);
      assert.equal(scheduled, 1, 'a failed durable save must not schedule a cloud upload');
      assert.equal(remote.commits.size, 1);
      saveOk = true;
      await save();
      for (let attempt = 0; attempt < 100 && remote.commits.size < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(remote.commits.size, 2);
      const commit = JSON.parse([...remote.commits.values()].at(-1));
      const manifest = JSON.parse(remote.objects.get(commit.manifest));
      assert.equal(remote.objects.get(manifest.files['automatic.md'].hash).toString(), 'second');
    });
    await check('HTTP refresh retries once and never returns provider token text in errors', async () => {
      let refreshes = 0; let requests = 0;
      const request = createCloudHttp({ getToken: async () => 'secret', refreshToken: async () => refreshes++,
        fetchImpl: async (_url, options) => {
          assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer secret');
          requests++; return new Response(requests === 1 ? 'TOKEN_SECRET' : '{}', { status: requests === 1 ? 401 : 200 });
        } });
      await request('https://www.googleapis.com/drive/v3/files');
      assert.equal(refreshes, 1); assert.equal(requests, 2);
      const failure = createCloudHttp({ getToken: async () => 'secret', refreshToken: async () => {},
        fetchImpl: async () => new Response('TOKEN_SECRET', { status: 403 }) });
      await assert.rejects(failure('https://example.test'), error => !error.message.includes('TOKEN_SECRET') && error.status === 403);
    });
    await check('Google Drive pagination, scoped folders, and resumable upload host validation', async () => {
      const requested = [];
      const api = createGoogleDrive(async (url, options) => {
        requested.push({ url, options });
        if (url.includes('uploadType=resumable')) return new Response(null, { headers: { location: 'https://evil.example/upload/token' } });
        const parsed = new URL(url);
        if (parsed.searchParams.get('q')?.includes("hikariWorkspace")) {
          return Response.json({ files: [{ id: parsed.searchParams.has('pageToken') ? 'second' : 'first', name: 'Workspace' }],
            ...(parsed.searchParams.has('pageToken') ? {} : { nextPageToken: 'page-two' }) });
        }
        if (parsed.searchParams.get('q')?.includes("mimeType")) return Response.json({ files: [{ id: 'objects', name: 'objects' }, { id: 'versions', name: 'versions' }] });
        return Response.json({ files: [] });
      });
      assert.equal((await api.listWorkspaces()).length, 2);
      const store = await api.openWorkspace({ id: 'valid-folder' });
      await assert.rejects(store.putObject(hashBytes(Buffer.from('x')), Buffer.from('x')), /Invalid Google Drive upload/);
      assert.equal(requested.some(item => item.url.startsWith('https://evil.example')), false);
    });
    await check('Dropbox Unicode argument headers, pagination, and chunked uploads', async () => {
      assert.equal(/[^\x00-\x7f]/.test(headerJson({ path: '/研究/😀' })), false);
      assert.equal(JSON.parse(headerJson({ path: '/研究/😀' })).path, '/研究/😀');
      const uploaded = [];
      const api = createDropbox(async (url, options) => {
        const body = options.body;
        if (url.endsWith('files/list_folder')) return Response.json({ entries: [], has_more: true, cursor: 'one' });
        if (url.endsWith('files/list_folder/continue')) return Response.json({ entries: [], has_more: false });
        if (url.endsWith('upload_session/start')) { uploaded.push(body); return Response.json({ session_id: 'session' }); }
        if (url.endsWith('upload_session/finish')) {
          const args = JSON.parse(options.headers['Dropbox-API-Arg']);
          assert.equal(args.cursor.offset, 8 * 1024 * 1024); assert.equal(args.commit.strict_conflict, true);
          uploaded.push(body); return Response.json({ id: 'upload' });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const store = await api.openWorkspace({ id: randomUUID() });
      const bytes = Buffer.alloc(8 * 1024 * 1024 + 128, 42);
      await store.putObject(hashBytes(bytes), bytes);
      assert.deepEqual(Buffer.concat(uploaded), bytes);
    });
    await check('cloud IPC accepts only the main Hikari window', async () => {
      const handlers = new Map(); const sender = {};
      registerCloudDriveIpc({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, cloudDrive: a,
        getMainWindow: () => ({ webContents: sender }) });
      assert.equal((await handlers.get(STORAGE.CLOUD_STATUS)({ sender: {} })).ok, false);
      assert.equal((await handlers.get(STORAGE.CLOUD_STATUS)({ sender })).ok, true);
      assert.equal((await handlers.get(STORAGE.CLOUD_CONNECT)({ sender }, { provider: '__proto__' })).ok, false);
    });
    await check('OAuth uses PKCE, checks callback state, and exchanges only the correct code', async () => {
      const config = getClientConfig('google-drive', environment);
      let exchange;
      const tokens = await authorize({ provider: 'google-drive', config,
        openExternal: async url => {
          const auth = new URL(url);
          assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
          assert.equal(auth.searchParams.get('access_type'), 'offline');
          const callback = new URL(auth.searchParams.get('redirect_uri'));
          callback.searchParams.set('state', 'wrong'); callback.searchParams.set('code', 'wrong-code');
          assert.equal((await fetch(callback)).status, 400);
          callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'correct-code');
          assert.equal((await fetch(callback)).status, 200);
        },
        fetchImpl: async (_url, options) => {
          exchange = options.body;
          return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
        }
      });
      assert.equal(tokens.refreshToken, 'refresh');
      assert.equal(exchange.get('code'), 'correct-code');
      assert.ok(exchange.get('code_verifier').length >= 43);
      const controller = new AbortController();
      await assert.rejects(authorize({ provider: 'google-drive', config, signal: controller.signal,
        openExternal: async () => controller.abort(), fetchImpl: async () => { throw new Error('Must not exchange after cancel'); } }), /canceled/);
    });
    console.log(`Cloud drive selfcheck passed (${checks} groups).`);
  } finally {
    for (const service of services) service.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
