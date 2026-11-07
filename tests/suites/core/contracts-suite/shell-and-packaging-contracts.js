module.exports = function registerShellAndPackagingContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  const { assert, fs, path, test, shared, forgeConfig } = scope;
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

    test('view constants, index sections, and app registry stay in sync', () => {
      const html = readLocalSource('index.html');
      const registry = JSON.parse(readLocalSource('ui', 'config', 'app-registry.json'));
      const viewValues = Object.values(shared.VIEWS);
      const sectionViews = new Set([...html.matchAll(/<section id="([^"]+)" class="view"/g)].map((match) => match[1]));
      const navViews = new Set((registry.apps || []).map((app) => app.viewId));

      const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
      const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
      const missingNav = nonHomeViews.filter((value) => !navViews.has(value));
      const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

      assert.deepEqual(missingSections, []);
      assert.deepEqual(missingNav, []);
      assert.deepEqual(unknownNav, []);
      assert.match(html, /id="app-dock-nav"/);
      assert.match(html, /id="app-more-menu"/);
    });

    test('the app CSP admits the loopback origin served plugins run on', () => {
      for (const source of [
        readLocalSource('ui', 'html', 'shell', 'start.html'),
        readLocalSource('index.html')
      ]) {
        // Anchored on the directive itself — the comment above it also says
        // "frame-src", and matching that would assert nothing.
        const frameSrc = (source.match(/frame-src\s+('self'[^;]*);/) || [])[1] || '';
        assert.match(frameSrc, /http:\/\/127\.0\.0\.1:\*/, 'served plugins need loopback http in frame-src');
        assert.match(frameSrc, /'self'/, 'the app still frames its own pages');
        assert.doesNotMatch(frameSrc, /\shttps:(\s|$)/, 'remote plugins are not enabled: that is a separate decision');
      }
    });

    test('main window isolates the renderer and loads the split preload outside the OS sandbox', () => {
      const { createMainWindow } = require(path.join(__dirname, 'src', 'main', 'windows', 'create-main-window.js'));
      let options = null;
      const webContents = { setWindowOpenHandler() {}, on() {}, getURL: () => '', session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} } };
      createMainWindow({
        BrowserWindow: function BrowserWindowStub(windowOptions) {
          options = windowOptions;
          return { webContents, loadFile() {}, on() {} };
        },
        platform: 'win32',
        shell: { openExternal() {} },
        path,
        projectRoot: '/app',
        appIconPath: '/app/icon.png',
        preloadPath: '/app/preload.js'
      });
      // The preload is split across local CommonJS modules that Electron's
      // renderer sandbox cannot require, so sandbox stays off while context
      // isolation keeps Node out of the page itself.
      assert.equal(options.webPreferences.contextIsolation, true);
      assert.equal(options.webPreferences.nodeIntegration, false);
      assert.equal(options.webPreferences.sandbox, false);
      assert.equal(options.webPreferences.preload, '/app/preload.js');
    });

    test('main sql.js helpers resolve the bundled vendor asset from package-safe paths', () => {
      const { resolveSqlJsWasmJsPath } = require(path.join(__dirname, 'src', 'main', 'lib', 'sqljs-path.js'));
      const resolved = resolveSqlJsWasmJsPath(path.join(__dirname, 'src', 'main', 'storage'));
      assert.equal(resolved.endsWith(path.join('vendor', 'sqljs', 'sql-wasm.js')), true);
      assert.equal(fs.existsSync(resolved), true);
    });

    test('forge config prunes dev deps and ignores build artifacts', () => {
      assert.equal(Boolean(forgeConfig.packagerConfig.asar), true);
      const unpackDir = forgeConfig.packagerConfig.asar?.unpackDir || '';
      [
        /src\/main\/agent/,
        /src\/main\/storage/,
        /src\/main\/lib/,
        /src\/renderer\/lib/,
        /src\/renderer\/modules\/sequence-viewer/,
        /vendor\/sqljs/,
        /[{,]node_modules[,}]/
      ].forEach((pattern) => assert.match(unpackDir, pattern));
      assert.equal(forgeConfig.packagerConfig.prune, true);
      assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
      const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
      assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\.DS_Store/);
      assert.match(ignoreAsText, /hikari-data\\\.json/);
      assert.match(ignoreAsText, /TestData6/);
      assert.match(ignoreAsText, /TestData7/);
      assert.match(ignoreAsText, /artifacts/);
      assert.match(ignoreAsText, /examples/);
      assert.match(ignoreAsText, /_debug_/);
      assert.match(ignoreAsText, /\\\/data\(\$\|\\\/\)/);
    });

    test('docs stay out of the package: the tutorial is downloaded from its own repo', () => {
      const ignored = (file) => forgeConfig.packagerConfig.ignore.some((pattern) => pattern.test(file));
      ['/docs', '/docs/tutorial/index.html', '/docs/guide/README.md'].forEach((file) => assert.equal(ignored(file), true, `${file} should stay out`));
      assert.doesNotMatch(forgeConfig.packagerConfig.asar.unpackDir, /docs/);
    });

    test('package.json files lists plain paths, which the source build copies one by one', () => {
      // bin/source-build.js copies each included entry literally and rejects
      // globs, so narrowing a folder has to use "!" entries instead.
      const { files } = JSON.parse(readLocalSource('package.json'));
      assert.deepEqual(files.filter((entry) => !entry.startsWith('!') && /[*?{}]/.test(entry)), []);
      assert.ok(!files.some((entry) => entry.includes('docs/tutorial')));
    });

    test('Settings > Tutorial opens only a downloaded copy', async () => {
      const { registerSystemIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'));
      const { SYSTEM } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const openTutorial = async (installed) => {
        const handlers = new Map();
        const opened = [];
        registerSystemIpc({
          ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} },
          shell: { openPath: async (target) => { opened.push(target); return ''; } },
          tutorialDir: '/cache/tutorial',
          tutorial: { getTutorialStatus: () => ({ installed }) }
        });
        return { result: await handlers.get(SYSTEM.OPEN_TUTORIAL)(), opened };
      };
      const ready = await openTutorial({ commit: 'a'.repeat(40), date: '2026-11-07T00:00:00Z' });
      assert.deepEqual(ready.result, { ok: true, path: path.join('/cache/tutorial', 'index.html') });
      const missing = await openTutorial(null);
      assert.deepEqual(missing.result, { ok: false, error: 'Download the tutorial first.' });
      assert.deepEqual(missing.opened, []);
    });

    test('the tutorial downloads on request, records its version, and updates only when GitHub has a newer one', async () => {
      const tutorial = require(path.join(__dirname, 'src', 'main', 'lib', 'tutorial-download.js'));
      const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hikari-tutorial-'));
      const dir = path.join(folder, 'tutorial');
      let head = { sha: 'a'.repeat(40), date: '2026-11-07T10:00:00Z' };
      let online = true;
      const downloads = [];
      const fetchImpl = async (url) => {
        if (!online) throw new Error('fetch failed');
        if (url.includes('api.github.com')) return Response.json([{ sha: head.sha, commit: { committer: { date: head.date } } }]);
        downloads.push(url);
        return new Response(`page at ${url.slice(-40)}`);
      };
      const deps = { fetchImpl, extract: async (archive, target) => fs.writeFileSync(path.join(target, 'index.html'), archive) };
      const page = () => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      try {
        assert.deepEqual(tutorial.getTutorialStatus(dir), { status: 'not-downloaded', installed: null });
        assert.equal((await tutorial.checkTutorialUpdate(dir, deps)).status, 'not-downloaded');
        assert.equal(downloads.length, 0, 'checking never downloads');

        const first = await tutorial.installTutorial(dir, deps);
        assert.deepEqual(first.installed, { commit: head.sha, date: head.date });
        assert.equal(first.status, 'up-to-date');
        assert.equal(page(), `page at ${head.sha}`);
        assert.deepEqual(tutorial.getTutorialStatus(dir), { status: 'installed', installed: { commit: head.sha, date: head.date } });
        assert.equal((await tutorial.checkTutorialUpdate(dir, deps)).status, 'up-to-date');

        const old = head.sha;
        head = { sha: 'b'.repeat(40), date: '2026-11-20T10:00:00Z' };
        const check = await tutorial.checkTutorialUpdate(dir, deps);
        assert.equal(check.status, 'update-available');
        assert.equal(check.installed.commit, old);
        assert.equal(check.latest.commit, head.sha);
        assert.equal(page(), `page at ${old}`, 'a check leaves the installed copy alone');

        await tutorial.installTutorial(dir, deps);
        assert.equal(page(), `page at ${head.sha}`);
        assert.equal(downloads.length, 2);
        await tutorial.installTutorial(dir, deps);
        assert.equal(downloads.length, 2, 'installing the version already installed downloads nothing');

        online = false;
        const offline = await tutorial.checkTutorialUpdate(dir, deps);
        assert.equal(offline.status, 'error');
        assert.match(offline.error, /fetch failed/);
        assert.equal(offline.installed.commit, head.sha, 'offline keeps the downloaded copy');
        assert.equal((await tutorial.installTutorial(dir, deps)).status, 'error');
        assert.equal(page(), `page at ${head.sha}`);
        assert.deepEqual(fs.readdirSync(folder), ['tutorial'], 'no staging folders are left behind');

        // The real extractor strips GitHub's top-level folder from the tarball.
        const source = path.join(folder, 'src', 'hikari-tutorial-main');
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html>');
        const archive = require('node:child_process').execFileSync('tar', ['-czf', '-', '-C', path.dirname(source), 'hikari-tutorial-main']);
        const target = path.join(folder, 'extracted');
        fs.mkdirSync(target);
        await tutorial.extractTarGz(archive, target);
        assert.equal(fs.readFileSync(path.join(target, 'index.html'), 'utf8'), '<!doctype html>');
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    });

    test('the MCP stdio server boots under plain Node from unpacked files only', async () => {
      // Codex launches the server with an external Node that cannot read
      // app.asar, so every file it loads must live in an unpacked directory.
      const { execFileSync, spawn } = require('node:child_process');
      const root = fs.realpathSync(__dirname);
      const serverPath = path.join(root, 'src', 'main', 'agent', 'mcp-contract', 'stdio-server.js');
      const loaded = JSON.parse(execFileSync(process.execPath, [
        '-e',
        `require(${JSON.stringify(serverPath)}); process.stdout.write(JSON.stringify(Object.keys(require.cache)));`
      ], { encoding: 'utf8', timeout: 30000 }));
      const unpackDirs = forgeConfig.packagerConfig.asar.unpackDir.replace(/^\{|\}$/g, '').split(',');
      const packed = loaded
        .filter((file) => file.startsWith(`${root}${path.sep}`))
        .map((file) => file.slice(root.length + 1).split(path.sep).join('/'))
        .filter((file) => !unpackDirs.some((dir) => file.startsWith(`${dir}/`)));
      assert.deepEqual(packed, []);

      const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      const reply = await new Promise((resolve, reject) => {
        let out = '';
        let err = '';
        const timer = setTimeout(() => reject(new Error(`no initialize reply\n${err}`)), 30000);
        child.stderr.on('data', (chunk) => { err += chunk; });
        child.stdout.on('data', (chunk) => {
          out += chunk;
          if (out.includes('\n')) {
            clearTimeout(timer);
            resolve(JSON.parse(out.split('\n')[0]));
          }
        });
        child.stdin.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hikari-test', version: '0' } }
        })}\n`);
      }).finally(() => child.kill());
      assert.equal(reply.result?.serverInfo?.name, 'hikari-agent-mcp');
    });
};
