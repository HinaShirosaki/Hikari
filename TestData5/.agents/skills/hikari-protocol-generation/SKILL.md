---
name: "hikari-protocol-generation"
description: "Use Hikari MCP protocol_generation to normalize complete protocol JSON and queue protocol saves for user approval."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:protocol-generation -->

# Hikari Protocol Generation MCP

Use this skill when the user asks Codex to prepare, normalize, add, save, or import a wet-lab protocol for Hikari.

Workflow:

1. Build or collect a complete protocol JSON object first. Include a clear `name`, `purpose`, `materials`, and non-empty `steps`.
2. Call the direct Hikari MCP tool `protocol_generation`.
3. Set `save: true` only when the user explicitly asks to add, save, import, or persist the protocol. Hikari will queue user approval before adding it to Protocols.
4. Use the tool result as the source of truth for normalized protocol fields and approval status.

Do not call `protocol_generation` with prose alone. The MCP tool normalizes protocol JSON; it does not author missing protocol content internally.
