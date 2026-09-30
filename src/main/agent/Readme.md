# Agent Runtime Package

This folder owns provider-neutral Agent behavior. Main-process composition lives in `src/main/core/services/create-agent-services.js`; provider-neutral LLM primitives live in `src/main/lib/llm/`.

- `codex-agent/`: Codex-specific prompt, session, and stream-event adapter, runtime config files, the Codex Desktop setup prompt, and the bundled `official-skills/`
- `context/`: persisted memory and chat-session logs
- `html-output/`: the sandboxed `hikari-html://` preview protocol for `html_output` artifacts
- `mcp-contract/`: direct MCP schemas and implementations, tool availability, and the stdio server (also started by `main.js --hikari-mcp-stdio`)
- `runtime/`: the `agent:chat` request pipeline (`agent-chat-request.js`) and provider-neutral runtime support, including tool-artifact normalization and recovery
- `shared/`: observability, provider bridge, controller helpers, and runtime registries
- `skills/`: installed/official skill discovery and execution
- `tools/`: individual tool runtimes and the executor catalog

Paper search, retrieval, parsing, download, and analysis are owned by `src/main/papers/`, not this package. IPC handlers are owned by `src/main/ipc/register-agent-ipc/`.

See `docs/agent/README.md` for the full request lifecycle and tool documentation.
