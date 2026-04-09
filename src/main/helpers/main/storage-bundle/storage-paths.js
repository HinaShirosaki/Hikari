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

function stripSqliteBundleSuffix(filePath) {
  const raw = String(filePath || '');
  if (/\.index\.sqlite$/i.test(raw)) {
    return raw.replace(/\.index\.sqlite$/i, '');
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

function getBundlePathsFromBasePath(basePath) {
  const cleanedBasePath = cleanText(basePath, 2400);
  if (!cleanedBasePath) {
    return {
      dataFilePath: '',
      basePath: '',
      protocolsPath: '',
      notebookPagesPath: '',
      sqlitePath: ''
    };
  }
  const resolvedBasePath = path.resolve(cleanedBasePath);
  return {
    dataFilePath: '',
    basePath: resolvedBasePath,
    protocolsPath: `${resolvedBasePath}.protocols.json`,
    notebookPagesPath: `${resolvedBasePath}.notebook-pages.json`,
    sqlitePath: `${resolvedBasePath}.index.sqlite`
  };
}

function getBundlePathsFromSqlitePath(sqlitePath) {
  const cleanedSqlitePath = cleanText(sqlitePath, 2400);
  if (!/\.index\.sqlite$/i.test(cleanedSqlitePath)) {
    return getBundlePathsFromBasePath('');
  }
  return getBundlePathsFromBasePath(stripSqliteBundleSuffix(cleanedSqlitePath));
}

function getBundlePaths({ dataFilePath, fallbackDataFilePath = '' } = {}) {
  const resolvedDataFilePath = resolveDataFilePath(dataFilePath, fallbackDataFilePath);
  if (!resolvedDataFilePath) {
    return getBundlePathsFromBasePath('');
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
  getBundlePathsFromBasePath,
  getBundlePathsFromSqlitePath,
  hasSupportedDataExtension,
  resolveDataFilePath,
  stripDataFileSuffix,
  stripSqliteBundleSuffix
};
