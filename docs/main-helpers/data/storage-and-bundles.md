# Storage And Bundles

The data-persistence story in `src/main/helpers/main` is built around a compact primary snapshot plus heavier sidecars.

## The compact snapshot

`data-snapshot-utils.js` exports `buildCompactIndexedSnapshot(snapshot)`.

Its job is to strip the heavy searchable data out of the main JSON file before it is written. In practice it:

- clears `protocols`
- clears `notebookEntries`
- clears `samples`
- clears the derived `objectGraph`
- clears `labInventory.chemicals`
- clears `inventory`
- keeps lightweight bundle metadata under `data_bundle`

This is the snapshot shape written by `main.js`.

## The high-level facade: `data-helpers.js`

`createMainDataHelpers(...)` is the small facade used by `register-data-ipc.js`.

It exposes four operations:

- `saveSelectedDataFile`
- `loadSelectedDataFile`
- `autoSaveDataFile`
- `autoLoadDataFile`

Internally those all funnel into:

- `persistSnapshot(...)`
- `loadSnapshot(...)`

The key detail is that persistence is not “write one JSON file and stop.” A save also syncs the bundle sidecars and SQLite index through `syncBundleFromSnapshot(...)`.

## `storage-bundle.js` is the real persistence engine

This file defines the on-disk bundle layout.

Given a base data file, it derives:

- the primary data file
- `*.protocols.json`
- `*.index.sqlite`
- `Samples/samples.json`

`getBundlePaths(...)` is the shared path builder used throughout the rest of the file.

For the standalone Chemicals workspace, the app now also supports a SQLite-only bundle at `hikari-chemicals.index.sqlite` without requiring a sibling `hikari-chemicals.ena.json`. Legacy `enana-chemicals.index.sqlite` bundles are still recognized on import.

## Write path

`syncBundleFromSnapshot(...)` writes:

1. protocol folders
2. notebook-page folders
3. `Samples/samples.json`
4. a SQLite index built from the snapshot

That SQLite file includes searchable tables for:

- inventory chemicals
- personal inventory
- inventory samples
- protocol index
- notebook index
- record index

So the bundle sync step is not just archival. It also builds fast lookup state used elsewhere in the app.

## Read path

`hydrateSnapshotFromBundle(...)` rehydrates the compact snapshot by layering in:

1. protocol sidecar JSON
2. legacy notebook-page sidecar JSON, if present
3. `Samples/samples.json`
4. SQLite inventory/record data

It also returns a `migration` summary that reports which fallback or hydration sources were used.

That means a load can succeed even when the primary JSON is intentionally missing heavy fields, because those fields are reconstructed from the bundle.

## Import path

`importStorageRoot(...)` is a separate workflow for existing storage directories.

It:

- scans a storage root for bundle candidate files
- also recognizes standalone `*.index.sqlite` bundle indexes when no base data file exists
- hydrates each discovered bundle
- merges protocols, notebook entries, chemicals, and inventory across bundles
- summarizes the `SequenceViewer` SQLite library
- writes a `hikari-storage-manifest.json` manifest into the storage root

This is best thought of as a discovery and migration helper, not part of the routine save/load loop.

## Why this split exists

The persistence model here is trading simplicity for scalability:

- the main JSON remains light enough to save and load comfortably
- the sidecars keep large structured collections out of the primary snapshot
- the SQLite index makes lookup-oriented features fast

That is why several seemingly unrelated helpers in this folder all point back to `storage-bundle.js`. It is the center of gravity for the app's durable data layout.
