module.exports = function registerManifestContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('package manifest includes scripts and dependencies required for portable installs', () => {
      assert.equal(packageManifest.scripts['build:ui'], 'node scripts/build-ui.mjs');
      assert.equal(packageManifest.scripts['check:css-colors'], 'node scripts/check-css-colors.mjs');
      assert.equal(packageManifest.scripts['check:dom-ids'], 'node scripts/check-dom-ids.mjs');
      assert.equal(packageManifest.scripts.start, 'npm run build:ui && electron-forge start');
      assert.equal(packageManifest.scripts['check:source-layout'], 'node scripts/check-source-layout.mjs');
      // The gate builds the UI, runs the static checks, then the test runner.
      assert.match(packageManifest.scripts.test, /^npm run build:ui/);
      assert.match(packageManifest.scripts.test, /npm run test:checks/);
      assert.match(packageManifest.scripts.test, /node test\.js/);
      assert.match(packageManifest.scripts['test:checks'], /check:css-colors[\s\S]*check:dom-ids[\s\S]*check:source-layout[\s\S]*check:selfchecks/);
      // Neither level may && past a failure: one broken check must not silently
      // skip every check after it, nor the whole suite run.
      assert.doesNotMatch(packageManifest.scripts.test, /test:checks\s*&&/);
      assert.doesNotMatch(packageManifest.scripts['test:checks'], /&&/);
      assert.equal(packageManifest.scripts.dist, 'npm run build:ui && electron-forge make');
      assert.equal(packageManifest.scripts['package:app'], 'npm run build:ui && electron-forge package');
      assert.equal(packageManifest.scripts.package, 'npm run build:ui && electron-forge package');
      assert.equal(packageManifest.scripts.make, 'npm run build:ui && electron-forge make');
      assert.equal(packageManifest.dependencies.telegraf, undefined);
      assert.equal(packageManifest.dependencies['electron-squirrel-startup'], '^1.0.1');
      assert.equal(packageManifest.devDependencies.electron, '^40.7.0');
      assert.equal(Boolean(packageManifest.devDependencies['@electron-forge/cli']), true);
    });

    test('DOM id references in source map to markup or approved dynamic IDs', () => {
      const resolveLocalImport = (fromPath, specifier) => {
        const raw = String(specifier || '').trim();
        if (!raw.startsWith('.')) {
          return '';
        }
        const candidate = path.resolve(path.dirname(fromPath), raw);
        return path.extname(candidate) ? candidate : `${candidate}.js`;
      };
      const collectLocalImportSpecifiers = (source) => {
        const specifiers = new Set();
        const importRegex = /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;
        let match;
        while ((match = importRegex.exec(source))) {
          if (String(match[1] || '').startsWith('.')) {
            specifiers.add(match[1]);
          }
        }
        return [...specifiers];
      };
      const collectReachableSourceFiles = (entryPath, visited = new Set()) => {
        if (!entryPath || visited.has(entryPath) || !fs.existsSync(entryPath) || !entryPath.endsWith('.js')) {
          return [];
        }
        visited.add(entryPath);
        const source = fs.readFileSync(entryPath, 'utf8');
        const files = [entryPath];
        collectLocalImportSpecifiers(source).forEach((specifier) => {
          const resolvedPath = resolveLocalImport(entryPath, specifier);
          if (!resolvedPath) {
            return;
          }
          files.push(...collectReachableSourceFiles(resolvedPath, visited));
        });
        return files;
      };

      const sourceFiles = collectReachableSourceFiles(path.join(__dirname, 'src', 'renderer', 'renderer.js'));
      const htmlFiles = [path.join(__dirname, 'index.html')];

      const referencedIds = new Set();
      sourceFiles.forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
        let match;
        while ((match = re.exec(source))) {
          referencedIds.add(match[1]);
        }
      });

      const markupIds = new Set();
      htmlFiles.forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        const re = /id\s*=\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = re.exec(source))) {
          markupIds.add(match[1]);
        }
      });

      const allowedDynamic = new Set([
        'exit-btn',
        'sample-loc-freezer',
        'sample-loc-rack',
        'sample-loc-box',
        'sample-loc-position',
        'sample-loc-fridge',
        'sample-loc-shelf',
        'sample-loc-desiccator',
        'sample-loc-desiccator-position',
        'sample-loc-cabinet',
        'sample-loc-cabinet-slot'
      ]);

      const missing = [...referencedIds].filter((id) => !markupIds.has(id));
      const unexpected = missing.filter((id) => !allowedDynamic.has(id));
      assert.deepEqual(unexpected, []);
    });
  }
};
