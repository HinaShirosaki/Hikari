module.exports = function registerTelegramAndManifestContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('telegram bot internals normalize search and module parsing', () => {
      const internals = telegramBot._internals || {};
      assert.equal(typeof internals.getCommandArgs, 'function');
      assert.equal(typeof internals.getSearchTarget, 'function');
      assert.equal(typeof internals.splitFirstToken, 'function');

      assert.equal(internals.getCommandArgs('/search assay kinase inhibitor'), 'assay kinase inhibitor');
      assert.equal(internals.normalizeTokenKey('Sample Registry'), 'sample-registry');
      assert.equal(internals.getSearchTarget('assays').type, 'search-assays');
      assert.equal(internals.getSearchTarget('chemicals').type, 'search-chemicals');
      assert.deepEqual(internals.splitFirstToken('assay kinase inhibitor'), { first: 'assay', rest: 'kinase inhibitor' });
    });

    test('telegram bot internals suggest module names for typos', () => {
      const internals = telegramBot._internals || {};
      assert.equal(typeof internals.getModuleSuggestions, 'function');
      assert.equal(typeof internals.getModuleCatalog, 'function');
      assert.equal(typeof internals.levenshteinDistance, 'function');
      assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'protocols'));
      assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'biology'));
      assert.equal(internals.getModuleTarget('projects')?.viewId, 'biology-notebook-view');
      assert.ok(internals.getModuleSuggestions('protcols').includes('protocols'));
      assert.equal(internals.levenshteinDistance('assay', 'asay'), 1);
    });

    test('telegram bot project parsing avoids hardcoded target shorthands', () => {
      const internals = telegramBot._internals || {};
      assert.equal(typeof internals.parseProjectFromText, 'function');
      assert.equal(internals.parseProjectFromText('run this for project Atlas'), 'Atlas');
      assert.equal(internals.parseProjectFromText('run this on EGFR'), null);
    });

    test('package manifest includes scripts and dependencies required for portable installs', () => {
      assert.equal(packageManifest.scripts['build:ui'], 'node scripts/build-ui.mjs');
      assert.equal(packageManifest.scripts['check:css-colors'], 'node scripts/check-css-colors.mjs');
      assert.equal(packageManifest.scripts['check:dom-ids'], 'node scripts/check-dom-ids.mjs');
      assert.equal(packageManifest.scripts.start, 'npm run build:ui && electron-forge start');
      assert.equal(packageManifest.scripts.test, 'npm run build:ui && npm run check:css-colors && npm run check:dom-ids && node test.js');
      assert.equal(packageManifest.scripts.dist, 'npm run build:ui && electron-forge make');
      assert.equal(packageManifest.scripts['package:app'], 'npm run build:ui && electron-forge package');
      assert.equal(packageManifest.scripts.package, 'npm run build:ui && electron-forge package');
      assert.equal(packageManifest.scripts.make, 'npm run build:ui && electron-forge make');
      assert.equal(packageManifest.dependencies.telegraf, '^4.16.3');
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
