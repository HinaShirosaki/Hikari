'use strict';

const path = require('path');
const { asArray, cleanText, ensureObject, parseJsonObject, readJsonFile, sanitizeFolderName } = require('./storage-utils');
const { RELATED_PAPERS_FILE_NAME, WORKFLOW_ROOT_FOLDER_NAME, WORKFLOW_STATUS_SQLITE_FILE_NAME } = require('./workflow/constants.js');
const { buildBlockFolderName, buildEntryFolderName, buildNotebookPageFolderName, buildTemplateFolderName, buildWorkflowFolderLayout, buildWorkflowFolderName, resolveWorkflowStoragePaths } = require('./workflow/folder-names.js');
const { readNotebookEntriesForWorkflowFolder, readWorkflowStatusIndex } = require('./workflow/read-root.js');
const { syncWorkflowRootFromSnapshot } = require('./workflow/sync-root.js');

async function hydrateWorkflowRootFromStoragePath({
  storagePath = ''
} = {}) {
  const rootPaths = resolveWorkflowStoragePaths(storagePath);
  if (!rootPaths.workflowRootPath) {
    return {
      exists: false,
      workflowTemplates: [],
      workflows: [],
      notebookEntries: [],
      papers: [],
      paperExperimentLinks: [],
      warnings: []
    };
  }

  const sqlData = await readWorkflowStatusIndex(rootPaths.sqlitePath);
  if (!sqlData.exists) {
    return {
      exists: false,
      workflowTemplates: [],
      workflows: [],
      notebookEntries: [],
      papers: [],
      paperExperimentLinks: [],
      warnings: asArray(sqlData.warnings)
    };
  }

  const warnings = [];
  const workflowTemplates = sqlData.templateRows
    .map((row) => parseJsonObject(row.raw_json) || null)
    .filter(Boolean);
  const workflows = sqlData.workflowRows
    .map((row) => ({
      relativeFolderPath: cleanText(row.relative_folder_path, 600),
      workflow: parseJsonObject(row.raw_json) || null
    }))
    .filter((row) => row.workflow);

  const notebookMap = new Map();
  const paperMap = new Map();
  const paperLinkMap = new Map();

  for (const row of workflows) {
    const relativeFolderPath = cleanText(row.relativeFolderPath, 600);
    if (!relativeFolderPath) {
      continue;
    }
    const workflowFolderPath = path.join(rootPaths.workflowRootPath, ...relativeFolderPath.split('/').filter(Boolean));
    try {
      const notebookEntries = await readNotebookEntriesForWorkflowFolder(workflowFolderPath);
      notebookEntries.forEach((entry) => {
        const notebookId = cleanText(entry?.id, 220);
        if (notebookId) {
          notebookMap.set(notebookId, entry);
        }
      });
      const relatedPayload = await readJsonFile(path.join(workflowFolderPath, 'RelatedPapers', RELATED_PAPERS_FILE_NAME));
      if (relatedPayload.ok) {
        asArray(relatedPayload.data?.papers).forEach((paper) => {
          const paperId = cleanText(paper?.id, 220);
          if (paperId) {
            paperMap.set(paperId, ensureObject(paper));
          }
        });
        asArray(relatedPayload.data?.paperExperimentLinks).forEach((link, index) => {
          const normalizedLink = ensureObject(link);
          const key = [
            cleanText(normalizedLink.paperId, 220),
            cleanText(normalizedLink.entryId, 220),
            cleanText(normalizedLink.projectId, 220),
            cleanText(normalizedLink.note, 500),
            index
          ].join('::');
          paperLinkMap.set(key, normalizedLink);
        });
      }
    } catch (error) {
      warnings.push(`Failed to read workflow folder ${relativeFolderPath}: ${String(error?.message || error)}`);
    }
  }

  return {
    exists: true,
    workflowTemplates,
    workflows: workflows.map((row) => row.workflow),
    notebookEntries: [...notebookMap.values()],
    papers: [...paperMap.values()],
    paperExperimentLinks: [...paperLinkMap.values()],
    warnings
  };
}

async function importWorkflowRoot({
  storagePath = ''
} = {}) {
  const hydrated = await hydrateWorkflowRootFromStoragePath({ storagePath });
  return {
    statePatch: {
      workflowTemplates: hydrated.workflowTemplates,
      workflows: hydrated.workflows,
      notebookEntries: hydrated.notebookEntries,
      papers: hydrated.papers,
      paperExperimentLinks: hydrated.paperExperimentLinks
    },
    summary: {
      workflowTemplates: hydrated.workflowTemplates.length,
      workflows: hydrated.workflows.length,
      notebookEntries: hydrated.notebookEntries.length,
      papers: hydrated.papers.length
    },
    warnings: hydrated.warnings || []
  };
}

module.exports = {
  WORKFLOW_ROOT_FOLDER_NAME,
  WORKFLOW_STATUS_SQLITE_FILE_NAME,
  buildBlockFolderName,
  buildEntryFolderName,
  buildNotebookPageFolderName,
  buildTemplateFolderName,
  buildWorkflowFolderName,
  buildWorkflowFolderLayout,
  hydrateWorkflowRootFromStoragePath,
  importWorkflowRoot,
  resolveWorkflowStoragePaths,
  sanitizeFolderName,
  syncWorkflowRootFromSnapshot
};
