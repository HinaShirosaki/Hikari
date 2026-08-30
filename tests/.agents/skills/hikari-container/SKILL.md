---
name: "hikari-container"
description: "Use Hikari MCP container for temporary exact string or number containers, short reusable IDs, copied values, and position-based string edits."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:container -->

# Hikari Container MCP

Use this skill when a value should be held exactly for later reuse, comparison, or editing during the current Hikari/Codex run. Containers are temporary scratch values, not durable user memory.

Direct tool:

- Call the direct Hikari MCP tool `container`.

Container rules:

- Store only strings or finite numbers.
- Give each useful container a short human-readable `name`; the tool assigns the real short `id` such as `1`, `2`, or `3`.
- Use returned IDs exactly. Do not invent IDs, UUIDs, or long handles. If unsure, call `list` or `read` before editing.
- Prefer copied exact values from loaded context, tool output, selected text, files, or the user's message. Avoid directly authoring or retyping long strings or precise numbers into `value` when a copy source is available.
- Direct literals are feasible when the value is genuinely supplied in the current message, is tiny and unambiguous, or no machine-readable source exists. In that case, include a `source` such as `"direct_literal:user_message"`.
- Do not use `container` for durable preferences or project facts; use the Hikari memory tool only for long-term memory.

Actions:

- Create: `{ "action": "create", "name": "threshold", "value": 0.42, "source": "copied:paper_table_1" }`
- Read: `{ "action": "read", "id": "1" }`
- List: `{ "action": "list", "limit": 20 }`
- Update full value: `{ "action": "update", "id": "1", "value": "new exact value", "source": "copied:user_selection" }`
- Rename: `{ "action": "rename", "id": "1", "new_name": "final threshold" }`
- Delete: `{ "action": "delete", "id": "1" }`

String edit workflow:

1. Call `read` for the target container unless the exact current string and ID are already in the latest tool result.
2. Count offsets using zero-based indexes; `start` is inclusive and `end` is exclusive.
3. Call `replace_range`, for example `{ "action": "replace_range", "id": "1", "start": 12, "end": 16, "replacement": "37 C" }`.
4. Read the returned `container.value` as the source of truth after the edit.
