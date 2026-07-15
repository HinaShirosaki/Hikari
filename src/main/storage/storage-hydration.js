'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getBundlePaths, SAMPLES_FILE_NAME, SAMPLES_ROOT_FOLDER_NAME } = require('./storage-paths');
const {
  readNotebookRowsFromSqlite,
  readPaperRowsFromSqlite,
  readProtocolRowsFromSqlite,
  readSqliteBundleIndex
} = require('./storage-sql-read');
const { asArray, cleanText, cloneJson, ensureObject, parseJsonObject, readJsonFile } = require('./storage-utils');
const { hydrateWorkflowRootFromStoragePath } = require('./workflow-storage');

function isPermissionDeniedError(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES';
}

function hydrateInventoryFromSqliteSnapshot(nextSnapshot, sqliteData) {
  const inventoryPersonalMap = {};
  asArray(sqliteData.inventoryPersonal).forEach((row) => {
    const zone = cleanText(row.zone, 200);
    if (!zone) {
      return;
    }
    if (!inventoryPersonalMap[zone]) {
      inventoryPersonalMap[zone] = [];
    }
    inventoryPersonalMap[zone].push(row.item);
  });

  const hasSqlChemicals = asArray(sqliteData.inventoryChemicals).length > 0;
  const hasSqlPersonal = Object.keys(inventoryPersonalMap).length > 0;
  const hasSqlSamples = asArray(sqliteData.inventorySamples).length > 0;
  const hasSqlMeta = Object.keys(ensureObject(sqliteData.inventoryMeta)).length > 0;
  if (!hasSqlChemicals && !hasSqlPersonal && !hasSqlSamples && !hasSqlMeta) {
    return false;
  }

  const existingLabInventory = ensureObject(nextSnapshot.labInventory);
  nextSnapshot.labInventory = {
    ...existingLabInventory,
    chemicals: hasSqlChemicals
      ? asArray(sqliteData.inventoryChemicals)
      : asArray(existingLabInventory.chemicals),
    blocks: Array.isArray(sqliteData.inventoryMeta?.lab_blocks)
      ? sqliteData.inventoryMeta.lab_blocks
      : asArray(existingLabInventory.blocks),
    lastLocationNumber: Number(sqliteData.inventoryMeta?.lab_last_location_number)
      || Number(existingLabInventory.lastLocationNumber)
      || 0,
    locationCodeMap: ensureObject(sqliteData.inventoryMeta?.lab_location_code_map),
    locationCodeNextByLocation: ensureObject(sqliteData.inventoryMeta?.lab_location_code_next_by_location)
  };

  if (hasSqlPersonal) {
    nextSnapshot.inventory = inventoryPersonalMap;
  }
  if ((!Array.isArray(nextSnapshot.samples) || !nextSnapshot.samples.length) && hasSqlSamples) {
    nextSnapshot.samples = asArray(sqliteData.inventorySamples);
  }

  return true;
}

function mergeInventorySqliteSnapshots(primarySqliteData, secondarySqliteData) {
  const primary = ensureObject(primarySqliteData);
  const secondary = ensureObject(secondarySqliteData);
  return {
    inventoryChemicals: asArray(primary.inventoryChemicals).length
      ? asArray(primary.inventoryChemicals)
      : asArray(secondary.inventoryChemicals),
    inventoryPersonal: asArray(primary.inventoryPersonal).length
      ? asArray(primary.inventoryPersonal)
      : asArray(secondary.inventoryPersonal),
    inventorySamples: asArray(primary.inventorySamples).length
      ? asArray(primary.inventorySamples)
      : asArray(secondary.inventorySamples),
    inventoryMeta: Object.keys(ensureObject(primary.inventoryMeta)).length
      ? ensureObject(primary.inventoryMeta)
      : ensureObject(secondary.inventoryMeta)
  };
}

function readProtocolsFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (payload.protocol && typeof payload.protocol === 'object' && !Array.isArray(payload.protocol)) {
    return [payload.protocol];
  }
  return asArray(payload.protocols);
}

function readNotebookEntriesFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  return asArray(payload.notebookPages);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function mergeSamplesSidecarIntoSnapshot(nextSnapshot, payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  let applied = false;
  if (hasOwn(payload, 'samples')) {
    nextSnapshot.samples = asArray(payload.samples);
    applied = true;
  }
  return applied;
}

function mergeRecordsById(existingRecords, importedRecords, fallbackPrefix) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `${fallbackPrefix}_existing_${index + 1}`;
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `${fallbackPrefix}_imported_${index + 1}`;
    const previous = byId.get(id) || {};
    byId.set(id, {
      ...previous,
      ...source,
      id
    });
  });
  return [...byId.values()];
}

function mergePaperRecords(existingRecords, importedRecords) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `paper_existing_${index + 1}`;
    const storedFilePath = cleanText(source.storedFilePath, 2400);
    const storedRelativePath = cleanText(source.storedRelativePath, 2400);
    byId.set(id, {
      ...source,
      id,
      ...(storedFilePath || storedRelativePath ? { pdfDataUrl: '' } : {})
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `paper_imported_${index + 1}`;
    const previous = ensureObject(byId.get(id));
    const merged = {
      ...previous,
      ...source,
      id
    };
    if (!cleanText(source.storedFilePath, 2400)) {
      merged.storedFilePath = cleanText(previous.storedFilePath, 2400);
    }
    if (!cleanText(source.storedRelativePath, 2400)) {
      merged.storedRelativePath = cleanText(previous.storedRelativePath, 2400);
    }
    const hasStoredPdfReference = Boolean(cleanText(merged.storedFilePath, 2400))
      || Boolean(cleanText(merged.storedRelativePath, 2400));
    if (hasStoredPdfReference) {
      merged.pdfDataUrl = '';
    } else if (!cleanText(source.pdfDataUrl, 80)) {
      merged.pdfDataUrl = cleanText(previous.pdfDataUrl, 10_000_000);
    }
    byId.set(id, merged);
  });
  return [...byId.values()];
}

function readRecordIndexPayloadsByType(rows, recordType) {
  const targetType = cleanText(recordType, 80).toLowerCase();
  if (!targetType) {
    return [];
  }
  return asArray(rows)
    .map((row) => ensureObject(row))
    .filter((row) => cleanText(row.record_type, 80).toLowerCase() === targetType)
    .map((row) => parseJsonObject(row.raw_json))
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record));
}

function mergePaperExperimentLinks(existingLinks, importedLinks) {
  const byKey = new Map();
  const pushLink = (rawLink, prefix, index) => {
    const link = ensureObject(rawLink);
    const substantiveKey = [
      cleanText(link.paperId, 220),
      cleanText(link.entryId, 220),
      cleanText(link.projectId, 220),
      cleanText(link.note, 600)
    ].join('::');
    const key = substantiveKey || `${prefix}_${index + 1}`;
    if (!substantiveKey && !Object.keys(link).length) {
      return;
    }
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...link
    });
  };
  asArray(existingLinks).forEach((link, index) => pushLink(link, 'existing', index));
  asArray(importedLinks).forEach((link, index) => pushLink(link, 'imported', index));
  return [...byKey.values()];
}

function pickLatestTimestamp(...values) {
  let latest = '';
  let latestMs = 0;
  values.forEach((value) => {
    const normalized = cleanText(value, 80);
    const ms = Date.parse(normalized);
    if (normalized && Number.isFinite(ms) && ms >= latestMs) {
      latest = normalized;
      latestMs = ms;
    }
  });
  return latest;
}

function buildProjectFolderDisplayName(folderName) {
  const normalized = cleanText(folderName, 320);
  return normalized ? normalized.replace(/_/g, ' ') : 'Untitled Project';
}

function buildProjectFolderFallbackId(folderName) {
  const normalized = cleanText(folderName, 220)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `project_folder_${normalized || 'untitled_project'}`;
}

function parseProjectMemoryMarkdown(rawMarkdown) {
  const markdown = String(rawMarkdown || '');
  if (!markdown.trim()) {
    return {};
  }
  const out = {};
  markdown.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!match) {
      return;
    }
    const key = cleanText(match[1], 80).toLowerCase();
    const value = cleanText(match[2], 4000);
    if (!value || value === 'None recorded.' || value === 'Unknown') {
      return;
    }
    if (key === 'name') {
      out.name = value;
    } else if (key === 'id') {
      out.id = value;
    } else if (key === 'description') {
      out.description = value;
    } else if (key === 'created') {
      out.createdAt = value;
    } else if (key === 'updated') {
      out.updatedAt = value;
    }
  });
  return out;
}

async function readProjectMemoryRecord(projectFolderPath) {
  const memoryPath = path.join(projectFolderPath, 'MEMORY.md');
  try {
    const raw = await fs.readFile(memoryPath, 'utf8');
    return parseProjectMemoryMarkdown(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function readNotebookEntriesForProjectFolder(projectFolderPath, defaults = {}) {
  const notebookRootPath = path.join(projectFolderPath, 'Notebook');
  const notebookEntries = [];
  const warnings = [];
  const defaultProjectId = cleanText(defaults.projectId, 220);
  const defaultProjectName = cleanText(defaults.projectName, 320);

  async function walk(currentPath) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== 'page.json') {
        continue;
      }
      const payload = await readJsonFile(absPath);
      if (!payload.ok) {
        if (payload.exists && payload.error) {
          warnings.push(payload.error);
        }
        continue;
      }
      const notebookEntry = ensureObject(payload.data?.notebookEntry);
      const notebookId = cleanText(notebookEntry.id, 220);
      if (!notebookId) {
        continue;
      }
      notebookEntries.push({
        ...notebookEntry,
        id: notebookId,
        projectId: cleanText(notebookEntry.projectId, 220) || defaultProjectId,
        projectName: cleanText(notebookEntry.projectName, 320) || defaultProjectName,
        storageFolder: path.dirname(absPath)
      });
    }
  }

  await walk(notebookRootPath);
  return {
    notebookEntries,
    warnings
  };
}

async function hydrateProjectRootFromStoragePath({
  storagePath = ''
} = {}) {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      exists: false,
      projects: [],
      notebookEntries: [],
      warnings: []
    };
  }

  const projectRootPath = path.join(resolvedStoragePath, 'Project');
  let projectFolders = [];
  try {
    projectFolders = await fs.readdir(projectRootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        projects: [],
        notebookEntries: [],
        warnings: []
      };
    }
    if (isPermissionDeniedError(error)) {
      return {
        exists: false,
        projects: [],
        notebookEntries: [],
        warnings: [`Permission denied reading project root ${projectRootPath}: ${String(error?.message || error)}`]
      };
    }
    throw error;
  }

  const projectMap = new Map();
  const notebookMap = new Map();
  const warnings = [];
  let discoveredProjectFolder = false;

  for (const entry of projectFolders) {
    if (!entry.isDirectory()) {
      continue;
    }
    discoveredProjectFolder = true;
    const projectFolderName = cleanText(entry.name, 320);
    const projectFolderPath = path.join(projectRootPath, entry.name);
    let memoryRecord = {};
    try {
      memoryRecord = await readProjectMemoryRecord(projectFolderPath);
    } catch (error) {
      warnings.push(`Failed to read project memory for ${projectFolderName}: ${String(error?.message || error)}`);
    }

    const fallbackProjectId = cleanText(memoryRecord.id, 220) || buildProjectFolderFallbackId(projectFolderName);
    const fallbackProjectName = cleanText(memoryRecord.name, 320) || buildProjectFolderDisplayName(projectFolderName);

    try {
      const hydratedProject = await readNotebookEntriesForProjectFolder(projectFolderPath, {
        projectId: fallbackProjectId,
        projectName: fallbackProjectName
      });
      asArray(hydratedProject.warnings).forEach((warning) => {
        if (warning) {
          warnings.push(String(warning));
        }
      });

      let projectId = cleanText(memoryRecord.id, 220);
      let projectName = cleanText(memoryRecord.name, 320);
      let createdAt = cleanText(memoryRecord.createdAt, 80);
      let updatedAt = cleanText(memoryRecord.updatedAt, 80);

      hydratedProject.notebookEntries.forEach((notebookEntry) => {
        const notebookId = cleanText(notebookEntry.id, 220);
        if (notebookId) {
          notebookMap.set(notebookId, notebookEntry);
        }
        projectId = projectId || cleanText(notebookEntry.projectId, 220);
        projectName = projectName || cleanText(notebookEntry.projectName, 320);
        createdAt = createdAt || cleanText(notebookEntry.createdAt, 80);
        updatedAt = pickLatestTimestamp(updatedAt, notebookEntry.updatedAt, notebookEntry.createdAt);
      });

      const resolvedProjectId = projectId || fallbackProjectId;
      const resolvedProjectName = projectName || fallbackProjectName;
      if (resolvedProjectId || resolvedProjectName || hydratedProject.notebookEntries.length) {
        projectMap.set(resolvedProjectId || fallbackProjectId, {
          id: resolvedProjectId || fallbackProjectId,
          name: resolvedProjectName || fallbackProjectName,
          description: cleanText(memoryRecord.description, 4000),
          createdAt,
          updatedAt
        });
      }
    } catch (error) {
      warnings.push(`Failed to read project folder ${projectFolderName}: ${String(error?.message || error)}`);
    }
  }

  return {
    exists: discoveredProjectFolder || notebookMap.size > 0 || projectMap.size > 0,
    projects: [...projectMap.values()],
    notebookEntries: [...notebookMap.values()],
    warnings
  };
}

async function hydrateSamplesRootFromStoragePath({
  storagePath = ''
} = {}) {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      exists: false,
      samples: [],
      warnings: []
    };
  }

  const samplesPath = path.join(resolvedStoragePath, SAMPLES_ROOT_FOLDER_NAME, SAMPLES_FILE_NAME);
  const payload = await readJsonFile(samplesPath);
  if (!payload.ok) {
    return {
      exists: false,
      samples: [],
      warnings: payload.exists && payload.error ? [payload.error] : []
    };
  }

  const source = ensureObject(payload.data);
  return {
    exists: true,
    samples: hasOwn(source, 'samples') ? asArray(source.samples) : [],
    warnings: []
  };
}

async function readProtocolDirectory(protocolRootPath) {
  const directoryPath = cleanText(protocolRootPath, 2400);
  if (!directoryPath) {
    return {
      exists: false,
      ok: false,
      data: [],
      error: ''
    };
  }
  try {
    const stat = await fs.stat(directoryPath);
    if (!stat.isDirectory()) {
      const singleFile = await readJsonFile(directoryPath);
      return {
        exists: singleFile.exists,
        ok: singleFile.ok,
        data: singleFile.ok ? readProtocolsFromSidecar(singleFile.data) : [],
        error: singleFile.error || ''
      };
    }
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const protocols = [];
    const warnings = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = path.join(directoryPath, entry.name, 'protocol.json');
      const payload = await readJsonFile(filePath);
      if (payload.ok) {
        protocols.push(...readProtocolsFromSidecar(payload.data));
      } else if (payload.exists && payload.error) {
        warnings.push(payload.error);
      }
    }
    return {
      exists: true,
      ok: protocols.length > 0,
      data: protocols,
      error: warnings.join('; ')
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        ok: false,
        data: [],
        error: ''
      };
    }
    return {
      exists: true,
      ok: false,
      data: [],
      error: String(error?.message || error)
    };
  }
}

function getLegacyProtocolsFilePath(bundlePaths) {
  const basePath = cleanText(bundlePaths?.basePath, 2400);
  return basePath ? `${basePath}.protocols.json` : '';
}

function getLegacySqlitePath(bundlePaths) {
  const explicitLegacyPath = cleanText(bundlePaths?.legacySqlitePath, 2400);
  if (explicitLegacyPath) {
    return explicitLegacyPath;
  }
  const basePath = cleanText(bundlePaths?.basePath, 2400);
  return basePath ? `${basePath}.index.sqlite` : '';
}

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
