'use strict';

// Retain every page, replacing only a known proposal when a tool refines it.
function mergeNotebookDraftArtifacts(previous, incoming) {
  if (!incoming) return previous;
  // Background suggestions have their own batch and persistence contract.
  if (incoming.mcp_tool === 'notebook_suggest') return incoming;
  const notebooks = [];
  const positions = new Map();
  for (const artifact of [previous, incoming]) {
    if (!artifact || artifact.mcp_tool === 'notebook_suggest') continue;
    const drafts = Array.isArray(artifact.notebooks) ? artifact.notebooks : [artifact.notebook];
    for (const draft of drafts) {
      if (!draft?.entry_template) continue;
      const id = draft.proposal?.proposal_id || draft.entry_template.agentDraftMeta?.proposalId;
      if (id && positions.has(id)) notebooks[positions.get(id)] = draft;
      else {
        if (id) positions.set(id, notebooks.length);
        notebooks.push(draft);
      }
    }
  }
  if (!notebooks.length) return incoming;
  return { ...incoming, notebooks, notebook: notebooks[0],
    summary: notebooks.length > 1 ? `Prepared ${notebooks.length} notebook drafts for individual review.` : incoming.summary };
}

function extractNotebookDraftArtifactFromToolOutput(toolName, output) {
  if (!/(?:^|__)notebook_(?:draft|suggest)$/.test(toolName)) return null;
  const seen = new Set();
  function visit(value, depth = 0) {
    if (!value || depth > 8) return null;
    if (typeof value === 'string') {
      try { return visit(JSON.parse(value), depth + 1); } catch { return null; }
    }
    if (typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    if (value.notebook && typeof value.notebook === 'object') return value;
    for (const nested of [value.structuredContent, value.structured_content, value.output, value.result, value.text, ...(Array.isArray(value.content) ? value.content : [])]) {
      const found = visit(nested, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return visit(output);
}

module.exports = { mergeNotebookDraftArtifacts, extractNotebookDraftArtifactFromToolOutput };
