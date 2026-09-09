---
name: "hikari-sequence-viewer"
description: "Use Hikari Sequence Viewer MCP tools to find local plasmids, inspect features and numbered CDS/ORF residues, assemble Protein Builder constructs, create temporary sequence derivatives, and compare mutagenesis primer designs. Use for local sequence-library work, protein tagging, feature edits, and specified amino-acid mutations."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:sequence-viewer -->

# Hikari Sequence Viewer MCP

Operate the existing Sequence Viewer library through its nine direct `sequence_*` tools. Resolve targets from current tool responses, carry out the user's requested design, verify the resulting sequence, and return the relevant Open action. The tools create temporary derivatives automatically; the source stays available.

## Choose the relevant reference

- Read [tool-reference.md](references/tool-reference.md) for exact argument names, return fields, pagination, coordinate conventions, and limits. The connected server's tool schemas are authoritative when they differ from these instructions.
- Read [workflows.md](references/workflows.md) for discovery, feature editing, Protein Builder, and batched residue-edit examples. Load the section matching the user's task.
- Read [primer-review.md](references/primer-review.md) before designing or interpreting primers, especially for multiple edits, donor templates, or derivatives of derivatives.
- Read [errors-and-compatibility.md](references/errors-and-compatibility.md) when a call fails, an output is truncated, or default names/template labels conflict with the recorded edits.

## Select tools by intent

| User intent | Tool |
| --- | --- |
| Browse saved or temporary sequences | `sequence_list` |
| Find a plasmid, named feature, or exact DNA/protein substring | `sequence_search` |
| Inspect entry metadata, feature references, or selected DNA | `sequence_get` |
| Insert, replace, or delete an annotation or its DNA | `sequence_feature_edit` |
| Find existing tags, linkers, cleavage sites, or codon profiles | `sequence_protein_parts` |
| Assemble an ordered protein chain and matching DNA | `sequence_protein_build` |
| Inspect numbered residues and their codons | `sequence_protein_get` |
| Substitute, delete, insert residues, or replace a CDS | `sequence_protein_edit` |
| Compare cloning routes for an existing derivative | `sequence_mutagenesis_primers` |

Use the names exposed by the connected Hikari server, with any namespace added by the client. Do not restore or call the retired `sequence_viewer` / `sequence_edit` interfaces. Do not bypass the MCP contract by writing library files or editing the UI's active buffer through a shell.

## Resolve the actual target

1. Start with `sequence_search` when the user provides a name, feature, or sequence. Always specify `mode`. Use `sequence_list` for browsing or to discover folder IDs.
2. Match entry identity using returned name, folder/project, status, topology, and length. Duplicate names are valid. Use available context to disambiguate; ask a focused question only if multiple candidates still satisfy the request.
3. Read `sequence_get` for the chosen `entry_id`. Select a returned `feature_ref`; feature names and coordinates alone are not mutation handles. Explicitly request predicted ORFs when needed.
4. For protein edits, read `sequence_protein_get` around the requested residues. Check `editable`, residue identities, codons, nucleotide positions, and terminal stop. Do not reinterpret a mismatch as a nearby mutation.

Saved and temporary entries, and both circular and linear sequences, are discoverable by default. An unsaved editor-only buffer must first become a library entry through the existing UI; no tool in this contract imports that buffer. If the library/storage is unavailable, report that condition instead of inventing an entry or storage path.

## Apply the authorized design

A request to make the edit authorizes creation of its temporary derivative. Do not add a separate confirmation step for that same requested edit. Clarify only a missing target, sequence, or design decision that materially changes the requested result. A vague improvement goal does not identify a particular mutation; obtain the objective or propose a concrete design with its evidence before applying an unsupported guess.

For every edit:

- Copy `entry_id`, `expected_revision`, and `feature_ref` from the same current entry read. Treat revisions and references as opaque strings.
- Generate a distinct `request_id` for each intended mutation or builder call. Persist the ID and exact arguments long enough to retry an uncertain call. Use the same ID only for the identical request.
- Choose `annotation_only` when DNA must stay unchanged; choose `sequence_and_annotation` when changing the bases belonging to a feature. Do not infer the mode from a feature's name.
- Pass an explicit, meaningful `name` for a derivative, particularly a length-changing edit. Describe the intended operation, not an unverified effect on protein function.
- Use the requested codon profile when given. Preserve source DNA by default; optimization is an explicit choice.
- Treat success as a new temporary entry. A second edit to that draft creates another derivative; use the new entry's references and revision for subsequent edits.

Nucleotide ranges are one-based inclusive; `after_base: 0` inserts before base 1. Feature segments remain in the ordered location representation returned by the tool. For circular or reverse features, do not sort, flatten, or reverse the segments yourself. Protein residue numbers always run from 1 at the N terminus, regardless of strand or origin. Use returned codon-position lists rather than a linear arithmetic shortcut.

Within one protein-edit batch, every position refers to the original protein read. Do not renumber later operations after an earlier deletion or insertion. Provide expected amino acids for substitutions/deletions. `after_residue: 0` means N-terminal insertion; insertion after the final residue is before a terminal stop. Whole-CDS replacement is a distinct `replace_cds` operation and must be the sole operation in its batch.

## Verify and hand back the result

After a successful mutation, read its returned `entry_id` with `sequence_get`. For protein work, obtain the new feature reference and read the affected residue window with `sequence_protein_get`. Verify the requested substitutions/indels, stop policy, length, and affected-feature report; do not use a generated name as proof of sequence content. The complete resulting protein is also returned by `sequence_protein_edit`.

For Protein Builder, inspect the protein/DNA output, ordered blocks, and warnings. A tag-first chain can lack an initiating methionine; do not silently prepend one. Follow the user's design or resolve whether an initiating M is intended. Source-preserving assembly and codon optimization are different choices.

Run primer design only when requested or needed for the requested cloning workflow. An edited sequence can be valid even when no primer route is feasible. Keep the derivative, explain the route-specific obstacle, and preserve the distinction between physical templates, hypothetical intermediates, and fragments that still need a donor or synthesis.

Return the result's name, entry ID, temporary status, a concise description of verified changes, and material warnings. Preserve returned `ui_actions` so Hikari can render **Open Plasmid**, **Open Protein Builder**, and **Open Primer Design**. Do not fabricate actions or claim a view opened merely because an action was returned. Library refresh does not automatically switch the user's active record.

Users save derivatives through the existing UI. This contract does not delete plasmids, automatically mark a derivative saved, or order primers. A successful computational design does not establish that its DNA or intermediate exists physically.
