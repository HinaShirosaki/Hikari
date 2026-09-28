---
name: "hikari-notebook-draft"
description: "Use Hikari MCP notebook_draft to prepare planned next-experiment notebook drafts for user confirmation."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:notebook-draft -->

# Hikari Notebook Draft MCP

Use this skill when the user asks for a planned notebook draft, next experiment plan, workflow follow-up, or future biology notebook page.

Direct tool:

- Call the direct Hikari MCP tool `notebook_draft`.

Draft context checklist:

- `project_name`: the selected or resolved Hikari project name when known.
- `protocol_candidates`: up to 20 likely protocol names, with the strongest candidate first; one is selected per page.
- `pending_values`: known placeholder values. Every key must exactly match a `placeholder_key` (the placeholder id) from the normalized protocol or an earlier notebook-draft result; display names are not keys.
- `step_edits`: up to 240 optional draft-only replacements by `step_number`, or appended step text when `step_number` is omitted. These edits never mutate the saved protocol.
- `title`: an optional distinctive page title. `draft_id`: the returned proposal_id when refining an existing page, so the updated proposal replaces that page rather than creating a duplicate.
- `drafts`: for multiple pages, an array of 1–20 individual requests using the fields above. Each page selects one protocol and keeps its own values and edits. Additional calls retain earlier drafts, and each page must be approved separately.
- These are the only supported tool arguments. The host already supplies the current message and project context; do not send `message`, `project_id`, `workflow_id`, `evidence_context`, or `parser_payload`.

Placeholder fill rules:

- Put actual selected, user-provided, evidence-supported, or deliberately chosen routine starting values in `pending_values`. Never fill a placeholder with uncertainty prose such as `not specified`, `unknown`, or a generic restatement of its label.
- For a newly normalized protocol, the keys are its returned placeholder ids.
- After the first notebook-draft result, inspect `missing_placeholders`. If any values are already known or are safe routine starting choices, retry once using their exact returned `placeholder_key` values.
- Do not call a draft confirmation-ready while avoidable routine placeholders remain. Aim for 0-3 unresolved choices and review any result with more than 5; ask one blocking clarification only for genuinely sample-, reagent-, or instrument-specific decisions.

Workflow:

1. Resolve the project and experiment target from the selected project, user request, recent workflow state, protocol candidates, and loaded notebook history.
2. Gather local Hikari context first when it matters: protocol candidates, workflow progress, previous notebook results, relevant records, and paper-derived evidence.
3. Call `notebook_draft` with a single page request or a `drafts` array. A top-level `project_name` is the default project for batch items.
4. Read the tool result and use `status`, `proposal_summary`, `proposal`, `notebook`, `missing_placeholders`, and `follow_up_questions` as the source of truth. Batch results include `notebooks` and per-item `results`; report failed items honestly without discarding successful pages.
5. Retry once with exact placeholder keys and the same `draft_id` when known or routine values can be supplied, then return the confirmation-ready drafts or the one genuinely blocking follow-up question.

If one blocking detail is missing, ask the user through the Hikari clarification flow instead of inventing values.
