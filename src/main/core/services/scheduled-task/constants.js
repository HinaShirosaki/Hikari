'use strict';

const { ensureObject } = require('../../../lib/normalize.js');

// Storage format, interval bounds, and the small value helpers the service and
// its normalizers share.
const FILE_VERSION = 1;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 525_600;
const MAX_METADATA_JSON_LENGTH = 48_000;
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeMetadata(value) {
  const source = ensureObject(value);
  let serialized = '';
  try {
    serialized = JSON.stringify(source);
  } catch {
    throw new Error('metadata must contain only JSON-safe values.');
  }
  if (serialized.length > MAX_METADATA_JSON_LENGTH) {
    throw new Error(`metadata must be ${MAX_METADATA_JSON_LENGTH} characters or fewer.`);
  }
  return JSON.parse(serialized || '{}');
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  FILE_VERSION,
  MAX_TIMER_DELAY_MS,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  MAX_METADATA_JSON_LENGTH,
  SCHEDULE_KEYS,
  STAGGER_STEP_MS,
  fallbackCleanText,
  cloneJson,
  hasOwn,
  normalizeMetadata,
  parseTimestamp
};
