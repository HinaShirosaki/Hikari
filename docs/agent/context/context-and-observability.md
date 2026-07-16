# Context And Observability

Production Agent context is intentionally small: renderer-facing chat sessions, sparse long-term memory, request-scoped Codex context, and lifecycle traces.

## `context/agent-chat-log.js`

The chat-log runtime manages:

- session creation and indexing;
- per-session JSONL rows;
- renderer-facing assistant message projection;
- session listing and retrieval.

The `messages` projection contains what the UI needs. Raw rows retain request, result, lifecycle, and LLM-trace detail.

## `context/agent-memory.js`

The memory runtime persists sparse records and exposes `remember`, `recall`, `forget`, and `list`. Records are normalized and deduplicated by category, key, and project name. The storage file is optional, so tests can inject an in-memory map.

Memory is registered as an internal Agent tool. It is distinct from the project-scoped Codex `MEMORY.md` files prepared by the Codex service.

## Request context

Each Codex turn receives a bounded MCP request context built by `codex-agent/prompts.js`. It carries the active working directory, project/storage hints, model settings, and the thin Agent snapshot needed by direct tools. Large feature data should be retrieved through owning tools rather than copied into the prompt.

## `shared/agent-observability.js`

Observability provides lifecycle recorder creation, event recording, log rotation, request listing, replay, and failure classification. The Agent IPC layer records controller selection, Codex execution, tool activity, completion, and errors through this service.

## Debugging order

When a turn behaves unexpectedly:

1. inspect the session rows to confirm the renderer request and final projection;
2. replay the lifecycle request to locate the failing stage;
3. inspect the Codex/MCP tool events and request context;
4. only then change prompts or tool behavior.

There is no separate layered `agent-context-management` runtime in production.
