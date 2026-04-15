# Test Support

This folder holds reusable support code for the root `test.js` runner.

- `runtime.js`: lightweight ESM loader, mock DOM helpers, storage helpers, and small polyfills used across suites.
- `agent-simulation.js`: deterministic mocked agent/tool routing fixtures used by contract and behavior tests.

Maintenance notes:

- Keep helpers deterministic so the root test runner stays stable across environments.
- Add reusable test utilities here instead of growing `test.js`.
- Prefer pure helper functions and explicit dependency injection over hidden globals.
