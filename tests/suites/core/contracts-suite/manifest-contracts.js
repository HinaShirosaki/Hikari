module.exports = function registerManifestContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('the test gate runs every check and never stops at the first failure', () => {
      assert.equal(packageManifest.main, 'src/main/main.js');
      const mainEntrySource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'main.js'), 'utf8');
      assert.match(mainEntrySource, /require\(['"]\.\/app\/start-main-app['"]\)/);
      assert.match(mainEntrySource, /startMainApp\(\)/);

      // The gate builds the UI, then one runner covers lint, the static checks,
      // the selfchecks and the suites through a single reporter.
      assert.equal(packageManifest.scripts.test, 'npm run build:ui && node test.js');
      const runnerSource = fs.readFileSync(path.join(__dirname, 'test.js'), 'utf8');
      for (const check of ['lint', 'css-colors', 'dom-ids', 'source-layout']) assert.match(runnerSource, new RegExp(`'${check}'`));
      assert.ok(runnerSource.includes('/-selfcheck\\.(c?js|mjs)$/'));
      // A failing test records the exit code and moves on: one broken check must
      // not silently skip everything after it.
      assert.match(runnerSource, /catch \(error\) \{[\s\S]{0,300}?process\.exitCode = 1;\s*\}/);
    });
  }
};
