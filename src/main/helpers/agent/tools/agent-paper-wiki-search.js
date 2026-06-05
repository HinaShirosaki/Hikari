'use strict';

const fsPromises = require('node:fs/promises');

const {
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  openKnowledgeDatabase,
  queryRows
} = require('./agent-paper-knowledge-database.js');
const { applyWikiChunkSchema } = require('./agent-paper-wiki-chunker.js');

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 8;
const MAX_QUERY_CHARS = 400;
const SNIPPET_RADIUS = 220;

function sanitizeFts5Query(rawQuery) {
  const tokens = String(rawQuery || '')
    .slice(0, MAX_QUERY_CHARS)
    .split(/[^A-Za-z0-9_\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (!tokens.length) {
    return '';
  }
  return tokens.map((token) => `"${token.replace(/"/g, '')}"`).join(' OR ');
}

function clampLimit(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, numeric);
}

function buildSnippet(body, query) {
  const text = String(body || '');
  if (!text) {
    return '';
  }
  const haystack = text.toLowerCase();
  const terms = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_\-]+/)
    .filter((token) => token.length >= 2);
  let bestIndex = -1;
  for (const term of terms) {
    const found = haystack.indexOf(term);
    if (found >= 0 && (bestIndex < 0 || found < bestIndex)) {
      bestIndex = found;
    }
  }
  if (bestIndex < 0) {
    return text.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, bestIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, bestIndex + SNIPPET_RADIUS);
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < text.length ? ' …' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

async function pickIndexPaths(storagePath) {
  const primary = buildKnowledgeDatabasePaths({ storagePath });
  try {
    await fsPromises.access(primary.sqlite_path);
    return primary;
  } catch {
    const legacy = buildLegacyKnowledgeDatabasePaths({ storagePath });
    try {
      await fsPromises.access(legacy.sqlite_path);
      return legacy;
    } catch {
      return null;
    }
  }
}

function buildPageCitation(row) {
  const start = Number.isFinite(row.page_start) ? row.page_start : null;
  const end = Number.isFinite(row.page_end) ? row.page_end : null;
  if (start == null && end == null) {
    return '';
  }
  if (start != null && end != null && start !== end) {
    return `pp. ${start}-${end}`;
  }
  return `p. ${start ?? end}`;
}

function createPaperWikiSearchRuntime() {
  async function searchWikiSections({
    storage_path: storagePath,
    query,
    limit,
    paper_id: paperId = '',
    scope = '',
    container = ''
  } = {}) {
    const resolvedStoragePath = String(storagePath || '').trim();
    if (!resolvedStoragePath) {
      return { ok: false, error: 'storage_path is required.' };
    }
    const ftsQuery = sanitizeFts5Query(query);
    if (!ftsQuery) {
      return { ok: false, error: 'query must contain at least one searchable term.' };
    }
    const paths = await pickIndexPaths(resolvedStoragePath);
    if (!paths) {
      return { ok: false, error: 'Knowledge index not found at storage path.' };
    }
    const db = await openKnowledgeDatabase(paths.sqlite_path);
    try {
      applyWikiChunkSchema(db);
      const resolvedLimit = clampLimit(limit);
      const filters = ['paper_chunks_fts MATCH ?'];
      const params = [ftsQuery];
      if (paperId) {
        filters.push('c.paper_id = ?');
        params.push(String(paperId).trim());
      }
      if (scope) {
        filters.push(`c.paper_id IN (
          SELECT paper_id FROM paper_locations WHERE lower(scope) = lower(?)
          ${container ? 'AND lower(container) = lower(?)' : ''}
        )`);
        params.push(String(scope).trim());
        if (container) {
          params.push(String(container).trim());
        }
      }
      const rows = queryRows(db, `
        SELECT
          c.id           AS chunk_id,
          c.paper_id     AS paper_id,
          c.section_heading,
          c.body,
          c.page_start,
          c.page_end,
          p.title        AS paper_title,
          p.doi          AS paper_doi,
          p.year         AS paper_year,
          p.journal      AS paper_journal,
          bm25(paper_chunks_fts) AS rank_score
        FROM paper_chunks_fts
        JOIN paper_chunks c ON c.id = paper_chunks_fts.chunk_id
        LEFT JOIN papers p ON p.id = c.paper_id
        WHERE ${filters.join(' AND ')}
        ORDER BY rank_score ASC
        LIMIT ?
      `, [...params, resolvedLimit]);

      const matches = rows.map((row) => ({
        chunk_id: String(row.chunk_id || ''),
        paper_id: String(row.paper_id || ''),
        title: String(row.paper_title || ''),
        doi: String(row.paper_doi || ''),
        year: String(row.paper_year || ''),
        journal: String(row.paper_journal || ''),
        section_heading: String(row.section_heading || ''),
        section_text: String(row.body || ''),
        snippet: buildSnippet(row.body, query),
        page_citation: buildPageCitation(row),
        page_start: Number.isFinite(row.page_start) ? row.page_start : null,
        page_end: Number.isFinite(row.page_end) ? row.page_end : null,
        rank_score: Number.isFinite(row.rank_score) ? row.rank_score : null
      }));

      return {
        ok: true,
        query: String(query || ''),
        match_count: matches.length,
        matches,
        summary: matches.length
          ? `Found ${matches.length} matching section${matches.length === 1 ? '' : 's'} across ${new Set(matches.map((m) => m.paper_id)).size} paper(s).`
          : 'No matching paper sections.'
      };
    } finally {
      db.close();
    }
  }

  return {
    searchWikiSections
  };
}

module.exports = {
  createPaperWikiSearchRuntime,
  sanitizeFts5Query
};
