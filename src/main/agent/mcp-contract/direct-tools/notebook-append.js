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
  description: [
    'Prepare a reviewable proposal to append evidence-backed markdown to the active Hikari biology notebook page. This tool never changes a notebook page directly; Hikari shows the proposed content and requires explicit user approval before applying it. Do not use it to create a new page or replace existing content.',
    'First read the complete hidden notebook-page context (entry id, title, protocol steps, filled values, notes, tables, calculations, linked sample identifiers) as the active page state. Use inventory_lookup for linked samples or proteins and chemical_lookup for local chemical stock; use native web search for authoritative preparation guidance, and literature_search only for claims that need research-paper evidence. A local no-match means no saved record was found; it does not rule out a clearly labeled reference preparation for a standard, independently preparable, sufficiently identified laboratory solution.',
    'A reference preparation is not an inventory record. State its assumptions, chemical form, purity when relevant, target concentration, final volume, solvent, calculation, preparation steps, handling or sterilization, storage, stability, and safety-critical uncertainty, and make it executable from materials on the page, found locally, or available in an ordinary source form. Do not stop at diluting an unverified stock or undefined base solution: include the missing stock or base formula with its mass or volume arithmetic and any molecular-weight, density, or purity assumption, or name it as a missing prerequisite and ask one focused question. Prefer one complete formulation over several partial recipes. Never present assumptions as recorded facts, and do not improvise formulas for proprietary mixtures, biological materials, or insufficiently identified substances.',
    'Keep content bench-ready and concise, with at most three short subsections and six bullets and normally under about 180 words. Avoid redundant page context, duplicate section-title headings, nested lists, tool names, search queries, failed-lookup transcripts, internal reasoning, and Sources headings. Include values from the page when needed for the requested output. Put a decision-relevant lookup gap in rationale as one short sentence. Pass one to three unique useful records or authoritative URLs in sources with compact labels and details, excluding failed searches and the hidden page context.',
    'When the user asks for a table in Notes or a table best presents the information, put a Markdown pipe table directly in content_markdown. Include column headers, a separator row with at least three hyphens per column, and one line per data row with matching columns. Leave a blank line around the table when adjacent to other content and escape literal pipes within cells. Use the available evidence for cell values and label missing data explicitly.',
    'Call once, only when useful content is ready, with the entry id and updated timestamp from the page context. If nothing safe and useful can be added, answer briefly without proposing an append.'
  ].join(' '),
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
