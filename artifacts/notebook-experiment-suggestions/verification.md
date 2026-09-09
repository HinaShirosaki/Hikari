# Experiment suggestion verification

- UI build, DOM IDs, CSS color contract, source layout, focused ESLint and scoped whitespace checks passed.
- `node tests/notebook-experiment-suggestions-selfcheck.js` passed. Uses the actual draft runtime, MCP gateway, Codex stream extraction and suggestion service with a stubbed model response. Covers context restrictions, project binding, copied protocol edits, executor download denial, metadata-only literature search despite an auto-download flag, duplicate suppression, concurrent runs, save failures, acceptance, and storage bundle/SQL roundtrip.
- `node tests/notebook-experiment-suggestions-electron.cjs` passed in an isolated Electron profile. Covers the project button, continued navigation during generation, automatic runs after execution, pending suggestion reuse, ordinary saves, reload persistence, acceptance on the same record, and computed gradient/italic/dark-grey styling. The Codex response is stubbed.
- Focused existing regression selection `literature|notebook|mcp-gateway-tool-surface|agent-runtime-prompts|scheduled-tasks-and-paper-finding`: 194/194 passed outside the sandbox, which permits temporary localhost test servers.
- Additional MCP session/bridge selection: 20/21 passed. The unrelated existing config test assumes inventory tools begin the enabled-tools array; the existing Sequence Viewer work puts sequence tools first.
- No live Codex request or packaged-app rebuild was performed. Screenshots show isolated fixture data, not user experiments.

Screenshots: [Suggested page](suggested.png), [Suggested page in night theme](suggested-night.png).
