# Main LLM Foundation

This folder contains provider-neutral primitives shared by the main-process Agent, Papers, Codex, and direct-LLM runtimes.

- `runtime-helpers.js`: common request facade, JSON parsing, text normalization, and provider bridge delegation.
- `request-context.js`: per-request AsyncLocalStorage context and cancellation helpers.

Provider transports remain in `src/main/helpers/main/llm/`; Agent-specific provider selection and orchestration remain under `src/main/helpers/agent/`. Code in `src/main/papers/` may depend on this neutral package but must not import Agent tools or controllers directly.
