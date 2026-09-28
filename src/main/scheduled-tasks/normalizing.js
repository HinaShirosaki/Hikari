'use strict';

const { ensureObject } = require('../lib/normalize.js');
const {
  MAX_INTERVAL_MINUTES,
  MAX_TIMER_DELAY_MS,
  MIN_INTERVAL_MINUTES,
  SCHEDULE_KEYS,
  cloneJson,
  hasOwn,
  normalizeMetadata,
  parseTimestamp
} = require('./constants.js');
const {
  CALENDAR_INTERVAL_LIMITS,
  CALENDAR_UNITS,
  computeCalendarNextRunAt,
  normalizeCalendarUnit,
  normalizeTimeOfDay,
  normalizeTimeZone
} = require('./calendar-recurrence.js');

// Input -> stored task normalization, the schedule shape, and the next-run
// computation. Clock and id generator are injected so runs are reproducible.
function createTaskNormalizers({
  now,
  cleanText,
  createId,
  runningTaskIds
} = {}) {
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
    if (!['manual', 'once', 'interval', 'calendar'].includes(kind)) {
      throw new Error('schedule.kind must be manual, once, interval, or calendar.');
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

    if (kind === 'calendar') {
      const unit = normalizeCalendarUnit(
        source.intervalUnit
          || source.interval_unit
          || source.unit
          || existing.interval_unit
      );
      if (!CALENDAR_UNITS.has(unit)) {
        throw new Error('schedule.interval_unit must be day, week, or month.');
      }
      const intervalValue = Number(
        source.intervalValue
          ?? source.interval_value
          ?? source.interval
          ?? existing.interval_value
          ?? 1
      );
      if (
        !Number.isInteger(intervalValue)
        || intervalValue < 1
        || intervalValue > CALENDAR_INTERVAL_LIMITS[unit]
      ) {
        throw new Error(`schedule.interval_value must be between 1 and ${CALENDAR_INTERVAL_LIMITS[unit]} for ${unit} schedules.`);
      }
      const timeOfDay = normalizeTimeOfDay(
        source.timeOfDay || source.time_of_day || source.time || existing.time_of_day || '09:00'
      );
      const timezone = normalizeTimeZone(source.timezone || source.timeZone || existing.timezone);
      const dayOfWeek = Number(source.dayOfWeek ?? source.day_of_week ?? existing.day_of_week ?? 1);
      const dayOfMonth = Number(source.dayOfMonth ?? source.day_of_month ?? existing.day_of_month ?? 1);
      if (unit === 'week' && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
        throw new Error('schedule.day_of_week must be between 0 and 6.');
      }
      if (unit === 'month' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
        throw new Error('schedule.day_of_month must be between 1 and 31.');
      }

      const sameCalendar = existing.kind === 'calendar'
        && existing.interval_unit === unit
        && existing.interval_value === intervalValue
        && existing.time_of_day === timeOfDay
        && existing.timezone === timezone
        && (unit !== 'week' || existing.day_of_week === dayOfWeek)
        && (unit !== 'month' || existing.day_of_month === dayOfMonth);
      const anchorValue = source.anchorAt
        || source.anchor_at
        || (sameCalendar ? existing.anchor_at : currentIso());
      return {
        kind: 'calendar',
        interval_value: intervalValue,
        interval_unit: unit,
        time_of_day: timeOfDay,
        timezone,
        ...(unit === 'week' ? { day_of_week: dayOfWeek } : {}),
        ...(unit === 'month' ? { day_of_month: dayOfMonth } : {}),
        anchor_at: normalizeIso(anchorValue, 'schedule.anchor_at')
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
      task_type: cleanText(
        readInputValue(source, 'taskType', 'task_type', existing.task_type),
        80
      ).toLowerCase(),
      metadata: normalizeMetadata(
        readInputValue(source, 'metadata', '', existing.metadata)
      ),
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
        description: cleanText(
          readInputValue(
            projectInput,
            'description',
            'project_description',
            existingProject.description
          ),
          12000
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

    if (task.schedule.kind === 'calendar') {
      return computeCalendarNextRunAt(task.schedule, fromMs);
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

  return {
    currentTimeMs,
    currentIso,
    normalizeIso,
    readInputValue,
    normalizeSchedule,
    normalizeTask,
    computeNextRunAt,
    publicTask
  };
}

module.exports = { createTaskNormalizers };
