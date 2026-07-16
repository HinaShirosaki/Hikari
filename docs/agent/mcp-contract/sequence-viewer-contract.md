# Sequence Viewer MCP Contract (design)

> Status: **compute core implemented + verified; cross-process wiring pending.**
> - Done & tested: the pure contract logic in
>   `src/renderer/modules/sequence-viewer/agent/agent-api.js` (reads, `analyze`,
>   compute-only `design_cloning`, non-mutating `propose_*` with target identity +
>   `verifyTarget`) and the strategy adapter
>   `src/renderer/modules/sequence-viewer/agent/cloning-adapter.js`
>   (`buildDisplayPlan` is now exported from `cloning-design.js`). Covered by tests
>   in `tests/suites/edge/bio-tools-and-gel-suite/cloning-assembly-suite.js`.
> - Pending (needs the running Electron app to verify): the main-process MCP tool
>   definitions + registration, the renderer executor IPC bridge that binds
>   `agent-api` to live state, and the `review-overlay.js` approval cards.

## Core principle: the agent proposes, it never mutates

The agent works entirely against **record IDs and coordinate deltas** — it never
sends back a whole sequence to overwrite, never touches the DOM, and never applies
an edit itself. Reads are windowed; writes return a preview plus a
**pending-approval** payload that the host renders as an approve/reject card (the
same pattern already used for `protocol_generation save:true` and
`notebook_draft`). State changes only after the human approves.

Everything routes through the same validated renderer actions the UI uses
(`applySequenceEdit`, the `cloning-assembly` plan builders), so the agent cannot
reach a code path the UI can't.

### Confirmed decisions

1. **Every `propose_edit` is gated individually** — per-edit human approval, no
   session-level auto-apply toggle. This is the strongest form of "never touch."
2. **`design_cloning` is compute-only** — it returns primers/procedure/plans and
   never persists a design into the workspace. Purely advisory.

## Two tools (action-enum convention, like `container` / `assay_table`)

Split by trust level so annotations stay honest:

- **`sequence_viewer`** — read + compute.
  `readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false`.
- **`sequence_edit`** — proposes mutations. Write tool, `destructiveHint: false`
  because it is approval-gated (returns a proposal, never applies).

Prefixed `mcp__hikari__sequence_viewer` / `mcp__hikari__sequence_edit`.

---

## `sequence_viewer` (read + compute)

```
action: enum [ list_records, get_record, get_sequence, get_features, analyze, design_cloning, get_cloning_design ]
```

| action | input | returns |
|---|---|---|
| `list_records` | — | `[{ id, name, length, topology, featureCount, selected }]` |
| `get_record` | `recordId`, `include?: [sequence,features,stats]` | metadata + optional blocks; `sequence` omitted unless requested |
| `get_sequence` | `recordId`, `start`, `end` (1-based inclusive) | `{ start, end, length, sequence, gcPercent }` — windowed, capped |
| `get_features` | `recordId`, `type?` | `[{ id, name, type, strand, segments:[{start,end}] }]` |
| `analyze` | `recordId`, `kind: restriction\|orf\|translation\|gc`, `start?`, `end?`, `frame?` | analysis via `buildCommercialRestrictionFeatures` / `buildOrfFeatures` / translation / GC — no mutation |
| `design_cloning` | `recordId`, `strategy`, `edit?` (hypothetical delta), `insertRange?` | `{ feasible, strategy, primers[], procedure[], enzymes[], warnings[], summary:{ templateLength, resultLength, insertLength } }` |
| `get_cloning_design` | `recordId?` | current in-app design source + last plan, if any |

**`strategy` enum:** `whole-plasmid`, `q5-kld`, `two-step-ligation`, `golden-gate`,
`gibson`, `in-fusion`.

`design_cloning` accepts an **optional hypothetical `edit`** so the agent can
explore routes for a change without applying it — a pure function over the
`assembleCloningPlan` family. `insertRange` applies only to
`gibson`/`in-fusion`/`golden-gate`; ignored (with a note) otherwise. It never
writes to the cloning-design workspace.

---

## `sequence_edit` (propose → approve, per edit)

```
action: enum [ propose_edit, propose_annotation ]
```

### Target identity (required on every proposal)

`recordId` alone is **not** a safe key for delayed approval. `applySequenceEdit`
mutates `getSelectedRecord()` / `state.selectedRecordIndex` and persists through
`state.activeEntryId`, and parsed IDs (`genbank_1`) are distinct from saved
library entry IDs. Between proposal and approval the selection can move or the
record can change underneath the token. So every proposal carries an explicit
**`target`** identity + version that the host **re-resolves and re-verifies at
approval time** (never trusting the live selection):

```
target : {
  entryId      : string | null,   // saved library entry, when the record is persisted
  recordId     : string,          // parsed record id, e.g. "genbank_1"
  recordIndex  : integer,         // position in the loaded record set (fallback/UX only)
  baseLength   : integer,         // length of the sequence the proposal was computed against
  baseDigest   : string           // digest (e.g. sha1) of that base sequence
}
```

At approval the host resolves `entryId` (or `recordId`) back to a concrete record,
then requires `baseLength` **and** `baseDigest` to still match. If they don't —
selection changed, another edit landed, the entry was reloaded — it rejects with
`TARGET_CHANGED` and the agent must re-read and re-propose. Approval does **not**
rely on `selectedRecordIndex`; it re-selects the resolved target first.

### `propose_edit`

```
target   : Target        (above)
mode     : enum [ insert, delete, replace ]
start    : integer (1-based)
end      : integer (1-based, inclusive; = start for insert)
sequence : string  (new bases; omitted/empty for delete)
```
Returns a proposal, not an applied edit:
```
{
  pending_approval : true,
  target           : { …echoed… },
  summary          : "Replace 3 bp (CGT->A) at 412..414",
  preview          : { before: "...ACGT|CGT|AAGC...", after: "...ACGT|A|AAGC...", newLength },
  affectedFeatures : [{ id, name, shift }],
  approvalToken    : "<id>"
}
```

### `propose_annotation`

Feature edits do not "mirror" base edits — the feature editor
(`detail-feature-editing.js`) reads a distinct field set and treats add / edit /
delete differently. Concrete schema:

```
target        : Target
mode          : enum [ add, edit, delete ]
featureRef    : { id?, index?, name?, range? }   // required for edit/delete; identifies the existing feature
name          : string        // add/edit
type          : string        // add/edit; normalized via normalizeFeatureType (GenBank key)
strand        : enum [ 1, -1, 0 ]   // add/edit
description   : string        // add/edit, optional
segments      : [{ start, end }]    // add/edit; 1-based inclusive; MULTI-segment preserved (joins)
```
Rules: `add` requires `name`/`type`/`segments`; `edit` requires `featureRef` plus
the fields to change and carries the full `segments` array (partial segment sets
are rejected, so multi-segment metadata can't be silently dropped); `delete`
requires an **unambiguous** `featureRef` (id, or index, or name+range that matches
exactly one feature) and returns `AMBIGUOUS_FEATURE` otherwise.

Both actions produce one approve/reject card each — see host integration below.
There is no batch-approve and no auto-apply.

---

## Host integration: the approval surface (must be built)

Today nothing consumes these proposals. `review-overlay.js` only collects
`meta.notebookDraft` / `meta.protocolReview`, `render()` branches solely protocol
vs. notebook, and `approveItem`/`rejectItem` dispatch only those two types. A
`pending_approval` payload would have nowhere to go. The contract therefore
defines a third review type the overlay must learn to handle:

- **Meta envelope** — the tool result attaches, on the agent message:
  ```
  meta.sequenceEditProposal[approvalToken] = {
    kind        : "edit" | "annotation",
    target, mode, summary, preview, affectedFeatures,
    save        : { mode: "confirm_before_save", applied: false, status: "pending" }
  }
  ```
  mirroring the `notebookDraft.save` / `protocolReview` shape so
  `collectReviewItemsForMessage` can pick it up.
- **Review item type** — `type: 'sequence-edit'`, rendered by a new
  `renderSequenceEditPreview` (before/after window + affected-feature list),
  alongside the existing protocol/notebook branches in `render()`.
- **Approve/reject dispatch** — new `approveSequenceEdit` / `rejectSequenceEdit`
  branches in `approveItem`/`rejectItem`. Approve re-resolves `target`, verifies
  `baseDigest`/`baseLength`, re-selects the record, then calls `applySequenceEdit`
  (or the feature-editor add/edit/delete path); it writes status back into
  `meta.sequenceEditReview[approvalToken] = { status, reason, reviewed_at }` and
  removes the card — exactly like `markProtocolReview`.

Until this surface exists, `sequence_edit` cannot be enabled.

## `design_cloning`: strategy adapter (normalize the two vocabularies)

The contract's `strategy` enum is UI-facing (`q5-kld`, `two-step-ligation`,
`in-fusion`, …). Those are not engine routes: `buildDisplayPlan` maps each to a
different builder, and the engine reports `recommendedAssemblyStrategy` values
like `site-directed-mutagenesis`, `restriction-ligation`, `overlap-pcr`, `gibson`.
Returning the raw engine value under a field named `strategy` would be confusing.

A dedicated **adapter** (`cloning-strategy-adapter.js`, wrapping the same
`buildDisplayPlan` dispatch the UI uses) owns the mapping and normalizes output:

| contract `strategy` | builder | engine `recommendedAssemblyStrategy` |
|---|---|---|
| `whole-plasmid` | whole-plasmid (QuikChange) | `site-directed-mutagenesis` |
| `q5-kld` | Q5/KLD module | `site-directed-mutagenesis` |
| `two-step-ligation` | megaprimer-restriction | `restriction-ligation` |
| `golden-gate` | golden-gate | `golden-gate` |
| `gibson` | insert-assembly (Gibson) | `gibson` \| `overlap-pcr` |
| `in-fusion` | insert-assembly + In-Fusion procedure | `gibson` |

Normalized return shape (stable field names, both vocabularies surfaced):
```
{
  feasible    : boolean,
  strategy    : "<contract id, echoes the request>",
  engineRoute : "<recommendedAssemblyStrategy, raw>",
  primers     : [{ name, role, sequence, tailSequence, bindingSequence, tm, gcPercent, length, group }],
  enzymes     : [{ name, site, cut }] | null,     // from restrictionEnzymeSelection
  procedure   : [{ step, title, details }],        // flattened from plans[].plan.stepByStepProcedure
  warnings    : [string],
  summary     : { templateLength, resultLength, insertLength }
}
```
So: yes, the fields are reasonable — but only behind this adapter. It flattens the
nested `plans[].plan.*` structure, renames `gcContent→gcPercent` / `groupLabel→
group`, and always echoes the requested contract `strategy` while exposing the raw
`engineRoute` for transparency.

## Conventions & limits (bake in)

- **Coordinates:** 1-based inclusive everywhere (matches the UI status line).
  `design_cloning.edit` uses the same convention as `propose_edit`.
- **Windowing:** `get_sequence` requires `start`/`end` and caps the window
  (~20 kb); large plasmids must be read in slices.
- **Reference, never blob:** edits are always `(mode, start, end, sequence)` deltas
  against a `recordId`. There is deliberately no "set whole sequence" action.
- **No silent state change:** only `propose_*` can alter anything, and only after
  approval. Read/compute never require approval.
- **Errors:** structured `{ error: { code, message } }` — `RECORD_NOT_FOUND`,
  `RANGE_OUT_OF_BOUNDS`, `EDIT_EMPTY_RESULT`, `TARGET_CHANGED` (digest/length
  mismatch at approval), `TARGET_NOT_FOUND` (entry/record no longer loaded),
  `AMBIGUOUS_FEATURE` (annotation ref matches ≠1 feature).

## Where it slots in (for later implementation)

- New direct tools: `src/main/agent/mcp-contract/direct-tools/sequence-viewer.js`
  and `sequence-edit.js`, registered in `direct-tools/index.js`.
- **Strategy adapter:** `cloning-strategy-adapter.js` (renderer side) wrapping the
  `buildDisplayPlan` dispatch and emitting the normalized `design_cloning` shape.
- **Approval surface (blocking dependency for `sequence_edit`):** extend
  `review-overlay.js` — `collectReviewItemsForMessage` reads
  `meta.sequenceEditProposal`, `render()` gains a `renderSequenceEditPreview`
  branch, and `approveItem`/`rejectItem` gain `approveSequenceEdit` /
  `rejectSequenceEdit` that re-resolve + re-verify `target` before applying.
- Bridge to the renderer via the existing `runAppTool` path → new sequence-viewer
  actions exposing the read/compute functions and a mediated `applySequenceEdit`.
  Target resolution must key off `entryId`/`recordId`, not the live selection.
- Instructions block + `enabled_tools` entries in `instructions.js`; regenerate
  `docs/agent/mcp-contract/mcp-contract.{json,md}` via the existing export script.
