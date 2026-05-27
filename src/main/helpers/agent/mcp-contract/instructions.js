'use strict';

function buildHikariAgentMcpInstructionBodyLines() {
  return [
    'This MCP server is the provider-neutral Hikari app contract. Any agent provider that can use MCP should call these tools for local Hikari data, protocols, notebooks, inventory, papers, memory, and structured app actions.',
    '',
    'Use direct MCP tools only. This server does not expose Hikari app `tool_search`, `tool_info`, generic `tool_call`, MCP resources, or any other discovery side channel; the full app tool surface is available as first-class direct MCP tools.',
    '',
    'Direct Hikari MCP tools:',
    '- `inventory_lookup`: search local inventory items, chemicals, personal containers, and samples.',
    '- `chemical_lookup`: search local chemical records by name, CAS, supplier, or storage hint.',
    '- `record_lookup`: search local projects, protocols, notebooks, workflows, assays, gels, and related records.',
    '- `protocol_lookup`: search local protocols through Hikari protocol matching.',
    '- `protocol_generation`: normalize a complete protocol JSON object into the app import format without generating content; set `save: true` in the same call to queue Hikari user approval for adding it to the Protocols module.',
    '- `notebook_draft`: prepare a planned biology notebook draft for explicit confirmation before creating a notebook page.',
    '- `notebook_generation`: generate a protocol-based notebook draft from selected protocol and project context.',
    '- `notebook_lookup`: search local notebook entries by project, protocol, result text, or identifier.',
    '- `literature_search`: find papers, download selected PDFs when possible, write paper markdown, and load bounded paper context blocks.',
    '- `paper_download`: download a paper PDF into Hikari storage.',
    '- `paper_analysis`: summarize or extract methods from a specific paper.',
    '- `purchase_recommendation`: search and rank purchasable products.',
    '- `memory`: recall, remember, forget, and list sparse long-term memory records.',
    '- `ask_user`: prepare one blocking clarification question with suggested answer options and optional custom text input for Hikari to render.',
    '',
    'Tool-use rules:',
    '- Prefer local Hikari records through direct MCP tools before guessing from conversation context.',
    '- Use `record_lookup` when local lookup needs records beyond the specialized inventory, protocol, or notebook lookup tools.',
    '- Use `literature_search` for finding papers, references, recent literature, or external scientific evidence.',
    '- Use `paper_download` when the user explicitly asks to download a paper PDF into app storage, or when a workflow needs a local PDF for deeper reading.',
    '- Use `paper_analysis` when the user asks to summarize a specific paper, extract findings, explain methods, or pull protocol-relevant details from paper text.',
    '- Use direct `protocol_generation` only after complete protocol JSON already exists.',
    '- When the user asks to save or add a generated protocol, call `protocol_generation` once with `save: true`; Hikari will ask the user to approve or reject the generated protocol.',
    '- Use direct `notebook_draft` for planned next-experiment notebook drafts.',
    '',
    'Clarification rule:',
    'When one blocking user answer is required, call `ask_user`. It returns a renderable `final_response` payload. Do not wait inside MCP for the human answer; the host app renders the options and sends the user answer as the next turn.',
    '',
    'Verification rule:',
    'Separate observed evidence from inference. Cite loaded context blocks, local records, and paper records from tool outputs rather than invented source labels.'
  ];
}

function buildHikariAgentMcpInstructions() {
  return [
    '# Hikari Agent MCP Instructions',
    '',
    ...buildHikariAgentMcpInstructionBodyLines()
  ].join('\n');
}

module.exports = {
  buildHikariAgentMcpInstructionBodyLines,
  buildHikariAgentMcpInstructions
};
