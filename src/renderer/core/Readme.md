# Renderer Core

`src/renderer/core/` is the renderer composition boundary for Hikari.

The core owns application boot, shared state persistence, service registry creation, module runtime creation, storage hydration, navigation, topbar search routing, and the final `hikari:app-ready` event.

Feature modules should keep domain behavior in `src/renderer/modules/`. The core should wire modules and services together, but it should not own protocol, notebook, inventory, assay, gel, paper, sequence, or agent business logic.

Domain-specific external events should be delegated at the boundary. For example, the core subscribes to `onProtocolRecordSaved`, while `services/protocolService.js` normalizes and merges the protocol record.

Current flow:

1. `src/renderer/renderer.js` calls `startRendererApp()`.
2. `src/renderer/app/start-renderer-app.js` remains a compatibility wrapper.
3. `startHikariCore()` in `start-hikari-core.js` boots state, services, manifest-declared modules, storage, navigation, and search.

Module registration and route metadata live in `src/renderer/module-manifests/`; the core does not maintain a second feature switchboard.
