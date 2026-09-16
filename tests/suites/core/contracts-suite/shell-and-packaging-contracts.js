module.exports = function registerShellAndPackagingContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

    test('view constants, index sections, and app registry stay in sync', () => {
      const html = readLocalSource('index.html');
      const registry = JSON.parse(readLocalSource('ui', 'config', 'app-registry.json'));
      const viewValues = Object.values(shared.VIEWS);
      const sectionViews = new Set([...html.matchAll(/<section id="([^"]+)" class="view"/g)].map((match) => match[1]));
      const navViews = new Set((registry.apps || []).map((app) => app.viewId));

      const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
      const navRequiredViews = nonHomeViews.filter((value) => value !== shared.VIEWS.PERSONAL_INVENTORY);
      const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
      const missingNav = navRequiredViews.filter((value) => !navViews.has(value));
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

    test('main window keeps the renderer sandboxed behind the split preload', () => {
      const source = readLocalSource('src', 'main', 'windows', 'create-main-window.js');
      assert.match(source, /contextIsolation:\s*true/);
      assert.match(source, /nodeIntegration:\s*false/);
      assert.match(source, /sandbox:\s*false/);
      assert.match(source, /preload:\s*preloadPath/);
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
  }
};
