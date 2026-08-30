'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const {
  KNOWLEDGE_BASE_FOLDER_NAME,
  KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
  KNOWLEDGE_DATABASE_FOLDER_NAME,
  KNOWLEDGE_PAPERS_FOLDER_NAME,
  LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
  LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_INDEX_FILE_NAME,
  KNOWLEDGE_JSON_INDEX_FILE_NAME,
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  buildKnowledgePaperSlug,
  buildKnowledgeMarkdownFileName,
  normalizeDoi
} = require('./paper-knowledge-paths.js');
const {
  queryRows,
  runStatement,
  migratePaperColumns,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  findExistingPaperRow
} = require('./paper-knowledge-store.js');
const { createPaperIntakeSteps } = require('./knowledge-database/intake.js');
const { createKnowledgeMarkdownIndex } = require('./knowledge-database/markdown-index.js');
const { createPaperIngest } = require('./knowledge-database/ingest.js');
const { createPaperLookup } = require('./knowledge-database/lookup.js');

function createPaperKnowledgeDatabaseRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    requestAssistantText
  } = createAgentLlmRuntimeHelpers(deps);
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const pdfTextExtractionRuntime = deps.pdfTextExtractionRuntime && typeof deps.pdfTextExtractionRuntime === 'object'
    ? deps.pdfTextExtractionRuntime
    : null;
  const paperWikiChunkerRuntime = deps.paperWikiChunkerRuntime && typeof deps.paperWikiChunkerRuntime === 'object'
    ? deps.paperWikiChunkerRuntime
    : null;
  const injectedPaperIntakePipeline = deps.paperIntakePipeline
    && typeof deps.paperIntakePipeline.runIntakeForPaper === 'function'
    ? deps.paperIntakePipeline
    : null;

  const {
    runPaperIntake,
    reconcileFiguresDir,
    normalizeMetadata
  } = createPaperIntakeSteps({ asArray, cleanText, injectedPaperIntakePipeline, deps });

  const {
    generateKnowledgeMarkdown,
    upsertKnowledgeIndex
  } = createKnowledgeMarkdownIndex({ cleanText, requestAssistantText, now });

  const { ingestPaperPdf } = createPaperIngest({
    cleanText,
    now,
    pdfTextExtractionRuntime,
    paperWikiChunkerRuntime,
    runPaperIntake,
    reconcileFiguresDir,
    normalizeMetadata,
    generateKnowledgeMarkdown,
    upsertKnowledgeIndex
  });

  const { lookupPaper } = createPaperLookup({ cleanText });

  return {
    KNOWLEDGE_BASE_FOLDER_NAME,
    KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
    KNOWLEDGE_DATABASE_FOLDER_NAME,
    KNOWLEDGE_PAPERS_FOLDER_NAME,
    LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
    LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
    KNOWLEDGE_INDEX_FILE_NAME,
    KNOWLEDGE_JSON_INDEX_FILE_NAME,
    buildKnowledgeDatabasePaths,
    buildLegacyKnowledgeDatabasePaths,
    buildKnowledgePaperSlug,
    buildKnowledgeMarkdownFileName,
    generateKnowledgeMarkdown,
    ingestPaperPdf,
    lookupPaper
  };
}

// Path/slug helpers live in ./paper-knowledge-paths.js and the SQLite + index
// layer in ./paper-knowledge-store.js. They are re-exported here so existing
// importers (paper-markdown-import, tests) keep working against the original
// module surface. ponytail: re-export shim during the strangler split; point
// new code at the focused modules directly.
module.exports = {
  KNOWLEDGE_BASE_FOLDER_NAME,
  KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
  KNOWLEDGE_DATABASE_FOLDER_NAME,
  KNOWLEDGE_PAPERS_FOLDER_NAME,
  LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
  LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_INDEX_FILE_NAME,
  KNOWLEDGE_JSON_INDEX_FILE_NAME,
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  buildKnowledgePaperSlug,
  buildKnowledgeMarkdownFileName,
  normalizeDoi,
  createPaperKnowledgeDatabaseRuntime,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  migratePaperColumns,
  findExistingPaperRow,
  queryRows,
  runStatement
};
