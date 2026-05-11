## Papers Knowledge Base — Design Notes

Goal: a single source of truth for every paper the user (or an agent) has touched, so LLM agents can look up before they download and so the wiki-form knowledge can be regenerated from the original PDF on demand.

### Layout on disk

- One global folder: `<root>/Papers/<journal-club-or-topic>/`.
- One per-project folder: `<root>/Project/<project-name>/Papers/`.
  - Already produced by `buildPaperStorageFolder` in [src/renderer/modules/papers/storage.js](src/renderer/modules/papers/storage.js).
- Keep the user-visible PDF in the existing paper folder. Store the LLM-facing transformed artifacts in a separate knowledge folder so the Papers library stays a PDF library:
  ```
  <root>/KnowledgeBase/papers.md/<doi-or-slug>/
    paper.md          # wiki-form rewrite for LLM use
    extracted.txt     # raw output of the PDF→text tool, kept for re-runs
    figures/          # extracted images, if any
    meta.json         # cached metadata mirror of the index row
  ```
  - Folder name is the DOI with `/` replaced by `_`; fall back to a sanitized title slug when DOI is missing.

### SQLite index

- Single shared DB file (the common one referenced in [idea/storage.md](idea/storage.md), not the chemical-inventory DB).
- Purpose: cheap lookup for "do we already have this paper?" and "where does it live?" — not full text. The full text lives in `KnowledgeBase/papers.md/.../paper.md` / `extracted.txt`.

Tables:

- `papers` — one row per logical paper (a paper used in three projects is still one row):
  - `id` (pk), `doi` (unique, nullable), `title`, `abstract`, `authors` (json array), `journal`, `year`, `url`, `pdf_sha256` (dedupe key when DOI is missing), `added_at`, `updated_at`, `source` (`manual` | `agent` | `auto-discovery`), `wiki_status` (`none` | `pending` | `ready` | `failed`), `wiki_path` (relative path to `paper.md`), `extraction_status`, `notes`.
- `paper_locations` — one row per physical copy on disk:
  - `id`, `paper_id` (fk), `scope` (`global` | `project` | `journal-club`), `container` (project name / club name / null), `folder_path`, `pdf_filename`, `discovered_at`.
  - A paper can have many locations; the agent picks the one matching its current project before falling back to global.
- `paper_tags` — `paper_id`, `tag` — for topic/keyword filters surfaced to the agent.
- `paper_links` — `from_paper_id`, `to_paper_id`, `relation` (`cites`, `cited-by`, `related`) — populated lazily, used by the wiki to cross-link.

Indexes: unique on `papers.doi`, unique on `papers.pdf_sha256`, index on `paper_locations.paper_id`, index on `paper_tags.tag`.

### Agent lookup flow

When an agent is asked to read or fetch a paper:

1. Normalize the request to a DOI (or title + first author + year if no DOI).
2. Query `papers` by DOI; if miss, fuzzy-match on title + year.
3. On hit:
   - Pick a location from `paper_locations` (project-scoped first, then global).
   - If `wiki_status = ready`, hand back `paper.md`.
   - If `wiki_status != ready` but the PDF exists, run the PDF→MD pipeline (below) before answering.
4. On miss: download, then run the ingestion pipeline.

This is the contract that prevents duplicate downloads — every fetch path goes through the index first.

### Ingestion pipeline (PDF → wiki-form .md)

Reuse the existing extractor at [src/main/helpers/agent/tools/agent-pdf-text-extraction.js](src/main/helpers/agent/tools/agent-pdf-text-extraction.js) — do not re-implement.

Stages:

1. **Extract** — call the existing tool, write `extracted.txt`, capture per-page boundaries so the wiki can cite page numbers later.
2. **Parse metadata** — DOI / title / authors / abstract from PDF metadata first, then from the first page text as a fallback. Compute `pdf_sha256`. Upsert into `papers`.
3. **LLM rewrite into wiki form** — pass `extracted.txt` to an LLM with a fixed prompt that produces `paper.md` with this skeleton:
   ```
   # <Title>
   **Authors:** ...   **Year:** ...   **DOI:** ...
   ## TL;DR
   ## Background
   ## Methods
   ## Key results
   ## Figures & tables   <!-- one bullet per figure with a one-line gloss -->
   ## Limitations
   ## How it relates       <!-- links to other paper.md files via [[doi]] -->
   ## Verbatim quotes      <!-- short quotes worth citing, with page numbers -->
   ```
   - Wiki form = self-contained, link-rich, written for an LLM reader (dense, no fluff, every claim traceable to a page in `extracted.txt`).
   - `[[doi]]` style links resolved at render time via `paper_links`.
4. **Persist** — write `paper.md`, set `wiki_status = ready`, update `wiki_path`, refresh `meta.json`.
5. **Index locations** — insert into `paper_locations` for the folder it landed in.

If any stage fails, mark the corresponding status column and keep the partial outputs — the agent can retry just the failed stage.

### Auto-discovery

Per [idea/storage.md](idea/storage.md), opening the Papers module scans every paper folder (global + every `Project/*/Papers`). Reuse that scan to:

- Insert any unseen PDF into `paper_locations` (and `papers` if its hash is new).
- Backfill `paper.md` for rows where `wiki_status = none`.

### Open questions

- Where does the wiki-rewrite LLM call live — main process (so agents can call it directly) or renderer? Main is the simpler answer since the extractor is already there.
- Do we want full-text search (FTS5 on `paper.md`) in v1, or punt until the index is in use? Lean toward punting.
- Cross-project deduping: if the same PDF lands in two projects, do we hard-link, copy, or only keep one canonical copy and reference it? Pick a policy before auto-discovery starts moving files around.
