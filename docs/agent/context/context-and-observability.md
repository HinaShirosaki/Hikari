# Context And Observability

The `context/` and `shared/agent-observability.js` files are the package's memory and debugging backbone.

## `agent-chat-log.js`

This is the only context file that is fully on the main `agent:chat` path today.

It manages:

- chat session creation and indexing
- per-session JSONL row storage
- conversion from internal agent result objects into renderer-friendly assistant messages
- session listing and retrieval for the chat sidebar/history

The agent IPC layer uses it for:

- `ensureSession(...)`
- `appendRows(...)`
- `buildAssistantMessageFromResult(...)`
- `buildAssistantMessageFromError(...)`

One subtle but useful detail: the assistant message stored for the renderer is a summarized projection of the agent result, not a raw dump of lifecycle internals.

## `agent-context-management.js`

This file implements a richer layered context model than the current controller uses.

It keeps three layers:

- immediate context
- session memory
- long-term memory

It can:

- start or update an active task
- record tool rounds and follow-up exchanges
- build prompt blocks for each context layer
- derive candidate long-term memories from the session state
- prune expired sessions

It is well-commented and structurally ready for use, but it is not currently wired into `agent:chat` in `register-agent-ipc.js`.

## `agent-memory.js`

This file is the sparse long-term memory store. It can persist JSON records to disk and expose four actions:

- `remember`
- `recall`
- `forget`
- `list`

Important behaviors:

- records are normalized before storage
- deduplication is based on a stable key of `category + key + project_name`
- values can be scalar or JSON
- the file store is optional; the runtime can also work off an injected in-memory `Map`

Like `agent-context-management.js`, it exists as a real runtime but is not yet attached to the main controller path.

## `agent-observability.js`

This file is used heavily by the controller.

It provides:

- `createLifecycleRecorder(...)`
- `recordLifecycleEvent(...)`
- `appendLogWithRotation(...)`
- `readLifecycleLogs(...)`
- `replayRequestLifecycle(...)`
- `classifyFailureReasons(...)`

That gives the package two levels of history:

- a renderer-facing chat session log
- a lower-level request/lifecycle trace log

The lifecycle log is still the better source when debugging routing or tool failures at the request level, but the per-session chat log now also persists the internal request/result/lifecycle/LLM-trace rows for each chat. The `messages` projection remains user-facing; the raw `rows` payload is the full hop-by-hop history.

## How the pieces fit during `agent:chat`

For a normal request:

1. `register-agent-ipc.js` creates a lifecycle recorder.
2. It writes the user request into the main log and session log.
3. Each stage of parsing, routing, tool execution, and synthesis records lifecycle rows.
4. At the end, the lifecycle rows are flushed to disk.
5. A summarized assistant message is built and appended to the session log.

This split is intentional:

- lifecycle rows are detailed and diagnostic
- session rows are stable and UI-friendly for `messages`, while still retaining the raw internal rows for replay/debugging

## Practical onboarding note

If you are trying to understand why the agent answered something unexpected, start with the observability replay path before you start editing prompts. The package already records enough structure to show:

- which intent won
- which runtime handled the request
- which tool calls ran
- why failure reasons were classified the way they were
