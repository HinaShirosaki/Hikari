# Test Suite Structure

The test runner entrypoint remains `test.js`.

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

- Keep each file scoped to a single domain.
- Add new tests to the closest domain suite; avoid creating another monolithic file.
- Prefer pure helper functions near the tests that use them unless broadly shared.
