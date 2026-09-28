'use strict';

const { asArray: defaultAsArray } = require('../../../lib/normalize.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function stripWrappingQuotes(value = '') {
  const text = String(value || '');
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith('\'') && text.endsWith('\''))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
}

function sanitizeCommandName(value, maxLength = 32) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
  return normalized || '';
}

function splitFrontmatter(rawSource = '') {
  const source = String(rawSource || '');
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return {
      frontmatter: {},
      body: source.trim()
    };
  }

  const frontmatterLines = [];
  let index = 1;
  while (index < lines.length && lines[index].trim() !== '---') {
    frontmatterLines.push(lines[index]);
    index += 1;
  }
  if (index >= lines.length) {
    return {
      frontmatter: {},
      body: source.trim()
    };
  }

  const frontmatter = {};
  frontmatterLines.forEach((line) => {
    const match = String(line || '').match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!match) {
      return;
    }
    const key = String(match[1] || '').trim();
    const rawValue = stripWrappingQuotes(match[2] || '');
    if (!key) {
      return;
    }
    if (key === 'metadata') {
      try {
        frontmatter[key] = JSON.parse(rawValue);
      } catch {
        frontmatter[key] = {};
      }
      return;
    }
    frontmatter[key] = rawValue;
  });

  return {
    frontmatter,
    body: lines.slice(index + 1).join('\n').trim()
  };
}

function splitCommandMessage(message = '') {
  const trimmed = String(message || '').trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const withoutSlash = trimmed.slice(1).trim();
  if (!withoutSlash) {
    return null;
  }
  const firstSpace = withoutSlash.search(/\s/);
  if (firstSpace < 0) {
    return {
      command: sanitizeCommandName(withoutSlash.replace(/:$/, '')),
      raw_command: withoutSlash.replace(/:$/, ''),
      args: ''
    };
  }
  return {
    command: sanitizeCommandName(withoutSlash.slice(0, firstSpace).replace(/:$/, '')),
    raw_command: withoutSlash.slice(0, firstSpace).replace(/:$/, ''),
    args: withoutSlash.slice(firstSpace + 1).trim()
  };
}

module.exports = {
  defaultAsArray,
  defaultCleanText,
  parseBoolean,
  sanitizeCommandName,
  splitCommandMessage,
  splitFrontmatter
};
