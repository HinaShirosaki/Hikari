# Main Core

`src/main/core/` is the main-process composition boundary for Hikari.

`main-services.js` is the whole startup story: it constructs every main-process service in dependency order (plain top-to-bottom code), registers all IPC handlers, and returns:

- `appIconPath`
- `start()` — async initialization after `app.whenReady()`
- `shutdown()` — reverse-order teardown before quit

Electron lifecycle concerns stay in `src/main/app/`. `start-main-app.js` calls `createMainServices()` before readiness (construction and IPC registration are synchronous), creates the window after Electron becomes ready, awaits `start()`, and calls `shutdown()` before quit.

## Startup order

1. app metadata and paths
2. storage plus sequence APIs
3. agent chat logging / chat-log transform monitor
4. LLM prompts
5. npm update checks
6. Telegram
7. provider-neutral agent foundation (`core/services/create-agent-services.js`)
8. MCP host and workspace initializer
9. Codex runtime
10. data, agent, and system IPC registration

Every `start()` step is best-effort: a failed integration is logged with `console.warn` and must not prevent the main window from working. `shutdown()` stops services in reverse order, logging failures without blocking the rest.

Codex and MCP construction live in `core/services/`. The provider-neutral agent factory must not create either integration. Codex requests ask the MCP service to initialize again, so an app-start MCP failure remains recoverable.

## Adding a service

1. Put domain implementation in the helper/runtime folder that owns it.
2. Construct it in `main-services.js` after everything it depends on, and wire its IPC there.
3. Add async initialization to `start()` (wrapped in `bestEffort` unless the window truly cannot work without it) and teardown to `shutdown()`.
