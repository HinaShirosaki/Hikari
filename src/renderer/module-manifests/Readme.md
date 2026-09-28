# Module Manifests

This folder holds renderer module declarations for Hikari's manifest-driven module runtime.

A manifest owns one module's init function, registry key, options factory, optional view routes, and optional boot render order. `../core/module-runtime.js` consumes the full manifest list, supplies the shared runtime context, and builds registration plus render dispatch from these declarations.

Current manifest groups:

- `foundationModuleManifests`: Biology Notebook (including project ownership) and protocol modules that other features consult early.
- `collaborationModuleManifests`: agent chat, scoped chat rail, workflow, and papers.
- `inventoryModuleManifests`: inventory and sample workspace modules.
- `analysisModuleManifests`: the assay (Plate) module. Gel is a bundled plugin now, not a manifest.
- `sequenceModuleManifests`: sequence viewer initialization.
- `utilityModuleManifests`: Tools, Settings, and the Home dashboard.
- `rendererModuleManifests`: the full ordered list used for module initialization and view render dispatch.

Each group is loaded with `loadManifests(...)`, which imports every manifest on its own so one that fails to load is logged and skipped instead of breaking the renderer.

When adding a module, create a focused `<module>.js` manifest and add a `['./<module>.js', '<name>Manifest']` row to the right group in `index.js`. Use `viewKey`, `viewKeys`, `viewId`, or `viewIds` to declare routes, and `navigationAliases` when a secondary route should highlight another app entry. Add `bootOrder` only when the module needs to render during `renderAll()`; the runtime uses `renderAll` if present and otherwise falls back to `render`.
