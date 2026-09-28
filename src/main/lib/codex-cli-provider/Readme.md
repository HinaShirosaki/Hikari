# Codex CLI Provider Modules

`../codex-cli-provider.js` is the public facade. Keep imports from the rest of
the app pointed there unless a test needs a narrow internal helper.

This package is the transport half of the Codex Agent integration. It lives in
`main/lib` because the composition services consume its public request and
account APIs, but its runtime guidance, skill synchronization, and event
artifacts belong to the same ownership boundary as `agent/codex-agent`.

- `args.js`: Codex `exec` and `exec resume` argv construction.
- `attachments.js`: prompt attachment staging and output-file paths.
- `auth-profile.js`, `login*.js`: auth file parsing, login launch, login status, and stored-login clearing.
- `catalog.js`: model catalog/default model and reasoning-effort selection. Hikari ships no model list; the catalog comes from `codex app-server` (`model/list`) and is cached from the last successful request.
- `cli-discovery.js`: finds the `codex` binary (npm global installs, Homebrew, Volta, the standalone Windows installer) without relying on shell startup files, since desktop launches get a minimal `PATH`.
- `event-*.js`, `session-id.js`, `transcript.js`: Codex JSONL parsing, progress/display events, and transcript replay.
- `guidance.js`, `runtime-home.js`, `paths.js`: working-directory guidance, project skill folders, runtime home sync, and binary/path resolution. Codex runs with `CODEX_HOME` pointed at a private runtime home (`<app data>/Config/codex-cli-home/`) seeded from the user's own Codex home (`auth.json`, `config.toml`, model cache), so Hikari's MCP server and skills never change the user's `~/.codex`.
- `request.js`, `request-stream.js`, `run-command.js`: high-level text request orchestration, stream handling, and child-process execution.
