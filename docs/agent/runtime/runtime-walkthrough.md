# Runtime Walkthrough

The `runtime/` folder holds the orchestration layer. These files are bigger than the single-purpose tools because they compose prompts, sessions, tool execution, and result shaping.

## Shared foundation

Several files in `shared/` act like the runtime substrate:

| File | Role |
| --- | --- |
| `shared/agent-llm-utils.js` | provider-agnostic helpers for text extraction, retries, and structured JSON prompting |
| `shared/agent-controller-utils.js` | controller glue: provider/model resolution, trace-context creation, log formatting, parser requests |
| `shared/agent-runtime-registry.js` | small registry that lets `main.js` swap runtime factories by name |
| `shared/agent-observability.js` | lifecycle event recording, log rotation, replay, and failure classification |

Two more helpers in `runtime/` are used everywhere:

| File | Role |
| --- | --- |
| `runtime/agent-runtime-support.js` | normalizes snapshots, builds system/synthesis prompts, and scores fuzzy matches |
| `runtime/agent-science-main-utils.js` | science-specific response shaping, validation gates, project evidence resolution, and paper candidate helpers |

## `agent-session-runtime.js`

This file is the provider adapter for multi-round tool-calling conversations.

Its job is to hide the per-provider differences between:

- OpenAI Responses
- Claude Messages
- Gemini GenerateContent
- Codex CLI

It exposes the common operations the science loop needs:

- `startAgentSession(...)`
- `extractAgentSessionFunctionCalls(...)`
- `extractAgentSessionText(...)`
- `continueAgentSessionWithToolOutputs(...)`
- `continueAgentSessionWithUserMessage(...)`

That lets the higher-level runtime stay focused on reasoning logic instead of request-shape differences.

## `agent-protocol-notebook.js`

This runtime is a stateful coordinator around protocol selection plus notebook generation.

Key behavior:

- keeps an in-memory pending-session map with a 30-minute TTL
- resolves project scope from payload ids, names, parser entities, prior pending state, or protocol hints
- ranks protocol candidates through `agent-protocol-matching.js`
- asks `agent-notebook-generation.js` to fill placeholders and assemble the notebook payload
- stores unresolved placeholder state so follow-up user turns can continue the same draft

This is one of the clearest “workflow runtimes” in the package.

## `agent-lookup-runtime.js`

This runtime is a thin composition layer over the two lookup tools:

- `tools/agent-inventory-lookup.js`
- `tools/agent-record-lookup.js`

It centralizes the shared mechanics:

- build lookup context from snapshot plus storage paths
- open SQLite if it exists
- hydrate snapshots when SQLite is missing or stale
- backfill search indexes into SQLite when fallback JSON had to be used

It returns direct controller-ready methods like `executeInventoryLookup(...)` and `executeRecordLookup(...)`.

## `agent-science-reasoning-loop.js`

This is the non-deep-research science orchestrator.

Its structure is:

1. Build an intent policy from `SCIENCE_REASONING_POLICIES`.
2. Start a provider session through `agent-session-runtime`.
3. Let the model propose one tool call at a time.
4. Validate tool arguments against the active tool schema map.
5. Execute the tool and append its output back into the session.
6. Run an evaluator step to decide whether evidence is sufficient.
7. When finished, run a structured final synthesis step.

It keeps:

- `tool_trace`
- `intermediate_states`
- accumulated citations
- evaluator state
- round budgets

Important architectural note: this runtime expects a working `runTool(...)` adapter and a tool-definition map whose names match the model-facing tool names. The runtime logic is complete, but its end-to-end usefulness depends on what `main.js` has actually registered on the shared tool executor.

## `agent-codex-runtime.js`

This is a standalone Codex-specific controller with its own retrieval/synthesis loop. It is more self-contained than the shared science loop because it asks Codex CLI directly for both the draft answer and the structured synthesis pass.

`main.js` creates it, but then immediately does `void codexRuntime;`. In other words, it is instantiated but not currently dispatched from `agent:chat`.

That makes it useful to know about, but not part of the active request path yet.

## Runtime style patterns

Most runtime files in this package follow the same design conventions:

- factory function export such as `createXRuntime(deps = {})`
- dependency injection instead of hard-coded imports for networked behavior
- small normalizers at the top of the file
- a public return object exposing a handful of controller-ready methods
- structured result envelopes rather than throwing for expected user-facing states like “needs more info”

If you need to extend the package, matching that pattern will make new code blend in cleanly.
