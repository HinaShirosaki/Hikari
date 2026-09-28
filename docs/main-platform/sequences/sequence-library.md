# Sequence Library

`src/renderer/modules/sequence-viewer/main-process/sequence-library/` is a self-contained Node-only storage subsystem inside the existing Sequence Viewer feature (the **DNA** dock entry), with focused modules behind `index.js`. Storage, folders, search, annotation, alignment, and recognition each have their own modules (`database.js`, `entry-read.js`/`entry-upsert.js`/`entry-reconcile.js`, `folder-store.js`, `feature-store.js`/`feature-search.js`, `annotation-service.js`, `alignment-store.js`, `backbone-service.js`, `recognized-store.js`, ...).

## Storage layout

The sequence library lives under the chosen storage root in a dedicated folder:

- `SequenceViewer/sequence-library.sqlite`
- `SequenceViewer/entries/<entry-id>/...`
- `SequenceViewer/<folder>/` — one directory per library folder the user creates in the rail (renamed along with the folder; removed only once empty)
- `SequenceViewer/protein-builder-backbones.json` and `SequenceViewer/protein-builder/backbones/` — recognized backbones saved from Protein Builder
- `Project/<project>/Sequence/` — each project's sequence folder, beside its `Notebook/` folder; the library rail mirrors these as project folders

Each entry stores:

- a GBK file
- an HTML preview
- optional alignment-session data under an `alignments/` subfolder (`alignment-sessions.json` manifest)

The SQLite database stores metadata, folder membership, features, and feature occurrences for search and inference. Folder names that would collide with the library's own files (`entries`, the database, the backbone store) are reserved.

## Concurrency

sql.js loads the whole database image into memory, so two writers would silently drop each other's changes. `operation-lock.js` serialises every read that reconciles records and every write, including those from Hikari MCP server processes running outside the Electron process (the agent's sequence tools).

## Entry lifecycle

`src/renderer/modules/sequence-viewer/main-process/sequence-library/index.js` exposes the CRUD-style API:

- `listSequenceEntries(...)`
- `getSequenceEntry(...)`
- `upsertSequenceEntry(...)`
- `promoteSequenceEntry(...)`
- `deleteSequenceEntry(...)`
- `upsertSequenceFolder(...)`, `deleteSequenceFolder(...)`, `moveSequenceEntryToFolder(...)`

Deleting a folder unfiles its sequences rather than deleting them.

Entries have two main statuses:

- `temporary`
- `saved`

`promoteSequenceEntry(...)` is the bridge between them: it reloads an existing temporary entry and writes it back as a saved one.

## What `upsertSequenceEntry(...)` really does

This function (in `entry-upsert.js`) is the heart of the library.

It:

1. validates that GBK and HTML content exist
2. ensures the `SequenceViewer` directories exist
3. loads or creates the SQLite database
4. resolves the entry id and final display name
5. writes the GBK and HTML files into the entry folder
6. upserts the metadata row into SQLite
7. replaces feature occurrences for that entry
8. reads or writes alignment-session metadata
9. persists the SQLite database back to disk

So this function is both file storage and database storage at once.

## Search surface

The sequence library exposes two query styles.

## Entry search

`listSequenceEntries(...)` lists the stored entries, optionally filtered by `saved` or `temporary`.

## Feature search

`searchSequenceFeatures(...)` searches by either:

- normalized feature name
- normalized sequence text

It returns features plus their host-vector occurrences, which makes it a richer search than “find matching entry names.”

## Backbone recognition

`recognizeSequenceBackbone(...)` is orchestrated by `src/renderer/modules/sequence-viewer/main-process/sequence-library/backbone-service.js`. The process-neutral matcher lives in the sibling `algorithms/sequence-backbone-recognition/` folder, alongside its circular-annotation, ORF, and restriction-feature dependencies.

At a high level it:

- parses sequence content from stored GBK files
- compares both forward and reverse-complement orientations
- considers circular rotations instead of assuming fixed starts
- evaluates candidate insertion windows
- incorporates restriction-site and promoter/ORF heuristics
- ranks acceptable candidates and returns the best match

This is why the file is so much larger than the rest of the folder: it is an algorithm module, not just storage plumbing.

## Agent access

The agent's plasmid and primer tools (`sequence_*` in the MCP contract) are implemented beside the library in `main-process/mcp/` (`service.js`, `tools.js`, `schemas.js`, `store.js`, `artifact-events.js`). They reuse the browser-safe editing, builder, and primer modules from `sequence-viewer/mcp/`, take the same operation lock, and check an entry revision before each edit so a stale read cannot overwrite a newer save. See [agent/mcp-contract/sequence-tools.md](../../agent/mcp-contract/sequence-tools.md).

## Why it is separate from the main snapshot

The sequence library is not stored directly in the normal app snapshot because it has different needs:

- its artifacts are file-heavy
- it benefits from a dedicated searchable SQLite schema
- it has domain-specific inference logic layered on top

That separation makes the library feel closer to a mini-subsystem than to a normal slice of the general application state.
