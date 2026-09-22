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
  if (result.ok && result.knowledge_markdown_path && session.downloads.some((paper) =>
    paper.ok && paper.knowledge_markdown_path === result.knowledge_markdown_path)) return;
  const entry = {
    ...result,
    paper_id: result.knowledge_paper_id || metadata.paper_id || `research-paper-${session.downloads.length + 1}`,
    paper_title: args.paper_title || metadata.title || result.file_name || '',
    doi: args.doi || metadata.doi || '',
    url: args.page_url || args.paper_pdf_url || '',
    pdf_urls: args.candidate_urls || []
  };
  const existingIndex = result.download_id
    ? session.downloads.findIndex((paper) => paper.download_id === result.download_id) : -1;
  if (existingIndex >= 0) session.downloads[existingIndex] = entry;
  else session.downloads.push(entry);
}

module.exports = {
  createLiteratureResearchSession,
  getLiteratureResearchSession,
  closeLiteratureResearchSession,
  recordLiteratureResearchDownload
};
