# Context And Observability

Production Agent context is intentionally small: renderer-facing chat sessions, sparse long-term memory, request-scoped Codex context, and lifecycle traces.

## `context/agent-chat-log.js`

The chat-log runtime (with its helpers in `context/chat-log/`) manages:

- session creation and indexing;
- per-session JSONL rows;
- renderer-facing assistant message projection;
- session listing and retrieval.

The `messages` projection contains what the UI needs. Raw rows retain request, result, lifecycle, and LLM-trace detail.

## `context/agent-memory.js`

The memory runtime persists sparse records and exposes `remember`, `recall`, `forget`, and `list`. Records are normalized and deduplicated by category, key, and scope. Project records use stable project IDs where available, with name fallback for legacy records. The storage file is optional, so tests can inject an in-memory map.

Memory is available through the direct `memory` MCP tool and its internal Agent executor. It persists in `<storage root>/.hikari/agent-memory.json`. Writes default to global; pass `scope: "project"` for project facts. Project recall/list includes global preferences unless `include_global: false`; `scope: "global"` reads only global records. Prefer `project_id` over a mutable project name. Name-only legacy records acquire the stable ID when updated with one.

All operations on a runtime instance are serialized. The storage destination is captured when the operation starts. Loads publish only after successful parsing; writes use temporary files and atomic rename, with rollback on failure. The app service owns this store; simultaneous external writers are unsupported. `forget` requires an exact ID or key and never includes global records as an implicit addition to project scope. No bulk-clear operation is exposed.

Recall requires every query word to match, regardless of order, and ranks exact phrases and key/summary matches ahead of other matches. Recency breaks ties. This is local lexical retrieval, without embeddings.

Project `MEMORY.md` remains a separate derived view: a bounded index of one line per record — `## Papers`, `## Experiments`, then `## Agent Notes` — ordered newest first and trimmed to stay inside the Codex project-doc cap, with each section stating how many older entries it omitted and which tool retrieves them. Notebook lines carry the generated one-sentence summary followed by a supporting quote in parentheses. Quote membership establishes that the quoted text was recorded; it does not establish that the summary follows from it, which is why the quote is printed beside the sentence rather than in place of it. A page whose summary could not be generated or confirmed says so instead of publishing an extract. The `.hikari/research-memory.json` sidecar preserves source paths, hashes, supporting quotes, and retry state.

`## Agent Notes` renders the project-scoped records of the `memory` tool. Codex runs read-only, so the agent writes them through that tool rather than editing the file; notes are reserved ahead of papers and experiments when the index is trimmed.

Fallback generation is retried on a later save after backoff (5 minutes, then 10 minutes), at most three attempts per source hash. Source edits reset eligibility. The storage API `writeProjectMemoryFile({ ..., regenerateConclusions: true })` explicitly clears the project's conclusion cache and schedules regeneration without editing notebook records. No retry timer or settings UI is added.

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
