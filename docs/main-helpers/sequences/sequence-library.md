# Sequence Library

The `sequence-library/` folder (≈22 modules behind `index.js`) and the `sequence/` folder form a self-contained sequence-storage subsystem inside `src/main/helpers/main`. The public API is `sequence-library/index.js`; storage, search, annotation, alignment, and recognition each have their own modules (`database.js`, `entry-read.js`/`entry-upsert.js`, `feature-store.js`/`feature-search.js`, `annotation-service.js`, `alignment-store.js`, `backbone-service.js`, ...).

## Storage layout

The sequence library lives under the chosen storage root in a dedicated folder:

- `SequenceViewer/sequence-library.sqlite`
- `SequenceViewer/entries/<entry-id>/...`

Each entry stores:

- a GBK file
- an HTML preview
- optional alignment-session data under an `alignments/` subfolder

The SQLite database stores metadata, features, and feature occurrences for search and inference.

## Entry lifecycle

`sequence-library/index.js` exposes the CRUD-style API:

- `listSequenceEntries(...)`
- `getSequenceEntry(...)`
- `upsertSequenceEntry(...)`
- `promoteSequenceEntry(...)`
- `deleteSequenceEntry(...)`

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

`recognizeSequenceBackbone(...)` is orchestrated by `sequence-library/backbone-service.js`. The process-neutral matcher lives in `src/renderer/modules/sequence-viewer/algorithms/sequence-backbone-recognition/`, alongside its circular-annotation, ORF, and restriction-feature dependencies.

At a high level it:

- parses sequence content from stored GBK files
- compares both forward and reverse-complement orientations
- considers circular rotations instead of assuming fixed starts
- evaluates candidate insertion windows
- incorporates restriction-site and promoter/ORF heuristics
- ranks acceptable candidates and returns the best match

This is why the file is so much larger than the rest of the folder: it is an algorithm module, not just storage plumbing.

## Why it is separate from the main snapshot

The sequence library is not stored directly in the normal app snapshot because it has different needs:

- its artifacts are file-heavy
- it benefits from a dedicated searchable SQLite schema
- it has domain-specific inference logic layered on top

That separation makes the library feel closer to a mini-subsystem than to a normal slice of the general application state.
