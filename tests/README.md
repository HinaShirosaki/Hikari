# Test Suite Structure

The test runner entrypoint remains `test.js`.

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
- `core/codex-cli-provider-suite.js`: loader for Codex CLI provider suites under `core/codex-cli-provider-suite/`
- `core/contracts-suite.js`: UI/IPC contract checks, wiring checks, and packaging/config assertions
- `edge/platform-and-regression-suite.js`: state normalization, export contracts, platform edge cases, and static guards
- `edge/bio-tools-and-gel-suite.js`: loader for edge suites under `edge/bio-tools-and-gel-suite/`
- `edge/bio-tools-and-gel-suite/*.js`: sequence-viewer, tool-box calculators, and gel-analysis edge coverage

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
