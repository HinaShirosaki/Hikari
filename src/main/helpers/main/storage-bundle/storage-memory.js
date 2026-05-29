'use strict';

const { asArray, cleanText, ensureObject } = require('./storage-utils');

const MEMORY_FILE_NAME = 'MEMORY.md';
const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizeProjectMemoryFolderName(value, fallback = 'Untitled_Project') {
  return sanitizeFolderName(value, fallback);
}

function normalizeFolderKey(value) {
  return sanitizeFolderName(value, '').toLowerCase();
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

function hasWorkflowContext(value) {
  const workflowContext = ensureObject(value?.workflowContext);
  return Boolean(
    cleanText(workflowContext.workflowId, 220)
    || cleanText(workflowContext.workflowEntryId, 220)
    || cleanText(workflowContext.workflowBlockId, 220)
  );
}

function humanizeStatus(value, fallback = 'not done') {
  const normalized = cleanText(value, 80)
    .replace(/[_-]+/g, ' ')
    .trim();
  return normalized || fallback;
}

function formatField(value, fallback = 'None recorded.') {
  return cleanText(value, 4000) || fallback;
}

function formatTimestamp(value, fallback = 'Unknown') {
  return cleanText(value, 80) || fallback;
}

function createProjectMemoryRecord(folderName, defaults = {}) {
  return {
    folderName,
    displayName: cleanText(defaults.displayName, 320) || folderName.replace(/_/g, ' '),
    projectId: cleanText(defaults.projectId, 220),
    description: cleanText(defaults.description, 4000),
    createdAt: cleanText(defaults.createdAt, 80),
    updatedAt: cleanText(defaults.updatedAt, 80),
    counts: {
      notebookEntries: 0,
      workflows: 0,
      papers: 0,
      assays: 0,
      gelAnalyses: 0
    }
  };
}

function collectProjectMemoryRecords(snapshot = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const byKey = new Map();
  const projectById = new Map();

  asArray(safeSnapshot.projects).forEach((project) => {
    const normalized = ensureObject(project);
    const projectId = cleanText(normalized.id, 220);
    if (projectId) {
      projectById.set(projectId, normalized);
    }
  });

  function resolveProjectMeta({ projectId = '', projectName = '', id = '', name = '', description = '', createdAt = '', updatedAt = '' } = {}) {
    const resolvedProjectId = cleanText(projectId, 220) || cleanText(id, 220);
    const matchedProject = projectById.get(resolvedProjectId) || null;
    const displayName = cleanText(projectName, 320)
      || cleanText(name, 320)
      || cleanText(matchedProject?.name, 320)
      || 'Untitled Project';
    return {
      folderName: sanitizeFolderName(displayName, 'Untitled_Project'),
      displayName,
      projectId: resolvedProjectId || cleanText(matchedProject?.id, 220),
      description: cleanText(description, 4000) || cleanText(matchedProject?.description, 4000),
      createdAt: cleanText(createdAt, 80) || cleanText(matchedProject?.createdAt, 80),
      updatedAt: cleanText(updatedAt, 80) || cleanText(matchedProject?.updatedAt, 80)
    };
  }

  function getOrCreateProjectRecord(meta = {}) {
    const folderName = sanitizeFolderName(meta.folderName || meta.displayName || 'Untitled_Project', 'Untitled_Project');
    const key = normalizeFolderKey(folderName);
    if (!byKey.has(key)) {
      byKey.set(key, createProjectMemoryRecord(folderName, meta));
    }
    const record = byKey.get(key);
    if (!cleanText(record.displayName, 320) && cleanText(meta.displayName, 320)) {
      record.displayName = cleanText(meta.displayName, 320);
    }
    if (!cleanText(record.projectId, 220) && cleanText(meta.projectId, 220)) {
      record.projectId = cleanText(meta.projectId, 220);
    }
    if (!cleanText(record.description, 4000) && cleanText(meta.description, 4000)) {
      record.description = cleanText(meta.description, 4000);
    }
    if (!cleanText(record.createdAt, 80) && cleanText(meta.createdAt, 80)) {
      record.createdAt = cleanText(meta.createdAt, 80);
    }
    record.updatedAt = pickLatestTimestamp(record.updatedAt, meta.updatedAt);
    return record;
  }

  asArray(safeSnapshot.projects).forEach((project) => {
    getOrCreateProjectRecord(resolveProjectMeta(ensureObject(project)));
  });

  asArray(safeSnapshot.notebookEntries).forEach((entry) => {
    const normalized = ensureObject(entry);
    if (hasWorkflowContext(normalized)) {
      return;
    }
    const record = getOrCreateProjectRecord(resolveProjectMeta({
      projectId: normalized.projectId,
      projectName: normalized.projectName,
      updatedAt: normalized.updatedAt,
      createdAt: normalized.createdAt
    }));
    record.counts.notebookEntries += 1;
    record.updatedAt = pickLatestTimestamp(record.updatedAt, normalized.updatedAt);
  });

  asArray(safeSnapshot.workflows).forEach((workflow) => {
    const normalized = ensureObject(workflow);
    const matchedProject = projectById.get(cleanText(normalized.projectId, 220));
    if (!matchedProject) {
      return;
    }
    const record = getOrCreateProjectRecord(resolveProjectMeta({
      projectId: normalized.projectId,
      updatedAt: normalized.updatedAt,
      createdAt: normalized.createdAt
    }));
    record.counts.workflows += 1;
    record.updatedAt = pickLatestTimestamp(record.updatedAt, normalized.updatedAt);
  });

  asArray(safeSnapshot.papers).forEach((paper) => {
    const normalized = ensureObject(paper);
    if (cleanText(normalized.linkedType, 60).toLowerCase() !== 'project') {
      return;
    }
    const record = getOrCreateProjectRecord(resolveProjectMeta({
      projectId: normalized.linkedId,
      projectName: normalized.linkedName,
      updatedAt: normalized.updatedAt,
      createdAt: normalized.createdAt
    }));
    record.counts.papers += 1;
    record.updatedAt = pickLatestTimestamp(record.updatedAt, normalized.updatedAt);
  });

  asArray(safeSnapshot.assays).forEach((assay) => {
    const normalized = ensureObject(assay);
    const record = getOrCreateProjectRecord(resolveProjectMeta({
      projectId: normalized.projectId,
      projectName: normalized.projectName,
      updatedAt: normalized.updatedAt,
      createdAt: normalized.createdAt
    }));
    record.counts.assays += 1;
    record.updatedAt = pickLatestTimestamp(record.updatedAt, normalized.updatedAt);
  });

  asArray(safeSnapshot.gelAnalyses).forEach((analysis) => {
    const normalized = ensureObject(analysis);
    const record = getOrCreateProjectRecord(resolveProjectMeta({
      projectId: normalized.projectId,
      projectName: normalized.projectName,
      updatedAt: normalized.updatedAt,
      createdAt: normalized.createdAt
    }));
    record.counts.gelAnalyses += 1;
    record.updatedAt = pickLatestTimestamp(record.updatedAt, normalized.updatedAt);
  });

  return [...byKey.values()]
    .filter((record) => {
      const counts = ensureObject(record.counts);
      const linkedCount = Number(counts.notebookEntries) + Number(counts.workflows)
        + Number(counts.papers) + Number(counts.assays) + Number(counts.gelAnalyses);
      const isEmptyUntitledProject = normalizeFolderKey(record.folderName) === 'untitled_project'
        && cleanText(record.displayName, 320) === 'Untitled Project'
        && linkedCount === 0;
      const isAnonymousUntitledProject = normalizeFolderKey(record.folderName) === 'untitled_project'
        && cleanText(record.displayName, 320) === 'Untitled Project'
        && !cleanText(record.projectId, 220);
      return !isEmptyUntitledProject && !isAnonymousUntitledProject;
    })
    .sort((left, right) => (
      String(left.displayName || left.folderName).localeCompare(String(right.displayName || right.folderName))
    ));
}

function buildProjectMemoryMarkdown(projectRecord = {}) {
  const record = ensureObject(projectRecord);
  const counts = ensureObject(record.counts);
  return [
    '# Project Memory',
    '',
    `Name: ${formatField(record.displayName, 'Untitled Project')}`,
    `Folder: ${formatField(record.folderName, 'Untitled_Project')}`,
    `ID: ${formatField(record.projectId)}`,
    `Description: ${formatField(record.description)}`,
    `Created: ${formatTimestamp(record.createdAt)}`,
    `Updated: ${formatTimestamp(record.updatedAt)}`,
    '',
    '## Linked Records',
    `- Notebook pages: ${Number(counts.notebookEntries) || 0}`,
    `- Workflows: ${Number(counts.workflows) || 0}`,
    `- Papers: ${Number(counts.papers) || 0}`,
    `- Assays: ${Number(counts.assays) || 0}`,
    `- Gel analyses: ${Number(counts.gelAnalyses) || 0}`,
    '',
    '## Notes',
    '- Auto-generated from Hikari storage metadata.',
    '- Update the project record in the app to refresh this summary.'
  ].join('\n');
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
  buildProjectMemoryMarkdown,
  buildWorkflowMemoryMarkdown,
  collectProjectMemoryRecords,
  sanitizeProjectMemoryFolderName
};
