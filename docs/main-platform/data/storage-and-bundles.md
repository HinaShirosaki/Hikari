# Storage And Bundles

The data-persistence story in the `src/main/` platform layer (`storage/`, `data/`, `lib/`) is built around a compact primary snapshot plus one JSON file per record in module-owned folders under the storage root, with SQLite only for the chemical inventory (and the paper and sequence indexes their own modules own).

> Layout note: `data-helpers.js` and `data-snapshot-utils.js` live under `data/`, and the persistence engine is the `storage/` folder (entry: `storage/index.js`).

## The compact snapshot

`data/data-snapshot-utils.js` exports `buildCompactIndexedSnapshot(snapshot)`.

Its job is to strip the heavy searchable data out of the main JSON file before it is written. In practice it:

- clears `protocols`
- clears `notebookEntries`
- clears `samples`
- clears `labInventory.chemicals`
- clears `inventory`
- keeps lightweight bundle metadata under `data_bundle`

This is the snapshot shape written by the persistence facade.

## The high-level facade: `data/data-helpers.js`

`createMainDataHelpers(...)` is the small facade used by `register-data-ipc.js`.

It exposes four operations:

- `saveSelectedDataFile`
- `loadSelectedDataFile`
- `autoSaveDataFile`
- `autoLoadDataFile`

Internally those all funnel into:

- `persistSnapshot(...)`
- `loadSnapshot(...)`

The key detail is that persistence is not “write one JSON file and stop.” A save also writes the record folders and the chemicals SQLite index through `syncBundleFromSnapshot(...)`. Production callers use the decorated version built in `core/main-services.js`, which also releases the official Codex skills into each project's `.agents/skills/` and requests project-memory conclusions.

## `storage/` is the persistence engine

This folder defines the on-disk layout. Its work is split across focused modules — `storage-paths.js`, `storage-sidecars.js`, `storage-discovery.js`, `storage-hydration.js` (+ `hydration/`), `storage-import.js`, `storage-sql-read.js`, `storage-sql-write.js`, `storage-sql-schema.js`, `chemical-index-guard.js`, `sample-containers.js`, `experiment-log-storage.js`, `workflow-storage.js` (+ `workflow/`), `paper-discovery.js`, and `sequence-library-summary.js` — re-exported from `storage/index.js`.

`getBundlePaths(...)` is the shared path builder used throughout the folder. Given the snapshot path (or just the storage root), it resolves every root folder below: `Protocol/`, `Samples/`, `Plates/`, `Gels/`, `Papers/`, `KnowledgeBase/` and its `papers.md/`, `Dashboard/experiment-log.json`, and `hikari-chemicals.index.sqlite`. It still reports the old `<snapshot>.notebook-pages.json` path so a save can delete it and a load can read it once.

Every save updates these from the snapshot. Protocol and notebook text is read from Markdown; companion JSON keeps structured state and a recovery checkpoint. Other modules retain their existing JSON or SQLite storage:

| Data | Stored as |
| --- | --- |
| Protocols | `Protocol/<name>__<id>/protocol.md`, with `protocol.json` for structured state and recovery |
| Notebook pages | `page.md` and companion `page.json` in page folders under `Project/` and `Workflow/` |
| Workflow templates, runs | `Workflow/<template>__<id>/template.json`, `Workflow/<template>__<id>/<run>__<id>/workflow.json` |
| Personal inventory, samples | `Samples/<zone>/<container>__<id>.json` per container, `Samples/<zone>/folders.json`, `Samples/unplaced.json` (see below) |
| Plates (assays) | `Plates/<name>__<id>/assay.json`, beside the assay's artifacts |
| Legacy gels | `Gels/<name>__<id>/gel.json`, beside the gel's artifacts. These are `state.gelAnalyses` records from before Gel became a plugin; nothing writes new ones, and the Gel plugin imports them. The plugin keeps its own records in `settings.pluginStorage.gel` (inside the snapshot) and its files under `Plugins/gel/` |
| Papers | `<file>.pdf.json` beside each stored PDF (under `Papers/`, `Project/<p>/Papers/`, `RelatedPapers/`): links, highlights, comments, bookmarks, summaries |
| Chemicals | `hikari-chemicals.index.sqlite` (`inventory_chemicals`, `inventory_meta`) |
| Home experiment log | `Dashboard/experiment-log.json` (the `settings.dashboard` quick-log draft and entries) |
| Project memory | `Project/<project>/MEMORY.md` (generated; see `src/main/project-memory/`), `Project/<project>/.hikari/research-memory.json` (cached notebook conclusions), plus empty `Project/<project>/.agents/skills/` and `Project/<project>/DNA/` folders |

Personal inventory is one file per container (`src/main/storage/sample-containers.js`). Each file holds the container's fields, its `wellCount`, and only the wells that hold a sample (or still carry legacy well text), with those samples inside the well entry; samples linked to a container but no well sit in the file's own `samples`. Loading rebuilds the full `wells` array from `wellCount`, so the renderer sees what it saved. Type-specific sample fields stay in each sample's `details`, which the agent inventory lookup searches and returns as a whole, so a new sample type or field needs no storage or search change. `folders.json` holds a zone's container folders, and `unplaced.json` the samples no container holds. A save deletes the file of a removed container, and a zone folder once it is empty.

Hydration finds papers by walking the same folders paper discovery scans for PDFs and reading each PDF's `.json`; a record follows its PDF, so its `storedRelativePath` is taken from where the PDF actually is, and moving a stored file moves its record with it. It finds assays and gels by scanning `Plates/*/assay.json` and `Gels/*/gel.json`, and workflows by scanning `Workflow/*/template.json` and `Workflow/*/*/workflow.json`; there is no summary file or index. If two folders hold the same record id (a root saved by an older build, or a save interrupted between writing a renamed folder and pruning the old one), the most recently written file wins. A record whose `storageFolder` is already a folder under that root keeps it, so its record file sits next to its images and analysis results. Removing a record deletes only its record file (for workflows, `template.json` / `workflow.json`; results, notebook pages and `MEMORY.md` stay), and an assay or gel folder only once empty.

`KnowledgeBase/knowledge.index.sqlite`, `KnowledgeBase/experiments.sqlite` and `DNA/sequence-library.sqlite` are owned and written by their own modules.

### Protocol and notebook Markdown

`storage/record-markdown/` saves `protocol.md` and `page.md`, including workflow notebook pages. Markdown is authoritative for protocol name/purpose/materials/steps/troubleshooting and notebook notes/results. All folder hydration and storage-root import paths read those fields back from Markdown, so renderer views, search, agent lookup/matching, cloning workflows and PDF exports receive the current text through their existing record APIs. JSON input to agent tools and the protocol importer remains a supported transport format; its records are saved through the same Markdown boundary.

Companion JSON retains IDs, timestamps, placeholder bindings and values, historical protocol snapshots, typed tables/formulas, bench calculation inputs/outputs, samples, links and attachments. Its prose is a recovery checkpoint, not the reading source after migration. Editing a rendered table, snapshot, or assay/gel section in Markdown does not change interactive structured state; edit those through Hikari. Editable prose uses invisible `hikari-field` comments, and derived sections use `hikari-derived` comments. Preserve these comments when editing with a text editor. Extra sections outside the marked blocks are retained on save.

The readable sections include protocol purpose/materials/steps/troubleshooting, named parameters and entered values, the notebook's historical protocol snapshot, execution and workflow metadata, notes/results, all result tables, buffer and reaction calculation inputs and saved output tables (including metadata/footer rows), sample details, linked assay wells and measurements, serial dilution and analysis, gel parameters/reports, and file/image attachments. Table cells preserve saved values and formulas, rather than recalculating scientific results during storage writes. Additional scientific details and provenance render as text, sections and tables without truncation. Markdown omits source JSON dumps, internal identifiers, and storage metadata.

Links use paths relative to the Markdown file. Attached images remain in their original location; embedded image data URLs are extracted to content-addressed files in `.hikari-markdown/` beside the Markdown and displayed as images. The original data URLs remain in the companion JSON. Gel plugin paths resolve under `Plugins/gel/`, and its report and parameter JSON artifacts supplement the compact plugin record. Missing linked records or unreadable linked JSON are identified in the Markdown.

Migrated Markdown has both the ownership marker `hikari-generated:record-markdown:v1` and a `hikari-document:protocol:v1` or `hikari-document:notebook:v1` marker. Legacy JSON-only records continue to load and migrate on the next sidecar refresh/save. Existing JSON records receive a one-time `protocol.pre-markdown.json` / `page.pre-markdown.json` backup. New records immediately get Markdown and companion JSON. Saves remain in the storage-root write queue, and Markdown is replaced atomically before its JSON checkpoint advances.

A save leaves a record's files untouched when neither its Markdown nor its companion would change, so open editors do not see a change on every autosave. Before replacing Markdown, the writer stages the matching complete record in `protocol.json.pending` or `page.json.pending`. An invisible checkpoint marker identifies that staged record. If a write stops between Markdown and JSON replacement, readers recover the matching staged record, including the new step order, parameter IDs and typed data. Successful saves remove the pending file. Readers verify that companion and pending contents stayed stable across the Markdown read. Keep a pending file when recovering an interrupted save; an ordinary successful save completes it. Recovery preserves a coherent individual record, while a filesystem failure can still interrupt a multi-record workspace save.

Renderer autosaves, startup refresh, Agent Chat sync and Codex setup sync carry field revisions. External prose changes merge when the app has not changed the same field. A record whose document cannot be saved (the same field changed in Hikari and in the file, damaged section markers, or a write error) is skipped and reported in `sidecarPaths.skippedRecords`: its files stay untouched, the rest of the workspace still saves, and the renderer keeps that record's baseline and warns until the problem is resolved. Deleting the file keeps Hikari's version; restarting Hikari loads the file's version. Repeated stale saves cannot erase external changes. Missing migrated Markdown loads its JSON checkpoint with a warning and is rewritten from Hikari's copy on the next save. A missing or unreadable companion is rebuilt from Hikari's copy, the document's prose still merges, and an unreadable companion is kept as `*.unreadable.json`. An unrelated pre-existing Markdown file is preserved and that legacy record stays JSON-backed with `sidecarPaths.markdownWarnings`. Protocol renames retain the existing folder and links; deletion removes only owned documents/assets, preserving user files and migration backups. Notebook documents follow existing notebook retention behavior.

Duplicate IDs and colliding destinations in a save are rejected before it writes anything. A protocol folder copied in Finder or Explorer repeats its protocol's ID: the folder Hikari named for that protocol keeps loading, and the copy is left untouched, never pruned, and reported when the workspace opens. Give the copy a new `id` in its `protocol.json` to keep it as a separate protocol. An explicit JSON export is written after bundle sync and includes the effective merged prose. Protocol editor and service updates retain other producers' scientific metadata; agent saves return and emit the merged saved record with its current revision. LF and CRLF documents are supported, and queued renderer saves retain any baseline still needed by pending edits.

The producer/consumer audit is:

| Path | Storage boundary |
| --- | --- |
| Protocol editor/service, JSON import, paper/agent generation, cloning builders, `agent-protocol-save.js` | `storage-sidecars.js` → `writeRecordDocumentSafely` |
| Notebook editor, approved drafts/appends, sample capture, cloning pages | `storage-sidecars.js` → `writeRecordDocumentSafely` |
| Workflow step notebooks | `workflow/sync-root.js` → the same document writer |
| Protocol load and root import | `hydration/protocol-directory.js` → shared document reader |
| Project/workflow notebook load and root import | `hydration/project-folders.js`, `workflow/read-root.js` → shared document reader |
| Agent matching/lookup, renderer search, viewers and PDF exports | Hydrated records; live unsaved notebook drafts retain precedence in agent requests |
| Project-memory citations and delayed conclusion validation | `project-memory/notebook-sources.js`, `project-inputs.js` → `page.md` plus the shared reader; legacy pages still cite their JSON |

To migrate saved records immediately, close Hikari and run:

```sh
node scripts/maintenance/migrate-record-markdown.js /path/to/workspace
```

This validates every source and output before writing, backs up legacy per-page JSON, and also materializes documents from snapshot-only or legacy aggregate roots. It preserves original snapshots and leaves SQLite and unrelated files alone. It is safe to repeat and preserves authored prose and extra sections.

Snapshot-only workflow migrations also create missing template/run metadata so ordinary folder hydration discovers the new pages. Existing template/run metadata is retained.

To regenerate Markdown for saved records immediately, close the app and run:

```sh
node scripts/maintenance/rebuild-record-markdown.js /path/to/workspace
```

The regeneration command reads saved records and linked context, refreshes derived sections while preserving authored prose/annotations, and writes only Markdown and extracted images. It can explicitly restore missing Markdown from the JSON checkpoint; that restoration uses the last checkpoint text. It does not rewrite JSON or migrate SQLite indexes.

Pressure-test coverage and recovery limits are recorded in [record-markdown-pressure-test.md](record-markdown-pressure-test.md).

The chemicals index is the only copy of the lab chemical inventory, so an unreadable one is never overwritten (`chemical-index-guard.js`). Loading moves it aside to `hikari-chemicals.index.sqlite.corrupt-<time>` and the next save starts a new file; if it cannot be moved, chemical writes are refused until a later load reads it again, while the rest of each save still goes through. Either way the storage import returns an `alerts` entry, which the renderer shows as an error notice.

### Paper knowledge storage

`KnowledgeBase/knowledge.index.sqlite` contains only paper identity and location links:

- `papers`: `id`, `doi`, `pmid`, `pmcid`, `title`, `pdf_sha256`, `wiki_path`. Title remains for identity lookup when external identifiers are missing.
- `paper_locations`: `id`, `paper_id`, `scope`, `container`, `pdf_path`. A paper can appear in multiple projects or collections.

Paper text is read directly from Markdown under `KnowledgeBase/papers.md/`. Descriptive metadata, processing status, timestamps, and location details live in each paper's `meta.json`. Search creates overlapping text windows in memory; there is no persisted `paper_chunks` table or SQLite text fallback. Missing Markdown is reported in search's `source_errors`. The redundant global `index.json` mirror is no longer written or read; older copies can remain on disk.

New databases use the compact schema immediately. A legacy database is compacted on its next write, after missing JSON metadata has been preserved. The original database is retained once as `knowledge.index.sqlite.pre-compact.bak`, and `VACUUM` reclaims the live index's discarded pages. Reads do not migrate files. Malformed metadata stops migration without replacing the database or the invalid JSON.

To compact an existing index immediately, with the app closed, run:

```sh
node scripts/maintenance/compact-paper-knowledge-index.js /path/to/KnowledgeBase/knowledge.index.sqlite
```

The recovery backup retains the original disk space until removed after verification.

Paper intake also maintains `KnowledgeBase/experiments.sqlite`:

- `experiments` stores one row per extracted experiment: `paper_id`, `ordinal`, `id`, `title`, `technique`, `variables`, `figure_ref`, `outcome`, and verbatim `evidence`. The key is `(paper_id, ordinal)` so paper-local or duplicate legacy experiment IDs cannot overwrite another experiment.
- `papers` stores the intake paper ID (the folder under `papers.md`, not the separate knowledge-index identity), title, DOI, document type, summary, saved project IDs as JSON, source paths, and intake timestamps. Join on `paper_id` to trace an experiment to its paper, Markdown, figures, PDF, and `intake.json`.

Each successful intake save replaces that paper's experiment rows; removed experiments and saved non-research classifications clear previous rows. Writes are serialized within the process and use atomic file replacement. The first save with a missing database backfills all saved intake records. `intake.json` remains the recoverable source, and current intake search continues to read it without writing SQLite. A SQLite failure is reported even when the JSON save succeeded.

To backfill immediately, recover the derived database, or reconcile externally edited/deleted intake files, close the app and run:

```sh
node scripts/maintenance/rebuild-paper-experiments.js /path/to/workspace
```

Rebuilding uses saved intake records without calling an LLM or changing the JSON files. Unreadable or malformed intake records stop the rebuild before replacing the existing database.

Agents consume this database through the `paper_experiments_sql` MCP tool. It accepts `sql`, optional positional `parameters`, and `limit` (50 by default, at most 200). One read-only `SELECT` or `WITH ... SELECT` can join `experiments` with `papers` on `paper_id`, filter, group, or count. The response contains `columns`, matching row-value arrays in `rows`, `row_count`, and explicit truncation. Schema inspection uses `SELECT * FROM pragma_table_info('experiments')`. Queries cover the current workspace library; project-specific callers must constrain paper IDs using project-summary retrieval.

The tool opens a disposable in-memory snapshot and never persists changes or accepts a database path. SQL is parsed as a single statement and required to work as a SELECT subquery, with SQLite `query_only` enabled. Each query runs in a worker with a three-second deadline, a 64 MiB SQLite heap limit, a 48 KB result budget, and at most two active queries per process. Missing or corrupt databases return an error; reads do not trigger rebuilding. The tool can be disabled independently in Settings.

## Write path

`syncBundleFromSnapshot(...)` writes, in order:

1. the root folders (`Papers/`, `Plates/`, `Gels/`, `KnowledgeBase/papers.md/`, `Samples/`) and the official Codex skills at the root
2. protocol folders (pruning folders for removed protocols)
3. notebook-page folders (entries that belong to a workflow are written by the workflow sync instead)
4. per-project `MEMORY.md`, skills, and `DNA/` folders
5. one file per personal-inventory container
6. the Home experiment log
7. one record file per assay and gel folder, and one beside each stored paper PDF
8. the chemicals SQLite index (skipped, not failed, when the guard has refused it)
9. the workflow root (`Workflow/` templates, runs, run notebook pages, and related papers)

It also deletes a leftover `<snapshot>.notebook-pages.json` from older builds.

`syncSqliteBundleFromSnapshot(...)` (the `storage:sync-sqlite-bundle` channel) rewrites only the chemicals index, so Chemicals edits can persist without a full save.

## Read path

`hydrateSnapshotFromBundle(...)` rehydrates the compact snapshot by layering in:

1. `Protocol/*/protocol.md` plus its JSON companion (or a legacy `<snapshot>.protocols.json`)
2. a legacy `<snapshot>.notebook-pages.json`, if present
3. personal-inventory container files
4. the Home experiment log
5. `Project/` notebook-page Markdown/companions and project records
6. the `Workflow/` root: templates, runs, their notebook-page Markdown/companions, and related papers
7. the chemicals SQLite index (through `chemical-index-guard.js`)
8. paper records beside their PDFs, and assay and gel record folders

It also returns a `migration` summary that reports which fallback or hydration sources were used.

That means a load can succeed even when the primary JSON is intentionally missing heavy fields, because those fields are reconstructed from the folders. Records found in more than one place are merged by id.

## Import path

`importStorageRoot(...)` is a separate workflow for existing storage directories.

It:

- scans a storage root for bundle candidate files
- decides whether the folder is one Hikari has used before by looking at the folder itself — any of `Protocol/`, `Project/`, `Samples/`, `Workflow/`, `DNA/`, `KnowledgeBase/`, or a snapshot `.json` — and reports that as `recognized`
- hydrates each discovered bundle
- merges protocols, notebook entries, chemicals, and inventory across bundles
- summarizes the `DNA` SQLite library

There is no marker or manifest file: the layout Hikari writes is the layout it reads. A `hikari-storage-manifest.json` left behind by builds before September 2026 is skipped during discovery and otherwise ignored.

Imports are serialised: boot hydration and "Save Storage Path" cannot interleave their writes.

This is best thought of as a discovery and migration helper, not part of the routine save/load loop.

## Why this split exists

The persistence model here is trading simplicity for scalability:

- the main JSON remains light enough to save and load comfortably
- one file per record keeps large structured collections out of the primary snapshot, sits next to the record's own artifacts, and stays readable (and recoverable) without Hikari
- the chemicals SQLite index makes inventory search fast

That is why several seemingly unrelated helpers share the `storage/index.js` public surface. The `storage/` package is the center of gravity for the app's durable data layout.
