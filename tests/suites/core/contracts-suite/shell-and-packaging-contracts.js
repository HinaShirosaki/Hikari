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

    test('package manifest stays private and avoids redundant package entries', () => {
      assert.equal(packageManifest.private, true);
      assert.equal(packageManifest.devDependencies?.['onnxruntime-web'], undefined);
      assert.equal(packageManifest.scripts?.package, undefined);
      assert.match(packageManifest.scripts?.['package:app'] || '', /electron-forge package/);
      assert.match(packageManifest.scripts?.dist || '', /electron-forge make/);
      assert.match(packageManifest.scripts?.make || '', /electron-forge make/);
    });

    test('forge config prunes dev deps and ignores build artifacts', () => {
      assert.equal(Boolean(forgeConfig.packagerConfig.asar), true);
      const unpackDir = forgeConfig.packagerConfig.asar?.unpackDir || '';
      [
        /src\/main\/agent/,
        /src\/main\/storage/,
        /src\/main\/lib/,
        /vendor\/sqljs/,
        /node_modules\/@modelcontextprotocol\/sdk/
      ].forEach((pattern) => assert.match(unpackDir, pattern));
      assert.equal(forgeConfig.packagerConfig.prune, true);
      assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
      const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
      assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\.DS_Store/);
      assert.match(ignoreAsText, /hikari-data\(\?:\\\.ena\)\?\\\.json/);
      assert.match(ignoreAsText, /TestData6/);
      assert.match(ignoreAsText, /TestData7/);
      assert.match(ignoreAsText, /artifacts/);
      assert.match(ignoreAsText, /examples/);
      assert.match(ignoreAsText, /_debug_/);
      assert.match(ignoreAsText, /\\\/data\(\$\|\\\/\)/);
    });
  }
};
