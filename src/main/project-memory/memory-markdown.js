'use strict';

const fs = require('node:fs/promises');
const { asArray, ensureObject } = require('../lib/normalize.js');
const { PROJECT_MEMORY_AUTO_END, PROJECT_MEMORY_AUTO_START, PROJECT_MEMORY_MAX_BYTES } = require('./constants.js');
const { formatField, formatTimestamp, truncateInline } = require('./text-utils.js');

// One line per record, in both sections. MEMORY.md is an index the agent reads
// in full on every project run, not a store: it says what exists and what it
// concluded, and paper_intake_* / notebook_lookup fetch the rest on demand.
//
// A notebook line carries its first quote because quote membership proves the
// excerpt, never the interpretation: "Treatment improved growth." passes the
// gate on the quote "no improvement". Printing the evidence beside the sentence
// is what keeps an inverted summary visible to whoever reads the line.
function memoryLine(title, sentence, fallbackTitle, quotes = []) {
  const evidence = asArray(quotes).map((quote) => String(quote || '').trim()).find(Boolean);
  return [
    `- ${truncateInline(title || fallbackTitle, 320)}; ${truncateInline(sentence, 800)}`,
    evidence ? ` ("${truncateInline(evidence, 240)}")` : ''
  ].join('');
}

function byteLength(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

// Newest first, so the cap below cuts the oldest tail rather than the alphabet.
// An undated record sorts last: it is the least defensible thing to keep.
function byRecencyThenTitle(left, right) {
  const leftMs = Date.parse(left.updatedAt) || 0;
  const rightMs = Date.parse(right.updatedAt) || 0;
  return rightMs - leftMs
    || String(left.title || '').localeCompare(String(right.title || ''));
}

// Papers and experiments compete for one budget, newest first across both, so
// a project with hundreds of papers cannot starve its recent bench work out of
// the index. Stop at the first line that does not fit rather than packing
// smaller older ones in after it: what survives is then always "everything
// since <date>", which is a statement the agent can reason about.
function selectWithinBudget(candidates, budget) {
  const kept = new Set();
  let used = 0;
  for (const candidate of candidates) {
    const cost = byteLength(candidate.line) + 1;
    if (used + cost > budget) {
      break;
    }
    used += cost;
    kept.add(candidate);
  }
  return kept;
}

function omissionLine(count, noun, tool) {
  return `- ${count} older ${noun} omitted from this index; retrieve them with ${tool}.`;
}

function buildProjectMemoryGeneratedBlock(projectRecord = {}, {
  paperEntries = [],
  notebookEntries = [],
  noteEntries = [],
  byteBudget = PROJECT_MEMORY_MAX_BYTES
} = {}) {
  const record = ensureObject(projectRecord);
  const papers = asArray(paperEntries).slice().sort(byRecencyThenTitle);
  const notebooks = asArray(notebookEntries).slice().sort(byRecencyThenTitle);
  const notes = asArray(noteEntries).slice().sort(byRecencyThenTitle);
  const header = [
    '# Project Memory',
    '',
    `Name: ${formatField(record.displayName, 'Untitled Project')}`,
    `Description: ${formatField(record.description)}`,
    `Created: ${formatTimestamp(record.createdAt)}`,
    `Updated: ${formatTimestamp(record.updatedAt)}`,
    '',
    '## Papers',
    '',
    '## Experiments',
    '',
    '## Agent Notes',
    ''
  ];
  // Reserve both omission lines whether or not they are used: over-reserving a
  // couple of hundred bytes is cheaper than a block that lands one line over.
  const reserved = byteLength(header.join('\n'))
    + byteLength(omissionLine(papers.length, 'papers', 'paper_intake_list_project_summaries'))
    + byteLength(omissionLine(notebooks.length, 'experiments', 'notebook_lookup'))
    + 2;
  // The agent wrote these on purpose, so they are reserved before papers and
  // experiments compete for what is left. Dropping a note to fit one more paper
  // would defeat the point of giving the agent somewhere to keep them.
  const noteLines = notes.map((note) => memoryLine(note.title, note.summary, note.id));
  const notesBytes = noteLines.reduce((total, line) => total + byteLength(line) + 1, 0);
  const candidates = [
    ...papers.map((paper) => ({
      kind: 'paper',
      updatedAt: paper.updatedAt,
      title: paper.title,
      line: memoryLine(paper.title, paper.summary, paper.paperId)
    })),
    ...notebooks.map((entry) => ({
      kind: 'notebook',
      updatedAt: entry.updatedAt,
      title: entry.title,
      line: memoryLine(entry.title, entry.conclusion, entry.id, entry.quotes)
    }))
  ].sort(byRecencyThenTitle);
  const kept = selectWithinBudget(candidates, Math.max(0, byteBudget - reserved - notesBytes));

  function sectionLines(kind, noun, tool) {
    const all = candidates.filter((candidate) => candidate.kind === kind);
    if (!all.length) {
      return ['- None recorded.'];
    }
    const survivors = all.filter((candidate) => kept.has(candidate));
    const omitted = all.length - survivors.length;
    return [
      ...survivors.map((candidate) => candidate.line),
      ...(omitted ? [omissionLine(omitted, noun, tool)] : [])
    ];
  }

  const paperLines = sectionLines('paper', 'papers', 'paper_intake_list_project_summaries');
  const notebookLines = sectionLines('notebook', 'experiments', 'notebook_lookup');

  return [
    '# Project Memory',
    '',
    `Name: ${formatField(record.displayName, 'Untitled Project')}`,
    `Description: ${formatField(record.description)}`,
    `Created: ${formatTimestamp(record.createdAt)}`,
    `Updated: ${formatTimestamp(record.updatedAt)}`,
    '',
    '## Papers',
    ...paperLines,
    '',
    '## Experiments',
    ...notebookLines,
    '',
    '## Agent Notes',
    ...(noteLines.length ? noteLines : ['- None recorded.']),
    ''
  ].join('\n').trim();
}

// Record content reaches this file verbatim, and a notebook result is free to
// contain anything — including a pasted copy of a MEMORY.md. An end marker
// inside the block makes the next merge splice at the injected one, orphan the
// real marker, and append a fresh block on every save until the file is
// garbage, so the markers are neutered here, where every field funnels through.
function stripAutoMarkers(value) {
  return String(value == null ? '' : value)
    .split(PROJECT_MEMORY_AUTO_START).join('[hikari:auto]')
    .split(PROJECT_MEMORY_AUTO_END).join('[/hikari:auto]');
}

function wrapProjectMemoryGeneratedBlock(generatedBlock) {
  return [
    PROJECT_MEMORY_AUTO_START,
    stripAutoMarkers(generatedBlock).trim(),
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

// Codex reads the whole file, hand-written notes included, so the generated
// block only gets what those notes leave behind.
function projectMemoryByteBudget(existingMarkdown) {
  const existing = String(existingMarkdown || '');
  const start = existing.indexOf(PROJECT_MEMORY_AUTO_START);
  const endStart = start >= 0 ? existing.indexOf(PROJECT_MEMORY_AUTO_END, start) : -1;
  const generatedBytes = start >= 0 && endStart >= 0
    ? byteLength(existing.slice(start, endStart + PROJECT_MEMORY_AUTO_END.length))
    : 0;
  const manualBytes = Math.max(0, byteLength(existing) - generatedBytes);
  return Math.max(0, PROJECT_MEMORY_MAX_BYTES - manualBytes - byteLength(PROJECT_MEMORY_AUTO_START + PROJECT_MEMORY_AUTO_END) - 2);
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
  projectMemoryByteBudget,
  buildProjectMemoryMarkdown,
  mergeProjectMemoryMarkdown,
  readExistingText
};
