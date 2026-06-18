module.exports = function registerMainServiceLifecycleSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const {
      SERVICE_POLICIES,
      createMainServiceLifecycle,
      orderServiceDefinitions
    } = require(path.join(__dirname, 'src', 'main', 'core', 'service-lifecycle.js'));

    function definition(key, dependsOn = [], hooks = {}) {
      return {
        key,
        dependsOn,
        create: hooks.create || (() => ({ key })),
        ...hooks
      };
    }

    test('main service lifecycle orders dependencies and rejects invalid catalogs', () => {
      assert.deepEqual(
        orderServiceDefinitions([
          definition('codex', ['mcp']),
          definition('storage'),
          definition('mcp', ['storage'])
        ]).map((entry) => entry.key),
        ['storage', 'mcp', 'codex']
      );

      assert.throws(
        () => orderServiceDefinitions([definition('storage'), definition('storage')]),
        /Duplicate main service key/
      );
      assert.throws(
        () => orderServiceDefinitions([definition('codex', ['mcp'])]),
        /depends on missing service "mcp"/
      );
      assert.throws(
        () => orderServiceDefinitions([
          definition('codex', ['mcp']),
          definition('mcp', ['codex'])
        ]),
        /dependency cycle: codex -> mcp -> codex/
      );
    });

    test('main service lifecycle constructs, registers IPC, and starts idempotently', async () => {
      const calls = [];
      const lifecycle = createMainServiceLifecycle({
        definitions: [
          definition('storage', [], {
            create: () => {
              calls.push('create:storage');
              return { name: 'storage' };
            },
            registerIpc: ({ service }) => calls.push(`ipc:${service.name}`),
            start: ({ service }) => calls.push(`start:${service.name}`)
          }),
          definition('codex', ['storage'], {
            create: ({ dependencies }) => {
              calls.push(`create:codex:${dependencies.storage.name}`);
              return { name: 'codex' };
            },
            start: ({ service }) => calls.push(`start:${service.name}`)
          })
        ]
      });

      lifecycle.registerIpcHandlers();
      lifecycle.registerIpcHandlers();
      const firstStart = await lifecycle.startServices();
      const secondStart = await lifecycle.startServices();

      assert.deepEqual(calls, [
        'create:storage',
        'create:codex:storage',
        'ipc:storage',
        'start:storage',
        'start:codex'
      ]);
      assert.equal(firstStart, secondStart);
      assert.equal(lifecycle.getService('codex').name, 'codex');
      assert.deepEqual(
        lifecycle.listServices().map((service) => service.key),
        ['storage', 'codex']
      );
    });

    test('main service lifecycle records best-effort failures and stops in reverse order', async () => {
      const calls = [];
      const lifecycle = createMainServiceLifecycle({
        definitions: [
          definition('storage', [], {
            start: () => calls.push('start:storage'),
            stop: () => calls.push('stop:storage')
          }),
          definition('mcp', ['storage'], {
            policy: SERVICE_POLICIES.BEST_EFFORT,
            start: () => {
              calls.push('start:mcp');
              throw new Error('port unavailable');
            },
            stop: () => calls.push('stop:mcp')
          }),
          definition('codex', ['mcp'], {
            start: () => calls.push('start:codex'),
            stop: () => calls.push('stop:codex')
          })
        ]
      });

      const results = await lifecycle.startServices();
      const failedMcp = results.find((result) => result.key === 'mcp');
      assert.equal(failedMcp.ok, false);
      assert.equal(failedMcp.policy, SERVICE_POLICIES.BEST_EFFORT);
      assert.equal(results.find((result) => result.key === 'codex').ok, true);

      await lifecycle.stopServices();
      await lifecycle.stopServices();
      assert.deepEqual(calls, [
        'start:storage',
        'start:mcp',
        'start:codex',
        'stop:codex',
        'stop:mcp',
        'stop:storage'
      ]);
    });

    test('main service lifecycle fails required startup without swallowing the error', async () => {
      const lifecycle = createMainServiceLifecycle({
        definitions: [
          definition('storage', [], {
            start: () => {
              throw new Error('storage unavailable');
            }
          }),
          definition('codex', ['storage'], {
            start: () => {
              throw new Error('must not run');
            }
          })
        ]
      });

      await assert.rejects(
        lifecycle.startServices(),
        /Failed to start required main service "storage"/
      );
      assert.equal(
        lifecycle.listServices().find((service) => service.key === 'codex').startup,
        'pending'
      );
    });

    test('main service catalog keeps storage, MCP, Codex, and IPC adapters dependency ordered', () => {
      const { createMainServiceCatalog } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'main-service-catalog.js'
      ));
      const catalog = createMainServiceCatalog({
        app: {},
        BrowserWindow: {},
        dialog: {},
        ipcMain: {},
        shell: {},
        fs: {},
        path,
        processObject: { env: {}, cwd: () => __dirname },
        projectRoot: __dirname,
        getMainWindow: () => null
      });
      const orderedKeys = orderServiceDefinitions(catalog).map((entry) => entry.key);
      assert.equal(orderedKeys.indexOf('storage') < orderedKeys.indexOf('mcp'), true);
      assert.equal(orderedKeys.indexOf('mcp') < orderedKeys.indexOf('codex'), true);
      assert.equal(orderedKeys.indexOf('codex') < orderedKeys.indexOf('agent-controllers'), true);
      assert.equal(orderedKeys.indexOf('agent-controllers') < orderedKeys.indexOf('agent-ipc'), true);
      assert.equal(
        catalog.find((entry) => entry.key === 'mcp').policy,
        SERVICE_POLICIES.BEST_EFFORT
      );
    });

    test('provider-neutral agent foundation does not construct MCP or Codex', () => {
      const foundationSource = fs.readFileSync(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'main',
        'create-main-agent-services.js'
      ), 'utf8');
      assert.doesNotMatch(foundationSource, /createAgentMcpHost/);
      assert.doesNotMatch(foundationSource, /createAgentMcpInitializer/);
      assert.doesNotMatch(foundationSource, /createCodexAgentRuntime/);
      assert.doesNotMatch(foundationSource, /HIKARI_CODEX_HOME/);
      assert.match(foundationSource, /runSubAgentTurn/);
    });

    test('main core registers data, agent, and system IPC through catalog order', async () => {
      const { createHikariMainCore } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'start-hikari-main-core.js'
      ));
      const channels = [];
      const core = createHikariMainCore({
        app: {
          getPath(name) {
            return name === 'documents' ? '/tmp/hikari-documents' : '/tmp/hikari-user-data';
          }
        },
        BrowserWindow: {
          getAllWindows: () => []
        },
        dialog: {},
        ipcMain: {
          handle: (channel) => channels.push(channel),
          on: (channel) => channels.push(channel),
          removeHandler() {}
        },
        shell: {
          openExternal: async () => {}
        },
        fs: fsPromises,
        path,
        processObject: {
          env: {},
          cwd: () => __dirname
        },
        projectRoot: __dirname,
        getMainWindow: () => null
      });

      assert.deepEqual(Object.keys(core).sort(), [
        'appIconPath',
        'getService',
        'listServices',
        'onAppReady',
        'registerIpcHandlers',
        'shutdown'
      ]);
      core.registerIpcHandlers();
      core.registerIpcHandlers();
      const firstStorage = channels.findIndex((channel) => String(channel).startsWith('data:'));
      const firstAgent = channels.findIndex((channel) => String(channel).startsWith('agent:'));
      const firstSystem = channels.findIndex((channel) => String(channel).startsWith('llm:'));
      assert.equal(firstStorage >= 0, true);
      assert.equal(firstStorage < firstAgent, true);
      assert.equal(firstAgent < firstSystem, true);
      assert.deepEqual(
        core.listServices()
          .filter((service) => service.ipc === 'registered')
          .map((service) => service.key),
        ['data-ipc', 'agent-ipc', 'system-ipc']
      );
      await core.shutdown();
    });

    test('MCP service delegates initialization and closes its owned host', async () => {
      const { createMainMcpService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-mcp-service.js'
      ));
      const calls = [];
      const host = {
        close: async () => calls.push('close')
      };
      const service = createMainMcpService({
        cleanText: (value) => String(value || ''),
        agentToolRuntime: { runAgentTool() {} },
        getCodexCliWorkingDirectory: () => '/tmp/cwd',
        getDefaultDataFilePath: () => '/tmp/data.json',
        getBundlePaths: () => ({}),
        processObject: { env: {} },
        createMcpHost: () => host,
        createMcpInitializer: ({ mcpHost }) => {
          assert.equal(mcpHost, host);
          return {
            initialize: async (input) => {
              calls.push(['initialize', input]);
              return { ok: true };
            },
            getLastResult: () => ({ ok: true })
          };
        }
      });

      assert.deepEqual(await service.initialize({ reason: 'test' }), { ok: true });
      await service.stop();
      assert.deepEqual(calls, [
        ['initialize', { reason: 'test' }],
        'close'
      ]);
    });

    test('Codex service owns runtime-home configuration and retries MCP before requests', async () => {
      const { createMainCodexService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-codex-service.js'
      ));
      const calls = [];
      const processObject = { env: {} };
      const service = createMainCodexService({
        cleanText: (value, maxLength = 2000) => String(value || '').trim().slice(0, maxLength),
        requestCodexCliText: async (input) => {
          calls.push(['request', input]);
          return 'ok';
        },
        getCodexCliWorkingDirectory: () => '/tmp/codex-cwd',
        getDefaultDataFilePath: () => '/tmp/hikari-data.json',
        getCodexCliHomePath: () => '/tmp/codex-home',
        getBundlePaths: () => ({ storageRootPath: '/tmp/storage' }),
        syncBundleFromSnapshot: async () => ({ bundlePaths: { storageRootPath: '/tmp/storage' } }),
        mcpService: {
          initialize: async (input) => {
            calls.push(['mcp', input]);
            return { ok: true };
          }
        },
        agentFoundation: {
          controllerUtils: { recordAgentLlmTrace: async () => {} },
          observability: { recordLifecycleEvent() {} },
          agentToolRuntime: { runAgentTool: async () => ({ ok: true }) }
        },
        processObject
      });

      assert.equal(processObject.env.HIKARI_CODEX_HOME, '/tmp/codex-home');
      assert.equal(await service.requestCodexAgentText({ cwd: '/tmp/project' }), 'ok');
      assert.deepEqual(calls, [
        ['mcp', { cwd: '/tmp/project', envOverrides: undefined }],
        ['request', { cwd: '/tmp/project' }]
      ]);
    });
  }
};
