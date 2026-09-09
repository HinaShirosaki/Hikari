# Sequence Viewer MCP tools

The nine `sequence_*` tools operate on the configured local Sequence Viewer library. They run without an open viewer. The tool schemas exported in `mcp-contract.json` are authoritative; implementations live in the existing Sequence Viewer feature under `main-process/mcp` and browser-independent `mcp` modules.

## Discovery and coordinates

`sequence_list` accepts status (`all`, `saved`, `temporary`), folder/project and topology filters, offset and limit. The default includes saved and temporary linear and circular entries. `sequence_search` requires a mode: `name`, `feature`, `dna`, or `protein`. Name/feature searches are case-insensitive substring searches. Sequence searches are exact substrings (IUPAC symbols are literal, not wildcard matching); DNA searches inspect both strands and circular origin crossings. Up to 200 matching locations per entry are returned.

`sequence_get` returns metadata, revision, and a paginated feature list. Use `include_orfs: true` to include predicted ORFs. Request `include_sequence`, `nucleotide_range`, or `feature_ref` plus `include_feature_dna` explicitly for DNA. Ranges are one-based inclusive. Features carry ordered segments and strand; reverse features retain forward GenBank segment order, with protein traversal reversed. References are tied to the exact entry revision and occurrence, not a feature name.

`sequence_protein_get` requires an entry and feature reference and returns paginated N-to-C residue numbers, codons, and nucleotide positions in coding order. Terminal stop is separate. Standard genetic-code CDS frame offsets are supported. Unsupported codes, partial locations, ambiguous coding bases and internal stops remain readable but are not editable at protein level.

## Edits

Every edit requires `entry_id`, `expected_revision`, and a unique `request_id`. Repeat identical arguments and request ID after a transport failure; a changed payload with a reused ID is rejected. Each successful call creates one new temporary library entry, including edits to temporary parents. No tool deletes a plasmid or promotes a draft to saved.

`sequence_feature_edit` requires operation (`insert`, `replace`, `delete`) and mode (`annotation_only`, `sequence_and_annotation`). Annotation insertion requires name, type, segments; replacement can change selected metadata or ranges. DNA insertion requires feature name/type and `after_base` (0 = before base 1); DNA payload is oriented according to the feature strand. Choose literal `dna` or a `source` reference containing entry ID, expected revision and feature reference. Deletion removes only the annotation in annotation mode, or its exact DNA segments in sequence mode. Replacement of a discontinuous location is rejected rather than guessing placement across gaps.

`sequence_protein_edit` accepts a batch of operations interpreted against the original revision:

```json
{"operations":[
  {"operation":"substitute","position":45,"expected_amino_acid":"E","amino_acid":"G"},
  {"operation":"delete","start":50,"end":51,"expected_amino_acids":"GK"},
  {"operation":"insert","after_residue":60,"amino_acids":"HH"}
]}
```

Substitution/deletion must match expected residues. Conflicting operations fail atomically. `after_residue: 0` inserts at the N terminus; the final residue boundary inserts before a terminal stop. `replace_cds` replaces all protein residues while preserving frame-offset bases and the terminal-stop policy. It must be the sole operation. Insert/replace_cds can use a `construct_id` instead of an amino-acid string.

Unchanged codons are retained. Substitutions minimize DNA changes using the existing deterministic codon chooser. Newly inserted residues use the specified `codon_profile`, default `ecoli`. Affected features, translations, and downstream coordinates are updated; every affected/removed feature is reported. Reverse and continuous circular-origin locations are supported.

## Protein Builder and primer designs

`sequence_protein_parts` returns existing catalog part IDs and supported codon profiles. `sequence_protein_build` requires request ID and ordered `parts`. Each part is `catalog` (part_id), `feature` (source reference), or `custom` (amino_acids and optional matching DNA). Source DNA is preserved unless `codon_optimize` is true. The result contains the chain, DNA, mapped blocks, warnings and a persistent construct ID. It can be reopened in Protein Builder with matching settings.

`sequence_mutagenesis_primers` requires a derivative ID and current revision. Optional `methods` selects existing strategy IDs; by default all existing routes are compared. An optional donor is an explicit source reference. DNA edits remain separate: multiple sites are evaluated as ordered stages, and later templates are labeled hypothetical intermediates. Derived parent plasmids are also labeled hypothetical. Primer binding is checked on the source templates. Q5/KLD reconstructs the circular product from primer tails and annealing positions; whole-plasmid routes verify both complementary mutagenesis primers. Assembly routes reconstruct PCR fragments and require exact complete-product coverage. Restriction routes reconstruct the amplified insert and retained source backbone using the selected enzyme cuts. A planner echoing the requested sequence alone is insufficient to pass validation.

Feasible routes rank by stages, primer count, warnings and existing strategy order. Failures return `no_feasible_design` with reasons and do not discard the derivative. Primer plans persist and reopen in the existing cloning view without generating a notebook page or rerunning an edit. Saved comparisons allow route inspection; their editing/confirmation controls are disabled because the derivative already exists.

## Storage and integration

Entries retain parent/root provenance and a versioned `agent-design.json` containing original snapshots, distinct patches, history, construct data and primer results. Standalone builds reside under `entries/.constructs/`. Both are covered by the storage bundle's sequence-entry files. Upsert/promotion preserves design metadata. Hidden staging directories are never recovered as entries. A published entry interrupted before index commit can recover with its original temporary status and folder.

A cross-process library lock serializes reconciliation and writes; SQL.js database images publish by atomic rename. Creation stages files before publishing the index, and failed writes remove the new entry. Existing sources and their alignment sessions are not overwritten or copied onto changed sequences.

Agent Chat keeps explicit Open Plasmid, Open Protein Builder and Open Primer Design buttons with persisted messages. Reading/generating results refreshes the library without switching the active record. Opening a stale primer design fails and asks for regeneration. Editor-only buffers must first be added to the library.

Validation: `node --test tests/sequence-mcp-selfcheck.cjs` and `node tests/sequence-mcp-electron.cjs`, plus focused Sequence Viewer/library/cloning suites, UI build, DOM checks and source-layout checks.

## Official agent skill

`hikari-sequence-viewer` is registered in the official MCP skill catalog and released to initialized Hikari agent workspaces under `.agents/skills/hikari-sequence-viewer/`. Its packaged source is [SKILL.md](../../../src/main/agent/codex-agent/official-skills/hikari-sequence-viewer/SKILL.md), with separate references for tool arguments, worked workflows, primer review, and error recovery. The skill includes compatibility guidance for the template-label and default-name defects observed in the 2026-09-07 agent-style test; adding the skill does not fix those tool defects.

Validate its release and runnable examples with `node --test tests/sequence-mcp-skill-selfcheck.cjs`.
