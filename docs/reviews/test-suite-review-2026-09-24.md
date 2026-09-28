# Test suite review — 2026-09-24

Every test was reviewed for two questions: is it necessary, and is it correct? A test counts as incorrect if it cannot fail, asserts something other than what its name claims, or is stale. The scope was `node test.js` (1220 tests at `a751de7f`: 1131 in-process suite tests, 4 static checks, 85 `tests/*-selfcheck.*` scripts) plus the 17 Electron and browser scripts that `npm test` does not run.

Most of the suite is sound. The domain tests are behavioural and use discriminating fixtures. The science in the cloning, alignment, tool-box, CRISPR and molarity tests checks out by hand, and the selfchecks are frequently the only coverage of their modules. The problems cluster in five places:

- Assertions that cannot fail, or no longer test what their names say (fixed below).
- Tests that regex source text but claim behaviour.
- A mock DOM that silently invents any element a test asks for.
- A runner that only groups POSIX paths.
- Electron scripts that no CI job runs.

## How it was checked

- **Baseline** on Node 24.21 after `npm run build:ui`: 1215/1220 pass, the same five failures as CI on `main`. All 17 Electron/browser scripts were also run under `xvfb`.
- **Mutation testing.** For suspicious tests, the production code was broken on purpose and the suite rerun. A test that stays green is not testing its claim. Every fix below was re-verified against the mutation that exposed it; all source files were restored afterwards.
- **Selfcheck meta-test.** A preload made the first, middle and last `node:assert` call of each selfcheck throw: 84/84 and 168/168 runs exited non-zero, so no selfcheck swallows failures. `pdf-corner-icon` has no `assert` calls, so it was checked by mutation: a blank icon makes it exit 1.
- **Static scans.**
  - AST scan for tests whose assertions read repository source text: 24 predominantly source-grep, 16 mixed.
  - Zero-assertion tests; un-awaited `rejects`; early returns.
  - Element ids requested from the mock DOM compared against the built markup.
- **Environment sweeps:**
  - Five time zones including UTC+14 and UTC−11, plus a `de_DE` locale: identical results.
  - A network and subprocess trap: no test touches the network. 19 spawn `python3`, `bash` or `node`.
  - A per-test leak detector covering env, cwd, globals, handles and `tmp/` leftovers.

## Fixed in this change

| Test | What was wrong | Evidence | Now |
| --- | --- | --- | --- |
| `test.js` `callerGroup()` (runner) | Stack-frame regex only matched POSIX paths and group names kept `\`, so on Windows every suite test was grouped `root`. | The Windows `runtime-startup` CI job (as run on `claude/loving-galileo-x1tzj2`) reports "No tests matched" for `^core/codex-cli-provider-suite/...`. | Matches drive-letter paths and always joins groups with `/`; POSIX grouping unchanged (`--list` identical). |
| root `bundled Gel migration copies legacy records…` | The "moved storage root" case left the old absolute path on the fake disk, so the relative-path fallback was never used. | Emptying the fallback list kept the test green. | Old root removed from the fake disk; asserts the copied bytes came from the moved root. |
| root `Finder launches prefer standard user Python installs on macOS` | Returned immediately off macOS, so CI (Linux) never checked anything. | — | The candidate table is asserted on every platform; only the real-install probe stays macOS-only. |
| `python sandbox executes deterministic readback payload and emits lifecycle callbacks` | Asserts inside `onTaskStarted`/`onHeartbeat`/`onTaskCompleted` are caught by `callLifecycleHook` and turned into warnings. | A wrong expectation inside a hook still passed. | Asserts `result.warnings` is empty, so hook failures surface. |
| `agent tool-call runtime surfaces executor failures without built-in fallback behavior` | Copy of the "missing executor" test; never registered an executor that throws. | Rethrowing every executor error left the full suite green. | Registers a throwing executor (expects the `ok:false` envelope) and checks that stopped requests still propagate. |
| `protocol-management keeps interactive-bar presets outside the Steps label hit area` | Looked for `data-protocol-placeholder-preset` in static markup, where it never exists. | Wrapping the preset host in a `<label>` kept it green. | Checks that no `<label>` contains `#protocol-placeholder-presets`. |
| `assay agent TSV formatter preserves object-row cells` | Regex over `context.js`; never called the formatter. | Blanking object-row cells left the suite green. | Builds the real agent context and checks both object-row and array-row TSV output. |
| `gel-analysis clusterBandsAcrossLanes case 1–2` | 100 and 103 kDa (within the 5% merge tolerance) only had to yield `>= 1` group. | Never merging kept it green. | Exact groups and centre masses. |
| `gel-analysis histogram percentile … case 1–4` | Only checked `0 <= low <= high <= 1`. | Returning `{low: 0, high: 1}` always kept the suite green. | Hand-derived 2nd/98th percentiles (e.g. 3/255 and 250/255 for a 0–1 ramp). Renamed "…percentile values…". |
| `gel-analysis normalizeArrayRange bounds case 1–3` | An all-zero output passed. | Writing zero for every pixel kept it green. | A flat image stays flat; fixtures whose percentiles are their extremes map to themselves. |
| `tool-box estimatePI bounds case 1–4` | Any value in 0–14 passed. | `estimatePI` returning 7 kept the suite green. | Expected pI from Henderson–Hasselbalch with the module's pKa table: KRR 12.49, DEE 2.90, all-20 peptide 7.19. |
| `sequence-viewer vector builder inserts on the chosen side, in strand order` | Every check after a click was `note.innerHTML === ''`; the side was never observed. | Ignoring strand kept it green. | Inserts 10 bases for each side/strand and reads the feature ranges from the map (His6 5′→6, 3′→24; reverse Terminator 5′→50, 3′→30). |
| 3 tests in `session-switching` and 1 in `scoped-chat-context` | Asserted on, or clicked, `#agent-new-chat-btn`, removed from the markup in `ea123181`. The mock DOM invents it, so the tests exercised dead code. | New Chat now lives on each session-folder row. | Tests use the rendered per-folder buttons and the session list's delegated click. Disabling the rendered state, the click guards or the handler each fail a test. |
| `main window keeps the renderer sandboxed behind the split preload` | The name contradicts the pinned `sandbox: false`, and it was a source grep. | — | Renamed "…isolates the renderer and loads the split preload outside the OS sandbox"; asserts the `webPreferences` actually passed to `BrowserWindow`. |
| `main agent chat logging records request/result/error with redacted API key metadata` | The security part was a grep for `apiKeyProvided: Boolean(...)`. | — | Drives the real chat handler with an API key, then checks log entry types and scans every log line and saved session file for the key. Adding the key to the summary fails it. |
| `biology-notebook buffer preparer floats one autocomplete menu and appends ingredients beyond its starter rows` | Seven regexes over function names; no behaviour. | Making `closeOtherBufferSuggestions` a no-op kept the suite green. | Drives the real sidebar controller. Checks that the menu floats and flips above the field, that only one menu is open, and that "+" adds row 7 above the anchor. Four mutations each fail it. |
| `papers selection search popover dismisses on outside document pointer down` | Regexes over two controllers. | An early return in the handler kept the suite green. | Installs both controllers, binds the real document listener and fires pointer downs inside and outside. Three mutations each fail it. |
| `request-failure-handling` | Comment said "the pill ships hidden in the markup"; another test asserts the pill is gone. | — | Comment corrected (only `#home-agent-status` exists). |
| selfcheck `agent-chat-icons` | `id="X"[\s\S]*?data-agent-chat-icon="Y"` scanned the concatenated markup, so a later button's icon satisfied an earlier button. | Removing the icon from `#agent-attach-btn` kept it green. | Match stops at the button's own `</button>`. Same fix for the two send buttons in `hikari-agent-action-icons`. |
| selfchecks `buffer-rows`, `fixed-reaction-rows` | Row 7 checked with `/\d/` and `/10/`, which also matches 100. | — | Exact values: `8.766 g` (150 mM × 1 L × 58.44 g/mol) and `10 uL`. |
| `assay-chart-electron.cjs` | Stale since `2d22280d` added the Elements tab; it also counted hidden tabs in its label and layout checks. | Failed at baseline. | Only visible tabs are checked; the script passes all phases again. |

## Removed as unnecessary

| Test | Why |
| --- | --- |
| `core/contracts-suite/sequence-mcp-contracts` (2 tests) | Ran `node --test` on `sequence-mcp-selfcheck.cjs` and `sequence-mcp-skill-selfcheck.cjs`, which the selfcheck group already runs (added 09-08, before selfcheck auto-discovery on 09-15). About 7 s per run for no extra coverage. |
| `gel-analysis internal functions are exposed for unit tests` | `typeof` checks only. Every name is either in `loadEsmStyleModule`'s `additionalExports` (a missing name throws at load) or called by another test. |
| `normalizeState adds empty comments array to papers missing comment data` | Identical to the `papers` branch of `normalizeState preserves valid array for "papers"`. |

## Found but not changed here

### Baseline failures

The five baseline failures are already fixed on the unmerged branch `claude/loving-galileo-x1tzj2` (`18cfbf19`), so this change leaves those files alone:

- `check css-colors`: a correct check that caught a real regression. `color-mix(in srgb, #000 18%, transparent)` appears in three view stylesheets.
- `selfcheck pdf-export-template`: stale. Its fake canvas keys on `./assets/loadingicon.png`, but branding now uses `./assets/icons/hikari-button.svg`, so the corner icons are counted as figures.
- Two `personal-inventory` tests: stale (`title=` became `data-hover-caption=`; Fill Wells became an icon toggle).
- `selfcheck pdf-corner-icon`: environmental. It launches real Electron inside `npm test` and needs a display.

### Product bugs surfaced by the tests

- **Assay chart Elements tab wraps.** On agent-built plots all five tabs are shown, but `.assay-chart-style-tabs` has a four-track grid (`ui/css/views/assay-view/chart-formatting.css`). Measured in Electron: Elements drops to a second row (y = 163 vs 129). No test covers the five-tab state.
- **Embedded Electron MCP launch on Linux.** It dies without a display (`hikari-mcp-launch-selfcheck` in Electron mode). Being addressed on the branch above.

### Mock DOM invents markup

`createMockDocument().getElementById` creates any id it is asked for, so tests keep passing after markup is removed. About 20 assertions check `#agent-status`, which the main agent view no longer has. Dead fixture ids include `agent-clear-btn`, `protocol-sort-menu(-btn)`, `cancel-biology-notebook-edit-btn` and `biology-notebook-table-size-close/cancel-btn`. The `newChatBtn` wiring in `agent-chat/dom-bindings.js`, `event-bindings.js` and `shell-controller.js` has no element on any surface and is kept alive only by these tests.

Recommendation: make the mock throw on unknown ids unless a test whitelists them, or add a check that every wired id exists in `index.html`.

### Tests that grep source text but claim behaviour

About 21 remain, and they cannot detect behaviour bugs.
- **Behaviour claims:**
  - `papers PDF viewer virtualizes page rendering and prunes offscreen canvases`
  - `papers PDF loading prefers stored bytes…`
  - `assay treats loading a saved plate as a clean setup…`
  - `renderer storage import wiring runs on save callback…`
  - `settings split constructs extracted callbacks…`
  - `gel-plugin-selfcheck` `checkAdapterContract` (~35 assertions such as "persist waits for the host write" checked as `/await hikari\.call\('storage\.set'/`)
- **Design snapshots** (exact px, attribute order):
  - the four "compact accessible icon(s)" tests
  - Clarify/Save placement
  - protein-builder flat sections
  - tool-box flat surface
  - gel lane profile and peak editor
  - workflow editor headings
  - `dialog-style` and `hikari-agent-action-icons` (its negative checks depend on `id` coming before `class`)
- **Removal guards:**
  - trace panel
  - gel summary controls
  - legacy chemical JSON
  - primer-order dialog
  - status pill

  These are reasonable as guards, but should say so in their names.

### Weak, brittle or flaky-risk tests

- **Weak:**
  - `interpretLane`, `computeLaneConfidence`, `peptideStats` and the assay standard-curve shape test check only shape.
  - The cloning "threshold level" test only checks the enum.
  - `agent observability replays lifecycle and llm traces in order` has one event and never checks order.
  - `assay-concentration-unit` only checks `inputVolume > 0`.
- **Brittle:**
  - `…agent sub-app API layer…` requires `listAgentProtocols` to be called at least twice.
  - The codex-suite packaging test greps `forge.config.js` although the parsed config is in scope.
  - `project-research-memory` slices the renderer's `sanitizeFolderName` out of source text to prove parity; sharing the helper would be better.
- **Flaky risks:**
  - The cloning "rejected without a long scan" test asserts under 2000 ms of wall clock.
  - The paper-download progress test sleeps a fixed 10 ms.
  - The `assay-plot-agent` bridge uses a 60 ms timeout.
- **Mega-tests that hide later coverage after the first failure:**
  - `agent MCP gateway exposes direct Hikari tools only` (750 lines, 211 assertions)
  - the pdf-to-md helper test
  - `agent-memory-safety-selfcheck`
- **Partial duplicates:**
  - `normalizeDataFilePath` tables in two suites.
  - `shared agent cleanText keeps long strings intact` (the second argument is ignored).
  - The tool-catalog schema test repeats load-time validation.
  - `generic tool executor stays free of per-tool hardcoding` checks a hard-coded 16 of the 19 catalog tools.

### Runner and environment

- The runner has no skip state, so platform-guarded tests report PASS while doing nothing.
- An async error that escapes a test kills the whole run. On Node 22, pdf.js's `Promise.try` does this during `main agent services enable the default browser download session…`, which also leaves `pdfjsLib`/`DOMMatrix` on `globalThis`. `package.json` has no `engines` field although Node ≥ 24 is required. Recommendation: trap `uncaughtException`/`unhandledRejection` per test and declare `engines`.
- The suite needs `python3` (5 tests), `bash` (2) and `node` subprocesses (12 after this change). The `python-ipc` selfcheck silently skips its end-to-end case without Python. `image-output` uses `fs.symlink`, which is POSIX-only.
- `codex cli provider does not write Hikari files at filesystem root` calls the real writers with root `/`. A regression run as root would create `/AGENTS.md`. Use an injected fs or a temporary root.
- None of the 17 Electron/browser scripts runs in CI. Electron is only exercised automatically by the `pdf-corner-icon` selfcheck (inside `npm test`) and by `hikari-mcp-launch-selfcheck`'s Electron mode (the `runtime-startup` job). All 17 pass locally under `xvfb` after the fix above, but nothing stops them rotting, as `assay-chart-electron` did. Recommendation: an `xvfb` CI job, or prune them.

### Housekeeping

- Four root plugin tests leave `tmp/my-plugin`, `tmp/remote-plugin`, `tmp/svc-plugin` and `tmp/served-plugin` behind.
- The 23 root tests belong in a suite file, as `tests/README.md` asks.
- Several tests are misfiled; for example, about 9 of the 22 in `pdf-to-markdown-extraction` are download or workflow tests.
- These tracked files are referenced by nothing and look like artifacts of a run with `tests/` as the storage root (`6f469998`):
  - `tests/Protocol/protocol.index.sqlite`
  - `tests/Samples/samples.json`
  - `tests/Workflow/workflow-status.sqlite`
  - `tests/hikari-chemicals.index.sqlite`
- `tests/fixtures/*.html` are manual visual harnesses, not tests.

### Science notes

- **Oligo MW convention.** The oligo properties pin molecular weight as the plain sum of anhydrous residue weights with no end correction. A synthetic 5′-OH DNA oligo is about 62 g/mol lighter, roughly 1% for a 20-mer.
- **Extinction coefficient.** It ignores nearest-neighbour hypochromicity.

Both are defensible if deliberate; the convention should be stated.

## Verdict by area

| Area (tests at baseline) | Verdict |
| --- | --- |
| Root `test.js` (23) | Keep all 23. Gel migration test fixed; macOS Python test made meaningful off macOS. |
| `core/agent-suite` (166) | Keep. Python sandbox hook test and tool-call dispatch duplicate fixed; one weak observability test; misfiled download tests. |
| `core/app-modules-suite` (161) | Keep the behaviour tests. Eight tests fixed (TSV, presets label, buffer menus, popover, four New Chat tests), plus one stale comment. Remaining source-grep and design-snapshot tests listed above. |
| `core/codex-cli-provider-suite` (122) | Strong (injected fs, clocks and fake CLIs). Flag the filesystem-root hazard and the 211-assertion mega-test. |
| `core/contracts-suite` (61) | Keep. Duplicate sequence-mcp wrapper removed; sandbox test renamed and made behavioural; redaction test made behavioural. |
| `core/module-services-suite` (13), `core/npm-updater-suite` (2) | Keep all. |
| `edge/bio-tools-and-gel-suite` (460) | Keep. Science verified. Five weak test families (14 cases) fixed and one unnecessary test removed. |
| `edge/platform-and-regression-suite` (123) | Keep. One exact duplicate removed. |
| Static checks (4) | Keep; `css-colors` is currently catching a real regression. |
| Selfchecks (85) | Keep all. Every one propagates failures. Four had vacuous or weak assertions (fixed). `pdf-export-template` is stale (fixed on the other branch). |
| Electron/browser scripts (17) | All propagate child failures. `assay-chart-electron` was stale (fixed). None run in CI. |

## Validation

- After the changes, `node test.js` on Node 24.21: **1211/1216** pass. The only failures are the five baseline failures fixed on `claude/loving-galileo-x1tzj2`; the total fell by the four removed tests.
- `eslint` clean.
- `node test.js --list` groups are identical apart from the removals.
- `assay-chart-electron.cjs` passes all phases under `xvfb`.
- Every fixed test was run against the mutation that showed its gap and now fails it. All production sources were restored after each mutation, and `git status` shows only test files and this document.
