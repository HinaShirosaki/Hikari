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
  let root = path.resolve(String(rootPath || ''));

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
    const stream = fsSync.createReadStream(servable.realPath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });

  return {
    server,
    // Port 0 asks the OS for a free port; binding to loopback keeps the plugin
    // off the network.
    listen: async () => {
      // Resolve the root as well as its files: an installed folder may itself
      // be a symlink (or live below one, such as /tmp on macOS).
      root = await fs.realpath(root);
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, () => {
          server.removeListener('error', reject);
          // An http.Server with no 'error' listener throws out of the main
          // process. Nothing here can recover a post-listen error, but the app
          // should not die for one.
          server.on('error', (error) => console.error('Plugin server error:', error));
          const address = server.address();
          resolve(`http://${host}:${address.port}/`);
        });
      });
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

// One server per plugin id, reused across calls so a reload does not leak
// listeners.
//
// `prepareOrigin(baseUrl)` is the host's chance to make a freshly bound origin
// safe to hand over. It is injected rather than done here so this module stays
// plain Node (and testable without Electron); see register-data-ipc.js.
function createPluginServerRegistry({ prepareOrigin = null } = {}) {
  const servers = new Map();
  const starts = new Map();

  async function start(id, requestedRoot) {
    try {
      const root = await fs.realpath(requestedRoot);
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) {
        return { ok: false, error: 'Plugin path is not a folder.' };
      }
      const existing = servers.get(id);
      if (existing?.root === root) {
        return { ok: true, baseUrl: existing.baseUrl };
      }
      const instance = createPluginServer({ rootPath: root });
      const baseUrl = await instance.listen();
      // The OS picks the port and the port is the whole origin, so a new server
      // can land on one a different plugin held in an earlier run. Hand the
      // origin over only after the host has prepared it; if that fails, keep
      // the plugin off the port rather than serving it a neighbour's storage.
      try {
        await prepareOrigin?.(baseUrl);
      } catch (error) {
        await instance.close();
        throw error;
      }
      servers.set(id, { instance, baseUrl, root });
      // A remove/re-add may reuse the id for a different folder. It needs a
      // new server and origin; never run the old code with the new grants.
      // Not awaited: close() stops accepting immediately but waits for in-flight
      // responses, and the caller must not wait on an old asset download to
      // finish before it can navigate the frame to the new server.
      void existing?.instance.close();
      return { ok: true, baseUrl };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function serve(pluginId, rootPath) {
    const id = String(pluginId || '').trim();
    const root = String(rootPath || '').trim();
    if (!id || !root || !path.isAbsolute(root)) {
      return { ok: false, error: 'A plugin id and absolute folder path are required.' };
    }
    // Serialize starts for an id so overlapping renderer reloads cannot leave
    // an untracked server or restore a stale folder after its replacement.
    const pending = (starts.get(id) || Promise.resolve()).then(() => start(id, root));
    starts.set(id, pending);
    try {
      return await pending;
    } finally {
      if (starts.get(id) === pending) starts.delete(id);
    }
  }

  async function closeAll() {
    await Promise.all(starts.values());
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
