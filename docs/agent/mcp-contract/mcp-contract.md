# Hikari Agent MCP Contract

This document exports the provider-neutral MCP-facing contract for Hikari agents. The live reusable implementation is in `src/main/agent/mcp-contract/`. Codex-specific behavior, such as AGENTS.md injection and Codex CLI config writing, stays in `src/main/agent/codex-agent/`.

## Background experiment suggestions

`notebook_suggest` is a conditional tool available only to Hikari background experiment suggestion runs. It prepares zero to five Suggested pages with the notebook draft contract; paper downloads are blocked. See [Notebook suggestions](notebook-suggestions.md) for triggers, state transitions and access rules.

## Runtime config

Any agent provider that supports MCP can launch the shared stdio server. The Codex CLI integration writes the following provider-specific block into Codex's runtime `config.toml`:

```toml
# HIKARI_MCP_CONFIG_START
[mcp_servers.hikari]
enabled = true
required = true
command = "/absolute/path/to/node"
args = ["/absolute/path/to/src/main/agent/mcp-contract/stdio-server.js"]
enabled_tools = [
  "sequence_list",
  "sequence_search",
  "sequence_get",
  "sequence_feature_edit",
  "sequence_protein_parts",
  "sequence_protein_build",
  "sequence_protein_get",
  "sequence_protein_edit",
  "sequence_mutagenesis_primers",
  "inventory_lookup",
  "chemical_lookup",
  "notebook_lookup",
  "protocol_lookup",
  "protocol_generation",
  "notebook_draft",
  "notebook_suggest",
  "literature_search",
  "paper_download",
  "paper_analysis",
  "paper_intake_search_summaries",
  "paper_intake_search_experiments",
  "paper_intake_list_project_summaries",
  "purchase_recommendation",
  "container",
  "assay_table",
  "plotly_graph",
  "image_output",
  "html_output",
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

`HIKARI_AGENT_MCP_HOST` and `HIKARI_AGENT_MCP_TOKEN` are present when the app-side callback host is running. The `HIKARI_CODEX_*` values are compatibility aliases for the Codex CLI integration. The stdio MCP server uses these values to relay direct tool execution requests into the live Hikari process. In packaged Electron builds, `command` is resolved to an absolute Node executable path, such as `/opt/homebrew/bin/node`, so Codex does not depend on the Finder-launched app inheriting a shell `PATH`.

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

The Hikari MCP surface is direct-tool-only. Agent providers call the named tools below as the complete Hikari app tool surface for this server:

- `inventory_lookup`
- `chemical_lookup`
- `notebook_lookup`
- `protocol_lookup`
- `protocol_generation`
- `notebook_draft`
- `notebook_generation`
- `literature_search`
- `paper_download`
- `paper_analysis`
- `paper_intake_search_summaries`
- `paper_intake_search_experiments`
- `paper_intake_list_project_summaries`
- `purchase_recommendation`
- `memory`
- `container`
- `assay_table`
- `plotly_graph`
- `image_output`
- `html_output`
- `ask_user`

Codex-facing instructions, skills, and examples use these same raw tool names.
Hikari does not add or document a provider namespace prefix.

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

`pending_values` keys must exactly match the generated `placeholder_key` form `<step-id>:<placeholder-id>`; display labels do not identify placeholders. `step_edits` affect only the planned notebook copy and never mutate the saved protocol.

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

The MCP surface is allow-listed by `src/main/agent/mcp-contract/direct-tools/index.js`. Most direct wrappers live under `direct-tools/`; the paper-intake tools stay with their domain owner in `src/main/papers/store/intake/mcp-tools.js` and are folded into the same allow-list. Hyphenated app tool ids are available only when a direct tool wrapper exists, for example `literature-search` is called as `literature_search`, `paper-download` as `paper_download`, and `notebook-lookup` as `notebook_lookup`.

See `mcp-contract.json` next to this file for the exact generated MCP tool definitions and input schemas.

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
