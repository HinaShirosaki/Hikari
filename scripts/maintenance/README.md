# Maintenance scripts

These operator-run utilities update existing Hikari data or derived artifacts. They are not invoked by the application or build.

- `regenerate-plasmid-html.mjs` rebuilds existing Sequence Library HTML previews for a selected storage root.
- `compact-paper-knowledge-index.js <KnowledgeBase/knowledge.index.sqlite>` compacts a legacy paper knowledge index in place, keeping a one-time `knowledge.index.sqlite.pre-compact.bak`.
- `rebuild-paper-experiments.js <workspace>` rebuilds `KnowledgeBase/experiments.sqlite` from the saved `intake.json` records, without calling an LLM or changing the JSON files.
- `migrate-record-markdown.js <workspace-directory|legacy.json>` converts older protocol/notebook JSON to current `protocol.md` and `page.md` documents. It supports full snapshots, legacy `protocols`/`notebookPages` aggregates and individual wrapped records. `--dry-run` validates and previews without writes; `--json` prints counts and output paths for automation.
- `rebuild-record-markdown.js <workspace>` refreshes derived Markdown sections and extracted images for saved records, preserving authored prose and annotations.

Close Hikari before running a migration or regeneration. The converter preserves original snapshots and creates one-time `*.pre-markdown.json` backups for existing record companions. Readable Markdown includes saved tables, bench calculations, linked assay/gel/sample context, and file/image links, without source-JSON dumps. Protocol/notebook structured state lives in hidden YAML metadata inside the Markdown; active per-record JSON is retired after conversion succeeds. Assays and gels keep their JSON storage.

```sh
npm run migrate:markdown -- /path/to/workspace --dry-run
npm run migrate:markdown -- /path/to/workspace
npm run migrate:markdown -- /path/to/old-snapshot.json --json
```

A standalone JSON file creates the current document layout in its parent directory. A record within `Protocol/`, `Project/` or `Workflow/` uses that workspace's root and existing location. File input migrates only records represented by that JSON, while loading sibling saved data for linked context. Repeated runs retain migrated prose, annotations and existing backups. Invalid input or colliding destinations stop migration before document writes; a filesystem failure during migration can leave completed records in place and can be retried.

The paper scripts and Markdown conversion are described in [docs/main-platform/data/storage-and-bundles.md](../../docs/main-platform/data/storage-and-bundles.md).
