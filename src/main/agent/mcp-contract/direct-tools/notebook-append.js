'use strict';

const { randomUUID } = require('node:crypto');
const {
  asArray,
  cleanText,
  compactObject
} = require('./shared.js');

// Natively implemented in the MCP layer: no app tool is proxied, so app_tool
// repeats the MCP name instead of dropping out of the response spine. An
// app_tool equal to mcp_tool is the signal that nothing was forwarded.
const NOTEBOOK_APPEND_MCP_TOOL = Object.freeze({
  name: 'notebook_append',
  description: 'Prepare a reviewable proposal to append evidence-backed markdown to the active Hikari biology notebook page. This tool never changes a notebook page directly; Hikari shows the proposed content and requires explicit user approval before applying it. Use the active hidden notebook-page context first, look up local inventory or chemicals when relevant, and do not use this tool to create a new notebook page.',
  annotations: Object.freeze({
    title: 'Notebook append proposal',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'notebook_entry_id',
      'page_title',
      'project_name',
      'protocol_name',
      'content_markdown'
    ],
    properties: {
      notebook_entry_id: { type: 'string' },
      page_title: { type: 'string' },
      project_name: { type: 'string' },
      protocol_name: { type: 'string' },
      expected_updated_at: { type: 'string' },
      section_title: { type: 'string' },
      content_markdown: { type: 'string', minLength: 1 },
      rationale: { type: 'string' },
      sources: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string' },
            record_id: { type: 'string' },
            label: { type: 'string' },
            detail: { type: 'string' },
            url: { type: 'string' }
          }
        }
      }
    }
  }
});

function normalizeSource(source = {}) {
  const payload = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const normalized = compactObject({
    kind: cleanText(payload.kind, 80),
    record_id: cleanText(payload.record_id || payload.recordId, 160),
    label: cleanText(payload.label || payload.name || payload.title, 320),
    detail: cleanText(payload.detail || payload.reason, 600),
    url: cleanText(payload.url, 2000)
  });
  return Object.keys(normalized).length ? normalized : null;
}

async function callNotebookAppend(input = {}) {
  const notebookEntryId = cleanText(input.notebook_entry_id || input.notebookEntryId, 220);
  const pageTitle = cleanText(input.page_title || input.pageTitle, 320);
  const projectName = cleanText(input.project_name || input.projectName, 220);
  const protocolName = cleanText(input.protocol_name || input.protocolName, 220);
  const expectedUpdatedAt = cleanText(input.expected_updated_at || input.expectedUpdatedAt, 80);
  const contentMarkdown = cleanText(input.content_markdown || input.contentMarkdown, 24000);
  const missingTargetFields = [
    ['notebook_entry_id', notebookEntryId],
    ['page_title', pageTitle],
    ['project_name', projectName],
    ['protocol_name', protocolName]
  ].filter(([, value]) => !value).map(([key]) => key);
  if (!contentMarkdown || missingTargetFields.length) {
    const missing = [
      ...missingTargetFields,
      ...(!contentMarkdown ? ['content_markdown'] : [])
    ];
    return {
      ok: false,
      status: 'needs_more_info',
      mcp_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
      app_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
      error: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required before Hikari can prepare a notebook append proposal.`
    };
  }
  if (notebookEntryId.toLowerCase() !== 'unsaved draft' && !expectedUpdatedAt) {
    return {
      ok: false,
      status: 'needs_more_info',
      mcp_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
      app_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
      error: 'expected_updated_at is required for a saved notebook page so Hikari can reject a stale append proposal.'
    };
  }

  const sectionTitle = cleanText(input.section_title || input.sectionTitle, 220);
  const sources = asArray(input.sources)
    .map(normalizeSource)
    .filter(Boolean)
    .slice(0, 20);
  const proposal = compactObject({
    proposal_id: `notebook-append-${randomUUID()}`,
    notebook_entry_id: notebookEntryId,
    page_title: pageTitle,
    project_name: projectName,
    protocol_name: protocolName,
    expected_updated_at: expectedUpdatedAt,
    section_title: sectionTitle,
    content_markdown: contentMarkdown,
    rationale: cleanText(input.rationale, 1200),
    sources
  });

  return {
    ok: true,
    status: 'proposal_ready',
    mcp_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
    app_tool: NOTEBOOK_APPEND_MCP_TOOL.name,
    summary: `Prepared a notebook append proposal${sectionTitle ? ` for “${sectionTitle}”` : ''}.`,
    proposal,
    save: {
      mode: 'confirm_before_append',
      applied: false,
      status: 'pending'
    }
  };
}

module.exports = {
  NOTEBOOK_APPEND_MCP_TOOL,
  callNotebookAppend
};
