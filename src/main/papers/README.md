# Papers (main process)

This folder owns every Node-side paper capability: literature search, PDF
download, PDF → Markdown parsing, paper identity, the local knowledge store,
LLM paper reading, experiment intake, and the scheduled paper finder. Two
callers use it:

- the **Papers** workspace, through the storage IPC (`storage:transform-paper-pdf`,
  `storage:discover-papers`) and the direct-LLM modules;
- the **agent**, through the tool executors registered in
  `src/main/agent/tools/register-agent-tool-executors.js` and the MCP tools in
  `store/intake/mcp/`.

Agent code injects these runtimes; it must not reimplement them. Code here may
use `src/main/lib/llm/` but must not import agent tools or controllers.

## Folders

| Folder | What it does |
| --- | --- |
| `search/` | `literature_search`: PubMed, Europe PMC, Crossref, UniProt, and web results, with preferred-journal filtering (journal filters apply only to PubMed, Europe PMC, and Crossref) and candidate scoring. |
| `download/` | `paper_download`: finds PDF URLs, downloads over HTTP, falls back to a browser-assisted download, verifies the PDF, and reconciles with saved receipts (`.hikari-downloads/`) so a repeat request reuses the file. |
| `parse/` | PDF text extraction (pdf.js), layout cleanup (running headers, tables), figure extraction to PNG, and the Markdown written under `KnowledgeBase/papers.md/<paper>/`. |
| `identity/` | DOI / PMID / PMCID / title normalization and identity matching, used to de-duplicate papers. |
| `store/` | The knowledge index (`KnowledgeBase/knowledge.index.sqlite`: paper identity and locations only), per-paper `meta.json`, and experiment **intake** (see below). |
| `retrieve/` | Loading paper context for a question: section splitting, related comments, PDF excerpts and figure review, and the internal full-text `paper-search` over `papers.md` (in-memory overlapping windows; no FTS index). |
| `analysis/` | `paper_analysis`: one Codex paper-context read over a local `paper.md`, with the returned line ranges hydrated and matching local comments attached. |
| `workflow/` | Multi-step literature research: search → acquire → read, the Codex paper-context sub-agent, research sessions, and line-range payloads. |
| `finding/` | The scheduled **paper finder**: task input, frequency and project binding, result parsing, and marking papers already saved. Runs as a scheduled Codex task (`src/main/scheduled-tasks/`). |
| `shared/` | Paper comment/annotation context and the review-journal filter (skips review venues without dropping journals such as *Physical Review Letters*). |

## Intake

`store/intake/` turns a parsed paper into structured records:

1. `intake-pipeline.js` classifies the document (research, review, book, …).
   Reviews are skipped; other non-research documents get a summary; research
   papers are read page by page to extract experiments (technique, variables,
   figure reference, outcome, verbatim evidence), an outline, and claims.
2. `intake-store.js` saves `intake.json` beside the paper's Markdown. That file
   is the recoverable source of truth.
3. `store/experiment-database.js` mirrors the experiments into
   `KnowledgeBase/experiments.sqlite` for `paper_experiments_sql`
   (`store/experiment-query*.js` run read-only queries in a worker).
4. `intake-search.js` and `search/` serve `paper_intake_search_summaries` and
   `paper_intake_search_experiments` with lexical scoring over cached,
   compiled records; `mcp/` holds the MCP definitions for all four intake tools.

Storage details, limits, and the rebuild/compaction scripts
(`scripts/maintenance/`) are in
[docs/main-platform/data/storage-and-bundles.md](../../../docs/main-platform/data/storage-and-bundles.md#paper-knowledge-storage).
Tool contracts are in
[docs/agent/mcp-contract/mcp-contract.md](../../../docs/agent/mcp-contract/mcp-contract.md).
