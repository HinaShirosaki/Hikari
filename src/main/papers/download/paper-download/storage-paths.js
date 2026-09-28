'use strict';

const path = require('node:path');
const { asArray: defaultAsArray } = require('../../../lib/normalize.js');
const { ensurePathWithinRoot, pathExists } = require('../../../lib/path-safety.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createDownloadId() {
  return `paper-download-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeStorageName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizeImportedFileName(fileName, fallback = 'paper.pdf') {
  const rawName = String(fileName || '').trim();
  const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24);
  const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
  const safeBase = sanitizeStorageName(base, path.parse(fallback).name || 'paper');
  const safeExt = ext || '.pdf';
  return `${safeBase}${safeExt}`;
}

function ensurePdfFileName(fileName, fallback = 'paper.pdf') {
  const sanitized = sanitizeImportedFileName(fileName || fallback, fallback);
  return /\.pdf$/i.test(sanitized) ? sanitized : `${sanitized}.pdf`;
}

function resolvePaperCollectionName(source = {}) {
  return defaultCleanText(
    source.collection_name
      || source.collectionName
      || source.linked_name
      || source.linkedName);
}

function buildPaperStorageFolder({ rootPath, linkedType, linkedName }) {
  const normalizedType = String(linkedType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  const safeLinkedName = sanitizeStorageName(linkedName, 'Uncategorized');
  if (normalizedType === 'journal-club' || normalizedType === 'literature-search') {
    return `${String(rootPath || '').trim()}/Papers/${safeLinkedName}`;
  }
  return `${String(rootPath || '').trim()}/Project/${safeLinkedName}/Papers`;
}

async function getUniqueFilePath(folderPath, fileName, reservedPaths = null) {
  const parsed = path.parse(fileName);
  const safeNameBase = sanitizeStorageName(parsed.name, 'paper');
  const safeExt = String(parsed.ext || '.pdf').replace(/[^.\w-]+/g, '').slice(0, 24) || '.pdf';
  let attempt = 0;

  while (attempt < 5000) {
    const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
    const candidateName = `${safeNameBase}${suffix}${safeExt}`;
    const candidatePath = path.join(folderPath, candidateName);
    if (!(await pathExists(candidatePath)) && !reservedPaths?.has(candidatePath)) {
      reservedPaths?.add(candidatePath);
      return candidatePath;
    }
    attempt += 1;
  }

  throw new Error('Unable to find a unique file name for paper download.');
}

function buildRelativePath(rootPath, targetPath) {
  return path.relative(path.resolve(rootPath), path.resolve(targetPath)).split(path.sep).join('/');
}

module.exports = {
  buildPaperStorageFolder,
  buildRelativePath,
  createDownloadId,
  defaultAsArray,
  defaultCleanText,
  ensurePathWithinRoot,
  ensurePdfFileName,
  getUniqueFilePath,
  resolvePaperCollectionName
};
