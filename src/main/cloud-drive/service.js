'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PROVIDERS, getClientConfig } = require('./config');
const { authorize, requestToken } = require('./oauth');
const { createCredentialStore } = require('./credentials');
const { createCloudHttp } = require('./http');
const { createGoogleDrive } = require('./google-drive');
const { createDropbox } = require('./dropbox');
const { withFileLock, writeFileAtomic } = require('../lib/shared-json-file');
const { withStorageRootWrite } = require('../storage/write-coordinator');
const { hashBytes, contentHash, validHash, validateFiles, scanWorkspace, readWorkspaceFile, sameFiles, sameContentFiles, mergeFiles, applyFiles } = require('./workspace-files');

const COMMIT_ID = /^\d{13}-[a-f0-9-]{36}$/;

function createCloudDriveService({ directory, safeStorage, getStorageRoot, openExternal,
  onChange = () => {}, env = process.env, fetchImpl = globalThis.fetch,
  credentialStore, authorizeImpl = authorize, providerFactory, debounceMs = 5000 }) {
  const credentials = credentialStore || createCredentialStore({ directory, safeStorage });
  const statePath = path.join(directory, 'cloud-workspaces.json');
  const loginControllers = new Map();
  const timers = new Map();
  const runtime = new Map();
  const mutex = `cloud-drive:${directory}`;
  let stopped = false;
  const providerConfig = provider => getClientConfig(provider, env);
  function providerId(value) {
    if (!Object.hasOwn(PROVIDERS, value)) throw new Error('Unsupported cloud drive.');
    return value;
  }
  async function readState() {
    try {
      const data = JSON.parse(await fs.readFile(statePath, 'utf8'));
      if (data.schema !== 1 || !data.links || !data.accounts) throw new Error('Invalid cloud connection settings.');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: 1, links: {}, accounts: {} };
      throw error;
    }
  }
  async function saveState(state) {
    await fs.mkdir(directory, { recursive: true });
    await writeFileAtomic(fs, statePath, JSON.stringify(state));
  }
  async function rootContext() {
    const configured = String(getStorageRoot() || '').trim();
    if (!configured) throw new Error('Choose a local workspace folder first.');
    const root = await fs.realpath(configured);
    const privateRoot = await fs.realpath(directory).catch(() => path.resolve(directory));
    const relation = path.relative(root, privateRoot);
    if (!relation || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation))) {
      throw new Error('Choose a workspace separate from Hikari’s private credential folder.');
    }
    const key = hashBytes(Buffer.from(process.platform === 'win32' ? root.toLowerCase() : root));
    const assertCurrent = async () => {
      if (stopped || !getStorageRoot() || await fs.realpath(getStorageRoot()) !== root) throw new Error('Workspace changed. Sync stopped; please retry in the current workspace.');
    };
    return { root, key, assertCurrent };
  }
  function report(key, provider, value) {
    runtime.set(`${key}:${provider}`, value);
    onChange();
  }
  async function client(provider) {
    const config = providerConfig(provider);
    const refresh = () => withFileLock(`${mutex}:token:${provider}`, async () => {
      const stored = await credentials.get(provider);
      if (!stored?.refreshToken || stored.clientId !== config.clientId) throw new Error('Please disconnect and sign in to the cloud drive again.');
      const next = await requestToken(config, { grant_type: 'refresh_token', refresh_token: stored.refreshToken }, fetchImpl);
      await credentials.set(provider, next);
      return next.accessToken;
    });
    const getToken = async () => {
      const stored = await credentials.get(provider);
      if (!stored || stored.clientId !== config.clientId) throw new Error('Please sign in to the cloud drive.');
      if (stored.expiresAt > Date.now() + 60000) return stored.accessToken;
      return refresh();
    };
    if (providerFactory) return providerFactory(provider);
    const request = createCloudHttp({ getToken, refreshToken: refresh, fetchImpl });
    return provider === 'google-drive' ? createGoogleDrive(request) : createDropbox(request);
  }
  async function status() {
    const state = await readState();
    let context = null;
    try { context = await rootContext(); } catch { /* No workspace yet. */ }
    const providers = [];
    for (const [id, info] of Object.entries(PROVIDERS)) {
      let connected = false;
      let error = '';
      try { connected = Boolean(await credentials.get(id)); } catch (failure) { error = failure.message; }
      const link = context ? state.links[context.key]?.[id] : null;
      providers.push({ id, name: info.name, configured: Boolean(providerConfig(id).clientId),
        secureStorage: credentials.available(), connected, account: state.accounts[id]?.name || '',
        signingIn: loginControllers.has(id), workspace: link?.workspace || null,
        lastSyncedAt: link?.lastSyncedAt || '',
        ...(runtime.get(`${context?.key}:${id}`) || { phase: connected && link ? 'idle' : 'disconnected', error }) });
    }
    return { ok: true, storagePath: context?.root || '', providers };
  }
  async function connect(value) {
    const provider = providerId(value);
    if (stopped) throw new Error('Cloud drive service stopped.');
    if (loginControllers.has(provider)) throw new Error('Sign-in is already in progress.');
    if (!credentials.available()) throw new Error('Secure credential storage is unavailable.');
    const controller = new AbortController();
    loginControllers.set(provider, controller);
    onChange();
    try {
      const tokens = await authorizeImpl({ provider, config: providerConfig(provider), openExternal,
        signal: controller.signal, fetchImpl });
      if (controller.signal.aborted || stopped) throw new Error('Cloud sign-in canceled.');
      return await withFileLock(mutex, async () => {
        if (controller.signal.aborted) throw new Error('Cloud sign-in canceled.');
        await credentials.set(provider, tokens);
        try {
          const account = await (await client(provider)).account();
          const state = await readState();
          const previous = state.accounts[provider];
          if (previous?.id && previous.id !== account.id) {
            for (const links of Object.values(state.links)) delete links[provider];
          }
          state.accounts[provider] = account;
          await saveState(state);
          return { ok: true };
        } catch (error) {
          await credentials.set(provider, null);
          throw error;
        }
      });
    } finally { loginControllers.delete(provider); onChange(); }
  }
  function cancelLogin(value) {
    loginControllers.get(providerId(value))?.abort();
    return { ok: true };
  }
  async function disconnect(value) {
    const provider = providerId(value);
    cancelLogin(provider);
    return withFileLock(mutex, async () => {
      const state = await readState();
      for (const [key, links] of Object.entries(state.links)) {
        delete links[provider];
        runtime.delete(`${key}:${provider}`);
      }
      delete state.accounts[provider];
      await credentials.set(provider, null);
      await saveState(state);
      onChange();
      return { ok: true };
    });
  }
  async function listWorkspaces(value) {
    const provider = providerId(value);
    return { ok: true, workspaces: await (await client(provider)).listWorkspaces() };
  }
  async function linkWorkspace({ provider: value, workspaceId = '', name = '' }) {
    const provider = providerId(value);
    const context = await rootContext();
    return withFileLock(mutex, async () => {
      await context.assertCurrent();
      const api = await client(provider);
      let workspace;
      if (workspaceId) {
        workspace = (await api.listWorkspaces()).find(item => item.id === workspaceId);
        if (!workspace) throw new Error('Select a Hikari workspace from this cloud account.');
      } else workspace = await api.createWorkspace(String(name || path.basename(context.root)).trim().slice(0, 120) || 'Workspace');
      await context.assertCurrent();
      const state = await readState();
      state.links[context.key] ||= {};
      state.links[context.key][provider] = { workspace, files: {}, commits: {}, lastCommit: '', lastSyncedAt: '' };
      await saveState(state);
      report(context.key, provider, { phase: 'idle', error: '' });
      return { ok: true, workspace };
    });
  }
  async function unlinkWorkspace(value) {
    const provider = providerId(value);
    const context = await rootContext();
    return withFileLock(mutex, async () => {
      const state = await readState();
      delete state.links[context.key]?.[provider];
      await saveState(state);
      report(context.key, provider, { phase: 'idle', error: '' });
      return { ok: true };
    });
  }

  async function loadGraph(store, cache) {
    const commits = new Map();
    for (const reference of await store.listCommits()) {
      if (!reference.name.endsWith('.json')) continue;
      const expectedId = reference.name.slice(0, -5);
      if (!COMMIT_ID.test(expectedId)) throw new Error('Cloud workspace contains an invalid version.');
      const signature = reference.signature || '';
      let commit = cache[expectedId]?.signature === signature ? cache[expectedId].commit : null;
      if (!commit) {
        const bytes = await store.readCommit(reference);
        if (bytes.length > 65536) throw new Error('Cloud version is too large.');
        commit = JSON.parse(bytes.toString('utf8'));
      }
      if (commit.schema !== 1 || commit.id !== expectedId || !validHash(commit.manifest)
        || !Array.isArray(commit.parents) || commit.parents.some(parent => !COMMIT_ID.test(parent))) throw new Error('Invalid cloud version.');
      commits.set(commit.id, commit);
      cache[commit.id] = { signature, commit };
    }
    const parents = new Set([...commits.values()].flatMap(commit => commit.parents));
    for (const parent of parents) if (!commits.has(parent)) throw new Error('Cloud version history is incomplete. Please restore missing versions in your drive.');
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error('Cloud version history contains a cycle.');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parent of commits.get(id).parents) visit(parent);
      visiting.delete(id); visited.add(id);
    }
    for (const id of commits.keys()) visit(id);
    const heads = [...commits.values()].filter(commit => !parents.has(commit.id)).sort((left, right) => left.id.localeCompare(right.id));
    if (commits.size && !heads.length) throw new Error('Cloud version history is invalid.');
    return { heads, commits };
  }
  function commonAncestor(ids, commits) {
    function ancestors(id) {
      const found = new Set();
      const pending = [id];
      while (pending.length) {
        const current = pending.pop();
        if (found.has(current)) continue;
        const commit = commits.get(current);
        if (!commit) throw new Error('The last synced cloud version is missing. Reconnect this workspace.');
        found.add(current);
        pending.push(...commit.parents);
      }
      return found;
    }
    if (!ids.length) return null;
    const sets = ids.map(ancestors);
    const shared = [...sets[0]].filter(id => sets.every(set => set.has(id)));
    const nearest = shared.filter(id => !shared.some(other => other !== id && ancestors(other).has(id)));
    // Multiple merge bases are rare. An empty base conservatively reports
    // conflicts instead of guessing which scientific record takes precedence.
    return nearest.length === 1 ? commits.get(nearest[0]) : null;
  }
  async function readManifest(store, hash) {
    const bytes = await store.getObject(hash);
    if (bytes.length > 16 * 1024 * 1024 || hashBytes(bytes) !== hash) throw new Error('Cloud workspace manifest verification failed.');
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.schema !== 1) throw new Error('Unsupported cloud workspace format.');
    const files = validateFiles(manifest.files);
    for (const [relativePath, file] of Object.entries(files)) {
      if (!file.contentHash) continue;
      const content = await store.getObject(file.hash);
      if (content.length !== file.size || hashBytes(content) !== file.hash || contentHash(relativePath, content) !== file.contentHash) {
        throw new Error('Cloud record content verification failed.');
      }
    }
    return files;
  }
  async function sync({ provider: value, background = false, resolution = '', conflictId = '', beforeApply = async () => {} }) {
    const provider = providerId(value);
    if (resolution && !['local', 'cloud'].includes(resolution)) throw new Error('Invalid cloud conflict resolution.');
    const context = await rootContext();
    return withFileLock(mutex, () => withStorageRootWrite(context.root, async () => {
      const state = await readState();
      const link = state.links[context.key]?.[provider];
      if (!link) throw new Error('Connect this workspace to a cloud drive first.');
      report(context.key, provider, { phase: 'syncing', error: '' });
      let localFilesChanged = false;
      try {
        await context.assertCurrent();
        const store = await (await client(provider)).openWorkspace(link.workspace);
        const { heads, commits } = await loadGraph(store, link.commits);
        if (background && (heads.length > 1 || (heads[0]?.id || '') !== link.lastCommit)) {
          report(context.key, provider, { phase: 'updates', error: '' });
          return { ok: true, updatesAvailable: true };
        }
        const local = await scanWorkspace(context.root);
        const remotes = [];
        for (const head of heads) remotes.push(await readManifest(store, head.manifest));
        const ancestor = link.lastCommit ? commonAncestor([link.lastCommit, ...heads.map(head => head.id)], commits) : null;
        const base = ancestor ? await readManifest(store, ancestor.manifest) : {};
        const plan = mergeFiles(base, local, remotes, resolution);
        if (plan.conflicts.length && (!resolution || conflictId !== plan.conflictId)) {
          report(context.key, provider, { phase: 'conflicts', error: '', conflicts: plan.conflicts });
          return { ok: false, conflicts: plan.conflicts, conflictId: plan.conflictId };
        }
        const byHash = new Map(Object.entries(local).map(([filePath, file]) => [file.hash, filePath]));
        const getObject = async hash => {
          const localPath = byHash.get(hash);
          const bytes = localPath ? await readWorkspaceFile(context.root, localPath) : await store.getObject(hash);
          if (!bytes || hashBytes(bytes) !== hash) throw new Error('Workspace file verification failed. Please retry.');
          return bytes;
        };
        const manifestBytes = Buffer.from(JSON.stringify({ schema: 1, files: plan.files }));
        const manifestHash = hashBytes(manifestBytes);
        const alreadyPublished = heads.length === 1 && sameContentFiles(plan.files, remotes[0]);
        let commit = heads[0];
        if (!alreadyPublished) {
          for (const file of Object.values(plan.files)) {
            if (!store.hasObject(file.hash)) await store.putObject(file.hash, await getObject(file.hash));
          }
          await store.putObject(manifestHash, manifestBytes);
          await context.assertCurrent();
          if (!sameFiles(local, await scanWorkspace(context.root))) throw new Error('Local files changed while syncing. Please retry.');
          const latest = await loadGraph(store, link.commits);
          if (latest.heads.map(head => head.id).join() !== heads.map(head => head.id).join()) throw new Error('Another device synced during this operation. Please retry.');
          await beforeApply();
          commit = { schema: 1, id: `${Date.now()}-${randomUUID()}`, parents: heads.map(head => head.id), manifest: manifestHash };
          // Only this small commit makes a complete upload discoverable. An
          // interrupted object upload never replaces a published version.
          await store.putCommit(`${commit.id}.json`, Buffer.from(JSON.stringify(commit)));
          link.commits[commit.id] = { signature: '', commit };
        }
        await context.assertCurrent();
        const applied = await applyFiles({ root: context.root, before: local, after: plan.files, getObject,
          assertCurrent: context.assertCurrent, beforeApply });
        localFilesChanged = applied.changed > 0;
        await context.assertCurrent();
        link.files = plan.files;
        link.lastCommit = commit.id;
        link.lastSyncedAt = new Date().toISOString();
        await saveState(state);
        report(context.key, provider, { phase: 'synced', error: '' });
        return { ok: true, downloaded: applied.changed, recoveryPath: applied.recoveryPath, storagePath: context.root };
      } catch (error) {
        report(context.key, provider, { phase: 'error', error: error.message });
        return { ok: false, error: error.message, localFilesChanged: localFilesChanged || error.localFilesChanged === true, storagePath: context.root };
      }
    }));
  }
  function schedule(storagePath) {
    if (stopped || !storagePath) return;
    clearTimeout(timers.get(storagePath));
    const timer = setTimeout(async () => {
      timers.delete(storagePath);
      try {
        const context = await rootContext();
        if (path.resolve(storagePath) !== path.resolve(getStorageRoot())) return;
        const state = await readState();
        for (const provider of Object.keys(state.links[context.key] || {})) await sync({ provider, background: true });
      } catch { /* A root switch or disconnected drive must not affect saving. */ }
    }, debounceMs);
    timer.unref?.();
    timers.set(storagePath, timer);
  }
  function stop() {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const controller of loginControllers.values()) controller.abort();
  }
  return { status, connect, cancelLogin, disconnect, listWorkspaces, linkWorkspace, unlinkWorkspace, sync, schedule, stop };
}

module.exports = { createCloudDriveService };
