# Maintenance scripts

These operator-run utilities update existing Hikari data or derived artifacts. They are not invoked by the application or build.

- `regenerate-plasmid-html.mjs` rebuilds existing Sequence Library HTML previews for a selected storage root.
- `compact-paper-knowledge-index.js <KnowledgeBase/knowledge.index.sqlite>` compacts a legacy paper knowledge index in place, keeping a one-time `knowledge.index.sqlite.pre-compact.bak`.
- `rebuild-paper-experiments.js <workspace>` rebuilds `KnowledgeBase/experiments.sqlite` from the saved `intake.json` records, without calling an LLM or changing the JSON files.

Close Hikari before running any of them. The paper scripts are described in [docs/main-platform/data/storage-and-bundles.md](../../docs/main-platform/data/storage-and-bundles.md#paper-knowledge-storage).
