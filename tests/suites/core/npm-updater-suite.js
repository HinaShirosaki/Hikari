module.exports = function registerNpmUpdaterSuite(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const EventEmitter = require('node:events');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    createNpmUpdaterService, findBuild, resolveNpxInvocation
  } = require('../../../src/main/updater/create-npm-updater-service');

  test('npm updater runs npx next to node (npm entrypoint on Windows) and finds the build bin/dist.js leaves', () => {
    assert.deepEqual(resolveNpxInvocation('/opt/homebrew/bin/node', 'darwin'), { command: '/opt/homebrew/bin/npx', args: [] });
    assert.deepEqual(resolveNpxInvocation('C:\\Program Files\\nodejs\\node.exe', 'win32'), {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js']
    });

    // bin/dist.js output: forge package's bundle on macOS, only HikariSetup.exe on Windows.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-out-'));
    fs.mkdirSync(path.join(out, 'Hikari-darwin-arm64', 'Hikari.app', 'Contents'), { recursive: true });
    fs.mkdirSync(path.join(out, 'Hikari-win32-x64'));
    fs.writeFileSync(path.join(out, 'Hikari-win32-x64', 'HikariSetup.exe'), '');
    assert.equal(findBuild(out, 'darwin'), path.join(out, 'Hikari-darwin-arm64', 'Hikari.app'));
    assert.equal(findBuild(out, 'win32'), path.join(out, 'Hikari-win32-x64', 'HikariSetup.exe'));
    assert.equal(findBuild(out, 'linux'), '');
    assert.equal(findBuild(path.join(out, 'missing'), 'darwin'), '');
  });

  test('npm updater asks once, then builds with npx, swaps the bundle at quit, and relaunches', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-updater-'));
    const appBundle = path.join(root, 'Applications', 'Hikari.app');
    fs.mkdirSync(path.join(appBundle, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(appBundle, 'Contents', 'version'), '1.0.2');
    fs.mkdirSync(path.join(root, 'tmp'));

    const calls = { spawn: [], dialogs: [], relaunch: 0, quit: 0 };
    const quitEvents = new EventEmitter();
    const app = {
      isPackaged: true,
      getVersion: () => '1.0.2',
      getPath: () => path.join(root, 'tmp'),
      once: (event, fn) => quitEvents.once(event, fn),
      relaunch: () => { calls.relaunch += 1; },
      quit: () => { calls.quit += 1; quitEvents.emit('will-quit'); }
    };
    const dialog = {
      showMessageBox: async (options) => { calls.dialogs.push(options.buttons.join('/')); return { response: 0 }; },
      showErrorBox: (title, content) => { calls.dialogs.push(`error: ${content}`); }
    };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ name: '@hinashirosaki/hikari', 'dist-tags': { latest: '1.0.3' }, versions: { '1.0.3': { version: '1.0.3' } } })
    });
    const spawn = (command, args, options) => {
      calls.spawn.push({ command, args, options });
      const built = path.join(options.cwd, 'hikari-out', 'Hikari-darwin-arm64', 'Hikari.app', 'Contents');
      fs.mkdirSync(built, { recursive: true });
      fs.writeFileSync(path.join(built, 'version'), '1.0.3');
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    };

    const updater = createNpmUpdaterService({
      app, dialog, fetchImpl, spawn, allowDevelopment: true, platform: 'darwin',
      execPath: path.join(appBundle, 'Contents', 'MacOS', 'Hikari'), resolveNode: () => '/opt/homebrew/bin/node'
    });
    const result = await updater.checkForUpdates();

    assert.equal(result.status, 'ready');
    assert.equal(result.action, 'restarting');
    assert.deepEqual(calls.dialogs, ['Update/Later']);
    const [build] = calls.spawn;
    assert.equal(build.command, '/opt/homebrew/bin/npx');
    assert.deepEqual(build.args, ['--yes', '@hinashirosaki/hikari@1.0.3']);
    assert.ok(build.options.env.PATH.startsWith('/opt/homebrew/bin:'));
    assert.equal(calls.relaunch, 1);
    assert.equal(calls.quit, 1);
    assert.equal(fs.readFileSync(path.join(appBundle, 'Contents', 'version'), 'utf8'), '1.0.3');
    const parked = path.join(build.options.cwd, 'hikari-out', 'Hikari-darwin-arm64', 'Hikari.app.previous');
    assert.equal(fs.readFileSync(path.join(parked, 'Contents', 'version'), 'utf8'), '1.0.2');
  });

  test('npm updater from Settings: a manual check never prompts, Install builds what it found, once', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-updater-manual-'));
    const appBundle = path.join(root, 'Applications', 'Hikari.app');
    fs.mkdirSync(path.join(appBundle, 'Contents', 'MacOS'), { recursive: true });
    const calls = { dialogs: 0, builds: 0, quit: 0 };
    const quitEvents = new EventEmitter();
    let latest = '1.1.0-beta.1';
    const app = {
      isPackaged: true,
      getVersion: () => '1.1.0-beta.1',
      getPath: () => root,
      once: (event, fn) => quitEvents.once(event, fn),
      relaunch: () => {},
      quit: () => { calls.quit += 1; quitEvents.emit('will-quit'); }
    };
    const dialog = {
      showMessageBox: async () => { calls.dialogs += 1; return { response: 0 }; },
      showErrorBox: (title, content) => assert.fail(content)
    };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest }, versions: { [latest]: { version: latest } } })
    });
    let finishBuild;
    const spawn = (command, args, options) => {
      calls.builds += 1;
      fs.mkdirSync(path.join(options.cwd, 'hikari-out', 'Hikari-darwin-arm64', 'Hikari.app', 'Contents'), { recursive: true });
      const child = new EventEmitter();
      finishBuild = () => child.emit('exit', 0, null);
      return child;
    };
    const updater = createNpmUpdaterService({
      app, dialog, fetchImpl, spawn, allowDevelopment: true, platform: 'darwin',
      execPath: path.join(appBundle, 'Contents', 'MacOS', 'Hikari'), resolveNode: () => '/opt/homebrew/bin/node'
    });

    assert.equal((await updater.checkForUpdates({ prompt: false })).status, 'up-to-date');
    assert.equal((await updater.installUpdate()).action, 'no-update');

    latest = '1.1.0-beta.2';
    const found = await updater.checkForUpdates({ prompt: false });
    assert.equal(found.status, 'update-available');
    assert.equal(found.latestVersion, '1.1.0-beta.2');
    assert.equal(calls.dialogs, 0);

    const first = updater.installUpdate();
    const second = updater.installUpdate();
    await new Promise(setImmediate);
    assert.equal(updater.getStatus().status, 'installing');
    assert.equal((await updater.checkForUpdates({ prompt: false })).status, 'installing');
    finishBuild();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.action, 'restarting');
    assert.equal(b.action, 'restarting');
    assert.equal(calls.builds, 1);
    assert.equal(calls.quit, 1);
    assert.equal(calls.dialogs, 0);
  });

  test('npm updater on Windows runs the built HikariSetup.exe detached at quit and lets it relaunch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-updater-win-'));
    const calls = { spawn: [], relaunch: 0, quit: 0 };
    const quitEvents = new EventEmitter();
    const app = {
      isPackaged: true,
      getVersion: () => '1.1.0-beta.1',
      getPath: () => root,
      once: (event, fn) => quitEvents.once(event, fn),
      relaunch: () => { calls.relaunch += 1; },
      quit: () => { calls.quit += 1; quitEvents.emit('will-quit'); }
    };
    const dialog = { showMessageBox: async () => ({ response: 0 }), showErrorBox: (title, content) => assert.fail(content) };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '1.1.0-beta.2' }, versions: { '1.1.0-beta.2': { version: '1.1.0-beta.2' } } })
    });
    const spawn = (command, args, options) => {
      calls.spawn.push({ command, args, options });
      const child = new EventEmitter();
      if (options.cwd) {
        const out = path.join(options.cwd, 'hikari-out', 'Hikari-win32-arm64');
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, 'HikariSetup.exe'), '');
        setImmediate(() => child.emit('exit', 0, null));
      }
      child.unref = () => {};
      return child;
    };

    const updater = createNpmUpdaterService({
      app, dialog, fetchImpl, spawn, allowDevelopment: true, platform: 'win32',
      execPath: 'C:\\Users\\me\\AppData\\Local\\hikari\\app-1.1.0-beta1\\Hikari.exe',
      resolveNode: () => 'C:\\Users\\me\\AppData\\Local\\HikariNode\\node.exe'
    });
    const result = await updater.checkForUpdates();

    assert.equal(result.action, 'restarting');
    const [build, setup] = calls.spawn;
    assert.deepEqual(build.args.slice(-2), ['--yes', '@hinashirosaki/hikari@1.1.0-beta.2']);
    assert.equal(build.options.windowsHide, true);
    assert.equal(setup.command, path.join(build.options.cwd, 'hikari-out', 'Hikari-win32-arm64', 'HikariSetup.exe'));
    assert.equal(setup.options.detached, true);
    assert.equal(calls.relaunch, 0);
    assert.equal(calls.quit, 1);
  });
};
