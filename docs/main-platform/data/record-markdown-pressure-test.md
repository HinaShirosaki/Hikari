# Protocol and notebook Markdown pressure test

Verified against the working source on October 3, 2026. Destructive and failure-injection checks used disposable workspaces. The existing TestData3 workspace was inspected read-only.

## Production and consumption coverage

| Boundary | Evidence |
| --- | --- |
| Protocol editor creation and editing | Actual Electron form submission, WebCrypto revisions, IPC and disk saves; scientific provenance/aliases survive updates |
| Notebook editor creation and editing | Actual Electron experiment creation, frozen protocol snapshot, notes editing, save and reload |
| Agent protocol save | Actual storage integration, with an external edit between hydration and save; returned/emitted record agrees with disk |
| JSON import and legacy migration | Existing producer contracts plus normal folder import; per-record backups, snapshot-only records, workflow discovery and repeated migration |
| Workflow pages | Same document writer, normal hydration, stale saves, and recovery of a first interrupted checkpoint |
| Overlapping edits and retries | Disjoint client edits merge; conflicting fields fail; 100 queued edits complete in order; failed acknowledgments and thrown IPC errors permit retry |
| Interrupted writes | Injected failures at pending-checkpoint, Markdown, image-manifest and companion replacement, for both new and existing records; retry and temporary-file cleanup |
| Readers overlapping writes | A save completes during a companion read; the reader retries and retains correct step IDs and bindings |
| Document damage | Missing editable/derived markers and unknown/duplicate step anchors recover JSON with warnings and refuse automatic replacement |
| Protocol parameters | Insertion/reordering retains anchors, metadata and bindings; repeated named parameters retain all token occurrences |
| Tables and bench calculations | Multiple and legacy result tables, saved formulas, Unicode/multiline cells, Buffer Preparer and reaction inputs/output tables with metadata/footer rows |
| Linked scientific context | Samples, assay layouts/results, dilution data, artifact JSON, chart images, plugin gel parameters/reports and unavailable records |
| Files and images | Relative attachment links, extracted inline images, moved workspaces, missing files, manual annotations, generated-asset pruning and external JSON boundary |
| Search and memory | Markdown prose reaches agent lookup and project-memory corpus/citations through the shared reader |
| Exports | Effective merged JSON snapshot plus two real PDFs generated in Electron using the existing protocol/notebook exporters |
| Existing app contracts | Core and edge suites cover protocol generation/import, notebook drafts/appends, cloning/sample producers, workflow consumers and linked records |

## Repairs

The audit repaired thirteen defects:

1. CRLF ownership markers blocked saving externally edited documents.
2. The revision-history limit rejected edits after a large queued typing burst.
3. Editing a step replaced only the first occurrence of a repeated parameter.
4. A failed JSON checkpoint paired new Markdown step positions with old parameter metadata.
5. A later notebook conflict allowed earlier protocol and exported-snapshot writes. (Superseded on October 4, 2026: a conflicting or damaged document now skips only its own record while the rest of the workspace saves; see storage-and-bundles.md.)
6. Damaged derived-section markers were accepted during reads.
7. Snapshot-only workflow migration omitted metadata required to discover its pages.
8. Notebook folder scans skipped a first-save recovery checkpoint before `page.json` existed.
9. A reader overlapping a completed write could pair old JSON with new Markdown.
10. Agent protocol save returned/emitted the pre-merge record.
11. An unknown step anchor silently dropped existing step and parameter identities.
12. Duplicate protocol IDs created ambiguous documents in different folders.
13. Protocol editor updates dropped fields owned by other producers, including scientific provenance.

Explicit JSON exports now contain the merged record; successful record writes return fresh revisions. Test fixtures also provide real WebCrypto/TextEncoder globals and wait for asynchronous agent synchronization.

## Results

- Markdown storage/regression checks: **42/42**.
- Complete test runner: **1293/1293 test entries**, including the Markdown selfcheck and static checks.
- Core suite: **610/610**.
- Edge suite: **581/581**.
- Electron integration: creation, editing, save/reload, external Markdown edits, root import, agent lookup and two real PDF exports passed.
- UI build, DOM IDs, source layout, focused lint and whitespace checks passed.
- TestData3: **68 protocols + 212 notebook pages** load from Markdown without warnings. All **280 records** match their pre-migration backups after removing ephemeral revision metadata. All **22 local links**, including **6 image embeds**, resolve. No source-JSON dumps or image data URLs occur in these documents. The audit did not rewrite those records.

## Reproduction and limits

```sh
node --test tests/record-markdown-selfcheck.js
node tests/record-markdown-electron.cjs
node test.js
npm run build:ui
npm run check:dom-ids
npm run check:source-layout
```

The Electron check uses a temporary profile/storage root and removes it afterward. Electron startup and local test servers need execution permissions unavailable in the restricted sandbox; the permitted runs passed.

Markdown owns protocol prose and notebook notes. Tables, calculations, historical snapshots, assays and gels are readable derived context; edit their structured state through Hikari. Failure injection demonstrates process/write-error recovery, not hardware power-loss guarantees. A multi-record save can stop partway through a filesystem failure; record checkpoints stay coherent and document conflicts are checked before writes. Storage-root queues serialize writers within the main process; run standalone maintenance commands with Hikari closed, as documented. The packaged app was not rebuilt or release-tested.
