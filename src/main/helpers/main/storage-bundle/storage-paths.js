'use strict';

const path = require('path');
const { cleanText } = require('./storage-utils');

const ASSAYS_ROOT_FOLDER_NAME = 'Assays';
const CHEMICALS_SQLITE_FILE_NAME = 'hikari-chemicals.index.sqlite';
const GELS_ROOT_FOLDER_NAME = 'Gels';
const KNOWLEDGE_BASE_ROOT_FOLDER_NAME = 'KnowledgeBase';
const PAPER_MARKDOWN_ROOT_FOLDER_NAME = 'papers.md';
const PAPERS_ROOT_FOLDER_NAME = 'Papers';
const PROTOCOL_ROOT_FOLDER_NAME = 'Protocol';
const PROTOCOL_INDEX_FILE_NAME = 'protocol.index.sqlite';
const ROOT_BUNDLE_BASE_NAME = 'hikari-data';
const SAMPLES_ROOT_FOLDER_NAME = 'Samples';
const SAMPLES_FILE_NAME = 'samples.json';

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

function resolveProtocolBundlePaths({ storagePath = '', basePath = '' } = {}) {
  const cleanedStoragePath = cleanText(storagePath, 2400);
  const cleanedBasePath = cleanText(basePath, 2400);
  let rootPath = '';
  if (cleanedStoragePath) {
    rootPath = path.resolve(cleanedStoragePath);
  } else if (cleanedBasePath) {
    rootPath = path.dirname(path.resolve(cleanedBasePath));
  }
  if (!rootPath) {
    return {
      protocolRootPath: '',
      sqlitePath: ''
    };
  }
  const protocolRootPath = path.join(rootPath, PROTOCOL_ROOT_FOLDER_NAME);
  return {
    protocolRootPath,
    sqlitePath: path.join(protocolRootPath, PROTOCOL_INDEX_FILE_NAME)
  };
}

function resolveStorageRootPath({ storagePath = '', basePath = '' } = {}) {
  const cleanedStoragePath = cleanText(storagePath, 2400);
  const cleanedBasePath = cleanText(basePath, 2400);
  if (cleanedStoragePath) {
    return path.resolve(cleanedStoragePath);
  }
  if (cleanedBasePath) {
    return path.dirname(path.resolve(cleanedBasePath));
  }
  return '';
}

function resolveStorageRootLayout({ storagePath = '', basePath = '' } = {}) {
  const rootPath = resolveStorageRootPath({ storagePath, basePath });
  if (!rootPath) {
    return {
      storageRootPath: '',
      papersRootPath: '',
      assaysRootPath: '',
      gelsRootPath: '',
      knowledgeBaseRootPath: '',
      paperMarkdownRootPath: '',
      samplesRootPath: '',
      samplesPath: '',
      chemicalsSqlitePath: ''
    };
  }
  return {
    storageRootPath: rootPath,
    papersRootPath: path.join(rootPath, PAPERS_ROOT_FOLDER_NAME),
    assaysRootPath: path.join(rootPath, ASSAYS_ROOT_FOLDER_NAME),
    gelsRootPath: path.join(rootPath, GELS_ROOT_FOLDER_NAME),
    knowledgeBaseRootPath: path.join(rootPath, KNOWLEDGE_BASE_ROOT_FOLDER_NAME),
    paperMarkdownRootPath: path.join(rootPath, KNOWLEDGE_BASE_ROOT_FOLDER_NAME, PAPER_MARKDOWN_ROOT_FOLDER_NAME),
    samplesRootPath: path.join(rootPath, SAMPLES_ROOT_FOLDER_NAME),
    samplesPath: path.join(rootPath, SAMPLES_ROOT_FOLDER_NAME, SAMPLES_FILE_NAME),
    chemicalsSqlitePath: path.join(rootPath, CHEMICALS_SQLITE_FILE_NAME)
  };
}

function getBundlePathsFromBasePath(basePath, options = {}) {
  const cleanedBasePath = cleanText(basePath, 2400);
  if (!cleanedBasePath) {
    return {
      dataFilePath: '',
      basePath: '',
      storageRootPath: '',
      papersRootPath: '',
      assaysRootPath: '',
      gelsRootPath: '',
      knowledgeBaseRootPath: '',
      paperMarkdownRootPath: '',
      samplesRootPath: '',
      samplesPath: '',
      protocolRootPath: '',
      protocolsPath: '',
      notebookPagesPath: '',
      sqlitePath: '',
      legacySqlitePath: '',
      chemicalsSqlitePath: ''
    };
  }
  const resolvedBasePath = path.resolve(cleanedBasePath);
  const protocolPaths = resolveProtocolBundlePaths({
    storagePath: options?.storagePath,
    basePath: resolvedBasePath
  });
  const storageLayout = resolveStorageRootLayout({
    storagePath: options?.storagePath,
    basePath: resolvedBasePath
  });
  return {
    dataFilePath: '',
    basePath: resolvedBasePath,
    storageRootPath: storageLayout.storageRootPath,
    papersRootPath: storageLayout.papersRootPath,
    assaysRootPath: storageLayout.assaysRootPath,
    gelsRootPath: storageLayout.gelsRootPath,
    knowledgeBaseRootPath: storageLayout.knowledgeBaseRootPath,
    paperMarkdownRootPath: storageLayout.paperMarkdownRootPath,
    samplesRootPath: storageLayout.samplesRootPath,
    samplesPath: storageLayout.samplesPath,
    protocolRootPath: protocolPaths.protocolRootPath,
    protocolsPath: protocolPaths.protocolRootPath,
    notebookPagesPath: `${resolvedBasePath}.notebook-pages.json`,
    sqlitePath: protocolPaths.sqlitePath,
    legacySqlitePath: `${resolvedBasePath}.index.sqlite`,
    chemicalsSqlitePath: storageLayout.chemicalsSqlitePath
  };
}

function getBundlePathsFromSqlitePath(sqlitePath, options = {}) {
  const cleanedSqlitePath = cleanText(sqlitePath, 2400);
  if (!cleanedSqlitePath) {
    return getBundlePathsFromBasePath('');
  }
  const lowerSqlitePath = cleanedSqlitePath.toLowerCase();
  if (lowerSqlitePath.endsWith(`/${PROTOCOL_ROOT_FOLDER_NAME.toLowerCase()}/${PROTOCOL_INDEX_FILE_NAME}`)) {
    const storagePath = path.dirname(path.dirname(path.resolve(cleanedSqlitePath)));
    const basePath = options?.basePath || path.join(storagePath, ROOT_BUNDLE_BASE_NAME);
    return getBundlePathsFromBasePath(basePath, { storagePath });
  }
  if (!/\.index\.sqlite$/i.test(cleanedSqlitePath)) {
    return getBundlePathsFromBasePath('');
  }
  return getBundlePathsFromBasePath(stripSqliteBundleSuffix(cleanedSqlitePath), options);
}

function getBundlePaths({ dataFilePath, fallbackDataFilePath = '', storagePath = '' } = {}) {
  const resolvedDataFilePath = resolveDataFilePath(dataFilePath, fallbackDataFilePath);
  const cleanedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedDataFilePath && cleanedStoragePath) {
    return getBundlePathsFromBasePath(path.join(path.resolve(cleanedStoragePath), ROOT_BUNDLE_BASE_NAME), {
      storagePath: cleanedStoragePath
    });
  }
  if (!resolvedDataFilePath) {
    return getBundlePathsFromBasePath('');
  }
  const basePath = stripDataFileSuffix(resolvedDataFilePath);
  const protocolPaths = resolveProtocolBundlePaths({ storagePath, basePath });
  const storageLayout = resolveStorageRootLayout({ storagePath, basePath });
  return {
    dataFilePath: resolvedDataFilePath,
    basePath,
    storageRootPath: storageLayout.storageRootPath,
    papersRootPath: storageLayout.papersRootPath,
    assaysRootPath: storageLayout.assaysRootPath,
    gelsRootPath: storageLayout.gelsRootPath,
    knowledgeBaseRootPath: storageLayout.knowledgeBaseRootPath,
    paperMarkdownRootPath: storageLayout.paperMarkdownRootPath,
    samplesRootPath: storageLayout.samplesRootPath,
    samplesPath: storageLayout.samplesPath,
    protocolRootPath: protocolPaths.protocolRootPath,
    protocolsPath: protocolPaths.protocolRootPath,
    notebookPagesPath: `${basePath}.notebook-pages.json`,
    sqlitePath: protocolPaths.sqlitePath,
    legacySqlitePath: `${basePath}.index.sqlite`,
    chemicalsSqlitePath: storageLayout.chemicalsSqlitePath
  };
}

module.exports = {
  ASSAYS_ROOT_FOLDER_NAME,
  CHEMICALS_SQLITE_FILE_NAME,
  GELS_ROOT_FOLDER_NAME,
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  PAPERS_ROOT_FOLDER_NAME,
  PAPER_MARKDOWN_ROOT_FOLDER_NAME,
  PROTOCOL_INDEX_FILE_NAME,
  PROTOCOL_ROOT_FOLDER_NAME,
  ROOT_BUNDLE_BASE_NAME,
  SAMPLES_FILE_NAME,
  SAMPLES_ROOT_FOLDER_NAME,
  getBundlePaths,
  getBundlePathsFromBasePath,
  getBundlePathsFromSqlitePath,
  hasSupportedDataExtension,
  resolveStorageRootLayout,
  resolveStorageRootPath,
  resolveProtocolBundlePaths,
  resolveDataFilePath,
  stripDataFileSuffix,
  stripSqliteBundleSuffix
};
