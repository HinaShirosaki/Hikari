module.exports = function registerRuntimeConsistency(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const provider = require('../../../../src/main/lib/codex-cli-provider');
  const { runCodexCommand } = require('../../../../src/main/lib/codex-cli-provider/run-command');
  const { codexManagedRoot, codexReleaseTarget } = require('../../../../src/main/lib/codex-cli-provider/cli-managed');
  const { nativeUpdateEnvironment } = require('../../../../src/main/lib/codex-cli-provider/cli-native-update');
  const { resolveCodexRuntimeInvocation, resolveCodexRequestSelection } = require('../../../../src/main/lib/codex-cli-provider/runtime-gateway');

  function fixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-runtime-'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'fixture-account' } }));
    const env = { ...process.env, HIKARI_CODEX_HOME: home, CODEX_HOME: home };
    delete env.HIKARI_CODEX_CLI;
    delete env.HIKARI_CODEX_BIN;
    for (const key of ['HIKARI_CODEX_ACCESS_TOKEN', 'OPENAI_OAUTH_TOKEN', 'CHATGPT_OAUTH_TOKEN']) delete env[key];
    const root = codexManagedRoot(env);
    const target = codexReleaseTarget();
    function writeCli(version) {
      const binary = path.join(root, 'releases', `${version}-${target}`, 'bin', process.platform === 'win32' ? 'codex.js' : 'codex');
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli ${version}'); process.exit(0); }
const args = process.argv.slice(2);
if (!args.includes('app-server')) {
  process.stdin.resume();
  process.stdin.on('end', () => {
    const text = JSON.stringify({version: '${version}', home: process.env.CODEX_HOME, args});
    const output = args[args.indexOf('--output-last-message') + 1];
    if (output && args.includes('--output-last-message')) fs.writeFileSync(output, text);
    console.log(text);
  });
} else {
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\\n')) >= 0;) {
      const request = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (request.id === undefined) continue;
      const result = request.method === 'model/list' ? { data: [{id:'gpt-6.1-sol', displayName:'${version}', isDefault:true, supportedReasoningEfforts:[{reasoningEffort:'low'}], defaultReasoningEffort:'low'}] } : {};
      console.log(JSON.stringify({id:request.id,result}));
    }
  });
}
`, { mode: 0o755 });
      return binary;
    }
    function select(version) {
      fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version, target }));
      if (process.platform === 'win32') env.HIKARI_CODEX_CLI = path.join(root, 'releases', `${version}-${target}`, 'bin', 'codex.js');
    }
    const older = writeCli('0.157.1');
    const current = writeCli('0.160.0');
    select('0.160.0');
    return { tmp, home, env, older, current, select, clean: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }

  test('Shared runtime pins model discovery and execution to the selected CLI across an update', async () => {
    const f = fixture();
    try {
      const runtime = await provider.prepareCodexRuntime({ env: f.env, cwd: f.tmp });
      f.select('0.157.1');
      const catalog = await provider.requestCodexCliCatalog({ runtime });
      assert.equal(catalog.models[0].label, '0.160.0');
      const args = provider.buildCodexCliExecArgs({ outputFile: path.join(f.tmp, 'answer'), model: 'gpt-6.1-sol', catalog });
      const result = await runCodexCommand({ args, ...runtime, input: 'fixture' });
      const output = JSON.parse(result.stdout);
      assert.equal(output.version, '0.160.0');
      assert.equal(output.home, fs.realpathSync(f.home));
      assert.equal(output.args[output.args.indexOf('-m') + 1], 'gpt-6.1-sol');
      const next = await provider.prepareCodexRuntime({ env: f.env, cwd: f.tmp });
      assert.equal(next.version, '0.157.1');
      assert.equal(provider.getCodexCliCatalog(next).ok, false);
    } finally { f.clean(); }
  });

  test('Runtime identity separates isolated homes and refreshed accounts and clears failed catalogs', async () => {
    const f = fixture();
    try {
      const runtime = await provider.prepareCodexRuntime({ env: f.env, cwd: f.tmp });
      await provider.requestCodexCliCatalog({ runtime });
      fs.writeFileSync(path.join(f.home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'changed-account' } }));
      const changed = await provider.prepareCodexRuntime({ env: f.env, cwd: f.tmp });
      assert.notEqual(changed.identity, runtime.identity);
      assert.equal(provider.getCodexCliCatalog(changed).ok, false);
      const isolated = path.join(f.tmp, 'isolated');
      fs.mkdirSync(isolated);
      const other = await provider.prepareCodexRuntime({ cwd: f.tmp, env: { ...f.env, HIKARI_CODEX_CLI: runtime.invocation.command, HIKARI_CODEX_HOME: isolated, CODEX_HOME: isolated } });
      assert.equal(other.invocation.command, runtime.invocation.command);
      assert.equal(other.version, runtime.version);
      assert.notEqual(other.identity, runtime.identity);
      assert.equal((await provider.getCodexLoginStatus({ runtime: other })).loggedIn, false);
      assert.equal((await provider.getCodexLoginStatus({ runtime: changed })).loggedIn, true);
      await assert.rejects(provider.requestCodexCliCatalog({ runtime: changed, listModels: async () => { throw new Error('offline'); } }), /offline/);
      assert.equal(provider.getCodexCliCatalog().ok, false);
    } finally { f.clean(); }
  });

  test('Requests report their actual CLI and preserve an explicit model absent from a catalog', async () => {
    const f = fixture();
    const saved = { ...process.env };
    try {
      Object.assign(process.env, f.env);
      if (!f.env.HIKARI_CODEX_CLI) delete process.env.HIKARI_CODEX_CLI;
      delete process.env.HIKARI_CODEX_BIN;
      provider.setCodexCliModel('');
      provider.setCodexCliReasoningEffort('');
      await provider.requestCodexCliCatalog({ listModels: async () => [{ id: 'other-model', isDefault: true }] });
      const result = await provider.requestCodexCliText({ cwd: f.tmp, prompt: 'fixture', model: 'gpt-6.1-sol', returnMetadata: true });
      const output = JSON.parse(result.text);
      assert.equal(output.version, '0.160.0');
      assert.equal(output.args[output.args.indexOf('-m') + 1], 'gpt-6.1-sol');
      assert.equal(result.metadata.cliPath, fs.realpathSync(f.current));
      assert.equal(result.metadata.cliVersion, '0.160.0');
      assert.equal(result.metadata.codexHome, fs.realpathSync(f.home));
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      f.clean();
    }
  });

  test('The gateway normalizes quoted, relative and symlinked CLI paths before connection', () => {
    if (process.platform === 'win32') return; // Junction/npm variants are checked with platform fixtures below.
    const f = fixture();
    try {
      const alias = path.join(f.tmp, 'Codex With Spaces', path.basename(f.current));
      fs.mkdirSync(path.dirname(alias));
      fs.symlinkSync(f.current, alias);
      const expected = fs.realpathSync(f.current);
      for (const value of [` "${alias}" `, path.relative(process.cwd(), alias), `~/Codex With Spaces/${path.basename(f.current)}`]) {
        const invocation = resolveCodexRuntimeInvocation({ ...f.env, HIKARI_CODEX_CLI: value }, { homeDir: f.tmp });
        assert.equal(invocation.command, expected);
        assert.equal(Object.isFrozen(invocation), true);
      }
      // A multicall shim (Volta's codex -> volta-shim) must keep the name it dispatches on.
      const shim = path.join(f.tmp, 'volta-shim');
      fs.copyFileSync(f.current, shim);
      fs.chmodSync(shim, 0o755);
      fs.symlinkSync(shim, path.join(f.tmp, 'codex'));
      assert.equal(resolveCodexRuntimeInvocation({ ...f.env, HIKARI_CODEX_CLI: path.join(f.tmp, 'codex') }).command,
        path.join(f.tmp, 'codex'));
      assert.equal(resolveCodexRuntimeInvocation({ ...f.env, HIKARI_CODEX_CLI: './missing-codex' }).command,
        path.resolve('missing-codex'));
    } finally { f.clean(); }
  });

  test('A connected runtime retains its selected model defaults when Settings changes', async () => {
    const f = fixture();
    const beforeModel = provider.getCodexCliModel();
    const beforeEffort = provider.getCodexCliReasoningEffort();
    try {
      provider.setCodexCliModel('gpt-6.1-sol');
      provider.setCodexCliReasoningEffort('low');
      const runtime = await provider.prepareCodexRuntime({ env: f.env, cwd: f.tmp });
      provider.setCodexCliModel('different-model');
      provider.setCodexCliReasoningEffort('high');
      const selection = resolveCodexRequestSelection({ runtime });
      assert.deepEqual(selection, { model: 'gpt-6.1-sol', reasoningEffort: 'low' });
      const args = provider.buildCodexCliExecArgs({ selection });
      assert.equal(args[args.indexOf('-m') + 1], 'gpt-6.1-sol');
    } finally { provider.setCodexCliModel(beforeModel); provider.setCodexCliReasoningEffort(beforeEffort); f.clean(); }
  });

  test('Native updates receive a private install directory and noninteractive Windows and macOS environments', () => {
    const windows = nativeUpdateEnvironment({ HIKARI_CODEX_HOME: 'C:\\Hikari Data\\codex', Path: 'C:\\Windows' }, 'win32');
    assert.equal(windows.CODEX_HOME, 'C:\\Hikari Data\\codex');
    assert.equal(windows.CODEX_INSTALL_DIR, 'C:\\Hikari Data\\codex\\bin');
    assert.equal(windows.Path, 'C:\\Hikari Data\\codex\\bin;C:\\Windows');
    assert.equal(windows.CODEX_NON_INTERACTIVE, '1');
    const mac = nativeUpdateEnvironment({ HIKARI_CODEX_HOME: '/private/home', PATH: '/usr/bin' }, 'darwin');
    assert.equal(mac.PATH, '/private/home/bin:/usr/bin');
  });
};
