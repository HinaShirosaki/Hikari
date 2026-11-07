'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ensurePathWithinRoot } = require('../../lib/path-safety.js');
const { titleKey, normalizeDoi } = require('../identity/paper-identity.js');
const { readPaperMetadata } = require('../store/knowledge-index-schema.js');
const { createPaperReads } = require('../store/intake/store/paper-reads.js');
const { buildKnowledgeDatabasePaths, buildLegacyKnowledgeDatabasePaths } = require('../store/paper-knowledge-paths.js');
const { openKnowledgeDatabase, queryRows } = require('../store/paper-knowledge-store.js');

// Intake search identifies a paper by its folder; the thin knowledge index uses
// a canonical identity. Both references must resolve to the same saved Markdown.
async function loadLocalPaperReference({ storagePath = '', paperId = '', doi = '', title = '' } = {}) {
  if (!storagePath || !(paperId || doi || title)) return null;
  const root = path.resolve(storagePath);
  const id = String(paperId).trim();
  const folderId = id && !/[\\/\u0000-\u001f]/.test(id) && id !== '.' && id !== '..' ? id : '';
  const hasIntakeFolder = folderId && await fs.stat(path.join(root, 'KnowledgeBase/papers.md', folderId))
    .then(stat => stat.isDirectory(), () => false);
  const reads = createPaperReads({ workspacePath: root, fs, ensureReady: () => null });
  let row = null;
  for (const buildPaths of [buildKnowledgeDatabasePaths, buildLegacyKnowledgeDatabasePaths]) {
    let db;
    try {
      const sqlitePath = buildPaths({ storagePath: root }).sqlite_path;
      await fs.access(sqlitePath);
      db = await openKnowledgeDatabase(sqlitePath);
      const rows = queryRows(db, 'SELECT * FROM papers');
      row = (id && rows.find(paper => paper.id === id))
        || (doi && rows.find(paper => normalizeDoi(paper.doi) === normalizeDoi(doi)));
      if (!row && id) {
        row = rows.find(paper => path.posix.basename(path.posix.dirname(
          String(paper.wiki_path || '').replace(/\\/g, '/'))) === id);
      }
      // A concrete search-returned folder wins over a conflicting display title.
      if (!row && hasIntakeFolder) break;
      if (!row && title) {
        const exact = rows.filter(paper => String(paper.title).toLowerCase() === String(title).toLowerCase());
        const key = titleKey(title);
        const matches = exact.length ? exact : (key ? rows.filter(paper => titleKey(paper.title) === key) : []);
        // A title alone cannot choose between distinct saved identities.
        if (matches.length === 1) row = matches[0];
      }
      if (row) break;
    } catch {
      // Intake metadata can still resolve an already-saved folder without SQLite.
    } finally {
      db?.close();
    }
  }
  try {
    const relative = String(row?.wiki_path || '').replace(/\\/g, '/');
    const folder = relative.match(/^KnowledgeBase\/papers\.md\/([^/]+)\/[^/]+\.md$/i)?.[1]
      || (!row ? folderId : '');
    const metadata = row ? await readPaperMetadata(root, row) : (folder ? (await reads.readPaperMeta(folder)).meta || {} : {});
    let markdownPath = '';
    let content = '';
    if (folder) {
      const loaded = await reads.readPaperMarkdown(folder, metadata);
      if (loaded.ok) {
        markdownPath = loaded.paper_md_absolute_path;
        content = loaded.markdown;
      }
    } else if (relative) {
      // Keep legacy KnowledgeDatabase paths readable, within this workspace.
      markdownPath = ensurePathWithinRoot(root, path.resolve(root, relative));
      content = await fs.readFile(markdownPath, 'utf8');
    }
    if (!content.trim()) return null;
    return {
      id: row?.id || metadata.paper_id || folder,
      title: row?.title || metadata.title || title,
      abstract: metadata.abstract || row?.abstract || '',
      doi: row?.doi || metadata.doi || doi,
      markdown_path: markdownPath,
      markdown_relative_path: path.relative(root, markdownPath).split(path.sep).join('/'),
      content
    };
  } catch {
    return null;
  }
}

module.exports = { loadLocalPaperReference };
