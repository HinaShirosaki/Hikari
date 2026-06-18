---
name: "hikari-protocol-generation"
description: "Use Hikari MCP mcp__hikari__protocol_generation to normalize complete protocol JSON and queue protocol saves for user approval."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:protocol-generation -->

# Hikari Protocol Generation MCP

Use this skill when the user asks Codex to prepare, normalize, add, save, or import a wet-lab protocol for Hikari.
Also use it when the user asks to turn paper methods, selected paper text, local records, or a draft procedure into a Protocols-module candidate.

Direct tool:

- Call the direct Hikari MCP tool `mcp__hikari__protocol_generation`.

Protocol JSON checklist:

- `protocol.name`: concise protocol title suitable for the Protocols module.
- `protocol.purpose`: short experimental goal, including the biological system or assay when known.
- `protocol.materials`: array of reagents, samples, equipment, strains, plasmids, cell lines, buffers, and controls supported by the loaded evidence.
- `protocol.steps`: ordered array of strings or step objects. Include timing, temperature, volumes, concentrations, incubation conditions, controls, and readouts inside the relevant step text. When a value should remain user-fillable, write a bracket placeholder directly in the step text, such as `[volume]`, `[buffer]`, `[temperature]`, or `[time]`.
- `protocol.troubleshooting`: caveats, quality checks, expected outcomes, failure modes, safety notes, and paper-specific limitations when available.
- `result_summary`: one sentence describing what was prepared.
- `save: true`: include this when the user asks to add, save, import, persist, or queue the generated protocol for review.

Placeholder usage:

- Use bracket placeholders for values the user must choose at execution time or values not specified by the evidence: `"Add [volume] of [buffer] to each [sample]."`
- Prefer meaningful placeholder names that match what the user will fill in later, for example `[plasmid]`, `[protein]`, `[volume]`, `[buffer]`, `[temperature]`, or `[time]`.
- If supplying structured step objects with explicit placeholder ids, bind each placeholder in `text` with `{{ph:<id>}}` and include matching `placeholders: [{ id: "<id>", name: "<display name>" }]`.
- Do not invent exact values just to remove a placeholder. Keep placeholders visible when the paper, selected text, or user request leaves the value open.

Workflow:

1. Gather the source evidence first: active paper markdown, selected methods text, local protocols, records, or user-provided procedure text.
2. Author the complete protocol JSON yourself from that evidence, using placeholders for execution-time or missing values.
3. Call `mcp__hikari__protocol_generation` once with `{ protocol, result_summary, save: true }` for generated protocols that should enter Hikari review.
4. Read the tool result and use the returned `protocol`, `status`, `save_requested`, and `requires_user_approval` fields as the source of truth.
5. Reply in normal assistant prose that the generated protocol is ready for review, and mention the normalized protocol name plus any important caveats or user-fillable placeholders.

The `mcp__hikari__protocol_generation` tool expects complete protocol JSON and returns the normalized protocol fields plus approval status.
