# Renderer Core

`src/renderer/core/` is the renderer composition boundary for Hikari.

The core owns application boot, shared state persistence, service registry creation, module runtime creation, storage hydration, navigation, topbar search routing, and the final `hikari:app-ready` event.

Feature modules should keep domain behavior in `src/renderer/modules/`. The core should wire modules and services together, but it should not own protocol, notebook, inventory, assay, paper, sequence, or agent business logic. Plugin-owned features, such as Gel, stay outside `src/renderer/modules/` entirely.

Domain-specific external events should be delegated at the boundary. For example, the core subscribes to `onProtocolRecordSaved`, while `services/protocolService.js` normalizes and merges the protocol record.

Current flow:

1. `src/renderer/renderer.js` calls `startHikariCore()` directly.
2. `startHikariCore()` boots state, services, manifest-declared modules, storage, navigation, and search.
3. `module-runtime.js` composes feature manifests, and `manifest-runtime.js` fences each manifest's `init` and `render` so one failing module is logged and skipped instead of taking the shell down. `app/` owns navigation, search, plugins, storage setup, and shared shell behavior.

The full boot order is in [docs/renderer/architecture/boot-and-shell.md](../../../docs/renderer/architecture/boot-and-shell.md).

Module registration and route metadata live in `src/renderer/module-manifests/`; the core does not maintain a second feature switchboard.
