'use strict';

const { parseTimestamp } = require('./constants.js');

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

module.exports = {
  CALENDAR_INTERVAL_LIMITS,
  CALENDAR_UNITS,
  computeCalendarNextRunAt,
  normalizeCalendarUnit,
  normalizeTimeOfDay,
  normalizeTimeZone
};
