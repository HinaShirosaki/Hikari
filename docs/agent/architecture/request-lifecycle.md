# Request Lifecycle

The production Agent flow is assembled in `src/main/core/main-services.js` and executed through the Agent IPC registrar.

## Assembly

The main service catalog builds three cooperating pieces:

1. `createMainAgentServices(...)` creates shared tool runtimes, chat logging, memory, skills, observability, and provider-neutral helper services.
2. `createMainMcpService(...)` exposes the direct Hikari tools through the MCP host.
3. `createMainCodexService(...)` prepares Codex workspaces and creates the Codex-owned turn runtime.

The completed dependency bag is passed to `registerAgentIpc(...)`. Paper-owned runtimes are imported from `src/main/papers`; they are injected into the Agent tool catalog rather than being owned by `src/main/agent`.

## `agent:chat`

`src/main/ipc/register-agent-ipc/agent-chat-handler.js` registers the main request endpoint. Before invoking the controller it:

- normalizes the payload and execution flags;
- creates a request id and lifecycle recorder;
- creates or resumes the renderer-facing chat session;
- appends the user request to the Agent and session logs;
- installs progress and cancellation handling.

## Controller routing

`src/main/ipc/register-agent-ipc/agent-controller-core.js` owns one production route: Codex.

The controller validates the message, resolves Codex model settings, normalizes the data snapshot, builds the conversation window, and calls `codexAgentRuntime.run(...)`. The old self-implemented API-agent route and its intent/science runtimes have been removed. A non-Codex request reaching this boundary returns the disabled-provider error instead of entering a hidden fallback controller.

## Codex turn

`src/main/agent/codex-agent/runtime.js`:

1. resolves a safe working directory, optionally preparing a project workspace;
2. builds the Agent prompt and bounded Hikari MCP request context;
3. starts or resumes the Codex CLI session;
4. projects stream events into renderer progress updates;
5. normalizes the final payload and structured artifacts;
6. invokes `runtime/artifact-recovery/protocol-generation.js` when a requested protocol was authored as prose or its direct tool materialization failed.

Codex uses the MCP server for local lookups and structured app actions. The allow-list lives in `src/main/agent/mcp-contract/direct-tools/index.js`.

## Direct tools

The direct MCP surface currently includes inventory and chemical lookup, notebook and protocol lookup, notebook drafts, protocol generation, literature search, paper download/analysis/intake lookup, purchase recommendation, scratch containers, assay tables, Plotly graphs, and user clarification.

Tool wrappers own their schemas and annotations. Deterministic implementation runtimes live under `src/main/agent/tools/`, except paper behavior, which lives under `src/main/papers/`.

## Response emission

After the Codex runtime returns, the chat handler:

- classifies failures and records the final lifecycle event;
- flushes lifecycle rows;
- appends the normalized result or error to the Agent log;
- projects the result into a renderer-friendly assistant message;
- appends that message and its internal rows to the session log.

The session's `messages` projection is UI-facing. Its `rows` preserve request, result, lifecycle, and LLM-trace detail for replay and debugging.

## Related endpoints

The registrar also exposes chat-session create/list/get endpoints, lifecycle request listing, and lifecycle replay. Their channel names are centralized in `src/shared/ipc/channels.js`.
