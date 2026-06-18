# Request Lifecycle

This is the shortest path to understanding the agent package: start at `src/main/core/start-hikari-main-core.js`, then follow the call into `src/main/ipc/register-agent-ipc/`.

## Assembly in the boot core

`main.js` is a thin 5-line entry. `src/main/core/start-hikari-main-core.js` assembles the agent backend by:

- calling `createMainAgentServices(...)` (`src/main/helpers/main/create-main-agent-services.js`), which builds shared helpers such as `controllerUtils`, `observability`, `agentRuntimeRegistry`, and `agentRuntimeSupport`
- creating intent-specific runtimes such as lookup, protocol-notebook, notebook-draft, science-loop, and deep-research
- creating the generic tool-call runtime and exposing it as `agentToolRuntime`
- passing all of those objects as the `agent` argument of `registerMainIpc({ data, agent, system })`

That means `src/main/helpers/agent` is best read as a set of factories plus helper modules, not as a single monolithic controller.

## Entry point: `agent:chat`

The main IPC entry point is `ipcMain.handle(AGENT.CHAT, ...)` registered from `src/main/ipc/register-agent-ipc/agent-chat-handler.js` (the registrar folder's `index.js` composes the chat, log, lifecycle, and controller-core pieces).

Before the controller runs, the handler:

- normalizes the request payload
- resolves execution flags such as developer mode
- creates a request id and lifecycle recorder
- ensures a chat session exists if a storage path was supplied
- writes a request row into the agent log
- appends the user message into the per-session chat log

Only after that setup does it call `runAgentController(...)`.

## Parser-first controller

`runAgentController()` is intentionally thin. It immediately delegates to `runAgentControllerCore()` after recording that the parser-first path was selected.

`runAgentControllerCore()` performs these steps:

1. Validate that a message exists.
2. Resolve LLM provider, endpoint, model, and API key.
3. Normalize the incoming data snapshot with `agentToolRuntime.normalizeAgentSnapshot(...)`.
4. Build or extend the conversation window.
5. Run `controllerUtils.requestIntentParserPayload(...)`.
6. Dispatch on `parserResult.payload.primary_intent`.

If the parser fails, the request stops there and returns an error envelope.

## Intent dispatch table

| Parser intent | Handler path | Main runtime |
| --- | --- | --- |
| `protocol_to_notebook` | dedicated flow | `runtime/agent-protocol-notebook.js` |
| `inventory_lookup` | direct lookup | `runtime/agent-lookup-runtime.js` |
| `record_lookup` | direct lookup | `runtime/agent-lookup-runtime.js` |
| `notebook_draft` | shared tool wrapper calling one registered executor | `tools/agent-notebook-draft.js` |
| `general_science_question` | science mode | `runtime/science-reasoning-loop/index.js` or `deep-research/index.js` |
| `project_science_question` | science mode | `runtime/science-reasoning-loop/index.js` or `deep-research/index.js` |
| `result_analysis` | science mode | `runtime/science-reasoning-loop/index.js` or `deep-research/index.js` |
| anything else | parser-only result | no further specialized runtime |

## Protocol-to-notebook path

The protocol flow is the most stateful branch outside of chat logging.

It:

- builds a session key from project context
- resumes any pending protocol session if one exists
- asks `agent-protocol-matching.js` to rank or break ties between candidate protocols
- resolves a project from payload, parser entities, protocol hints, or pending state
- asks `agent-notebook-generation.js` to fill placeholders and build a notebook payload
- persists pending placeholder state when the flow still needs user clarification

This is why follow-up answers can continue a notebook-generation thread without forcing the user to restate everything.

## Lookup paths

`inventory_lookup` and `record_lookup` do not use the generic tool runtime in the main controller. They call `agentLookupRuntime.executeInventoryLookup(...)` and `agentLookupRuntime.executeRecordLookup(...)` directly.

Both paths:

- derive a query from parser entities plus the raw message
- search SQLite when available
- fall back to hydrated snapshot JSON
- optionally backfill the SQLite index from the snapshot
- return compact result envelopes with `status`, `source`, `backfilled_sql`, and `items`

## Notebook-draft path

This branch uses the generic tool-call runtime. `notebook-draft` is one of the executors registered on the shared runtime by `register-agent-tool-executors.js`.

The flow is:

1. Create a lifecycle-aware `runTrackedTool(...)`.
2. Call `runTrackedTool('notebook-draft', ...)`.
3. Let `agent-notebook-draft.js` infer a next likely workflow/protocol, generate a proposal, and return a draft notebook payload.

This is the most concrete example of the schema-driven tool wrapper being used on the main path today.

## Science paths

For `general_science_question`, `project_science_question`, and `result_analysis`, the controller builds a `scienceInput` object and then chooses between two runtimes:

- `deepResearchRuntime.*` when `payload.agent.deepResearchEnabled === true`
- `scienceReasoningLoopRuntime.*` otherwise

It also resolves project evidence up front for project-scoped science questions.

## Response emission

After the controller returns, `agent:chat`:

- classifies failure reasons
- records a final lifecycle event
- flushes lifecycle rows into the main agent log
- writes an `agent-chat-result` or `agent-chat-error` row
- converts the result into a human-readable assistant message with `agent-chat-log.js`
- appends that assistant message into the session log

So the chat session log serves two purposes:

- `messages` stays a renderer-friendly projection of what the user saw
- `rows` keeps the raw request/result/lifecycle/LLM-trace history for that session

## Related IPC endpoints

The same file also exposes support endpoints:

- `agent:chat-log:create-session`
- `agent:chat-log:list-sessions`
- `agent:chat-log:get-session`
- `agent:developer:test-tools`
- `agent:logs:list-requests`
- `agent:logs:replay`

Those endpoints are useful when debugging because they surface the same agent package from different angles: chat state, manual tool checks, and replayable lifecycle traces.
