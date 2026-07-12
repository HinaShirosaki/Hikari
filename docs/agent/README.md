# Agent Helper Walkthrough

This doc set explains how `src/main/helpers/agent` is assembled, how requests move through it, and which parts are fully on the current IPC path versus more loosely wired helper modules.

## Recommended reading order

1. [Request lifecycle](./architecture/request-lifecycle.md)
2. [Runtime walkthrough](./runtime/runtime-walkthrough.md)
3. [Tooling walkthrough](./tools/tooling-walkthrough.md)
4. [Context and observability](./context/context-and-observability.md)
5. [Deep research pipeline](./deep-research/pipeline.md)
6. [Agent MCP contract](./mcp-contract/mcp-contract.md)
7. [Module map](./reference/module-map.md)
8. [Reading the context debug export](./reference/agent-context-debug-guide.md)

## What this package owns

`src/main/helpers/agent` is the main-process agent backend for Hikari. It is responsible for:

- intent parsing
- runtime dispatch
- protocol and notebook generation flows
- inventory and notebook lookup
- science-question orchestration
- chat-log persistence and lifecycle logging
- reusable tool/runtime helpers

The package is heavily dependency-injected. `src/main/core/main-services.js` builds the provider-neutral agent foundation via `createMainAgentServices(...)`, then constructs MCP and Codex as separate services before wiring them into the agent IPC registrar. The agent registrar itself lives in `src/main/ipc/register-agent-ipc/`.

## High-level flow

1. The renderer calls `agent:chat`.
2. `src/main/ipc/register-agent-ipc/agent-chat-handler.js` creates request/session logging state.
3. `shared/agent-controller-utils.js` resolves provider, endpoint, model, API key, and runs the parser-first intent classifier.
4. The controller dispatches to one of the intent-specific paths:
   - protocol-to-notebook
   - inventory lookup
   - notebook lookup
   - notebook draft
   - science reasoning loop
   - deep research
5. The result is normalized, logged, converted into assistant chat rows, and returned to the renderer.

## Directory guide

| Folder | Purpose |
| --- | --- |
| `intent/` | parser schema, prompt builder, and parser payload normalization |
| `runtime/` | orchestration runtimes that coordinate tools, sessions, prompts, and synthesis |
| `tools/` | concrete tool implementations plus the schema-driven tool-call wrapper |
| `mcp-contract/` | provider-neutral MCP stdio server, gateway, direct tools, and app callback host |
| `codex-agent/` | Codex-only runtime, AGENTS instructions, and Codex CLI config helpers |
| `context/` | chat-log persistence, layered in-memory context, and sparse long-term memory |
| `shared/` | provider adapters, observability, runtime registry, and controller glue |
| `deep-research/` | multi-step research pipeline for science intents |
| `literature-search/` | literature-search and Codex paper-context workflows |
| `paper-intake/` | paper intake pipeline, search, store, and MCP tools |
| `skills/` | agent skill runtime |

The agent IPC registrar (`agent:chat` and the chat-log/log endpoints) lives separately in `src/main/ipc/register-agent-ipc/`.

## Current integration notes

These are worth knowing before reading the file-by-file map:

- There are two top-level controller paths. When the provider resolves to Codex (`LLM_PROVIDERS.CODEX`), `agent-controller-core.js` selects the Codex-owned path and runs `codexAgentRuntime.run(...)`. Otherwise it uses the parser-first intent path, where every request runs through `agent-intent-parser.js` before hitting a specialized runtime.
- The `inventory_lookup` and `notebook_lookup` *intents* call the lookup runtime directly from the controller, but `inventory-lookup` and `notebook-lookup` are also registered as tools for the science/deep-research loops.
- The shared `createAgentToolCallRuntime()` instance now has the full tool suite registered via `register-agent-tool-executors.js` (lookups, protocol matching, notebook generation/draft, web search, sub-agent, memory, literature search, paper download/search/analysis, purchase recommendation, protocol generation, python sandbox, command line) — not just `notebook-draft`.
- `createCodexAgentRuntime()` owns the Codex whole-turn lifecycle and is dispatched on the Codex provider path, while `mcp-contract/` is shared by any provider integration that can use Hikari MCP tools.
- `agent-memory.js` is now wired into the chat flow as the `memory` tool. `agent-context-management.js` is still a real runtime that is not connected to the main `agent:chat` flow — closer to scaffolding or a future integration point today.
- `agent-tool-smoke-test.js` exercises tool runtimes in isolation with lightweight fixtures, independent of the live executor used by `agent:chat`.
