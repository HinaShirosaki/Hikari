'use strict';

const fs = require('fs/promises');
const path = require('path');
const { persistSqliteDatabase } = require('../../lib/sqlite-persist');
const { MEMORY_FILE_NAME, buildWorkflowMemoryMarkdown } = require('../storage-memory');
const { asArray, cleanText, ensureObject, loadSqlJs } = require('../storage-utils');
const { NOTEBOOK_PAGE_FILE_NAME, RELATED_PAPERS_FILE_NAME, TEMPLATE_METADATA_FILE_NAME, WORKFLOW_METADATA_FILE_NAME } = require('./constants.js');
const { buildTemplateFolderName, buildWorkflowFolderLayout, collectLinkedNotebookIds, resolveWorkflowStoragePaths } = require('./folder-names.js');
const { applyWorkflowStorageSchema, buildNotebookStorageFolder, ensureFolder, writeJsonFile } = require('./fs-helpers.js');
const { collectRelatedPaperData, collectWorkflowSummary, compactNotebookEntry, compactWorkflowRecord, resolveWorkflowTemplateRecord } = require('./record-compaction.js');

async function syncWorkflowRootFromSnapshot({
  storagePath = '',
  snapshot = {}
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const targetStoragePath = cleanText(storagePath, 2400)
    || cleanText(safeSnapshot?.settings?.storagePath, 2400);
  const rootPaths = resolveWorkflowStoragePaths(targetStoragePath);
  if (!rootPaths.workflowRootPath) {
    return {
      workflowRootPath: '',
      sqlitePath: '',
      summary: {
        workflowTemplates: 0,
        workflows: 0,
        notebookEntries: 0,
        papers: 0
      }
    };
  }

  await ensureFolder(rootPaths.workflowRootPath);
  const templateById = new Map();
  asArray(safeSnapshot.workflowTemplates).forEach((template) => {
    const id = cleanText(template?.id, 220);
    if (id) {
      templateById.set(id, ensureObject(template));
    }
  });

  const templatesForStorage = new Map();
  asArray(safeSnapshot.workflowTemplates).forEach((template) => {
    const templateRecord = ensureObject(template);
    const templateId = cleanText(templateRecord.id, 220);
    if (!templateId) {
      return;
    }
    templatesForStorage.set(templateId, templateRecord);
  });
  asArray(safeSnapshot.workflows).forEach((workflow) => {
    const templateRecord = resolveWorkflowTemplateRecord(templateById, workflow);
    const templateId = cleanText(templateRecord.id, 220);
    if (templateId && !templatesForStorage.has(templateId)) {
      templatesForStorage.set(templateId, templateRecord);
    }
  });

  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  // Everything below holds a whole sql.js image in the WASM heap; without
  // this the image leaks on any throw from the folder writes below.
  try {
    applyWorkflowStorageSchema(db);

    for (const template of templatesForStorage.values()) {
      const folderName = buildTemplateFolderName(template);
      const templateFolderPath = path.join(rootPaths.workflowRootPath, folderName);
      await ensureFolder(templateFolderPath);
      await writeJsonFile(path.join(templateFolderPath, TEMPLATE_METADATA_FILE_NAME), {
        exportedAt: new Date().toISOString(),
        template: ensureObject(template)
      });
      db.run(
        `INSERT OR REPLACE INTO workflow_templates (id, raw_json) VALUES (?, ?)`,
        [
          cleanText(template.id, 220),
          JSON.stringify(ensureObject(template))
        ]
      );
    }

    const notebookIdsWritten = new Set();
    const paperIdsWritten = new Set();

    for (const rawWorkflow of asArray(safeSnapshot.workflows)) {
      const workflow = ensureObject(rawWorkflow);
      const workflowId = cleanText(workflow.id, 220);
      if (!workflowId) {
        continue;
      }
      const template = resolveWorkflowTemplateRecord(templateById, workflow);
      const runLayout = buildWorkflowFolderLayout({
        storagePath: rootPaths.storagePath,
        template,
        workflow
      });
      await ensureFolder(runLayout.resultsFolderPath);
      await ensureFolder(runLayout.notebookFolderPath);
      await ensureFolder(runLayout.relatedPapersFolderPath);

      const linkedNotebookIds = collectLinkedNotebookIds(workflow);
      const notebookEntries = asArray(safeSnapshot.notebookEntries).filter((entry) => (
        linkedNotebookIds.includes(cleanText(entry?.id, 220))
      ));
      const relatedPapers = collectRelatedPaperData(safeSnapshot, workflow, linkedNotebookIds);
      const workflowSummary = collectWorkflowSummary(workflow);
      const project = asArray(safeSnapshot.projects).find((item) => (
        cleanText(item?.id, 220) === cleanText(workflow.projectId, 220)
      ));
      const portableWorkflow = compactWorkflowRecord(workflow);

      await ensureFolder(runLayout.workflowFolderPath);
      await fs.writeFile(
        path.join(runLayout.workflowFolderPath, MEMORY_FILE_NAME),
        buildWorkflowMemoryMarkdown({
          workflow,
          template,
          project,
          workflowSummary,
          notebookEntries,
          relatedPapers: relatedPapers.papers
        }),
        'utf8'
      );
      await writeJsonFile(path.join(runLayout.workflowFolderPath, WORKFLOW_METADATA_FILE_NAME), {
        exportedAt: new Date().toISOString(),
        template: ensureObject(template),
        workflow: portableWorkflow,
        summary: {
          ...workflowSummary,
          notebookCount: notebookEntries.length,
          paperCount: relatedPapers.papers.length
        }
      });
      await writeJsonFile(path.join(runLayout.relatedPapersFolderPath, RELATED_PAPERS_FILE_NAME), {
        exportedAt: new Date().toISOString(),
        workflowId,
        papers: relatedPapers.papers,
        paperExperimentLinks: relatedPapers.paperExperimentLinks
      });

      for (const notebookEntry of notebookEntries) {
        const notebookFolder = buildNotebookStorageFolder(runLayout, notebookEntry);
        const compactEntry = compactNotebookEntry(notebookEntry);
        compactEntry.storageFolder = '';
        await writeJsonFile(path.join(notebookFolder, NOTEBOOK_PAGE_FILE_NAME), {
          exportedAt: new Date().toISOString(),
          workflowId,
          notebookEntry: compactEntry
        });
        const notebookId = cleanText(notebookEntry?.id, 220);
        if (notebookId) {
          notebookIdsWritten.add(notebookId);
        }
      }

      relatedPapers.papers.forEach((paper) => {
        const paperId = cleanText(paper?.id, 220);
        if (paperId) {
          paperIdsWritten.add(paperId);
        }
      });

      db.run(
        `INSERT OR REPLACE INTO workflow_runs (id, relative_folder_path, raw_json) VALUES (?, ?, ?)`,
        [
          workflowId,
          runLayout.relativeFolderPath,
          JSON.stringify(portableWorkflow)
        ]
      );
    }

    await persistSqliteDatabase(rootPaths.sqlitePath, db);
    return {
      workflowRootPath: rootPaths.workflowRootPath,
      sqlitePath: rootPaths.sqlitePath,
      summary: {
        workflowTemplates: templatesForStorage.size,
        workflows: asArray(safeSnapshot.workflows).length,
        notebookEntries: notebookIdsWritten.size,
        papers: paperIdsWritten.size
      }
    };
  } finally {
    db.close();
  }
}

module.exports = {
  syncWorkflowRootFromSnapshot
};
