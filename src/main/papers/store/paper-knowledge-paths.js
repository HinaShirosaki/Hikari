'use strict';

/**
 * Path, slug, and identifier helpers for the paper knowledge database.
 *
 * Pure functions only — no filesystem or SQLite access. Split out of
 * `agent-paper-knowledge-database.js` so the folder layout / slug rules have a
 * single home that the store, the ingest runtime, and the wiki chunker/search
 * can all share without reaching into the runtime module.
 *
 * NOTE: normalizeDoi here intentionally does NOT lowercase. Slugs and paper ids
 * are derived from it, so changing the casing would change folder names and
 * break lookups for already-ingested papers. (The case-insensitive identity in
 * shared/paper-identity.js is a separate concern used for dedup matching.)
 */

const path = require('node:path');
const { ensurePathWithinRoot } = require('../../lib/path-safety.js');

const KNOWLEDGE_BASE_FOLDER_NAME = 'KnowledgeBase';
const KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME = 'papers.md';
const LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME = 'KnowledgeDatabase';
const LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME = 'PaperKnowledge';
const KNOWLEDGE_DATABASE_FOLDER_NAME = KNOWLEDGE_BASE_FOLDER_NAME;
const KNOWLEDGE_PAPERS_FOLDER_NAME = KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME;
const KNOWLEDGE_INDEX_FILE_NAME = 'knowledge.index.sqlite';

function normalizeDoi(value) {
  return String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/\s+/g, '');
}

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

// A heading alone on its line. "References ... 245" in a table of contents has
// trailing text, so it will not match and will not truncate the document.
const REFERENCES_HEADING_PATTERN = /^[^\S\r\n]*(?:\d+[.)]?[^\S\r\n]*)?(?:references(?:[^\S\r\n]+and[^\S\r\n]+notes)?|bibliography|literature[^\S\r\n]+cited|works[^\S\r\n]+cited)[^\S\r\n]*:?[^\S\r\n]*$/im;

// Phrases that introduce the document's *own* DOI. Journals print these in back
// matter, after the reference list, so they are checked before the bibliography
// is trimmed away.
const SELF_REFERENCE_PATTERNS = [
  /(?:how[^\S\r\n]+to[^\S\r\n]+)?cite[^\S\r\n]+this[^\S\r\n]+(?:article|paper)/i,
  /(?:supplementary[^\S\r\n]+information|online[^\S\r\n]+version)[\s\S]{0,200}?available[^\S\r\n]+at/i
];

function matchDoi(value) {
  const match = String(value || '').match(DOI_PATTERN);
  return match?.[0] ? match[0].replace(/[),.;\]]+$/g, '') : '';
}

function extractSelfReferencedDoi(text) {
  for (const pattern of SELF_REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const start = match.index + match[0].length;
    const doi = matchDoi(text.slice(start, start + 400));
    if (doi) {
      return doi;
    }
  }
  return '';
}

// A paper's own DOI sits in the front matter or in a "cite this article" line.
// Every DOI under the references heading belongs to somebody else's paper, so
// taking the first match in the whole document files the record under a cited
// work - and silently, because a wrong DOI looks exactly like a right one.
// Finding nothing is the better answer: the caller falls back to a content hash.
function extractDoiFromText(value) {
  const text = String(value || '');

  const selfReferenced = extractSelfReferencedDoi(text);
  if (selfReferenced) {
    return normalizeDoi(selfReferenced);
  }

  const referencesHeading = text.match(REFERENCES_HEADING_PATTERN);
  const frontMatter = referencesHeading
    ? text.slice(0, referencesHeading.index)
    : text;
  return normalizeDoi(matchDoi(frontMatter));
}

function sanitizeStorageName(value, fallback = 'paper') {
  // Budget is bytes, not characters: a path component is capped at 255 bytes on
  // APFS/ext4/NTFS, so a CJK title at 180 *characters* would be 540 bytes.
  const cleaned = truncateUtf8(String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, ''), 180);
  return cleaned || fallback;
}

function truncateUtf8(value, maxBytes = 180) {
  const text = String(value || '');
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return text;
  }
  // Back off to a UTF-8 lead byte so a multi-byte character is never split in
  // half -- a lone surrogate encodes as U+FFFD on disk and stops matching the
  // in-memory path string that gets stored in meta.json and SQLite.
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xC0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString('utf8').replace(/_+$/g, '');
}

// PDF producers routinely leave template or export artifacts in the title field.
// These are useless as a paper name and, left unchecked, become the folder slug.
const JUNK_PDF_TITLE_PATTERNS = [
  /^untitled/i,
  /^microsoft\s+word/i,
  /^\s*(?:doc(?:ument)?|manuscript|paper|template|preprint|article|main)[\s_-]*\d*\s*$/i,
  /\.(?:docx?|pdf|rtf|tex|indd|qxd|pages)\s*$/i,
  /^[\d\s._-]+$/
];

function isLikelyJunkPdfTitle(value) {
  const text = String(value || '').trim();
  if (text.length < 8) {
    return true;
  }
  return JUNK_PDF_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function buildKnowledgeMarkdownFileName({ title = '' } = {}) {
  const normalizedTitle = String(title || '').trim().replace(/\.(?:pdf|md)$/i, '');
  const safeTitle = sanitizeStorageName(normalizedTitle, '');
  return safeTitle ? `${safeTitle}.md` : 'paper.md';
}

function normalizeYear(value) {
  const direct = String(value || '').trim();
  if (/^\d{4}$/.test(direct)) {
    return direct;
  }
  const match = direct.match(/\b(19|20)\d{2}\b/);
  return match?.[0] || '';
}

function buildKnowledgePaperSlug({ doi = '', title = '', pdfSha256 = '' } = {}) {
  const normalizedDoi = normalizeDoi(doi);
  if (normalizedDoi) {
    return sanitizeStorageName(normalizedDoi.replace(/\//g, '_'), 'paper');
  }
  const titleSlug = sanitizeStorageName(title, '');
  if (titleSlug) {
    return titleSlug;
  }
  return sanitizeStorageName(pdfSha256 ? `paper-${String(pdfSha256).slice(0, 16)}` : 'paper', 'paper');
}

function buildRelativePath(rootPath, targetPath) {
  return path.relative(path.resolve(rootPath), path.resolve(targetPath)).split(path.sep).join('/');
}

function resolveRelativeStoragePath(storagePath, maybeRelativePath) {
  const source = String(maybeRelativePath || '').trim();
  if (!source) {
    return '';
  }
  if (path.isAbsolute(source)) {
    return source;
  }
  return path.join(storagePath, source);
}

function resolveStoragePath(source, cleanText) {
  return cleanText(source.storage_path || source.storagePath, 4000);
}

function buildKnowledgeDatabasePaths({
  storagePath = '',
  doi = '',
  title = '',
  // The folder is identity and must stay stable; the file name is a label and
  // may follow a better title. Callers that have both pass them separately.
  markdownTitle = '',
  pdfSha256 = '',
  rootFolderName = KNOWLEDGE_BASE_FOLDER_NAME,
  papersFolderName = KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME
} = {}) {
  const resolvedStoragePath = path.resolve(storagePath);
  const rootPath = path.join(resolvedStoragePath, rootFolderName);
  const papersPath = path.join(rootPath, papersFolderName);
  const paperFolderName = buildKnowledgePaperSlug({ doi, title, pdfSha256 });
  const paperFolderPath = path.join(papersPath, paperFolderName);
  const markdownFileName = buildKnowledgeMarkdownFileName({ title: markdownTitle || title });
  return {
    storage_path: resolvedStoragePath,
    root_path: rootPath,
    papers_path: papersPath,
    paper_folder_name: paperFolderName,
    paper_folder_path: paperFolderPath,
    markdown_file_name: markdownFileName,
    markdown_path: path.join(paperFolderPath, markdownFileName),
    legacy_markdown_path: path.join(paperFolderPath, 'paper.md'),
    extracted_text_path: path.join(paperFolderPath, 'extracted.txt'),
    meta_path: path.join(paperFolderPath, 'meta.json'),
    figures_path: path.join(paperFolderPath, 'figures'),
    sqlite_path: path.join(rootPath, KNOWLEDGE_INDEX_FILE_NAME)
  };
}

function buildLegacyKnowledgeDatabasePaths({ storagePath = '', doi = '', title = '', pdfSha256 = '' } = {}) {
  return buildKnowledgeDatabasePaths({
    storagePath,
    doi,
    title,
    pdfSha256,
    rootFolderName: LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
    papersFolderName: LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME
  });
}

function getPaperScope(linkedType = '') {
  const normalized = String(linkedType || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'project') {
    return 'project';
  }
  if (normalized === 'journal-club' || normalized === 'literature-search') {
    return 'journal-club';
  }
  return normalized || 'global';
}

module.exports = {
  KNOWLEDGE_BASE_FOLDER_NAME,
  KNOWLEDGE_PAPER_MARKDOWN_FOLDER_NAME,
  LEGACY_KNOWLEDGE_DATABASE_FOLDER_NAME,
  LEGACY_KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_DATABASE_FOLDER_NAME,
  KNOWLEDGE_PAPERS_FOLDER_NAME,
  KNOWLEDGE_INDEX_FILE_NAME,
  normalizeDoi,
  extractDoiFromText,
  sanitizeStorageName,
  buildKnowledgeMarkdownFileName,
  isLikelyJunkPdfTitle,
  normalizeYear,
  buildKnowledgePaperSlug,
  ensurePathWithinRoot,
  buildRelativePath,
  resolveRelativeStoragePath,
  resolveStoragePath,
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  getPaperScope
};
