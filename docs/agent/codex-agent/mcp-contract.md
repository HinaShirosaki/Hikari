# Hikari Codex MCP Contract

This document exports the MCP-facing contract used by the Codex-owned Hikari agent runtime. The live implementation is in `src/main/helpers/agent/codex-agent/`.

## Runtime config injected into Codex

Hikari writes the following block into Codex's runtime `config.toml`:

```toml
# HIKARI_MCP_CONFIG_START
[mcp_servers.hikari]
command = "node"
args = ["/absolute/path/to/src/main/helpers/agent/codex-agent/mcp-stdio-server.js"]
env = {
  HIKARI_CODEX_MCP = "1",
  HIKARI_CODEX_WORKSPACE = "/runtime/workspace",
  HIKARI_AGENT_DATA_FILE = "/path/to/hikari-data.json",
  HIKARI_AGENT_STORAGE_PATH = "/path/to/storage",
  HIKARI_CODEX_MCP_HOST = "http://127.0.0.1:<port>",
  HIKARI_CODEX_MCP_TOKEN = "<opaque bearer token>",
  ENANA_CODEX_MCP = "1",
  ENANA_CODEX_WORKSPACE = "/runtime/workspace",
  ENANA_AGENT_DATA_FILE = "/path/to/hikari-data.json",
  ENANA_AGENT_STORAGE_PATH = "/path/to/storage",
  ENANA_CODEX_MCP_HOST = "http://127.0.0.1:<port>",
  ENANA_CODEX_MCP_TOKEN = "<opaque bearer token>"
}
# HIKARI_MCP_CONFIG_END
```

`HIKARI_CODEX_MCP_HOST` and `HIKARI_CODEX_MCP_TOKEN` are present when the app-side callback host is running. The legacy `ENANA_*` aliases are still emitted for compatibility. The stdio MCP server uses these values to relay `tool_call` requests into the live Hikari process.

## Per-request context

Each Codex run receives `HIKARI_CODEX_REQUEST_CONTEXT` as JSON. The legacy `ENANA_CODEX_REQUEST_CONTEXT` alias is also set. The stdio server merges this object into every gateway call context.

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
  "name": "hikari-codex-agent",
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
| `tools/list` | Ten MCP tools listed below |
| `tools/call` | Gateway result encoded as one text content item |
| `resources/list` | `resource_search({ query: "", limit: 40 })` |
| `resources/read` | Resource contents for the requested URI |
| `ping` | Empty object |

Unsupported methods return JSON-RPC error `-32601`. Internal failures return `-32603`. Missing resources return `-32004`.

## MCP tools

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

Direct MCP convenience wrapper for protocol JSON normalization. It calls `protocol-generation` with the supplied protocol JSON, does not call an LLM, and does not require a protocol id.

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
    "result_summary": { "type": "string" }
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
| `hikari://instructions/codex-agent` | `text/markdown` | Generated AGENTS instructions |
| `hikari://tool/<tool-id>` | `application/json` | Full `tool_info({ detail_level: "full" })` envelope |

Resource discovery also returns one resource per Hikari app tool manifest. Legacy `enana://` resource URIs are still accepted for direct reads.

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
  "name": "hikari-codex-agent-mcp-host"
}
```

Tool call:

```http
POST /tool-call
Authorization: Bearer <HIKARI_CODEX_MCP_TOKEN>
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
  "codexMcp": true
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
