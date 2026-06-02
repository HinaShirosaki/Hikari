---
name: "hikari-notebook-draft"
description: "Use Hikari MCP notebook_draft to prepare planned next-experiment notebook drafts for user confirmation."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:notebook-draft -->

# Hikari Notebook Draft MCP

Use this skill when the user asks for a planned notebook draft, next experiment plan, workflow follow-up, or future biology notebook page.

Workflow:

1. Prefer local project, protocol, workflow, and notebook context from Hikari MCP tools before guessing.
2. Call the direct Hikari MCP tool `notebook_draft`.
3. Include `project_id` or `project_name` when known. Include `workflow_id`, `protocol_name`, or `protocol_candidates` when the draft should follow a specific workflow or protocol.
4. Include `evidence_context` only when evidence was actually loaded from records, literature, or paper analysis.
5. Return the confirmation-ready draft. Do not create or save the notebook page yourself.

If one blocking detail is missing, ask the user through the Hikari clarification flow instead of inventing values.
