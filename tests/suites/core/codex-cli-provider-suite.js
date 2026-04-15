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

    function buildJwt(payload = {}) {
      const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
    }

    function withCodexHome({
      modelsCache = defaultModelsCache,
      configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
      authFile = null
    } = {}, callback) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-home-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousEnanaCodexHome = process.env.ENANA_CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(modelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), configToml, 'utf8');
      if (authFile && typeof authFile === 'object') {
        fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify(authFile, null, 2), 'utf8');
      }
      process.env.CODEX_HOME = tmpDir;
      delete process.env.ENANA_CODEX_HOME;
      const cleanup = () => {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousEnanaCodexHome === 'string') {
          process.env.ENANA_CODEX_HOME = previousEnanaCodexHome;
        } else {
          delete process.env.ENANA_CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      };
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          return result.finally(cleanup);
        }
        cleanup();
        return result;
      } catch (error) {
        cleanup();
        throw error;
      } finally {
        // Async callbacks clean up in the promise finalizer above.
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

    test('codex cli provider can enable web search as a global codex flag before exec', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt',
          enableWebSearch: true
        });

        const searchIndex = args.indexOf('--search');
        const execIndex = args.indexOf('exec');
        assert.equal(searchIndex >= 0, true);
        assert.equal(execIndex > searchIndex, true);
      });
    });

    test('codex cli provider mirrors essential codex home files into an app-owned runtime directory', async () => {
      const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-source-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-workspace-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousEnanaCodexHome = process.env.ENANA_CODEX_HOME;
      fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"token":"abc"}', 'utf8');
      fs.writeFileSync(path.join(sourceHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
      fs.writeFileSync(path.join(sourceHome, 'models_cache.json'), JSON.stringify(defaultModelsCache), 'utf8');
      process.env.CODEX_HOME = sourceHome;
      delete process.env.ENANA_CODEX_HOME;

      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        assert.equal(runtimeHome, path.join(workspaceDir, 'Config', 'codex-cli-home'));
        assert.equal(fs.existsSync(path.join(runtimeHome, 'auth.json')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'config.toml')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'models_cache.json')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'skills')), true);
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousEnanaCodexHome === 'string') {
          process.env.ENANA_CODEX_HOME = previousEnanaCodexHome;
        } else {
          delete process.env.ENANA_CODEX_HOME;
        }
        fs.rmSync(sourceHome, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider maps codex:// endpoints to the ChatGPT Codex backend responses API', () => {
      const provider = loadProvider();
      assert.equal(
        provider.resolveCodexCliResponsesEndpoint('codex://cli'),
        'https://chatgpt.com/backend-api/codex/responses'
      );
      assert.equal(
        provider.resolveCodexCliResponsesEndpoint('https://chatgpt.com/backend-api'),
        'https://chatgpt.com/backend-api/codex/responses'
      );
      assert.equal(
        provider.resolveCodexCliResponsesEndpoint('https://chatgpt.com/backend-api/responses'),
        'https://chatgpt.com/backend-api/codex/responses'
      );
      assert.equal(
        provider.resolveCodexCliResponsesEndpoint('https://chatgpt.com/backend-api/codex'),
        'https://chatgpt.com/backend-api/codex/responses'
      );
      assert.equal(
        provider.resolveCodexCliResponsesEndpoint('https://chatgpt.com/backend-api/codex/responses'),
        'https://chatgpt.com/backend-api/codex/responses'
      );
    });

    test('codex cli provider uses the streamed Codex backend contract for prompt requests', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-456'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const previousFetch = global.fetch;
        const calls = [];
        global.fetch = async (url, init = {}) => {
          calls.push({ url, init });
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                return ({ 'content-type': 'text/event-stream' })[String(name || '').toLowerCase()] || null;
              }
            },
            async text() {
              return [
                'event: response.created',
                'data: {"type":"response.created","response":{"id":"resp_123","status":"in_progress","output":[]}}',
                '',
                'event: response.output_text.done',
                'data: {"type":"response.output_text.done","text":"OK"}',
                '',
                'event: response.output_item.done',
                'data: {"type":"response.output_item.done","item":{"id":"msg_123","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"OK"}]}}',
                '',
                'event: response.completed',
                'data: {"type":"response.completed","response":{"id":"resp_123","status":"completed","output":[]}}'
              ].join('\n');
            }
          };
        };

        try {
          const result = await provider.requestCodexCliText({
            prompt: 'Return OK only.'
          });
          assert.equal(result, 'OK');
          assert.equal(calls.length, 1);
          assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
          assert.equal(JSON.parse(calls[0].init.body).store, false);
          assert.equal(JSON.parse(calls[0].init.body).stream, true);
          assert.equal(JSON.parse(calls[0].init.body).input[0].content[0].text, 'Return OK only.');
          assert.equal(calls[0].init.headers['User-Agent'], 'CodexBar');
          assert.equal(calls[0].init.headers['ChatGPT-Account-Id'], 'acct-456');
          assert.equal(calls[0].init.headers.Accept, 'text/event-stream');
        } finally {
          global.fetch = previousFetch;
        }
      });
    });

    test('codex cli provider extracts the OpenAI auth URL from login output', () => {
      const provider = loadProvider();
      const loginUrl = provider.extractCodexLoginUrl(`
Starting local login server on http://localhost:1455.
If your browser did not open, navigate to this URL to authenticate:

https://auth.openai.com/oauth/authorize?response_type=code&client_id=test-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback
      `);
      assert.equal(
        loginUrl,
        'https://auth.openai.com/oauth/authorize?response_type=code&client_id=test-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback'
      );
    });

    test('codex cli provider imports chatgpt oauth credentials from auth.json for login status and bearer auth', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-auth-'));
      const previousCodexHome = process.env.CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(defaultModelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: accessToken,
          refresh_token: 'refresh-token',
          account_id: 'acct-123'
        }
      }, null, 2), 'utf8');
      process.env.CODEX_HOME = tmpDir;

      try {
        const provider = loadProvider();
        const profile = provider.readCodexCliOAuthProfile();
        const status = await provider.getCodexLoginStatus({ forceRefresh: true });
        assert.equal(profile.authMode, 'chatgpt');
        assert.equal(profile.accessToken, accessToken);
        assert.equal(profile.accountId, 'acct-123');
        assert.equal(status.ok, true);
        assert.equal(status.loggedIn, true);
        assert.equal(status.source, 'stored');
        assert.equal(status.expired, false);
        assert.equal(status.sourcePath, path.join(tmpDir, 'auth.json'));
        assert.match(String(status.message || ''), /auth\.json/i);
        assert.equal(provider.resolveCodexCliAccessToken(''), accessToken);
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider prefers app-managed auth storage over the native codex home', async () => {
      const nativeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-native-auth-'));
      const appHome = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-app-auth-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousEnanaCodexHome = process.env.ENANA_CODEX_HOME;
      const nativeAccessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'native@example.com'
      });
      const appAccessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'app@example.com'
      });
      fs.writeFileSync(path.join(nativeHome, 'models_cache.json'), JSON.stringify(defaultModelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(nativeHome, 'config.toml'), 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n', 'utf8');
      fs.writeFileSync(path.join(nativeHome, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: nativeAccessToken,
          refresh_token: 'native-refresh'
        }
      }, null, 2), 'utf8');
      fs.writeFileSync(path.join(appHome, 'models_cache.json'), JSON.stringify(defaultModelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(appHome, 'config.toml'), 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n', 'utf8');
      fs.writeFileSync(path.join(appHome, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: appAccessToken,
          refresh_token: 'app-refresh'
        }
      }, null, 2), 'utf8');
      process.env.CODEX_HOME = nativeHome;
      process.env.ENANA_CODEX_HOME = appHome;

      try {
        const provider = loadProvider();
        const profile = provider.readCodexCliOAuthProfile();
        assert.equal(profile.accessToken, appAccessToken);
        assert.equal(profile.sourcePath, path.join(appHome, 'auth.json'));
        assert.equal(provider.resolveCodexCliAccessToken(''), appAccessToken);
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousEnanaCodexHome === 'string') {
          process.env.ENANA_CODEX_HOME = previousEnanaCodexHome;
        } else {
          delete process.env.ENANA_CODEX_HOME;
        }
        fs.rmSync(nativeHome, { recursive: true, force: true });
        fs.rmSync(appHome, { recursive: true, force: true });
      }
    });

    test('codex cli provider refuses expired oauth access tokens for bridge auth resolution', async () => {
      const expiredAccessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) - 3600,
        email: 'scientist@example.com'
      });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-auth-expired-'));
      const previousCodexHome = process.env.CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(defaultModelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), 'model = "gpt-5.4"\nmodel_reasoning_effort = "medium"\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: expiredAccessToken,
          refresh_token: 'refresh-token',
          account_id: 'acct-123'
        }
      }, null, 2), 'utf8');
      process.env.CODEX_HOME = tmpDir;

      try {
        const provider = loadProvider();
        assert.equal(provider.resolveCodexCliAccessToken(''), '');
        const status = await provider.getCodexLoginStatus({ forceRefresh: true });
        assert.equal(status.loggedIn, false);
        assert.equal(status.source, 'stored');
        assert.equal(status.expired, true);
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider clears stored auth from both the shared and runtime homes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-clear-auth-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-clear-runtime-'));
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
  }
};
