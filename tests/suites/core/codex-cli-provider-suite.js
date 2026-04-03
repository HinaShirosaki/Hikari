module.exports = function registerCodexCliProviderSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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

    function withCodexHome({
      modelsCache = defaultModelsCache,
      configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n'
    } = {}, callback) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-home-'));
      const previousCodexHome = process.env.CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(modelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), configToml, 'utf8');
      process.env.CODEX_HOME = tmpDir;
      try {
        return callback();
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    test('codex cli provider stores and clears the configured model', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        assert.equal(provider.getCodexCliModel(), '');
        assert.equal(provider.setCodexCliModel(' gpt-5.4 '), 'gpt-5.4');
        assert.equal(provider.getCodexCliModel(), 'gpt-5.4');
        assert.equal(provider.setCodexCliModel(''), '');
        assert.equal(provider.getCodexCliModel(), '');
      });
    });

    test('codex cli provider uses the configured model when building exec args', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        provider.setCodexCliModel('gpt-5.4');

        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt'
        });

        assert.equal(args.includes('-m'), true);
        assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.4');
        assert.equal(args.includes('-c'), true);
        assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort=xhigh');
        assert.equal(args[args.length - 1], '-');
        provider.setCodexCliModel('');
      });
    });

    test('codex cli provider prefers explicit request models and remembers them', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        provider.setCodexCliModel('gpt-5.4');

        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt',
          model: ' gpt-5.1-codex-mini ',
          reasoningEffort: ' high '
        });

        assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.1-codex-mini');
        assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort=high');
        assert.equal(provider.getCodexCliModel(), 'gpt-5.1-codex-mini');
        provider.setCodexCliModel('');
      });
    });

    test('codex cli provider exposes the live codex catalog defaults', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const catalog = provider.getCodexCliCatalog();
        assert.equal(catalog.defaultModel, 'gpt-5.4');
        assert.equal(catalog.defaultReasoningEffort, 'xhigh');
        assert.deepEqual(
          catalog.models.map((entry) => entry.id),
          ['gpt-5.4', 'gpt-5.1-codex-mini']
        );
      });
    });

    test('codex cli provider falls back from unsupported models and incompatible reasoning effort', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        assert.equal(provider.setCodexCliModel('gpt-4.1-mini'), 'gpt-5.4');
        provider.setCodexCliReasoningEffort('xhigh');

        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt',
          model: 'gpt-5.1-codex-mini'
        });

        assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.1-codex-mini');
        assert.equal(args[args.indexOf('-c') + 1], 'model_reasoning_effort=medium');
      });
    });
  }
};
