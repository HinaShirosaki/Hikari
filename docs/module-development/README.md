# Module Development Guide

This guide explains how to build a new feature module for the Hikari renderer. The renderer is an Electron-hosted single-page app whose UI is composed from per-view HTML fragments and per-view CSS files, glued together by a shared shell, a generated app registry, the renderer core, module manifests, and a thin module runtime.

There is **no plugin discovery**. Adding a module means editing a small, well-defined set of files. Once you understand the contract, the work is mechanical.

## Reading order

1. [01-overview.md](./01-overview.md) — Big-picture architecture: the build pipeline, the renderer boot, what counts as a "module."
2. [02-html-and-css.md](./02-html-and-css.md) — The universal HTML shell and CSS layers. How view fragments slot into `index.html`, the shared `left-rail-template` layout, and the build-time validation rules.
3. [03-module-contract.md](./03-module-contract.md) — The `init*()` function contract: what manifests pass you, what you must return, the registry, and the cross-module service layer.
4. [04-adding-a-new-module.md](./04-adding-a-new-module.md) — A step-by-step recipe for adding a new view from scratch: every file you must touch.
5. [05-cross-module-and-services.md](./05-cross-module-and-services.md) — Talking to other modules through services, the `hikariApi` bridge, and the persisted state object graph.
6. [06-checklist.md](./06-checklist.md) — Pre-flight checklist, naming conventions, and the build-time errors you can expect to hit.

## TL;DR

A "module" in this codebase is the triple:

| Layer | File(s) |
| --- | --- |
| **Markup** | one HTML fragment in `ui/html/views/<id>-view.html` |
| **Styles** | one CSS file in `ui/css/views/<id>-view.css` |
| **Logic** | one folder entry at `src/renderer/modules/<name>/index.js` exporting `init<Name>(options)` |

Plus three small wiring edits and one icon:

1. `ui/config/app-registry.json` — declare the view key/id, order, dock entry, subtitle, icon, and aliases.
2. `src/renderer/module-manifests/<name>.js` — declare your `init<Name>`, registry key, options factory, and optional render hooks.
3. `src/renderer/module-manifests/index.js` — export the manifest in the appropriate family.
4. `assets/icons/<icon>.svg` — add the SVG referenced by the registry entry.

The UI build discovers the matching HTML and CSS from the registry and generates `modules/views.js`; neither generated output is edited by hand.

Then run `npm run build:ui` and start the app. The full recipe with snippets is in [04-adding-a-new-module.md](./04-adding-a-new-module.md).

## Things that are not a "module"

These are loaded through their own paths and are out of scope here:

- **Agent skills** under `skills/` — read at runtime by `src/main/helpers/agent/skills/agent-skill-runtime.js`. Excluded from the Electron bundle (`forge.config.js`).
- **Exported standard features** (`src/renderer/modules/sequence-viewer/data/exported-standard-features.js`) — pre-built data file generated from `Exported Standard Features/` by `npm run extract:standard-features`. It is data, not a UI module.
- **LLM provider config** (`src/renderer/modules/llm-provider-config.generated.js`) — generated from `config/llm-providers.json` by the same `build:ui` step.

If you need to extend any of those, see the corresponding generator script under `scripts/`.
