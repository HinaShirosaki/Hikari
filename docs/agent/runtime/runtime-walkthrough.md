# Runtime Walkthrough

The production Agent no longer has an in-process intent router or science-reasoning loop. Runtime orchestration is split between a small provider-neutral foundation and the Codex-owned turn adapter.

## Service composition

`src/main/core/services/create-agent-services.js` constructs the reusable foundation:

- Codex CLI request helpers for deterministic sub-tools;
- snapshot normalization and storage-aware lookup support;
- the registered internal tool executor;
- chat log, memory, skills, and observability runtimes;
- paper-owned search, download, analysis, and intake adapters injected from `src/main/papers`.

`create-mcp-service.js` places the direct MCP contract over those tools. `create-codex-service.js` supplies workspace preparation and Codex CLI execution.

## `runtime/agent-runtime-support.js`

This module owns shared, deterministic helpers used by service composition:

- normalizing the thin Agent snapshot;
- building bounded system/context prompt blocks;
- simple fuzzy matching and source shaping.

It does not select an intent or run a second conversational agent.

## `runtime/agent-sub-app-api.js`

This adapter exposes narrow Agent-facing methods for assay, papers, protocol, and notebook data. It also resolves protocol-matching and notebook-generation factories from the runtime registry.

The adapter stays below the MCP/tool layer: callers receive normalized records or invoke a registered tool rather than reaching renderer controllers directly.

## `codex-agent/runtime.js`

This is the production whole-turn runtime. It owns:

- prompt and Hikari MCP context construction;
- Codex session start/resume metadata;
- stream-progress projection;
- cancellation checks;
- final payload normalization;
- notebook, protocol, Plotly, and clarification artifact extraction.

The runtime delegates local data access and app actions to MCP. It should not absorb feature-specific lookup/storage logic.

Provider-neutral artifact handling lives one layer below the Codex adapter: `runtime/tool-artifacts/` normalizes protocol and Plotly outputs, while `runtime/artifact-recovery/protocol-generation.js` owns the recovery path for authored protocol prose or failed direct-tool materialization. `codex-agent/` only supplies Codex stream/session context and applies those helpers.

## Tool runtimes

`src/main/agent/tools/` contains deterministic units that can be called by MCP, internal workflows, or smoke tests. The central executor is assembled by `register-agent-tool-executors.js`; definitions exposed to Codex are separately allow-listed under `mcp-contract/direct-tools/`.

This separation is intentional:

- internal tool ids use hyphens and may include support-only tools;
- MCP names use underscores and expose only reviewed direct wrappers;
- paper implementation stays under `src/main/papers` even when an Agent tool calls it.

## Extension rule

Add behavior to the owning feature first, then expose the smallest direct-tool adapter needed by Codex. Do not add a parallel conversational controller under `src/main/agent`.
