---
name: "hikari-paper-retrieval"
description: "Use Hikari MCP paper-intake retrieval tools to find already-ingested papers, summaries, and experiment entries from the local paper-intake knowledge base before reading full paper markdown."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:paper-retrieval -->

# Hikari Paper Retrieval MCP

Use this skill when the user asks about papers that are already in Hikari, asks which ingested paper covers a topic, asks what experiments an ingested paper ran, or asks for a project-level roll-up of previously ingested papers.

Do not use this skill to download new papers. For new external literature search or PDF download, use the literature or paper-download flow first. This skill is for the local paper-intake knowledge base produced after a title-named Markdown file exists under `KnowledgeBase/papers.md/<paper_id>/` and the paper-intake summary has been saved.

Direct tools:

- `paper_intake_search_summaries` — find candidate papers across titles, DOIs, one-sentence summaries, experiment details and evidence, and saved outlines/claims. Existing intake records are searchable without reprocessing.
- `paper_intake_search_experiments` — search structured experiment entries by assay, technique, condition, variable, figure/table reference, outcome, or verbatim evidence.
- `paper_experiments_sql` (when enabled) — query the experiment SQLite database with one read-only `SELECT`, including joins, exact filters, grouping, counts, and `WITH` clauses. Its tool description contains the table schema.
- `paper_intake_list_project_summaries` — list ingested paper summaries attached to a known Hikari project.

Retrieval workflow:

1. Decide the narrowest retrieval mode:
   - Use `paper_intake_search_summaries` for "find papers about...", title/topic/finding questions, or when the user wants candidate papers.
   - Use `paper_intake_search_experiments` for "which paper did assay X?", "find experiments using technique Y", condition/outcome questions, or figure-level experiment lookup.
   - Use `paper_intake_list_project_summaries` when the user gives a project name, or has an active project, and wants papers attached to that project.
2. For either search tool, use a short keyword `query` and preserve technical terms such as assay names, proteins, cell lines, compounds, figure labels, and paper-specific tags. Search defaults to the active project when present; use `scope: "library"` for all local papers. An explicit `project_name` takes precedence over scope. For the project roll-up, pass `project_name` when supplied or rely on active-project context; do not add `query`.
3. Inspect `status`, `search_scope`, `items`, `matched_terms`, `unmatched_terms`, `match_coverage`, `match_context`, `score`, `doc_type`, `paper_id`, `title`, `one_sentence_summary`, `experiment`, and `source_paths`. `match_context` contains stored field excerpts and available experiment/figure references. `match_coverage` is the fraction of query terms matched, not a probability or proof that the paper answers the question. Check `total_matches` and `truncated` before claiming completeness.
4. If the returned fields answer the question, answer from the tool result and cite the returned `paper_id`, `title`, and `source_paths.paper_md`.
5. If the user asks for details that are not in the summary or experiment entry, read the returned `source_paths.paper_md` from the current workspace before answering. Use `extracted.txt`, figures, or the original PDF only when that Markdown file leaves a concrete question unanswered.
6. If matches are absent or weak, retry with concise identifiers, expanded acronyms, or alternative wording. If the user has not restricted retrieval to a project, retry with `scope: "library"`. Search local paper Markdown with available file-search tools before declaring a paper absent; the intake index is a compressed representation and these tools are lexical, not general semantic search. This fallback requires workspace file-search access: if unavailable, explicitly say that full text was not searched. The internal `paper-search` wiki tool is not exposed by this MCP contract. Report remaining retrieval limits explicitly, then continue external research when the user's request authorizes it.

Argument patterns:

- Topic search:
  `{ "query": "MG-PACE compact degron molecular glue", "limit": 5 }`
- Experiment search:
  `{ "query": "phage-assisted continuous evolution SD40", "technique": "phage-assisted continuous evolution", "limit": 5 }`
- Project roll-up:
  `{ "project_name": "Atlas", "doc_types": ["research_paper"], "limit": 20 }`

SQL retrieval:

- Use `paper_experiments_sql` for exact questions or aggregations that keyword ranking cannot answer. Example:
  `{ "sql": "SELECT p.paper_id, p.title AS paper_title, p.paper_md, e.id, e.technique, e.figure_ref, e.outcome, e.evidence FROM experiments e JOIN papers p USING (paper_id) WHERE e.technique LIKE ? ORDER BY p.paper_id, e.ordinal", "parameters": ["%blot%"], "limit": 50 }`
- Queries cover the whole workspace library. For project-specific questions, first get paper IDs from project-summary retrieval and constrain SQL with those IDs; `project_ids_json` is the saved intake membership, not a live project-link resolver.
- Read `columns` and the corresponding value arrays in `rows`. Check `truncated` and `truncation_reason`; use a narrower projection/filter or ordered `LIMIT`/`OFFSET` paging as needed. Counts describe extracted records, not all experiments in the original paper. Prefer `COUNT(*)` for totals instead of counting a capped response.
- To inspect columns, use `SELECT * FROM pragma_table_info('experiments')` or the same query for `papers`. SQL values can be bound with `?` and `parameters`; file paths and mutations are not accepted.
- If SQLite is missing or unavailable, use the intake search tools and report that SQL retrieval was unavailable. Queries do not build or repair the database.

Answering rules:

- Prefer the paper-intake MCP result over memory or guesses for local paper availability.
- Do not imply a paper is attached to a project unless `paper_intake_list_project_summaries` or the returned `project_ids` supports it.
- Do not claim the full paper supports a detail unless you read the returned `source_paths.paper_md` or the detail appears in the returned `experiment` or `one_sentence_summary`.
- Matches from separate experiments can make a paper relevant without establishing that a single experiment combined every requested condition. Read the identified experiment and source text before making that claim.
- For reviews, books, or non-research documents, do not invent experiments; use `doc_type`, `structure_outline`, or `notable_claims` only when the returned record provides them.
- Keep citations local and concrete: use `paper_id`, title, and `source_paths.paper_md` rather than invented source labels. Use the paper title, not the raw Markdown basename, as the visible citation label.
