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
    fs.mkdirSync(path.join(out, 'Hikari-win32-x64', 'Hikari'));
    fs.writeFileSync(path.join(out, 'Hikari-win32-x64', 'Hikari', 'Hikari.exe'), '');
    assert.equal(findBuild(out, 'win32', fs, path.join('Hikari', 'Hikari.exe')), path.join(out, 'Hikari-win32-x64', 'Hikari', 'Hikari.exe'));
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
    assert.equal(fs.existsSync(`${appBundle}.previous`), false, 'the parked old bundle is removed after the swap');
  });

  test('npm updater on macOS updates an app on another drive than the build (copies with ditto)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-updater-xdev-'));
    const appBundle = path.join(root, 'Volumes', 'External', 'Hikari.app');
    fs.mkdirSync(path.join(appBundle, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(appBundle, 'Contents', 'version'), 'old');
    const quitEvents = new EventEmitter();
    const ditto = [];
    // The build dir is "another drive": moving out of it fails like a real cross-device rename.
    const xdevFs = { ...fs, renameSync: (from, to) => {
      if (from.includes('hikari-update-')) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
      return fs.renameSync(from, to);
    } };
    const updater = createNpmUpdaterService({
      app: { isPackaged: true, getVersion: () => '1.1.0-beta.2', getPath: () => root, once: (e, fn) => quitEvents.once(e, fn),
        relaunch: () => {}, quit: () => quitEvents.emit('will-quit') },
      dialog: { showMessageBox: async () => ({ response: 0 }), showErrorBox: (title, content) => assert.fail(content) },
      fetchImpl: async () => ({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.1.0-beta.3' }, versions: { '1.1.0-beta.3': { version: '1.1.0-beta.3' } } }) }),
      spawn: (command, args, options) => {
        const built = path.join(options.cwd, 'hikari-out', 'Hikari-darwin-arm64', 'Hikari.app', 'Contents');
        fs.mkdirSync(built, { recursive: true });
        fs.writeFileSync(path.join(built, 'version'), 'new');
        const child = new EventEmitter();
        setImmediate(() => child.emit('exit', 0, null));
        return child;
      },
      execFileSync: (command, [from, to]) => { ditto.push(command); fs.cpSync(from, to, { recursive: true }); },
      fs: xdevFs, allowDevelopment: true, platform: 'darwin',
      execPath: path.join(appBundle, 'Contents', 'MacOS', 'Hikari'), resolveNode: () => '/opt/homebrew/bin/node'
    });
    assert.equal((await updater.checkForUpdates()).action, 'restarting');
    assert.deepEqual(ditto, ['ditto']);
    assert.equal(fs.readFileSync(path.join(appBundle, 'Contents', 'version'), 'utf8'), 'new');
    assert.equal(fs.existsSync(`${appBundle}.previous`), false);
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

  // Runs one Windows update. A setup install has Update.exe beside app-<version>;
  // a portable copy is just a folder with Hikari.exe, anywhere.
  async function runWindowsUpdate({ setupInstall }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-updater-win-'));
    const appDir = setupInstall ? path.join(root, 'hikari', 'app-1.1.0-beta2') : path.join(root, 'D-drive', 'Tools', 'Hikari');
    fs.mkdirSync(appDir, { recursive: true });
    if (setupInstall) fs.writeFileSync(path.join(root, 'hikari', 'Update.exe'), '');
    const calls = { spawn: [], relaunch: 0, quit: 0 };
    const quitEvents = new EventEmitter();
    const app = {
      isPackaged: true,
      getVersion: () => '1.1.0-beta.2',
      getPath: () => root,
      once: (event, fn) => quitEvents.once(event, fn),
      relaunch: () => { calls.relaunch += 1; },
      quit: () => { calls.quit += 1; quitEvents.emit('will-quit'); }
    };
    const dialog = { showMessageBox: async () => ({ response: 0 }), showErrorBox: (title, content) => assert.fail(content) };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '1.1.0-beta.3' }, versions: { '1.1.0-beta.3': { version: '1.1.0-beta.3' } } })
    });
    const spawn = (command, args, options) => {
      calls.spawn.push({ command, args, options });
      const child = new EventEmitter();
      if (options.cwd) {
        const out = path.join(options.cwd, 'hikari-out', 'Hikari-win32-arm64');
        fs.mkdirSync(path.join(out, 'Hikari'), { recursive: true });
        fs.writeFileSync(path.join(out, 'HikariSetup.exe'), '');
        fs.writeFileSync(path.join(out, 'Hikari', 'Hikari.exe'), '');
        setImmediate(() => child.emit('exit', 0, null));
      }
      child.unref = () => {};
      return child;
    };
    const updater = createNpmUpdaterService({
      app, dialog, fetchImpl, spawn, allowDevelopment: true, platform: 'win32', pid: 4242,
      execPath: path.join(appDir, 'Hikari.exe'),
      resolveNode: () => 'C:\\Users\\me\\AppData\\Local\\HikariNode\\node.exe'
    });
    const result = await updater.checkForUpdates();
    return { result, calls, appDir };
  }

  test('npm updater on Windows (setup install) runs the built HikariSetup.exe detached at quit and lets it relaunch', async () => {
    const { result, calls } = await runWindowsUpdate({ setupInstall: true });
    assert.equal(result.action, 'restarting');
    const [build, setup] = calls.spawn;
    assert.deepEqual(build.args.slice(-2), ['--yes', '@hinashirosaki/hikari@1.1.0-beta.3']);
    assert.equal(build.options.windowsHide, true);
    assert.equal(setup.command, path.join(build.options.cwd, 'hikari-out', 'Hikari-win32-arm64', 'HikariSetup.exe'));
    assert.equal(setup.options.detached, true);
    assert.equal(calls.relaunch, 0);
    assert.equal(calls.quit, 1);
  });

  test('npm updater on Windows (portable, any folder) hands the swap to the new Hikari.exe at quit', async () => {
    const { result, calls, appDir } = await runWindowsUpdate({ setupInstall: false });
    assert.equal(result.action, 'restarting');
    const [build, helper] = calls.spawn;
    assert.equal(helper.command, path.join(build.options.cwd, 'hikari-out', 'Hikari-win32-arm64', 'Hikari', 'Hikari.exe'));
    assert.deepEqual(helper.args, [`--hikari-swap-into=${appDir}`, '--hikari-swap-after=4242']);
    assert.equal(helper.options.detached, true);
    assert.equal(calls.relaunch, 0, 'the new Hikari.exe starts the updated copy, not app.relaunch()');
  });

  test('portable swap: the new build waits for the old app, replaces its folder in place, and starts it', async () => {
    const { finishPortableUpdate } = require('../../../src/main/updater/finish-portable-update');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-swap-'));
    const appDir = path.join(root, 'USB', 'Hikari');
    const newDir = path.join(root, 'build', 'Hikari-win32-arm64', 'Hikari');
    for (const [dir, version] of [[appDir, 'old'], [newDir, 'new']]) {
      fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'Hikari.exe'), version);
      fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), version);
    }
    const started = [];
    let polls = 0;
    const run = (fsImpl = fs) => finishPortableUpdate({
      argv: ['Hikari.exe', `--hikari-swap-into=${appDir}`, '--hikari-swap-after=77'],
      execPath: path.join(newDir, 'Hikari.exe'),
      fs: fsImpl,
      spawn: (command) => { started.push(command); return { unref() {} }; },
      isRunning: () => ++polls < 3,
      sleep: async () => {}
    });

    await run();
    assert.equal(polls, 3, 'waits until the old app has exited');
    assert.equal(fs.readFileSync(path.join(appDir, 'resources', 'app.asar'), 'utf8'), 'new');
    assert.equal(fs.existsSync(`${appDir}.previous`), false);
    assert.deepEqual(started, [path.join(appDir, 'Hikari.exe')]);
    assert.match(fs.readFileSync(path.join(root, 'build', 'Hikari-win32-arm64', 'swap-portable.log'), 'utf8'), /updated/);

    // A failed copy puts the old folder back and starts it.
    fs.writeFileSync(path.join(appDir, 'Hikari.exe'), 'old');
    await run({ ...fs, cpSync: () => { throw new Error('disk full'); } });
    assert.equal(fs.readFileSync(path.join(appDir, 'Hikari.exe'), 'utf8'), 'old');
    assert.equal(fs.existsSync(`${appDir}.previous`), false);
    assert.equal(started.length, 2);
  });
};
