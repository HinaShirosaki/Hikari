# register-agent-ipc

This folder contains the main-process IPC registration for the agent/chat subsystem.

## Why this exists

`register-agent-ipc.js` had grown into a single file that mixed together:

- IPC route registration
- chat request orchestration
- controller and intent dispatch logic
- lifecycle/progress emission
- chat session persistence
- request log and replay handlers

This folder splits those responsibilities into smaller modules so each part is easier to read, test, and extend.

## Module map

- `index.js`
  - Entry point that wires dependencies together and registers all agent IPC handlers.
- `agent-chat-handler.js`
  - Owns the `agent:chat` IPC flow.
  - Coordinates request logging, lifecycle recording, session persistence, and final response shaping.
- `agent-controller-core.js`
  - Validates controller inputs, resolves LLM/provider configuration, runs the intent parser, and hands off to the dispatcher.
- `agent-intent-dispatcher.js`
  - Contains the intent-specific branching for notebook, lookup, and science flows.
- `agent-session-service.js`
  - Wraps chat-session creation/appending and keeps session row ordering logic in one place.
- `agent-lifecycle-service.js`
  - Centralizes lifecycle helpers such as payload normalization, progress events, tool-call lifecycle tracing, and lifecycle log flushing.
- `agent-log-handlers.js`
  - Registers the non-chat IPC endpoints for chat-log access, developer smoke tests, lifecycle request listing, and lifecycle replay.

## Design notes

- The public import surface stays stable through `src/main/helpers/main/register-agent-ipc.js`, which now forwards to this folder.
- Dependency injection is preserved so existing `main.js` wiring does not need to change.
- Shared helpers live close to the agent IPC boundary instead of being duplicated across route handlers.
