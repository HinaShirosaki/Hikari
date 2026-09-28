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
  runStatement
} = require('../paper-knowledge-store.js');
const { readPaperMetadata, writePaperMetadata } = require('../knowledge-index-schema.js');
const {
  DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT,
  asArrayDefault,
  buildMarkdownRewritePrompt,
  extractLlmText,
  normalizeMarkdown
} = require('./helpers.js');

// Turns extracted PDF text into Markdown and indexes identity and file locations.
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

  async function upsertKnowledgeIndex({ paths, metadata, meta, filePath, paperId, nowIso }) {
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
      const previous = {
        ...await readPaperMetadata(paths.storage_path, existing || {}),
        ...await readPaperMetadata(paths.storage_path, { wiki_path: wikiPath })
      };
      const nextMetadata = {
        ...previous,
        ...metadata,
        ...meta,
        paper_id: resolvedPaperId,
        doi: metadata.doi || existing?.doi || '',
        pmid: metadata.pmid || existing?.pmid || '',
        pmcid: metadata.pmcid || existing?.pmcid || '',
        added_at: previous.added_at || nowIso,
        locations: [...asArrayDefault(previous.locations).filter((entry) => entry.id !== location.id), location]
      };
      // An import may only supply identity. Keep descriptive metadata already
      // saved in JSON, including values rescued from a legacy SQLite row.
      for (const key of ['abstract', 'authors', 'journal', 'year', 'url', 'notes']) {
        if (!nextMetadata[key] || (Array.isArray(nextMetadata[key]) && !nextMetadata[key].length)) {
          nextMetadata[key] = previous[key] ?? nextMetadata[key];
        }
      }
      await writePaperMetadata(paths.meta_path, nextMetadata);
      runStatement(db, `
        INSERT INTO papers (id, doi, pmid, pmcid, title, pdf_sha256, wiki_path)
        VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), ?)
        ON CONFLICT(id) DO UPDATE SET
          doi = COALESCE(excluded.doi, papers.doi),
          pmid = COALESCE(excluded.pmid, papers.pmid),
          pmcid = COALESCE(excluded.pmcid, papers.pmcid),
          title = excluded.title,
          pdf_sha256 = COALESCE(excluded.pdf_sha256, papers.pdf_sha256),
          wiki_path = excluded.wiki_path
      `, [resolvedPaperId, metadata.doi, metadata.pmid, metadata.pmcid,
        metadata.title, metadata.pdf_sha256, wikiPath]);
      runStatement(db, `
        INSERT INTO paper_locations (id, paper_id, scope, container, pdf_path)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          paper_id = excluded.paper_id, scope = excluded.scope,
          container = excluded.container, pdf_path = excluded.pdf_path
      `, [location.id, location.paper_id, location.scope, location.container, location.pdf_path]);
      await persistKnowledgeDatabase(paths.sqlite_path, db);
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
