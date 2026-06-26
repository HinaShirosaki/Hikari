# Module Manifests

This folder holds renderer module declarations for Hikari's manifest-driven module runtime.

A manifest owns one module's init function, registry key, options factory, optional view routes, and optional boot render order. `module-runtime.js` consumes the full manifest list, supplies the shared runtime context, and builds registration plus render dispatch from these declarations.

Current manifest groups:

- `foundationModuleManifests`: notebook, protocol, and project modules that other features consult early.
- `collaborationModuleManifests`: agent chat, scoped chat rail, workflow, and papers.
- `inventoryModuleManifests`: inventory and sample workspace modules.
- `analysisModuleManifests`: assay and gel modules.
- `sequenceModuleManifests`: sequence viewer initialization.
- `utilityModuleManifests`: modules that mostly attach tools or settings controls.
- `rendererModuleManifests`: the full ordered list used for module initialization and view render dispatch.

When adding a module, create a focused `<module>.js` manifest, export it from `index.js`, and put it into the right initialization group. Use `viewKey`, `viewKeys`, `viewId`, or `viewIds` to declare routes, and `navigationAliases` when a secondary route should highlight another app entry. Add `bootOrder` only when the module needs to render during `renderAll()`; the runtime uses `renderAll` if present and otherwise falls back to `render`.
