---
name: "hikari-paper-retrieval"
description: "Use Hikari MCP paper-intake retrieval tools to find already-ingested papers, summaries, and experiment entries from the local paper-intake knowledge base before reading full paper markdown."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:paper-retrieval -->

# Hikari Paper Retrieval MCP

Use this skill when the user asks about papers that are already in Hikari, asks which ingested paper covers a topic, asks what experiments an ingested paper ran, or asks for a project-level roll-up of previously ingested papers.

Do not use this skill to download new papers. For new external literature search or PDF download, use the literature or paper-download flow first. This skill is for the local paper-intake knowledge base produced after a title-named Markdown file exists under `KnowledgeBase/papers.md/<paper_id>/` and the paper-intake summary has been saved.

Direct tools:

- `paper_intake_search_summaries` — search ingested paper titles and one-sentence summaries by topic, finding, organism, method, molecule, or concept.
- `paper_intake_search_experiments` — search structured experiment entries by assay, technique, condition, variable, figure/table reference, or outcome.
- `paper_intake_list_project_summaries` — list ingested paper summaries attached to a known Hikari project.

Retrieval workflow:

1. Decide the narrowest retrieval mode:
   - Use `paper_intake_search_summaries` for "find papers about...", title/topic/finding questions, or when the user wants candidate papers.
   - Use `paper_intake_search_experiments` for "which paper did assay X?", "find experiments using technique Y", condition/outcome questions, or figure-level experiment lookup.
   - Use `paper_intake_list_project_summaries` when the user gives a project name, or has an active project, and wants papers attached to that project.
2. For either search tool, use a short keyword `query` and preserve technical terms such as assay names, proteins, cell lines, compounds, figure labels, and paper-specific tags. For the project roll-up, pass `project_name` when supplied or rely on active-project context; do not add `query`.
3. Inspect `status`, `items`, `matched_terms`, `score`, `doc_type`, `paper_id`, `title`, `one_sentence_summary`, `experiment`, and `source_paths`.
4. If the returned fields answer the question, answer from the tool result and cite the returned `paper_id`, `title`, and `source_paths.paper_md`.
5. If the user asks for details that are not in the summary or experiment entry, read the returned `source_paths.paper_md` from the current workspace before answering. Use `extracted.txt`, figures, or the original PDF only when that Markdown file leaves a concrete question unanswered.
6. If no intake item matches, say that the local paper-intake KB had no match. Then ask whether to search external literature or download/ingest a new paper if that would help.

Argument patterns:

- Topic search:
  `{ "query": "MG-PACE compact degron molecular glue", "limit": 5 }`
- Experiment search:
  `{ "query": "phage-assisted continuous evolution SD40", "technique": "phage-assisted continuous evolution", "limit": 5 }`
- Project roll-up:
  `{ "project_name": "Atlas", "doc_types": ["research_paper"], "limit": 20 }`

Answering rules:

- Prefer the paper-intake MCP result over memory or guesses for local paper availability.
- Do not imply a paper is attached to a project unless `paper_intake_list_project_summaries` or the returned `project_ids` supports it.
- Do not claim the full paper supports a detail unless you read the returned `source_paths.paper_md` or the detail appears in the returned `experiment` or `one_sentence_summary`.
- For reviews, books, or non-research documents, do not invent experiments; use `doc_type`, `structure_outline`, or `notable_claims` only when the returned record provides them.
- Keep citations local and concrete: use `paper_id`, title, and `source_paths.paper_md` rather than invented source labels. Use the paper title, not the raw Markdown basename, as the visible citation label.
