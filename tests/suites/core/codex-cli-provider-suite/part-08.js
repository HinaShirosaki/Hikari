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

    test('scheduled task loading survives a malformed row and reconciles a stale run', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-scheduled-recovery-'));
      const configPath = path.join(tmpDir, 'scheduled-tasks.json');
      const { createScheduledTaskService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-scheduled-task-service.js'
      ));
      fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        tasks: [
          { id: 'broken', title: 'no prompt at all' },
          { id: 'good', prompt: 'still works', schedule: { kind: 'manual' } },
          {
            id: 'crashed',
            prompt: 'was running when the app died',
            schedule: { kind: 'manual' },
            last_run: { id: 'r1', status: 'running', started_at: '2026-07-19T00:00:00.000Z' }
          }
        ]
      }));

      const service = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => configPath,
        runCodexTask: async () => ({ ok: true, text: 'unused' }),
        consoleObject: { error() {} }
      });

      try {
        const tasks = await service.listTasks();
        assert.deepEqual(tasks.map((task) => task.id).sort(), ['crashed', 'good']);
        const crashed = await service.getTask('crashed');
        assert.equal(crashed.last_run.status, 'interrupted');
        assert.ok(crashed.last_run.completed_at);
      } finally {
        await service.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('scheduled task run wraps a non-Error rejection and cleans up a failed write', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-scheduled-failures-'));
      const { createScheduledTaskService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-scheduled-task-service.js'
      ));

      const rejectPath = path.join(tmpDir, 'reject', 'scheduled-tasks.json');
      const rejectService = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => rejectPath,
        runCodexTask: async () => Promise.reject('codex exploded'),
        consoleObject: { error() {} }
      });

      const writePath = path.join(tmpDir, 'write', 'scheduled-tasks.json');
      const failingFs = {
        ...fsPromises,
        writeFile: async (target, ...rest) => {
          await fsPromises.writeFile(target, ...rest);
          throw new Error('disk full');
        }
      };
      const writeService = createScheduledTaskService({
        fs: failingFs,
        path,
        getScheduledTasksPath: () => writePath,
        runCodexTask: async () => ({ ok: true, text: 'unused' }),
        consoleObject: { error() {} }
      });

      try {
        const task = await rejectService.createTask({ prompt: 'boom', schedule: { kind: 'manual' } });
        await assert.rejects(
          () => rejectService.runTask(task.id),
          (error) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'codex exploded');
            assert.equal(error.scheduledTaskRun.status, 'failed');
            return true;
          }
        );
        const afterFailure = await rejectService.getTask(task.id);
        assert.equal(afterFailure.last_run.error, 'codex exploded');

        await assert.rejects(() => writeService.createTask({ prompt: 'nope' }), /disk full/);
        const leftovers = fs.readdirSync(path.dirname(writePath)).filter((name) => name.endsWith('.tmp'));
        assert.deepEqual(leftovers, []);
      } finally {
        await rejectService.stop();
        await writeService.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('scheduled task arming staggers overdue tasks and re-arms past the timer ceiling', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-scheduled-arming-'));
      const { createScheduledTaskService } = require(path.join(
        __dirname,
        'src',
        'main',
        'core',
        'services',
        'create-scheduled-task-service.js'
      ));

      const staggerPath = path.join(tmpDir, 'scheduled-tasks.json');
      fs.writeFileSync(staggerPath, JSON.stringify({
        version: 1,
        tasks: ['a', 'b', 'c'].map((id) => ({
          id,
          prompt: `overdue ${id}`,
          schedule: { kind: 'once', run_at: '2026-07-19T11:00:00.000Z' }
        }))
      }));
      let staggerClockMs = Date.parse('2026-07-19T12:00:00.000Z');
      const staggerDelays = [];
      const staggerService = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => staggerPath,
        now: () => staggerClockMs,
        setTimer: (callback, delay) => {
          staggerDelays.push(delay);
          return { callback, delay, unref() {} };
        },
        clearTimer: () => {},
        runCodexTask: async () => ({ ok: true, text: 'unused' }),
        consoleObject: { error() {} }
      });

      const ceilingPath = path.join(tmpDir, 'ceiling', 'scheduled-tasks.json');
      let ceilingClockMs = Date.parse('2026-07-19T00:00:00.000Z');
      const ceilingTimers = [];
      let ceilingRunCount = 0;
      const ceilingService = createScheduledTaskService({
        fs: fsPromises,
        path,
        getScheduledTasksPath: () => ceilingPath,
        now: () => ceilingClockMs,
        setTimer: (callback, delay) => {
          const timer = { callback, delay, unref() {} };
          ceilingTimers.push(timer);
          return timer;
        },
        clearTimer: () => {},
        runCodexTask: async () => {
          ceilingRunCount += 1;
          return { ok: true, codex_agent: { answer: 'done' } };
        },
        consoleObject: { error() {} }
      });

      try {
        await staggerService.start();
        assert.deepEqual(
          staggerDelays.slice().sort((left, right) => left - right),
          [0, 5_000, 10_000]
        );

        await ceilingService.start();
        // 60 days out, well past the ~24.8 day setTimeout ceiling.
        const created = await ceilingService.createTask({
          prompt: 'far future',
          schedule: {
            kind: 'once',
            run_at: new Date(ceilingClockMs + (60 * 86_400_000)).toISOString()
          }
        });
        assert.equal(ceilingTimers.at(-1).delay, 2_147_000_000);

        ceilingClockMs += 2_147_000_000;
        await ceilingTimers.at(-1).callback();
        assert.equal(ceilingRunCount, 0);
        assert.ok(ceilingTimers.at(-1).delay > 0);

        ceilingClockMs = Date.parse(created.next_run_at);
        await ceilingTimers.at(-1).callback();
        assert.equal(ceilingRunCount, 1);
      } finally {
        await staggerService.stop();
        await ceilingService.stop();
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
