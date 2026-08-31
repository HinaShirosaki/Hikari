'use strict';

const fs = require('node:fs/promises');
const { asArray, ensureObject } = require('../storage-utils');
const { PROJECT_MEMORY_AUTO_END, PROJECT_MEMORY_AUTO_START } = require('./constants.js');
const { formatField, formatTimestamp, humanizeStatus, truncateInline } = require('./text-utils.js');

function buildProjectMemoryGeneratedBlock(projectRecord = {}, {
  paperEntries = [],
  notebookEntries = []
} = {}) {
  const record = ensureObject(projectRecord);
  const papers = asArray(paperEntries);
  const notebooks = asArray(notebookEntries);
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
    ? notebooks.map((entry) => (
        `${truncateInline(entry.title || entry.id, 320)}; ${truncateInline(entry.conclusion, 800)}`
      ))
    : ['- None recorded.', ''];

  return [
    '# Project Memory',
    '',
    `Name: ${formatField(record.displayName, 'Untitled Project')}`,
    `Description: ${formatField(record.description)}`,
    `Created: ${formatTimestamp(record.createdAt)}`,
    `Updated: ${formatTimestamp(record.updatedAt)}`,
    '',
    '## Paper Conclusions',
    ...paperLines,
    '## Experimental Conclusions',
    ...notebookLines,
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

module.exports = {
  buildProjectMemoryGeneratedBlock,
  buildProjectMemoryMarkdown,
  mergeProjectMemoryMarkdown,
  readExistingText
};
