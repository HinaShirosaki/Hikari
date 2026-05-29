# Codex CLI Provider Modules

`../codex-cli-provider.js` is the public facade. Keep imports from the rest of
the app pointed there unless a test needs a narrow internal helper.

- `args.js`: Codex `exec` and `exec resume` argv construction.
- `attachments.js`: prompt attachment staging and output-file paths.
- `auth-profile.js`, `login*.js`: auth file parsing, login launch, login status, and stored-login clearing.
- `catalog.js`: model catalog/default model and reasoning-effort selection.
- `event-*.js`, `session-id.js`, `transcript.js`: Codex JSONL parsing, progress/display events, and transcript replay.
- `guidance.js`, `runtime-home.js`, `paths.js`: working-directory guidance, project skill folders, runtime home sync, and binary/path resolution.
- `request.js`, `request-stream.js`, `run-command.js`: high-level text request orchestration, stream handling, and child-process execution.
