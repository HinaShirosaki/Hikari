'use strict';

const { RECORD_FOLDERS, getBundlePaths } = require('./storage-paths');
const { readChemicalIndex } = require('./chemical-index-guard');
const { readPaperRecordFiles } = require('./paper-discovery');
const { readSampleContainers } = require('./sample-containers');
const { asArray, cleanText, cloneJson, readJsonFile } = require('./storage-utils');
const { hydrateWorkflowRootFromStoragePath } = require('./workflow-storage');
const { readExperimentLogSidecar } = require('./experiment-log-storage');
const { hydrateProjectRootFromStoragePath } = require('./hydration/project-folders.js');
const { getLegacyProtocolsFilePath, hydrateSamplesRootFromStoragePath, readProtocolDirectory, readRecordFolders } = require('./hydration/protocol-directory.js');
const { hydrateInventoryFromSqliteSnapshot, mergePaperExperimentLinks, mergePaperRecords, mergeRecordsById, mergeSamplesSidecarIntoSnapshot, readNotebookEntriesFromSidecar, readProtocolsFromSidecar } = require('./hydration/sqlite-inventory.js');

async function hydrateSnapshotFromBundle({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = '',
  bundlePaths: explicitBundlePaths = null
} = {}) {
  const sourceSnapshot = cloneJson(snapshot, {});
  const storagePath = cleanText(sourceSnapshot?.settings?.storagePath, 2400);
  const bundlePaths = explicitBundlePaths && typeof explicitBundlePaths === 'object'
    ? explicitBundlePaths
    : getBundlePaths({ dataFilePath, fallbackDataFilePath, storagePath });
  const nextSnapshot = cloneJson(sourceSnapshot, {});
  const migration = {
    applied: [],
    warnings: []
  };

  if (!bundlePaths.basePath && !bundlePaths.samplesRootPath && !bundlePaths.protocolsPath && !bundlePaths.notebookPagesPath) {
    return {
      snapshot: nextSnapshot,
      bundlePaths,
      sidecarPaths: {},
      migration: null
    };
  }

  const protocolSidecar = await readProtocolDirectory(bundlePaths.protocolsPath);
  if (protocolSidecar.error) migration.warnings.push(protocolSidecar.error);
  if (protocolSidecar.ok) {
    nextSnapshot.protocols = Array.isArray(protocolSidecar.data)
      ? protocolSidecar.data
      : readProtocolsFromSidecar(protocolSidecar.data);
    migration.applied.push('protocol_sidecar');
    if (nextSnapshot.protocols.some(record => record.markdownRevision)) migration.applied.push('protocol_markdown');
  } else if (protocolSidecar.exists && protocolSidecar.error) {
    // Preserve snapshot recovery when every protocol document is unreadable.
  } else {
    const legacyProtocolSidecar = await readJsonFile(getLegacyProtocolsFilePath(bundlePaths));
    if (legacyProtocolSidecar.ok) {
      nextSnapshot.protocols = readProtocolsFromSidecar(legacyProtocolSidecar.data);
      migration.applied.push('protocol_sidecar_legacy');
    } else if (legacyProtocolSidecar.exists && legacyProtocolSidecar.error) {
      migration.warnings.push(legacyProtocolSidecar.error);
    }
  }

  const notebookSidecar = await readJsonFile(bundlePaths.notebookPagesPath);
  if (notebookSidecar.ok) {
    nextSnapshot.notebookEntries = readNotebookEntriesFromSidecar(notebookSidecar.data);
    migration.applied.push('notebook_sidecar');
  } else if (notebookSidecar.exists && notebookSidecar.error) {
    migration.warnings.push(notebookSidecar.error);
  }

  const sampleContainers = await readSampleContainers(bundlePaths.samplesRootPath);
  migration.warnings.push(...sampleContainers.warnings);
  if (sampleContainers.exists && mergeSamplesSidecarIntoSnapshot(nextSnapshot, sampleContainers)) {
    migration.applied.push('samples_folder');
  }

  const experimentLogSidecar = await readExperimentLogSidecar(bundlePaths.experimentLogPath);
  if (experimentLogSidecar.ok) {
    if (!nextSnapshot.settings || typeof nextSnapshot.settings !== 'object' || Array.isArray(nextSnapshot.settings)) {
      nextSnapshot.settings = {};
    }
    const existingDashboard = nextSnapshot.settings.dashboard
      && typeof nextSnapshot.settings.dashboard === 'object'
      && !Array.isArray(nextSnapshot.settings.dashboard)
      ? nextSnapshot.settings.dashboard
      : {};
    nextSnapshot.settings.dashboard = {
      ...existingDashboard,
      ...experimentLogSidecar.data
    };
    migration.applied.push('experiment_log_sidecar');
  } else if (experimentLogSidecar.exists && experimentLogSidecar.error) {
    migration.warnings.push(experimentLogSidecar.error);
  }

  const storageRootPath = cleanText(nextSnapshot?.settings?.storagePath, 2400)
    || cleanText(bundlePaths?.storageRootPath, 2400);
  if (storageRootPath) {
    const projectHydrated = await hydrateProjectRootFromStoragePath({
      storagePath: storageRootPath,
      knownProjects: nextSnapshot.projects
    });
    asArray(projectHydrated.warnings).forEach((warning) => {
      if (warning) {
        migration.warnings.push(String(warning));
      }
    });
    if (projectHydrated.exists) {
      nextSnapshot.projects = mergeRecordsById(nextSnapshot.projects, projectHydrated.projects, 'project');
      nextSnapshot.notebookEntries = mergeRecordsById(nextSnapshot.notebookEntries, projectHydrated.notebookEntries, 'notebook');
      migration.applied.push('project_root_storage');
      if (projectHydrated.notebookEntries.some(entry => entry.storageDocumentFile === 'page.md')) migration.applied.push('notebook_markdown');
    }

    const workflowHydrated = await hydrateWorkflowRootFromStoragePath({
      storagePath: storageRootPath
    });
    asArray(workflowHydrated.warnings).forEach((warning) => {
      if (warning) {
        migration.warnings.push(String(warning));
      }
    });
    if (workflowHydrated.exists) {
      nextSnapshot.workflowTemplates = mergeRecordsById(nextSnapshot.workflowTemplates, workflowHydrated.workflowTemplates, 'workflow_template');
      nextSnapshot.workflows = mergeRecordsById(nextSnapshot.workflows, workflowHydrated.workflows, 'workflow');
      nextSnapshot.notebookEntries = mergeRecordsById(nextSnapshot.notebookEntries, workflowHydrated.notebookEntries, 'notebook');
      nextSnapshot.papers = mergePaperRecords(nextSnapshot.papers, workflowHydrated.papers);
      nextSnapshot.paperExperimentLinks = mergePaperExperimentLinks(
        nextSnapshot.paperExperimentLinks,
        workflowHydrated.paperExperimentLinks
      );
      migration.applied.push('workflow_root_storage');
      if (workflowHydrated.notebookEntries.some(entry => entry.storageDocumentFile === 'page.md') && !migration.applied.includes('notebook_markdown')) migration.applied.push('notebook_markdown');
    }
  }

  const chemicalSqliteData = await readChemicalIndex(bundlePaths.chemicalsSqlitePath);
  migration.warnings.push(...[chemicalSqliteData.warning, chemicalSqliteData.alert].filter(Boolean));

  if (hydrateInventoryFromSqliteSnapshot(nextSnapshot, chemicalSqliteData)) {
    migration.applied.push('inventory_sqlite');
  }
  // Each stored PDF carries its paper record beside it.
  const paperRecords = await readPaperRecordFiles(storageRootPath || bundlePaths.storageRootPath);
  migration.warnings.push(...paperRecords.warnings);
  if (paperRecords.records.length) {
    nextSnapshot.papers = mergePaperRecords(nextSnapshot.papers, paperRecords.records);
    migration.applied.push('paper_files');
  }
  // Plates (assays) and gels live one record file per folder.
  for (const [snapshotKey, folders] of Object.entries(RECORD_FOLDERS)) {
    const found = await readRecordFolders(bundlePaths[folders.rootKey], folders);
    migration.warnings.push(...found.warnings);
    if (found.records.length) {
      nextSnapshot[snapshotKey] = mergeRecordsById(nextSnapshot[snapshotKey], found.records, folders.key);
      migration.applied.push(`${folders.key}_folders`);
    }
  }

  return {
    snapshot: nextSnapshot,
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath,
      experimentLogPath: bundlePaths.experimentLogPath,
      samplesRootPath: bundlePaths.samplesRootPath
    },
    migration: migration.applied.length || migration.warnings.length ? migration : null
  };
}

module.exports = {
  hydrateInventoryFromSqliteSnapshot,
  hydrateProjectRootFromStoragePath,
  hydrateSamplesRootFromStoragePath,
  hydrateSnapshotFromBundle
};
