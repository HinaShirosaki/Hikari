# Main Core

`src/main/core/` is the main-process composition boundary for Hikari.

`start-hikari-main-core.js` is intentionally business-agnostic. It creates a generic service lifecycle from the static catalog facade in `main-service-catalog.js` and exposes only:

- `appIconPath`
- `registerIpcHandlers()`
- `onAppReady()`
- `shutdown()`
- `getService(key)` / `listServices()`

Electron lifecycle concerns stay in `src/main/app/`. `start-main-app.js` registers IPC before readiness, creates the window after Electron becomes ready, starts the services, and stops them before quit. `main-runtime.js` remains a compatibility wrapper for older imports of `createMainRuntime()`.

## Internal service contract

Each entry in `main-service-catalog.js` has:

```js
{
  key: 'service-name',
  dependsOn: ['another-service'],
  policy: 'required', // or 'best-effort'
  create({ context, dependencies, getService }) {},
  registerIpc({ service, dependencies }) {},
  async start({ service, dependencies }) {},
  async stop({ service, dependencies }) {}
}
```

`create()` is synchronous and owns construction only. Async initialization belongs in `start()`. IPC contribution belongs in `registerIpc()`. Long-running resources must be released in `stop()`.

The lifecycle validates duplicate keys, missing dependencies, and cycles; constructs and starts services in dependency order; records best-effort startup failures without blocking later services; and stops services in reverse order. Registration, startup, and shutdown are idempotent.

## Current service boundaries

- app metadata and paths
- storage plus sequence APIs
- provider-neutral agent foundation
- MCP host and workspace initializer
- Codex runtime
- completed agent-controller facade
- logging/monitoring, prompt loading, and Telegram
- best-effort packaged-app update checks against npm metadata
- data, agent, and system IPC adapters

Codex and MCP construction live in `core/services/`. The provider-neutral agent factory must not create either integration. Codex requests ask the MCP service to initialize again, so an app-start MCP failure remains recoverable.

The definitions themselves are grouped under `core/catalog/`: app/storage services, agent integrations, and IPC adapters. `main-service-catalog.js` only preserves their dependency order.

## Adding a service

1. Put domain implementation in the helper/runtime folder that owns it.
2. Add one catalog definition with a unique `key` and explicit `dependsOn`.
3. Keep dependency bags inside the service definition rather than adding domain imports to `start-hikari-main-core.js`.
4. Use `best-effort` only for integrations whose startup failure should not prevent the main window from working.
5. Add lifecycle or integration coverage for ordering, IPC registration, and cleanup.

The catalog is static and internal. It is not a dynamic plugin loader.
