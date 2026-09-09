'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { asArray, cleanText, ensureObject, sanitizeFolderName } = require('../storage-utils');
const { hasWorkflowContext, normalizeRelativePath, normalizeWhitespace, truncateInline } = require('./text-utils.js');

function projectRecordMatchesSource(projectRecord, source = {}) {
  const record = ensureObject(projectRecord);
  const normalized = ensureObject(source);
  const projectId = cleanText(record.projectId, 220);
  const sourceProjectId = cleanText(
    normalized.projectId || normalized.project_id || normalized.linkedId || normalized.linked_id,
    220
  );
  if (projectId && sourceProjectId) {
    return projectId === sourceProjectId;
  }
  const projectName = cleanText(record.displayName || record.folderName, 320).toLowerCase();
  const sourceProjectName = cleanText(
    normalized.projectName || normalized.project_name || normalized.linkedName || normalized.linked_name,
    320
  ).toLowerCase();
  return Boolean(projectName && sourceProjectName && projectName === sourceProjectName);
}

function deriveKnowledgePaperId(paper = {}) {
  const relativePath = normalizeRelativePath(
    paper?.knowledgeMarkdownRelativePath || paper?.knowledge_markdown_relative_path
  );
  if (!relativePath) {
    return '';
  }
  return cleanText(path.posix.basename(path.posix.dirname(relativePath)), 220);
}

function normalizeNotebookTables(rawTables, legacyTable = null) {
  const candidates = Array.isArray(rawTables) && rawTables.length
    ? rawTables
    : [legacyTable].filter(Boolean);
  return candidates
    .map((rawTable) => {
      const table = ensureObject(rawTable);
      const columns = asArray(table.columns)
        .map((column, index) => ({
          field: cleanText(column?.field, 160),
          title: cleanText(column?.title, 240) || `Column ${index + 1}`
        }))
        .filter((column) => column.field);
      if (!columns.length) {
        return null;
      }
      const rows = asArray(table.rows).map((rawRow) => {
        const row = ensureObject(rawRow);
        return columns.map((column) => cleanText(row[column.field], 1000));
      });
      return { columns, rows };
    })
    .filter(Boolean);
}

function notebookTablesHaveRecordedValues(rawTables, legacyTable = null) {
  return normalizeNotebookTables(rawTables, legacyTable)
    .some((table) => table.rows.some((row) => row.some(Boolean)));
}

function flattenNotebookTables(rawTables, legacyTable = null) {
  return normalizeNotebookTables(rawTables, legacyTable)
    .map((table, tableIndex) => {
      const header = table.columns.map((column) => column.title).join(' | ');
      const rows = table.rows
        .map((row) => row.join(' | ').trim())
        .filter(Boolean);
      return [`Table ${tableIndex + 1}`, header, ...rows].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildNotebookResultCorpus(entry = {}) {
  const resultText = cleanText(entry?.result, 24000);
  const tableText = flattenNotebookTables(entry?.resultTables, entry?.resultTable);
  return [resultText, tableText].filter(Boolean).join('\n\n').trim();
}

function hashNotebookResult(entry = {}) {
  const normalized = normalizeWhitespace(buildNotebookResultCorpus(entry));
  return normalized
    ? crypto.createHash('sha256').update(normalized).digest('hex')
    : '';
}

function hasWorkflowNotebookContext(entry = {}) {
  return hasWorkflowContext(entry);
}

function isEligibleNotebookMemoryEntry(entry = {}) {
  const normalized = ensureObject(entry);
  // ponytail: pages saved before notebookType existed carry no type at all, and
  // they are most of the recorded corpus. Only an explicit non-biology type
  // excludes a page; an absent one does not.
  const notebookType = cleanText(normalized.notebookType, 40).toLowerCase();
  if (
    !cleanText(normalized.id, 220)
    || (notebookType && notebookType !== 'biology')
    || hasWorkflowNotebookContext(normalized)
    || ['planned', 'suggested'].includes(cleanText(normalized.notebookState, 40).toLowerCase())
  ) {
    return false;
  }
  return Boolean(
    cleanText(normalized.result, 24000)
    || notebookTablesHaveRecordedValues(normalized.resultTables, normalized.resultTable)
  );
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ''));
  const child = path.resolve(String(childPath || ''));
  if (!parent || !child) {
    return false;
  }
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function resolveNotebookPageFilePath(storageRootPath, entry = {}) {
  const existingStorageFolder = cleanText(entry?.storageFolder, 2400);
  if (existingStorageFolder && isPathInside(storageRootPath, existingStorageFolder)) {
    return path.join(path.resolve(existingStorageFolder), 'page.json');
  }
  const projectFolder = sanitizeFolderName(entry?.projectName || 'Untitled_Project', 'Untitled_Project');
  const pageFolder = `${sanitizeFolderName(
    entry?.protocolName || entry?.id || 'Notebook_Page',
    'Notebook_Page'
  )}__${sanitizeFolderName(entry?.id, 'page')}`;
  return path.join(storageRootPath, 'Project', projectFolder, 'Notebook', pageFolder, 'page.json');
}

function buildNotebookMemorySource(storageRootPath, projectRecord, entry = {}) {
  if (!projectRecordMatchesSource(projectRecord, entry) || !isEligibleNotebookMemoryEntry(entry)) {
    return null;
  }
  const id = cleanText(entry.id, 220);
  const pageFilePath = resolveNotebookPageFilePath(storageRootPath, entry);
  const corpus = buildNotebookResultCorpus(entry);
  const hash = hashNotebookResult(entry);
  if (!id || !corpus || !hash) {
    return null;
  }
  return {
    key: `notebook:${id}`,
    id,
    title: cleanText(entry.experimentName || entry.protocolName || id, 320),
    protocolName: cleanText(entry.protocolName, 320),
    updatedAt: cleanText(entry.updatedAt || entry.executedAt || entry.createdAt, 80),
    pageFilePath,
    sourceRelativePath: normalizeRelativePath(path.relative(storageRootPath, pageFilePath)),
    corpus,
    hash,
    fallbackConclusion: truncateInline(corpus, 800)
  };
}

module.exports = {
  buildNotebookMemorySource,
  buildNotebookResultCorpus,
  deriveKnowledgePaperId,
  hashNotebookResult,
  projectRecordMatchesSource
};
