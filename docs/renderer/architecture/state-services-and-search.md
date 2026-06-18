# State, Services, And Search

This doc explains the cross-cutting runtime pieces that sit underneath the feature modules: `modules/views.js`, `modules/app-state.js`, `modules/utils.js`, `services/`, the module registry, and the topbar search pipeline in the renderer core.

## Canonical renderer state

Renderer-wide contracts are split across a few small files:

They define:

- `src/renderer/modules/views.js`: `VIEWS` and `TITLES`
- `src/renderer/modules/app-state.js`: `defaultState`, normalization, local-storage load/persist, and LLM settings normalization
- `src/renderer/modules/utils.js`: small utilities such as `createId()`, `safeText()`, and `cssEscape()`

The important thing is that `defaultState` is broad. It is not only UI preferences. It also contains the app's core working data:

- members, instruments, protocols, projects
  - `members` and `instruments` are retained for back-compat; their dedicated workspaces are no longer surfaced in navigation, but the state branches still load and normalize
- workflows and workflow templates
- notebook entries
- assays and gel analyses
- papers and paper links
- samples, inventory containers, and common-chemicals inventory
- agent-chat session/message state
- settings, storage metadata, and growth metrics
- the derived `objectGraph`

## Normalization and migration behavior

`normalizeState(parsed)` does more than type cleanup. It is also where renderer-local schema migration happens.

Examples:

- it fills in missing branches from `defaultState`
- it normalizes paper comments
- it upgrades legacy LLM settings into the current `provider` plus `apiEndpoint` plus `apiKey` shape
- it normalizes startup settings and dashboard progress maps
- it upgrades legacy chemistry draft storage into the current `synthesisChemistryDrafts` layout

So when reading feature code, assume most modules receive a reasonably normalized state tree.

## Persistence model

There are two persistence layers to keep in mind:

1. `persistState(state)` in `modules/app-state.js`
   - writes the local renderer snapshot to `localStorage`
2. `persist()` in `core/start-hikari-core.js`
   - rebuilds `state.objectGraph`
   - writes local storage
   - optionally auto-saves the `.ena` data file through the main-process bridge

The second one is the important runtime callback. Feature modules receive `persist()` and treat it as the canonical "commit local changes" operation.

## Object graph as derived state

`src/renderer/modules/object-graph.js` builds a relationship graph from the app's domain records.

It links things like:

- projects to workflows
- workflows to blocks and notebook entries
- notebook entries to protocols, samples, chemicals, papers, instruments, and people
- assays and gels to notebook entries and projects
- samples to chemicals, containers, and physical locations

The graph is rebuilt frequently enough that it behaves like a derived index rather than a source of truth.

That is why `persist()` and `renderAll()` both rebuild it.

## Module registry

`src/renderer/services/module-registry.js` is intentionally tiny. It is just a `Map` with:

- `register(name, api)`
- `get(name)`

What makes it useful is the mix of things stored inside it:

- feature-module APIs such as `assay`, `gel`, `projectManagement`, or `sequenceViewer`
- shell helpers such as `showView`
- constants such as `VIEWS`
- small utilities like `setSearchInputValue`

That gives the renderer a light dependency-injection layer without requiring direct imports between unrelated feature modules.

## Service layer

`src/renderer/services/` is the renderer's cross-feature glue. The services are small on purpose.

| Service | Main job |
| --- | --- |
| `protocolService.js` | protocol imports, external saved-protocol merges, share/import refreshes, and paper-to-protocol draft creation |
| `notebookService.js` | rerender notebooks, workflows, assay links, and gel links when notebook pages change |
| `projectService.js` | rerender all project-bound views when projects change |
| `inventoryService.js` | rerender sample registry and route dashboard sample-search handoffs |
| `analysisService.js` | update project notebook rollups after assay/gel changes |
| `sequenceService.js` | hand off external payloads into the sequence viewer and open the detail view |

The key design choice is that services do not own separate stores. They usually translate "feature X changed" into "which other views need to refresh?", and when they do mutate state, such as the protocol service merging an externally saved protocol, they use the shared renderer state plus `persist()` callback injected by the core.

## Search pipeline

The topbar search in the renderer core has more routing logic than a normal text filter.

It supports three progressively broader modes:

1. Scoped commands
   - `assay: egfr`
   - `gel ladder`
   - `samples colony-7`
2. View aliases
   - `papers`
   - `workflow`
   - `dna`
3. Global matching
   - scores known records and routes to the best matching feature workspace

The search system is powered by:

- app aliases from `APP_REGISTRY`
- optional per-app `searchInputId`
- generated scope maps such as "which search box belongs to `chemicals`?"
- candidate builders over protocols, projects, papers, chemicals, samples, assays, gels, notebooks, and inventory containers

When a target feature has its own search input, the shell sets that DOM value and dispatches an `input` event instead of trying to search the feature data directly.

## Telegram command routing

The search system also doubles as an automation target.

`handleTelegramCommand(payload)` can:

- open a view directly
- route searches into chemical, sample, assay, or gel views
- trigger the same global-search path used by the topbar

That is why the alias maps and target maps live in the renderer core instead of inside any single feature module.
