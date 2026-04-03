'use strict';

const path = require('path');
const { cleanText } = require('./storage-utils');

function hasSupportedDataExtension(filePath) {
  return /\.(?:json|ena)$/i.test(String(filePath || '').trim());
}

function stripDataFileSuffix(filePath) {
  const raw = String(filePath || '');
  if (/\.ena\.json$/i.test(raw)) {
    return raw.replace(/\.ena\.json$/i, '');
  }
  if (/\.json$/i.test(raw)) {
    return raw.replace(/\.json$/i, '');
  }
  if (/\.ena$/i.test(raw)) {
    return raw.replace(/\.ena$/i, '');
  }
  return raw;
}

function resolveDataFilePath(dataFilePath, fallbackDataFilePath = '') {
  const preferred = cleanText(dataFilePath, 2400);
  const fallback = cleanText(fallbackDataFilePath, 2400);
  const candidate = preferred || fallback;
  if (!candidate) {
    return '';
  }
  if (hasSupportedDataExtension(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(`${candidate}.json`);
}

function getBundlePaths({ dataFilePath, fallbackDataFilePath = '' } = {}) {
  const resolvedDataFilePath = resolveDataFilePath(dataFilePath, fallbackDataFilePath);
  if (!resolvedDataFilePath) {
    return {
      dataFilePath: '',
      basePath: '',
      protocolsPath: '',
      notebookPagesPath: '',
      sqlitePath: ''
    };
  }
  const basePath = stripDataFileSuffix(resolvedDataFilePath);
  return {
    dataFilePath: resolvedDataFilePath,
    basePath,
    protocolsPath: `${basePath}.protocols.json`,
    notebookPagesPath: `${basePath}.notebook-pages.json`,
    sqlitePath: `${basePath}.index.sqlite`
  };
}

module.exports = {
  getBundlePaths,
  hasSupportedDataExtension,
  resolveDataFilePath,
  stripDataFileSuffix
};
