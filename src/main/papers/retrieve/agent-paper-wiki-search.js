'use strict';

const fsPromises = require('node:fs/promises');
const { readSearchSections } = require('./wiki-search-markdown.js');

const {
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths
} = require('../store/paper-knowledge-paths.js');
const {
  openKnowledgeDatabase,
  queryRows
} = require('../store/paper-knowledge-store.js');
const { applyWikiChunkSchema } = require('./agent-paper-wiki-chunker.js');
const {
  MAX_QUERY_CHARS,
  tokenize,
  uniqueTerms,
  scoreRow,
  buildSnippet,
  buildPageCitation
} = require('./wiki-search-scoring.js');

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 8;

function clampLimit(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, numeric);
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

function buildPreFilter({ terms, paperId, scope, container }) {
  const filters = [];
  const params = [];
  // Match ANY term in body or heading. JS scoring decides ranking; this just narrows the candidate set.
  if (terms.length) {
    const termClauses = terms.map(() => '(body_lower LIKE ? OR lower(section_heading) LIKE ?)');
    filters.push(`(${termClauses.join(' OR ')})`);
    for (const term of terms) {
      const pattern = `%${term}%`;
      params.push(pattern, pattern);
    }
  }
  if (paperId) {
    filters.push('c.paper_id = ?');
    params.push(paperId);
  }
  if (scope) {
    filters.push(`c.paper_id IN (
      SELECT paper_id FROM paper_locations WHERE lower(scope) = lower(?)
      ${container ? 'AND lower(container) = lower(?)' : ''}
    )`);
    params.push(scope);
    if (container) {
      params.push(container);
    }
  }
  return { filters, params };
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
    const phrase = String(query || '').slice(0, MAX_QUERY_CHARS).trim().toLowerCase();
    const terms = uniqueTerms(tokenize(query));
    if (!terms.length) {
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
      const { filters, params } = buildPreFilter({
        terms,
        paperId: String(paperId || '').trim(),
        scope: String(scope || '').trim(),
        container: String(container || '').trim()
      });
      const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = queryRows(db, `
        SELECT
          c.id              AS chunk_id,
          c.paper_id        AS paper_id,
          c.section_index,
          c.section_heading,
          c.body,
          c.body_lower,
          c.page_start,
          c.page_end,
          c.char_length,
          p.title           AS paper_title,
          p.doi             AS paper_doi,
          p.year            AS paper_year,
          p.journal         AS paper_journal
        FROM paper_chunks c
        LEFT JOIN papers p ON p.id = c.paper_id
        ${whereClause}
      `, params);

      // Search the current source even when older chunks exist: historical
      // chunks may contain only the first 12,000 characters of a section.
      const paperFilter = buildPreFilter({
        terms: [],
        paperId: String(paperId || '').trim(),
        scope: String(scope || '').trim(),
        container: String(container || '').trim()
      });
      const papers = queryRows(db, `SELECT c.id AS paper_id, c.title AS paper_title,
        c.doi AS paper_doi, c.year AS paper_year, c.journal AS paper_journal, c.wiki_path
        FROM papers c ${paperFilter.filters.length ? `WHERE ${paperFilter.filters.join(' AND ').replaceAll('c.paper_id', 'c.id')}` : ''}`,
      paperFilter.params);
      const sourcePaperIds = new Set();
      const sourceErrors = [];
      const scored = [];
      function consider(row) {
        const score = scoreRow(row, terms, phrase);
        if (score <= 0) return;
        scored.push({ row, score });
        scored.sort((left, right) => right.score - left.score);
        if (scored.length > resolvedLimit) scored.pop();
      }
      for (const paper of papers) {
        const source = await readSearchSections(resolvedStoragePath, paper);
        if (source.ok) {
          sourcePaperIds.add(paper.paper_id);
          source.rows.forEach(consider);
        } else {
          sourceErrors.push({ paper_id: paper.paper_id, error: source.error });
        }
      }
      for (const row of rows) {
        if (!sourcePaperIds.has(row.paper_id)) consider(row);
      }

      const matches = scored.slice(0, resolvedLimit).map(({ row, score }) => ({
        chunk_id: String(row.chunk_id || ''),
        paper_id: String(row.paper_id || ''),
        title: String(row.paper_title || ''),
        doi: String(row.paper_doi || ''),
        year: String(row.paper_year || ''),
        journal: String(row.paper_journal || ''),
        section_heading: String(row.section_heading || ''),
        section_text: String(row.body || ''),
        snippet: buildSnippet(row.body, terms, phrase),
        page_citation: buildPageCitation(row),
        page_start: Number.isFinite(row.page_start) ? row.page_start : null,
        page_end: Number.isFinite(row.page_end) ? row.page_end : null,
        score: Number((score).toFixed(4))
      }));

      return {
        ok: true,
        query: String(query || ''),
        match_count: matches.length,
        source_errors: sourceErrors,
        partial: sourceErrors.length > 0,
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
  tokenize,
  scoreRow
};
