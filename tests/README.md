# Test Suite Structure

The test runner entrypoint remains `test.js`. Run it with Node.js 24, as CI
does: the vendored pdf.js needs `Promise.try`, and on Node 22 the PDF suites
crash the runner. The `*-selfcheck` scripts that launch Electron need the
Electron binary that `npm ci` downloads.

## Running a subset

Each test is tagged with the `tests/suites/` file that registered it, so the
directory tree is the category list. No manual tagging.

```
node test.js --list           # groups and test counts
node test.js '^core/'         # run one branch (npm run test:core)
node test.js '^edge/'         # npm run test:edge
node test.js '^check'         # lint + the scripts/check-*.mjs static checks
node test.js '^selfcheck'     # tests/*-selfcheck.* (npm run check:selfchecks)
node test.js sequence-viewer  # any regex, matched against "<group> <test name>"
npm test                      # build:ui + everything
npm run test:checks           # checks + selfchecks, no suites
```

## Protocol/notebook MCP after Markdown migration

`node tests/record-markdown-mcp-selfcheck.js` migrates disposable legacy records and checks
the actual MCP server, registered executors, Markdown reads, rich content,
drafts, approval saves, append guards, and damaged-file warnings.
`node tests/record-markdown-mcp-selfcheck.js --http` additionally uses a child stdio server
and an authenticated loopback HTTP app host; it requires permission to listen.
The selfcheck runs automatically in `test.js` and covers text queries combined
with filters, experiment-title search, and filter-only calls with unrelated chat
context. See `docs/main-platform/data/record-markdown-mcp-test.md` for results
and the live-connection repair.

## Electron and installed-app checks

`tests/*-electron.cjs` scripts drive a real Electron window and are not part of
`test.js` (the file name does not end in `-selfcheck`). Run one after building
the UI:

```
npm run build:ui
node node_modules/electron/cli.js tests/storage-setup-electron.cjs
```

`HIKARI_PLOTLY_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks Figura's data-backed Plot layers through the real public canvas bridge:
vendored Plotly rendering, supplied error bars, raw histogram bin counts,
heatmap pixels, strict CSP, resizing, undo, clipboard/assets, reopening,
4K PNG/SVG and PowerPoint export. Uses disposable profile/storage and no model inference.

`node node_modules/electron/cli.js tests/scientific-illustration-levels-live.cjs --live --pathways`
runs a real signed-in Codex drawing test in an isolated Figura profile: a complex
3840 × 2160 EGF signaling and trafficking pathway with saved Flat style, native
image generation, SVG connections and independent labels. It saves full-size
PNG/SVG, the scene, generated originals and a native-tool transcript summary
under `artifacts/`. This opt-in test consumes model/image-generation usage and
checks the saved style, layer mix, native image provenance and final inspection.

`HIKARI_POWERPOINT_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks Figura's PPTX export through the real save IPC using disposable artwork.
It inspects separate SVG/raster components and native text boxes, layer order,
geometry, opacity, WebP conversion, and cancellation/failure/retry. Set
`HIKARI_PLUGIN_QA_ROOT` to a packaged `Resources/app.asar` to test its host too.

`HIKARI_ROTATION_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks Figura's rotation handle with native pointer input, text and mixed groups,
Shift snapping, keyboard repeats, cancellation, concurrent edits, undo, Scratch,
zoom and panning at desktop and narrow widths. It also runs the existing move and
resize checks. Use `HIKARI_PLUGIN_QA_ROOT` for packaged-host compatibility.

`HIKARI_CLIPBOARD_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks Figura component/group copy and paste with native Ctrl/Command keyboard
input and isolated clipboard events, preserving the system clipboard. It covers
snapshot independence, media, typography, grouping, undo/redo, rapid pastes,
Scratch, cross-illustration paste, text fields, malformed input, failure/retry,
and persistence. Use `HIKARI_PLUGIN_QA_ROOT` for packaged-host compatibility.

`HIKARI_CONTEXT_MENU_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks Figura's canvas/layer right-click menu with native pointer and keyboard
input, including selection targeting, copy/paste, group/ungroup, reusable asset
saving, undo, dismissal, viewport placement, and text-field isolation. Clipboard
events use a private fixture buffer and preserve the system clipboard.

`HIKARI_HISTORY_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks real system Undo/Redo clicks through the history service and plugin API,
including button availability, frame keyboard shortcuts, text-field undo,
failure/retry, module isolation, and illustration changes. The shared-tools
fixture also checks that toolbar actions retain the system history target.
Packaged-host fixtures use the updated source focus delegate with the packaged
history service and bridge; this does not update the running installed app.

`node tests/module-history-selfcheck.mjs` covers independent module histories,
linked changes, external updates, workspace resets, draft protection, and
analysis-cache invalidation before undo/redo persistence.
`node tests/reload-persistence-selfcheck.mjs` checks the reload save barrier
with the real Markdown queue, including delayed writes, failed/skipped saves,
retry after an editor becomes clean, and discard behavior.
`node node_modules/electron/cli.js tests/module-history-electron.cjs` loads the
real renderer modules with a temporary profile and stubbed storage IPC. It
checks module routing, Inventory's shared history, editor refreshes, and
workspace history resets without touching saved workspaces.

`node tests/i18n-selfcheck.mjs` covers locale normalization, English/parent
fallback, interpolation, plural rules, date formatting, Spanish catalog keys and
parameters, and old workspace compatibility. `node node_modules/electron/cli.js tests/i18n-electron.cjs`
checks the real renderer and Settings with disposable data: English parity,
opt-in DOM translation, draft/focus/selection preservation, safe attributes,
save/discard, and undo. It uses the bundled Spanish preview; untranslated keys
fall back to English. Browser interaction checks live under `tests/fixtures/i18n/`. They verify numerical and
sequence invariance, cloned-row indices, workflow drafts/graph identity,
context menus, process creation, and module undo/redo. `execution-checks.mjs`
also covers locked steps, completion/failure/retry/reopen, optional branches,
protocol/result drafts, staged file selections and uploads, notice ownership,
notebook option metadata, dates, and locale-independent artifact paths.
`home-settings-checks.mjs` also exercises Home timers, experiment saves and
reminders, translated dock/search routing, journal/location drafts, PDF values,
and isolated updater/plugin preference/install states. No updater, install,
agent request, or file operation reaches a live backend.
`node tests/home-quick-log-inputs-selfcheck.mjs` covers Experiment log input,
IME shortcuts, autosave status, storage failure rollback/retry, and assistant
handoff failures. `node tests/home-quick-log-inputs-electron.cjs` runs realistic
notes through the production Home controls and notebook review, including
Unicode, pasted tables, literal HTML, 3,000/3,001-character boundaries, large
local notes, reload, disk serialization, and 1300/800/390px layouts. It uses a
disposable profile and simulated assistant replies; it does not evaluate a live
model or open a user workspace. Reports and screenshots go to
`artifacts/home-quick-log-inputs/`.
`notebook-checks.mjs` covers project/experiment dialogs, state badges and metadata,
notes and protocol-copy drafts, staged files and simulated imports, clarification
validation, and Home note save/cancel while switching between English and Spanish.
`protocol-checks.mjs` covers Protocols drafts, presets, previews, search/menus,
JSON imports, undo/redo, attachment selection, progress and review states, and
stale generation replies. Agent and polish responses use deterministic local
stubs, including pending requests during language changes.
`chemicals-checks.mjs` covers Chemicals drafts, filters, sorting, dates, CAS codes,
linked samples, imports and mapping fallback, SQLite notices, and undo/redo. The
fixture checks exact English summary parity and uses simulated parser/mapper/
SQLite APIs so no model, network, or live workspace is involved.
`samples-checks.mjs` covers storage navigation, folder/container creation, custom
grid values and well IDs, menu guards, inline rename, deletion/reparenting and
undo/redo. It checks that live Spanish translation preserves sample/editor drafts,
names, links, sample vocabulary and exact CSV output. Grid/plate/tube and dialog
captures use the real renderer at 1300px and 800px.
`plate-checks.mjs` covers Plate Setup/Analyze: well tooltips and axis headers,
inline well edits and form drafts across switches, fill statuses, the serial
dilution dialog, save/undo/redo, saved English dilution summaries, Analyze
headers and result notices. It exports no files and opens no native dialogs.
`papers-checks.mjs` opens a generated PDF in the real viewer and covers the rail,
toolbar, side panels, highlight popover, external-link confirm, folder rename
validation and comment drafts while switching languages.
`agent-checks.mjs` covers the Agent view and shared rail chrome (empty state, message
copy/attachments, composer draft, session folders, folder rename guard, draft,
file-change and HTML cards, quick prompts) without sending agent requests.
Spanish desktop/narrow
layout captures are written to `artifacts/i18n-es/`.

`storage-setup-electron.cjs` covers the first-launch workspace page with an
isolated temporary profile and real storage IPC/import/save handlers, with a
simulated folder picker: cancellation, failures, retry, saving, and recovery
after clearing renderer storage. Set `HIKARI_TEST_APP_ROOT` to a packaged
`app.asar` path to exercise packaged sources instead. Other Electron scripts
cover agent chat rendering, the Home notebook agent, HTML and image output,
notebook suggestions and drafts, selection insights, spreadsheet fill,
sequence CDS properties and MCP, sample suggestions, the assay chart, and the
plugin runtime.

CI (`.github/workflows/ci.yml`, macOS) runs `npm test`, then
`tests/hikari-mcp-launch-selfcheck.js` against Electron's embedded Node (the
packaged `--hikari-mcp-stdio` path), then `storage-setup-electron.cjs`.

CI also calls `.github/workflows/installer-smoke.yml` on macOS and Windows.
`node tests/installer-selfcheck.js` exercises the actual installer scripts with
download fixtures: prebuilt success, checksum rejection, missing Node, broken
and valid runtime caches, interrupted downloads, and build failure propagation.
It also checks lock publication, isolated source builds, and release asset names.
`tests/installer-bootstrap-smoke.mjs` then uses the locally packed branch with
Node/npm/npx removed from the installer's PATH. It downloads a real private Node
runtime, repairs an incomplete cache, and builds the app with locked dependencies.
Run it with `node tests/installer-bootstrap-smoke.mjs /absolute/path/hikari.tgz`.

`tests/installed-app-smoke.mjs` drives an installed build over the Chrome
DevTools protocol (`--remote-debugging-port=9333`): the opening page, Codex CLI
discovery, and a live MCP round trip. The Windows install smoke workflow runs
it; it is not part of `test.js`.

Every test reports as one `PASS [group] name` or `FAIL [group] name` line,
followed by a `passed/total` summary and a `SLOW` list of the ten slowest. The
`check` and `selfcheck` groups run each script in its own process; a script's
own output is shown only when it fails. Any `tests/*-selfcheck.{js,cjs,mjs}`
file is picked up automatically.

Suites are organized by domain under `tests/suites/`:

- `core/agent-suite.js`: loader for agent-focused suites under `core/agent-suite/`
- `core/agent-suite/*.js`: agent context and memory, notebook and protocol flows, tool execution, paper workflows, runtime state, and Codex-provider coverage
- `core/app-modules-suite.js`: loader for renderer module suites under `core/app-modules-suite/`
- `core/app-modules-suite/*.js`: renderer module behavior tests for lab/project/protocol/inventory/assay/gel/chat workflows
- `core/module-services-suite.js`: renderer cross-module service-layer behavior
- `core/codex-cli-provider-suite.js`: loader for Codex CLI provider suites under `core/codex-cli-provider-suite/` (including the MCP gateway tool surface)
- `core/contracts-suite.js`: UI/IPC contract checks, wiring checks, and packaging/config assertions
- `core/npm-updater-suite.js`: release metadata, version comparison, and the update flow
- `core/plugin-system-suite/plugin-system.js`: plugin folder contract, sandbox decision, bridge permission gate, plugin server, and service plugins
- `edge/platform-and-regression-suite.js` (+ `edge/platform-and-regression-suite/`): state normalization, data-file path normalization, module boundary guards, export contracts, and platform edge cases
- `edge/bio-tools-and-gel-suite.js`: loader for edge suites under `edge/bio-tools-and-gel-suite/`
- `edge/bio-tools-and-gel-suite/*.js`: sequence-viewer, tool-box calculators, and gel-analysis edge coverage

Shared helpers live in `tests/support/` and fixtures in `tests/fixtures/`.

Loader files:

- `core-suite.js`: registers all `core/*` suites
- `edge-suite.js`: registers all `edge/*` suites

Guidelines:

- Name each file for what it covers, not its position. The filename becomes the
  test group in `--list` output and in `node test.js <regex>`, so `part-04.js`
  costs a grep every time someone looks for a behavior.
- Keep each file scoped to a single domain.
- Add new tests to the closest domain suite; avoid creating another monolithic file.
- Prefer pure helper functions near the tests that use them unless broadly shared.
- Each suite exports `function (context)` and destructures what it uses from
  `context.scope` (`const { assert, test, path } = scope;`). The scope keys are
  the `suiteScope` object in `test.js`. `no-undef` is on for `tests/`, so a
  helper you forgot to destructure fails `npm run lint`, not the test run.

`samples-editor-checks.mjs` extends the i18n UI fixture to sample type fields and
canonical option values, validation/save/delete/clone, structure clipboard IPC,
CSV collisions, and export bytes/filename. Clipboard, URL and anchor APIs use
isolated stubs; no live clipboard or files are touched. `shared-gaps-checks.mjs`
tests the real quit/reload service against cloned dialog markup and isolated
editors/close/reload callbacks, including deferred saves, selection, failures,
retry, and CSS captions. See `docs/renderer/architecture/i18n-audit.md` for the
remaining localization surfaces reviewed after the newer module migrations.

`colony-search-checks.mjs` verifies search candidate/order/routing invariance and
live result/feedback labels, then runs the lazy Colony Counter with a generated
PNG: marker add/remove, mask counts and crop cancellation use the real UI and
CropperJS. Deferred model callbacks use the controller factory's defaultable model
dependency, preserve output geometry/scores/settings and verify translated busy/error
states without touching user images, user files or a model/network service. Colony
and crop-menu layout captures run at 1300px and 800px.
