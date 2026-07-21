'use strict';

const crypto = require('node:crypto');

const FILE_VERSION = 1;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 525_600;
const SCHEDULE_KEYS = [
  'kind', 'type', 'cadence', 'runAt', 'run_at',
  'intervalMinutes', 'interval_minutes', 'anchorAt', 'anchor_at'
];
// ponytail: bound the catch-up stampede when many overdue tasks arm at once after
// the app was closed for a while. Fixed 5s spread, revisit if task counts get large.
const STAGGER_STEP_MS = 5_000;

function fallbackCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  let loadPromise = null;
  let started = false;
  let writeQueue = Promise.resolve();

  function currentTimeMs() {
    const value = now();
    if (value instanceof Date) {
      return value.getTime();
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function currentIso() {
    return new Date(currentTimeMs()).toISOString();
  }

  function normalizeIso(value, fieldName) {
    const timestamp = parseTimestamp(value);
    if (!timestamp) {
      throw new Error(`${fieldName} must be a valid ISO date-time.`);
    }
    return new Date(timestamp).toISOString();
  }

  function readInputValue(input, camelKey, snakeKey, fallback = '') {
    if (hasOwn(input, camelKey)) {
      return input[camelKey];
    }
    if (snakeKey && hasOwn(input, snakeKey)) {
      return input[snakeKey];
    }
    return fallback;
  }

  function normalizeSchedule(input = {}, existingSchedule = null, createdAt = '') {
    const source = ensureObject(input);
    const existing = ensureObject(existingSchedule);
    const explicitKind = cleanText(
      source.kind || source.type || source.cadence,
      40
    ).toLowerCase();
    const inferredKind = source.runAt || source.run_at
      ? 'once'
      : ((source.intervalMinutes ?? source.interval_minutes) !== undefined ? 'interval' : '');
    const existingKind = cleanText(existing.kind || existing.type, 40).toLowerCase();
    const kind = explicitKind || inferredKind || existingKind || 'manual';
    if (!['manual', 'once', 'interval'].includes(kind)) {
      throw new Error('schedule.kind must be manual, once, or interval.');
    }
    if (kind === 'manual') {
      return { kind: 'manual' };
    }
    if (kind === 'once') {
      const runAt = source.runAt || source.run_at || existing.run_at;
      return {
        kind: 'once',
        run_at: normalizeIso(runAt, 'schedule.run_at')
      };
    }

    const intervalValue = source.intervalMinutes
      ?? source.interval_minutes
      ?? existing.interval_minutes;
    const intervalMinutes = Number(intervalValue);
    if (
      !Number.isFinite(intervalMinutes)
      || intervalMinutes < MIN_INTERVAL_MINUTES
      || intervalMinutes > MAX_INTERVAL_MINUTES
    ) {
      throw new Error(
        `schedule.interval_minutes must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`
      );
    }
    const anchorValue = source.anchorAt || source.anchor_at || existing.anchor_at || createdAt || currentIso();
    return {
      kind: 'interval',
      interval_minutes: intervalMinutes,
      anchor_at: normalizeIso(anchorValue, 'schedule.anchor_at')
    };
  }

  function normalizeTask(input = {}, existingTask = null) {
    const source = ensureObject(input);
    const existing = ensureObject(existingTask);
    const createdAt = cleanText(existing.created_at, 80) || currentIso();
    const updatedAt = currentIso();
    const projectInput = ensureObject(readInputValue(source, 'project', '', existing.project));
    const existingProject = ensureObject(existing.project);
    const executionInput = ensureObject(readInputValue(source, 'execution', '', existing.execution));
    const existingExecution = ensureObject(existing.execution);
    const hasScheduleInput = hasOwn(source, 'schedule')
      || SCHEDULE_KEYS.some((key) => hasOwn(source, key));
    const rawSchedule = hasOwn(source, 'schedule') ? ensureObject(source.schedule) : source;
    const schedule = normalizeSchedule(
      hasScheduleInput ? rawSchedule : ensureObject(existing.schedule),
      existing.schedule,
      createdAt
    );
    const prompt = cleanText(
      readInputValue(source, 'prompt', '', existing.prompt),
      120000
    );
    if (!prompt) {
      throw new Error('prompt is required.');
    }
    const title = cleanText(
      readInputValue(source, 'title', 'name', existing.title),
      220
    ) || cleanText(prompt, 80);
    const enabledRaw = readInputValue(source, 'enabled', '', existing.enabled !== false);
    const timeoutRaw = readInputValue(
      executionInput,
      'timeoutMs',
      'timeout_ms',
      existingExecution.timeout_ms ?? null
    );
    const timeoutNumber = timeoutRaw === null || timeoutRaw === '' ? null : Number(timeoutRaw);
    if (
      timeoutNumber !== null
      && (
        !Number.isFinite(timeoutNumber)
        || timeoutNumber < 1000
        || timeoutNumber > MAX_TIMER_DELAY_MS
      )
    ) {
      throw new Error(
        `execution.timeout_ms must be null or between 1000 and ${MAX_TIMER_DELAY_MS} milliseconds.`
      );
    }

    return {
      id: cleanText(existing.id || createId(), 160),
      title,
      prompt,
      enabled: enabledRaw !== false,
      schedule,
      project: {
        id: cleanText(
          readInputValue(projectInput, 'id', 'project_id', existingProject.id),
          220
        ),
        name: cleanText(
          readInputValue(projectInput, 'name', 'project_name', existingProject.name),
          320
        ),
        storage_path: cleanText(
          readInputValue(projectInput, 'storagePath', 'storage_path', existingProject.storage_path),
          2400
        ),
        data_file_path: cleanText(
          readInputValue(projectInput, 'dataFilePath', 'data_file_path', existingProject.data_file_path),
          2400
        ),
        cwd: cleanText(
          readInputValue(projectInput, 'cwd', '', existingProject.cwd),
          2400
        )
      },
      execution: {
        model: cleanText(
          readInputValue(executionInput, 'model', '', existingExecution.model),
          120
        ),
        reasoning_effort: cleanText(
          readInputValue(
            executionInput,
            'reasoningEffort',
            'reasoning_effort',
            existingExecution.reasoning_effort
          ),
          40
        ).toLowerCase(),
        enable_web_search: readInputValue(
          executionInput,
          'enableWebSearch',
          'enable_web_search',
          existingExecution.enable_web_search !== false
        ) !== false,
        timeout_ms: timeoutNumber === null ? null : Math.round(timeoutNumber)
      },
      created_at: createdAt,
      updated_at: updatedAt,
      next_run_at: cleanText(existing.next_run_at, 80),
      last_run: Object.keys(ensureObject(existing.last_run)).length
        ? cloneJson(existing.last_run)
        : null
    };
  }

  function computeNextRunAt(task, fromMs = currentTimeMs(), { preserveFuture = false } = {}) {
    if (!task.enabled || task.schedule.kind === 'manual') {
      return '';
    }
    if (preserveFuture) {
      const existingNextMs = parseTimestamp(task.next_run_at);
      if (existingNextMs > fromMs) {
        return new Date(existingNextMs).toISOString();
      }
    }
    if (task.schedule.kind === 'once') {
      if (task.last_run?.status === 'succeeded' || task.last_run?.status === 'failed') {
        return '';
      }
      return task.schedule.run_at;
    }

    const intervalMs = task.schedule.interval_minutes * 60_000;
    const anchorMs = parseTimestamp(task.schedule.anchor_at) || fromMs;
    if (anchorMs > fromMs) {
      return new Date(anchorMs).toISOString();
    }
    const elapsedMs = Math.max(0, fromMs - anchorMs);
    const nextMs = anchorMs + ((Math.floor(elapsedMs / intervalMs) + 1) * intervalMs);
    return new Date(nextMs).toISOString();
  }

  function publicTask(task) {
    return {
      ...cloneJson(task),
      is_running: runningTaskIds.has(task.id)
    };
  }

  async function loadTasks() {
    if (loaded) {
      return;
    }
    const configPath = getScheduledTasksPath();
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
  }

  async function ensureLoaded() {
    if (loaded) {
      return;
    }
    if (!loadPromise) {
      loadPromise = loadTasks().finally(() => {
        loadPromise = null;
      });
    }
    await loadPromise;
  }

  async function persistTasks() {
    const configPath = getScheduledTasksPath();
    const snapshot = {
      version: FILE_VERSION,
      updated_at: currentIso(),
      tasks: Array.from(tasks.values()).map((task) => cloneJson(task))
    };
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const temporaryPath = `${configPath}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), 'utf8');
        await fs.rename(temporaryPath, configPath);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    await writeQueue;
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

  async function listTasks() {
    await ensureLoaded();
    return Array.from(tasks.values())
      .map(publicTask)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async function getTask(taskId) {
    await ensureLoaded();
    const id = cleanText(taskId, 160);
    const task = tasks.get(id);
    return task ? publicTask(task) : null;
  }

  async function createTask(input = {}) {
    await ensureLoaded();
    const task = normalizeTask(input);
    if (!task.id || tasks.has(task.id)) {
      throw new Error('Could not allocate a unique scheduled task id.');
    }
    task.next_run_at = computeNextRunAt(task);
    tasks.set(task.id, task);
    try {
      await persistTasks();
    } catch (error) {
      tasks.delete(task.id);
      throw error;
    }
    armTask(task);
    return publicTask(task);
  }

  async function updateTask(taskId, updates = {}) {
    await ensureLoaded();
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
      await persistTasks();
    } catch (error) {
      tasks.set(id, existing);
      throw error;
    }
    armTask(updated);
    return publicTask(updated);
  }

  async function deleteTask(taskId) {
    await ensureLoaded();
    const id = cleanText(taskId, 160);
    const existing = tasks.get(id);
    if (!existing) {
      return null;
    }
    clearTaskTimer(id);
    tasks.delete(id);
    try {
      await persistTasks();
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

  async function runTask(taskId, { trigger = 'manual' } = {}) {
    await ensureLoaded();
    const id = cleanText(taskId, 160);
    const task = tasks.get(id);
    if (!task) {
      return null;
    }
    if (trigger === 'schedule' && !task.enabled) {
      return { task: publicTask(task), run: null };
    }
    if (runningTaskIds.has(id)) {
      const error = new Error('Scheduled task is already running.');
      error.code = 'TASK_ALREADY_RUNNING';
      throw error;
    }

    runningTaskIds.add(id);
    clearTaskTimer(id);
    const run = {
      id: cleanText(createId(), 160),
      trigger: trigger === 'schedule' ? 'schedule' : 'manual',
      status: 'running',
      started_at: currentIso(),
      completed_at: '',
      text: '',
      error: ''
    };
    task.last_run = run;
    task.updated_at = currentIso();

    try {
      await persistTasks();
      const result = await runCodexTask(publicTask(task));
      const text = extractCodexText(result);
      if (!text) {
        throw new Error('Codex scheduled task returned an empty response.');
      }
      run.status = 'succeeded';
      run.completed_at = currentIso();
      run.text = cleanText(text, 20000);
      const currentTask = tasks.get(id);
      if (currentTask) {
        currentTask.last_run = run;
        currentTask.updated_at = run.completed_at;
        if (currentTask.schedule.kind === 'once') {
          currentTask.enabled = false;
        }
        currentTask.next_run_at = computeNextRunAt(currentTask);
        await persistTasks();
      }
      return {
        task: currentTask ? { ...publicTask(currentTask), is_running: false } : null,
        run: cloneJson(run),
        text
      };
    } catch (rawError) {
      // ponytail: a rejection with a primitive would throw on the property
      // assignment below under strict mode, wrap it instead.
      const error = rawError instanceof Error
        ? rawError
        : new Error(cleanText(rawError, 2400) || 'Codex scheduled task failed.');
      run.status = 'failed';
      run.completed_at = currentIso();
      run.error = cleanText(error.message, 2400) || 'Codex scheduled task failed.';
      const currentTask = tasks.get(id);
      if (currentTask) {
        currentTask.last_run = run;
        currentTask.updated_at = run.completed_at;
        if (currentTask.schedule.kind === 'once') {
          currentTask.enabled = false;
        }
        currentTask.next_run_at = computeNextRunAt(currentTask);
        await persistTasks().catch((persistError) => {
          consoleObject.error(`Failed to persist scheduled task "${id}" failure:`, persistError);
        });
      }
      error.scheduledTaskRun = cloneJson(run);
      throw error;
    } finally {
      runningTaskIds.delete(id);
      const currentTask = tasks.get(id);
      if (currentTask) {
        armTask(currentTask);
      }
    }
  }

  async function start() {
    await ensureLoaded();
    started = true;
    armAllTasks();
    return {
      ok: true,
      task_count: tasks.size,
      config_path: getScheduledTasksPath()
    };
  }

  async function stop() {
    started = false;
    Array.from(timers.keys()).forEach(clearTaskTimer);
    await writeQueue.catch(() => {});
  }

  return {
    createTask,
    deleteTask,
    getTask,
    listTasks,
    runTask,
    start,
    stop,
    updateTask
  };
}

module.exports = {
  createScheduledTaskService
};
