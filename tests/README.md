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

`HIKARI_HISTORY_QA_ONLY=1 node node_modules/electron/cli.js tests/scientific-illustration-electron.cjs`
checks real system Undo/Redo clicks through the history service and plugin API,
including button availability, frame keyboard shortcuts, text-field undo,
failure/retry, module isolation, and illustration changes. The shared-tools
fixture also checks that toolbar actions retain the system history target.
Packaged-host fixtures use the updated source focus delegate with the packaged
history service and bridge; this does not update the running installed app.

`node tests/module-history-selfcheck.mjs` covers independent module histories,
linked changes, external updates, workspace resets, and draft protection.
`node node_modules/electron/cli.js tests/module-history-electron.cjs` loads the
real renderer modules with a temporary profile and stubbed storage IPC. It
checks module routing, Inventory's shared history, editor refreshes, and
workspace history resets without touching saved workspaces.

`storage-setup-electron.cjs` covers the first-launch workspace page with an
isolated temporary profile and real storage IPC/import/save handlers, with a
simulated folder picker: cancellation, failures, retry, saving, and recovery
after clearing renderer storage. Set `HIKARI_TEST_APP_ROOT` to a packaged
`app.asar` path to exercise packaged sources instead. Other Electron scripts
cover agent chat rendering, the Home notebook agent, HTML and image output,
notebook suggestions and drafts, selection insights, spreadsheet fill,
sequence CDS properties and MCP, sample suggestions, the assay chart, and the
plugin runtime.

`cloud-drive-electron.cjs` exercises Google Drive and Dropbox controls through
real preload/storage/cloud IPC with in-memory providers and a temporary profile.
It checks sign-in cancellation, workspace linking, upload/download, conflicts,
offline retry, disconnection, and responsive layout. `cloud-drive-selfcheck.js`
adds provider HTTP, credential, OAuth callback, and two-device sync checks. These
fixtures do not sign in to live accounts; see `docs/main-platform/data/cloud-drives.md`
for OAuth application configuration and the limits of this verification.

CI (`.github/workflows/ci.yml`, macOS) runs `npm test`, then
`tests/hikari-mcp-launch-selfcheck.js` against Electron's embedded Node (the
packaged `--hikari-mcp-stdio` path), then `storage-setup-electron.cjs`.

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
