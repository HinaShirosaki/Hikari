# Tooling Walkthrough

The `tools/` folder owns the generic schema-driven tool runtime and the
agent-facing adapters for app capabilities. Domain implementations stay with
their owning main-process modules. For example, paper search, download, and
analysis live under `src/main/papers/`; the agent tool registry injects those
runtimes instead of duplicating them under `src/main/agent`.

## Layer 1: the tool catalog

Two JSON files define the model-facing tool surface:

| File | Role |
| --- | --- |
| `tools/Tools.json` | short catalog of tool names and high-level descriptions |
| `tools/Tool-call.json` | input schemas and richer descriptions for each tool |

`agent-tool-loading.js` loads both files, validates them, and exposes helpers for:

- canonical tool-name resolution
- tool selection prompt building
- tool argument prompt building
- schema validation

## Layer 2: the generic tool runtime

`agent-tool-execution.js` exposes `createAgentToolCallRuntime()`, an executor registry plus validator. It can:

- register an executor for a canonical tool name
- validate tool-call payloads against the catalog schema
- execute one tool call or a sequential batch
- wrap outputs in a consistent envelope with `ok`, `summary`, `items`, and `error`

It does not know how to run any concrete tool by itself. It only runs what has been registered.

## Current wiring (agent-service assembly)

This is the most important practical detail in the whole tools layer:

- the agent-service assembly (`src/main/core/services/create-agent-services.js`) creates one shared `genericAgentToolRuntime`
- it then calls `registerAgentToolExecutors(...)` (`tools/register-agent-tool-executors.js`), which registers the full catalog on that shared instance: `inventory-lookup`, `notebook-lookup`, `protocol-matching`, `notebook-generation`, `notebook-draft`, `python-sandbox`, `command-line`, `web-search`, `sub-agent`, `memory`, `container`, `assay-table`, `plotly-graph`, `literature-search`, `purchase-recommendation`, `paper-download`, `paper-analysis`, `paper-search`, and `protocol-generation`
- the `inventory-lookup` and `notebook-lookup` executors call their individual tool runtimes directly; no aggregate lookup coordinator sits between MCP and the owning implementation

So the shared executor now exposes the folder's full tool surface, not just a single tool.

## Concrete tools

| Tool name | File | What it does |
| --- | --- | --- |
| `inventory-lookup` | `tools/agent-inventory-lookup.js` | search chemicals in the chemicals SQLite index and samples/containers in the loaded snapshot |
| `notebook-lookup` | `tools/agent-notebook-lookup.js` | search notebook pages in the loaded snapshot or retrieve one structured page by stable id, with storage-access coverage |
| `protocol-matching` | `tools/agent-protocol-matching.js` | rank local protocols and break close ties with an LLM when needed |
| `notebook-generation` | `tools/agent-notebook-generation.js` | resolve placeholders and build a notebook payload from a selected protocol |
| `notebook-draft` | `tools/agent-notebook-draft.js` | infer the next likely experiment and prepare a planned notebook draft |
| `python-sandbox` | `tools/agent-python-sandbox.js` | run agent-authored Python in a sandbox and optionally supervise it through a sub-agent |
| `command-line` | `tools/agent-command-line.js` | run a bounded local shell command in the active project workspace |
| `web-search` | `tools/agent-web-search.js` | use the configured provider/Codex web-search transport |
| `sub-agent` | `tools/agent-sub-agent.js` | create, message, inspect, list, and delete Codex CLI-backed helper sessions |
| `memory` | `context/agent-memory.js` | sparse long-term memory with `remember`, `recall`, `forget`, and `list` actions |
| `container` | `tools/agent-container.js` | manage temporary exact string/number containers |
| `assay-table` | `tools/agent-assay-table.js` | create and transform scratch assay tables |
| `plotly-graph` | `tools/agent-plotly-graph.js` (+ `agent-plotly-figure.js`) | create, update, read, and inspect Plotly figure specifications |
| `literature-search` | `src/main/papers/search/agent-literature-search.js` | search PubMed, Europe PMC, Crossref, UniProt, or web RSS results |
| `purchase-recommendation` | `tools/agent-purchase-recommendation.js` | discover products, enforce explicit requirements, and rank valid candidates |
| `paper-download` | `src/main/papers/download/agent-paper-download.js` | locate PDF URLs, download papers, track progress, and fall back to browser-assisted download |
| `paper-analysis` | `src/main/papers/analysis/agent-paper-analysis.js` | run one Codex CLI paper read, hydrate exact lines, and attach local comments |
| `paper-search` | `src/main/papers/retrieve/agent-paper-wiki-search.js` | full-text search across locally transformed paper Markdown (internal only; not an MCP tool) |
| `protocol-generation` | `tools/agent-protocol-generation.js` | normalize supplied protocol JSON into an import-ready protocol payload and optionally save it |

## Tool group walkthrough

## Lookup tools

`agent-inventory-lookup.js` and `agent-notebook-lookup.js` are deterministic and data-local. They share storage primitives (`agent-lookup-support.js`) but own their lookup behavior independently.

Both tools normalize queries from tool arguments and request context. Since storage moved to one JSON file per record, only chemicals still have a SQLite index:

- `inventory-lookup` searches chemicals in `hikari-chemicals.index.sqlite` (`inventory-lookup/sqlite-search.js`) and samples/containers in the hydrated snapshot (`inventory-lookup/snapshot-search.js`). Sample type-specific fields are searched inside each sample's `details`.
- `notebook-lookup` searches the hydrated snapshot's notebook entries; it never writes a SQLite index (`backfilled_sql` is always `false`).

## Protocol and notebook tools

These five files form one sub-system:

- `agent-protocol-matching.js`
- `agent-notebook-generation.js`
- `agent-notebook-draft.js`
- `agent-protocol-generation.js`
- `agent-protocol-save.js`

`protocol-matching` chooses a protocol. `notebook-generation` fills placeholders and creates a notebook payload. `notebook-draft` guesses the next likely experiment before handing off to notebook generation. `protocol-generation` is the deterministic protocol-JSON normalizer; callers must author or extract the protocol JSON before invoking it, and can set `save: true` in that same call to persist through the internal protocol-save runtime.

## Literature and paper tools

`src/main/papers/search/agent-literature-search.js` owns retrieval.
`src/main/papers/download/agent-paper-download.js` owns acquisition and storage.
`src/main/papers/analysis/agent-paper-analysis.js` sends one local `paper.md`
read to the Codex paper-context sub-agent, hydrates the returned physical line
ranges, and attaches matching local comments. Inline paper text keeps the
provider-backed summary/protocol-seed fallback. These runtimes are injected
into `register-agent-tool-executors.js`; their domain code does not belong in
the general Agent folder.

The paper-download runtime is action-based:

- `start`
- `download`
- `status`

The sub-agent runtime is also action-based:

- `create`
- `message`
- `delete`
- `get`
- `list`

## Python sandbox and sub-agent relationship

`agent-python-sandbox.js` contains both:

- the low-level sandbox runner
- `createManagedPythonSandboxRuntime(...)`, which wraps a sandbox run in a sub-agent lifecycle

That means sub-agents are not only a standalone tool. They are also the execution-tracking primitive for managed Python tasks.

## MCP-only tools

MCP names do not map one-to-one onto executors. `chemical_lookup` reuses the `inventory-lookup` executor and `protocol_lookup` reuses `protocol-matching`. `assay_plot` calls an `assay-plot` tool id that `core/services/create-mcp-service.js` routes to the renderer through the assay plot bridge rather than to this catalog. Some tools have no executor and run in their `mcp-contract/direct-tools/` wrapper or in the owning feature: `notebook_append` and `notebook_suggest` (review-card proposals; `notebook_suggest` reuses the notebook-draft path), `image_output` and `html_output` (artifact publishing), the `paper_intake_*` and `paper_experiments_sql` tools (`src/main/papers/store/intake/mcp/`), and the `sequence_*` tools (`src/renderer/modules/sequence-viewer/main-process/mcp/`). See [mcp-contract.md](../mcp-contract/mcp-contract.md).

## Smoke tests

`tests/support/agent-tool-smoke-test/` is a test-only runtime that creates many concrete tools directly and exercises them with lightweight fixtures or mocked structured responders.

It is useful for exercising tool runtimes in isolation with lightweight fixtures, independent of the live executor wired up for `agent:chat`.
