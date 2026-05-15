# Hikari Agent MCP Contract

This document exports the provider-neutral MCP-facing contract for Hikari agents. The live reusable implementation is in `src/main/helpers/agent/mcp-contract/`. Codex-specific behavior, such as AGENTS.md injection and Codex CLI config writing, stays in `src/main/helpers/agent/codex-agent/`.

## Runtime config

Any agent provider that supports MCP can launch the shared stdio server. The Codex CLI integration writes the following provider-specific block into Codex's runtime `config.toml`:

```toml
# HIKARI_MCP_CONFIG_START
[mcp_servers.hikari]
command = "node"
args = ["/absolute/path/to/src/main/helpers/agent/mcp-contract/stdio-server.js"]
env = {
  HIKARI_AGENT_MCP = "1",
  HIKARI_AGENT_MCP_WORKSPACE = "/runtime/workspace",
  HIKARI_AGENT_MCP_HOST = "http://127.0.0.1:<port>",
  HIKARI_AGENT_MCP_TOKEN = "<opaque bearer token>",
  HIKARI_CODEX_MCP = "1",
  HIKARI_CODEX_WORKSPACE = "/runtime/workspace",
  HIKARI_CODEX_MCP_HOST = "http://127.0.0.1:<port>",
  HIKARI_CODEX_MCP_TOKEN = "<opaque bearer token>",
  HIKARI_AGENT_DATA_FILE = "/path/to/hikari-data.json",
  HIKARI_AGENT_STORAGE_PATH = "/path/to/storage",
  ENANA_AGENT_MCP = "1",
  ENANA_AGENT_MCP_WORKSPACE = "/runtime/workspace",
  ENANA_AGENT_MCP_HOST = "http://127.0.0.1:<port>",
  ENANA_AGENT_MCP_TOKEN = "<opaque bearer token>",
  ENANA_CODEX_MCP = "1",
  ENANA_CODEX_WORKSPACE = "/runtime/workspace",
  ENANA_CODEX_MCP_HOST = "http://127.0.0.1:<port>",
  ENANA_CODEX_MCP_TOKEN = "<opaque bearer token>",
  ENANA_AGENT_DATA_FILE = "/path/to/hikari-data.json",
  ENANA_AGENT_STORAGE_PATH = "/path/to/storage"
}
# HIKARI_MCP_CONFIG_END
```

`HIKARI_AGENT_MCP_HOST` and `HIKARI_AGENT_MCP_TOKEN` are present when the app-side callback host is running. The `HIKARI_CODEX_*` values are compatibility aliases for the Codex CLI integration, and the legacy `ENANA_*` aliases are still emitted for compatibility. The stdio MCP server uses these values to relay `tool_call` requests into the live Hikari process.

## Per-request context

Each provider run can receive `HIKARI_AGENT_MCP_REQUEST_CONTEXT` as JSON. Codex runs also receive `HIKARI_CODEX_REQUEST_CONTEXT`; `ENANA_AGENT_MCP_REQUEST_CONTEXT` and `ENANA_CODEX_REQUEST_CONTEXT` are compatibility aliases. The stdio server merges this object into every gateway call context.

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
  },
  "resources": {
    "listChanged": false
  }
}
```

Supported JSON-RPC methods:

| Method | Result |
| --- | --- |
| `initialize` | Protocol version, capabilities, server info |
| `tools/list` | Direct Hikari contract tools plus generic search/bridge/resource tools listed below |
| `tools/call` | Gateway result encoded as one text content item |
| `resources/list` | `resource_search({ query: "", limit: 40 })` |
| `resources/read` | Resource contents for the requested URI |
| `ping` | Empty object |

Unsupported methods return JSON-RPC error `-32601`. Internal failures return `-32603`. Missing resources return `-32004`.

## MCP tools

The direct Hikari MCP contract tools are first-class MCP tools in `tools/list`. Agent providers can call them by name without using `tool_search`, `tool_info`, or `tool_call`:

- `inventory_lookup`
- `chemical_lookup`
- `protocol_lookup`
- `protocol_generation`
- `notebook_lookup`
- `ask_user`

Use `tool_search`, `tool_info`, and `tool_call` only for broader app tools that are not already exposed as direct MCP tools.

### `tool_search`

Search Hikari app tools by natural-language goal.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 30 }
  }
}
```

Result shape:

```json
{
  "ok": true,
  "results": [
    {
      "tool_id": "literature-search",
      "summary": "Tool description",
      "input_hint": "query, source?, limit?"
    }
  ]
}
```

### `tool_info`

Load one Hikari tool manifest, including schema when requested.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tool_id"],
  "properties": {
    "tool_id": { "type": "string", "minLength": 1 },
    "detail_level": { "type": "string", "enum": ["summary", "schema", "full"] }
  }
}
```

Use `detail_level: "schema"` or `"full"` before calling a tool whose argument schema is not already known.

### `tool_call`

Validate and call a Hikari app tool through the MCP bridge.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tool_id", "args"],
  "properties": {
    "tool_id": { "type": "string", "minLength": 1 },
    "args": { "type": "object", "additionalProperties": true }
  }
}
```

Result shape:

```json
{
  "ok": true,
  "status": "completed",
  "tool_id": "record-lookup",
  "output": {}
}
```

Invalid tools return `status: "invalid_tool"`. Schema validation failures return `status: "invalid_arguments"`. App execution failures return `status: "failed"`.

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

### `notebook_lookup`

Direct MCP convenience wrapper for local Hikari notebook entries. It calls `record-lookup` and filters results to notebook records.

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
    "project_name": { "type": "string" },
    "protocol_name": { "type": "string" }
  }
}
```

### `ask_user`

Direct MCP helper for one blocking clarification. It does not wait inside MCP for a human answer; instead it returns a renderable `final_response` payload that Codex should emit as the whole-turn JSON result. Hikari renders the options and custom text box, then sends the user answer back as the next chat turn.

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

### `resource_search`

Search Hikari MCP resources such as instructions and tool manifests.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 40 }
  }
}
```

### `resource_read`

Read one Hikari MCP resource by URI.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["uri"],
  "properties": {
    "uri": { "type": "string", "minLength": 1 }
  }
}
```

## Resources

| URI | MIME type | Contents |
| --- | --- | --- |
| `hikari://instructions/agent-mcp` | `text/markdown` | Provider-neutral MCP usage instructions |
| `hikari://tool/<tool-id>` | `application/json` | Full `tool_info({ detail_level: "full" })` envelope |

Resource discovery also returns one resource per Hikari app tool manifest. Legacy `enana://` resource URIs are still accepted for direct reads. The old `hikari://instructions/codex-agent` URI is accepted as a compatibility alias, but it returns the provider-neutral MCP instructions.

## App-side callback host

The stdio MCP server calls the app-side host for live tool execution.

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

Tool call:

```http
POST /tool-call
Authorization: Bearer <HIKARI_AGENT_MCP_TOKEN>
Content-Type: application/json
```

Body:

```json
{
  "tool_id": "record-lookup",
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
  "tool_id": "record-lookup",
  "output": {}
}
```

Unauthorized calls return HTTP 401 with `status: "unauthorized"`. Missing executor returns HTTP 503 with `status: "executor_unavailable"`.

## Hikari app tools exposed through `tool_search` / `tool_info`

These generic app tools remain available through the bridge for cases that do not match a direct MCP contract tool. Do not route `inventory_lookup`, `chemical_lookup`, `protocol_lookup`, `protocol_generation`, `notebook_lookup`, or `ask_user` through `tool_search`; call those direct MCP tools instead.

The current exported tool ids are:

- `inventory-lookup`
- `record-lookup`
- `protocol-matching`
- `notebook-generation`
- `notebook-draft`
- `python-sandbox`
- `command-line`
- `web-search`
- `sub-agent`
- `memory`
- `literature-search`
- `purchase-recommendation`
- `paper-download`
- `paper-analysis`
- `protocol-generation`

See `mcp-contract.json` next to this file for the exact generated MCP tool definitions, resource list, app tool summaries, and app tool input schemas.
