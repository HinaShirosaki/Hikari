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

`src/main/helpers/agent` is the main-process agent backend for Enana. It is responsible for:

- intent parsing
- runtime dispatch
- protocol and notebook generation flows
- inventory and record lookup
- science-question orchestration
- chat-log persistence and lifecycle logging
- reusable tool/runtime helpers

The package is heavily dependency-injected. `src/main/main.js` creates the concrete runtimes, wires in provider adapters, and passes the finished objects into `registerAgentIpc`.

## High-level flow

1. The renderer calls `agent:chat`.
2. `src/main/helpers/main/register-agent-ipc.js` creates request/session logging state.
3. `agent-controller-utils.js` resolves provider, endpoint, model, API key, and runs the parser-first intent classifier.
4. The controller dispatches to one of the intent-specific paths:
   - protocol-to-notebook
   - inventory lookup
   - record lookup
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

## Current integration notes

These are worth knowing before reading the file-by-file map:

- The controller is parser-first. Every `agent:chat` request runs through `agent-intent-parser.js` before it hits a specialized runtime.
- `inventory_lookup` and `record_lookup` use direct runtime calls from the controller instead of going through the generic tool executor.
- `notebook_draft` is the only tool explicitly registered on the shared `createAgentToolCallRuntime()` instance in `main.js`.
- `createCodexAgentRuntime()` owns the Codex-only whole-turn lifecycle, while `mcp-contract/` is shared by any provider integration that can use Hikari MCP tools.
- `agent-context-management.js` and `agent-memory.js` are real runtimes, but they are not currently connected to the main `agent:chat` flow. They are closer to scaffolding or future integration points today.
- `agent-tool-smoke-test.js` is important because it instantiates many tool runtimes directly, even when those tools are not yet attached to the shared executor used by the controller.
