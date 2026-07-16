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
| `codex-agent/runtime-files.js` | Codex runtime home, AGENTS, and MCP config files |
| `codex-agent/official-mcp-skills.js` | released Hikari skill materialization |

## MCP contract

| Path | Role |
| --- | --- |
| `mcp-contract/stdio-server.js` | stdio MCP entrypoint used by Codex |
| `mcp-contract/host.js` | in-process MCP host and app callback bridge |
| `mcp-contract/gateway.js` | normalized tool routing |
| `mcp-contract/instructions.js` | source of Hikari MCP instructions |
| `mcp-contract/direct-tools/index.js` | direct-tool allow-list and router |
| `mcp-contract/direct-tools/*.js` | individual schemas, annotations, and handlers |

## Runtime and shared support

| File | Role |
| --- | --- |
| `runtime/agent-runtime-support.js` | snapshot and prompt-context normalization |
| `runtime/agent-sub-app-api.js` | narrow Agent-facing adapters for app domains |
| `runtime/tool-artifacts/protocol-generation.js` | provider-neutral protocol artifact normalization and aggregation |
| `runtime/tool-artifacts/plotly-graph.js` | provider-neutral Plotly artifact normalization and extraction |
| `runtime/artifact-recovery/protocol-generation.js` | prose-to-protocol recovery and direct-tool retry orchestration |
| `shared/agent-controller-utils.js` | provider/model settings and trace helpers |
| `shared/agent-observability.js` | lifecycle logging and replay |
| `shared/agent-runtime-registry.js` | small runtime-factory registry |
| `shared/agent-llm-provider-bridge.js` | Codex CLI requests used by deterministic sub-tools |

## Context and skills

| File | Role |
| --- | --- |
| `context/agent-chat-log.js` | renderer chat sessions and internal rows |
| `context/agent-memory.js` | sparse long-term Agent memory tool |
| `skills/agent-skill-runtime.js` | installed and official skill discovery |

## Tools

| Path | Role |
| --- | --- |
| `tools/Tools.json` and `tools/Tool-call.json` | internal tool catalog and schemas |
| `tools/agent-tool-loading.js` | catalog loading and argument normalization |
| `tools/agent-tool-execution.js` | registered internal executor |
| `tools/register-agent-tool-executors.js` | service-composition registration point |
| `tools/agent-inventory-lookup.js` | storage-aware inventory lookup |
| `tools/agent-notebook-lookup.js` | notebook search/get bridge |
| `tools/agent-notebook-draft.js` | planned notebook proposal workflow |
| `tools/agent-protocol-generation.js` | deterministic protocol normalization |
| `tools/agent-purchase-recommendation.js` | product discovery and ranking |
| `tools/agent-python-sandbox.js` | low-level and managed Python execution |
| `tools/agent-sub-agent.js` | Codex helper-agent lifecycle |

Paper search/download/analysis tools call implementations under `src/main/papers`; they should not be moved back into this package.

## Start here

1. `src/main/ipc/register-agent-ipc/agent-chat-handler.js`
2. `src/main/ipc/register-agent-ipc/agent-controller-core.js`
3. `src/main/core/services/create-agent-services.js`
4. `src/main/agent/codex-agent/runtime.js`
5. `src/main/agent/mcp-contract/direct-tools/index.js`
