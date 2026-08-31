'use strict';

const fs = require('fs/promises');
const path = require('path');
const { asArray, cleanText, ensureObject, readJsonFile } = require('../storage-utils');
const { buildProjectFolderDisplayName, buildProjectFolderFallbackId, parseProjectMemoryMarkdown, pickLatestTimestamp } = require('./project-memory.js');
const { isPermissionDeniedError } = require('./sqlite-inventory.js');

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

module.exports = {
  hydrateProjectRootFromStoragePath
};
