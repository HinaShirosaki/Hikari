# Tooling Walkthrough

The `tools/` folder mixes two concerns:

- concrete tool implementations such as literature search or notebook generation
- a generic schema-driven tool-call wrapper

It helps to read the folder in that order.

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

`agent-tool-call.js` now exists as a thin compatibility wrapper that re-exports both modules.

## Current wiring in `main.js`

This is the most important practical detail in the whole tools layer:

- `main.js` creates one shared `genericAgentToolRuntime`
- it explicitly registers only one executor on that shared instance: `notebook-draft`
- inventory and record lookups bypass that shared executor and are called directly from `agent-lookup-runtime`
- many other tool modules exist and are smoke-tested, but are not yet registered on the shared executor used by `agent:chat`

So the folder contains more capability than the current controller wiring exposes.

## Concrete tools

| Tool name | File | What it does |
| --- | --- | --- |
| `inventory-lookup` | `tools/agent-inventory-lookup.js` | query local inventory with SQLite-first, snapshot-fallback behavior |
| `record-lookup` | `tools/agent-record-lookup.js` | query project/protocol/notebook/workflow/assay/gel records |
| `protocol-matching` | `tools/agent-protocol-matching.js` | rank local protocols and break close ties with an LLM when needed |
| `notebook-generation` | `tools/agent-notebook-generation.js` | resolve placeholders and build a notebook payload from a selected protocol |
| `notebook-draft` | `tools/agent-notebook-draft.js` | infer the next likely experiment and prepare a planned notebook draft |
| `literature-search` | `tools/agent-literature-search.js` | search PubMed, Europe PMC, Crossref, UniProt, or web RSS results |
| `paper-download` | `tools/agent-paper-download.js` | locate PDF URLs, download papers, track progress, and fall back to browser-assisted download |
| `paper-analysis` | `tools/agent-paper-analysis.js` | summarize a paper and optionally extract/generate a protocol |
| `protocol-generation` | `tools/agent-protocol-generation.js` | normalize supplied protocol JSON into an import-ready protocol payload and optionally save it |
| `python-sandbox` | `tools/agent-python-sandbox.js` | run agent-authored Python in a sandbox and optionally supervise it through a sub-agent |
| `sub-agent` | `tools/agent-sub-agent.js` | create, message, inspect, list, and delete Codex CLI-backed helper sub-agent sessions |
| `memory` | `context/agent-memory.js` | sparse long-term memory with `remember`, `recall`, `forget`, and `list` actions |

## Tool group walkthrough

## Lookup tools

`agent-inventory-lookup.js` and `agent-record-lookup.js` are deterministic and data-local. They are the best examples of tools that are production-useful even without a fully wired generic executor because the controller can call them directly.

Both tools:

- derive queries from parser entities
- search SQLite indexes
- fall back to hydrated snapshot JSON
- optionally backfill SQLite to reduce future fallback work

## Protocol and notebook tools

These five files form one sub-system:

- `agent-protocol-matching.js`
- `agent-notebook-generation.js`
- `agent-notebook-draft.js`
- `agent-protocol-generation.js`
- `agent-protocol-save.js`

`protocol-matching` chooses a protocol. `notebook-generation` fills placeholders and creates a notebook payload. `notebook-draft` guesses the next likely experiment before handing off to notebook generation. `protocol-generation` is the deterministic protocol-JSON normalizer; callers must author or extract the protocol JSON before invoking it, and can set `save: true` in that same call to persist through the internal protocol-save runtime.

## Literature and paper tools

`agent-literature-search.js` is a pure retrieval tool. `agent-paper-download.js` handles acquisition and storage. `agent-paper-analysis.js` sits above them conceptually: it consumes paper content and turns it into lab-friendly summaries or protocol seeds.

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

## Smoke tests

`agent-tool-smoke-test.js` is a developer runtime that creates many concrete tools directly and exercises them with lightweight fixtures or mocked structured responders.

It matters because it shows the intended tool surface, even where `main.js` has not yet registered every tool on the shared executor.
