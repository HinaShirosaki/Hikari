'use strict';

// Generic string, token, and regex helpers shared across the Telegram bot
// modules. Nothing here is aware of Telegram or bot state.

function getCommandArgs(text) {
  return String(text || '').replace(/^\/\S+\s*/, '').trim();
}

function normalizeTokenKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function splitFirstToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { first: '', rest: '' };
  }
  const firstSpace = text.indexOf(' ');
  if (firstSpace < 0) {
    return { first: text, rest: '' };
  }
  return {
    first: text.slice(0, firstSpace).trim(),
    rest: text.slice(firstSpace + 1).trim()
  };
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function isoNow() {
  return new Date().toISOString();
}

function isBlank(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function compactObject(objectValue) {
  const entries = Object.entries(objectValue || {}).filter(([, value]) => !isBlank(value));
  return Object.fromEntries(entries);
}

function firstRegexValue(text, patterns) {
  const source = String(text || '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return String(match[1]).trim();
    }
  }
  return '';
}

function uniqueValues(values) {
  const output = [];
  const seen = new Set();
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(normalized);
  });
  return output;
}

function parseLinkedRecords(text) {
  const source = String(text || '');
  const matches = source.match(/\b(?:SMP|ASY|GEL|NB|EXP|RUN|PRJ)-[A-Za-z0-9-]+\b/gi) || [];
  return uniqueValues(matches);
}

function parseNumericValue(text, patterns) {
  const raw = firstRegexValue(text, patterns);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

module.exports = {
  getCommandArgs,
  normalizeTokenKey,
  splitFirstToken,
  levenshteinDistance,
  isoNow,
  isBlank,
  compactObject,
  firstRegexValue,
  uniqueValues,
  parseLinkedRecords,
  parseNumericValue
};
