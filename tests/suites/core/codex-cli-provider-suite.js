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
        "  if (process.env.ENANA_FAKE_CODEX_STDOUT) { process.stdout.write(process.env.ENANA_FAKE_CODEX_STDOUT); }",
        "  if (process.env.ENANA_FAKE_CODEX_STDERR) { process.stderr.write(process.env.ENANA_FAKE_CODEX_STDERR); }",
        "  const exitCode = Number(process.env.ENANA_FAKE_CODEX_EXIT_CODE || 0);",
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

    test('codex cli provider can disable native tool search before exec', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt',
          disableToolSearch: true
        });

        const disableIndex = args.indexOf('--disable');
        const toolSearchIndex = args.indexOf('tool_search');
        const execIndex = args.indexOf('exec');
        assert.equal(disableIndex >= 0, true);
        assert.equal(toolSearchIndex, disableIndex + 1);
        assert.equal(execIndex > toolSearchIndex, true);
      });
    });

    test('codex cli provider builds noninteractive resume args for Codex sub-agent sessions', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const args = provider.buildCodexCliExecResumeArgs({
          outputFile: '/tmp/codex-last-message.txt',
          sessionId: 'codex-session-1',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          streamJson: true
        });

        assert.equal(args.includes('exec'), true);
        assert.equal(args.includes('resume'), true);
        assert.equal(args.includes('--json'), true);
        assert.equal(args.includes('--color'), false);
        assert.equal(args.includes('codex-session-1'), true);
        assert.equal(args[args.length - 2], 'codex-session-1');
        assert.equal(args[args.length - 1], '-');
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
        const runtimeConfig = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(runtimeConfig, /\[mcp_servers\.hikari\]/);
        assert.match(runtimeConfig, /HIKARI_AGENT_MCP/);
        assert.match(runtimeConfig, /HIKARI_CODEX_MCP/);
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

    test('codex MCP config points packaged app paths at app.asar.unpacked', () => {
      const {
        resolveUnpackedAsarPath,
        buildHikariCodexMcpConfigBlock
      } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime-files.js'
      ));
      const packedServerPath = [
        '',
        'Applications',
        'Hikari.app',
        'Contents',
        'Resources',
        'app.asar',
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ].join(path.sep);
      const unpackedServerPath = resolveUnpackedAsarPath(packedServerPath);

      assert.equal(unpackedServerPath.includes(`${path.sep}app.asar.unpacked${path.sep}`), true);
      assert.equal(unpackedServerPath.includes(`${path.sep}app.asar${path.sep}`), false);
      assert.equal(resolveUnpackedAsarPath('/tmp/Hikari/src/main.js'), '/tmp/Hikari/src/main.js');
      assert.match(buildHikariCodexMcpConfigBlock({ workspace: '/tmp/Hikari' }), /\[mcp_servers\.hikari\]/);
    });

    test('codex cli provider writes Hikari AGENTS.md guidance into the runtime workspace', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-agents-'));
      try {
        const provider = loadProvider();
        const agentsPath = await provider.ensureCodexCliAgentsFile(workspaceDir);
        const firstContent = fs.readFileSync(agentsPath, 'utf8');
        assert.equal(agentsPath, path.join(workspaceDir, 'AGENTS.md'));
        assert.match(firstContent, /HIKARI_CODEX_AGENT_INSTRUCTIONS_START/);
        assert.match(firstContent, /literature-search/);
        assert.match(firstContent, /paper-download/);
        assert.match(firstContent, /loads bounded paper context blocks/);

        fs.writeFileSync(agentsPath, `${firstContent}\nLocal note stays here.\n`, 'utf8');
        await provider.ensureCodexCliAgentsFile(workspaceDir);
        const secondContent = fs.readFileSync(agentsPath, 'utf8');
        assert.equal((secondContent.match(/HIKARI_CODEX_AGENT_INSTRUCTIONS_START/g) || []).length, 1);
        assert.match(secondContent, /Local note stays here/);
      } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider does not write Hikari files at filesystem root', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-root-cwd-'));
      const previousCwd = process.cwd();
      const rootPath = path.parse(workspaceDir).root;
      await withCodexHome({}, async () => {
        try {
          process.chdir(workspaceDir);
          const provider = loadProvider();
          const agentsPath = await provider.ensureCodexCliAgentsFile(rootPath);
          const runtimeHome = await provider.ensureCodexCliRuntimeHome(rootPath);

          assert.equal(fs.realpathSync(agentsPath), fs.realpathSync(path.join(workspaceDir, 'AGENTS.md')));
          assert.equal(fs.realpathSync(runtimeHome), fs.realpathSync(path.join(workspaceDir, 'Config', 'codex-cli-home')));
          assert.notEqual(agentsPath, path.join(rootPath, 'AGENTS.md'));
          assert.notEqual(runtimeHome, path.join(rootPath, 'Config', 'codex-cli-home'));
        } finally {
          process.chdir(previousCwd);
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });

    test('agent MCP gateway exposes Hikari tools and instruction resources', async () => {
      const { createAgentMcpGateway } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'gateway.js'
      ));
      const { createMcpToolDefinitions } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const calls = [];
      const gateway = createAgentMcpGateway({
        runTool: async (toolId, args, snapshot, context) => {
          calls.push({ toolId, args, snapshot, context });
          if (toolId === 'protocol-matching') {
            const selectedProtocol = {
              id: 'prot-1',
              name: 'Protein purification',
              purpose: 'Purify His-tagged protein.',
              score: 120
            };
            return {
              ok: true,
              result: {
                ranked_matches: [selectedProtocol],
                selected_protocol: selectedProtocol,
                selection_method: 'deterministic',
                rationale: 'Exact protocol candidate match.',
                items: [selectedProtocol]
              },
              items: [selectedProtocol],
              summary: 'Selected protocol Protein purification.'
            };
          }
          if (toolId === 'protocol-generation') {
            const savedProtocolId = args.save === true ? (args.protocol.id || 'protocol-saved-1') : '';
            return {
              ok: true,
              result: {
                ok: true,
                status: args.save === true ? 'saved' : 'normalized',
                protocol: {
                  ...(savedProtocolId ? { id: savedProtocolId } : {}),
                  name: args.protocol.name,
                  purpose: args.protocol.purpose || '',
                  materials: args.protocol.materials || [],
                  steps: args.protocol.steps.map((step, index) => ({
                    id: `step-${index + 1}`,
                    text: typeof step === 'string' ? step : step.text,
                    placeholders: []
                  })),
                  troubleshooting: args.protocol.troubleshooting || ''
                },
                summary: args.save === true ? 'Saved protocol JSON.' : 'Prepared protocol JSON.'
              },
              summary: args.save === true ? 'Saved protocol JSON.' : 'Prepared protocol JSON.'
            };
          }
          if (toolId === 'record-lookup') {
            const items = [
              {
                record_type: 'protocol',
                id: 'prot-1',
                title: 'Protein purification',
                project_id: 'proj-1',
                project_name: 'Atlas',
                summary: 'Purify His-tagged protein.'
              },
              {
                record_type: 'notebook',
                id: 'nb-1',
                title: 'Protein purification run 1',
                project_id: 'proj-1',
                project_name: 'Atlas',
                summary: 'Yield was low.'
              }
            ];
            return {
              ok: true,
              result: {
                status: 'matched',
                source: 'fallback_json',
                query: args.query,
                items
              },
              items,
              summary: 'Record lookup completed.'
            };
          }
          const items = [
            {
              kind: 'chemical',
              id: 'chem-1',
              name: 'PEI',
              amount: '25 g',
              location: 'Shelf A'
            },
            {
              kind: 'personal_sample',
              id: 'sample-1',
              name: 'PEI transfection sample'
            }
          ];
          return {
            ok: true,
            result: {
              status: 'matched',
              source: 'sqlite',
              query: args.query,
              items
            },
            items,
            summary: 'Inventory lookup completed.'
          };
        }
      });

      const mcpToolNames = createMcpToolDefinitions().map((tool) => tool.name);
      assert.deepEqual(mcpToolNames.slice(0, 6), [
        'inventory_lookup',
        'chemical_lookup',
        'protocol_lookup',
        'protocol_generation',
        'notebook_lookup',
        'ask_user'
      ]);
      assert.equal(mcpToolNames.includes('inventory_lookup'), true);
      assert.equal(mcpToolNames.includes('chemical_lookup'), true);
      assert.equal(mcpToolNames.includes('protocol_lookup'), true);
      assert.equal(mcpToolNames.includes('protocol_generation'), true);
      assert.equal(mcpToolNames.includes('protocol_save'), false);
      assert.equal(mcpToolNames.includes('notebook_lookup'), true);
      assert.equal(mcpToolNames.includes('ask_user'), true);
      assert.equal(mcpToolNames.indexOf('tool_search') > mcpToolNames.indexOf('ask_user'), true);
      const askUserDefinition = createMcpToolDefinitions().find((tool) => tool.name === 'ask_user');
      const protocolGenerationDefinition = createMcpToolDefinitions().find((tool) => tool.name === 'protocol_generation');
      const toolSearchDefinition = createMcpToolDefinitions().find((tool) => tool.name === 'tool_search');
      const toolCallDefinition = createMcpToolDefinitions().find((tool) => tool.name === 'tool_call');
      assert.equal(askUserDefinition.annotations.readOnlyHint, true);
      assert.equal(askUserDefinition.annotations.destructiveHint, false);
      assert.equal(askUserDefinition.annotations.openWorldHint, false);
      assert.equal(protocolGenerationDefinition.annotations.readOnlyHint, false);
      assert.equal(protocolGenerationDefinition.annotations.destructiveHint, false);
      assert.equal(toolSearchDefinition.annotations.readOnlyHint, true);
      assert.equal(toolCallDefinition.annotations, undefined);

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

      const chemicalResult = await gateway.callGatewayTool('chemical_lookup', {
        query: 'PEI',
        limit: 2
      }, {
        requestId: 'req-chemical'
      });
      assert.equal(chemicalResult.ok, true);
      assert.equal(chemicalResult.status, 'matched');
      assert.deepEqual(chemicalResult.items.map((item) => item.kind), ['chemical']);
      assert.equal(calls[calls.length - 1].toolId, 'inventory-lookup');
      assert.equal(calls[calls.length - 1].args.limit, 8);

      const protocolResult = await gateway.callGatewayTool('protocol_lookup', {
        query: 'protein purification',
        limit: 2,
        project_id: 'proj-1'
      }, {
        requestId: 'req-protocol'
      });
      assert.equal(protocolResult.ok, true);
      assert.equal(protocolResult.status, 'matched');
      assert.deepEqual(protocolResult.items.map((item) => item.name), ['Protein purification']);
      assert.equal(protocolResult.app_tool, 'protocol-matching');
      assert.equal(protocolResult.selection_method, 'deterministic');
      assert.equal(calls[calls.length - 1].toolId, 'protocol-matching');
      assert.deepEqual(calls[calls.length - 1].args.protocol_candidates, ['protein purification']);
      assert.equal(calls[calls.length - 1].context.parserPayload.primary_intent, 'protocol_to_notebook');
      assert.equal(calls[calls.length - 1].context.project.id, 'proj-1');

      const protocolGenerationResult = await gateway.callGatewayTool('protocol_generation', {
        protocol: {
          title: 'Protein purification',
          purpose: 'Purify His-tagged protein.',
          materials: ['Ni-NTA resin'],
          steps: ['Bind lysate to resin for [time].']
        },
        result_summary: 'Normalize the protocol.'
      }, {
        requestId: 'req-protocol-generation'
      });
      assert.equal(protocolGenerationResult.ok, true);
      assert.equal(protocolGenerationResult.status, 'normalized');
      assert.equal(protocolGenerationResult.protocol.name, 'Protein purification');
      assert.equal(Object.prototype.hasOwnProperty.call(protocolGenerationResult.protocol, 'id'), false);
      assert.equal(calls[calls.length - 1].toolId, 'protocol-generation');
      assert.equal(calls[calls.length - 1].args.protocol.name, 'Protein purification');
      assert.equal(Object.prototype.hasOwnProperty.call(calls[calls.length - 1].args.protocol, 'id'), false);

      const protocolSaveResult = await gateway.callGatewayTool('protocol_generation', {
        protocol: {
          name: 'Protein purification',
          purpose: 'Purify His-tagged protein.',
          materials: ['Ni-NTA resin'],
          steps: ['Bind lysate to resin for [time].']
        },
        result_summary: 'Save the generated protocol.',
        save: true
      }, {
        requestId: 'req-protocol-save'
      });
      assert.equal(protocolSaveResult.ok, true);
      assert.equal(protocolSaveResult.status, 'saved');
      assert.equal(protocolSaveResult.protocol.id, 'protocol-saved-1');
      assert.equal(calls[calls.length - 1].toolId, 'protocol-generation');
      assert.equal(calls[calls.length - 1].args.save, true);

      const askUserResult = await gateway.callGatewayTool('ask_user', {
        question: 'Which project should I use?',
        options: [
          { label: 'Atlas', value: 'Use Atlas.', description: 'Continue in the current project.' },
          'All projects'
        ],
        allow_custom: true
      }, {
        requestId: 'req-ask-user'
      });
      assert.equal(askUserResult.ok, true);
      assert.equal(askUserResult.status, 'needs_user_answer');
      assert.equal(askUserResult.user_question.question, 'Which project should I use?');
      assert.equal(askUserResult.user_question.options.length, 2);
      assert.equal(askUserResult.final_response.status, 'needs_more_info');
      assert.equal(calls[calls.length - 1].toolId, 'protocol-generation');

      const invalidResult = await gateway.toolCall({
        tool_id: 'inventory-lookup',
        args: {
          query: 'PEI',
          limit: 'many'
        }
      });
      assert.equal(invalidResult.ok, false);
      assert.equal(invalidResult.status, 'invalid_arguments');

      const instructions = gateway.resourceRead({ uri: 'hikari://instructions/agent-mcp' });
      assert.equal(instructions.ok, true);
      assert.match(instructions.contents, /provider-neutral Hikari app contract/);
      assert.match(instructions.contents, /Direct Hikari MCP tools available without `tool_search`/);
      assert.match(instructions.contents, /`protocol_generation`/);
      assert.match(instructions.contents, /save: true/);
      assert.match(instructions.contents, /`ask_user`/);
      assert.match(instructions.contents, /paper-download/);
      const legacyInstructions = gateway.resourceRead({ uri: 'enana://instructions/codex-agent' });
      assert.equal(legacyInstructions.ok, true);
      assert.match(legacyInstructions.contents, /provider-neutral Hikari app contract/);
    });

    test('codex agent runtime builds a Codex-session prompt and renders plain final text', async () => {
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
      const progressEvents = [];
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          input.onStream?.({
            type: 'codex_thinking',
            thinking_text: 'Checking the relevant project records.',
            event_type: 'agent_reasoning_delta'
          });
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'started',
            tool_name: 'inventory_lookup',
            tool_call_text: 'inventory_lookup: {"query":"SUMO1"}',
            event_type: 'tool_call_started'
          });
          input.onStream?.({
            text_delta: 'Streaming answer.',
            accumulated_text: 'Streaming answer.',
            event_type: 'agent_message_delta'
          });
          return {
            text: 'Atlas SUMO1 likely needs a follow-up expression check.',
            metadata: {
              session_id: 'codex-chat-session-1',
              command: 'exec'
            }
          };
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
        cwd: path.parse('/tmp/enana-workspace').root,
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        traceContext: { requestId: 'req-codex-runtime', rows: [], entries: [] },
        lifecycleRecorder: { requestId: 'req-codex-runtime', events: [] },
        emitAgentProgress: (event = {}) => {
          progressEvents.push(event);
        }
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, 'gpt-5.4');
      assert.equal(calls[0].reasoningEffort, 'high');
      assert.equal(calls[0].cwd, '/tmp/enana-workspace');
      assert.equal(calls[0].stream, true);
      assert.equal(typeof calls[0].onStream, 'function');
      assert.equal(calls[0].enableWebSearch, true);
      assert.equal(calls[0].disableToolSearch, true);
      assert.equal(calls[0].returnMetadata, true);
      assert.equal(calls[0].resumeSessionId, '');
      assert.match(calls[0].prompt, /Codex Chat Turn/);
      assert.match(calls[0].prompt, /Current user request:\nWhy was SUMO1 conjugation weak\?/);
      assert.doesNotMatch(calls[0].prompt, /Recent conversation:/);
      assert.match(calls[0].prompt, /Selection insight context:/);
      assert.match(calls[0].prompt, /pilot\.pdf/);
      assert.doesNotMatch(calls[0].prompt, /"assistant_text"/);
      const mcpContext = JSON.parse(calls[0].envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT);
      assert.equal(mcpContext.provider, 'codex');
      assert.equal(mcpContext.model, 'gpt-5.4');
      assert.equal(mcpContext.cwd, '/tmp/enana-workspace');
      assert.equal(mcpContext.chatSessionId, '');
      assert.equal(mcpContext.codexSessionId, '');
      assert.deepEqual(mcpContext.conversation, []);
      assert.equal(mcpContext.project.name, 'Atlas SUMO1');
      assert.equal(mcpContext.dataFilePath, '/tmp/enana-data.json');
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.ENANA_AGENT_MCP_REQUEST_CONTEXT),
        mcpContext
      );
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT),
        mcpContext
      );
      assert.deepEqual(
        JSON.parse(calls[0].envOverrides.ENANA_CODEX_REQUEST_CONTEXT),
        mcpContext
      );
      assert.equal(result.ok, true);
      assert.equal(result.parser.primary_intent, 'codex_agent');
      assert.equal(result.parser.needs_clarification, false);
      assert.equal(result.codex_agent.status, 'completed');
      assert.match(result.codex_agent.answer, /SUMO1 likely/);
      assert.equal(result.codex_agent.user_question, null);
      assert.equal(result.codex_agent.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_agent.citations.length, 0);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_runtime'), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'codex_agent_completed'), true);
      assert.equal(progressEvents.some((event) => event.stage === 'codex_agent_thinking' && event.meta?.thinking_trace === 'Checking the relevant project records.'), true);
      assert.equal(progressEvents.some((event) => event.stage === 'tool_call_started' && event.tool_name === 'inventory_lookup' && event.meta?.tool_call_text.includes('SUMO1')), true);
      assert.equal(progressEvents.some((event) => event.stage === 'codex_agent_stream'), true);
      assert.equal(progressEvents.some((event) => event.meta?.stream_text === 'Streaming answer.'), true);
    });

    test('codex agent runtime preserves renderable user questions', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async () => ({
          text: JSON.stringify({
            status: 'needs_more_info',
            assistant_text: 'Which project should I use?',
            follow_up_questions: ['Which project should I use?'],
            user_question: {
              question: 'Which project should I use?',
              options: [
                { label: 'Atlas', value: 'Use Atlas.' },
                { label: 'All projects', value: 'Search all projects.' }
              ],
              allow_custom: true
            },
            reasoning_summary: 'Waiting for one project-scope clarification.',
            citations: []
          }),
          metadata: {
            session_id: 'codex-clarify-session'
          }
        })
      });

      const result = await runtime.run({
        message: 'Summarize the latest notes.',
        model: 'gpt-5.4',
        cwd: '/tmp/enana-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.parser.clarification_reason, 'Which project should I use?');
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.codex_session_id, 'codex-clarify-session');
      assert.equal(result.codex_agent.user_question.question, 'Which project should I use?');
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Use Atlas.', 'Search all projects.']
      );
    });

    test('codex agent runtime recovers ask_user clarification from tool stream when final text is prose', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const askUserResult = {
        ok: true,
        status: 'needs_user_answer',
        mcp_tool: 'ask_user',
        user_question: {
          question: 'Which project should I use?',
          options: [
            { label: 'Atlas', value: 'Use Atlas.' },
            { label: 'All projects', value: 'Search all projects.' }
          ],
          allow_custom: true
        },
        final_response: {
          status: 'needs_more_info',
          assistant_text: 'Which project should I use?',
          follow_up_questions: ['Which project should I use?'],
          user_question: {
            question: 'Which project should I use?',
            options: [
              { label: 'Atlas', value: 'Use Atlas.' },
              { label: 'All projects', value: 'Search all projects.' }
            ],
            allow_custom: true
          },
          reasoning_summary: 'Waiting for one project-scope clarification.',
          citations: []
        }
      };
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'completed',
            tool_name: 'ask_user',
            tool_call_text: `ask_user: ${JSON.stringify(askUserResult)}`,
            tool_output_text: JSON.stringify(askUserResult),
            event_type: 'tool_call_completed'
          });
          return {
            text: 'I need one detail before I can answer well.',
            metadata: {
              session_id: 'codex-clarify-stream-session'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Summarize the latest notes.',
        model: 'gpt-5.4',
        cwd: '/tmp/enana-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.parser.clarification_reason, 'Which project should I use?');
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.answer, 'Which project should I use?');
      assert.equal(result.codex_agent.codex_session_id, 'codex-clarify-stream-session');
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Use Atlas.', 'Search all projects.']
      );
    });

    test('codex agent runtime recovers ask_user clarification from tool arguments', async () => {
      const { createCodexAgentRuntime } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'codex-agent',
        'runtime.js'
      ));
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          input.onStream?.({
            type: 'codex_tool_call',
            status: 'started',
            tool_name: 'ask_user',
            tool_call_text: 'ask_user: {"question":"Which project scope should I use?","options":[{"label":"All projects","value":"Search all projects"},{"label":"PD-1 Nanobody Binder Discovery","value":"Use the PD-1 project"}],"allow_custom":false}',
            event_type: 'function_call'
          });
          return {
            text: 'Which project scope should I use?',
            metadata: {
              session_id: 'codex-clarify-args-session'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Ask for project scope first.',
        model: 'gpt-5.4',
        cwd: '/tmp/enana-workspace'
      });

      assert.equal(result.ok, true);
      assert.equal(result.parser.needs_clarification, true);
      assert.equal(result.codex_agent.status, 'needs_more_info');
      assert.equal(result.codex_agent.user_question.allow_custom, false);
      assert.deepEqual(
        result.codex_agent.user_question.options.map((option) => option.value),
        ['Search all projects', 'Use the PD-1 project']
      );
    });

    test('codex agent runtime treats non-json output as normal assistant text', async () => {
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
        requestCodexAgentText: async () => ({
          text: 'Plain answer from Codex.',
          metadata: {
            session_id: 'codex-plain-session'
          }
        }),
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
      assert.equal(result.codex_session_id, 'codex-plain-session');
      assert.equal(result.warnings, undefined);
      assert.equal(traceRows.some((row) => row.stage === 'codex_agent_completed'), true);
    });

    test('codex agent runtime resumes the Codex session stored on a Hikari chat', async () => {
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
      const runtime = createCodexAgentRuntime({
        cleanText: (value, maxLength = 2000) => {
          const text = String(value || '').trim();
          return maxLength > 0 ? text.slice(0, maxLength) : text;
        },
        requestCodexAgentText: async (input = {}) => {
          calls.push(input);
          return {
            text: 'Continuing the same Codex chat.',
            metadata: {
              session_id: 'codex-chat-session-1',
              resumed_session_id: 'codex-chat-session-1',
              command: 'exec resume'
            }
          };
        }
      });

      const result = await runtime.run({
        message: 'Continue from there.',
        model: 'gpt-5.4',
        cwd: '/tmp/enana-workspace',
        chatSessionId: 'hikari-chat-1',
        codexSessionId: 'codex-chat-session-1'
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].resumeSessionId, 'codex-chat-session-1');
      assert.equal(calls[0].returnMetadata, true);
      const mcpContext = JSON.parse(calls[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT);
      assert.equal(mcpContext.chatSessionId, 'hikari-chat-1');
      assert.equal(mcpContext.codexSessionId, 'codex-chat-session-1');
      assert.equal(result.codex_session_id, 'codex-chat-session-1');
      assert.equal(result.resumed_codex_session_id, 'codex-chat-session-1');
      assert.equal(result.codex_agent.answer, 'Continuing the same Codex chat.');
    });

    test('agent MCP stdio server forwards request context from the provider environment', async () => {
      const { createAgentMcpStdioServer } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ));
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

      let capturedContext = null;
      const { server, connect } = createAgentMcpStdioServer({
        env: {
          HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({
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
          },
          resourceSearch: () => ({ results: [] }),
          resourceRead: () => ({ ok: false, error: 'unused' })
        }
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await connect(serverTransport);
      const client = new Client(
        { name: 'hikari-test-client', version: '0.0.1' },
        { capabilities: {} }
      );
      await client.connect(clientTransport);

      try {
        const response = await client.callTool({
          name: 'tool_search',
          arguments: { query: 'paper' }
        });

        assert.equal(capturedContext.provider, 'codex');
        assert.equal(capturedContext.model, 'gpt-5.4');
        assert.equal(capturedContext.project.name, 'Atlas');
        assert.equal(capturedContext.traceRequestId, 'req-ctx');
        assert.equal(capturedContext.mcpRequest.method, 'tools/call');
        assert.equal(capturedContext.mcpRequest.params.name, 'tool_search');
        assert.equal(response.isError, false);
        assert.equal(Array.isArray(response.content), true);
        assert.equal(response.content[0].type, 'text');
        assert.equal(response.content[0].text.includes('"ok": true'), true);
      } finally {
        await client.close();
        await server.close();
      }
    });

    test('codex agent MCP config includes the app host callback when available', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-mcp-config-'));
      const previousAgentHost = process.env.HIKARI_AGENT_MCP_HOST;
      const previousAgentToken = process.env.HIKARI_AGENT_MCP_TOKEN;
      const previousHikariHost = process.env.HIKARI_CODEX_MCP_HOST;
      const previousHikariToken = process.env.HIKARI_CODEX_MCP_TOKEN;
      process.env.HIKARI_AGENT_MCP_HOST = 'http://127.0.0.1:43123';
      process.env.HIKARI_AGENT_MCP_TOKEN = 'test-token';
      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        const configText = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(configText, /\[mcp_servers\.hikari\]/);
        assert.match(configText, /HIKARI_AGENT_MCP_HOST/);
        assert.match(configText, /ENANA_AGENT_MCP_HOST/);
        assert.match(configText, /HIKARI_CODEX_MCP_HOST/);
        assert.match(configText, /ENANA_CODEX_MCP_HOST/);
        assert.match(configText, /http:\/\/127\.0\.0\.1:43123/);
        assert.match(configText, /HIKARI_AGENT_MCP_TOKEN/);
        assert.match(configText, /ENANA_AGENT_MCP_TOKEN/);
        assert.match(configText, /HIKARI_CODEX_MCP_TOKEN/);
        assert.match(configText, /ENANA_CODEX_MCP_TOKEN/);
      } finally {
        if (typeof previousAgentHost === 'string') {
          process.env.HIKARI_AGENT_MCP_HOST = previousAgentHost;
        } else {
          delete process.env.HIKARI_AGENT_MCP_HOST;
        }
        if (typeof previousAgentToken === 'string') {
          process.env.HIKARI_AGENT_MCP_TOKEN = previousAgentToken;
        } else {
          delete process.env.HIKARI_AGENT_MCP_TOKEN;
        }
        if (typeof previousHikariHost === 'string') {
          process.env.HIKARI_CODEX_MCP_HOST = previousHikariHost;
        } else {
          delete process.env.HIKARI_CODEX_MCP_HOST;
        }
        if (typeof previousHikariToken === 'string') {
          process.env.HIKARI_CODEX_MCP_TOKEN = previousHikariToken;
        } else {
          delete process.env.HIKARI_CODEX_MCP_TOKEN;
        }
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    test('codex cli provider runs codex exec with Hikari AGENTS.md and MCP config', async () => {
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
          assert.match(runtimeConfig, /\[mcp_servers\.hikari\]/);
          assert.match(runtimeConfig, /mcp-contract\/stdio-server\.js/);
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

    test('codex cli provider streams assistant text from codex json events', async () => {
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
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-stream-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.ENANA_CODEX_CLI;
        const previousCapture = process.env.ENANA_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.ENANA_FAKE_CODEX_STDOUT;
        process.env.ENANA_CODEX_CLI = fakeCodex.fakePath;
        process.env.ENANA_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.ENANA_FAKE_CODEX_STDOUT = [
          JSON.stringify({ type: 'event_msg', payload: { type: 'agent_reasoning', text: 'Checking project context.' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'I am checking inventory.' } }),
          JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'inventory_lookup', arguments: { query: 'SUMO1' } } }),
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'mcp_tool_call_end',
              invocation: {
                server: 'hikari',
                tool: 'inventory_lookup',
                arguments: { query: 'SUMO1' }
              },
              result: {
                Ok: {
                  content: [
                    { type: 'text', text: 'Found 2 matching records.' }
                  ],
                  isError: false
                }
              }
            }
          }),
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Final response from Codex.' }], phase: 'final_answer' } }),
          ''
        ].join('\n');

        try {
          const streamEvents = [];
          const result = await provider.requestCodexCliText({
            prompt: 'Stream please.',
            cwd: workspaceDir,
            stream: true,
            onStream: (event) => {
              streamEvents.push(event);
            }
          });
          const captured = JSON.parse(fs.readFileSync(fakeCodex.capturePath, 'utf8'));
          const assistantStreamEvents = streamEvents.filter((event) => event.type === 'codex_stream');
          assert.equal(result, 'OK from fake codex');
          assert.equal(captured.args.includes('--json'), true);
          assert.deepEqual(
            assistantStreamEvents.map((event) => event.text_delta),
            ['Final response from Codex.']
          );
          assert.equal(assistantStreamEvents[assistantStreamEvents.length - 1].accumulated_text, 'Final response from Codex.');
          assert.equal(streamEvents.some((event) => event.type === 'codex_thinking' && event.thinking_text === 'Checking project context.'), true);
          assert.equal(streamEvents.some((event) => event.type === 'codex_thinking' && event.thinking_text === 'I am checking inventory.'), true);
          assert.equal(streamEvents.some((event) => event.type === 'codex_tool_call' && event.tool_name === 'inventory_lookup' && event.status === 'started'), true);
          assert.equal(streamEvents.some((event) => event.type === 'codex_tool_call' && event.status === 'completed' && /Found 2/.test(event.tool_call_text)), true);
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
          if (typeof previousStdout === 'string') {
            process.env.ENANA_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.ENANA_FAKE_CODEX_STDOUT;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });

    test('codex cli provider reports no-credit json failures before plugin warnings', async () => {
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
            account_id: 'acct-no-credits'
          }
        }
      }, async () => {
        const provider = loadProvider();
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-no-credits-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.ENANA_CODEX_CLI;
        const previousCapture = process.env.ENANA_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.ENANA_FAKE_CODEX_STDOUT;
        const previousStderr = process.env.ENANA_FAKE_CODEX_STDERR;
        const previousExitCode = process.env.ENANA_FAKE_CODEX_EXIT_CODE;
        process.env.ENANA_CODEX_CLI = fakeCodex.fakePath;
        process.env.ENANA_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.ENANA_FAKE_CODEX_STDOUT = [
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'token_count',
              rate_limits: {
                credits: {
                  has_credits: false,
                  unlimited: false,
                  balance: '0'
                }
              }
            }
          }),
          JSON.stringify({
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              last_agent_message: null
            }
          }),
          ''
        ].join('\n');
        process.env.ENANA_FAKE_CODEX_STDERR = [
          '2026-05-15T00:26:05Z  WARN codex_core_plugins::loader: failed to load plugin: plugin is not installed',
          ''
        ].join('\n');
        process.env.ENANA_FAKE_CODEX_EXIT_CODE = '1';

        try {
          let caughtError = null;
          try {
            await provider.requestCodexCliText({
              prompt: 'Return OK only.',
              cwd: workspaceDir,
              stream: true,
              onStream: () => {}
            });
          } catch (error) {
            caughtError = error;
          }

          assert.equal(Boolean(caughtError), true);
          assert.match(caughtError.message, /no available credits/);
          assert.doesNotMatch(caughtError.message, /codex_core_plugins/);
          assert.match(caughtError.stderr, /codex_core_plugins/);
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
          if (typeof previousStdout === 'string') {
            process.env.ENANA_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.ENANA_FAKE_CODEX_STDOUT;
          }
          if (typeof previousStderr === 'string') {
            process.env.ENANA_FAKE_CODEX_STDERR = previousStderr;
          } else {
            delete process.env.ENANA_FAKE_CODEX_STDERR;
          }
          if (typeof previousExitCode === 'string') {
            process.env.ENANA_FAKE_CODEX_EXIT_CODE = previousExitCode;
          } else {
            delete process.env.ENANA_FAKE_CODEX_EXIT_CODE;
          }
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      });
    });

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
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-transcript-'));
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
                namespace: 'mcp__hikari__',
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
        const previousCodexCli = process.env.ENANA_CODEX_CLI;
        const previousCapture = process.env.ENANA_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.ENANA_FAKE_CODEX_STDOUT;
        process.env.ENANA_CODEX_CLI = fakeCodex.fakePath;
        process.env.ENANA_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
        process.env.ENANA_FAKE_CODEX_STDOUT = [
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
            process.env.ENANA_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.ENANA_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.ENANA_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.ENANA_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.ENANA_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.ENANA_FAKE_CODEX_STDOUT;
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
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enana-codex-subagent-'));
        const fakeCodex = createFakeCodexBinary(workspaceDir);
        const previousCodexCli = process.env.ENANA_CODEX_CLI;
        const previousCapture = process.env.ENANA_FAKE_CODEX_CAPTURE;
        const previousStdout = process.env.ENANA_FAKE_CODEX_STDOUT;
        process.env.ENANA_CODEX_CLI = fakeCodex.fakePath;
        process.env.ENANA_FAKE_CODEX_CAPTURE = fakeCodex.capturePath;

        try {
          process.env.ENANA_FAKE_CODEX_STDOUT = JSON.stringify({
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

          process.env.ENANA_FAKE_CODEX_STDOUT = JSON.stringify({
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
            process.env.ENANA_CODEX_CLI = previousCodexCli;
          } else {
            delete process.env.ENANA_CODEX_CLI;
          }
          if (typeof previousCapture === 'string') {
            process.env.ENANA_FAKE_CODEX_CAPTURE = previousCapture;
          } else {
            delete process.env.ENANA_FAKE_CODEX_CAPTURE;
          }
          if (typeof previousStdout === 'string') {
            process.env.ENANA_FAKE_CODEX_STDOUT = previousStdout;
          } else {
            delete process.env.ENANA_FAKE_CODEX_STDOUT;
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
