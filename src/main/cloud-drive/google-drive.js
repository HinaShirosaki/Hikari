'use strict';

const { randomUUID } = require('node:crypto');
const { readCloudBytes } = require('./http');
const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

function createGoogleDrive(request) {
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const id = value => {
    if (!/^[\w-]{1,200}$/.test(String(value))) throw new Error('Invalid Google Drive folder.');
    return String(value);
  };
  async function list(query) {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: `trashed = false and (${query})`, pageSize: '1000',
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,appProperties,version)', ...(pageToken ? { pageToken } : {}) });
      const data = await (await request(`${API}?${params}`)).json();
      if (data.incompleteSearch) throw new Error('Google Drive returned an incomplete file listing. Please retry.');
      files.push(...data.files);
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async function folder(name, parent, appProperties = {}) {
    return (await request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [id(parent)] } : {}), appProperties }) })).json();
  }
  async function upload(parent, name, bytes) {
    const response = await request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.length) },
      body: JSON.stringify({ name, parents: [id(parent)] })
    });
    const location = response.headers.get('location');
    const uploadUrl = new URL(location);
    if (uploadUrl.origin !== 'https://www.googleapis.com' || !uploadUrl.pathname.startsWith('/upload/')) {
      throw new Error('Invalid Google Drive upload session.');
    }
    return (await request(uploadUrl.href, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
  }
  async function openWorkspace(workspace) {
    const children = await list(`'${escape(id(workspace.id))}' in parents and mimeType = '${FOLDER}'`);
    const objects = children.find(file => file.name === 'objects');
    const commits = children.find(file => file.name === 'versions');
    if (!objects || !commits) throw new Error('The cloud workspace is incomplete. Reconnect to another workspace.');
    const objectFiles = await list(`'${escape(objects.id)}' in parents`);
    const byHash = new Map(objectFiles.map(file => [file.name, file.id]));
    return {
      listCommits: async () => (await list(`'${escape(commits.id)}' in parents`)).map(file => ({ ...file, signature: `${file.id}:${file.version}` })),
      readCommit: async reference => readCloudBytes(await request(`${API}/${id(reference.id)}?alt=media`), 65536),
      putCommit: (name, bytes) => upload(commits.id, name, bytes),
      hasObject: hash => byHash.has(hash),
      putObject: async (hash, bytes) => {
        if (!byHash.has(hash)) byHash.set(hash, (await upload(objects.id, hash, bytes)).id);
      },
      getObject: async hash => {
        const fileId = byHash.get(hash);
        if (!fileId) throw new Error('A cloud workspace file is missing. No local files were replaced.');
        return readCloudBytes(await request(`${API}/${id(fileId)}?alt=media`));
      }
    };
  }
  return {
    account: async () => {
      const data = await (await request('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)')).json();
      return { id: data.user.permissionId, name: data.user.emailAddress || data.user.displayName };
    },
    listWorkspaces: async () => (await list(`mimeType = '${FOLDER}' and appProperties has { key='hikariWorkspace' and value='v1' }`))
      .map(file => ({ id: file.id, name: file.name })),
    createWorkspace: async name => {
      const roots = await list(`mimeType = '${FOLDER}' and appProperties has { key='hikariCloudRoot' and value='v1' }`);
      const root = roots[0] || await folder('Hikari', '', { hikariCloudRoot: 'v1' });
      const workspace = await folder(name, root.id, { hikariWorkspace: 'v1', identity: randomUUID() });
      await folder('objects', workspace.id);
      await folder('versions', workspace.id);
      return { id: workspace.id, name: workspace.name };
    },
    openWorkspace
  };
}

module.exports = { createGoogleDrive };
