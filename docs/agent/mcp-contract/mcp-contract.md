# Hikari Agent MCP Contract

This document exports the provider-neutral MCP-facing contract for Hikari agents. The live reusable implementation is in `src/main/agent/mcp-contract/`. Codex-specific behavior, such as AGENTS.md injection and Codex CLI config writing, stays in `src/main/agent/codex-agent/`.

## Background experiment suggestions

`notebook_suggest` is a conditional tool available only to Hikari background experiment suggestion runs. It prepares zero to five Suggested pages with the notebook draft contract; paper downloads are blocked. See [Notebook suggestions](notebook-suggestions.md) for triggers, state transitions and access rules.

## Notebook draft capacity

`notebook_draft` accepts one page request or a `drafts` array of 1–20 requests. Each item accepts a project name, up to 20 protocol candidates, known placeholder values, up to 240 step edits, an optional title, and an optional `draft_id` for updating a previously returned proposal. Additional tool calls retain earlier pages; reuse a returned `proposal_id` as `draft_id` to refine one without duplicating it. Every page remains a separate approve/reject item. Partial batches preserve successful drafts and report individual failures.

Notebook planning considers up to 60 past notebook records, 40 experiment candidates and 32 conversation messages. Protocol preparation retains up to 240 source steps and 120 materials, with up to 6,000 characters per source step. The filling helper receives all prepared steps, including draft-only appended steps. Planning notes survive review and saving up to 40,000 characters. These are notebook limits; `protocol_generation` and background suggestion batch limits are unchanged.

## Paper download recovery

`paper_download` waits up to 15 seconds for its background job, then returns `status: running` if work remains. This ends only the caller's wait, not the download or experiment extraction. Repeat the same DOI (preferred), or the same title/URL when no DOI is available, in the same destination collection to join the existing job. A timeout alone is not evidence that a transfer failed.

`download_status` describes the PDF transfer; `in_progress` covers the remaining background work. A returned `knowledge_markdown_path` can be read immediately, even while experiment extraction continues. Research sessions record that path so line-backed evidence can be validated before intake finishes.

Before starting a transfer, Hikari checks its paper index and saved download receipts. It verifies the PDF header and destination before reusing a file. Receipts are stored under the destination's `.hikari-downloads` folder before intake starts, so a later request after an app restart can reuse the PDF. Missing or invalid files allow a new transfer; different DOIs and different destination folders remain separate. Existing duplicate files are not removed.

## Workspace file access

`workspace_files` executes in Hikari's main process against the current storage root. A Hikari chat turn receives a short-lived capability; raw paths, snapshots and tool arguments cannot grant access. The CLI provider supplies this capability with a per-invocation `mcp_servers.hikari.env.HIKARI_FILE_ACCESS_TOKEN` override (empty for ungranted helpers), not shared configuration. Background runs receive read-only capabilities; external clients without a Hikari-issued turn capability cannot use this tool. Other existing MCP tools are unchanged.

Settings → Codex → Agent file access selects **Read only · review changes** or **Workspace access**. Permissions are stored in application data, outside the selected root. Workspace access permits ordinary creates, edits and moves. Trash requires review unless the user remembers that operation for a particular folder. Additional folders are explicitly selected using Hikari's folder picker and use the same mode. Revoke grants returns to read-only and clears folder exceptions and additional locations. Changes invalidate existing turn capabilities and pending proposals; start a new turn afterwards.

Actions: `status`, `list`, `read`, `search`, `create`, `write`, `mkdir`, `move`, `trash`. Paths use root-relative `/` separators. `write` requires `expected_hash` from `read`. Mutations require a unique `request_id`; retries use identical arguments. `awaiting_approval` means no file was changed. Agent Chat shows compact pending approvals; Settings only configures access. Approval and recovery operations are authenticated, main-window-only IPC operations, never agent tools.

The service rejects traversal, symlinks/junctions, hard links, private configuration and direct changes to managed records/indexes. It checks the real root and current root revision, revalidates proposals at application time, and refuses undo over subsequent changes. Folder operations are bounded at 1,000 entries and 8 MiB; individual reads/writes are limited to 8 MiB. Search returns bounded results with explicit truncation/skipped-path reporting. Recovery snapshots remain in application data. OS filesystem permissions and availability still apply.

These restrictions govern `workspace_files`; they are not a claim that native Codex reads or other existing MCP tools have become confined to the selected root. Native CLI execution remains read-only. Simultaneous hostile filesystem changes by another local process require OS-level isolation beyond this application service.

Recovery snapshots and a prepared journal record are saved before mutation. On restart, interrupted records are compared with the before/after hashes; this recovery history is retained internally and is not shown in Settings. Recovery covers file content and ordinary permission bits, not extended attributes, ACLs or original timestamps. It does not guarantee recovery from disk failure or power loss. Exclusive file creation requires hard-link support on the selected filesystem; unsupported filesystems return an error without overwriting a destination.

## Runtime config

`plugin_canvas` routes agent requests to enabled installed plugins with
`agent:canvas` permission. Start with `{plugin_id:"your-plugin",request:{action:"read"}}`
and follow the returned plugin-owned schema and instructions. Render returns
native images even when the workspace is hidden. Optional image assets are read
from Hikari storage, with format and size checks. Plugins keep scene logic and
rendering inside their own installable folders.

Any agent provider that supports MCP can launch the shared stdio server. The Codex CLI integration writes the following provider-specific block into Codex's runtime `config.toml`:

```toml
# HIKARI_MCP_CONFIG_START
[mcp_servers.hikari]
enabled = true
required = true
command = "/Applications/Hikari.app/Contents/MacOS/Hikari"
args = ["--hikari-mcp-stdio"]
enabled_tools = [
  "inventory_lookup",
  "chemical_lookup",
  "notebook_lookup",
  "protocol_lookup",
  "protocol_generation",
  "notebook_draft",
  "notebook_suggest",
  "notebook_append",
  "literature_search",
  "paper_download",
  "paper_analysis",
  "paper_intake_search_summaries",
  "paper_intake_search_experiments",
  "paper_experiments_sql",
  "paper_intake_list_project_summaries",
  "purchase_recommendation",
  "memory",
  "workspace_files",
  "container",
  "assay_table",
  "assay_plot",
  "plugin_canvas",
  "plotly_graph",
  "image_output",
  "html_output",
  "sequence_list",
  "sequence_search",
  "sequence_get",
  "sequence_feature_edit",
  "sequence_protein_parts",
  "sequence_protein_build",
  "sequence_protein_get",
  "sequence_protein_edit",
  "sequence_mutagenesis_primers",
  "ask_user"
]
default_tools_approval_mode = "approve"
startup_timeout_sec = 30
tool_timeout_sec = 300
env = {
  HIKARI_AGENT_MCP = "1",
  HIKARI_AGENT_MCP_WORKSPACE = "/runtime/workspace",
  HIKARI_AGENT_MCP_HOST = "http://127.0.0.1:<port>",
  HIKARI_AGENT_MCP_TOKEN = "<opaque bearer token>",
  HIKARI_AGENT_MCP_REQUEST_CONTEXT = "<per-turn JSON>",
  HIKARI_CODEX_MCP = "1",
  HIKARI_CODEX_WORKSPACE = "/runtime/workspace",
  HIKARI_CODEX_MCP_HOST = "http://127.0.0.1:<port>",
  HIKARI_CODEX_MCP_TOKEN = "<opaque bearer token>",
  HIKARI_CODEX_REQUEST_CONTEXT = "<per-turn JSON>",
  HIKARI_AGENT_DATA_FILE = "/path/to/hikari-data.json",
  HIKARI_AGENT_STORAGE_PATH = "/path/to/storage",
}

[mcp_servers.hikari.tools.protocol_generation]
approval_mode = "approve"
# HIKARI_MCP_CONFIG_END
```

`HIKARI_AGENT_MCP_HOST` and `HIKARI_AGENT_MCP_TOKEN` are present when the app-side callback host is running. The `HIKARI_CODEX_*` values are compatibility aliases for the Codex CLI integration. The stdio MCP server uses these values to relay direct tool execution requests into the live Hikari process. In packaged Electron builds, `command` is Hikari's own executable with `--hikari-mcp-stdio`: `src/main/main.js` then starts only the MCP stdio server on Electron's embedded Node (no window, app services, or single-instance lock), so Codex needs no separate Node install and does not depend on a Finder-launched app inheriting a shell `PATH`. In a development checkout (`npm start`), `command` is an absolute Node executable (found from `HIKARI_NODE_PATH`, the Codex install, or `PATH`) and `args` is the path to `src/main/agent/mcp-contract/stdio-server.js`.

`enabled_tools` is the full tool list minus anything switched off in **Settings > Tool access** (`settings.agent.disabledMcpToolNames`), so a disabled tool is invisible to Codex rather than failing when called. `notebook_suggest` is listed but only callable in background suggestion runs.

## Per-request context

Each provider run can receive `HIKARI_AGENT_MCP_REQUEST_CONTEXT` as JSON. Codex runs also receive `HIKARI_CODEX_REQUEST_CONTEXT`. The stdio server merges this object into every gateway call context.

```json
{
  "provider": "codex",
  "model": "gpt-5.4",
  "cwd": "/runtime/workspace",
  "message": "Current user request",
  "conversation": [],
  "project": {
    "id": "project-id",
    "name": "Project name"
  },
  "projectId": "project-id",
  "projectName": "Project name",
  "dataFilePath": "/path/to/hikari-data.json",
  "traceRequestId": "request-id"
}
```

## MCP server

Server name: `hikari`

Server info:

```json
{
  "name": "hikari-agent-mcp",
  "version": "0.1.0"
}
```

Capabilities:

```json
{
  "tools": {
    "listChanged": false
  }
}
```

Supported JSON-RPC methods:

| Method | Result |
| --- | --- |
| `initialize` | Protocol version, capabilities, server info |
| `tools/list` | Direct Hikari app and contract tools only |
| `tools/call` | Gateway result encoded as one text content item |
| `ping` | Empty object |

Unsupported methods return JSON-RPC error `-32601`. Internal failures return `-32603`.

## MCP tools

The Hikari MCP surface is direct-tool-only. Agent providers call the named tools below as the complete Hikari app tool surface for this server (34 tools; the canonical order is `HIKARI_MCP_TOOL_NAMES` in `instructions.js`):

| Group | Tools |
| --- | --- |
| Lookups | `inventory_lookup`, `chemical_lookup`, `notebook_lookup`, `protocol_lookup` |
| Records (review-before-write) | `protocol_generation`, `notebook_draft`, `notebook_append`, `notebook_suggest` (background suggestion runs only) |
| Literature | `literature_search`, `paper_download`, `paper_analysis`, `paper_intake_search_summaries`, `paper_intake_search_experiments`, `paper_intake_list_project_summaries`, `paper_experiments_sql` |
| Lab tools | `purchase_recommendation`, `memory`, `workspace_files` (review-before-write), `container` |
| Analysis and output | `assay_table`, `assay_plot`, `plotly_graph`, `image_output`, `html_output` |
| Sequence Viewer | `sequence_list`, `sequence_search`, `sequence_get`, `sequence_feature_edit`, `sequence_protein_parts`, `sequence_protein_build`, `sequence_protein_get`, `sequence_protein_edit`, `sequence_mutagenesis_primers` (see [sequence-tools.md](sequence-tools.md)) |
| Conversation | `ask_user` |

Codex-facing instructions, skills, and examples use these same raw tool names.
Hikari does not add or document a provider namespace prefix.

### Local paper discovery

`paper_intake_search_summaries` retrieves papers from the existing `intake.json` records using titles, DOI, paper ID, one-sentence summaries, experiment techniques/variables/outcomes/figure references/evidence, and saved outlines/claims. `paper_intake_search_experiments` returns individual experiment entries and also searches their verbatim evidence. Both tools normalize punctuation, common plural forms, Greek-letter spellings, and a small set of assay aliases. Terms that fold to the same concept count once. Query coverage and term rarity affect ranking, with explicit bonuses for title/DOI hits; repeated experiment entries do not inflate paper-level scores. This is lexical retrieval, not general semantic search, and it does not require embeddings or re-running intake.

Parsed intake records and compiled field term counts are reused across searches, including across per-call MCP store instances. File mtime, ctime, size, and inode validate cached records; directory mtime alone would miss in-place edits. Library enumeration still runs on every search to discover additions/deletions, with at most 16 concurrent intake reads/stat checks. The cache has a 128 MiB estimated-memory budget with eviction; that budget does not truncate the searchable library. Cold loads, changed files, and files evicted from the cache still incur parsing/indexing cost. Legacy records whose Markdown path must be resolved dynamically are not cached against intake.json alone.

Scaling follow-up (open, separate from the source-text accounting correction): evaluate scan-resistant cache admission and incremental retrieval when a representative library approaches the cache budget or warm searches begin rereading/recompiling most intake files. Sequential full-library scans can evict useful entries to admit records encountered earlier in the scan, causing repeated churn. `loadAll()` retains all loaded records for the query, so eviction does not bound total live query memory or immediately free their compiled WeakMap entries. Benchmark cold/warm latency, intake rereads, peak heap/RSS, and post-query GC behavior on realistic experiment/evidence sizes before broad large-library use. Paper count alone is not a reliable trigger; no fixed 1 GB peak or universally safe size has been established. The 128 MiB limit is an accounting estimate for retained cache entries, not a process-memory limit.

Both search tools accept `scope: "context"` (default: active project when present) or `scope: "library"` (all local papers). An explicit `project_name` takes precedence. Results report `search_scope`, `total_matches`, and `truncated`. Each hit includes `matched_terms`, `match_coverage`, and any `unmatched_terms`; paper hits also include bounded `match_context` excerpts with stored field names and available experiment/figure references. Coverage describes matched terms, not confidence that all conditions occurred together. Use `source_paths.paper_md` to verify details. On weak/no matches, retry specific identifiers or alternative wording, broaden scope if appropriate, and search full local Markdown before concluding that a paper is absent. Metadata-only papers remain discoverable by title and DOI, but their experimental contents are not indexed until intake completes.

Retrieval cannot recover experiments omitted by intake classification: research-only extraction and the review-skip policy remain in effect. The separate `paper-search` app tool (full-text search over `KnowledgeBase/papers.md/`, scored over in-memory text windows) is not exposed as a direct MCP tool. Markdown fallback requires available workspace file-search access; when that access is unavailable, report the full-text search as unperformed rather than claiming the paper is absent.

### `paper_experiments_sql`

Runs one read-only `SELECT` (or `WITH … SELECT`) against `KnowledgeBase/experiments.sqlite`, the table of experiments extracted by paper intake. Arguments: `sql` (required), positional `parameters`, and `limit` (default 50, maximum 200). Tables are `experiments(paper_id, ordinal, id, title, technique, variables, figure_ref, outcome, evidence)` and `papers(paper_id, title, doi, doc_type, one_sentence_summary, project_ids_json, intake_path, paper_md, figures_dir, pdf_path, created_at, updated_at)`; join on `paper_id`. Results return `columns` and row-value arrays, with truncation reported. Queries run on a disposable in-memory copy in a worker (3-second deadline, 48 KB result budget); writes, `PRAGMA` statements, file paths, and multiple statements are rejected. Queries cover the whole workspace library, so use `paper_intake_list_project_summaries` to constrain to a project. Storage, rebuild, and limits are described in [storage-and-bundles.md](../../main-platform/data/storage-and-bundles.md#paper-knowledge-storage).

Direct wrappers that delegate to app executors use the app tool schema and return this envelope:

```json
{
  "ok": true,
  "status": "completed",
  "mcp_tool": "notebook_lookup",
  "app_tool": "notebook-lookup",
  "output": {}
}
```

Unknown tool names are rejected by the gateway. Schema validation failures return `status: "invalid_arguments"`. App execution failures return `status: "failed"`.

### `inventory_lookup`

Direct MCP convenience wrapper for local Hikari inventory search. It calls the app `inventory-lookup` executor and returns matched inventory records directly.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 25 },
    "inventory_search": { "type": "object" }
  }
}
```

### `chemical_lookup`

Direct MCP convenience wrapper for local Hikari chemical records. It calls `inventory-lookup` with expanded search terms and filters results to `kind: "chemical"`.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 25 },
    "cas": { "type": "string" },
    "supplier": { "type": "string" }
  }
}
```

### `notebook_lookup`

Read-only notebook-agent bridge. It calls the app `notebook-lookup` executor to search pages or retrieve one exact saved page. The runtime merges persisted notebook storage with a bounded live notebook index from the thin app snapshot. Results include stable entry/project/protocol identity, an app `ui_target`, optional structured page content, source coverage, and an `access` block. When `access.complete` is false, the result is incomplete evidence rather than a definitive no-match.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "action": { "type": "string", "enum": ["search", "get"] },
    "entry_id": { "type": "string" },
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 25 },
    "project_id": { "type": "string" },
    "project_name": { "type": "string" },
    "protocol_id": { "type": "string" },
    "protocol_name": { "type": "string" },
    "notebook_state": { "type": "string", "enum": ["planned", "executed"] },
    "detail": { "type": "string", "enum": ["summary", "full"] }
  }
}
```

`action` defaults to `search`. Search requires `query` or at least one scope filter. `get` requires `entry_id` and returns `detail: "full"`. Permission failures return `status: "partial"` or `status: "permission_denied"`, with recovery guidance in `access.user_action`.

### `literature_search`

For interactive Codex research, the main agent sends one compact `query` and the complete research objective in `message` (up to 12,000 characters). A research sub-agent then refines searches, uses native web search, calls `paper_download`, and reads extracted Markdown until the evidence is sufficient or remaining gaps cannot be resolved. Its searches return database candidates directly without recursively creating another researcher.

The app passes a private research-session ID through the MCP snapshot. Only an active session bypasses the host's one-search-per-turn guard. Downloads retain the original project or collection, reuse existing local Markdown, and are recorded by the app. The sub-agent returns paper paths, physical line ranges, and relevance comments; the app accepts paths only from successful tool results in that session and hydrates exact source lines. Responses include `loaded_context_blocks`, `analysis_comments`, `downloaded_papers`, and unresolved `notes`. The main agent does not download the returned papers again.

There is no fixed search-round limit or overall research deadline. The delegated CLI receives `timeout_ms: null`. Each MCP call waits at most 45 seconds for the same research job, then returns `status: running` and a `research_id`; the main agent keeps calling `literature_search` with that ID until completion. Each wait fits inside the transport timeout without stopping the researcher. Final evidence remains capped at 50 blocks. Runtime failures preserve completed download results. Metadata-only scheduled tasks with `deny_paper_download: true` remain discovery-only. The separate single-paper `paper_analysis` workflow is unchanged.

### `protocol_lookup`

Direct MCP convenience wrapper for local Hikari protocol records. It calls `protocol-matching` with the query as the protocol candidate and returns ranked protocol matches plus the selected protocol when available.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 25 },
    "project_id": { "type": "string" },
    "project_name": { "type": "string" }
  }
}
```

### `protocol_generation`

Direct MCP convenience wrapper for protocol JSON normalization. It calls `protocol-generation` with the supplied protocol JSON, does not call an LLM, and saves the normalized record into Protocols when `save` is true.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["protocol"],
  "properties": {
    "protocol": {
      "type": "object",
      "additionalProperties": true,
      "required": ["steps"],
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "title": { "type": "string" },
        "purpose": { "type": "string" },
        "materials": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 80
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              { "type": "string" },
              { "type": "object", "additionalProperties": true }
            ]
          },
          "maxItems": 120
        },
        "troubleshooting": {
          "anyOf": [
            { "type": "string" },
            { "type": "array" }
          ]
        },
        "createdAt": { "type": "string" },
        "updatedAt": { "type": "string" }
      }
    },
    "result_summary": { "type": "string" },
    "save": { "type": "boolean" },
    "persist": { "type": "boolean" },
    "overwrite": { "type": "boolean" },
    "upsert": { "type": "boolean" }
  }
}
```

### `notebook_draft`

Direct MCP convenience wrapper for planned next-experiment notebook drafts. It calls `notebook-draft`, returns a confirmation-ready draft payload, and does not create the notebook page itself.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "project_name": { "type": "string" },
    "protocol_candidates": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 5
    },
    "pending_values": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "step_edits": {
      "type": "array",
      "maxItems": 60,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "step_number": { "type": "integer", "minimum": 1 },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

`pending_values` keys must exactly match the generated `placeholder_key` (the placeholder id); display labels do not identify placeholders. `step_edits` affect only the planned notebook copy and never mutate the saved protocol.

### `notebook_append`

Prepares a proposal to append evidence-backed Markdown to an existing notebook page (normally the page open beside the agent rail). Required: `notebook_entry_id`, `page_title`, `project_name`, `protocol_name`, `content_markdown`; optional `section_title`, `rationale`, `sources`, and `expected_updated_at` (so a proposal made against an older version of the page is not applied over newer edits). The tool never writes the page: Hikari shows the proposal as a review card and applies it only after the user approves. It does not create pages; use `notebook_draft` for that.

### `assay_plot`

Reads and styles the live native chart in the open **Plate** (Assay) view: titles, axes, series appearance, legend, grid, error bars, and added labels, reference lines, and shaded bands. `action: "read"` returns the supported style fields, series labels, and a `revision`; `action: "update"` merges a `style` patch (arrays such as `plotElements` replace in full) and should pass `expected_revision`. It never changes plate values, data mapping, or analysis. Main forwards the request to the renderer over `ASSAY.PLOT_REQUEST` and waits for its acknowledgement (`src/main/core/services/assay-plot-bridge.js`). For a custom figure built by the agent, use `plotly_graph` instead. The `hikari-assay-plotly` skill documents the workflow.

### `memory`

Sparse long-term memory with `remember`, `recall`, `forget`, and `list` actions, stored in `<storage root>/.hikari/agent-memory.json`. Scope, recall ranking, and persistence rules are in [context-and-observability.md](../context/context-and-observability.md#contextagent-memoryjs).

### `ask_user`

Direct MCP helper for one blocking clarification. It is a turn boundary: Codex emits the returned `final_response` and ends the current turn in a completed waiting state. Hikari renders the one-shot options and custom text box, then sends the answer as the next chat turn. Codex resumes from that answer without repeating the same question.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["question", "options"],
  "properties": {
    "question": { "type": "string", "minLength": 1 },
    "context": { "type": "string" },
    "options": {
      "type": "array",
      "minItems": 1,
      "maxItems": 6,
      "items": {
        "anyOf": [
          { "type": "string" },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["label"],
            "properties": {
              "id": { "type": "string" },
              "label": { "type": "string", "minLength": 1 },
              "value": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        ]
      }
    },
    "allow_custom": { "type": "boolean" },
    "placeholder": { "type": "string" },
    "submit_label": { "type": "string" }
  }
}
```

Result shape:

```json
{
  "ok": true,
  "status": "needs_user_answer",
  "mcp_tool": "ask_user",
  "user_question": {
    "question": "Which project should I use?",
    "options": [
      {
        "label": "Current project",
        "value": "Use the current project."
      }
    ],
    "allow_custom": true
  },
  "final_response": {
    "status": "needs_more_info",
    "assistant_text": "Which project should I use?",
    "follow_up_questions": ["Which project should I use?"],
    "user_question": {}
  }
}
```

Direct lookup result shape:

```json
{
  "ok": true,
  "status": "matched",
  "mcp_tool": "protocol_lookup",
  "app_tool": "protocol-matching",
  "query": "protein purification",
  "source": "protocol-matching",
  "summary": "protocol_lookup matched 1 item.",
  "items": [],
  "citations": [],
  "selected_protocol": {},
  "selection_method": "deterministic"
}
```

## App-side callback host

The stdio MCP server calls the app-side host for live tool execution through the MCP SDK Streamable HTTP transport.

Health:

```http
GET /health
```

Response:

```json
{
  "ok": true,
  "name": "hikari-agent-mcp-host"
}
```

MCP endpoint:

```http
POST /mcp
Authorization: Bearer <HIKARI_AGENT_MCP_TOKEN>
Content-Type: application/json
```

The private app host exposes one SDK tool, `hikari_app_tool_call`, for relay into the live Hikari tool runtime. Its `tools/call` arguments are:

```json
{
  "tool_id": "notebook-lookup",
  "args": {},
  "snapshot": {},
  "context": {}
}
```

The host merges default context before execution:

```json
{
  "cwd": "/runtime/workspace",
  "dataFilePath": "/path/to/hikari-data.json",
  "fallbackDataFilePath": "/path/to/hikari-data.json",
  "agentMcp": true
}
```

Response:

```json
{
  "ok": true,
  "status": "completed",
  "tool_id": "notebook-lookup",
  "output": {}
}
```

Unauthorized calls return HTTP 401 with `status: "unauthorized"`. Missing executor returns HTTP 503 with `status: "executor_unavailable"`.

## Direct tool files

The MCP surface is allow-listed by `src/main/agent/mcp-contract/direct-tools/index.js`. Most direct wrappers live under `direct-tools/`; the paper-intake tools (`paper_intake_*`, `paper_experiments_sql`) stay with their domain owner in `src/main/papers/store/intake/mcp/` and are folded into the same allow-list, and the `sequence_*` tools are implemented in `src/renderer/modules/sequence-viewer/main-process/mcp/` behind `direct-tools/sequence-tools.js`. Hyphenated app tool ids are available only when a direct tool wrapper exists, for example `literature-search` is called as `literature_search`, `paper-download` as `paper_download`, and `notebook-lookup` as `notebook_lookup`.

See `mcp-contract.json` next to this file for the exact MCP tool definitions, input schemas, and agent instructions. It is a checked-in snapshot, not generated on build; several tests compare its entries with the live definitions, so update it when you change a tool definition.

## Sequence Viewer

The nine `sequence_*` tools provide plasmid discovery, feature editing, Protein Builder assembly, residue-level mutations, and persisted primer comparisons. See [Sequence Viewer tool contract](sequence-tools.md) for coordinates, retry behavior, examples, and limitations.

## Analysis image output

Use `image_output` after an analysis script saves an image inside Hikari's storage workspace:

```json
{
  "path": "analysis/dose-response.png",
  "title": "Dose response",
  "alt": "Response increases with dose and reaches a plateau.",
  "caption": "Mean response across three replicates; error bars show standard deviation."
}
```

`path` and `alt` are required. Paths may be absolute within storage or relative to its root. The tool resolves symlinks and rejects paths outside storage, missing files, non-image content, and files larger than 5 MiB. Supported formats are PNG, JPEG, and WebP; export SVG or PDF figures to a supported raster format first.

A successful call returns `ok: true`, `status: "completed"`, and `image_artifact` metadata (`type`, stable `id`, `title`, `alt`, `caption`, `mime_type`, `byte_length`). The MCP response includes a native `{type: "image", mimeType, data}` base64 content block. JSON text and structured metadata omit the binary bytes. Hikari internally carries an immutable `data_url` with that artifact to the live assistant message and saved chat history. Repeated identical results are deduplicated; multiple distinct images are displayed in order. Captions and alt text are plain text. Removing the source file later does not remove the saved image.

The tool publishes an existing image; it does not execute analysis or generate artwork. Check `ok` before claiming display succeeded. Do not embed base64 or local image paths in assistant prose. The tool can be disabled in Settings like other Hikari MCP tools and is unavailable to background notebook suggestion runs.

## Interactive HTML output

Call `html_output` with required `title` and `html` (a complete self-contained document), optional `caption`, and optional integer `height` in rem (16–64; default 32). HTML is limited to 512 KiB UTF-8; title to 220 characters and caption to 2,000. The tool accepts source HTML directly, not a path or URL.

The MCP response contains short JSON metadata and a native embedded resource with `mimeType: "text/html"`, its original source in `text`, and a content-derived `hikari-html-artifact://<id>` URI. `html_artifact` includes `type`, `id`, `title`, `caption`, and `height`. Hikari carries the HTML source internally through progress, final response, and saved history. Duplicate identical outputs are deduplicated. Revised HTML produces a new artifact.

Hikari displays the document in an opaque sandboxed iframe served through a dedicated local protocol. Inline JavaScript/CSS, canvas, inline SVG, and data-URL images/fonts work. Network access, local file loading, external dependencies, Hikari APIs, persistent browser storage, nested frames, popups, navigation, and downloads are unavailable. The main application script policy remains unchanged. Preview controls update only the embedded document; they do not mutate Hikari records. Routine chat updates keep an existing frame connected. Reopening a saved chat reconstructs the source document and resets its controls to their initial state.

The bundled [hikari-html-output skill](../../../src/main/agent/codex-agent/official-skills/hikari-html-output/SKILL.md) contains exact arguments, troubleshooting, and a working threshold explorer. It is released to root and project `.agents/skills` folders through the official skill publisher and follows the `html_output` Settings switch.
