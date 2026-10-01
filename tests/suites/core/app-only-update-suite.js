module.exports = function registerAppOnlyUpdateSuite(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const EventEmitter = require('node:events');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { satisfiesRange } = require('../../../src/main/updater/version');
  const { resolveNpmReleaseMetadata } = require('../../../src/main/updater/release-metadata');
  const {
    MANIFEST_FILE, findNewerAppCode, getLoadedAppCode, loadNewerAppCode
  } = require('../../../src/main/updater/app-code');
  const { createNpmUpdaterService } = require('../../../src/main/updater/create-npm-updater-service');

  const LOADED_KEY = Symbol.for('hikari.appCode');

  // An installed copy as installAppCode leaves it.
  function writeCopy(root, name, { version = name, electron = '^40.7.0', manifest = true, entryFile = true } = {}) {
    const dir = path.join(root, name);
    const appDir = path.join(dir, 'node_modules', '@hinashirosaki', 'hikari');
    fs.mkdirSync(path.join(appDir, 'src', 'main'), { recursive: true });
    if (entryFile) fs.writeFileSync(path.join(appDir, 'src', 'main', 'main.js'), '');
    if (manifest) {
      fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify({
        version, electron, entry: path.join('node_modules', '@hinashirosaki', 'hikari', 'src', 'main', 'main.js')
      }));
    }
    return path.join(appDir, 'src', 'main', 'main.js');
  }

  test('app-only update: an Electron range check covers ^, ~, >= and exact, and refuses anything else', () => {
    assert.equal(satisfiesRange('40.9.2', '^40.7.0'), true);
    assert.equal(satisfiesRange('40.6.1', '^40.7.0'), false, 'older than the floor');
    assert.equal(satisfiesRange('41.0.0', '^40.7.0'), false, 'another major');
    assert.equal(satisfiesRange('40.7.3', '~40.7.0'), true);
    assert.equal(satisfiesRange('40.8.0', '~40.7.0'), false);
    assert.equal(satisfiesRange('41.2.0', '>=40.7.0'), true);
    assert.equal(satisfiesRange('40.7.0', '40.7.0'), true);
    assert.equal(satisfiesRange('40.7.1', '40.7.0'), false);
    assert.equal(satisfiesRange('40.7.1', '40.x || 41.x'), false, 'unsupported syntax means a full rebuild');
    assert.equal(satisfiesRange(undefined, '^40.7.0'), false, 'not running in Electron');
    assert.equal(resolveNpmReleaseMetadata({
      'dist-tags': { latest: '1.2.0' },
      versions: { '1.2.0': { version: '1.2.0', devDependencies: { electron: '^40.7.0' } } }
    }).electronRange, '^40.7.0');
  });

  test('app-only update: the loader runs the newest downloaded copy this Electron can run, else the bundled code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-app-code-'));
    const codeRoot = path.join(root, 'app-code');
    const wanted = writeCopy(codeRoot, '1.2.0');
    writeCopy(codeRoot, '1.3.0', { electron: '^41.0.0' });
    writeCopy(codeRoot, '1.4.0', { manifest: false });
    writeCopy(codeRoot, '1.5.0', { entryFile: false });
    writeCopy(codeRoot, '.install-abc', { version: '1.6.0' });
    writeCopy(codeRoot, '1.0.0');
    assert.equal(findNewerAppCode({ root: codeRoot, bundledVersion: '1.1.0', electronVersion: '40.9.2' }).entry, wanted);
    assert.equal(findNewerAppCode({ root: codeRoot, bundledVersion: '1.2.0', electronVersion: '40.9.2' }), null);

    let version = '1.1.0';
    const app = { isPackaged: true, getPath: () => root, getVersion: () => version, setVersion: (next) => { version = next; } };
    const loaded = [];
    try {
      assert.equal(loadNewerAppCode({ app, electronVersion: '40.9.2', load: (entry) => loaded.push(entry) }), true);
      assert.deepEqual(loaded, [wanted]);
      assert.equal(version, '1.2.0', 'app.getVersion() reports the code that runs');
      assert.deepEqual(getLoadedAppCode(), { version: '1.2.0', dir: path.join(codeRoot, '1.2.0'), bundledVersion: '1.1.0' });
      // The copy's own main.js calls the loader again and must go on to start.
      assert.equal(loadNewerAppCode({ app, electronVersion: '40.9.2', load: () => assert.fail('loaded twice') }), false);
    } finally {
      delete globalThis[LOADED_KEY];
    }

    // A copy that throws while loading falls back to the bundled code.
    version = '1.1.0';
    const errors = [];
    assert.equal(loadNewerAppCode({
      app, electronVersion: '40.9.2', logError: (message) => errors.push(message),
      load: () => { throw new Error('Cannot find module'); }
    }), false);
    assert.equal(version, '1.1.0');
    assert.equal(getLoadedAppCode(), null);
    assert.match(errors[0], /Hikari 1\.2\.0 .* failed to load; starting the bundled 1\.1\.0/);

    // A dev checkout never runs downloaded code.
    assert.equal(loadNewerAppCode({ app: { ...app, isPackaged: false }, electronVersion: '40.9.2', load: () => assert.fail('dev') }), false);
  });

  // One update from 1.1.0 to 1.2.0 on Electron 40.9.2. `npm` and the UI build are faked.
  async function runUpdate({ electronRange = '^40.7.0', npmFails = false, installedElectron = electronRange } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-app-only-'));
    const appBundle = path.join(root, 'Applications', 'Hikari.app');
    fs.mkdirSync(path.join(appBundle, 'Contents', 'MacOS'), { recursive: true });
    const calls = { spawn: [], relaunch: 0, quit: 0, warnings: [] };
    const quitEvents = new EventEmitter();
    const app = {
      isPackaged: true,
      getVersion: () => '1.1.0',
      getPath: () => root,
      once: (event, fn) => quitEvents.once(event, fn),
      relaunch: () => { calls.relaunch += 1; },
      quit: () => { calls.quit += 1; quitEvents.emit('will-quit'); }
    };
    const spawn = (command, args, options) => {
      calls.spawn.push({ command, args, options });
      const child = new EventEmitter();
      let code = 0;
      if (args.includes('install')) {
        const prefix = args[args.indexOf('--prefix') + 1];
        const appDir = path.join(prefix, 'node_modules', '@hinashirosaki', 'hikari');
        fs.mkdirSync(path.join(appDir, 'src', 'main'), { recursive: true });
        fs.writeFileSync(path.join(appDir, 'src', 'main', 'main.js'), '');
        fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
          version: '1.2.0', main: 'src/main/main.js', devDependencies: { electron: installedElectron }
        }));
        code = npmFails ? 1 : 0;
      } else if (String(args[0]).endsWith('build-ui.mjs')) {
        fs.writeFileSync(path.join(options.cwd, 'index.html'), '<!doctype html>');
      } else {
        // The full build (npx).
        const built = path.join(options.cwd, 'hikari-out', 'Hikari-darwin-arm64', 'Hikari.app', 'Contents');
        fs.mkdirSync(built, { recursive: true });
      }
      setImmediate(() => child.emit('exit', code, null));
      return child;
    };
    const updater = createNpmUpdaterService({
      app,
      dialog: { showMessageBox: async () => ({ response: 0 }), showErrorBox: (title, content) => assert.fail(content) },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.2.0' },
          versions: { '1.2.0': { version: '1.2.0', devDependencies: { electron: electronRange } } }
        })
      }),
      spawn, allowDevelopment: true, platform: 'darwin', electronVersion: '40.9.2',
      execPath: path.join(appBundle, 'Contents', 'MacOS', 'Hikari'),
      resolveNode: () => '/opt/homebrew/bin/node',
      warn: (...args) => calls.warnings.push(args.map(String).join(' '))
    });
    const result = await updater.checkForUpdates();
    return { result, calls, root, codeRoot: path.join(root, 'app-code'), status: updater.getStatus() };
  }

  test('app-only update: a release on the same Electron is installed with npm into app-code and Hikari relaunches into it', async () => {
    const { result, calls, codeRoot, status } = await runUpdate();
    assert.equal(result.action, 'restarting');
    assert.equal(status.installKind, 'app');
    const [install, buildUi] = calls.spawn;
    assert.equal(calls.spawn.length, 2, 'no full build');
    assert.equal(install.command, '/opt/homebrew/bin/npm');
    assert.deepEqual(install.args.slice(0, 2), ['install', '@hinashirosaki/hikari@1.2.0']);
    for (const flag of ['--omit=dev', '--ignore-scripts']) assert.ok(install.args.includes(flag));
    assert.ok(install.options.env.PATH.startsWith('/opt/homebrew/bin:'));
    assert.equal(buildUi.command, '/opt/homebrew/bin/node');
    assert.equal(buildUi.options.cwd, path.join(codeRoot, path.basename(install.options.cwd), 'node_modules', '@hinashirosaki', 'hikari'));

    const copy = findNewerAppCode({ root: codeRoot, bundledVersion: '1.1.0', electronVersion: '40.9.2' });
    assert.equal(copy.dir, path.join(codeRoot, '1.2.0'));
    assert.ok(fs.existsSync(path.join(copy.dir, 'node_modules', '@hinashirosaki', 'hikari', 'index.html')), 'UI built');
    assert.deepEqual(fs.readdirSync(codeRoot), ['1.2.0'], 'the staging folder was renamed into place');
    assert.equal(calls.relaunch, 1);
    assert.equal(calls.quit, 1);
  });

  test('app-only update: a release that needs another Electron gets the full rebuild', async () => {
    const { result, calls, status } = await runUpdate({ electronRange: '^41.0.0' });
    assert.equal(result.action, 'restarting');
    assert.equal(status.installKind, 'full');
    assert.equal(calls.spawn.length, 1);
    assert.equal(calls.spawn[0].command, '/opt/homebrew/bin/npx');
  });

  test('app-only update: a failed npm install, or a package for another Electron, falls back to the full rebuild', async () => {
    for (const options of [{ npmFails: true }, { installedElectron: '^41.0.0' }]) {
      const { result, calls, codeRoot, status } = await runUpdate(options);
      assert.equal(result.action, 'restarting');
      assert.equal(status.installKind, 'full');
      assert.equal(calls.spawn.at(-1).command, '/opt/homebrew/bin/npx');
      assert.match(calls.warnings[0], /App-only update to Hikari 1\.2\.0 failed; rebuilding the whole app instead/);
      assert.equal(findNewerAppCode({ root: codeRoot, bundledVersion: '1.1.0', electronVersion: '40.9.2' }), null);
    }
  });

  test('app-only update: after startup, copies not newer than the running code are removed, but never the running one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-app-code-prune-'));
    const codeRoot = path.join(root, 'app-code');
    for (const version of ['1.1.0', '1.2.0', '1.3.0']) writeCopy(codeRoot, version);
    const updater = createNpmUpdaterService({
      app: { isPackaged: true, getVersion: () => '1.2.0', getPath: () => root },
      fetchImpl: async () => ({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.2.0' }, versions: { '1.2.0': { version: '1.2.0' } } }) }),
      startupDelayMs: 0,
      getLoadedAppCode: () => ({ version: '1.2.0', dir: path.join(codeRoot, '1.2.0') })
    });
    updater.start();
    for (let i = 0; i < 50 && fs.existsSync(path.join(codeRoot, '1.1.0')); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(fs.readdirSync(codeRoot).sort(), ['1.2.0', '1.3.0']);
    updater.stop();
  });
};
