# Test Suite Structure

The test runner entrypoint remains `test.js`.

Suites are organized by domain under `tests/suites/`:

- `core/agent-suite.js`: agent routing, tool execution, paper/protocol/project retrieval, and simulation flows
- `core/app-modules-suite.js`: module behavior tests for lab/project/protocol/inventory/assay/gel/chat workflows
- `core/contracts-suite.js`: UI/IPC contract checks, wiring checks, and packaging/config assertions
- `edge/platform-and-regression-suite.js`: state normalization, object-graph regressions, export contracts, and static guards
- `edge/bio-tools-and-gel-suite.js`: sequence-viewer, tool-box calculators, and gel-analysis edge coverage

Loader files:

- `core-suite.js`: registers all `core/*` suites
- `edge-suite.js`: registers all `edge/*` suites

Guidelines:

- Keep each file scoped to a single domain.
- Add new tests to the closest domain suite; avoid creating another monolithic file.
- Prefer pure helper functions near the tests that use them unless broadly shared.
