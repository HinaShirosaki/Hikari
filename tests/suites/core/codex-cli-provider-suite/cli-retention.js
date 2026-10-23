module.exports = function registerCliRetention(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const { createCodexCliUpdater } = require('../../../../src/main/lib/codex-cli-provider/cli-updater');
  const { pruneCodexCliReleases } = require('../../../../src/main/lib/codex-cli-provider/cli-retention');
  const { codexManagedRoot, codexStandaloneRoot, codexReleaseTarget, readCodexManagedInstall } = require('../../../../src/main/lib/codex-cli-provider/cli-managed');
  const { replaceSelection } = require('../../../../src/main/lib/codex-cli-provider/cli-standalone-layout');

  function fixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-cli-retention-'));
    const env = { ...process.env, HIKARI_CODEX_HOME: path.join(tmp, 'home'), CODEX_HOME: path.join(tmp, 'home') };
    delete env.HIKARI_CODEX_CLI;
    delete env.HIKARI_CODEX_BIN;
    const standalone = codexStandaloneRoot(env);
    const legacy = codexManagedRoot(env);
    const target = codexReleaseTarget();
    function release(version, root = standalone) {
      const directory = path.join(root, 'releases', `${version}-${target}`);
      fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'bin', 'codex'), `#!${process.execPath}\nconsole.log('codex-cli ${version}');\n`, { mode: 0o755 });
      return directory;
    }
    async function select(version) {
      const directory = release(version);
      await replaceSelection(standalone, directory);
      return directory;
    }
    const deps = { env, updateNative: async () => {}, fetchImpl: async () => { throw new Error('unexpected download'); } };
    return { tmp, env, standalone, legacy, target, release, select, deps,
      clean: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }

  test('Codex retention keeps the selected release and one numeric-version rollback across both layouts', async () => {
    const f = fixture();
    try {
      const current = await f.select('0.170.0');
      const rollback = f.release('0.169.10', f.legacy);
      const older = f.release('0.169.9');
      const oldest = f.release('0.159.3', f.legacy);
      const duplicate = f.release('0.170.0', f.legacy);
      const removed = await pruneCodexCliReleases(f.env);
      assert.deepEqual(new Set(removed), new Set([older, oldest, duplicate]));
      assert.equal(fs.existsSync(current), true);
      assert.equal(fs.existsSync(rollback), true);
      assert.equal(execFileSync(path.join(rollback, 'bin', 'codex'), ['--version'], { encoding: 'utf8' }).trim(), 'codex-cli 0.169.10');
      assert.equal(readCodexManagedInstall(f.env).version, '0.170.0');
      assert.deepEqual(await pruneCodexCliReleases(f.env), []);
    } finally { f.clean(); }
  });

  test('Codex retention leaves foreign targets, symlinks, unknown files and newer releases alone', async () => {
    const f = fixture();
    try {
      await f.select('0.170.0');
      const rollback = f.release('0.169.0');
      const releases = path.join(f.standalone, 'releases');
      const outside = path.join(f.tmp, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'sentinel'), 'untouched');
      const link = path.join(releases, `0.150.0-${f.target}`);
      fs.symlinkSync(outside, link);
      const foreign = path.join(releases, '0.149.0-foreign-target');
      fs.mkdirSync(foreign);
      const unknown = path.join(releases, 'custom-build');
      fs.mkdirSync(unknown);
      const file = path.join(releases, `0.148.0-${f.target}`);
      fs.writeFileSync(file, 'not a release');
      const future = f.release('0.171.0');
      assert.deepEqual(await pruneCodexCliReleases(f.env), []);
      for (const location of [rollback, link, foreign, unknown, file, future]) assert.equal(fs.existsSync(location), true);
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'untouched');
    } finally { f.clean(); }
  });

  test('Codex retention requires a selected standalone CLI and an explicit Hikari private home', async () => {
    const f = fixture();
    try {
      const old = f.release('0.159.3', f.legacy);
      fs.writeFileSync(path.join(f.legacy, 'current.json'), JSON.stringify({ version: '0.159.3', target: f.target }));
      assert.deepEqual(await pruneCodexCliReleases(f.env), []);
      await f.select('0.170.0');
      f.release('0.169.0');
      assert.deepEqual(await pruneCodexCliReleases({ CODEX_HOME: f.env.HIKARI_CODEX_HOME }), []);
      fs.unlinkSync(path.join(f.standalone, 'current'));
      assert.deepEqual(await pruneCodexCliReleases(f.env), []);
      assert.equal(fs.existsSync(old), true);
    } finally { f.clean(); }
  });

  test('Codex retention skips redirected legacy roots and does not choose incomplete releases for rollback', async () => {
    const f = fixture();
    try {
      await f.select('0.170.0');
      const rollback = f.release('0.168.0');
      const incomplete = path.join(f.standalone, 'releases', `0.169.0-${f.target}`);
      fs.mkdirSync(incomplete);
      const mismatched = f.release('0.169.1');
      fs.writeFileSync(path.join(mismatched, 'bin', 'codex'), `#!${process.execPath}\nconsole.log('codex-cli 0.150.0');\n`);
      const old = f.release('0.150.0', f.legacy);
      const redirected = path.join(f.tmp, 'redirected');
      fs.renameSync(f.legacy, redirected);
      fs.symlinkSync(redirected, f.legacy);
      assert.deepEqual(new Set(await pruneCodexCliReleases(f.env)), new Set([incomplete, mismatched]));
      assert.equal(fs.existsSync(rollback), true);
      assert.equal(fs.existsSync(old), true);
    } finally { f.clean(); }
  });

  test('Codex retention stops if the selected CLI changes while scanning releases', async () => {
    const f = fixture();
    try {
      await f.select('0.170.0');
      const old = f.release('0.159.3');
      f.release('0.169.0');
      const replacement = f.release('0.171.0');
      let switched = false;
      const fileSystem = { ...fs.promises, readdir: async (...args) => {
        const entries = await fs.promises.readdir(...args);
        if (!switched) { switched = true; await replaceSelection(f.standalone, replacement); }
        return entries;
      } };
      assert.deepEqual(await pruneCodexCliReleases(f.env, { fs: fileSystem }), []);
      assert.equal(fs.existsSync(old), true);
      assert.equal(readCodexManagedInstall(f.env).version, '0.171.0');
    } finally { f.clean(); }
  });

  test('Successful Codex checks prune legacy accumulation while protecting selections until the next app session', async () => {
    const f = fixture();
    try {
      const initial = await f.select('0.164.0');
      const legacyRollback = f.release('0.160.0', f.legacy);
      const legacyOldest = f.release('0.159.3', f.legacy);
      let next = '0.164.0';
      const deps = { ...f.deps, updateNative: async () => { await f.select(next); } };
      const updater = createCodexCliUpdater(deps);
      assert.equal((await updater.ensureLatest()).status, 'up-to-date');
      assert.equal(fs.existsSync(legacyOldest), false);
      assert.equal(fs.existsSync(legacyRollback), true);
      next = '0.165.0';
      await updater.ensureLatest({ force: true });
      assert.equal(fs.existsSync(legacyRollback), false);
      next = '0.166.0';
      await updater.ensureLatest({ force: true });
      assert.equal(fs.existsSync(initial), true);
      await updater.stop();
      const restarted = createCodexCliUpdater(deps);
      await restarted.ensureLatest();
      assert.equal(fs.existsSync(initial), false);
      assert.equal(fs.existsSync(path.join(f.standalone, 'releases', `0.165.0-${f.target}`)), true);
      assert.equal(readCodexManagedInstall(f.env).version, '0.166.0');
      await restarted.stop();
    } finally { f.clean(); }
  });

  test('Failed Codex updates do not prune releases, and cleanup errors leave a successful update usable', async () => {
    const f = fixture();
    try {
      await f.select('0.164.0');
      f.release('0.160.0', f.legacy);
      const oldest = f.release('0.159.3', f.legacy);
      const failed = createCodexCliUpdater({ ...f.deps, updateNative: async () => { throw new Error('offline'); } });
      assert.equal((await failed.ensureLatest()).error, 'offline');
      assert.equal(fs.existsSync(oldest), true);
      await failed.stop();
      let locked = true;
      const updater = createCodexCliUpdater({ ...f.deps, pruneReleases: async (...args) => {
        if (locked) throw new Error('release is locked');
        return pruneCodexCliReleases(...args);
      } });
      const status = await updater.ensureLatest();
      assert.equal(status.status, 'up-to-date');
      assert.equal(status.error, '');
      assert.equal(status.cleanupError, 'release is locked');
      assert.equal(readCodexManagedInstall(f.env).version, '0.164.0');
      assert.equal(fs.existsSync(oldest), true);
      locked = false;
      assert.equal((await updater.ensureLatest({ force: true })).cleanupError, '');
      assert.equal(fs.existsSync(oldest), false);
      await updater.stop();
    } finally { f.clean(); }
  });

  test('Codex downloader migration prunes legacy history after verification and preserves its previous selection', async () => {
    const f = fixture();
    try {
      const previous = f.release('0.164.0', f.legacy);
      fs.writeFileSync(path.join(f.legacy, 'current.json'), JSON.stringify({ version: '0.164.0', target: f.target }));
      const oldest = f.release('0.159.3', f.legacy);
      const older = f.release('0.160.0', f.legacy);
      const metadata = { tag_name: 'rust-v0.165.0', assets: [{ name: `codex-package-${f.target}.tar.gz`, digest: `sha256:${'a'.repeat(64)}` }] };
      const updater = createCodexCliUpdater({ ...f.deps,
        fetchImpl: async () => ({ ok: true, json: async () => metadata }),
        installRelease: async (release, staging) => f.release(release.version, staging)
      });
      assert.equal((await updater.ensureLatest()).status, 'up-to-date');
      assert.equal(readCodexManagedInstall(f.env).version, '0.165.0');
      assert.equal(fs.existsSync(previous), true);
      assert.equal(fs.existsSync(oldest), false);
      assert.equal(fs.existsSync(older), false);
      await updater.stop();
    } finally { f.clean(); }
  });

  test('Custom Codex CLI overrides bypass release cleanup as well as updating', async () => {
    const f = fixture();
    try {
      await f.select('0.164.0');
      const oldest = f.release('0.159.3', f.legacy);
      let cleanups = 0;
      for (const key of ['HIKARI_CODEX_CLI', 'HIKARI_CODEX_BIN']) {
        const updater = createCodexCliUpdater({ ...f.deps, env: { ...f.env, [key]: '/custom/codex' },
          pruneReleases: async () => { cleanups++; }
        });
        assert.equal((await updater.ensureLatest()).status, 'custom');
        await updater.stop();
      }
      assert.equal(cleanups, 0);
      assert.equal(fs.existsSync(oldest), true);
    } finally { f.clean(); }
  });
};
