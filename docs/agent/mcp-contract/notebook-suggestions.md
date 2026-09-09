# Background experiment suggestions

Biology Notebook projects offer **Suggest next experiment**. A background Codex run also starts after a page is first saved as Executed or a Planned page is marked Executed. A project with an unaccepted Suggested page reuses it; automatic runs skip it. Concurrent runs are suppressed per project.

`notebook_suggest` is visible and callable only when the request context identifies a `notebook_suggestion` run. It reuses `notebook_draft` protocol selection, exact placeholder keys, unresolved-value reporting, and edits to a copied protocol. It additionally accepts optional `title` and `rationale` strings. The project is bound by the background request, not by model-supplied arguments.

The MCP tool prepares one `suggestion_only` notebook payload. Hikari saves the returned page into its current notebook state after the background run completes, preserving the copied protocol, values, rationale and unresolved fields. Navigating to another page does not interrupt delivery. Closing the app interrupts an unfinished run; retry from the project button.

During this workflow the MCP surface allows only `notebook_suggest`, `notebook_lookup`, `protocol_lookup`, `inventory_lookup`, `chemical_lookup`, and `literature_search`. Other calls are rejected. `deny_paper_download` also blocks the underlying paper-download executor. Literature search returns metadata before PDF enrichment, acquisition or delegated reading, including when legacy auto-download flags are supplied. Native web search is disabled and the prompt forbids downloads through other tools.

Suggested entries have `notebookState: "suggested"`, no execution timestamp, and provenance in `agentDraftMeta`. They appear first within their project with a pale spectrum tint, italic dark-grey text and a Suggested label. Ordinary saves preserve this state. **Take into plan** saves current edits and changes the same entry to Planned; only then is the Executed action available. Suggestions are excluded from contribution activity and experimental conclusions. SQL indexing, PDF labels and renderer state preserve the Suggested status.
