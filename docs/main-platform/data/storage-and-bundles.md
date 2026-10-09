# Storage And Bundles

The data-persistence story in the `src/main/` platform layer (`storage/`, `data/`, `lib/`) is built around a compact primary snapshot plus one self-contained Markdown file per protocol/notebook record and JSON files for other module records under the storage root, with SQLite for the chemical inventory and module-owned paper and sequence indexes.

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

Every save updates these from the snapshot. Protocol and notebook Markdown stores both readable content and hidden typed YAML state. Other modules retain their existing JSON or SQLite storage:

| Data | Stored as |
| --- | --- |
| Protocols | Self-contained `Protocol/<name>__<id>/protocol.md` |
| Notebook pages | Self-contained `page.md` in page folders under `Project/` and `Workflow/` |
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

`storage/record-markdown/` saves self-contained `protocol.md` and `page.md`, including workflow notebook pages. No active protocol/notebook JSON companions are written or required. Folder hydration, storage-root import, renderer views, search, agent lookup/matching, cloning workflows and PDF exports consume the records from these documents. JSON input to agent tools and the protocol importer, and explicit JSON snapshot exports, remain supported transport formats. Assays and gels retain their own JSON storage.

An invisible `hikari-record:v2` HTML comment holds typed YAML metadata: IDs, timestamps, placeholder bindings and values, historical protocol snapshots, tables/formulas, bench calculation inputs/outputs, samples, links, attachments and the prose baseline used for conflict detection. This keeps the document lossless without showing source-JSON dumps. Images use `!hikari/image` references to extracted binary files rather than base64 blobs. Editable prose uses `hikari-field` comments; generated context uses `hikari-derived` comments. Preserve these comments and the YAML metadata when editing. Rendered tables, snapshots and assay/gel sections remain presentations of structured state; edit them through Hikari's controls. A notebook ends with its notes, and text appended at EOF is read into the notes before the next save, including pages made by the older layout.

The readable sections include protocol purpose/materials/steps/troubleshooting, named parameters and entered values, the notebook's historical protocol snapshot, execution and workflow metadata, notes/results, all result tables, buffer and reaction calculation inputs and saved output tables (including metadata/footer rows), sample details, linked assay wells and measurements, serial dilution and analysis, gel parameters/reports, and file/image attachments. Table cells preserve saved values and formulas, rather than recalculating scientific results during storage writes. Additional scientific details and provenance render as text, sections and tables without truncation. Markdown omits source JSON dumps, internal identifiers, and storage metadata.

Links use paths relative to the Markdown file. Attached images remain in their original location; embedded image data URLs are extracted to content-addressed files in `.hikari-markdown/` beside the Markdown and displayed as images. Loading reconstructs image data from those files and checks the content hashes and document-folder confinement. A missing or changed image file does not stop its record from loading: the record loads without that image and keeps its `!hikari/image` reference across saves, so restoring the file brings the image back. Gel plugin paths resolve under `Plugins/gel/`, and its report and parameter JSON artifacts supplement the compact plugin record. Missing linked records or unreadable linked JSON are identified in the Markdown.

Markdown has the ownership marker `hikari-generated:record-markdown:v1`, a `hikari-document:protocol:v1` or `hikari-document:notebook:v1` marker, and its embedded `hikari-record:v2` state. Legacy JSON-only records and older paired Markdown/JSON records continue to load and migrate automatically on workspace startup or the next save. Existing per-record JSON receives a one-time `*.pre-markdown.json` backup and is removed only after the self-contained Markdown is durable. A companion whose record differs from that backup is also kept as `*.pre-v2.json`; when both backups differ from it, the JSON stays in place. New records immediately get Markdown alone. Retired aggregate sidecars and the old default autosave snapshot are also backed up; backup files are excluded from active bundle discovery. Migration failures retain legacy input for retry.

A single atomic Markdown replacement commits both text and structured state, so a reader sees a coherent old or new record. Unchanged documents retain their content and modification times while extracted images are checked. Images are written before the document; obsolete generated images are pruned afterwards. A failure in image-manifest cleanup after the document committed is acknowledged as a saved record. Older `*.json.pending` transactions remain supported during migration and are retired after the new document commits. Complete workspace saves remain serialized by the storage-root queue; a filesystem failure can still interrupt a multi-record save.

A record that does not load, such as one with damaged YAML metadata, stays out of the workspace and is left unchanged on disk; later saves neither rewrite nor delete it. The storage import returns an `alerts` entry for it and for each problem found while loading a record (an unavailable image, damaged section markers, a recovered save). The renderer shows all alerts together in one error notice.

Renderer autosaves, startup refresh, Agent Chat sync and Codex setup sync carry field revisions. External prose changes merge when the app has not changed the same field, and the effective saved prose and revision are acknowledged back into still-matching live state. A conflicting, damaged or unwritable record is skipped and reported in `sidecarPaths.skippedRecords`; other records continue saving and that record retains its baseline. Unrelated user-owned Markdown is never overwritten or bypassed by writing a new JSON companion. Deleting a damaged document while Hikari still holds the record lets its next save rewrite it; restarting loads the saved document. Protocol renames retain folders and links, including upgrades of older documents whose JSON companion disappeared while Hikari was open. Deletion removes only owned documents/assets and preserves user files and migration backups. Notebook documents follow existing retention behavior.

Duplicate IDs and colliding destinations in a save are rejected before it writes anything. Copied protocol folders use a shared ownership rule on load/save, are reported when opened, and remain untouched. Give a copy a new `id` in its YAML record metadata to keep it as a separate protocol. An explicit JSON export includes the effective merged prose. Protocol editor and service updates retain scientific metadata; agent saves return and emit the merged saved record with its current revision. LF, CRLF, front matter and editor-added blank lines are supported. Unsupported or damaged metadata and YAML aliases are rejected without replacing the document.

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

The command also accepts an old snapshot/sidecar JSON file or an individual `{protocol: ...}` / `{notebookEntry: ...}` record:

```sh
npm run migrate:markdown -- /path/to/old-snapshot.json --dry-run
npm run migrate:markdown -- /path/to/old-snapshot.json
```

`--dry-run` validates and reports planned counts without writing files. Add `--json` to return a machine-readable report with all output paths. Standalone JSON files create the current layout in their parent directory; files already under `Protocol/`, `Project/` or `Workflow/` resolve against that workspace and preserve existing record locations. File input migrates its own records and reads sibling snapshots/artifacts for linked context. Legacy `notebookPages` and wrapped records are supported; invalid collections, missing or duplicate IDs, and colliding destinations stop conversion before writes.

This validates every source and output before writing, backs up legacy per-page JSON, and also materializes documents from snapshot-only or legacy aggregate roots. It preserves original snapshots and leaves SQLite and unrelated files alone. It is safe to repeat and preserves authored prose and extra sections.

Snapshot-only workflow migrations also create missing template/run metadata so ordinary folder hydration discovers the new pages. Existing template/run metadata is retained.

To regenerate Markdown for saved records immediately, close the app and run:

```sh
node scripts/maintenance/rebuild-record-markdown.js /path/to/workspace
```

The regeneration command reads saved records and linked context and refreshes derived sections while preserving authored prose/annotations. It writes self-contained Markdown and extracted images, and retires legacy record JSON after backing it up. If only a legacy JSON record remains, it can restore Markdown from that record's last saved text. It does not migrate SQLite indexes.

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

It also backs up and retires leftover `<snapshot>.protocols.json` and `<snapshot>.notebook-pages.json` from older builds after all corresponding records save successfully.

`syncSqliteBundleFromSnapshot(...)` (the `storage:sync-sqlite-bundle` channel) rewrites only the chemicals index, so Chemicals edits can persist without a full save.

## Read path

`hydrateSnapshotFromBundle(...)` rehydrates the compact snapshot by layering in:

1. self-contained `Protocol/*/protocol.md`, with fallback to legacy record JSON or `<snapshot>.protocols.json`
2. a legacy `<snapshot>.notebook-pages.json`, if present
3. personal-inventory container files
4. the Home experiment log
5. `Project/` notebook-page Markdown and project records, with legacy record JSON fallback
6. the `Workflow/` root: templates, runs, their notebook-page Markdown (or legacy JSON), and related papers
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
