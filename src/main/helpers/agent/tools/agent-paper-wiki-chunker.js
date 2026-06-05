'use strict';

const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const {
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  openKnowledgeDatabase,
  persistKnowledgeDatabase,
  queryRows,
  runStatement
} = require('./agent-paper-knowledge-database.js');

const SECTION_HEADING_REGEX = /^##\s+(.+?)\s*$/;
const PAGE_CITATION_REGEX = /\(pp?\.\s*(\d+)(?:\s*[-–]\s*(\d+))?\)/g;
const MAX_BODY_CHARS = 12000;

function applyWikiChunkSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS paper_chunks (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      section_index INTEGER NOT NULL,
      section_heading TEXT,
      body TEXT,
      page_start INTEGER,
      page_end INTEGER,
      char_length INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper ON paper_chunks(paper_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS paper_chunks_fts USING fts5(
      body,
      section_heading,
      paper_id UNINDEXED,
      chunk_id UNINDEXED,
      tokenize = 'porter unicode61'
    );
  `);
}

function splitSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let current = { heading: '', lines: [] };
  for (const line of lines) {
    const match = line.match(SECTION_HEADING_REGEX);
    if (match) {
      if (current.heading || current.lines.some((value) => value.trim())) {
        sections.push(current);
      }
      current = { heading: match[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.heading || current.lines.some((value) => value.trim())) {
    sections.push(current);
  }
  return sections
    .map((section, index) => {
      const body = section.lines.join('\n').trim();
      return {
        index,
        heading: section.heading || (index === 0 ? 'Preamble' : `Section ${index + 1}`),
        body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body
      };
    })
    .filter((section) => section.body.length > 0);
}

function extractPageRange(body) {
  const text = String(body || '');
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let match;
  PAGE_CITATION_REGEX.lastIndex = 0;
  while ((match = PAGE_CITATION_REGEX.exec(text)) !== null) {
    const low = Number.parseInt(match[1], 10);
    const high = match[2] ? Number.parseInt(match[2], 10) : low;
    if (Number.isFinite(low)) {
      start = Math.min(start, low);
    }
    if (Number.isFinite(high)) {
      end = Math.max(end, high);
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { pageStart: null, pageEnd: null };
  }
  return { pageStart: start, pageEnd: end };
}

function buildChunkId(paperId, sectionIndex, heading) {
  return crypto.createHash('sha256')
    .update(`${paperId}::${sectionIndex}::${heading}`)
    .digest('hex')
    .slice(0, 24);
}

function deletePaperChunks(db, paperId) {
  runStatement(db, 'DELETE FROM paper_chunks_fts WHERE paper_id = ?', [paperId]);
  runStatement(db, 'DELETE FROM paper_chunks WHERE paper_id = ?', [paperId]);
}

function insertChunk(db, paperId, section, nowIso) {
  const chunkId = buildChunkId(paperId, section.index, section.heading);
  const { pageStart, pageEnd } = extractPageRange(section.body);
  runStatement(db, `
    INSERT INTO paper_chunks (
      id, paper_id, section_index, section_heading, body,
      page_start, page_end, char_length, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    chunkId,
    paperId,
    section.index,
    section.heading,
    section.body,
    pageStart,
    pageEnd,
    section.body.length,
    nowIso,
    nowIso
  ]);
  runStatement(db, `
    INSERT INTO paper_chunks_fts (body, section_heading, paper_id, chunk_id)
    VALUES (?, ?, ?, ?)
  `, [section.body, section.heading, paperId, chunkId]);
  return chunkId;
}

async function readMarkdown(filePath) {
  try {
    return await fsPromises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function resolveWikiPath(storagePath, paperRow) {
  const wikiPath = String(paperRow?.wiki_path || '').trim();
  if (!wikiPath) {
    return '';
  }
  if (path.isAbsolute(wikiPath)) {
    return wikiPath;
  }
  return path.join(storagePath, wikiPath);
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
      return primary;
    }
  }
}

function createPaperWikiChunkerRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  async function chunkPaperMarkdown({ storage_path: storagePath, paper_id: paperId } = {}) {
    const resolvedStoragePath = String(storagePath || '').trim();
    const resolvedPaperId = String(paperId || '').trim();
    if (!resolvedStoragePath || !resolvedPaperId) {
      return { ok: false, error: 'storage_path and paper_id are required.' };
    }
    const paths = await pickIndexPaths(resolvedStoragePath);
    const db = await openKnowledgeDatabase(paths.sqlite_path);
    try {
      applyWikiChunkSchema(db);
      const rows = queryRows(db, 'SELECT id, wiki_path, wiki_status FROM papers WHERE id = ? LIMIT 1', [resolvedPaperId]);
      const paperRow = rows[0];
      if (!paperRow) {
        return { ok: false, error: `Paper ${resolvedPaperId} not found in index.` };
      }
      const wikiFilePath = resolveWikiPath(resolvedStoragePath, paperRow);
      if (!wikiFilePath) {
        return { ok: false, error: `Paper ${resolvedPaperId} has no wiki_path.` };
      }
      const markdown = await readMarkdown(wikiFilePath);
      if (!markdown) {
        return { ok: false, error: `Could not read wiki at ${wikiFilePath}.` };
      }
      const sections = splitSections(markdown);
      const nowIso = now();
      deletePaperChunks(db, resolvedPaperId);
      const chunkIds = sections.map((section) => insertChunk(db, resolvedPaperId, section, nowIso));
      await persistKnowledgeDatabase(paths.sqlite_path, db);
      return {
        ok: true,
        paper_id: resolvedPaperId,
        chunk_count: chunkIds.length,
        chunk_ids: chunkIds
      };
    } finally {
      db.close();
    }
  }

  async function chunkAllPapers({ storage_path: storagePath, only_missing: onlyMissing = false } = {}) {
    const resolvedStoragePath = String(storagePath || '').trim();
    if (!resolvedStoragePath) {
      return { ok: false, error: 'storage_path is required.' };
    }
    const paths = await pickIndexPaths(resolvedStoragePath);
    const db = await openKnowledgeDatabase(paths.sqlite_path);
    try {
      applyWikiChunkSchema(db);
      const papers = queryRows(db, `
        SELECT id, wiki_path, wiki_status FROM papers
        WHERE wiki_status = 'ready' AND wiki_path IS NOT NULL AND wiki_path <> ''
      `);
      const nowIso = now();
      const results = [];
      for (const paperRow of papers) {
        if (onlyMissing) {
          const existing = queryRows(db, 'SELECT 1 FROM paper_chunks WHERE paper_id = ? LIMIT 1', [paperRow.id]);
          if (existing.length) {
            continue;
          }
        }
        const wikiFilePath = resolveWikiPath(resolvedStoragePath, paperRow);
        const markdown = await readMarkdown(wikiFilePath);
        if (!markdown) {
          results.push({ paper_id: paperRow.id, ok: false, error: 'wiki file missing' });
          continue;
        }
        const sections = splitSections(markdown);
        deletePaperChunks(db, paperRow.id);
        sections.forEach((section) => insertChunk(db, paperRow.id, section, nowIso));
        results.push({ paper_id: paperRow.id, ok: true, chunk_count: sections.length });
      }
      await persistKnowledgeDatabase(paths.sqlite_path, db);
      return {
        ok: true,
        total: results.length,
        succeeded: results.filter((entry) => entry.ok).length,
        results
      };
    } finally {
      db.close();
    }
  }

  return {
    chunkPaperMarkdown,
    chunkAllPapers,
    splitSections,
    extractPageRange,
    applyWikiChunkSchema
  };
}

module.exports = {
  createPaperWikiChunkerRuntime,
  applyWikiChunkSchema,
  splitSections,
  extractPageRange
};
