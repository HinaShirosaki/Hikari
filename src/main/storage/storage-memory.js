'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cleanText, ensureObject, sanitizeFolderName } = require('./storage-utils');

const MEMORY_FILE_NAME = 'MEMORY.md';
const CODEX_AGENTS_FOLDER_NAME = '.agents';
const CODEX_SKILLS_FOLDER_NAME = 'skills';
const PROJECT_MEMORY_AUTO_START = '<!-- hikari:auto -->';
const PROJECT_MEMORY_AUTO_END = '<!-- /hikari:auto -->';
const PROJECT_MEMORY_CACHE_FOLDER = '.hikari';
const PROJECT_MEMORY_CACHE_FILE = 'research-memory.json';
const NOTEBOOK_MEMORY_MODEL_FALLBACK = 'fallback-extract';
const projectMemoryQueues = new Map();
const projectGenerationQueues = new Map();
const latestProjectMemoryInputs = new Map();

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

function normalizeWhitespace(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateInline(value, maxLength = 800) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const end = lastSpace > Math.floor(maxLength * 0.6) ? lastSpace : maxLength;
  return `${sliced.slice(0, end).trim()}…`;
}

function normalizeRelativePath(value) {
  return cleanText(value, 2400).replace(/\\/g, '/').replace(/^\/+/, '');
}

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
  if (
    !cleanText(normalized.id, 220)
    || cleanText(normalized.notebookType, 40).toLowerCase() !== 'biology'
    || hasWorkflowNotebookContext(normalized)
    || cleanText(normalized.notebookState, 40).toLowerCase() === 'planned'
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

function normalizeNotebookConclusionCache(rawCache = {}) {
  const cache = {};
  Object.entries(ensureObject(rawCache)).forEach(([key, rawValue]) => {
    if (!String(key).startsWith('notebook:')) {
      return;
    }
    const value = ensureObject(rawValue);
    const hash = cleanText(value.hash, 128);
    const conclusion = truncateInline(value.conclusion, 800);
    if (!hash || !conclusion) {
      return;
    }
    cache[key] = {
      hash,
      conclusion,
      generatedAt: cleanText(value.generatedAt, 80),
      model: cleanText(value.model, 120)
    };
  });
  return cache;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJsonObject(filePath) {
  try {
    return ensureObject(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    return {};
  }
}

async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function cachePathForProject(folderPath) {
  return path.join(folderPath, PROJECT_MEMORY_CACHE_FOLDER, PROJECT_MEMORY_CACHE_FILE);
}

async function readNotebookConclusionCache(folderPath) {
  return normalizeNotebookConclusionCache(await readJsonObject(cachePathForProject(folderPath)));
}

async function writeNotebookConclusionCache(folderPath, cache) {
  await atomicWriteFile(
    cachePathForProject(folderPath),
    stableJson(normalizeNotebookConclusionCache(cache))
  );
}

function pruneNotebookConclusionCache(cache, notebookSources) {
  const sourceByKey = new Map(notebookSources.map((source) => [source.key, source]));
  const next = {};
  Object.entries(normalizeNotebookConclusionCache(cache)).forEach(([key, value]) => {
    const source = sourceByKey.get(key);
    if (source && source.hash === value.hash) {
      next[key] = value;
    }
  });
  return next;
}

function buildFallbackCacheEntry(source, generatedAt = new Date().toISOString()) {
  return {
    hash: source.hash,
    conclusion: source.fallbackConclusion,
    generatedAt,
    model: NOTEBOOK_MEMORY_MODEL_FALLBACK
  };
}

function normalizeNotebookEvidenceQuote(value) {
  let quote = normalizeWhitespace(value);
  if (quote.length < 2) {
    return quote;
  }
  const wrappers = new Map([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’']
  ]);
  if (wrappers.get(quote[0]) === quote.at(-1)) {
    quote = normalizeWhitespace(quote.slice(1, -1));
  }
  return quote;
}

function validateNotebookConclusionResult(result, source) {
  const payload = ensureObject(result?.payload || result);
  const conclusion = truncateInline(payload.conclusion, 800);
  const canonicalQuotes = asArray(payload.quotes);
  const quotes = (canonicalQuotes.length
    ? canonicalQuotes
    : asArray(payload.supporting_quotes || payload.supportingQuotes))
    .map((quote) => normalizeNotebookEvidenceQuote(quote))
    .filter(Boolean);
  const normalizedCorpus = normalizeWhitespace(source?.corpus);
  if (
    !conclusion
    || !quotes.length
    || !normalizedCorpus
    || !quotes.every((quote) => normalizedCorpus.includes(quote))
  ) {
    return null;
  }
  return {
    conclusion,
    model: cleanText(result?.model || payload.model, 120)
  };
}

function buildNotebookConclusionRequest(source) {
  return {
    moduleId: 'notebook',
    task: 'result-memory-conclusion',
    prompt: [
      'Generate one concise experimental conclusion from the saved result record below.',
      '',
      'Requirements:',
      '- Base the conclusion only on the supplied saved result.',
      '- Preserve uncertainty, negative findings, numbers, units, and sample identities.',
      '- Do not claim causality, statistical significance, binding affinity, or generality unless the saved result states it.',
      '- Return 1 to 3 short supporting quotes copied exactly from the saved result.',
      '- Return exactly two JSON fields: "conclusion" as a string and "quotes" as an array of those exact substrings.',
      '- Do not add quotation-mark characters around the text inside each quotes array item.',
      '- Return JSON only.',
      '',
      `Notebook page: ${source.title || source.id}`,
      source.protocolName ? `Protocol: ${source.protocolName}` : '',
      'Saved result:',
      source.corpus
    ].filter(Boolean).join('\n'),
    systemPrompt: 'You summarize recorded experimental results without inventing evidence. Return the requested structured JSON only.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['conclusion', 'quotes'],
      properties: {
        conclusion: { type: 'string' },
        quotes: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: { type: 'string' }
        }
      }
    },
    maxOutputTokens: 320
  };
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

function buildProjectMemoryGeneratedBlock(projectRecord = {}, {
  paperEntries = [],
  notebookEntries = [],
  pendingNotebookCount = 0,
  generatedAt = new Date().toISOString()
} = {}) {
  const record = ensureObject(projectRecord);
  const counts = ensureObject(record.counts);
  const papers = asArray(paperEntries);
  const notebooks = asArray(notebookEntries);
  const fallbackCount = notebooks.filter((entry) => entry.model === NOTEBOOK_MEMORY_MODEL_FALLBACK).length;
  const paperLines = papers.length
    ? papers.flatMap((paper) => [
        ...[
          `### ${truncateInline(paper.title || paper.paperId, 320)}`,
          `- Summary: ${truncateInline(paper.summary, 800)}`,
          `- Document type: ${formatField(humanizeStatus(paper.docType, 'other'), 'other')}`,
          paper.doi ? `- DOI: ${truncateInline(paper.doi, 240)}` : '',
          `- Source: \`${paper.sourceRelativePath}\``
        ].filter(Boolean),
        ''
      ])
    : ['- None recorded.', ''];
  const notebookLines = notebooks.length
    ? notebooks.flatMap((entry) => [
        ...[
          `### ${truncateInline(entry.title || entry.id, 320)}`,
          entry.model === NOTEBOOK_MEMORY_MODEL_FALLBACK
            ? `- Recorded result extract: ${truncateInline(entry.conclusion, 800)}`
            : `- Generated conclusion: ${truncateInline(entry.conclusion, 800)}`,
          entry.protocolName ? `- Protocol: ${truncateInline(entry.protocolName, 320)}` : '',
          entry.model ? `- Model: ${truncateInline(entry.model, 120)}` : '',
          entry.generatedAt ? `- Generated: ${formatTimestamp(entry.generatedAt)}` : '',
          entry.updatedAt ? `- Result updated: ${formatTimestamp(entry.updatedAt)}` : '',
          `- Source: \`${entry.sourceRelativePath}\``
        ].filter(Boolean),
        ''
      ])
    : ['- None recorded.', ''];

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
    '## Paper Conclusions',
    ...paperLines,
    '## Experimental Conclusions',
    ...notebookLines,
    '## Memory Sync',
    `- Generated: ${formatTimestamp(generatedAt)}`,
    `- Paper conclusions: ${papers.length}`,
    `- Experimental conclusions: ${notebooks.length}`,
    `- Notebook conclusions awaiting generation: ${Number(pendingNotebookCount) || 0}`,
    `- Fallback extracts: ${fallbackCount}`,
    ''
  ].join('\n').trim();
}

function wrapProjectMemoryGeneratedBlock(generatedBlock) {
  return [
    PROJECT_MEMORY_AUTO_START,
    String(generatedBlock || '').trim(),
    PROJECT_MEMORY_AUTO_END
  ].join('\n');
}

function findLegacyProjectMemoryRange(markdown) {
  const source = String(markdown || '');
  const start = source.indexOf('# Project Memory');
  const endMarker = '- Update the project record in the app to refresh this summary.';
  if (
    start < 0
    || !source.includes('## Linked Records', start)
    || !source.includes('- Auto-generated from Hikari storage metadata.', start)
  ) {
    return null;
  }
  const endStart = source.indexOf(endMarker, start);
  if (endStart < 0) {
    return null;
  }
  return {
    start,
    end: endStart + endMarker.length
  };
}

function mergeProjectMemoryMarkdown(existingMarkdown, generatedBlock) {
  const existing = String(existingMarkdown || '');
  const wrapped = wrapProjectMemoryGeneratedBlock(generatedBlock);
  const start = existing.indexOf(PROJECT_MEMORY_AUTO_START);
  const endStart = start >= 0 ? existing.indexOf(PROJECT_MEMORY_AUTO_END, start) : -1;
  if (start >= 0 && endStart >= 0) {
    const end = endStart + PROJECT_MEMORY_AUTO_END.length;
    return `${existing.slice(0, start)}${wrapped}${existing.slice(end)}`;
  }

  const legacyRange = findLegacyProjectMemoryRange(existing);
  if (legacyRange) {
    return `${existing.slice(0, legacyRange.start)}${wrapped}${existing.slice(legacyRange.end)}`;
  }
  if (!existing) {
    return wrapped;
  }
  return `${wrapped}\n\n${existing}`;
}

function buildProjectMemoryMarkdown(projectRecord = {}) {
  return mergeProjectMemoryMarkdown('', buildProjectMemoryGeneratedBlock(projectRecord));
}

async function readExistingText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function collectProjectPaperSources(snapshot, projectRecord) {
  return asArray(snapshot?.papers)
    .map((paper) => ensureObject(paper))
    .filter((paper) => (
      cleanText(paper.linkedType || paper.linked_type, 60).toLowerCase() === 'project'
      && projectRecordMatchesSource(projectRecord, paper)
    ))
    .map((paper) => {
      const paperId = deriveKnowledgePaperId(paper);
      return paperId ? {
        paperId,
        fallbackTitle: cleanText(paper.title, 400),
        knowledgeMarkdownRelativePath: normalizeRelativePath(
          paper.knowledgeMarkdownRelativePath || paper.knowledge_markdown_relative_path
        )
      } : null;
    })
    .filter(Boolean);
}

async function loadProjectPaperEntries(storageRootPath, paperSources) {
  const seen = new Set();
  const entries = [];
  for (const source of asArray(paperSources)) {
    if (!source.paperId || seen.has(source.paperId)) {
      continue;
    }
    seen.add(source.paperId);
    const sourceRelativePath = path.posix.join(
      'KnowledgeBase',
      'papers.md',
      source.paperId,
      'intake.json'
    );
    const intake = await readJsonObject(path.join(storageRootPath, ...sourceRelativePath.split('/')));
    const summary = cleanText(intake.one_sentence_summary, 1200);
    if (!summary) {
      continue;
    }
    entries.push({
      paperId: source.paperId,
      title: cleanText(intake.title, 400) || source.fallbackTitle || source.paperId,
      docType: cleanText(intake.doc_type, 80) || 'other',
      doi: cleanText(intake.doi, 240),
      summary,
      sourceRelativePath: normalizeRelativePath(intake.source_paths?.paper_md)
        || source.knowledgeMarkdownRelativePath
        || sourceRelativePath
    });
  }
  return entries.sort((left, right) => (
    String(left.title || left.paperId).localeCompare(String(right.title || right.paperId))
  ));
}

function buildProjectMemoryInput({
  storageRootPath,
  folderPath,
  filePath,
  snapshot,
  projectRecord,
  requestNotebookConclusion
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const notebooks = asArray(safeSnapshot.notebookEntries)
    .map((entry) => buildNotebookMemorySource(storageRootPath, projectRecord, ensureObject(entry)))
    .filter(Boolean)
    .sort((left, right) => String(left.title || left.id).localeCompare(String(right.title || right.id)));
  return {
    projectKey: path.resolve(folderPath),
    storageRootPath,
    folderPath,
    filePath,
    projectRecord: JSON.parse(JSON.stringify(projectRecord)),
    paperSources: collectProjectPaperSources(safeSnapshot, projectRecord),
    notebooks,
    requestNotebookConclusion: typeof requestNotebookConclusion === 'function'
      ? requestNotebookConclusion
      : null
  };
}

async function renderProjectMemoryInput(input, { writePrunedCache = false } = {}) {
  const [paperEntries, loadedCache] = await Promise.all([
    loadProjectPaperEntries(input.storageRootPath, input.paperSources),
    readNotebookConclusionCache(input.folderPath)
  ]);
  const cache = pruneNotebookConclusionCache(loadedCache, input.notebooks);
  if (writePrunedCache && stableJson(cache) !== stableJson(loadedCache)) {
    await writeNotebookConclusionCache(input.folderPath, cache);
  }
  const misses = [];
  const notebookEntries = input.notebooks.map((source) => {
    const cached = cache[source.key];
    if (!cached || cached.hash !== source.hash) {
      misses.push(source);
    }
    const conclusion = cached && cached.hash === source.hash
      ? cached
      : buildFallbackCacheEntry(source, '');
    return {
      ...source,
      conclusion: conclusion.conclusion,
      generatedAt: conclusion.generatedAt,
      model: conclusion.model
    };
  });
  const generatedBlock = buildProjectMemoryGeneratedBlock(input.projectRecord, {
    paperEntries,
    notebookEntries,
    pendingNotebookCount: misses.length
  });
  const existing = await readExistingText(input.filePath);
  await atomicWriteFile(
    input.filePath,
    mergeProjectMemoryMarkdown(existing, generatedBlock)
  );
  return { misses };
}

// A page we cannot read is not the same as a page that changed, and readJsonObject
// reports both as {}. Conflating them is what made a failed read re-ask the model
// on every single save, so the caller needs to tell them apart.
async function readCurrentNotebookMemorySource(input, requestedSource) {
  let payload = null;
  try {
    payload = JSON.parse(await fs.readFile(requestedSource.pageFilePath, 'utf8'));
  } catch {
    return { unverifiable: true, source: null };
  }
  return {
    unverifiable: false,
    source: buildNotebookMemorySource(
      input.storageRootPath,
      input.projectRecord,
      ensureObject(ensureObject(payload).notebookEntry)
    )
  };
}

async function generateAndCacheNotebookConclusion(projectKey, requestedSource) {
  const input = latestProjectMemoryInputs.get(projectKey);
  if (!input) {
    return;
  }
  const latestSource = input.notebooks.find((source) => source.key === requestedSource.key);
  if (!latestSource || latestSource.hash !== requestedSource.hash) {
    return;
  }
  const cache = pruneNotebookConclusionCache(
    await readNotebookConclusionCache(input.folderPath),
    input.notebooks
  );
  if (cache[requestedSource.key]?.hash === requestedSource.hash) {
    return;
  }

  let result = null;
  if (input.requestNotebookConclusion) {
    try {
      result = await input.requestNotebookConclusion(
        buildNotebookConclusionRequest(requestedSource)
      );
    } catch {
      result = null;
    }
  }

  const currentInput = latestProjectMemoryInputs.get(projectKey);
  const latestSnapshotSource = currentInput?.notebooks.find((source) => source.key === requestedSource.key);
  if (!currentInput || !latestSnapshotSource || latestSnapshotSource.hash !== requestedSource.hash) {
    return;
  }
  const { unverifiable, source: currentSource } = await readCurrentNotebookMemorySource(
    currentInput,
    requestedSource
  );
  const verified = Boolean(
    currentSource
    && currentSource.key === requestedSource.key
    && currentSource.hash === requestedSource.hash
  );
  if (!verified && !unverifiable) {
    // The saved page really did change under us. Drop the answer and let a later
    // sync generate against the new content.
    return;
  }

  // Unverifiable falls through to the verbatim extract below: still never publish
  // a conclusion we could not confirm against the saved page, but do record that
  // we are done asking, or this repeats on every save forever.
  const validated = verified ? validateNotebookConclusionResult(result, currentSource) : null;
  // Only the read-modify-write needs the file queue; the model call above must
  // stay outside it or every save queues behind the whole batch.
  await enqueueProjectMemoryWork(projectKey, async () => {
    const nextCache = pruneNotebookConclusionCache(
      await readNotebookConclusionCache(currentInput.folderPath),
      currentInput.notebooks
    );
    nextCache[requestedSource.key] = validated
      ? {
          hash: requestedSource.hash,
          conclusion: validated.conclusion,
          generatedAt: new Date().toISOString(),
          model: validated.model || 'generated'
        }
      : buildFallbackCacheEntry(requestedSource);
    await writeNotebookConclusionCache(currentInput.folderPath, nextCache);
  });
}

// The returned promise rejects on failure; the queued one never does, or one bad
// job would take the rest of the chain down with it.
function enqueueSerialWork(queues, projectKey, work) {
  const previous = queues.get(projectKey) || Promise.resolve();
  const result = previous.then(work);
  const tracked = result.catch(() => {}).finally(() => {
    if (queues.get(projectKey) === tracked) {
      queues.delete(projectKey);
    }
  });
  queues.set(projectKey, tracked);
  return result;
}

// Two queues, because they have very different durations. Anything that
// read-modify-writes MEMORY.md or the conclusion cache goes here: short file
// work only, so a sync is never held up for long.
function enqueueProjectMemoryWork(projectKey, work) {
  return enqueueSerialWork(projectMemoryQueues, projectKey, work);
}

// Model calls go here instead. They still run one batch at a time per project,
// but a save only ever waits on the commit above, never on a generation. Only
// this direction is allowed: a generation may await the file queue, never the
// reverse, so the two can not deadlock.
function enqueueProjectGenerationWork(projectKey, work) {
  return enqueueSerialWork(projectGenerationQueues, projectKey, work);
}

async function waitForProjectMemoryQueue(projectKeyOrFolderPath) {
  const projectKey = path.resolve(String(projectKeyOrFolderPath || ''));
  // Generations first: a batch ends by queueing a render, so draining the file
  // queue alone can return before that render has even been queued.
  while (projectGenerationQueues.has(projectKey) || projectMemoryQueues.has(projectKey)) {
    await projectGenerationQueues.get(projectKey);
    await projectMemoryQueues.get(projectKey);
  }
}

async function writeProjectMemoryFile({
  storageRootPath,
  folderPath,
  snapshot,
  projectRecord,
  requestNotebookConclusion
} = {}) {
  const filePath = path.join(folderPath, MEMORY_FILE_NAME);
  const input = buildProjectMemoryInput({
    storageRootPath,
    folderPath,
    filePath,
    snapshot,
    projectRecord,
    requestNotebookConclusion
  });
  latestProjectMemoryInputs.set(input.projectKey, input);
  const rendered = await enqueueProjectMemoryWork(input.projectKey, () => (
    renderProjectMemoryInput(input, { writePrunedCache: true })
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
