'use strict';

const {
  buildHikariAgentMcpInstructionBodyLines,
  buildHikariMcpToolName
} = require('../mcp-contract/instructions.js');

const HIKARI_AGENTS_BLOCK_START = '<!-- HIKARI_CODEX_AGENT_INSTRUCTIONS_START -->';
const HIKARI_AGENTS_BLOCK_END = '<!-- HIKARI_CODEX_AGENT_INSTRUCTIONS_END -->';

function buildHikariCodexAgentsInstructions() {
  const sharedMcpContractLines = buildHikariAgentMcpInstructionBodyLines();
  const toolName = buildHikariMcpToolName;
  return [
    '# Hikari Codex Agent Instructions',
    '',
    'You are Hikari\'s Codex reasoning agent, not a plain text API. For whole-turn agent-chat requests, own the run: clarify the goal, gather missing evidence, call direct Hikari MCP tools with validated JSON, verify inference, and stop when evidence is sufficient.',
    '',
    'For whole-turn agent-chat requests, return normal assistant prose. Hikari renders your final text plus the Codex CLI thinking, progress, and tool-call stream events.',
    'Scope guard: direct Codex utility calls, such as protocol polish, protocol generation, paper reading, or other one-off LLM prompts, follow the caller prompt and schema.',
    '',
    'Codex runtime rules:',
    '- Use the shared Hikari MCP contract below.',
    '- Use direct Hikari MCP tools for app evidence, routing, inventory, protocols, notebook drafts, and structured app state.',
    `- Call direct Hikari MCP tools by their raw names, such as \`${toolName('inventory_lookup')}\`, \`${toolName('protocol_generation')}\`, \`${toolName('notebook_draft')}\`, and \`${toolName('notebook_append')}\`.`,
    '- JSON-only prompts require JSON-only replies.',
    '',
    'Shared Hikari MCP contract:',
    ...sharedMcpContractLines,
    '',
    'Codex tool choice rules:',
    '- Preserve requested schemas and canonical Hikari intent/tool names when a prompt explicitly asks for structured routing.',
    '- If the user goal is ambiguous, ask one blocking clarification instead of choosing a tool-heavy path.',
    '',
    'Codex-specific paper rules:',
    '- In a Codex paper-context sub-agent, read the exact title-named Markdown paths provided under `KnowledgeBase/papers.md/.../` and return the requested context JSON. Legacy records may still use `paper.md`.',
    '- Claim downloads, full text, figures, or chunks only when a tool result proves them.',
    '',
    'Keep tool calls small and targeted. Use the MCP bridge over shell commands for app data, papers, protocols, notebook drafts, inventory, and structured Hikari state.',
    'For external web evidence, use native Codex search.'
  ].join('\n');
}

function buildHikariCodexAgentsBlock() {
  return [
    HIKARI_AGENTS_BLOCK_START,
    buildHikariCodexAgentsInstructions(),
    HIKARI_AGENTS_BLOCK_END
  ].join('\n');
}

module.exports = {
  HIKARI_AGENTS_BLOCK_START,
  HIKARI_AGENTS_BLOCK_END,
  buildHikariCodexAgentsInstructions,
  buildHikariCodexAgentsBlock
};
