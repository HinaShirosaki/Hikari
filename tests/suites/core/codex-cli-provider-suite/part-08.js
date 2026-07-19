module.exports = function registerCodexCliProviderSuitePart08(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const os = require('node:os');

    test('scheduled task service persists CRUD state and runs tasks through Codex', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-scheduled-tasks-'));
      const configPath = path.join(tmpDir, 'Config', 'scheduled-tasks.json');
      const { createScheduledTaskService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-scheduled-task-service.js'
      ));
      let clockMs = Date.parse('2026-07-18T15:00:00.000Z');
      const ids = ['task-1', 'run-1'];
      const codexCalls = [];
      const timers = [];
      let reloadedService = null;
      const service = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => configPath,
        now: () => clockMs,
        createId: () => ids.shift(),
        setTimer: (callback, delay) => {
          const timer = { callback, delay, unref() {} };
          timers.push(timer);
          return timer;
        },
        clearTimer: () => {},
        runCodexTask: async (task) => {
          codexCalls.push(task);
          return {
            ok: true,
            codex_agent: { answer: 'Scheduled Codex result' }
          };
        }
      });

      try {
        const started = await service.start();
        assert.equal(started.task_count, 0);
        const created = await service.createTask({
          title: 'Daily review',
          prompt: 'Review the project.',
          schedule: {
            kind: 'interval',
            interval_minutes: 5
          },
          project: {
            id: 'project-1',
            name: 'Test Project',
            storage_path: '/tmp/test-storage',
            cwd: '/tmp/test-workspace'
          },
          execution: {
            model: 'gpt-test',
            reasoning_effort: 'high',
            enable_web_search: false,
            timeout_ms: 15000
          }
        });
        assert.equal(created.id, 'task-1');
        assert.equal(created.next_run_at, '2026-07-18T15:05:00.000Z');
        assert.equal(timers.length, 1);

        clockMs += 30_000;
        const result = await service.runTask(created.id);
        assert.equal(result.text, 'Scheduled Codex result');
        assert.equal(result.run.status, 'succeeded');
        assert.equal(result.task.is_running, false);
        assert.equal(codexCalls.length, 1);
        assert.equal(codexCalls[0].project.name, 'Test Project');
        assert.equal(codexCalls[0].execution.enable_web_search, false);

        const updated = await service.updateTask(created.id, {
          title: 'Paused review',
          enabled: false
        });
        assert.equal(updated.title, 'Paused review');
        assert.equal(updated.enabled, false);
        assert.equal(updated.next_run_at, '');

        const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(persisted.version, 1);
        assert.equal(persisted.tasks.length, 1);
        assert.equal(persisted.tasks[0].last_run.text, 'Scheduled Codex result');

        await service.stop();
        reloadedService = createScheduledTaskService({
          fs: fsPromises,
          path,
          getScheduledTasksPath: () => configPath,
          now: () => clockMs,
          createId: () => {
            throw new Error('Reloading persisted tasks must not allocate a new id.');
          },
          setTimer: () => ({ unref() {} }),
          clearTimer: () => {},
          runCodexTask: async () => ({ ok: true, codex_agent: { answer: 'reloaded' } })
        });
        await reloadedService.start();
        const reloaded = await reloadedService.getTask(created.id);
        assert.equal(reloaded.title, 'Paused review');
        assert.equal(reloaded.last_run.status, 'succeeded');

        const deleted = await reloadedService.deleteTask(created.id);
        assert.equal(deleted.id, created.id);
        assert.deepEqual(await reloadedService.listTasks(), []);
      } finally {
        await service.stop();
        await reloadedService?.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('scheduled task cadence automatically runs a due one-time task once', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-scheduled-once-'));
      const configPath = path.join(tmpDir, 'scheduled-tasks.json');
      const { createScheduledTaskService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-scheduled-task-service.js'
      ));
      let clockMs = Date.parse('2026-07-18T16:00:00.000Z');
      const ids = ['task-once', 'run-once'];
      const timers = [];
      let codexRunCount = 0;
      const service = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => configPath,
        now: () => clockMs,
        createId: () => ids.shift(),
        setTimer: (callback, delay) => {
          const timer = { callback, delay, unref() {} };
          timers.push(timer);
          return timer;
        },
        clearTimer: () => {},
        runCodexTask: async () => {
          codexRunCount += 1;
          return { ok: true, codex_agent: { answer: 'Once complete' } };
        }
      });

      try {
        await service.start();
        const created = await service.createTask({
          prompt: 'Run once.',
          schedule: {
            kind: 'once',
            run_at: '2026-07-18T16:01:00.000Z'
          }
        });
        assert.equal(timers.at(-1).delay, 60_000);
        clockMs += 60_000;
        await timers.at(-1).callback();
        const completed = await service.getTask(created.id);
        assert.equal(codexRunCount, 1);
        assert.equal(completed.last_run.trigger, 'schedule');
        assert.equal(completed.last_run.status, 'succeeded');
        assert.equal(completed.enabled, false);
        assert.equal(completed.next_run_at, '');
      } finally {
        await service.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('scheduled task IPC and preload APIs expose the complete CRUD and run surface', async () => {
      const { SCHEDULED_TASK } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const { registerScheduledTaskIpc } = require(path.join(
        __dirname,
        'src',
        'main',
        'ipc',
        'register-scheduled-task-ipc.js'
      ));
      const { createScheduledTaskApi } = require(path.join(
        __dirname,
        'src',
        'main',
        'preload',
        'api',
        'scheduled-task-api.js'
      ));
      const handlers = new Map();
      const ipcMain = {
        handle(channel, handler) {
          handlers.set(channel, handler);
        }
      };
      const calls = [];
      const scheduledTaskService = {
        listTasks: async () => [{ id: 'task-1' }],
        getTask: async (id) => ({ id }),
        createTask: async (payload) => ({ id: 'task-1', ...payload }),
        updateTask: async (id, payload) => ({ ...payload, id }),
        deleteTask: async (id) => ({ id }),
        runTask: async (id) => ({ task: { id }, run: { status: 'succeeded' }, text: 'done' })
      };
      registerScheduledTaskIpc({ ipcMain, scheduledTaskService });
      assert.deepEqual(
        Array.from(handlers.keys()).sort(),
        Object.values(SCHEDULED_TASK).sort()
      );
      const ipcRenderer = {
        invoke(channel, payload) {
          calls.push({ channel, payload });
          return Promise.resolve({ ok: true });
        }
      };
      const api = createScheduledTaskApi(ipcRenderer);
      await api.listScheduledTasks();
      await api.getScheduledTask('task-1');
      await api.createScheduledTask({ prompt: 'test' });
      await api.updateScheduledTask('task-1', { enabled: false });
      await api.deleteScheduledTask('task-1');
      await api.runScheduledTask('task-1');
      assert.deepEqual(calls.map((entry) => entry.channel), [
        SCHEDULED_TASK.LIST,
        SCHEDULED_TASK.GET,
        SCHEDULED_TASK.CREATE,
        SCHEDULED_TASK.UPDATE,
        SCHEDULED_TASK.DELETE,
        SCHEDULED_TASK.RUN
      ]);
      assert.deepEqual(calls[3].payload, { enabled: false, id: 'task-1' });
    });

    test('main Codex service maps scheduled task settings to the project-scoped CLI runtime', async () => {
      const { createMainCodexService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-codex-service.js'
      ));
      const requests = [];
      let syncCallCount = 0;
      const processObject = { env: {} };
      const codex = createMainCodexService({
        cleanText: (value, maxLength = 2000) => String(value || '').trim().slice(0, maxLength),
        requestCodexCliText: async (input) => {
          requests.push(input);
          return {
            text: JSON.stringify({
              status: 'completed',
              answer: 'Project review complete.',
              reasoning_summary: 'Reviewed the project.'
            }),
            metadata: { session_id: 'session-1', command: 'exec' }
          };
        },
        getCodexCliWorkingDirectory: () => '/tmp/hikari-default',
        getDefaultDataFilePath: () => '/tmp/storage/hikari-data.json',
        getCodexCliHomePath: () => '/tmp/hikari-codex-home',
        getBundlePaths: () => ({ storageRootPath: '/tmp/storage' }),
        syncBundleFromSnapshot: async () => {
          syncCallCount += 1;
          return { bundlePaths: { storageRootPath: '/tmp/storage' } };
        },
        mcpService: { mcpHost: {} },
        agentFoundation: {
          controllerUtils: { recordAgentLlmTrace: async () => {} },
          observability: { recordLifecycleEvent: () => {} },
          agentToolRuntime: { runAgentTool: async () => ({ ok: true }) }
        },
        processObject,
        createWorkspaceInitializer: () => ({
          initialize: async () => ({ ok: true }),
          getLastResult: () => null
        })
      });

      const result = await codex.runScheduledTask({
        id: 'task-1',
        prompt: 'Review the project.',
        project: {
          id: 'project-1',
          name: 'Project One',
          storage_path: '/tmp/storage',
          data_file_path: '/tmp/storage/hikari-data.json'
        },
        execution: {
          model: 'gpt-test',
          reasoning_effort: 'high',
          enable_web_search: false,
          timeout_ms: 15000
        }
      });
      assert.equal(result.ok, true);
      assert.equal(result.codex_agent.answer, 'Project review complete.');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].cwd, '/tmp/storage/Project/Project_One');
      assert.equal(requests[0].model, 'gpt-test');
      assert.equal(requests[0].reasoningEffort, 'high');
      assert.equal(requests[0].enableWebSearch, false);
      assert.equal(requests[0].timeoutMs, 15000);
      assert.match(requests[0].envOverrides.HIKARI_CODEX_REQUEST_CONTEXT, /Project One/);
      assert.equal(syncCallCount, 0);
      assert.equal(processObject.env.HIKARI_CODEX_HOME, '/tmp/hikari-codex-home');
    });
  }
};
