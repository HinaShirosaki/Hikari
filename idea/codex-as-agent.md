

# Using Codex CLI as an External Agent for Enana

## Core idea

Enana can allow external coding agents, such as OpenAI Codex CLI, to operate on the app through a controlled local tool layer. Instead of directly exposing every internal function of the app to Codex, Enana can provide a small MCP-compatible bridge that lets Codex discover, inspect, and call app tools only when needed.

The goal is to make Enana usable by Codex as an agent environment while keeping token usage low, preserving app boundaries, and avoiding tight coupling between Enana and any single model provider.

```text
Codex CLI
    ↓
Enana MCP / Agent Bridge
    ↓
Tool Registry
    ↓
Enana app modules
    ├── Notebook
    ├── Protocols
    ├── Inventory / Samples
    ├── Sequence Viewer
    ├── Cloning Planner
    ├── Gel / Assay Analysis
    └── Project / Paper Context
```

## Why not expose all tools directly?

A full Enana app may eventually contain many tools:

- notebook creation and editing
- protocol search and rendering
- sample lookup
- inventory update
- plasmid parsing
- promoter / ORF / feature annotation
- cloning strategy generation
- gel image analysis
- assay curve fitting
- paper and project context retrieval
- PDF export
- troubleshooting and failure tracking

If every tool is exposed directly through MCP at startup, the model must read many tool names, descriptions, schemas, and usage instructions before doing useful work. This increases the initial token cost and may make tool selection harder.

Therefore, Enana should avoid giving Codex a large flat tool list by default.

## Token-efficient design: tool registry first

Instead of exposing all app functions at startup, Enana can expose only a few always-visible gateway tools:

```ts
tool_search(query: string, domain?: string)
tool_info(tool_id: string, detail_level?: "summary" | "schema" | "examples" | "full")
tool_call(tool_id: string, args: object)
resource_search(query: string, type?: string)
resource_read(uri: string, mode?: "summary" | "full" | "fields")
```

These gateway tools act as a compact interface between Codex and Enana.

Codex starts with only a small amount of tool information. When it needs a specific capability, it searches the registry, requests the relevant schema or examples, and then calls the tool through `tool_call`.

Example flow:

```text
User: Generate a cloning protocol for this plasmid.

Codex calls:
tool_search("cloning protocol plasmid sequence")

Enana returns:
- sequence.parse_plasmid
- sequence.find_features
- sequence.design_cloning
- protocol.generate_from_cloning_plan

Codex calls:
tool_info("sequence.design_cloning", "schema")

Enana returns only the schema and instructions for that tool.

Codex calls:
tool_call("sequence.design_cloning", { ... })
```


## Context control

Codex has its own context-management behavior, but Enana should not rely entirely on Codex to decide what information enters the prompt. Enana should provide a context-control layer inside the Agent Bridge.

The bridge should expose compact search and retrieval tools, while keeping full schemas, examples, long protocol text, notebook history, paper context, and detailed tool instructions outside the initial prompt.

Codex can request more information when needed, but Enana should return it in controlled levels:

- `summary`
- `schema`
- `examples`
- `selected_fields`
- `full`

This means Codex controls the reasoning loop, while Enana controls the context supply.

```text
Codex reasoning loop
    ↓ asks for context
Enana Agent Bridge
    ↓ filters and budgets context
Context Governor
    ↓ retrieves only necessary information
Tool Registry / Resource Store
```

The Context Governor should decide how much information to return based on the task, domain, permission level, and token budget.

Example request shape:

```ts
type ContextRequest = {
  task: string;
  domain?: "notebook" | "protocol" | "inventory" | "sequence" | "gel" | "assay" | "paper" | "project";
  max_tokens?: number;
  detail_level?: "summary" | "schema" | "examples" | "selected_fields" | "full";
};
```

Example response shape:

```ts
type ContextResponse = {
  context_id: string;
  detail_level: "summary" | "schema" | "examples" | "selected_fields" | "full";
  estimated_tokens: number;
  content: unknown;
  can_expand: boolean;
  expansion_options?: Array<"schema" | "examples" | "selected_fields" | "full">;
};
```

A good default rule is:

```text
Start with summaries.
Load schemas only before tool execution.
Load examples only when the model seems uncertain.
Load full content only when summaries or selected fields are insufficient.
```

This gives Enana direct involvement in context control without fighting Codex's own agent loop.

## Tool packs

A useful intermediate strategy is to organize tools into domain-level tool packs.

Examples:

```text
notebook
protocol
inventory
sequence
gel
assay
paper
project
export
```

Each tool pack can have:

- a short summary
- a list of available tools
- full schemas stored outside the initial prompt
- examples available on demand
- safety and permission rules

Codex can first discover a pack, then load only the instructions for that pack.

Example:

```ts
load_tool_pack("sequence")
```

Returns a compact description:

```json
{
  "pack": "sequence",
  "tools": [
    "sequence.parse_plasmid",
    "sequence.find_features",
    "sequence.design_primers",
    "sequence.generate_cloning_protocol"
  ],
  "rules_uri": "enana://instructions/sequence-short"
}
```

This is better than exposing every notebook, inventory, gel, assay, and sequence tool at the same time.

## Suggested Enana architecture

```text
enana-agent-bridge
    ├── MCP server
    │   ├── tool_search
    │   ├── tool_info
    │   ├── tool_call
    │   ├── resource_search
    │   └── resource_read
    │
    ├── Tool registry
    │   ├── short summaries
    │   ├── full schemas
    │   ├── examples
    │   ├── permission rules
    │   └── domain tool packs
    │
    ├── App service layer
    │   ├── notebook service
    │   ├── protocol service
    │   ├── inventory service
    │   ├── sequence service
    │   ├── gel analysis service
    │   ├── assay service
    │   └── export service
    │
    └── Electron app
        ├── database
        ├── local files
        ├── project context
        └── UI state
```

The key rule is that Enana's core logic should not depend on Codex. Codex should only be one possible consumer of the app's tool interface.

## Three interfaces from one implementation

Enana can implement the tools once and expose them through multiple adapters:

```text
Core app services
    ↓
Stable tool interface
    ↓
├── MCP adapter for Codex CLI / Cursor / Claude Code
├── in-app agent adapter for OpenAI API or other model providers
└── normal CLI adapter for debugging and automation scripts
```

Possible package commands:

```bash
enana-tools mcp
enana-tools cli
enana-tools daemon
```

`enana-tools mcp` would be used by Codex CLI.

`enana-tools cli` would be useful for testing tools manually.

`enana-tools daemon` could be used by the Electron app as a local service.

## Example Codex configuration

Codex could connect to Enana through a local MCP process:

```toml
[mcp_servers.enana]
command = "node"
args = ["/path/to/enana-agent-bridge/dist/mcp-server.js"]
```

Or after packaging:

```toml
[mcp_servers.enana]
command = "enana-tools"
args = ["mcp"]
```

## Example gateway tools

### `tool_search`

Search for available Enana tools by natural language goal or domain.

```ts
type ToolSearchInput = {
  query: string;
  domain?: "notebook" | "protocol" | "inventory" | "sequence" | "gel" | "assay" | "paper" | "project" | "export";
};
```

Example response:

```json
[
  {
    "tool_id": "inventory.find_sample",
    "summary": "Find samples by name, alias, type, tag, location, or project.",
    "input_hint": "query, project_id?, sample_type?"
  },
  {
    "tool_id": "inventory.update_sample_location",
    "summary": "Update the physical storage location of a sample.",
    "input_hint": "sample_id, location"
  }
]
```

### `tool_info`

Return more information about one tool only when needed.

```ts
type ToolInfoInput = {
  tool_id: string;
  detail_level?: "summary" | "schema" | "examples" | "full";
};
```

### `tool_call`

Execute an internal Enana tool by ID.

```ts
type ToolCallInput = {
  tool_id: string;
  args: Record<string, unknown>;
};
```

The bridge should validate the arguments against the tool schema before executing.

## Permission model

Some tools should be read-only and safe to call automatically:

- search protocols
- read sample metadata
- read notebook pages
- parse sequence
- analyze uploaded gel image

Some tools should require confirmation or UI approval:

- create notebook entry
- edit notebook entry
- update inventory location
- delete sample
- overwrite protocol
- export or send files

Enana should classify tools by risk level:

```ts
type ToolRisk = "read" | "suggest" | "write" | "destructive" | "external";
```

The MCP bridge can then decide whether to execute immediately, ask the app UI for approval, or reject the call.

## Important design principles

1. Keep the initial MCP surface small.
2. Store full tool instructions outside the initial prompt.
3. Use tool discovery before tool execution.
4. Load domain-specific tool packs on demand.
5. Keep Enana's core services independent from Codex.
6. Reuse the same tool registry for Codex, in-app agents, and debugging CLI commands.
7. Validate all arguments before execution.
8. Require confirmation for write, destructive, or external actions.
9. Return structured outputs that are easy for agents to reason over.
10. Avoid turning everything into one black-box command.

## Practical conclusion

Enana should not treat Codex CLI as just another simple model provider. Instead, Codex CLI should be treated as an external local agent that can connect to Enana through MCP.

The best approach is to build an `Enana Agent Bridge`:

- small MCP interface at startup
- dynamic tool discovery
- on-demand tool manifests
- domain-level tool packs
- validated tool execution
- permission-aware write operations
- reusable adapters for other agents

This design saves tokens, keeps the architecture clean, and makes Enana compatible with Codex CLI without locking the app to Codex.