module.exports = function registerCodexCliProviderSuiteAuthClearing(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, fs, path, test } = scope;
    const os = require('node:os');
    const providerPath = path.join(__dirname, 'src', 'main', 'lib', 'codex-cli-provider.js');
    const loadProvider = () => {
      delete require.cache[require.resolve(providerPath)];
      return require(providerPath);
    };
    const defaultModelsCache = {
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'gpt-5.4',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
            { effort: 'xhigh' }
          ]
        },
        {
          slug: 'gpt-5.1-codex-mini',
          display_name: 'gpt-5.1-codex-mini',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'medium' },
            { effort: 'high' }
          ]
        }
      ]
    };

    test('codex cli provider clears stored auth from both the shared and runtime homes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-clear-auth-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-clear-runtime-'));
      const previousCodexHome = process.env.CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(defaultModelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'auth.json'), '{"auth_mode":"chatgpt"}', 'utf8');
      fs.mkdirSync(path.join(workspaceDir, 'Config', 'codex-cli-home'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, 'Config', 'codex-cli-home', 'auth.json'), '{"auth_mode":"chatgpt"}', 'utf8');
      process.env.CODEX_HOME = tmpDir;

      try {
        const provider = loadProvider();
        const result = await provider.clearCodexCliStoredLogin({ cwd: workspaceDir });
        assert.equal(result.ok, true);
        assert.equal(fs.existsSync(path.join(tmpDir, 'auth.json')), false);
        assert.equal(fs.existsSync(path.join(workspaceDir, 'Config', 'codex-cli-home', 'auth.json')), false);
        assert.equal(result.clearedPaths.includes(path.join(tmpDir, 'auth.json')), true);
        assert.equal(result.clearedPaths.includes(path.join(workspaceDir, 'Config', 'codex-cli-home', 'auth.json')), true);
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
};
