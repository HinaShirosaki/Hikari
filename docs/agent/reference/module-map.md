# Agent Module Map

This map covers the live files under `src/main/agent`. Main composition is under `src/main/core/services/`; paper implementation is under `src/main/papers/`; IPC is under `src/main/ipc/register-agent-ipc/`.

## Codex path

| File | Role |
| --- | --- |
| `codex-agent/runtime.js` | production whole-turn runtime |
| `codex-agent/prompts.js` | prompt and bounded MCP context builders |
| `codex-agent/payloads.js` | final Codex payload normalization |
| `codex-agent/stream-events.js` | Codex stream progress plus tool-event projection |
| `codex-agent/artifacts.js` | Codex-specific notebook/protocol tool-event extraction |
| `codex-agent/runtime-files.js` | Codex runtime home, AGENTS, and MCP config files (the `HIKARI_MCP_CONFIG` block) |
| `codex-agent/agent-instructions.js` | Codex-specific rules; the tool contract itself comes from the MCP server's `instructions` |
| `codex-agent/session-recovery.js` | detects a Codex session that can no longer be resumed and starts a fresh one seeded with the recent conversation |
| `codex-agent/desktop-mcp-prompt.js` | the **Connect Codex Desktop** setup prompt |
| `codex-agent/official-mcp-skills.js` | released Hikari skill materialization into `.agents/skills/` |
| `codex-agent/official-skills/` | the bundled `SKILL.md` folders (assay/Plotly, container, HTML output, notebook draft, paper intake/retrieval, protocol generation, sequence viewer) |

## MCP contract

| Path | Role |
| --- | --- |
| `mcp-contract/stdio-server.js` | stdio MCP entrypoint used by Codex (Node) |
| `mcp-contract/electron-stdio-entry.js` | the same server started by `main.js --hikari-mcp-stdio` inside a packaged app |
| `mcp-contract/host.js`, `mcp-contract/host-client.js` | in-process loopback MCP host and the stdio server's client for it |
| `mcp-contract/gateway.js` | normalized tool routing |
| `mcp-contract/instructions.js` | source of Hikari MCP instructions and the canonical tool-name list |
| `mcp-contract/tool-availability.js` | applies **Settings > Tool access** (`disabledMcpToolNames`) |
| `mcp-contract/notebook-suggestion-policy.js` | the reduced tool set for background suggestion runs |
| `mcp-contract/result-shaping/` | bounds oversized tool results before the model reads them |
| `mcp-contract/direct-tools/index.js` | direct-tool allow-list and router |
| `mcp-contract/direct-tools/*.js` | individual schemas, annotations, and handlers |

## Runtime and shared support

| File | Role |
| --- | --- |
| `runtime/agent-chat-request.js` | the `agent:chat` request pipeline: lifecycle, session logging, progress, controller call, response projection |
| `runtime/agent-runtime-support.js` | snapshot and prompt-context normalization |
| `runtime/agent-sub-app-api.js` | narrow Agent-facing adapters for app domains |
| `runtime/tool-artifacts/protocol-generation.js` | provider-neutral protocol artifact normalization and aggregation |
| `runtime/tool-artifacts/plotly-graph.js` | provider-neutral Plotly artifact normalization and extraction |
| `runtime/artifact-recovery/protocol-generation.js` | prose-to-protocol recovery and direct-tool retry orchestration |
| `shared/agent-controller-utils.js` | provider/model settings and trace helpers |
| `shared/agent-observability.js` | lifecycle logging and replay |
| `shared/agent-runtime-registry.js` | small runtime-factory registry |
| `shared/agent-llm-provider-bridge.js`, `shared/llm-providers/` | Codex CLI requests used by deterministic sub-tools |
| `shared/controller-utils/` | provider settings, result summaries, and tracing helpers behind `agent-controller-utils.js` |
| `shared/agent-inventory-search-terms.js` | the one inventory search-term builder |
| `html-output/preview-service.js` | the sandboxed `hikari-html://` protocol and `agent:html-preview` handler |

## Context and skills

| File | Role |
| --- | --- |
| `context/agent-chat-log.js` + `context/chat-log/` | renderer chat sessions and internal rows (session index, persisted display rows, assistant messages, agent questions, Codex session ids) |
| `context/agent-memory.js` | sparse long-term Agent memory tool |
| `skills/agent-skill-runtime.js` | installed and official skill discovery |

## Tools

| Path | Role |
| --- | --- |
| `tools/Tools.json` and `tools/Tool-call.json` | internal tool catalog and schemas |
| `tools/agent-tool-loading.js` | catalog loading and argument normalization |
| `tools/agent-tool-execution.js` | registered internal executor |
| `tools/register-agent-tool-executors.js` | service-composition registration point |
| `tools/agent-inventory-lookup.js` | chemicals-index and snapshot inventory lookup |
| `tools/agent-notebook-lookup.js` | notebook search/get bridge |
| `tools/agent-protocol-matching.js` | local protocol ranking |
| `tools/agent-notebook-generation.js` | placeholder filling and notebook payloads |
| `tools/agent-notebook-draft.js` | planned notebook proposal workflow |
| `tools/agent-protocol-generation.js`, `tools/agent-protocol-save.js` | deterministic protocol normalization and saving |
| `tools/agent-container.js`, `tools/agent-assay-table.js` | scratch containers and assay tables |
| `tools/agent-plotly-graph.js`, `tools/agent-plotly-figure.js` | Plotly figure specs |
| `tools/agent-web-search.js`, `tools/agent-command-line.js` | web search and bounded shell commands |
| `tools/agent-purchase-recommendation.js` | product discovery and ranking |
| `tools/agent-python-sandbox.js` | low-level and managed Python execution |
| `tools/agent-sub-agent.js` | Codex helper-agent lifecycle |

Paper search/download/analysis tools call implementations under `src/main/papers`; they should not be moved back into this package.

## Start here

1. `src/main/ipc/register-agent-ipc/agent-chat-handler.js` and `src/main/agent/runtime/agent-chat-request.js`
2. `src/main/ipc/register-agent-ipc/agent-controller-core.js`
3. `src/main/core/services/create-agent-services.js`
4. `src/main/agent/codex-agent/runtime.js`
5. `src/main/agent/mcp-contract/direct-tools/index.js`
