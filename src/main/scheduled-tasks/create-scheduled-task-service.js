'use strict';

const crypto = require('node:crypto');
const { ensureObject } = require('../lib/normalize.js');
const { writeFileAtomic } = require('../lib/shared-json-file');
const {
  FILE_VERSION,
  MAX_TIMER_DELAY_MS,
  SCHEDULE_KEYS,
  STAGGER_STEP_MS,
  cloneJson,
  fallbackCleanText,
  hasOwn,
  parseTimestamp
} = require('./constants.js');
const { createTaskNormalizers } = require('./normalizing.js');

function createScheduledTaskService({
  fs,
  path,
  cleanText = fallbackCleanText,
  getScheduledTasksPath,
  runCodexTask,
  now = () => Date.now(),
  createId = () => crypto.randomUUID(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  normalizeRunResult = null,
  consoleObject = console
} = {}) {
  if (!fs || !path || typeof getScheduledTasksPath !== 'function') {
    throw new Error('Scheduled task persistence is not configured.');
  }
  if (typeof runCodexTask !== 'function') {
    throw new Error('Scheduled task Codex execution is not configured.');
  }

  const tasks = new Map();
  const timers = new Map();
  const runningTaskIds = new Set();
  let loaded = false;
  let loadedPath = '';
  let loadPromise = null;
  let started = false;
  let writeQueue = Promise.resolve();

  const {
    currentTimeMs,
    currentIso,
    normalizeTask,
    computeNextRunAt,
    publicTask
  } = createTaskNormalizers({ now, cleanText, createId, runningTaskIds });

  async function loadTasks(configPath) {
    if (loaded && loadedPath === configPath) {
      return;
    }
    let parsed = { tasks: [] };
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    const rows = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(rows)) {
      throw new Error('Scheduled task file must contain a tasks array.');
    }
    tasks.clear();
    rows.forEach((row) => {
      let task;
      try {
        task = normalizeTask(row, row);
      } catch (error) {
        // ponytail: drop the bad row instead of failing the load, one hand-edited
        // entry must not take every other scheduled task down with it.
        consoleObject.error('Skipping invalid scheduled task row:', error);
        return;
      }
      task.updated_at = cleanText(row?.updated_at, 80) || task.updated_at;
      if (task.last_run?.status === 'running') {
        // A run marked "running" on disk means the app died mid-run, nothing is
        // running now. Mark it interrupted so the UI and once-task gating recover.
        task.last_run.status = 'interrupted';
        task.last_run.completed_at = task.last_run.completed_at || currentIso();
        task.last_run.error = task.last_run.error || 'Interrupted before completion.';
      }
      task.next_run_at = computeNextRunAt(task, currentTimeMs(), { preserveFuture: true });
      tasks.set(task.id, task);
    });
    loaded = true;
    loadedPath = configPath;
  }

  async function ensureLoaded(configPath = path.resolve(getScheduledTasksPath())) {
    if (loaded && loadedPath === configPath) {
      return;
    }
    if (!loadPromise) {
      loadPromise = loadTasks(configPath).finally(() => {
        loadPromise = null;
      });
    }
    await loadPromise;
  }

  async function persistTasks(configPath) {
    const snapshot = {
      version: FILE_VERSION,
      updated_at: currentIso(),
      tasks: Array.from(tasks.values()).map((task) => cloneJson(task))
    };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await writeFileAtomic(fs, configPath, JSON.stringify(snapshot, null, 2));
  }

  // Queue the mutation and rollback as well as the write. Capturing a later
  // snapshot before a failed mutation rolls back can resurrect that mutation.
  function transaction(work, configPath = path.resolve(getScheduledTasksPath())) {
    const current = writeQueue.then(async () => {
      await ensureLoaded(configPath);
      const previous = new Map([...tasks].map(([id, task]) => [id, cloneJson(task)]));
      try {
        return await work(configPath);
      } catch (error) {
        tasks.clear();
        previous.forEach((task, id) => tasks.set(id, task));
        throw error;
      }
    });
    writeQueue = current.catch(() => {});
    return current;
  }

  function clearTaskTimer(taskId) {
    const timer = timers.get(taskId);
    if (timer) {
      clearTimer(timer);
      timers.delete(taskId);
    }
  }

  function armTask(task, staggerMs = 0) {
    clearTaskTimer(task.id);
    if (!started || !task.enabled || !task.next_run_at || runningTaskIds.has(task.id)) {
      return;
    }
    const baseDelayMs = Math.max(0, parseTimestamp(task.next_run_at) - currentTimeMs());
    // Only overdue tasks (delay already 0) get the catch-up stagger, a future task
    // keeps its exact time.
    const delayMs = baseDelayMs === 0 ? staggerMs : baseDelayMs;
    const timer = setTimer(() => {
      timers.delete(task.id);
      const current = tasks.get(task.id);
      if (!current) {
        return undefined;
      }
      if (parseTimestamp(current.next_run_at) > currentTimeMs()) {
        // Delay was clamped to the timer ceiling, arm again for the remainder.
        armTask(current);
        return undefined;
      }
      return runTask(current.id, { trigger: 'schedule' }).catch((error) => {
        consoleObject.error(`Scheduled task "${current.id}" failed:`, error);
      });
    }, Math.min(delayMs, MAX_TIMER_DELAY_MS));
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    timers.set(task.id, timer);
  }

  function armAllTasks() {
    let overdueIndex = 0;
    tasks.forEach((task) => {
      const isOverdue = task.enabled
        && task.next_run_at
        && parseTimestamp(task.next_run_at) <= currentTimeMs();
      armTask(task, isOverdue ? (overdueIndex++) * STAGGER_STEP_MS : 0);
    });
  }

  async function listTasks(configPath) {
    await ensureLoaded(configPath);
    return Array.from(tasks.values())
      .map(publicTask)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async function getTask(taskId, configPath) {
    await ensureLoaded(configPath);
    const id = cleanText(taskId, 160);
    const task = tasks.get(id);
    return task ? publicTask(task) : null;
  }

  async function createTask(input = {}, configPath) {
    await ensureLoaded(configPath);
    const task = normalizeTask(input);
    if (!task.id || tasks.has(task.id)) {
      throw new Error('Could not allocate a unique scheduled task id.');
    }
    task.next_run_at = computeNextRunAt(task);
    tasks.set(task.id, task);
    try {
      await persistTasks(configPath);
    } catch (error) {
      tasks.delete(task.id);
      throw error;
    }
    armTask(task);
    return publicTask(task);
  }

  async function updateTask(taskId, updates = {}, configPath) {
    await ensureLoaded(configPath);
    const id = cleanText(taskId, 160);
    const existing = tasks.get(id);
    if (!existing) {
      return null;
    }
    const updated = normalizeTask({ ...ensureObject(updates), id }, existing);
    const scheduleChanged = hasOwn(ensureObject(updates), 'schedule')
      || SCHEDULE_KEYS.some((key) => hasOwn(ensureObject(updates), key));
    updated.next_run_at = computeNextRunAt(updated, currentTimeMs(), {
      preserveFuture: !scheduleChanged && updated.enabled === existing.enabled
    });
    tasks.set(id, updated);
    try {
      await persistTasks(configPath);
    } catch (error) {
      tasks.set(id, existing);
      throw error;
    }
    armTask(updated);
    return publicTask(updated);
  }

  async function deleteTask(taskId, configPath) {
    await ensureLoaded(configPath);
    const id = cleanText(taskId, 160);
    const existing = tasks.get(id);
    if (!existing) {
      return null;
    }
    clearTaskTimer(id);
    tasks.delete(id);
    try {
      await persistTasks(configPath);
    } catch (error) {
      tasks.set(id, existing);
      armTask(existing);
      throw error;
    }
    return publicTask(existing);
  }

  function extractCodexText(result) {
    if (typeof result === 'string') {
      return cleanText(result, 120000);
    }
    const source = ensureObject(result);
    if (source.ok === false) {
      throw new Error(cleanText(source.error, 2400) || 'Codex scheduled task failed.');
    }
    return cleanText(
      source.codex_agent?.answer
        || source.assistant_message
        || source.text
        || source.message
        || source.summary,
      120000
    );
  }

  function commitRun(id, run, configPath) {
    return transaction(async () => {
      const currentTask = tasks.get(id);
      if (!currentTask || currentTask.last_run?.id !== run.id) return null;
      currentTask.last_run = cloneJson(run);
      currentTask.updated_at = run.completed_at;
      if (currentTask.schedule.kind === 'once') currentTask.enabled = false;
      currentTask.next_run_at = computeNextRunAt(currentTask);
      await persistTasks(configPath);
      return { ...publicTask(currentTask), is_running: false };
    }, configPath);
  }

  async function runTask(taskId, { trigger = 'manual' } = {}) {
    const configPath = path.resolve(getScheduledTasksPath());
    const id = cleanText(taskId, 160);
    let run = null;

    try {
      const task = await transaction(async () => {
        const currentTask = tasks.get(id);
        if (!currentTask) return null;
        if (trigger === 'schedule' && !currentTask.enabled) return publicTask(currentTask);
        if (runningTaskIds.has(id)) {
          throw Object.assign(new Error('Scheduled task is already running.'), { code: 'TASK_ALREADY_RUNNING' });
        }
        runningTaskIds.add(id);
        clearTaskTimer(id);
        run = {
          id: cleanText(createId(), 160), trigger: trigger === 'schedule' ? 'schedule' : 'manual',
          status: 'running', started_at: currentIso(), completed_at: '', text: '', error: ''
        };
        currentTask.last_run = cloneJson(run);
        currentTask.updated_at = currentIso();
        await persistTasks(configPath);
        return publicTask(currentTask);
      }, configPath);
      if (!task) return null;
      if (!run) return { task, run: null };
      // Inference stays outside the transaction so editing another task does
      // not wait for a model run. Only its state transitions take the queue.
      const result = await runCodexTask(task);
      const text = extractCodexText(result);
      if (!text) {
        throw new Error('Codex scheduled task returned an empty response.');
      }
      run.status = 'succeeded';
      run.completed_at = currentIso();
      run.text = cleanText(text, 20000);
      if (typeof normalizeRunResult === 'function') {
        const normalizedResult = await normalizeRunResult(task, text, {
          completedAt: run.completed_at,
          completed_at: run.completed_at
        });
        if (normalizedResult && typeof normalizedResult === 'object' && !Array.isArray(normalizedResult)) {
          run.result = cloneJson(normalizedResult);
        }
      }
      const currentTask = await commitRun(id, run, configPath);
      return {
        task: currentTask,
        run: cloneJson(run),
        text
      };
    } catch (rawError) {
      if (!run) throw rawError;
      // ponytail: a rejection with a primitive would throw on the property
      // assignment below under strict mode, wrap it instead.
      const error = rawError instanceof Error
        ? rawError
        : new Error(cleanText(rawError, 2400) || 'Codex scheduled task failed.');
      run.status = 'failed';
      run.completed_at = currentIso();
      run.error = cleanText(error.message, 2400) || 'Codex scheduled task failed.';
      await commitRun(id, run, configPath).catch((persistError) => {
        consoleObject.error(`Failed to persist scheduled task "${id}" failure:`, persistError);
      });
      error.scheduledTaskRun = cloneJson(run);
      throw error;
    } finally {
      if (run) {
        runningTaskIds.delete(id);
        const currentTask = loadedPath === configPath && path.resolve(getScheduledTasksPath()) === configPath ? tasks.get(id) : null;
        if (currentTask) armTask(currentTask);
      }
    }
  }

  async function start(configPath) {
    await ensureLoaded(configPath);
    started = true;
    armAllTasks();
    return {
      ok: true,
      task_count: tasks.size,
      config_path: configPath
    };
  }

  async function stop() {
    started = false;
    Array.from(timers.keys()).forEach(clearTaskTimer);
    await writeQueue.catch(() => {});
  }

  // Re-read from getScheduledTasksPath(), e.g. after the storage root moves.
  async function reload() {
    const wasStarted = started;
    await stop();
    return transaction(async (configPath) => {
      loaded = false;
      tasks.clear();
      return wasStarted ? start(configPath) : ensureLoaded(configPath);
    });
  }

  // Patches the stored result of one specific run; a newer run's results are left alone.
  async function updateRunResult(taskId, runId, update, configPath) {
    await ensureLoaded(configPath);
    const task = tasks.get(cleanText(taskId, 160));
    const run = task?.last_run;
    if (!run?.result || !runId || run.id !== runId) {
      return null;
    }
    const next = update(cloneJson(run.result));
    if (!next || typeof next !== 'object') {
      return null;
    }
    run.result = cloneJson(next);
    await persistTasks(configPath);
    return publicTask(task);
  }

  return {
    createTask: (input = {}) => {
      const captured = cloneJson(input);
      return transaction(configPath => createTask(captured, configPath));
    },
    deleteTask: (id) => transaction(configPath => deleteTask(id, configPath)),
    getTask: (id) => transaction(configPath => getTask(id, configPath)),
    listTasks: () => transaction(listTasks),
    reload,
    runTask,
    start: () => transaction(start),
    stop,
    updateRunResult: (id, runId, update) => transaction(configPath => updateRunResult(id, runId, update, configPath)),
    updateTask: (id, input = {}) => {
      const captured = cloneJson(input);
      return transaction(configPath => updateTask(id, captured, configPath));
    }
  };
}

module.exports = {
  createScheduledTaskService
};
