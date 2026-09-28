'use strict';

const path = require('node:path');
const { asArray, ensureObject } = require('../lib/normalize.js');
const { buildNotebookConclusionRequest, validateNotebookConclusionResult } = require('./conclusion-request.js');
const { CODEX_AGENTS_FOLDER_NAME, CODEX_SKILLS_FOLDER_NAME, MEMORY_FILE_NAME, NOTEBOOK_MEMORY_MODEL_FALLBACK, NOTEBOOK_SUMMARY_PENDING, PAPER_SUMMARY_PENDING, PROJECT_MEMORY_AUTO_END, PROJECT_MEMORY_AUTO_START } = require('./constants.js');
const { buildProjectMemoryMarkdown, mergeProjectMemoryMarkdown } = require('./memory-markdown.js');
const { buildNotebookResultCorpus, deriveKnowledgePaperId, hashNotebookResult } = require('./notebook-sources.js');
const { buildProjectMemoryInput, generateAndCacheNotebookConclusion, renderProjectMemoryInput } = require('./project-inputs.js');
const { collectProjectMemoryRecords } = require('./project-records.js');
const { enqueueProjectGenerationWork, enqueueProjectMemoryWork, latestProjectMemoryInputs, waitForProjectMemoryQueue } = require('./queues.js');
const { formatField, formatTimestamp, humanizeStatus, sanitizeProjectMemoryFolderName } = require('./text-utils.js');

async function writeProjectMemoryFile({
  storageRootPath,
  folderPath,
  snapshot,
  projectRecord,
  requestNotebookConclusion,
  agentMemoryFilePath = '',
  regenerateConclusions = false
} = {}) {
  const filePath = path.join(folderPath, MEMORY_FILE_NAME);
  const input = buildProjectMemoryInput({
    storageRootPath,
    folderPath,
    filePath,
    snapshot,
    projectRecord,
    requestNotebookConclusion,
    agentMemoryFilePath
  });
  latestProjectMemoryInputs.set(input.projectKey, input);
  const rendered = await enqueueProjectMemoryWork(input.projectKey, () => (
    renderProjectMemoryInput(input, { writePrunedCache: true, resetConclusions: regenerateConclusions })
  ));
  const pending = rendered.misses;
  if (pending.length) {
    void enqueueProjectGenerationWork(input.projectKey, async () => {
      for (const source of pending) {
        await generateAndCacheNotebookConclusion(input.projectKey, source);
      }
      const newestInput = latestProjectMemoryInputs.get(input.projectKey);
      if (newestInput) {
        await enqueueProjectMemoryWork(input.projectKey, () => (
          renderProjectMemoryInput(newestInput, { writePrunedCache: true })
        ));
      }
    }).catch(() => {});
  }
  return {
    filePath,
    queued: pending.length
  };
}

function buildWorkflowMemoryMarkdown({
  workflow = {},
  template = {},
  project = {},
  workflowSummary = {},
  notebookEntries = [],
  relatedPapers = []
} = {}) {
  const normalizedWorkflow = ensureObject(workflow);
  const normalizedTemplate = ensureObject(template);
  const normalizedProject = ensureObject(project);
  const summary = ensureObject(workflowSummary);
  return [
    '# Workflow Memory',
    '',
    `Name: ${formatField(normalizedWorkflow.name, 'Untitled Workflow')}`,
    `ID: ${formatField(normalizedWorkflow.id)}`,
    `Template: ${formatField(normalizedTemplate.name, 'Untemplated Workflow')}`,
    `Template ID: ${formatField(normalizedTemplate.id)}`,
    `Project: ${formatField(normalizedProject.name, 'Unassigned')}`,
    `Project ID: ${formatField(normalizedProject.id, 'Unassigned')}`,
    `Description: ${formatField(normalizedWorkflow.description)}`,
    `Created: ${formatTimestamp(normalizedWorkflow.createdAt)}`,
    `Updated: ${formatTimestamp(normalizedWorkflow.updatedAt)}`,
    '',
    '## Progress',
    `- Overall status: ${humanizeStatus(summary.overallStatus)}`,
    `- Completion: ${Number(summary.percentComplete) || 0}%`,
    `- Steps completed: ${Number(summary.completedSteps) || 0} / ${Number(summary.totalSteps) || 0}`,
    `- Failed steps: ${Number(summary.failedSteps) || 0}`,
    `- Pending steps: ${Number(summary.pendingSteps) || 0}`,
    `- Workflow entries: ${asArray(normalizedWorkflow.entries).length}`,
    `- Workflow blocks: ${asArray(normalizedWorkflow.blocks).length}`,
    `- Linked notebook pages: ${asArray(notebookEntries).length || Number(summary.linkedNotebookCount) || 0}`,
    `- Related papers: ${asArray(relatedPapers).length}`,
    `- Result files: ${Number(summary.resultFileCount) || 0}`,
    '',
    '## Notes',
    '- Auto-generated from Hikari workflow storage metadata.',
    '- Update the workflow in the app to refresh this summary.'
  ].join('\n');
}

module.exports = {
  CODEX_AGENTS_FOLDER_NAME,
  CODEX_SKILLS_FOLDER_NAME,
  MEMORY_FILE_NAME,
  NOTEBOOK_MEMORY_MODEL_FALLBACK,
  NOTEBOOK_SUMMARY_PENDING,
  PAPER_SUMMARY_PENDING,
  PROJECT_MEMORY_AUTO_END,
  PROJECT_MEMORY_AUTO_START,
  buildNotebookConclusionRequest,
  buildNotebookResultCorpus,
  buildProjectMemoryMarkdown,
  buildWorkflowMemoryMarkdown,
  collectProjectMemoryRecords,
  deriveKnowledgePaperId,
  hashNotebookResult,
  mergeProjectMemoryMarkdown,
  validateNotebookConclusionResult,
  waitForProjectMemoryQueue,
  writeProjectMemoryFile,
  sanitizeProjectMemoryFolderName
};
