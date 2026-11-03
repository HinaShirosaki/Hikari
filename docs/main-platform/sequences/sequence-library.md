# Sequence Library

`src/renderer/modules/sequence-viewer/main-process/sequence-library/` is a self-contained Node-only storage subsystem inside the existing Sequence Viewer feature (the **DNA** dock entry), with focused modules behind `index.js`. Storage, folders, search, annotation, alignment, and recognition each have their own modules (`database.js`, `entry-read.js`/`entry-upsert.js`/`entry-reconcile.js`, `folder-store.js`, `feature-store.js`/`feature-search.js`, `annotation-service.js`, `alignment-store.js`, `backbone-service.js`, `recognized-store.js`, ...).

## Storage layout

The sequence library lives under the chosen storage root in a dedicated folder:

- `DNA/sequence-library.sqlite`
- `DNA/entries/<entry-id>/...`
- `DNA/<folder>/` — one directory per library folder the user creates in the rail (renamed along with the folder; removed only once empty)
- `DNA/protein-builder-backbones.json` and `DNA/protein-builder/backbones/` — recognized backbones saved from Protein Builder
- `Project/<project>/DNA/` — each project's sequence folder, beside its `Notebook/` folder; the library rail mirrors these as project folders

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

## Derived DNA fragments

In the DNA detail view, select bases or right-click an annotated feature and choose **Save DNA Fragment…**. Feature saving also works in the Vector Builder's map and sequence pane. It uses the feature's full genomic span, including joined annotation gaps and circular-origin crossings, preserves its strand and annotations, and suggests a name from the template and feature. Primer cards and the selected-primer details also offer **PCR…**. Starting PCR highlights compatible partner primers directly on the DNA sequence and overview track; the starting primer is marked separately, and other primers are greyed out and cannot be selected as partners. A start from Vector Builder opens the DNA sequence for partner selection. Click a highlighted primer to confirm the selected pair before saving. The confirmation dialog can return to the sequence to choose another partner; Escape or Cancel exits picking.

Both workflows save a linear `.gbk` entry with remapped annotations. PCR products include the primer sequences and their 5′ additions; circular templates can produce products spanning the origin. Partner highlighting uses the annotated binding sites, strand direction, template span, matching 3′ ends, and consistent overlapping primer sequences. The chosen pair is validated again when generating the saved product.

The template is saved first if needed. The new entry records `parentEntryId` in SQLite, inherits the template's folder, and appears beneath it in both library rails. The template's disclosure button folds/unfolds its descendants; searching for a child reveals its ancestry. Moving a template to a folder carries its descendants. Moving a child independently detaches it from its parent. Deleting a template retains its children as root entries.

## Restriction digestion

Restriction sites offer **Single digestion…** and **Double digestion…** in their right-click menus, hover panels, and selected-site details. These actions also work on the Vector Builder map and sequence pane. Double digestion starts from the chosen site, then waits for a click on a different restriction site. A dialog displays compact enzyme selectors and the resulting fragment lengths and names before writing anything.

Optionally rename a fragment, then click its **Save** button to create a linear `.gbk` child under the template. That button becomes a checkmark; the dialog and template stay open, with unsaved fragments available to rename and save. Closing the dialog discards only the unsaved results. Enzyme choices lock after saving starts to preserve the current digest. One break produces one linearized product from circular DNA or two products from linear DNA; two breaks produce two or three products respectively. Enzymes with upstream and downstream cuts can produce additional fragments. Unknown patterns, cuts outside linear DNA, and overlapping strand cuts prevent saving.

Product lengths and the GenBank sequence refer to the plus strand. Terminal `misc_feature` annotations preserve blunt/sticky-end type, overhang sequence in 5′–3′ orientation, enzyme, and zero-based template strand-cut coordinates in `hikari_digest_*` qualifiers. Genes interrupted by a cut are retained as partial annotations rather than joined across a new linear end. Digest fragments use stable entry IDs, so retrying a failed save does not duplicate a fragment already written.

## DNA fragment assembly

Right-click a DNA library item in either rail, or right-click its sequence, and choose **Assemble DNA…**. This starts a banner and selects the initial fragment. Click DNA items in either rail to add or remove fragments in click order; these clicks select assembly inputs without navigating away. Choose the method in the banner, then click **Assemble** to save the result directly. **Options** exposes the name, topology, minimum overlap, and fragment order/orientation controls. Escape or the banner's close button cancels selection and clears the rail highlights.

**Sticky-end ligation** requires matching complementary overhangs of the same polarity at every junction. **Blunt-end T4 ligation** requires blunt joining ends; it does not silently fill or trim sticky ends. These ligation methods support linear and circular products, with circular products also checking the closing junction.

**Overlap PCR** joins fragments with exact existing suffix/prefix homology (default minimum 15 bp, adjustable from 12 to 1000 bp), counts the overlap once, and yields linear DNA. It reports incompatible junctions rather than inventing sequence or designing new primer tails. For the underlying methods, see [NEB's ligation guide](https://www.neb.com/en/tools-and-resources/usage-guidelines/tips-for-maximizing-ligation-efficiencies) and [OpenCloning's overlap-extension documentation](https://docs.opencloning.org/methods/overlap_extension/).

The assembled result is a separate saved `.gbk` entry with no parent, even when its inputs are template children. Input annotations are remapped to the product, source/orientation qualifiers retain provenance, and terminal chemistry is retained for linear ligation products. Reverse-complementing a sticky-ended fragment uses its physical bottom strand, including asymmetric recessed/protruding ends. Retries reuse the output entry ID to prevent duplicates after a lost save response.

## What `upsertSequenceEntry(...)` really does

This function (in `entry-upsert.js`) is the heart of the library.

It:

1. validates that GBK and HTML content exist
2. ensures the `DNA` directories exist
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
