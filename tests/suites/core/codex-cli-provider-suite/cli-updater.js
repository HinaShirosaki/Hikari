module.exports = function registerCliUpdater(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { execFileSync } = require('node:child_process');
  const { createCodexCliUpdater } = require('../../../../src/main/lib/codex-cli-provider/cli-updater');
  const { readCodexManagedInstall, codexManagedRoot, codexStandaloneRoot, codexReleaseTarget } = require('../../../../src/main/lib/codex-cli-provider/cli-managed');
  const { resolveCodexBinary } = require('../../../../src/main/lib/codex-cli-provider/cli-discovery');
  const { setCodexCliUpdater } = require('../../../../src/main/lib/codex-cli-provider/cli-maintenance');
  const { requestCodexCliCatalog } = require('../../../../src/main/lib/codex-cli-provider/catalog');
  const { resolveCodexRelease, downloadCodexRelease } = require('../../../../src/main/lib/codex-cli-provider/cli-update-download');
  const version = '0.159.3';

  function fixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-cli-update-'));
    const env = { ...process.env, HIKARI_CODEX_HOME: path.join(tmp, 'home'), CODEX_HOME: path.join(tmp, 'home') };
    delete env.HIKARI_CODEX_CLI;
    delete env.HIKARI_CODEX_BIN;
    const target = codexReleaseTarget();
    const metadata = { tag_name: `rust-v${version}`, assets: [{ name: `codex-package-${target}.tar.gz`, digest: `sha256:${'a'.repeat(64)}` }] };
    let checks = 0;
    let installs = 0;
    let nativeUpdates = 0;
    const deps = {
      env,
      updateNative: async () => { nativeUpdates++; },
      fetchImpl: async () => { checks++; return { ok: true, json: async () => metadata }; },
      installRelease: async (release, staging) => {
        installs++;
        const packageDir = path.join(staging, 'package');
        writeCli(packageDir, release.version);
        return packageDir;
      }
    };
    return { tmp, env, target, metadata, deps, counts: () => ({ checks, installs }), nativeUpdates: () => nativeUpdates, clean: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }

  function writeCli(directory, selectedVersion) {
    const binary = path.join(directory, 'bin', 'codex');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('codex-cli ${selectedVersion}'); process.exit(0); }
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (let i; (i = buffer.indexOf('\\n')) >= 0;) {
    const request = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    if (request.id === undefined) continue;
    const result = request.method === 'model/list' ? { data: [{ id: 'gpt-6.1-sol', isDefault: true }], nextCursor: null } : {};
    process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n');
  }
});
`, { mode: 0o755 });
    return binary;
  }

  function seed(f, selectedVersion) {
    const root = codexManagedRoot(f.env);
    const binary = writeCli(path.join(root, 'releases', `${selectedVersion}-${f.target}`), selectedVersion);
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version: selectedVersion, target: f.target }));
    return binary;
  }

  test('Codex updater installs the latest stable CLI, shares concurrent checks, and refreshes models before discovery', async () => {
    const f = fixture();
    let changed = 0;
    const updater = createCodexCliUpdater({ ...f.deps, onUpdated: () => changed++ });
    setCodexCliUpdater(updater);
    try {
      const pending = updater.ensureLatest();
      assert.equal(updater.ensureLatest(), pending);
      const catalogPromise = requestCodexCliCatalog({ env: f.env });
      assert.equal((await pending).status, 'up-to-date');
      assert.equal((await catalogPromise).defaultModel, 'gpt-6.1-sol');
      assert.equal(readCodexManagedInstall(f.env).version, version);
      assert.equal(resolveCodexBinary(f.env), readCodexManagedInstall(f.env).binary);
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
      assert.equal(changed, 1);
      await updater.ensureLatest();
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
      assert.deepEqual(fs.readdirSync(codexStandaloneRoot(f.env)).sort(), ['auto-update-version', 'current', 'releases']);
    } finally { setCodexCliUpdater(null); await updater.stop(); f.clean(); }
  });

  test('Codex updater switches to a new immutable release and keeps the previous CLI runnable', async () => {
    const f = fixture();
    try {
      const previous = seed(f, '0.157.1');
      const updater = createCodexCliUpdater(f.deps);
      assert.equal((await updater.ensureLatest()).currentVersion, version);
      assert.notEqual(resolveCodexBinary(f.env), previous);
      assert.equal(execFileSync(previous, ['--version'], { encoding: 'utf8' }).trim(), 'codex-cli 0.157.1');
      await updater.ensureLatest({ force: true });
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
      assert.equal(f.nativeUpdates(), 1);
    } finally { f.clean(); }
  });

  test('Codex updater keeps the working CLI through offline and invalid-package failures and retries', async () => {
    const f = fixture();
    let clock = 0;
    let online = false;
    let badPackage = true;
    const fetchRelease = f.deps.fetchImpl;
    const install = f.deps.installRelease;
    const updater = createCodexCliUpdater({ ...f.deps, now: () => clock,
      fetchImpl: async (...args) => { if (!online) throw new Error('offline'); return fetchRelease(...args); },
      installRelease: async (release, staging) => install({ ...release, version: badPackage ? '0.157.1' : release.version }, staging)
    });
    try {
      const previous = seed(f, '0.157.1');
      const manifest = fs.readFileSync(path.join(codexManagedRoot(f.env), 'current.json'), 'utf8');
      assert.equal((await updater.ensureLatest()).error, 'offline');
      assert.equal(resolveCodexBinary(f.env), previous);
      online = true;
      await updater.ensureLatest();
      assert.equal(f.counts().checks, 0);
      clock += 5 * 60 * 1000;
      assert.match((await updater.ensureLatest()).error, /expected version/);
      assert.equal(fs.readFileSync(path.join(codexManagedRoot(f.env), 'current.json'), 'utf8'), manifest);
      assert.equal(resolveCodexBinary(f.env), previous);
      badPackage = false;
      clock += 5 * 60 * 1000;
      assert.equal((await updater.ensureLatest()).currentVersion, version);
    } finally { await updater.stop(); f.clean(); }
  });

  test('Codex updater never downgrades a newer managed CLI and leaves custom overrides authoritative', async () => {
    const f = fixture();
    try {
      seed(f, '0.160.0');
      assert.equal((await createCodexCliUpdater(f.deps).ensureLatest()).currentVersion, '0.160.0');
      assert.equal(f.counts().installs, 0);
      for (const key of ['HIKARI_CODEX_CLI', 'HIKARI_CODEX_BIN']) {
        const env = { ...f.env, [key]: '/custom/missing-codex' };
        assert.equal((await createCodexCliUpdater({ ...f.deps, env }).ensureLatest()).status, 'custom');
        assert.equal(resolveCodexBinary(env), '/custom/missing-codex');
      }
      assert.equal(f.counts().checks, 1);
    } finally { f.clean(); }
  });

  test('Native update failures restore the selected release without invoking the bootstrap downloader', async () => {
    const f = fixture();
    try {
      await createCodexCliUpdater(f.deps).ensureLatest();
      const previous = readCodexManagedInstall(f.env);
      const root = codexStandaloneRoot(f.env);
      const invalid = path.join(root, 'releases', `0.160.0-${f.target}`);
      writeCli(invalid, '0.157.1');
      let changed = 0;
      const updater = createCodexCliUpdater({ ...f.deps, onUpdated: () => changed++, updateNative: async () => {
        fs.unlinkSync(path.join(root, 'current'));
        fs.symlinkSync(invalid, path.join(root, 'current'));
      } });
      assert.match((await updater.ensureLatest()).error, /runnable selected release/);
      assert.equal(readCodexManagedInstall(f.env).binary, previous.binary);
      assert.equal(fs.readFileSync(path.join(root, 'auto-update-version'), 'utf8'), `${previous.version}-${f.target}`);
      assert.equal(changed, 0);
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
      const offline = createCodexCliUpdater({ ...f.deps, updateNative: async () => { throw new Error('offline'); } });
      assert.equal((await offline.ensureLatest()).error, 'offline');
      assert.equal(readCodexManagedInstall(f.env).binary, previous.binary);
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
    } finally { f.clean(); }
  });

  test('A CLI lacking native self-update is bootstrapped once into the standard layout', async () => {
    const f = fixture();
    try {
      f.metadata.tag_name = 'rust-v0.157.1';
      await createCodexCliUpdater(f.deps).ensureLatest();
      const previous = readCodexManagedInstall(f.env).binary;
      f.metadata.tag_name = `rust-v${version}`;
      const updater = createCodexCliUpdater({ ...f.deps, updateNative: async () => {
        const error = new Error('unsupported'); error.stderr = "error: unrecognized subcommand 'update'"; throw error;
      } });
      assert.equal((await updater.ensureLatest()).currentVersion, version);
      assert.equal(readCodexManagedInstall(f.env).method, 'standalone');
      assert.equal(fs.existsSync(previous), true);
      assert.deepEqual(f.counts(), { checks: 2, installs: 2 });
    } finally { f.clean(); }
  });

  test('The Windows junction replacement branch preserves the immutable old release', async () => {
    const { replaceSelection } = require('../../../../src/main/lib/codex-cli-provider/cli-standalone-layout');
    const f = fixture();
    try {
      await createCodexCliUpdater(f.deps).ensureLatest();
      const previous = readCodexManagedInstall(f.env).binary;
      const root = codexStandaloneRoot(f.env);
      const destination = path.join(root, 'releases', `0.160.0-${f.target}`);
      writeCli(destination, '0.160.0');
      await replaceSelection(root, destination, 'win32');
      assert.equal(fs.realpathSync(path.join(root, 'current')), fs.realpathSync(destination));
      assert.equal(fs.existsSync(previous), true);
      assert.equal(fs.readdirSync(root).some(name => name.startsWith('.hikari-current')), false);
    } finally { f.clean(); }
  });

  test('Codex updater startup checks again hourly and cancels unfinished installs on shutdown', async () => {
    const f = fixture();
    let clock = 0;
    const updater = createCodexCliUpdater({ ...f.deps, now: () => clock });
    try {
      updater.start();
      await updater.ensureLatest();
      clock += 60 * 60 * 1000;
      await updater.ensureLatest();
      assert.deepEqual(f.counts(), { checks: 1, installs: 1 });
      assert.equal(f.nativeUpdates(), 1);
      await updater.stop();
      clock += 60 * 60 * 1000;
      await updater.ensureLatest();
      assert.equal(f.counts().checks, 1);
      let began;
      const started = new Promise(resolve => { began = resolve; });
      const cancellable = createCodexCliUpdater({ ...f.deps, installRelease: (_release, _staging, { signal }) => {
        began();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      } });
      fs.rmSync(path.join(codexStandaloneRoot(f.env), 'current'));
      const pending = cancellable.ensureLatest();
      await started;
      await cancellable.stop();
      assert.equal((await pending).status, 'error');
      assert.equal(readCodexManagedInstall(f.env), null);
      assert.equal(fs.readdirSync(codexStandaloneRoot(f.env)).some(name => name.startsWith('.staging')), false);
    } finally { await updater.stop(); f.clean(); }
  });

  test('Codex release metadata selects native macOS and Windows packages and rejects unverified releases', () => {
    for (const platform of ['darwin', 'win32']) for (const arch of ['arm64', 'x64']) {
      const target = codexReleaseTarget(platform, arch);
      const metadata = { tag_name: `rust-v${version}`, assets: [{ name: `codex-package-${target}.tar.gz`, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://untrusted.example/package' }] };
      assert.equal(resolveCodexRelease(metadata, target).url, `https://releases.openai.com/codex/releases/${version}/codex-package-${target}.tar.gz`);
      assert.throws(() => resolveCodexRelease({ ...metadata, tag_name: 'rust-v0.160.0-alpha.1' }, target), /stable release/);
      assert.throws(() => resolveCodexRelease({ ...metadata, assets: [] }, target), /verified package/);
    }
  });

  test('Codex native downloader validates the real archive before extraction and executes the complete package', async () => {
    if (process.platform !== 'darwin') return;
    const f = fixture();
    try {
      const source = path.join(f.tmp, 'source');
      writeCli(source, version);
      fs.writeFileSync(path.join(source, 'bin', 'codex-code-mode-host'), 'host');
      fs.mkdirSync(path.join(source, 'codex-path'));
      fs.writeFileSync(path.join(source, 'codex-path', 'rg'), 'rg');
      const archive = path.join(f.tmp, 'fixture.tar.gz');
      execFileSync('/usr/bin/tar', ['-czf', archive, '-C', source, '.']);
      const bytes = fs.readFileSync(archive);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      const release = { version, digest, url: 'https://releases.openai.com/fixture' };
      const options = { env: f.env, platform: 'darwin', fetchImpl: async () => new Response(bytes) };
      const directory = path.join(f.tmp, 'download');
      fs.mkdirSync(directory);
      const packageDir = await downloadCodexRelease(release, directory, options);
      assert.equal(execFileSync(path.join(packageDir, 'bin', 'codex'), ['--version'], { encoding: 'utf8' }).trim(), `codex-cli ${version}`);
      const corrupt = path.join(f.tmp, 'corrupt'); fs.mkdirSync(corrupt);
      await assert.rejects(downloadCodexRelease({ ...release, digest: 'b'.repeat(64) }, corrupt, options), /checksum/);
      assert.equal(fs.existsSync(path.join(corrupt, 'package')), false);
    } finally { f.clean(); }
  });

  test('Codex model discovery uses the managed login home when a different native home is configured', async () => {
    const f = fixture();
    try {
      const binary = writeCli(path.join(f.tmp, 'external'), version);
      const capture = path.join(f.tmp, 'catalog-home.txt');
      const source = fs.readFileSync(binary, 'utf8').replace("let buffer = '';", `require('node:fs').writeFileSync(${JSON.stringify(capture)}, process.env.CODEX_HOME);\nlet buffer = '';`);
      fs.writeFileSync(binary, source);
      const catalog = await requestCodexCliCatalog({ env: { ...f.env, HIKARI_CODEX_CLI: binary, CODEX_HOME: path.join(f.tmp, 'native-home') } });
      assert.equal(catalog.defaultModel, 'gpt-6.1-sol');
      assert.equal(fs.readFileSync(capture, 'utf8'), fs.realpathSync(f.env.HIKARI_CODEX_HOME));
    } finally { f.clean(); }
  });

  test('Settings refreshes available models after a CLI update or sign-in and reports automatic update failures', async () => {
    const { loadEsmStyleModule } = require('../../../support/runtime');
    let status = { ok: true, loggedIn: true, source: 'stored', cliAvailable: true, cliVersion: '0.157.1' };
    let catalogs = 0;
    const window = { hikariApi: {
      getCodexLlmStatus: async () => status,
      getCodexLlmCatalog: async () => {
        catalogs++;
        return { ok: true, models: [{ id: status.cliVersion === '0.157.1' ? 'gpt-6-sol' : 'gpt-6.1-sol' }] };
      }
    } };
    const { createLlmModelCatalog } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/llm-model-catalog.js'));
    const { createCodexAccountSettings } = loadEsmStyleModule(path.resolve(__dirname,
      '../../../../src/renderer/modules/settings/codex-account.js'), { window });
    const catalog = createLlmModelCatalog();
    const label = {};
    const controller = createCodexAccountSettings({ state: { settings: { llm: {} } }, persist() {},
      llmModelCatalog: catalog, renderForms() {}, settingCodexStatus: label, settingCodexAuthControls: {}
    });
    await controller.refreshCodexLoginStatus();
    assert.equal(catalog.getModelOptions('codex')[0].value, 'gpt-6-sol');
    await controller.refreshCodexLoginStatus();
    assert.equal(catalogs, 1);
    status = { ...status, cliVersion: version };
    await controller.refreshCodexLoginStatus();
    assert.equal(catalogs, 2);
    assert.equal(catalog.getModelOptions('codex')[0].value, 'gpt-6.1-sol');
    assert.match(label.textContent, /0\.159\.3; updates automatically/);
    status = { ...status, loggedIn: false };
    await controller.refreshCodexLoginStatus();
    status = { ...status, loggedIn: true, cliUpdateError: 'offline' };
    await controller.refreshCodexLoginStatus();
    assert.equal(catalogs, 3);
    assert.match(label.textContent, /Automatic update failed: offline/);
  });

  test('The preload delivers Codex CLI update notifications and can unsubscribe', () => {
    const { EventEmitter } = require('node:events');
    const { createLlmApi } = require('../../../../src/main/preload/api/llm-api');
    const { LLM } = require('../../../../src/shared/ipc/channels');
    const ipc = new EventEmitter();
    const updates = [];
    const dispose = createLlmApi(ipc).onCodexCliUpdated(status => updates.push(status.currentVersion));
    ipc.emit(LLM.CODEX_CLI_UPDATED, {}, { currentVersion: version });
    dispose();
    ipc.emit(LLM.CODEX_CLI_UPDATED, {}, { currentVersion: '0.160.0' });
    assert.deepEqual(updates, [version]);
  });
};
