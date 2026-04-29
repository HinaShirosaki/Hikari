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
        '  fs.writeFileSync(process.env.ENANA_FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), codexHome: process.env.CODEX_HOME }, null, 2));',
        "  if (outputFile) { fs.writeFileSync(outputFile, 'OK from fake codex'); }",
        '});'
      ].join('\n'), 'utf8');
      fs.chmodSync(fakePath, 0o755);
      return {
        fakePath,
        capturePath
      };
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
        assert.match(fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8'), /\[mcp_servers\.enana\]/);
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

    test('codex cli provider writes Enana AGENTS.md guidance into the runtime workspace', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-agents-'));
      try {
        const provider = loadProvider();
        const agentsPath = await provider.ensureCodexCliAgentsFile(workspaceDir);
        const firstContent = fs.readFileSync(agentsPath, 'utf8');
        assert.equal(agentsPath, path.join(workspaceDir, 'AGENTS.md'));
        assert.match(firstContent, /ENANA_CODEX_AGENT_INSTRUCTIONS_START/);
        assert.match(firstContent, /literature-search/);
        assert.match(firstContent, /paper-download/);
        assert.match(firstContent, /loads bounded paper context blocks/);

        fs.writeFileSync(agentsPath, `${firstContent}\nLocal note stays here.\n`, 'utf8');
        await provider.ensureCodexCliAgentsFile(workspaceDir);
        const secondContent = fs.readFileSync(agentsPath, 'utf8');
        assert.equal((secondContent.match(/ENANA_CODEX_AGENT_INSTRUCTIONS_START/g) || []).length, 1);
        assert.match(secondContent, /Local note stays here/);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    test('codex agent MCP gateway exposes Enana tools and instruction resources', async () => {
      const { createCodexAgentMcpGateway } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'mcp-gateway.js'
      ));
      const calls = [];
      const gateway = createCodexAgentMcpGateway({
        runTool: async (toolId, args, snapshot, context) => {
          calls.push({ toolId, args, snapshot, context });
          return {
            ok: true,
            items: [{ id: 'item-1' }],
            summary: 'Inventory lookup completed.'
          };
        }
      });

      const searchResult = gateway.toolSearch({ query: 'download paper pdf', limit: 6 });
      assert.equal(searchResult.ok, true);
      assert.equal(searchResult.results.some((entry) => entry.tool_id === 'paper-download'), true);

      const infoResult = gateway.toolInfo({ tool_id: 'literature-search', detail_level: 'schema' });
      assert.equal(infoResult.ok, true);
      assert.equal(infoResult.tool.tool_id, 'literature-search');
      assert.equal(infoResult.tool.input_schema.type, 'object');

      const callResult = await gateway.toolCall({
        tool_id: 'inventory-lookup',
        args: {
          query: 'PEI',
          limit: 3
        }
      }, {
        snapshot: { inventory: [] },
        requestId: 'req-1'
      });
      assert.equal(callResult.ok, true);
      assert.equal(callResult.status, 'completed');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].toolId, 'inventory-lookup');
      assert.equal(calls[0].args.query, 'PEI');
      assert.equal(calls[0].snapshot.inventory.length, 0);
      assert.equal(calls[0].context.requestId, 'req-1');

      const invalidResult = await gateway.toolCall({
        tool_id: 'inventory-lookup',
        args: {
          query: 'PEI',
          limit: 'many'
        }
      });
      assert.equal(invalidResult.ok, false);
      assert.equal(invalidResult.status, 'invalid_arguments');

      const instructions = gateway.resourceRead({ uri: 'enana://instructions/codex-agent' });
      assert.equal(instructions.ok, true);
      assert.match(instructions.contents, /Inference verification rules/);
      assert.match(instructions.contents, /paper-download/);
    });

    test('codex agent runtime builds a whole-turn prompt and parses the answer envelope', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const calls = [];
      const traceRows = [];
      const lifecycleEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          return JSON.stringify({
            status: 'completed',
            assistant_text: 'Atlas SUMO1 likely needs a follow-up expression check.',
            follow_up_questions: [],
            reasoning_summary: 'Used local project context and verified the conclusion.',
            citations: [
              {
                source: 'record-lookup',
                pointer: 'notebook:atlas-sumo1',
                reason: 'Matched the selected project record.'
              }
            ]
          });
        },
        recordAgentLlmTrace: async (_traceContext, event = {}) => {
          traceRows.push(event);
        },
        recordLifecycleEvent: (_recorder, event = {}) => {
          lifecycleEvents.push(event);
        },
        getWorkingDirectory: () => '/tmp/enana-workspace'
      });

      const result = await runtime.run({
        message: 'Why was SUMO1 conjugation weak?',
        conversation: [
          { role: 'user', text: 'Open Atlas.' },
          { role: 'assistant', text: 'Atlas is open.' }
        ],
        attachments: [
          {
            name: 'pilot.pdf',
            kind: 'file',
            mimeType: 'application/pdf',
            size: 1234,
            dataUrl: 'data:application/pdf;base64,abc'
          }
        ],
        projectId: 'proj-1',
        projectName: 'Atlas SUMO1',
        selectionInsight: {
          actionType: 'what_is_it',
          selectedText: 'weak conjugation'
        },
        snapshot: {
          data_file_path: '/tmp/enana-data.json'
        },
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        traceContext: { requestId: 'req-codex-runtime', rows: [], entries: [] },
        lifecycleRecorder: { requestId: 'req-codex-runtime', events: [] }
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, 'gpt-5.4');
      assert.equal(calls[0].reasoningEffort, 'high');
      assert.equal(calls[0].enableWebSearch, true);
      assert.match(calls[0].prompt, /Codex-Owned Agent Request/);
      assert.match(calls[0].prompt, /Current user request:\nWhy was SUMO1 conjugation weak\?/);
      assert.match(calls[0].prompt, /Recent conversation:/);
      assert.match(calls[0].prompt, /Selection insight context:/);
      assert.match(calls[0].prompt, /pilot\.pdf/);
      assert.match(calls[0].prompt, /"assistant_text"/);
      const mcpContext = JSON.parse(calls[0].envOverrides.ENANA_CODEX_REQUEST_CONTEXT);
      assert.equal(mcpContext.provider, 'codex');
      assert.equal(mcpContext.model, 'gpt-5.4');
      assert.equal(mcpContext.project.name, 'Atlas SUMO1');
      assert.equal(mcpContext.dataFilePath, '/tmp/enana-data.json');
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'codex_agent');
      assert.equal(result.codex_agent.status, 'completed');
      assert.match(result.codex_agent.answer, /SUMO1 likely/);
      assert.equal(result.codex_agent.citations.length, 1);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_runtime'), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'codex_agent_completed'), true);
    });

    test('codex agent runtime wraps non-json output with a parse warning', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const traceRows = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async () => 'Plain answer from Codex.',
        recordAgentLlmTrace: async (_traceContext, event = {}) => {
          traceRows.push(event);
        }
      });

      const result = await runtime.run({
        message: 'Answer plainly.',
        model: 'gpt-5.4',
        traceContext: { requestId: 'req-codex-raw', rows: [], entries: [] }
      });

      assert.equal(result.ok, true);
      assert.equal(result.codex_agent.answer, 'Plain answer from Codex.');
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /non-JSON output/);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_parse_warning'), true);
    });

    test('codex MCP stdio server forwards request context from the Codex command environment', async () => {
      const { createCodexAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'mcp-stdio-server.js'
      ));
      let capturedContext = null;
      const outputChunks = [];
      const server = createCodexAgentMcpStdioServer({
        input: { on() {} },
        output: {
          write(chunk) {
            outputChunks.push(String(chunk || ''));
          }
        },
        env: {
          ENANA_CODEX_REQUEST_CONTEXT: JSON.stringify({
            provider: 'codex',
            model: 'gpt-5.4',
            project: {
              id: 'proj-1',
              name: 'Atlas'
            },
            traceRequestId: 'req-ctx'
          })
        },
        gateway: {
          async callGatewayTool(_name, _args, context = {}) {
            capturedContext = context;
            return {
              ok: true,
              results: []
            };
          }
        }
      });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'tool_search',
          arguments: {
            query: 'paper'
          }
        }
      });

      assert.equal(capturedContext.provider, 'codex');
      assert.equal(capturedContext.model, 'gpt-5.4');
      assert.equal(capturedContext.project.name, 'Atlas');
      assert.equal(capturedContext.traceRequestId, 'req-ctx');
      assert.equal(capturedContext.mcpRequest.id, 7);
      assert.equal(outputChunks.join('').includes('"jsonrpc":"2.0"'), true);
    });

    test('codex agent MCP config includes the app host callback when available', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-mcp-config-'));
      const previousHost = process.env.ENANA_CODEX_MCP_HOST;
      const previousToken = process.env.ENANA_CODEX_MCP_TOKEN;
      process.env.ENANA_CODEX_MCP_HOST = 'http://127.0.0.1:43123';
      process.env.ENANA_CODEX_MCP_TOKEN = 'test-token';
      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        const configText = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(configText, /\[mcp_servers\.enana\]/);
        assert.match(configText, /ENANA_CODEX_MCP_HOST/);
        assert.match(configText, /http:\/\/127\.0\.0\.1:43123/);
        assert.match(configText, /ENANA_CODEX_MCP_TOKEN/);
      } finally {
        if (typeof previousHost === 'string') {
          process.env.ENANA_CODEX_MCP_HOST = previousHost;
        } else {
          delete process.env.ENANA_CODEX_MCP_HOST;
        }
        if (typeof previousToken === 'string') {
          process.env.ENANA_CODEX_MCP_TOKEN = previousToken;
        } else {
          delete process.env.ENANA_CODEX_MCP_TOKEN;
        }
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider runs codex exec with Enana AGENTS.md and MCP config', async () => {
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
            account_id: 'acct-456'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-request-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.ENANA_CODEX_CLI;
        const previousCapture = process.env.ENANA_FAKE_CODEX_CAPTURE;
        process.env.ENANA_CODEX_CLI = fakeCodex.fakePath;
        process.env.ENANA_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;

        try {
          const result = await provider.requestCodexCliText({
            prompt: 'Return OK only.',
            cwd: workspaceDir,
            enableWebSearch: true
          });
          const captured = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          const runtimeConfig = fs.readFileSync(path.join(captured.codexHome, 'config.toml'), 'utf8');
          assert.equal(result, 'OK from fake codex');
          assert.equal(fs.realpathSync(captured.cwd), fs.realpathSync(workspaceDir));
          assert.equal(captured.args.includes('exec'), true);
          assert.equal(captured.args.includes('--search'), true);
          assert.equal(captured.args.includes('--output-last-message'), true);
          assert.match(captured.stdin, /Return OK only\./);
          assert.equal(fs.existsSync(path.join(workspaceDir, 'AGENTS.md')), true);
          assert.match(runtimeConfig, /\[mcp_servers\.enana\]/);
          assert.match(runtimeConfig, /mcp-stdio-server\.js/);
        } finally {
          if (typeof previousCodexCli === 'string') {
            process.env.ENANA_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.ENANA_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.ENANA_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.ENANA_FAKE_CODEX_CAPTURE;
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

    test('codex cli provider refuses expired oauth access tokens for login status', async () => {
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
