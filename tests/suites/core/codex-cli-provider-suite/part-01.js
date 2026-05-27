module.exports = function registerCodexCliProviderSuitePart01(context = {}) {
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
      const browserPluginDir = path.join(sourceHome, 'plugins', 'cache', 'openai-bundled', 'browser', '1.0.0');
      const documentsPluginDir = path.join(sourceHome, 'plugins', 'cache', 'openai-primary-runtime', 'documents', '1.0.0');
      fs.mkdirSync(browserPluginDir, { recursive: true });
      fs.mkdirSync(documentsPluginDir, { recursive: true });
      fs.writeFileSync(path.join(browserPluginDir, '.mcp.json'), '{"name":"browser"}', 'utf8');
      fs.writeFileSync(path.join(documentsPluginDir, 'SKILL.md'), '# Documents\n', 'utf8');
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
        assert.equal(
          fs.existsSync(path.join(runtimeHome, 'plugins', 'cache', 'openai-bundled', 'browser', '1.0.0', '.mcp.json')),
          true
        );
        assert.equal(
          fs.existsSync(path.join(runtimeHome, 'plugins', 'cache', 'openai-primary-runtime', 'documents', '1.0.0', 'SKILL.md')),
          true
        );
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
  }
};