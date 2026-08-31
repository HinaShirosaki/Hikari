'use strict';

const path = require('path');
const { asArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function normalizeRelativePath(value) {
  const candidate = String(value || '').replace(/\\/g, '/').trim();
  if (!candidate || candidate.includes('\0')) {
    return '';
  }
  const normalized = candidate
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return {
      text,
      truncated: false
    };
  }
  return {
    text: `${text.slice(0, maxLength)}...`,
    truncated: true
  };
}

function appendChunkText(state, chunk, maxLength) {
  const source = ensureObject(state);
  const chunkText = String(chunk || '');
  if (!chunkText) {
    return {
      text: String(source.text || ''),
      overflow: source.overflow === true
    };
  }
  const current = String(source.text || '');
  if (current.length >= maxLength) {
    return {
      text: current,
      overflow: true
    };
  }
  const available = maxLength - current.length;
  if (chunkText.length <= available) {
    return {
      text: `${current}${chunkText}`,
      overflow: source.overflow === true
    };
  }
  return {
    text: `${current}${chunkText.slice(0, available)}`,
    overflow: true
  };
}

function buildRunId() {
  return `py-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function inferImageMimeType(filePath = '') {
  const extension = path.extname(cleanText(filePath)).toLowerCase();
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  return '';
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Path must stay inside sandbox root.');
  }
  return resolvedTarget;
}

function isProcessAlive(processId) {
  const pid = Number(processId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM' || error?.code === 'EACCES';
  }
}

async function callLifecycleHook(fn, payload, warnings, label) {
  if (typeof fn !== 'function') {
    return;
  }
  try {
    await fn(payload);
  } catch (error) {
    asArray(warnings).push(`${label} hook failed: ${cleanText(error?.message || error)}.`);
  }
}

module.exports = {
  asArray,
  ensureObject,
  cloneJson,
  cleanText,
  clamp,
  normalizeRelativePath,
  truncateText,
  appendChunkText,
  buildRunId,
  inferImageMimeType,
  ensurePathInsideRoot,
  isProcessAlive,
  callLifecycleHook
};
