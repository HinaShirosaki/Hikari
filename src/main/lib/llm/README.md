# Main LLM Foundation

This folder contains provider-neutral primitives shared by the main-process Agent, Papers, Codex, and direct-LLM runtimes.

- `runtime-helpers.js`: common request facade, JSON parsing, text normalization, and provider bridge delegation.
- `request-context.js`: per-request AsyncLocalStorage context and cancellation helpers.
- `direct-llm-module-registry.js`: the registry of direct (non-agent) LLM tasks grouped by module (paper summary/extraction/Q&A, protocol generation/polish, notebook page naming, and a shared utility module), served over `llm:direct-modules` / `llm:direct-generate`.
- `chat-log-transformer.js` and `chat-log-transform/`: the monitor that turns raw agent chat logs into per-session files.

The Codex transport is `src/main/lib/codex-cli-provider/`; Agent-specific provider selection and orchestration remain under `src/main/agent/`. Code in `src/main/papers/` may depend on this neutral package but must not import Agent tools or controllers directly.
