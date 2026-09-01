'use strict';

// Serves a plugin folder over http://127.0.0.1:<port> so a view or headless
// service plugin frame gets a real origin.
//
// Why this exists: a sandboxed frame without `allow-same-origin` is an opaque
// origin, and an opaque origin has no localStorage and no IndexedDB. Anything
// with a real runtime behind it (ImageJ.JS and every other WebAssembly app)
// cannot start without storage. Serving the folder over loopback and granting
// `allow-same-origin` gives the plugin its own working origin while leaving the
// host — which is `file://` — cross-origin and unreachable.
//
// One server per plugin, each on its own port, because a port is what separates
// origins. Sharing a port would put every served plugin in one origin and let
// them read each other's storage.

const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const LOOPBACK = '127.0.0.1';

// Kept deliberately small: these are the types a plugin actually needs, plus
// the ones CheerpJ-style runtimes fetch. Unknown types are served as
// octet-stream rather than guessed at.
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.jar': 'application/java-archive',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
});

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Maps a request URL to a file inside `rootPath`, or null if it escapes.
//
// This is the trust boundary: the URL comes from inside the plugin frame, which
// is untrusted. `%2e%2e%2f`, `../`, absolute paths, and symlinks pointing out of
// the folder all have to fail closed, so the decoded path is resolved and then
// checked to be a real descendant of the resolved root.
function resolveRequestPath(rootPath, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) {
    return null;
  }

  const relative = pathname.replace(/^\/+/, '') || 'index.html';
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relative);

  // path.resolve collapses '..', so a traversal lands outside `root` and is
  // caught here. The separator check stops '/plugins/foo-evil' matching
  // '/plugins/foo'.
  if (target !== root && !target.startsWith(root + path.sep)) {
    return null;
  }
  return target;
}

async function readServableFile(filePath) {
  // realpath resolves symlinks, so a link inside the folder pointing at
  // /etc/passwd is rejected rather than followed.
  const realPath = await fs.realpath(filePath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    return null;
  }
  return { realPath, size: stats.size };
}

function createPluginServer({ rootPath, host = LOOPBACK } = {}) {
  const root = path.resolve(String(rootPath || ''));

  const server = http.createServer(async (request, response) => {
    const send = (status, body = '') => {
      response.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        // A plugin's own origin should not be embeddable elsewhere, and none of
        // this should ever be cached across an edit-reload cycle.
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      response.end(body);
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, 'Method not allowed');
      return;
    }

    const target = resolveRequestPath(root, request.url || '/');
    if (!target) {
      send(403, 'Forbidden');
      return;
    }

    let servable = null;
    try {
      servable = await readServableFile(target);
    } catch {
      servable = null;
    }
    if (!servable) {
      send(404, 'Not found');
      return;
    }
    // realpath may have escaped the root via a symlink.
    if (servable.realPath !== root && !servable.realPath.startsWith(root + path.sep)) {
      send(403, 'Forbidden');
      return;
    }

    response.writeHead(200, {
      'content-type': contentTypeFor(servable.realPath),
      'content-length': servable.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fsSync.createReadStream(servable.realPath).pipe(response);
  });

  return {
    server,
    // Port 0 asks the OS for a free port; binding to loopback keeps the plugin
    // off the network.
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => {
        const address = server.address();
        resolve(`http://${host}:${address.port}/`);
      });
    }),
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

// One server per plugin id, reused across calls so a reload does not leak
// listeners.
function createPluginServerRegistry() {
  const servers = new Map();

  async function serve(pluginId, rootPath) {
    const id = String(pluginId || '').trim();
    const root = String(rootPath || '').trim();
    if (!id || !root || !path.isAbsolute(root)) {
      return { ok: false, error: 'A plugin id and absolute folder path are required.' };
    }
    const existing = servers.get(id);
    if (existing) {
      return { ok: true, baseUrl: existing.baseUrl };
    }
    try {
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) {
        return { ok: false, error: 'Plugin path is not a folder.' };
      }
      const instance = createPluginServer({ rootPath: root });
      const baseUrl = await instance.listen();
      servers.set(id, { instance, baseUrl });
      return { ok: true, baseUrl };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function closeAll() {
    const pending = [...servers.values()].map(({ instance }) => instance.close());
    servers.clear();
    await Promise.all(pending);
  }

  return { serve, closeAll, get size() { return servers.size; } };
}

module.exports = {
  createPluginServer,
  createPluginServerRegistry,
  resolveRequestPath,
  contentTypeFor
};
