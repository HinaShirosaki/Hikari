'use strict';

const path = require('path');
const { cleanText } = require('./storage-utils');

const PLATES_ROOT_FOLDER_NAME = 'Plates';
const CHEMICALS_SQLITE_FILE_NAME = 'hikari-chemicals.index.sqlite';
const DASHBOARD_ROOT_FOLDER_NAME = 'Dashboard';
const EXPERIMENT_LOG_FILE_NAME = 'experiment-log.json';
const GELS_ROOT_FOLDER_NAME = 'Gels';
const KNOWLEDGE_BASE_ROOT_FOLDER_NAME = 'KnowledgeBase';
const PAPER_MARKDOWN_ROOT_FOLDER_NAME = 'papers.md';
const PAPERS_ROOT_FOLDER_NAME = 'Papers';
const PROJECT_ROOT_FOLDER_NAME = 'Project';
const PROJECT_SEQUENCE_FOLDER_NAME = 'DNA';
const PROTOCOL_ROOT_FOLDER_NAME = 'Protocol';
const ROOT_BUNDLE_BASE_NAME = 'hikari-data';
const SAMPLES_ROOT_FOLDER_NAME = 'Samples';
// Snapshot collections stored one JSON file per record folder, found on load by
// scanning the folder root (the way Protocol/<name>/protocol.json works).
const RECORD_FOLDERS = {
  assays: { rootKey: 'assaysRootPath', fileName: 'assay.json', key: 'assay', schemaName: 'hikari_assay', label: 'Assay' },
  gelAnalyses: { rootKey: 'gelsRootPath', fileName: 'gel.json', key: 'gel', schemaName: 'hikari_gel', label: 'Gel' }
};

function hasSupportedDataExtension(filePath) {
  return /\.json$/i.test(String(filePath || '').trim());
}

function normalizeDataFilePath(filePath, fallbackPath = '') {
  const preferred = String(filePath || '').trim();
  const fallback = String(fallbackPath || '').trim();
  const resolved = preferred || fallback;
  if (!resolved) {
    return '';
  }
  return hasSupportedDataExtension(resolved) ? resolved : `${resolved}.json`;
}

function stripDataFileSuffix(filePath) {
  return String(filePath || '').replace(/\.json$/i, '');
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
      protocolRootPath: ''
    };
  }
  return {
    protocolRootPath: path.join(rootPath, PROTOCOL_ROOT_FOLDER_NAME)
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
      dashboardRootPath: '',
      experimentLogPath: '',
      papersRootPath: '',
      assaysRootPath: '',
      gelsRootPath: '',
      knowledgeBaseRootPath: '',
      paperMarkdownRootPath: '',
      samplesRootPath: '',
      chemicalsSqlitePath: ''
    };
  }
  return {
    storageRootPath: rootPath,
    dashboardRootPath: path.join(rootPath, DASHBOARD_ROOT_FOLDER_NAME),
    experimentLogPath: path.join(rootPath, DASHBOARD_ROOT_FOLDER_NAME, EXPERIMENT_LOG_FILE_NAME),
    papersRootPath: path.join(rootPath, PAPERS_ROOT_FOLDER_NAME),
    assaysRootPath: path.join(rootPath, PLATES_ROOT_FOLDER_NAME),
    gelsRootPath: path.join(rootPath, GELS_ROOT_FOLDER_NAME),
    knowledgeBaseRootPath: path.join(rootPath, KNOWLEDGE_BASE_ROOT_FOLDER_NAME),
    paperMarkdownRootPath: path.join(rootPath, KNOWLEDGE_BASE_ROOT_FOLDER_NAME, PAPER_MARKDOWN_ROOT_FOLDER_NAME),
    samplesRootPath: path.join(rootPath, SAMPLES_ROOT_FOLDER_NAME),
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
      dashboardRootPath: '',
      experimentLogPath: '',
      papersRootPath: '',
      assaysRootPath: '',
      gelsRootPath: '',
      knowledgeBaseRootPath: '',
      paperMarkdownRootPath: '',
      samplesRootPath: '',
      protocolRootPath: '',
      protocolsPath: '',
      notebookPagesPath: '',
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
    dashboardRootPath: storageLayout.dashboardRootPath,
    experimentLogPath: storageLayout.experimentLogPath,
    papersRootPath: storageLayout.papersRootPath,
    assaysRootPath: storageLayout.assaysRootPath,
    gelsRootPath: storageLayout.gelsRootPath,
    knowledgeBaseRootPath: storageLayout.knowledgeBaseRootPath,
    paperMarkdownRootPath: storageLayout.paperMarkdownRootPath,
    samplesRootPath: storageLayout.samplesRootPath,
    protocolRootPath: protocolPaths.protocolRootPath,
    protocolsPath: protocolPaths.protocolRootPath,
    notebookPagesPath: `${resolvedBasePath}.notebook-pages.json`,
    chemicalsSqlitePath: storageLayout.chemicalsSqlitePath
  };
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
    dashboardRootPath: storageLayout.dashboardRootPath,
    experimentLogPath: storageLayout.experimentLogPath,
    papersRootPath: storageLayout.papersRootPath,
    assaysRootPath: storageLayout.assaysRootPath,
    gelsRootPath: storageLayout.gelsRootPath,
    knowledgeBaseRootPath: storageLayout.knowledgeBaseRootPath,
    paperMarkdownRootPath: storageLayout.paperMarkdownRootPath,
    samplesRootPath: storageLayout.samplesRootPath,
    protocolRootPath: protocolPaths.protocolRootPath,
    protocolsPath: protocolPaths.protocolRootPath,
    notebookPagesPath: `${basePath}.notebook-pages.json`,
    chemicalsSqlitePath: storageLayout.chemicalsSqlitePath
  };
}

module.exports = {
  PLATES_ROOT_FOLDER_NAME,
  CHEMICALS_SQLITE_FILE_NAME,
  DASHBOARD_ROOT_FOLDER_NAME,
  EXPERIMENT_LOG_FILE_NAME,
  GELS_ROOT_FOLDER_NAME,
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  PAPERS_ROOT_FOLDER_NAME,
  PAPER_MARKDOWN_ROOT_FOLDER_NAME,
  PROJECT_ROOT_FOLDER_NAME,
  PROJECT_SEQUENCE_FOLDER_NAME,
  PROTOCOL_ROOT_FOLDER_NAME,
  RECORD_FOLDERS,
  ROOT_BUNDLE_BASE_NAME,
  SAMPLES_ROOT_FOLDER_NAME,
  getBundlePaths,
  getBundlePathsFromBasePath,
  hasSupportedDataExtension,
  normalizeDataFilePath,
  resolveStorageRootLayout,
  resolveStorageRootPath,
  resolveProtocolBundlePaths,
  resolveDataFilePath,
  stripDataFileSuffix
};
