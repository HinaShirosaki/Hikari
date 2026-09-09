'use strict';

const { getBundlePaths } = require('./storage-paths');
const { readNotebookRowsFromSqlite, readPaperRowsFromSqlite, readProtocolRowsFromSqlite, readSqliteBundleIndex } = require('./storage-sql-read');
const { asArray, cleanText, cloneJson, readJsonFile } = require('./storage-utils');
const { hydrateWorkflowRootFromStoragePath } = require('./workflow-storage');
const { readExperimentLogSidecar } = require('./experiment-log-storage');
const { hydrateProjectRootFromStoragePath } = require('./hydration/project-folders.js');
const { getLegacyProtocolsFilePath, getLegacySqlitePath, hydrateSamplesRootFromStoragePath, readProtocolDirectory } = require('./hydration/protocol-directory.js');
const { hydrateInventoryFromSqliteSnapshot, mergeInventorySqliteSnapshots, mergePaperExperimentLinks, mergePaperRecords, mergeRecordsById, mergeSamplesSidecarIntoSnapshot, readNotebookEntriesFromSidecar, readProtocolsFromSidecar, readRecordIndexPayloadsByType } = require('./hydration/sqlite-inventory.js');

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

  if (!bundlePaths.basePath && !bundlePaths.sqlitePath && !bundlePaths.protocolsPath && !bundlePaths.notebookPagesPath && !bundlePaths.samplesPath) {
    return {
      snapshot: nextSnapshot,
      bundlePaths,
      sidecarPaths: {},
      migration: null
    };
  }

  const protocolSidecar = await readProtocolDirectory(bundlePaths.protocolsPath);
  if (protocolSidecar.ok) {
    nextSnapshot.protocols = Array.isArray(protocolSidecar.data)
      ? protocolSidecar.data
      : readProtocolsFromSidecar(protocolSidecar.data);
    migration.applied.push('protocol_sidecar');
  } else if (protocolSidecar.exists && protocolSidecar.error) {
    migration.warnings.push(protocolSidecar.error);
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

  const samplesSidecar = await readJsonFile(bundlePaths.samplesPath);
  if (samplesSidecar.ok) {
    if (mergeSamplesSidecarIntoSnapshot(nextSnapshot, samplesSidecar.data)) {
      migration.applied.push('samples_folder');
    }
  } else if (samplesSidecar.exists && samplesSidecar.error) {
    migration.warnings.push(samplesSidecar.error);
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
      storagePath: storageRootPath
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
    }
  }

  let commonSqliteData = await readSqliteBundleIndex(bundlePaths.sqlitePath);
  if (commonSqliteData.warning) {
    migration.warnings.push(commonSqliteData.warning);
  }
  if (!commonSqliteData.exists) {
    commonSqliteData = await readSqliteBundleIndex(getLegacySqlitePath(bundlePaths));
    if (commonSqliteData.warning) {
      migration.warnings.push(commonSqliteData.warning);
    }
  }
  let chemicalSqliteData = await readSqliteBundleIndex(bundlePaths.chemicalsSqlitePath);
  if (chemicalSqliteData.warning) {
    migration.warnings.push(chemicalSqliteData.warning);
  }
  if (!chemicalSqliteData.exists && commonSqliteData.exists) {
    chemicalSqliteData = commonSqliteData;
  }
  const inventorySqliteData = mergeInventorySqliteSnapshots(chemicalSqliteData, commonSqliteData);
  if (commonSqliteData.exists || chemicalSqliteData.exists) {
    const hydratedInventory = hydrateInventoryFromSqliteSnapshot(nextSnapshot, inventorySqliteData);
    if (hydratedInventory) {
      migration.applied.push('inventory_sqlite');
    }
    if ((!Array.isArray(nextSnapshot.protocols) || !nextSnapshot.protocols.length) && asArray(commonSqliteData.protocolRows).length) {
      nextSnapshot.protocols = readProtocolRowsFromSqlite(commonSqliteData.protocolRows);
      migration.applied.push('protocol_sqlite_fallback');
    }
    if ((!Array.isArray(nextSnapshot.notebookEntries) || !nextSnapshot.notebookEntries.length) && asArray(commonSqliteData.notebookRows).length) {
      nextSnapshot.notebookEntries = readNotebookRowsFromSqlite(commonSqliteData.notebookRows);
      migration.applied.push('notebook_sqlite_fallback');
    }
    if (asArray(commonSqliteData.paperRows).length) {
      nextSnapshot.papers = mergePaperRecords(nextSnapshot.papers, readPaperRowsFromSqlite(commonSqliteData.paperRows));
      migration.applied.push('paper_sqlite');
    }
    const assayRows = readRecordIndexPayloadsByType(commonSqliteData.recordRows, 'assay');
    if (assayRows.length) {
      nextSnapshot.assays = mergeRecordsById(nextSnapshot.assays, assayRows, 'assay');
      migration.applied.push('assay_record_index');
    }
    const gelRows = readRecordIndexPayloadsByType(commonSqliteData.recordRows, 'gel');
    if (gelRows.length) {
      nextSnapshot.gelAnalyses = mergeRecordsById(nextSnapshot.gelAnalyses, gelRows, 'gel');
      migration.applied.push('gel_record_index');
    }
  }

  return {
    snapshot: nextSnapshot,
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath,
      experimentLogPath: bundlePaths.experimentLogPath,
      samplesPath: bundlePaths.samplesPath
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
