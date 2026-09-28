# Test Support

This folder holds reusable support code for the root `test.js` runner.

- `runtime.js`: lightweight ESM loader, mock DOM helpers, storage helpers, and small polyfills used across suites.
- `agent-tool-smoke-test/`: builds the concrete agent tool runtimes with lightweight fixtures for the agent smoke tests.
- `paper-intake-mcp-tools.js`: wires the paper-intake MCP tools (`src/main/papers/store/intake/mcp/`) over a test store.
- `assay-workspace-qa.cjs`: builds an isolated page from the production Assay markup and module, for the Assay browser checks.

Maintenance notes:

- Keep helpers deterministic so the root test runner stays stable across environments.
- Add reusable test utilities here instead of growing `test.js`.
- Prefer pure helper functions and explicit dependency injection over hidden globals.
