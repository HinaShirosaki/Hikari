# Agent Runtime Walkthrough

This doc set describes the production Agent path under `src/main/agent`. The live chat controller is Codex-owned; the retired in-process intent parser, science loop, and deep-research implementation are not part of this repository.

## Recommended reading order

1. [Request lifecycle](./architecture/request-lifecycle.md)
2. [Runtime walkthrough](./runtime/runtime-walkthrough.md)
3. [Tooling walkthrough](./tools/tooling-walkthrough.md)
4. [Context and observability](./context/context-and-observability.md)
5. [Agent MCP contract](./mcp-contract/mcp-contract.md)
6. [Module map](./reference/module-map.md)

## Ownership

`src/main/agent` owns:

- the Codex turn adapter, prompt construction, stream projection, and artifact normalization;
- the Hikari MCP server, direct-tool definitions, and callback host;
- Codex-backed tool runtimes used by MCP;
- chat-session logs, sparse Agent memory, skills, and lifecycle observability.

Paper search, retrieval, parsing, download, analysis, and intake storage are owned by `src/main/papers`. Main-process composition lives in `src/main/core/services/`, and Agent IPC handlers live in `src/main/ipc/register-agent-ipc/`.

## Live request path

1. The renderer calls `agent:chat`.
2. `agent-chat-handler.js` hands the request to `runtime/agent-chat-request.js`, which creates lifecycle/session state and records the user turn.
3. `agent-controller-core.js` validates the request and selects the Codex route.
4. `codex-agent/runtime.js` prepares the workspace and prompt, then starts or resumes a Codex CLI turn.
5. Codex calls Hikari through the direct MCP tools when local app data or structured actions are needed.
6. Stream events and final artifacts are normalized, logged, and returned to the renderer.

There is no second API-agent controller or parser-first science path. Agent Chat and direct LLM features both use the signed-in Codex CLI.

## Directory guide

| Folder | Purpose |
| --- | --- |
| `codex-agent/` | Codex prompt/session adapter, streamed artifacts, runtime files, the Codex Desktop setup prompt, and the official skills (`official-skills/`) |
| `context/` | chat-session persistence and sparse long-term memory |
| `html-output/` | the sandboxed `hikari-html://` preview protocol for `html_output` artifacts |
| `mcp-contract/` | MCP stdio/HTTP host, direct tools, tool availability, and Hikari instructions |
| `runtime/` | the `agent:chat` request pipeline, snapshot normalization, sub-app API adapters, and tool-artifact normalization |
| `shared/` | provider helpers, observability, and small registries |
| `skills/` | installed/official skill discovery |
| `tools/` | deterministic tool runtimes and the executor catalog |

For the shortest source tour, start with `src/main/ipc/register-agent-ipc/agent-chat-handler.js`, `src/main/ipc/register-agent-ipc/agent-controller-core.js`, and `src/main/agent/codex-agent/runtime.js`.
