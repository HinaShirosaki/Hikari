# Source Layout

`src/` is split by runtime boundary:

- `main/`: Electron main process. `main.js` defers to `core/main-services.js`, which constructs services and registers IPC; `ipc/` exposes registrars; main-owned feature services such as Papers live beside that infrastructure.
- `renderer/`: browser-side application. `core/` boots the shell, `module-manifests/` declares feature wiring, `modules/<feature>/` owns each workspace, and `services/` handles cross-feature fan-out.
- `shared/`: process-neutral contracts used across runtime boundaries, such as IPC channel names.

The intended dependency direction is:

```text
main ─────┐
          ├──> shared
renderer ─┘
```

`main/` must not import renderer controllers or UI code. Its one explicit Sequence Viewer entry is the Node-only `renderer/modules/sequence-viewer/main-process/` subtree, which may use process-neutral matching and parsing code from its sibling feature folders. Browser-side renderer files must never import that Node-only subtree. Renderer features should otherwise communicate through manifest options and `renderer/services/`, not by importing another feature's controller.

## Useful entry points

- Main boot: `main/app/start-main-app.js` → `main/core/main-services.js`
- Renderer boot: `renderer/renderer.js` → `renderer/core/start-hikari-core.js`
- Renderer feature wiring: `renderer/module-manifests/index.js`
- Renderer state: `renderer/modules/app-state.js` → `renderer/modules/app-state/`
- Sequence Viewer feature logic: `renderer/modules/sequence-viewer/`
- Sequence Viewer storage/database services: `renderer/modules/sequence-viewer/main-process/sequence-library/`

## Generated files

Do not hand-edit `renderer/modules/views.js`, `renderer/modules/app-registry.generated.js`, or either `codex-model-catalog.generated.js`. `npm run build:ui` regenerates them from `ui/config/app-registry.json`, `ui/`, and `config/codex-models.json`.

For deeper maps, start with `docs/README.md`.
