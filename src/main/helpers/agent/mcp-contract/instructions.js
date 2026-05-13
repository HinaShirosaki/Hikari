'use strict';

function buildHikariAgentMcpInstructions() {
  return [
    '# Hikari Agent MCP Instructions',
    '',
    'This MCP server is the provider-neutral Hikari app contract. Any agent provider that can use MCP should call these tools for local Hikari data, protocols, notebooks, inventory, papers, memory, and structured app actions.',
    '',
    'Use direct MCP tools first when the task matches them. Use `tool_search`, `tool_info`, and `tool_call` for broader Hikari app tools that are not already exposed as direct MCP tools. Request a schema with `tool_info` before calling a broader app tool when the argument shape is not already known.',
    '',
    'Direct Hikari MCP tools available without `tool_search`:',
    '- `inventory_lookup`: search local inventory items, chemicals, personal containers, and samples.',
    '- `chemical_lookup`: search local chemical records by name, CAS, supplier, or storage hint.',
    '- `protocol_lookup`: search local protocols through Hikari protocol matching.',
    '- `protocol_generation`: normalize a complete protocol JSON object into the app import format; it does not generate content with an LLM and does not require an id.',
    '- `notebook_lookup`: search local notebook entries by project, protocol, result text, or identifier.',
    '- `ask_user`: prepare one blocking clarification question with suggested answer options and optional custom text input for Hikari to render.',
    '',
    'Tool-use rules:',
    '- Prefer local Hikari records through direct MCP tools before guessing from conversation context.',
    '- Use `record-lookup` through `tool_call` only when the direct lookup tools are not specific enough.',
    '- Use `literature-search` for finding papers, references, recent literature, or external scientific evidence.',
    '- Use `paper-download` when the user explicitly asks to download a paper PDF into app storage, or when a workflow needs a local PDF for deeper reading.',
    '- Use `paper-analysis` when the user asks to summarize a specific paper, extract findings, explain methods, or pull protocol-relevant details from paper text.',
    '- Use direct `protocol_generation` only after complete protocol JSON already exists.',
    '',
    'Clarification rule:',
    'When one blocking user answer is required, call `ask_user`. It returns a renderable `final_response` payload. Do not wait inside MCP for the human answer; the host app renders the options and sends the user answer as the next turn.',
    '',
    'Verification rule:',
    'Separate observed evidence from inference. Cite loaded context blocks, local records, and paper records from tool outputs rather than invented source labels.'
  ].join('\n');
}

module.exports = {
  buildHikariAgentMcpInstructions
};
