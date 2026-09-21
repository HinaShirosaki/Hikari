module.exports = function registerCodexCliProviderSuiteAuthAndSessionTranscripts(context = {}) {
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

    function buildJwt(payload = {}) {
      const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
    }

    function withCodexHome({
      modelsCache = defaultModelsCache,
      configToml = 'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
      authFile = null
    } = {}, callback) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-home-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
      fs.writeFileSync(path.join(tmpDir, 'models_cache.json'), JSON.stringify(modelsCache, null, 2), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.toml'), configToml, 'utf8');
      if (authFile && typeof authFile === 'object') {
        fs.writeFileSync(path.join(tmpDir, 'auth.json'), JSON.stringify(authFile, null, 2), 'utf8');
      }
      process.env.CODEX_HOME = tmpDir;
      delete process.env.HIKARI_CODEX_HOME;
      const cleanup = () => {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousHikariCodexHome === 'string') {
          process.env.HIKARI_CODEX_HOME = previousHikariCodexHome;
        } else {
          delete process.env.HIKARI_CODEX_HOME;
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

    function createFakeCodexBinary(workspaceDir) {
      const fakePath = path.join(workspaceDir, 'fake-codex.js');
      const capturePath = path.join(workspaceDir, 'fake-codex-call.json');
      fs.writeFileSync(fakePath, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        'let stdin = "";',
        "process.stdin.on('data', (chunk) => { stdin += String(chunk || ''); });",
        "process.stdin.on('end', () => {",
        "  const outputIndex = args.indexOf('--output-last-message');",
        "  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : '';",
        '  fs.writeFileSync(process.env.HIKARI_FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }, null, 2));',
        "  if (process.env.HIKARI_FAKE_CODEX_STDOUT) { process.stdout.write(process.env.HIKARI_FAKE_CODEX_STDOUT); }",
        "  if (process.env.HIKARI_FAKE_CODEX_STDERR) { process.stderr.write(process.env.HIKARI_FAKE_CODEX_STDERR); }",
        "  const exitCode = Number(process.env.HIKARI_FAKE_CODEX_EXIT_CODE || 0);",
        "  if (exitCode) { process.exit(exitCode); }",
        "  if (outputFile) { fs.writeFileSync(outputFile, 'OK from fake codex'); }",
        '});'
      ].join('\n'), 'utf8');
      fs.chmodSync(fakePath, 0o755);
      return {
        fakePath,
        capturePath
      };
    }
    test('codex cli provider replays MCP tool progress from the native session transcript', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-stream'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-transcript-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const sessionId = '019e289d-7ba2-72c3-93a0-9bfe186543e1';
        const sessionDir = path.join(workspaceDir, 'Config', 'codex-cli-home', 'sessions', '2026', '05', '14');
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(
          path.join(sessionDir, `rollout-2026-05-14T17-31-09-${sessionId}.jsonl`),
          [
            JSON.stringify({
              type: 'response_item',
              payload: {
                type: 'function_call',
                name: 'ask_user',
                namespace: 'hikari',
                arguments: '{"question":"Which project scope should I use?","options":[{"label":"All projects","value":"Search all projects"}]}'
              }
            }),
            JSON.stringify({
              type: 'event_msg',
              payload: {
                type: 'mcp_tool_call_end',
                invocation: {
                  server: 'hikari',
                  tool: 'ask_user',
                  arguments: {
                    question: 'Which project scope should I use?',
                    options: [
                      { label: 'All projects', value: 'Search all projects' }
                    ]
                  }
                },
                result: {
                  Ok: {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          ok: true,
                          status: 'needs_user_answer',
                          user_question: {
                            question: 'Which project scope should I use?',
                            options: [
                              { label: 'All projects', value: 'Search all projects' }
                            ]
                          },
                          final_response: {
                            status: 'needs_more_info',
                            assistant_text: 'Which project scope should I use?',
                            user_question: {
                              question: 'Which project scope should I use?',
                              options: [
                                { label: 'All projects', value: 'Search all projects' }
                              ]
                            }
                          }
                        })
                      }
                    ],
                    isError: false
                  }
                }
              }
            }),
            ''
          ].join('\n'),
          'utf8'
        );
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.HIKARI_FAKE_CODEX_STDOUT;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.HIKARI_FAKE_CODEX_STDOUT = [
          JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Which project scope should I use?' }], phase: 'final_answer' } }),
          ''
        ].join('\n');

        try {
          const streamEvents = [];
          const result = await provider.requestCodexCliText({
            prompt: 'Replay transcript please.',
            cwd: workspaceDir,
            stream: true,
            onStream: (event) => {
              streamEvents.push(event);
            },
            returnMetadata: true
          });

          assert.equal(result.metadata.session_id, sessionId);
          assert.equal(result.text, 'OK from fake codex');
          assert.equal(streamEvents.some((event) => event.type === 'codex_tool_call' && event.tool_name === 'ask_user' && event.status === 'completed' && /needs_user_answer/.test(event.tool_output_text)), true);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDOUT;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });
    test('codex cli provider creates and resumes real Codex sessions for sub-agents', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      await withCodexHome({
        authFile: {
          auth_mode: 'chatgpt',
          tokens: {
            access_token: accessToken,
            refresh_token: 'refresh-token',
            account_id: 'acct-subagent'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-subagent-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.HIKARI_CODEX_CLI;
        const previousCapture = process.env.HIKARI_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.HIKARI_FAKE_CODEX_STDOUT;
        process.env.HIKARI_CODEX_CLI = fakeCodex.fakePath;
        process.env.HIKARI_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;

        try {
          process.env.HIKARI_FAKE_CODEX_STDOUT = JSON.stringify({
            type: 'session_configured',
            session_id: 'codex-session-1'
          });
          const created = await provider.requestCodexCliText({
            prompt: 'Create helper session.',
            cwd: workspaceDir,
            returnMetadata: true
          });
          const createCapture = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          assert.equal(created.text, 'OK from fake codex');
          assert.equal(created.metadata.session_id, 'codex-session-1');
          assert.equal(created.metadata.command, 'exec');
          assert.equal(createCapture.args.includes('resume'), false);
          assert.equal(createCapture.args.includes('--json'), true);

          process.env.HIKARI_FAKE_CODEX_STDOUT = JSON.stringify({
            type: 'session_resumed',
            session_id: 'codex-session-1'
          });
          const resumed = await provider.requestCodexCliText({
            prompt: 'Continue helper session.',
            cwd: workspaceDir,
            resumeSessionId: 'codex-session-1',
            returnMetadata: true
          });
          const resumeCapture = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          assert.equal(resumed.text, 'OK from fake codex');
          assert.equal(resumed.metadata.session_id, 'codex-session-1');
          assert.equal(resumed.metadata.resumed_session_id, 'codex-session-1');
          assert.equal(resumed.metadata.command, 'exec resume');
          assert.equal(resumeCapture.args.includes('resume'), true);
          assert.equal(resumeCapture.args.includes('codex-session-1'), true);
          assert.match(resumeCapture.stdin, /Continue helper session\./);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.HIKARI_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.HIKARI_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.HIKARI_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.HIKARI_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.HIKARI_FAKE_CODEX_STDOUT;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
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
    test('codex cli provider imports chatgpt oauth credentials from auth.json for login status', async () => {
      const accessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'scientist@example.com'
      });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-auth-'));
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
      const nativeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-native-auth-'));
      const appHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-app-auth-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
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
      process.env.HIKARI_CODEX_HOME = appHome;

      try {
        const provider = loadProvider();
        const profile = provider.readCodexCliOAuthProfile();
        assert.equal(profile.accessToken, appAccessToken);
        assert.equal(profile.sourcePath, path.join(appHome, 'auth.json'));
      } finally {
        if (typeof previousCodexHome === 'string') {
          process.env.CODEX_HOME = previousCodexHome;
        } else {
          delete process.env.CODEX_HOME;
        }
        if (typeof previousHikariCodexHome === 'string') {
          process.env.HIKARI_CODEX_HOME = previousHikariCodexHome;
        } else {
          delete process.env.HIKARI_CODEX_HOME;
        }
        fs.rmSync(nativeHome, { recursive: true, force: true });
        fs.rmSync(appHome, { recursive: true, force: true });
      }
    });
    test('codex cli provider refuses expired oauth access tokens for login status', async () => {
      const expiredAccessToken = buildJwt({
        exp: Math.floor(Date.now() / 1000) - 3600,
        email: 'scientist@example.com'
      });
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-auth-expired-'));
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
};
