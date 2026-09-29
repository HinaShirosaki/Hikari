'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  MAX_BYTES, MAX_ENTRIES, digest, snapshotHash, fail, inside, relativePath, checkPolicy,
  rootIdentity, resolveTarget, readBytes, snapshot
} = require('./paths.js');

const WRITES = new Set(['create', 'write', 'mkdir', 'move', 'trash']);
const READS = new Set(['status', 'list', 'read', 'search']);
// Files the agent creates are ordinary user documents (Finder's default); only
// Hikari's own state and recovery snapshots stay owner-only (0o600).
const CREATED_FILE_MODE = 0o644;
const responseError = error => ({ ok: false, status: error.status || error.code || 'failed', error: error.message });

function createWorkspaceFileService({ getStorageRoot, getStorageRootRevision = () => 0, privateDirectory, onChange = () => {} }) {
  const store = path.resolve(privateDirectory, 'AgentFileAccess');
  let state;
  let queue = Promise.resolve();
  let generation = 0;
  let activeIdentity = '';
  const sessions = new Map();
  const requests = new Map();

  function serial(work) {
    const run = queue.then(work).catch(responseError);
    queue = run.then(() => {});
    return run;
  }
  async function load() {
    if (state) return;
    await fs.mkdir(store, { recursive: true, mode: 0o700 });
    let loaded;
    try { loaded = JSON.parse(await fs.readFile(path.join(store, 'state.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      loaded = { version: 1, policies: {}, pending: [], history: [] };
    }
    if (loaded.version !== 1 || !loaded.policies || !Array.isArray(loaded.pending) || !Array.isArray(loaded.history)) {
      fail('invalid_policy', 'The file-access policy could not be loaded.');
    }
    state = loaded;
    // Pending approvals are bound to this application run, never replayed after a restart.
    state.pending = [];
  }
  async function save() {
    const temp = path.join(store, `${randomUUID()}.tmp`);
    try {
      // Pending proposals (full content + before snapshot) are run-bound and
      // dropped on load, so they are never written to disk.
      await durableFile(temp, JSON.stringify({ ...state, pending: [] }));
      await fs.rename(temp, path.join(store, 'state.json'));
    } finally { await fs.unlink(temp).catch(() => {}); }
    try { onChange(); } catch { /* A closed window must not undo a saved policy. */ }
  }
  async function durableFile(file, content, mode = 0o600) {
    const handle = await fs.open(file, 'wx', mode);
    try { await handle.writeFile(content); await handle.chmod(mode); await handle.sync(); }
    finally { await handle.close(); }
  }
  async function current() {
    await load();
    const root = await rootIdentity(getStorageRoot(), path.resolve(privateDirectory));
    const identity = `${root.identity}:${getStorageRootRevision()}`;
    if (identity !== activeIdentity) {
      activeIdentity = identity;
      generation += 1;
      sessions.clear();
      requests.clear();
      state.pending = [];
    }
    return { ...root, generation };
  }
  function policy(root) {
    return state.policies[root.identity] || { mode: 'read-only', folders: [], locations: [] };
  }
  async function location(root, id = '') {
    if (!id || id === 'workspace') return root;
    const grant = policy(root).locations.find(item => item.id === id);
    if (!grant) fail('outside_workspace', 'This location has not been granted in Hikari Settings.');
    const target = await rootIdentity(grant.root, path.resolve(privateDirectory));
    if (target.identity !== grant.identity) fail('root_changed', 'The granted folder has changed. Grant it again in Settings.');
    return target;
  }
  async function assertCurrent(root, targetRoot, locationId) {
    const now = await current();
    const target = await location(now, locationId);
    if (root.generation !== now.generation || target.identity !== targetRoot.identity) {
      fail('root_changed', 'Workspace access changed. Start the operation again.');
    }
  }
  function publicPending(item) {
    const { before, args, ...visible } = item;
    const previous = before.entries?.[0]?.type === 'file' ? Buffer.from(before.entries[0].data, 'base64') : null;
    const binary = args.encoding === 'base64' || Boolean(previous?.includes(0));
    return { ...visible, preview: {
      binary,
      before: !binary && previous ? previous.toString('utf8').slice(0, 12000) : '',
      after: !binary && ['create', 'write'].includes(args.action) ? args.content.slice(0, 12000) : '',
      truncated: (before.bytes || 0) > 12000 || (args.content?.length || 0) > 12000,
      entries: before.entries.map(entry => entry.path || args.path).slice(0, 100),
      count: before.entries.length
    } };
  }
  async function status() {
    const root = await current();
    for (const record of state.history.filter(item => item.rootId === root.identity && ['prepared', 'undoing'].includes(item.status))) {
      await reconcile(record, root);
    }
    return { ok: true, root: root.root, root_id: root.identity, ...policy(root),
      pending: state.pending.map(publicPending),
      recovery_directory: store,
      history: state.history.filter(item => item.rootId === root.identity).slice(-50).reverse() };
  }
  async function authorizeSettings(input) {
    const root = await current();
    if (input.root_id !== root.identity) fail('root_changed', 'The storage folder changed. Reload these settings.');
    return root;
  }
  function revokePending() {
    generation += 1;
    sessions.clear();
    requests.clear();
    state.pending = [];
  }
  async function settings(input) {
    const root = await authorizeSettings(input);
    const next = structuredClone(policy(root));
    if (input.action === 'mode') {
      if (!['read-only', 'workspace-write'].includes(input.mode)) fail('invalid_mode', 'Choose a valid access mode.');
      next.mode = input.mode;
      // Switching to read-only also revokes remembered exceptions.
      if (input.mode === 'read-only') { next.folders = []; next.locations = []; }
    } else if (input.action === 'revoke') {
      next.folders = [];
      next.locations = [];
      next.mode = 'read-only';
    } else if (input.action === 'add-location') {
      const additional = await rootIdentity(input.path, path.resolve(privateDirectory));
      if (inside(root.root, additional.root) || inside(additional.root, root.root)) fail('invalid_root', 'Choose a separate folder.');
      if (!next.locations.some(item => item.identity === additional.identity)) {
        next.locations.push({ id: randomUUID(), ...additional });
      }
    } else fail('invalid_action', 'Unknown permission change.');
    const previous = state.policies[root.identity];
    state.policies[root.identity] = next;
    revokePending();
    try { await save(); }
    catch (error) { state.policies[root.identity] = previous; throw error; }
    return status();
  }
  async function read(root, args) {
    const entry = await resolveTarget(root.root, args.path || '', { allowRoot: true });
    if (args.action === 'read') {
      const bytes = await readBytes(entry.target);
      const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
      return { ok: true, status: 'read', path: entry.relative, content: bytes.toString(encoding), encoding, hash: digest(bytes) };
    }
    if (!entry.stat.isDirectory()) fail('invalid_path', 'Choose a folder to list or search.');
    const items = [];
    const query = String(args.query || '').toLowerCase();
    if (args.action === 'search' && !query) fail('invalid_arguments', 'Provide literal search text.');
    let visited = 0;
    let scannedBytes = 0;
    let truncated = false;
    const skipped = [];
    async function walk(relative) {
      const folder = await resolveTarget(root.root, relative, { allowRoot: true });
      for (const child of await fs.readdir(folder.target)) {
        if (++visited > MAX_ENTRIES || items.length >= 100 || scannedBytes >= MAX_BYTES) { truncated = true; break; }
        const childPath = relative ? `${relative}/${child}` : child;
        try {
          const target = await resolveTarget(root.root, childPath);
          if (args.action === 'list') {
            items.push({ path: childPath, type: target.stat.isDirectory() ? 'directory' : 'file', bytes: target.stat.size });
          } else if (target.stat.isDirectory()) await walk(childPath);
          else {
            const bytes = await readBytes(target.target);
            scannedBytes += bytes.length;
            const text = bytes.includes(0) ? '' : bytes.toString('utf8');
            const index = text.toLowerCase().indexOf(query);
            if (childPath.toLowerCase().includes(query) || index >= 0) items.push({ path: childPath, excerpt: index < 0 ? '' : text.slice(Math.max(0, index - 100), index + 300) });
          }
        } catch (error) { skipped.push({ path: childPath, status: error.status || error.code }); }
      }
    }
    await walk(entry.relative);
    return { ok: true, status: args.action, items, truncated, skipped, complete: !truncated && !skipped.length };
  }
  function normalizeWrite(input) {
    if (!WRITES.has(input.action)) fail('invalid_action', 'Unknown file operation.');
    const args = { action: input.action, path: relativePath(input.path), location_id: String(input.location_id || 'workspace') };
    checkPolicy(args.path, true);
    if (input.action === 'move') {
      args.destination = relativePath(input.destination);
      checkPolicy(args.destination, true);
      if (args.destination === args.path || args.destination.startsWith(`${args.path}/`)) fail('invalid_path', 'Choose a destination outside the source folder.');
    }
    if (['create', 'write'].includes(args.action)) {
      if (typeof input.content !== 'string') fail('invalid_arguments', 'Provide file content.');
      args.encoding = input.encoding === 'base64' ? 'base64' : 'utf8';
      args.content = input.content;
      if (input.content.length > MAX_BYTES * 1.4) fail('size_limit', 'Content exceeds the file size limit.');
      const bytes = Buffer.from(args.content, args.encoding);
      if (bytes.length > MAX_BYTES) fail('size_limit', 'Content exceeds the file size limit.');
      if (args.encoding === 'base64' && bytes.toString('base64') !== args.content) fail('invalid_arguments', 'Provide canonical base64 content.');
    }
    if (args.action === 'write') {
      if (!/^[a-f0-9]{64}$/u.test(input.expected_hash || '')) fail('conflict', 'Read the file first and supply its expected_hash.');
      args.expected_hash = input.expected_hash;
    }
    return args;
  }
  async function prepare(root, targetRoot, args, session) {
    const before = await snapshot(targetRoot.root, args.path, { write: true });
    if (['create', 'mkdir'].includes(args.action) && before.exists) fail('conflict', 'The destination already exists.');
    if (['write', 'move', 'trash'].includes(args.action) && !before.exists) fail('ENOENT', 'The source no longer exists.');
    if (args.action === 'write' && (before.entries[0].type !== 'file'
      || digest(Buffer.from(before.entries[0].data, 'base64')) !== args.expected_hash)) fail('conflict', 'The file changed since it was read. Read it again before editing.');
    if (args.destination && (await snapshot(targetRoot.root, args.destination, { write: true })).exists) fail('conflict', 'The destination already exists.');
    return { id: randomUUID(), rootId: root.identity, root: root.root, locationRoot: targetRoot.root,
      locationIdentity: targetRoot.identity, generation: root.generation, sessionId: session.id,
      action: args.action, path: args.path, destination: args.destination || '', location_id: args.location_id,
      createdAt: new Date().toISOString(), before, args };
  }
  async function materialize(root, relative, entries) {
    for (const entry of entries) {
      const child = entry.path ? `${relative}/${entry.path}` : relative;
      const target = await resolveTarget(root, child, { write: true, missing: true });
      if (target.stat) fail('conflict', 'A restore destination already exists.');
      if (entry.type === 'directory') await fs.mkdir(target.target);
      else await durableFile(target.target, Buffer.from(entry.data, 'base64'), entry.mode ?? 0o600);
    }
  }
  function expectedAfter(proposal) {
    const { args, before } = proposal;
    if (args.action === 'trash') return 'absent';
    if (args.action === 'move') return before.hash;
    const entries = args.action === 'mkdir' ? [{ path: '', type: 'directory' }]
      : [{ path: '', type: 'file', data: Buffer.from(args.content, args.encoding).toString('base64'),
        mode: args.action === 'write' ? before.entries[0].mode : CREATED_FILE_MODE }];
    return snapshotHash(entries);
  }
  async function reconcile(record, root) {
    try {
      const targetRoot = await location(root, record.location_id);
      if (record.locationIdentity !== targetRoot.identity) fail('root_changed', 'The recovery folder has changed.');
      const original = await snapshot(targetRoot.root, record.path, { write: true });
      const destination = record.destination ? await snapshot(targetRoot.root, record.destination, { write: true }) : null;
      const isBefore = original.hash === record.beforeHash && (!destination || !destination.exists);
      const isAfter = (destination || original).hash === record.afterHash && (!destination || !original.exists);
      if (record.status === 'undoing' && isBefore) { record.undone = true; record.status = 'completed'; }
      else if (isAfter) record.status = 'completed';
      else record.status = isBefore ? 'not-applied' : 'interrupted';
    } catch (error) { record.status = 'interrupted'; record.error = error.message; }
    await save();
  }
  async function apply(proposal) {
    const root = await current();
    if (root.identity !== proposal.rootId || root.generation !== proposal.generation) fail('root_changed', 'The workspace or permissions changed. Request a new proposal.');
    const targetRoot = await location(root, proposal.location_id);
    if (targetRoot.identity !== proposal.locationIdentity) fail('root_changed', 'The target folder changed.');
    const { args, before } = proposal;
    if ((await snapshot(targetRoot.root, args.path, { write: true })).hash !== before.hash) fail('conflict', 'The source changed. Request a new proposal.');
    if (args.destination && (await snapshot(targetRoot.root, args.destination, { write: true })).exists) fail('conflict', 'The destination already exists.');
    // Persist recovery before touching user content. Backups stay outside the workspace.
    const backup = path.join(store, `${proposal.id}.json`);
    const serialized = JSON.stringify(proposal);
    try { await durableFile(backup, serialized); }
    catch (error) {
      if (error.code !== 'EEXIST' || await fs.readFile(backup, 'utf8') !== serialized) throw error;
    }
    const record = { id: proposal.id, rootId: root.identity, root: root.root, locationRoot: targetRoot.root,
      location_id: proposal.location_id, locationIdentity: targetRoot.identity, action: args.action,
      path: args.path, destination: args.destination || '', beforeHash: before.hash, afterHash: expectedAfter(proposal),
      at: new Date().toISOString(), undone: false, status: 'prepared' };
    const pending = state.pending;
    state.history.push(record);
    state.pending = state.pending.filter(item => item.id !== proposal.id);
    try { await save(); }
    catch (error) { state.history.pop(); state.pending = pending; throw error; }
    try {
      await assertCurrent(root, targetRoot, proposal.location_id);
      if ((await snapshot(targetRoot.root, args.path, { write: true })).hash !== before.hash) fail('conflict', 'The source changed during preparation. Request a new proposal.');
      const target = await resolveTarget(targetRoot.root, args.path, { write: true, missing: !before.exists });
      if (args.action === 'mkdir') await fs.mkdir(target.target);
      else if (args.action === 'create') {
        const temporary = path.join(path.dirname(target.target), `.hikari-create-${proposal.id}`);
        try {
          await durableFile(temporary, Buffer.from(args.content, args.encoding), CREATED_FILE_MODE);
          await assertCurrent(root, targetRoot, proposal.location_id);
          await resolveTarget(targetRoot.root, args.path, { write: true, missing: true });
          // Exclusive publication prevents clobbering a newly created destination.
          await fs.link(temporary, target.target);
        } finally { await fs.unlink(temporary).catch(() => {}); }
      } else if (args.action === 'write') {
        const temporary = path.join(path.dirname(target.target), `.hikari-write-${randomUUID()}`);
        try {
          await durableFile(temporary, Buffer.from(args.content, args.encoding), before.entries[0].mode ?? 0o600);
          await assertCurrent(root, targetRoot, proposal.location_id);
          if ((await snapshot(targetRoot.root, args.path, { write: true })).hash !== before.hash) fail('conflict', 'The file changed during the write.');
          await fs.rename(temporary, target.target);
        } finally { await fs.unlink(temporary).catch(() => {}); }
      } else if (args.action === 'move') {
        const destination = await resolveTarget(targetRoot.root, args.destination, { write: true, missing: true });
        if (destination.stat) fail('conflict', 'The destination already exists.');
        await fs.rename(target.target, destination.target);
      } else if (args.action === 'trash') {
        // A same-parent rename removes the complete tree atomically. The durable
        // snapshot above is the recovery source, including on another volume.
        const parked = path.join(path.dirname(target.target), `.hikari-trash-${proposal.id}`);
        await fs.rename(target.target, parked);
        await fs.rm(parked, { recursive: true }).catch(() => {});
      }
      const afterPath = args.destination || args.path;
      const after = await snapshot(targetRoot.root, afterPath, { write: true });
      if (after.hash !== record.afterHash) fail('conflict', 'The file changed immediately after the operation. Recovery is retained.');
      record.status = 'completed';
      await save();
      return { ok: true, status: 'completed', ...record, recovery_id: record.id };
    } catch (error) {
      record.error = error.message;
      // A failed final journal save must not hide an already applied change.
      record.status = 'prepared';
      try { await reconcile(record, root); } catch { record.status = 'interrupted'; }
      return { ...responseError(error), recovery_id: record.id, recovery_status: record.status };
    }
  }
  async function execute(input = {}, token = '') {
    const root = await current();
    const session = sessions.get(token);
    if (!session || session.generation !== root.generation || Date.now() > session.expires) {
      fail('session_expired', 'Start a new Hikari chat turn to access workspace files.');
    }
    if (!session.enabled) fail('disabled', 'Workspace files is disabled for this run.');
    if (input.action === 'status') return { ok: true, root: root.root, mode: policy(root).mode,
      can_write: session.write, locations: [{ id: 'workspace', root: root.root }, ...policy(root).locations] };
    const targetRoot = await location(root, input.location_id);
    if (READS.has(input.action)) return read(targetRoot, input);
    const args = normalizeWrite(input);
    if (!session.write) fail('read_only_run', 'This background or helper run has read-only file access.');
    if (!/^[\w-]{1,120}$/u.test(input.request_id || '')) fail('invalid_arguments', 'Provide a unique request_id. Retry uncertain calls with the same arguments and request_id.');
    const key = `${token}:${input.request_id}`;
    const hash = digest(JSON.stringify(args));
    const prior = requests.get(key);
    if (prior) {
      if (prior.hash !== hash) fail('conflict', 'request_id was already used for different changes.');
      return prior.result;
    }
    if (requests.size > 1000) fail('size_limit', 'Start another chat turn before making more file changes.');
    const proposal = await prepare(root, targetRoot, args, session);
    const p = policy(root);
    const remembered = p.folders.some(grant => grant.location_id === args.location_id
      && args.path.startsWith(`${grant.path}/`) && (!args.destination || args.destination.startsWith(`${grant.path}/`))
      && grant.action === args.action);
    let result;
    if (remembered || (p.mode === 'workspace-write' && args.action !== 'trash')) result = await apply(proposal);
    else {
      if (state.pending.length >= 50) fail('size_limit', 'Review pending file changes before requesting more.');
      state.pending.push(proposal);
      try { await save(); }
      catch (error) { state.pending = state.pending.filter(item => item !== proposal); throw error; }
      result = { ok: true, status: 'awaiting_approval', proposal_id: proposal.id, path: args.path,
        message: 'Review this change in Hikari’s File changes panel. Nothing has been changed yet.' };
    }
    requests.set(key, { hash, result });
    return result;
  }
  async function review(input) {
    const root = await authorizeSettings(input);
    const proposal = state.pending.find(item => item.id === input.id);
    if (!proposal) fail('expired_proposal', 'This proposal was already handled or expired.');
    if (input.decision === 'deny') {
      state.pending = state.pending.filter(item => item.id !== proposal.id);
      await save();
      requests.forEach(entry => { if (entry.result.proposal_id === proposal.id) entry.result = { ok: true, status: 'denied', proposal_id: proposal.id }; });
      return { ok: true, status: 'denied' };
    }
    if (!['once', 'folder'].includes(input.decision)) fail('invalid_action', 'Choose Allow once, Allow in folder, or Deny.');
    const result = await apply(proposal);
    requests.forEach(entry => { if (entry.result.proposal_id === proposal.id) entry.result = result; });
    if (input.decision === 'folder' && result.ok) {
      const parent = path.posix.dirname(proposal.path);
      if (parent !== '.') {
        const p = structuredClone(policy(root));
        p.folders.push({ path: parent, action: proposal.action, location_id: proposal.location_id });
        const previous = state.policies[root.identity];
        state.policies[root.identity] = p;
        try { await save(); }
        catch (error) { state.policies[root.identity] = previous; return { ...result, warning: `Change applied, but the folder grant was not saved: ${error.message}` }; }
      }
    }
    return result;
  }
  async function undo(input) {
    const root = await authorizeSettings(input);
    const record = state.history.find(item => item.id === input.id && item.rootId === root.identity);
    if (!record || record.undone) fail('expired_recovery', 'This change is unavailable or already restored.');
    if (record.status && record.status !== 'completed') fail('recovery_required', 'This operation was interrupted. Inspect the saved recovery snapshot before restoring manually.');
    const targetRoot = await location(root, record.location_id);
    if (record.locationIdentity !== targetRoot.identity) fail('root_changed', 'The recovery folder has changed.');
    const saved = JSON.parse(await fs.readFile(path.join(store, `${record.id}.json`), 'utf8'));
    const afterPath = record.destination || record.path;
    if ((await snapshot(targetRoot.root, afterPath, { write: true })).hash !== record.afterHash) fail('conflict', 'The file changed after this operation. Undo would overwrite newer work.');
    await assertCurrent(root, targetRoot, record.location_id);
    record.status = 'undoing';
    try { await save(); }
    catch (error) { record.status = 'completed'; throw error; }
    try {
      if (record.action === 'move') {
        const source = await resolveTarget(targetRoot.root, record.destination, { write: true });
        const destination = await resolveTarget(targetRoot.root, record.path, { write: true, missing: true });
        if (destination.stat) fail('conflict', 'The original path is occupied.');
        await fs.rename(source.target, destination.target);
      } else if (record.action === 'trash') await materialize(targetRoot.root, record.path, saved.before.entries);
      else {
        const target = await resolveTarget(targetRoot.root, record.path, { write: true });
        if (record.action === 'mkdir') await fs.rmdir(target.target);
        else if (record.action === 'create') await fs.unlink(target.target);
        else {
          const temporary = path.join(path.dirname(target.target), `.hikari-restore-${randomUUID()}`);
          try {
            await durableFile(temporary, Buffer.from(saved.before.entries[0].data, 'base64'), saved.before.entries[0].mode ?? 0o600);
            await assertCurrent(root, targetRoot, record.location_id);
            if ((await snapshot(targetRoot.root, record.path, { write: true })).hash !== record.afterHash) fail('conflict', 'The file changed during restore.');
            await fs.rename(temporary, target.target);
          } finally { await fs.unlink(temporary).catch(() => {}); }
        }
      }
      record.undone = true;
      record.status = 'completed';
      await save();
      return { ok: true, status: 'restored', path: record.path };
    } catch (error) {
      record.status = 'undoing';
      try { await reconcile(record, root); } catch { record.status = 'interrupted'; }
      return { ...responseError(error), recovery_id: record.id, recovery_status: record.status };
    }
  }
  return {
    status: () => serial(status),
    settings: input => serial(() => settings(input)),
    review: input => serial(() => review(input)),
    undo: input => serial(() => undo(input)),
    execute: (input, token) => serial(() => execute(input, token)),
    beginSession: options => serial(async () => {
      const root = await current();
      const token = randomUUID();
      sessions.set(token, { id: String(options.id || ''), generation: root.generation,
        write: options.write === true, enabled: options.enabled !== false, expires: Date.now() + 60 * 60 * 1000 });
      return { ok: true, token };
    }),
    endSession(token) {
      sessions.delete(token);
      for (const key of requests.keys()) if (key.startsWith(`${token}:`)) requests.delete(key);
    }
  };
}

module.exports = { createWorkspaceFileService };
