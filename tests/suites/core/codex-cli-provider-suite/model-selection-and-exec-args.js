module.exports = function registerCodexCliProviderSuiteModelSelectionAndExecArgs(context = {}) {
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
        assert.equal(args.includes('project_doc_fallback_filenames=["MEMORY.md"]'), true);
        assert.equal(args.includes('project_doc_max_bytes=65536'), true);
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
    test('codex cli provider forwards output schemas to new and resumed exec requests', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const outputSchemaFile = '/tmp/hikari-output-schema.json';
        const newArgs = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt',
          outputSchemaFile
        });
        const resumedArgs = provider.buildCodexCliExecResumeArgs({
          outputFile: '/tmp/codex-last-message.txt',
          outputSchemaFile,
          sessionId: 'codex-session-1'
        });

        assert.equal(newArgs[newArgs.indexOf('--output-schema') + 1], outputSchemaFile);
        assert.equal(resumedArgs[resumedArgs.indexOf('--output-schema') + 1], outputSchemaFile);
      });
    });
    test('codex cli provider keeps Codex MCP tool names prefixed before exec', () => {
      withCodexHome({}, () => {
        const provider = loadProvider();
        const args = provider.buildCodexCliExecArgs({
          outputFile: '/tmp/codex-last-message.txt'
        });

        const execIndex = args.indexOf('exec');
        assert.equal(args.includes('non_prefixed_mcp_tool_names'), false);
        assert.equal(execIndex >= 0, true);
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
        assert.equal(args.includes('non_prefixed_mcp_tool_names'), false);
        assert.equal(args.includes('--color'), false);
        assert.equal(args.includes('codex-session-1'), true);
        assert.equal(args[args.length - 2], 'codex-session-1');
        assert.equal(args[args.length - 1], '-');
      });
    });
    test('codex cli provider mirrors essential codex home files into an app-owned runtime directory', async () => {
      const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-source-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-workspace-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
      fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"token":"abc"}', 'utf8');
      fs.writeFileSync(path.join(sourceHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
      fs.writeFileSync(path.join(sourceHome, 'models_cache.json'), JSON.stringify(defaultModelsCache), 'utf8');
      const browserPluginDir = path.join(sourceHome, 'plugins', 'cache', 'openai-bundled', 'browser', '1.0.0');
      const documentsPluginDir = path.join(sourceHome, 'plugins', 'cache', 'openai-primary-runtime', 'documents', '1.0.0');
      fs.mkdirSync(browserPluginDir, { recursive: true });
      fs.mkdirSync(documentsPluginDir, { recursive: true });
      fs.writeFileSync(path.join(browserPluginDir, '.mcp.json'), '{"name":"browser"}', 'utf8');
      fs.writeFileSync(path.join(documentsPluginDir, 'SKILL.md'), '# Documents\n', 'utf8');
      process.env.CODEX_HOME = sourceHome;
      delete process.env.HIKARI_CODEX_HOME;

      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        assert.equal(runtimeHome, path.join(workspaceDir, 'Config', 'codex-cli-home'));
        assert.equal(fs.existsSync(path.join(runtimeHome, 'auth.json')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'config.toml')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'models_cache.json')), true);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'skills')), true);
        assert.equal(
          fs.existsSync(path.join(runtimeHome, 'plugins', 'cache', 'openai-bundled', 'browser', '1.0.0', '.mcp.json')),
          true
        );
        assert.equal(
          fs.existsSync(path.join(runtimeHome, 'plugins', 'cache', 'openai-primary-runtime', 'documents', '1.0.0', 'SKILL.md')),
          true
        );
        assert.equal(fs.existsSync(path.join(runtimeHome, 'AGENTS.md')), true);
        const runtimeConfig = fs.readFileSync(path.join(runtimeHome, 'config.toml'), 'utf8');
        assert.match(runtimeConfig, /\[mcp_servers\.hikari\]/);
        assert.match(runtimeConfig, /required = true/);
        assert.match(runtimeConfig, /enabled_tools = \["inventory_lookup", "chemical_lookup", "notebook_lookup", "protocol_lookup", "protocol_generation"/);
        assert.match(runtimeConfig, /"container"/);
        assert.match(runtimeConfig, /"assay_table"/);
        assert.match(runtimeConfig, /"plotly_graph"/);
        assert.match(runtimeConfig, /default_tools_approval_mode = "approve"/);
        assert.match(runtimeConfig, /tool_timeout_sec = 300/);
        assert.match(runtimeConfig, /\[mcp_servers\.hikari\.tools\.protocol_generation\]/);
        assert.match(runtimeConfig, /approval_mode = "approve"/);
        assert.match(runtimeConfig, /HIKARI_AGENT_MCP/);
        assert.match(runtimeConfig, /HIKARI_CODEX_MCP/);
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
        fs.rmSync(sourceHome, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
    test('codex cli runtime cache removes reasoning levels unsupported by the bundled CLI', async () => {
      const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-source-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-workspace-'));
      const previousCodexHome = process.env.CODEX_HOME;
      const previousHikariCodexHome = process.env.HIKARI_CODEX_HOME;
      const modelsCache = {
        models: [{
          slug: 'gpt-5.5',
          default_reasoning_level: 'max',
          default_reasoning_summary: 'none',
          supported_reasoning_levels: [
            { effort: 'high' },
            { effort: 'xhigh' },
            { effort: 'max' },
            { effort: 'ultra' }
          ]
        }]
      };
      fs.writeFileSync(path.join(sourceHome, 'models_cache.json'), JSON.stringify(modelsCache), 'utf8');
      process.env.CODEX_HOME = sourceHome;
      delete process.env.HIKARI_CODEX_HOME;

      try {
        const provider = loadProvider();
        const runtimeHome = await provider.ensureCodexCliRuntimeHome(workspaceDir);
        const copied = JSON.parse(fs.readFileSync(path.join(runtimeHome, 'models_cache.json'), 'utf8'));
        assert.deepEqual(
          copied.models[0].supported_reasoning_levels.map((level) => level.effort),
          ['high', 'xhigh']
        );
        assert.equal(copied.models[0].default_reasoning_level, 'xhigh');
        assert.equal(copied.models[0].supports_reasoning_summaries, true);
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
        fs.rmSync(sourceHome, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
    test('codex MCP config points packaged app paths at app.asar.unpacked', () => {
      const {
        resolveUnpackedAsarPath,
        resolveHikariCodexMcpCommandPath,
        buildHikariCodexMcpConfigBlock
      } = require(path.join(
        __dirname,
        'src',
        'main',
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
        'agent',
        'mcp-contract',
        'stdio-server.js'
      ].join(path.sep);
      const unpackedServerPath = resolveUnpackedAsarPath(packedServerPath);

      assert.equal(unpackedServerPath.includes(`${path.sep}app.asar.unpacked${path.sep}`), true);
      assert.equal(unpackedServerPath.includes(`${path.sep}app.asar${path.sep}`), false);
      assert.equal(resolveUnpackedAsarPath('/tmp/Hikari/src/main.js'), '/tmp/Hikari/src/main.js');
      const configBlock = buildHikariCodexMcpConfigBlock({ workspace: '/tmp/Hikari' });
      assert.match(configBlock, /\[mcp_servers\.hikari\]/);
      assert.match(configBlock, new RegExp(`command = ${JSON.stringify(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(configBlock, /enabled_tools = \["inventory_lookup", "chemical_lookup", "notebook_lookup", "protocol_lookup", "protocol_generation"/);
      assert.match(configBlock, /"container"/);
      assert.match(configBlock, /"assay_table"/);
      assert.match(configBlock, /"plotly_graph"/);
      assert.match(configBlock, /default_tools_approval_mode = "approve"/);
      assert.match(configBlock, /tool_timeout_sec = 300/);
      assert.match(configBlock, /\[mcp_servers\.hikari\.tools\.protocol_generation\]/);
      assert.doesNotMatch(configBlock, /ELECTRON_RUN_AS_NODE/);
      const fakeNodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-node-bin-'));
      const packagedCommand = path.join(fakeNodeDir, 'node');
      fs.writeFileSync(packagedCommand, '#!/bin/sh\n', 'utf8');
      fs.chmodSync(packagedCommand, 0o755);
      const packagedConfigBlock = buildHikariCodexMcpConfigBlock({
        workspace: '/tmp/Hikari',
        processExecPath: '/Applications/Hikari.app/Contents/MacOS/Hikari',
        envPath: '',
        commonNodePaths: [packagedCommand]
      });
      assert.equal(resolveHikariCodexMcpCommandPath({
        processExecPath: '/Applications/Hikari.app/Contents/MacOS/Hikari',
        envPath: '',
        commonNodePaths: [packagedCommand]
      }), packagedCommand);
      assert.match(packagedConfigBlock, new RegExp(`command = ${JSON.stringify(packagedCommand).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.doesNotMatch(packagedConfigBlock, /ELECTRON_RUN_AS_NODE/);
      assert.doesNotMatch(packagedConfigBlock, /command = "node"/);
      fs.rmSync(fakeNodeDir, { recursive: true, force: true });
    });
    test('Codex Desktop MCP setup prompt safely routes through Hikari managed config', () => {
      const {
        buildHikariCodexDesktopMcpSetupPrompt
      } = require(path.join(
        __dirname,
        'src',
        'main',
        'agent',
        'codex-agent',
        'desktop-mcp-prompt.js'
      ));
      const prompt = buildHikariCodexDesktopMcpSetupPrompt({
        managedConfigPath: '/Users/example/Library/Application Support/Hikari/Config/codex-cli-home/config.toml'
      });

      assert.match(prompt, /Perform the setup; do not only explain the steps/);
      assert.match(prompt, /# HIKARI_MCP_CONFIG_START/);
      assert.match(prompt, /# HIKARI_MCP_CONFIG_END/);
      assert.match(prompt, /\$CODEX_HOME\/config\.toml/);
      assert.match(prompt, /Preserve every unrelated setting/);
      assert.match(prompt, /Do not print it in chat, logs, command output, or the final response/);
      assert.match(prompt, /Settings > MCP servers and select Restart/);
      assert.match(prompt, /Hikari must remain open/);
      assert.equal(buildHikariCodexDesktopMcpSetupPrompt(), '');
    });
    test('codex cli launch resolves an env-node shim when the GUI PATH omits Node', () => {
      if (process.platform === 'win32') {
        return;
      }
      const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-env-node-'));
      try {
        const codexBinary = path.join(fixtureDir, 'codex');
        const siblingNode = path.join(fixtureDir, 'node');
        fs.writeFileSync(codexBinary, '#!/usr/bin/env node\n', 'utf8');
        fs.writeFileSync(siblingNode, '#!/bin/sh\n', 'utf8');
        fs.chmodSync(codexBinary, 0o755);
        fs.chmodSync(siblingNode, 0o755);
        const { resolveCodexInvocation } = require(path.join(
          __dirname,
          'src',
          'main',
          'lib',
          'codex-cli-provider',
          'paths.js'
        ));
        const invocation = resolveCodexInvocation({ PATH: '/usr/bin:/bin' }, {
          codexBinary,
          processExecPath: '/Applications/Hikari.app/Contents/MacOS/Hikari',
          commonNodePaths: []
        });
        assert.deepEqual(invocation, {
          command: siblingNode,
          argsPrefix: [codexBinary]
        });
      } finally {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    });
    test('codex cli launch finds the standalone installer when the GUI PATH omits it', () => {
      if (process.platform === 'win32') {
        return;
      }
      const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-standalone-home-'));
      const previousHome = process.env.HOME;
      const previousCodexCli = process.env.HIKARI_CODEX_CLI;
      const previousCodexBin = process.env.HIKARI_CODEX_BIN;
      try {
        const standaloneBin = path.join(fixtureHome, '.local', 'bin', 'codex');
        fs.mkdirSync(path.dirname(standaloneBin), { recursive: true });
        fs.writeFileSync(standaloneBin, '#!/bin/sh\n', 'utf8');
        fs.chmodSync(standaloneBin, 0o755);
        process.env.HOME = fixtureHome;
        delete process.env.HIKARI_CODEX_CLI;
        delete process.env.HIKARI_CODEX_BIN;
        const { resolveCodexBinary } = require(path.join(
          __dirname,
          'src',
          'main',
          'lib',
          'codex-cli-provider',
          'paths.js'
        ));
        assert.equal(resolveCodexBinary(), standaloneBin);
      } finally {
        if (typeof previousHome === 'string') {
          process.env.HOME = previousHome;
        } else {
          delete process.env.HOME;
        }
        if (typeof previousCodexCli === 'string') {
          process.env.HIKARI_CODEX_CLI = previousCodexCli;
        } else {
          delete process.env.HIKARI_CODEX_CLI;
        }
        if (typeof previousCodexBin === 'string') {
          process.env.HIKARI_CODEX_BIN = previousCodexBin;
        } else {
          delete process.env.HIKARI_CODEX_BIN;
        }
        fs.rmSync(fixtureHome, { recursive: true, force: true });
      }
    });
    test('codex cli launch turns a missing executable into an actionable setup error', () => {
      const { createCodexCliNotFoundError } = require(path.join(
        __dirname,
        'src',
        'main',
        'lib',
        'codex-cli-provider',
        'paths.js'
      ));
      const cause = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      const error = createCodexCliNotFoundError(cause);
      assert.equal(error.code, 'ENOENT');
      assert.match(error.message, /Codex CLI was not found/);
      assert.match(error.message, /Settings > Codex Model & Access/);
      assert.equal(error.cause, cause);
    });
    test('codex cli provider writes Hikari AGENTS.md guidance into the runtime workspace', async () => {
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-agents-'));
      try {
        const provider = loadProvider();
        const agentsPath = await provider.ensureCodexCliAgentsFile(workspaceDir);
        const firstContent = fs.readFileSync(agentsPath, 'utf8');
        assert.equal(agentsPath, path.join(workspaceDir, 'AGENTS.md'));
        assert.match(firstContent, /HIKARI_CODEX_AGENT_INSTRUCTIONS_START/);
        assert.match(firstContent, /literature_search/);
        assert.match(firstContent, /paper_download/);
        assert.match(firstContent, /Interactive paper-search download policy/);
        assert.match(firstContent, /research sub-agent may freely use `paper_download`/);
        assert.match(firstContent, /main agent must not download the same papers again/);
        assert.match(firstContent, /pass its title as `paper_title`/);
        assert.match(firstContent, /original `literature_search\.query` as `collection_name`/);
        assert.doesNotMatch(firstContent, /use its title as `linked_name`/);
        assert.match(firstContent, /deny_paper_download: true/);
        assert.match(firstContent, /load bounded paper context blocks/);
        assert.match(firstContent, /retrieve the active assay data by parsing its `Assay plate data \(TSV\.\.\.\)` block directly from the chat prompt/);
        assert.match(firstContent, /Do not use local lookup tools for active Assay plate\/result rows/);
        assert.doesNotMatch(firstContent, /mcp__[a-z0-9-]+__/i);

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
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-codex-root-cwd-'));
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
  }
};
