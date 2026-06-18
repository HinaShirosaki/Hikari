---
name: "hikari-notebook-draft"
description: "Use Hikari MCP mcp__hikari__notebook_draft to prepare planned next-experiment notebook drafts for user confirmation."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:notebook-draft -->

# Hikari Notebook Draft MCP

Use this skill when the user asks for a planned notebook draft, next experiment plan, workflow follow-up, or future biology notebook page.

Direct tool:

- Call the direct Hikari MCP tool `mcp__hikari__notebook_draft`.

Draft context checklist:

- `message`: the user's notebook-draft request or planning goal.
- `project_id` or `project_name`: include the selected or resolved Hikari project when known.
- `workflow_id`: include the workflow step identifier when the next experiment should follow a workflow.
- `protocol_name` or `protocol_candidates`: include likely protocol names when the draft should be based on a protocol.
- `evidence_context`: include compact summaries from records, protocol lookup, notebook lookup, literature, or paper analysis that were actually loaded for this turn.
- `parser_payload`: include intent/entity hints when the surrounding Hikari run already prepared them.

Workflow:

1. Resolve the project and experiment target from the selected project, user request, recent workflow state, protocol candidates, and loaded notebook history.
2. Gather local Hikari context first when it matters: protocol candidates, workflow progress, previous notebook results, relevant records, and paper-derived evidence.
3. Call `mcp__hikari__notebook_draft` with the resolved project fields, workflow/protocol hints, and evidence context.
4. Read the tool result and use `status`, `proposal_summary`, `proposal`, `notebook`, `missing_placeholders`, and `follow_up_questions` as the source of truth.
5. Return the confirmation-ready draft for user approval. Include concise next-step context and any follow-up questions reported by the tool.

If one blocking detail is missing, ask the user through the Hikari clarification flow instead of inventing values.
