'use strict';

const { randomUUID } = require('node:crypto');
const { readCloudBytes } = require('./http');
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
// Dropbox's HTTP argument header must be ASCII even for Unicode file names.
const headerJson = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

function createDropbox(request) {
  const rpc = async (route, body) => (await request(`${API}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })).json();
  const read = async (filePath, limit) => readCloudBytes(await request(`${CONTENT}/files/download`, {
    method: 'POST', headers: { 'Dropbox-API-Arg': headerJson({ path: filePath }) }
  }), limit);
  async function list(folderPath) {
    let data = await rpc('files/list_folder', { path: folderPath });
    const entries = [...data.entries];
    while (data.has_more) {
      data = await rpc('files/list_folder/continue', { cursor: data.cursor });
      entries.push(...data.entries);
    }
    return entries;
  }
  async function upload(filePath, bytes) {
    const commit = { path: filePath, mode: 'add', autorename: false, strict_conflict: true, mute: true };
    const chunkSize = 8 * 1024 * 1024;
    if (bytes.length <= chunkSize) {
      return (await request(`${CONTENT}/files/upload`, { method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson(commit) }, body: bytes })).json();
    }
    const start = await (await request(`${CONTENT}/files/upload_session/start`, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson({ close: false }) }, body: bytes.subarray(0, chunkSize) })).json();
    let offset = chunkSize;
    while (offset + chunkSize < bytes.length) {
      await request(`${CONTENT}/files/upload_session/append_v2`, { method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson({ cursor: { session_id: start.session_id, offset }, close: false }) },
        body: bytes.subarray(offset, offset + chunkSize) });
      offset += chunkSize;
    }
    return (await request(`${CONTENT}/files/upload_session/finish`, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerJson({ cursor: { session_id: start.session_id, offset }, commit }) },
      body: bytes.subarray(offset) })).json();
  }
  async function ensureRoot() {
    // Create only if the parent listing proves it is absent; a permission error
    // must not be mistaken for a missing folder.
    const entries = await list('');
    if (!entries.some(entry => entry['.tag'] === 'folder' && entry.name.toLowerCase() === 'hikari')) {
      await rpc('files/create_folder_v2', { path: '/Hikari', autorename: false });
    }
  }
  const workspacePath = workspace => {
    if (!/^[a-f0-9-]{36}$/.test(String(workspace.id))) throw new Error('Invalid Dropbox workspace.');
    return `/Hikari/${workspace.id}`;
  };
  return {
    account: async () => {
      const account = await rpc('users/get_current_account', null);
      return { id: account.account_id, name: account.email || account.name.display_name };
    },
    listWorkspaces: async () => {
      await ensureRoot();
      const workspaces = [];
      for (const entry of await list('/Hikari')) {
        if (entry['.tag'] !== 'folder' || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
        const metadata = JSON.parse((await read(`/Hikari/${entry.name}/workspace.json`)).toString('utf8'));
        workspaces.push({ id: entry.name, name: String(metadata.name || 'Workspace') });
      }
      return workspaces;
    },
    createWorkspace: async name => {
      await ensureRoot();
      const workspace = { id: randomUUID(), name };
      const root = workspacePath(workspace);
      for (const folder of [root, `${root}/objects`, `${root}/versions`]) {
        await rpc('files/create_folder_v2', { path: folder, autorename: false });
      }
      await upload(`${root}/workspace.json`, Buffer.from(JSON.stringify({ schema: 1, name })));
      return workspace;
    },
    openWorkspace: async workspace => {
      const root = workspacePath(workspace);
      const objects = new Set((await list(`${root}/objects`)).map(entry => entry.name));
      return {
        listCommits: async () => (await list(`${root}/versions`)).filter(entry => entry['.tag'] === 'file')
          .map(entry => ({ id: entry.path_lower, name: entry.name, signature: entry.rev })),
        readCommit: reference => read(reference.id, 65536),
        putCommit: (name, bytes) => upload(`${root}/versions/${name}`, bytes),
        hasObject: hash => objects.has(hash),
        putObject: async (hash, bytes) => {
          if (objects.has(hash)) return;
          try { await upload(`${root}/objects/${hash}`, bytes); }
          catch (error) {
            // Another device can upload the same immutable object first.
            if (error.status !== 409 || !(await read(`${root}/objects/${hash}`)).equals(bytes)) throw error;
          }
          objects.add(hash);
        },
        getObject: hash => read(`${root}/objects/${hash}`)
      };
    }
  };
}

module.exports = { createDropbox, headerJson };
