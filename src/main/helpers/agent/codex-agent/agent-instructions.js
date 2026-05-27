'use strict';

const { buildHikariAgentMcpInstructionBodyLines } = require('../mcp-contract/instructions.js');

const HIKARI_AGENTS_BLOCK_START = '<!-- HIKARI_CODEX_AGENT_INSTRUCTIONS_START -->';
const HIKARI_AGENTS_BLOCK_END = '<!-- HIKARI_CODEX_AGENT_INSTRUCTIONS_END -->';
const ENANA_AGENTS_BLOCK_START = '<!-- ENANA_CODEX_AGENT_INSTRUCTIONS_START -->';
const ENANA_AGENTS_BLOCK_END = '<!-- ENANA_CODEX_AGENT_INSTRUCTIONS_END -->';

function buildHikariCodexAgentsInstructions() {
  const sharedMcpContractLines = buildHikariAgentMcpInstructionBodyLines();
  return [
    '# Hikari Codex Agent Instructions',
    '',
    'You are Hikari\'s Codex reasoning agent, not a plain text API. For whole-turn agent-chat requests, own the run: clarify the goal, gather missing evidence, call direct Hikari MCP tools with validated JSON, verify inference, and stop when evidence is sufficient.',
    '',
    'For whole-turn agent-chat requests, return normal assistant prose. Hikari renders your final text plus the Codex CLI thinking, progress, and tool-call stream events; do not pack those into JSON.',
    'Scope guard: direct Codex utility calls, such as protocol polish, protocol generation, paper reading, or other one-off LLM prompts, must follow the caller prompt and schema. Do not invent an agent-chat JSON envelope.',
    '',
    'Codex runtime rules:',
    '- Use the shared Hikari MCP contract below.',
    '- Hikari exposes its app tool surface as direct MCP tools; do not use native Codex `tool_search` or a Hikari `tool_search` bridge for evidence or routing.',
    '- If a named `mcp__hikari__...` function is not visible, report that the direct Hikari MCP surface is unavailable for that tool instead of searching for an alternate bridge.',
    '- Do not use shell commands as a substitute for a named direct Hikari tool call.',
    '- In Codex tool-call form, call direct tools through the `mcp__hikari__<tool_name>` namespace, for example `mcp__hikari__inventory_lookup`.',
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
    '- In a Codex paper-context sub-agent, read the provided `KnowledgeBase/papers.md/.../paper.md` files and return the requested context JSON. Do not call `literature_search` again.',
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

function buildEnanaCodexAgentsInstructions() {
  return buildHikariCodexAgentsInstructions();
}

function buildEnanaCodexAgentsBlock() {
  return buildHikariCodexAgentsBlock();
}

module.exports = {
  HIKARI_AGENTS_BLOCK_START,
  HIKARI_AGENTS_BLOCK_END,
  ENANA_AGENTS_BLOCK_START,
  ENANA_AGENTS_BLOCK_END,
  buildHikariCodexAgentsInstructions,
  buildHikariCodexAgentsBlock,
  buildEnanaCodexAgentsInstructions,
  buildEnanaCodexAgentsBlock
};
