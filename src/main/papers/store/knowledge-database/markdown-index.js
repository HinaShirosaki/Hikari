'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { ensureObject } = require('../../../lib/normalize.js');
const { buildPdfMarkdownFromExtraction } = require('../../parse/pdf-to-md.js');
const { buildRelativePath, getPaperScope } = require('../paper-knowledge-paths.js');
const {
  buildPaperId,
  findExistingPaperRow,
  persistKnowledgeDatabase,
  withKnowledgeDatabaseWrite,
  runStatement,
  updateJsonIndex
} = require('../paper-knowledge-store.js');
const {
  DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT,
  asArrayDefault,
  buildMarkdownRewritePrompt,
  extractLlmText,
  normalizeMarkdown
} = require('./helpers.js');

// Turns extracted PDF text into knowledge markdown and writes the SQLite +
// JSON index rows that point at it.
function createKnowledgeMarkdownIndex({
  cleanText,
  requestAssistantText,
  now
} = {}) {
  async function generateKnowledgeMarkdown(input = {}) {
    const source = ensureObject(input);
    const metadata = ensureObject(source.metadata);
    const extraction = ensureObject(source.extraction);
    const extractedText = String(source.extractedText || '');
    if (source.use_llm_rewrite === false || source.useLlmRewrite === false) {
      return {
        ok: true,
        status: 'ready',
        method: 'pdf-to-md',
        markdown: buildPdfMarkdownFromExtraction({
          metadata,
          extraction,
          extractedText,
          figures: asArrayDefault(source.figures),
          sourcePdfPath: source.file_path || source.filePath || source.path || '',
          sourcePdfRelativePath: source.source_pdf_relative_path || source.sourcePdfRelativePath || '',
          transformedAt: now(),
          includePages: false
        })
      };
    }
    const figures = asArrayDefault(source.figures);
    const prompt = buildMarkdownRewritePrompt({
      metadata,
      extraction,
      extractedText,
      figures,
      maxPromptChars: Number(source.maxPromptChars) || DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT
    });

    const llmResult = await requestAssistantText({
      source: ensureObject(source.llmSource || source.source),
      provider: cleanText(source.provider, 80),
      endpoint: cleanText(source.endpoint, 2000),
      apiKey: cleanText(source.apiKey, 400),
      model: cleanText(source.model, 120),
      stage: 'paper_knowledge_wiki_rewrite',
      systemPrompt: [
        'You create LLM-facing scientific-paper knowledge notes.',
        'Return Markdown only. Stay faithful to the supplied extracted text.'
      ].join(' '),
      userPrompt: prompt,
      traceContext: source.traceContext || null,
      defaultError: 'Paper knowledge rewrite provider is not configured.'
    }).catch((error) => ({
      ok: false,
      error: cleanText(error?.message || error, 1200)
    }));

    const markdown = normalizeMarkdown(extractLlmText(llmResult));
    if (llmResult?.ok === true && markdown) {
      return {
        ok: true,
        status: 'ready',
        method: 'llm',
        markdown
      };
    }

    if (source.allowFallbackMarkdown === false) {
      return {
        ok: false,
        status: 'failed',
        method: 'llm',
        error: cleanText(llmResult?.error, 1200) || 'Paper knowledge rewrite failed.'
      };
    }

    return {
      ok: true,
      status: 'ready',
      method: 'pdf-to-md-fallback',
      markdown: buildPdfMarkdownFromExtraction({
        metadata,
        extraction,
        extractedText,
        figures,
        sourcePdfPath: source.file_path || source.filePath || source.path || '',
        sourcePdfRelativePath: source.source_pdf_relative_path || source.sourcePdfRelativePath || '',
        transformedAt: now(),
        includePages: false
      }),
      warning: cleanText(llmResult?.error, 1200)
    };
  }

  async function upsertKnowledgeIndex({ paths, metadata, filePath, paperId, extractionStatus, wikiStatus, nowIso }) {
    return withKnowledgeDatabaseWrite(paths.sqlite_path, async (db) => {
      const existing = findExistingPaperRow(db, {
        doi: metadata.doi,
        pmid: metadata.pmid,
        pmcid: metadata.pmcid,
        pdfSha256: metadata.pdf_sha256,
        title: metadata.title
      });
      const resolvedPaperId = paperId || buildPaperId({
        existing,
        doi: metadata.doi,
        pdfSha256: metadata.pdf_sha256,
        title: metadata.title
      });
      const previousAddedAt = cleanText(existing?.added_at, 80) || nowIso;
      const wikiPath = buildRelativePath(paths.storage_path, paths.markdown_path);
      const folderPath = buildRelativePath(paths.storage_path, path.dirname(filePath));
      const pdfPath = buildRelativePath(paths.storage_path, filePath);
      const locationId = crypto.createHash('sha256')
        .update(`${resolvedPaperId}:${pdfPath}`)
        .digest('hex')
        .slice(0, 24);
      const location = {
        id: `location-${locationId}`,
        paper_id: resolvedPaperId,
        scope: getPaperScope(metadata.linked_type),
        container: metadata.linked_name || '',
        folder_path: folderPath,
        pdf_filename: path.basename(filePath),
        pdf_path: pdfPath,
        discovered_at: nowIso
      };
      runStatement(db, `
        INSERT INTO papers (
          id, doi, pmid, pmcid, title, abstract, authors_json, journal, year, url, pdf_sha256,
          added_at, updated_at, source, wiki_status, wiki_path, extraction_status, notes
        ) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          doi = COALESCE(excluded.doi, papers.doi),
          pmid = COALESCE(excluded.pmid, papers.pmid),
          pmcid = COALESCE(excluded.pmcid, papers.pmcid),
          title = excluded.title,
          abstract = excluded.abstract,
          authors_json = excluded.authors_json,
          journal = excluded.journal,
          year = excluded.year,
          url = excluded.url,
          pdf_sha256 = COALESCE(excluded.pdf_sha256, papers.pdf_sha256),
          updated_at = excluded.updated_at,
          source = excluded.source,
          wiki_status = excluded.wiki_status,
          wiki_path = excluded.wiki_path,
          extraction_status = excluded.extraction_status,
          notes = excluded.notes
      `, [
        resolvedPaperId,
        metadata.doi,
        metadata.pmid,
        metadata.pmcid,
        metadata.title,
        metadata.abstract,
        JSON.stringify(metadata.authors || []),
        metadata.journal,
        metadata.year,
        metadata.url,
        metadata.pdf_sha256,
        previousAddedAt,
        nowIso,
        metadata.source,
        wikiStatus,
        wikiPath,
        extractionStatus,
        metadata.notes
      ]);
      runStatement(db, `
        INSERT INTO paper_locations (
          id, paper_id, scope, container, folder_path, pdf_filename, pdf_path, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          paper_id = excluded.paper_id,
          scope = excluded.scope,
          container = excluded.container,
          folder_path = excluded.folder_path,
          pdf_filename = excluded.pdf_filename,
          pdf_path = excluded.pdf_path,
          discovered_at = excluded.discovered_at
      `, [
        location.id,
        location.paper_id,
        location.scope,
        location.container,
        location.folder_path,
        location.pdf_filename,
        location.pdf_path,
        location.discovered_at
      ]);
      await persistKnowledgeDatabase(paths.sqlite_path, db);
      await updateJsonIndex(paths.json_index_path, {
        id: resolvedPaperId,
        doi: metadata.doi,
        title: metadata.title,
        pdf_sha256: metadata.pdf_sha256,
        wiki_status: wikiStatus,
        wiki_path: wikiPath,
        extraction_status: extractionStatus,
        updated_at: nowIso
      }, location);
      return {
        paper_id: resolvedPaperId,
        wiki_path: wikiPath,
        location
      };
    });
  }

  return {
    generateKnowledgeMarkdown,
    upsertKnowledgeIndex
  };
}

module.exports = { createKnowledgeMarkdownIndex };
