'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
const { DEFAULT_FREQUENCY_UNIT, DEFAULT_FREQUENCY_VALUE, DEFAULT_MAX_RESULTS, FREQUENCY_UNIT_MINUTES, MAX_INTERVAL_MINUTES } = require('./constants.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeFrequencyUnit(value) {
  const unit = cleanText(value, 40)
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
    .replace(/s$/u, '');
  if (unit === 'min' || unit === 'minute') {
    return 'minute';
  }
  if (unit === 'hr' || unit === 'hour') {
    return 'hour';
  }
  if (unit === 'day') {
    return 'day';
  }
  if (unit === 'wk' || unit === 'week') {
    return 'week';
  }
  if (unit === 'mo' || unit === 'month') {
    return 'month';
  }
  if (unit === 'yr' || unit === 'year') {
    return 'year';
  }
  return '';
}

function frequencyLabel(value, unit) {
  const displayValue = Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
  return `Every ${displayValue} ${unit}${Number(value) === 1 ? '' : 's'}`;
}

function parseFrequencyString(value) {
  const match = cleanText(value, 120).match(
    /^(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)$/iu
  );
  if (!match) {
    return null;
  }
  return {
    value: Number(match[1]),
    unit: normalizeFrequencyUnit(match[2])
  };
}

function normalizePaperFindingFrequency(input = {}) {
  const source = ensureObject(input);
  const rawFrequency = source.frequency;
  const frequencyObject = ensureObject(rawFrequency);
  const parsedString = typeof rawFrequency === 'string'
    ? parseFrequencyString(rawFrequency)
    : null;
  const directInterval = Number(
    source.interval_minutes
      ?? source.intervalMinutes
      ?? frequencyObject.interval_minutes
      ?? frequencyObject.intervalMinutes
  );
  let value = Number(
    frequencyObject.value
      ?? source.frequency_value
      ?? source.frequencyValue
      ?? parsedString?.value
      ?? DEFAULT_FREQUENCY_VALUE
  );
  let unit = normalizeFrequencyUnit(
    frequencyObject.unit
      || source.frequency_unit
      || source.frequencyUnit
      || parsedString?.unit
      || DEFAULT_FREQUENCY_UNIT
  );

  if (Number.isFinite(directInterval) && directInterval > 0) {
    const preferredUnits = ['year', 'month', 'week', 'day', 'hour', 'minute'];
    unit = preferredUnits.find((candidate) => (
      directInterval >= FREQUENCY_UNIT_MINUTES[candidate]
      && directInterval % FREQUENCY_UNIT_MINUTES[candidate] === 0
    )) || 'minute';
    value = directInterval / FREQUENCY_UNIT_MINUTES[unit];
  }

  if (!Number.isFinite(value) || value <= 0 || !unit) {
    throw new Error('frequency must be a positive value with a minute, hour, day, week, month, or year unit.');
  }
  const intervalMinutes = Math.round(value * FREQUENCY_UNIT_MINUTES[unit]);
  if (intervalMinutes < 1 || intervalMinutes > MAX_INTERVAL_MINUTES) {
    throw new Error(`paper finding frequency must be between 1 minute and ${MAX_INTERVAL_MINUTES} minutes.`);
  }
  return {
    value,
    unit,
    interval_minutes: intervalMinutes,
    label: frequencyLabel(value, unit)
  };
}

function normalizePreferredJournals(value) {
  const candidates = [];
  function add(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(add);
      return;
    }
    if (entry && typeof entry === 'object') {
      add(entry.name || entry.url || entry.href || '');
      return;
    }
    String(entry || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240))
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }
  add(value);
  const seen = new Set();
  return candidates.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeProject(input = {}) {
  const source = ensureObject(input);
  const project = ensureObject(source.project);
  const normalized = {
    id: cleanText(project.id || project.project_id || project.projectId, 220),
    name: cleanText(project.name || project.project_name || project.projectName, 320),
    description: cleanText(
      project.description
        || source.project_description
        || source.projectDescription,
      12_000
    ),
    storage_path: cleanText(
      project.storage_path
        || project.storagePath
        || source.storage_path
        || source.storagePath,
      2400
    ),
    data_file_path: cleanText(
      project.data_file_path
        || project.dataFilePath
        || source.data_file_path
        || source.dataFilePath,
      2400
    ),
    cwd: cleanText(project.cwd || source.cwd, 2400)
  };
  if (!normalized.id && !normalized.name) {
    throw new Error('paper finding requires a project id or project name.');
  }
  return normalized;
}

function normalizeMaxResults(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(24, Math.round(parsed)));
}

module.exports = {
  cleanText,
  frequencyLabel,
  hasOwn,
  normalizeFrequencyUnit,
  normalizeMaxResults,
  normalizePaperFindingFrequency,
  normalizePreferredJournals,
  normalizeProject
};
