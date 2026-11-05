'use strict';

const { randomUUID } = require('node:crypto');

// Lives in the app process. The delegated MCP snapshot carries only the ID;
// downloaded paths and metadata come from actual tool results, never model JSON.
const sessions = new Map();

function createLiteratureResearchSession(input) {
  const session = { id: randomUUID(), input, searches: [], downloads: [] };
  sessions.set(session.id, session);
  return session;
}

function getLiteratureResearchSession(snapshot = {}) {
  return sessions.get(snapshot?.literature_research?.id) || null;
}

function closeLiteratureResearchSession(session) {
  sessions.delete(session.id);
}

function recordLiteratureResearchDownload(snapshot, args, result) {
  const session = getLiteratureResearchSession(snapshot);
  if (!session) return;
  const metadata = result.knowledge_database || {};
  // A job that finished between polls returns under a new id or as a reused
  // file, so a running entry also matches by paper.
  const samePaper = (paper) => paper.status === 'running' && (args.doi
    ? String(paper.doi).toLowerCase() === String(args.doi).toLowerCase()
    : Boolean(args.paper_title) && paper.paper_title === args.paper_title);
  const existingIndex = session.downloads.findIndex((paper) => samePaper(paper)
    || (result.download_id && paper.download_id === result.download_id));
  if (existingIndex < 0 && result.ok && result.knowledge_markdown_path && session.downloads.some((paper) =>
    paper.ok && paper.knowledge_markdown_path === result.knowledge_markdown_path)) return;
  const entry = {
    ...result,
    paper_id: result.knowledge_paper_id || metadata.paper_id
      || session.downloads[existingIndex]?.paper_id || `research-paper-${session.downloads.length + 1}`,
    paper_title: args.paper_title || metadata.title || result.file_name || '',
    doi: args.doi || metadata.doi || '',
    url: args.page_url || args.paper_pdf_url || '',
    pdf_urls: args.candidate_urls || []
  };
  if (existingIndex >= 0) session.downloads[existingIndex] = entry;
  else session.downloads.push(entry);
}

module.exports = {
  createLiteratureResearchSession,
  getLiteratureResearchSession,
  closeLiteratureResearchSession,
  recordLiteratureResearchDownload
};
