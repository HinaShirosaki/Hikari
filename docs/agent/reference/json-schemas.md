# Agent JSON Contracts

This page is a source map, not a copied schema dump. Static copies of the retired intent-parser, science-loop, and deep-research schemas were removed because they no longer described production code.

## Authoritative sources

| Contract | Source |
| --- | --- |
| internal tool catalog | `src/main/agent/tools/Tools.json` |
| internal tool input schemas | `src/main/agent/tools/Tool-call.json` |
| direct MCP definitions | `src/main/agent/mcp-contract/direct-tools/*.js`, `src/main/papers/store/intake/mcp/` (paper intake), `src/renderer/modules/sequence-viewer/main-process/mcp/schemas.js` (sequence tools) |
| direct MCP allow-list | `src/main/agent/mcp-contract/direct-tools/index.js` |
| canonical MCP tool names and agent instructions | `src/main/agent/mcp-contract/instructions.js` |
| Codex final payload normalization | `src/main/agent/codex-agent/payloads.js` |
| Codex tool-event projection | `src/main/agent/codex-agent/artifacts.js` and `stream-events.js` |
| normalized protocol and Plotly artifacts | `src/main/agent/runtime/tool-artifacts/` |
| chat/session rows | `src/main/agent/context/agent-chat-log.js` |
| MCP protocol snapshot | `docs/agent/mcp-contract/mcp-contract.json` |

## Maintenance rule

Change the owning source and its focused tests together. Do not paste another large schema copy into this document. For the exact MCP tool list and input schemas, inspect the direct-tool definitions. `mcp-contract.json` is a hand-refreshed snapshot (there is no export script): when a definition changes, copy the live definition from `createMcpToolDefinitions()` in `stdio-server.js` into it. Several tests (`mcp-gateway-tool-surface`, `paper-intake-retrieval`, `notebook-draft-capacity-selfcheck`, `html-output-selfcheck`, `image-output-selfcheck`) fail when a snapshot entry no longer matches the live definition.

