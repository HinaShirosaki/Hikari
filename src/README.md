# Source Layout

`src/` is split by runtime boundary:

- `main/`: Electron main process. `main.js` starts the generic lifecycle in `core/`; `core/catalog/` declares services; `ipc/` exposes adapters; `helpers/` contains domain implementations.
- `renderer/`: browser-side application. `core/` boots the shell, `module-manifests/` declares feature wiring, `modules/<feature>/` owns each workspace, and `services/` handles cross-feature fan-out.
- `shared/`: process-neutral contracts used across runtime boundaries, such as IPC channel names.

The intended dependency direction is:

```text
main ─────┐
          ├──> shared
renderer ─┘
```

`main/` must not import renderer controllers or UI code. The Sequence Viewer storage adapter has one explicit exception: it invokes process-neutral matching code from `renderer/modules/sequence-viewer/algorithms/` so the feature's domain implementation remains colocated. Renderer features should communicate through manifest options and `renderer/services/`, not by importing another feature's controller.

## Useful entry points

- Main boot: `main/main.js` → `main/core/start-hikari-main-core.js`
- Main composition: `main/core/main-service-catalog.js` → `main/core/catalog/`
- Renderer boot: `renderer/renderer.js` → `renderer/core/start-hikari-core.js`
- Renderer feature wiring: `renderer/module-manifests/index.js`
- Renderer state: `renderer/modules/app-state.js` → `renderer/modules/app-state/`
- Sequence Viewer feature logic: `renderer/modules/sequence-viewer/`

## Generated files

Do not hand-edit `renderer/modules/views.js`, `renderer/modules/app-registry.generated.js`, or either `llm-provider-config.generated.js`. `npm run build:ui` regenerates them from `ui/config/app-registry.json`, `ui/`, and `config/llm-providers.json`.

For deeper maps, start with `docs/README.md`.
