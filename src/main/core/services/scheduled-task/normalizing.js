'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
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

const CALENDAR_UNITS = new Set(['day', 'week', 'month']);
const CALENDAR_INTERVAL_LIMITS = Object.freeze({ day: 365, week: 52, month: 12 });

function normalizeCalendarUnit(value) {
  return String(value || '').trim().toLowerCase().replace(/s$/u, '');
}

function normalizeTimeOfDay(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) {
    throw new Error('schedule.time_of_day must use HH:MM format.');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('schedule.time_of_day must be a valid local time.');
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeTimeZone(value) {
  const timeZone = String(value || '').trim()
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new Error('schedule.timezone must be a valid IANA time zone.');
  }
  return timeZone;
}

function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  const values = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  });
  return values;
}

function wallTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desiredAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(candidate, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0,
      0
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    candidate += adjustment;
    if (adjustment === 0) {
      break;
    }
  }
  return candidate;
}

function shiftedWallDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function shiftedWallMonth({ year, month }, months) {
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1
  };
}

function daysInWallMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function wallDateOrdinal({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function calendarCandidate(schedule, wallDate) {
  const [hour, minute] = schedule.time_of_day.split(':').map(Number);
  return wallTimeToUtc({ ...wallDate, hour, minute }, schedule.timezone);
}

function firstCalendarCandidate(schedule) {
  const anchorMs = parseTimestamp(schedule.anchor_at);
  const anchor = zonedParts(anchorMs, schedule.timezone);
  let wallDate = { year: anchor.year, month: anchor.month, day: anchor.day };

  if (schedule.interval_unit === 'week') {
    const anchorWeekday = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day)).getUTCDay();
    wallDate = shiftedWallDate(wallDate, (schedule.day_of_week - anchorWeekday + 7) % 7);
  } else if (schedule.interval_unit === 'month') {
    wallDate.day = Math.min(schedule.day_of_month, daysInWallMonth(wallDate.year, wallDate.month));
  }

  let candidate = calendarCandidate(schedule, wallDate);
  if (candidate <= anchorMs) {
    if (schedule.interval_unit === 'month') {
      const shifted = shiftedWallMonth(wallDate, schedule.interval_value);
      wallDate = {
        ...shifted,
        day: Math.min(schedule.day_of_month, daysInWallMonth(shifted.year, shifted.month))
      };
    } else {
      const days = schedule.interval_unit === 'week'
        ? 7 * schedule.interval_value
        : schedule.interval_value;
      wallDate = shiftedWallDate(wallDate, days);
    }
    candidate = calendarCandidate(schedule, wallDate);
  }
  return { candidate, wallDate };
}

function computeCalendarNextRunAt(schedule, fromMs) {
  let { candidate, wallDate } = firstCalendarCandidate(schedule);
  if (candidate > fromMs) {
    return new Date(candidate).toISOString();
  }

  const current = zonedParts(fromMs, schedule.timezone);
  if (schedule.interval_unit === 'month') {
    const anchorMonth = (wallDate.year * 12) + wallDate.month - 1;
    const currentMonth = (current.year * 12) + current.month - 1;
    const elapsed = Math.max(0, currentMonth - anchorMonth);
    let steps = Math.floor(elapsed / schedule.interval_value);
    do {
      const shifted = shiftedWallMonth(wallDate, steps * schedule.interval_value);
      const nextWallDate = {
        ...shifted,
        day: Math.min(schedule.day_of_month, daysInWallMonth(shifted.year, shifted.month))
      };
      candidate = calendarCandidate(schedule, nextWallDate);
      steps += 1;
    } while (candidate <= fromMs);
    return new Date(candidate).toISOString();
  }

  const periodDays = schedule.interval_unit === 'week'
    ? 7 * schedule.interval_value
    : schedule.interval_value;
  const elapsedDays = Math.max(0, wallDateOrdinal(current) - wallDateOrdinal(wallDate));
  let steps = Math.floor(elapsedDays / periodDays);
  do {
    const nextWallDate = shiftedWallDate(wallDate, steps * periodDays);
    candidate = calendarCandidate(schedule, nextWallDate);
    steps += 1;
  } while (candidate <= fromMs);
  return new Date(candidate).toISOString();
}

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
