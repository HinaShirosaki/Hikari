module.exports = function registerManifestContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('the test gate runs every check and never stops at the first failure', () => {
      assert.equal(packageManifest.main, 'src/main/main.js');
      const mainEntrySource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
      assert.match(mainEntrySource, /require\(['"]\.\/app\/start-main-app['"]\)/);
      assert.match(mainEntrySource, /startMainApp\(\)/);

      // The gate builds the UI, runs the static checks, then the test runner.
      assert.match(packageManifest.scripts.test, /^npm run build:ui/);
      assert.match(packageManifest.scripts.test, /npm run test:checks/);
      assert.match(packageManifest.scripts.test, /node test\.js/);
      assert.match(packageManifest.scripts['test:checks'], /check:css-colors[\s\S]*check:dom-ids[\s\S]*check:source-layout[\s\S]*check:selfchecks/);
      // Neither level may && past a failure: one broken check must not silently
      // skip every check after it, nor the whole suite run.
      assert.doesNotMatch(packageManifest.scripts.test, /test:checks\s*&&/);
      assert.doesNotMatch(packageManifest.scripts['test:checks'], /&&/);
    });
  }
};
