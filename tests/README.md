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

## Electron and installed-app checks

`tests/*-electron.cjs` scripts drive a real Electron window and are not part of
`test.js` (the file name does not end in `-selfcheck`). Run one after building
the UI:

```
npm run build:ui
node node_modules/electron/cli.js tests/storage-setup-electron.cjs
```

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
