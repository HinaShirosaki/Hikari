module.exports = function registerNpmUpdaterSuite(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const EventEmitter = require('node:events');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    createNpmUpdaterService, findInstaller, resolveNpxInvocation
  } = require('../../../src/main/updater/create-npm-updater-service');

  test('npm updater runs npx next to node (npm entrypoint on Windows) and finds each platform installer', () => {
    assert.deepEqual(resolveNpxInvocation('/opt/homebrew/bin/node', 'darwin'), { command: '/opt/homebrew/bin/npx', args: [] });
    assert.deepEqual(resolveNpxInvocation('C:\\Program Files\\nodejs\\node.exe', 'win32'), {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js']
    });

    const make = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-make-'));
    for (const file of ['zip/darwin/arm64/Hikari-darwin-arm64-1.0.3.zip', 'squirrel.windows/x64/hikariSetup.exe',
      'squirrel.windows/x64/hikari-1.0.3-full.nupkg']) {
      fs.mkdirSync(path.dirname(path.join(make, file)), { recursive: true });
      fs.writeFileSync(path.join(make, file), '');
    }
    assert.equal(findInstaller(make, 'darwin'), path.join(make, 'zip/darwin/arm64/Hikari-darwin-arm64-1.0.3.zip'));
    assert.equal(findInstaller(make, 'win32'), path.join(make, 'squirrel.windows/x64/hikariSetup.exe'));
    assert.equal(findInstaller(path.join(make, 'missing'), 'darwin'), '');
  });

  test('npm updater builds the update with npx, swaps the bundle at quit, and relaunches', async () => {
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
      const zip = path.join(options.cwd, 'hikari-out', 'make', 'zip', 'darwin', 'arm64', 'Hikari-darwin-arm64-1.0.3.zip');
      fs.mkdirSync(path.dirname(zip), { recursive: true });
      fs.writeFileSync(zip, '');
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    };
    const execFileSync = (command, [, , , extractDir]) => {
      assert.equal(command, 'ditto');
      fs.mkdirSync(path.join(extractDir, 'Hikari.app', 'Contents'), { recursive: true });
      fs.writeFileSync(path.join(extractDir, 'Hikari.app', 'Contents', 'version'), '1.0.3');
    };

    const updater = createNpmUpdaterService({
      app, dialog, fetchImpl, spawn, execFileSync, allowDevelopment: true, platform: 'darwin',
      execPath: path.join(appBundle, 'Contents', 'MacOS', 'Hikari'), resolveNode: () => '/opt/homebrew/bin/node'
    });
    const result = await updater.checkForUpdates();

    assert.equal(result.status, 'ready');
    assert.equal(result.action, 'restarting');
    assert.deepEqual(calls.dialogs, ['Update/Later', 'OK', 'Restart Now/Later']);
    const [build] = calls.spawn;
    assert.equal(build.command, '/opt/homebrew/bin/npx');
    assert.deepEqual(build.args, ['--yes', '@hinashirosaki/hikari@1.0.3']);
    assert.ok(build.options.env.PATH.startsWith('/opt/homebrew/bin:'));
    assert.equal(calls.relaunch, 1);
    assert.equal(calls.quit, 1);
    assert.equal(fs.readFileSync(path.join(appBundle, 'Contents', 'version'), 'utf8'), '1.0.3');
    const parked = path.join(build.options.cwd, 'hikari-out/make/zip/darwin/arm64/extracted/Hikari.app.previous');
    assert.equal(fs.readFileSync(path.join(parked, 'Contents', 'version'), 'utf8'), '1.0.2');
  });
};
