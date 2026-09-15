'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { cleanText, ensureObject } = require('../storage-utils');
const { NOTEBOOK_MEMORY_MODEL_FALLBACK, PROJECT_MEMORY_CACHE_FILE, PROJECT_MEMORY_CACHE_FOLDER } = require('./constants.js');
const { truncateInline } = require('./text-utils.js');

function normalizeNotebookConclusionCache(rawCache = {}) {
  const cache = {};
  Object.entries(ensureObject(rawCache)).forEach(([key, rawValue]) => {
    if (!String(key).startsWith('notebook:')) {
      return;
    }
    const value = ensureObject(rawValue);
    const hash = cleanText(value.hash, 128);
    const conclusion = truncateInline(value.conclusion, 800);
    if (!hash || !conclusion) {
      return;
    }
    cache[key] = {
      hash,
      conclusion,
      generatedAt: cleanText(value.generatedAt, 80),
      model: cleanText(value.model, 120),
      status: cleanText(value.status, 40) || (value.model === NOTEBOOK_MEMORY_MODEL_FALLBACK ? 'fallback' : 'legacy'),
      proposedConclusion: truncateInline(value.proposedConclusion, 800),
      quotes: Array.isArray(value.quotes) ? value.quotes.map((quote) => String(quote)).slice(0, 3) : [],
      sourceRelativePath: cleanText(value.sourceRelativePath, 2400),
      attempts: Math.max(0, Number(value.attempts) || 0),
      retryAfter: cleanText(value.retryAfter, 80)
    };
  });
  return cache;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJsonObject(filePath) {
  try {
    return ensureObject(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    return {};
  }
}

async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function cachePathForProject(folderPath) {
  return path.join(folderPath, PROJECT_MEMORY_CACHE_FOLDER, PROJECT_MEMORY_CACHE_FILE);
}

async function readNotebookConclusionCache(folderPath) {
  return normalizeNotebookConclusionCache(await readJsonObject(cachePathForProject(folderPath)));
}

async function writeNotebookConclusionCache(folderPath, cache) {
  await atomicWriteFile(
    cachePathForProject(folderPath),
    stableJson(normalizeNotebookConclusionCache(cache))
  );
}

function pruneNotebookConclusionCache(cache, notebookSources) {
  const sourceByKey = new Map(notebookSources.map((source) => [source.key, source]));
  const next = {};
  Object.entries(normalizeNotebookConclusionCache(cache)).forEach(([key, value]) => {
    const source = sourceByKey.get(key);
    if (source && source.hash === value.hash) {
      next[key] = value;
    }
  });
  return next;
}

function buildFallbackCacheEntry(source, generatedAt = new Date().toISOString()) {
  return {
    hash: source.hash,
    conclusion: source.fallbackConclusion,
    generatedAt,
    model: NOTEBOOK_MEMORY_MODEL_FALLBACK,
    status: 'fallback',
    sourceRelativePath: source.sourceRelativePath,
    quotes: [],
    proposedConclusion: '',
    attempts: 0,
    retryAfter: ''
  };
}

function shouldGenerateConclusion(entry, source, timestamp = Date.now()) {
  if (!entry || entry.hash !== source.hash || entry.status === 'legacy') return true;
  if (entry.status !== 'fallback') return false;
  return entry.attempts < 3 && (!entry.retryAfter || Date.parse(entry.retryAfter) <= timestamp);
}

module.exports = {
  shouldGenerateConclusion,
  atomicWriteFile,
  buildFallbackCacheEntry,
  pruneNotebookConclusionCache,
  readJsonObject,
  readNotebookConclusionCache,
  stableJson,
  writeNotebookConclusionCache
};
