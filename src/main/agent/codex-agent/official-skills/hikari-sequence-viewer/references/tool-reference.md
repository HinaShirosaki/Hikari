# Tool reference

Use this reference to construct calls. Inspect the connected schema before relying on an optional argument added by a newer server. Arguments are strict: unknown top-level fields are rejected. Do not add `action`, `storagePath`, or an approval flag to these tools.

## Shared conventions

- Entry identity: `entry_id`; current content identity: `revision`. Mutations send that value as `expected_revision`.
- Feature identity: `feature_ref` returned for that revision. Copy it whole; do not derive it from its current implementation format.
- Source-feature payload: `{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF"}`. This refers to a library feature, not a filename, whole plasmid, or protein string.
- Pagination: `offset` defaults to 0. List, search, feature and parts pages default to 50; residue pages default to 100. `limit` is 1–200. Continue using `next_offset` with the same filters until it is null; an empty page is valid.
- Feature ranges: ordered `segments: [{"start":101,"end":240}]`, one-based inclusive, and `strand: 1` or `-1`. Origin-spanning locations use multiple explicit segments. A nucleotide boundary is a different input: `after_base` permits 0 through entry length.
- Sequence literals: DNA uses IUPAC nucleotide letters; peptide literals use the 20 standard amino-acid letters without a stop symbol. Whitespace is normalized. Exact DNA searches treat ambiguity symbols literally, not as wildcards. Primer design can reject unresolved DNA even when a sequence edit accepted it.
- Every tool result carries `ok` and `status`. A valid read can have status `saved` or `temporary`; success is not limited to the literal status `ok`. On failure inspect `error` and the error status.

## sequence_list

Optional: `status` (`all`, `saved`, `temporary`), `folder_id`, `project_id`, `topology` (`linear`, `circular`), `offset`, `limit`.

Default includes saved and temporary entries. Results provide `items`, `total`, `offset`, `next_offset`, and `folders`. Entries include `entry_id`, `name`, `status`, `folder_id`, `topology`, `length`, `feature_count`, and `revision`. Use `folders` to resolve an actual folder ID. Do not invent a project ID from its name. Prefer one of folder/project filtering for a call.

## sequence_search

Required: `mode` and `query`. Optional: the list filters and pagination above.

Modes:

- `name`: case-insensitive plasmid-name substring.
- `feature`: case-insensitive feature name/type substring.
- `dna`: exact DNA substring, both strands, including circular-origin crossings.
- `protein`: exact protein substring in CDS/ORF translations, including predicted ORFs.

Returns entry summaries with `matches`. A name match can have an empty `matches` array. Feature/protein hits include feature references; protein hits add `residue_matches` with one-based inclusive residue ranges. DNA hits include strand, nucleotide segments, and overlapping feature summaries. Matching locations are capped; inspect `matches_truncated` and narrow the query if complete enumeration matters. Pagination is over entries, not individual hit locations.

## sequence_get

Required: `entry_id`.

Optional: `offset`, `limit`, `include_orfs`, `include_sequence`, `feature_ref`, `include_feature_dna`, `nucleotide_range: {start,end}`.

Returns metadata, revision, a `features` page, and applicable `ui_actions`. Features include name/type/strand/segments/source/qualifiers. Full plasmid DNA is returned only with `include_sequence: true`. A selected feature's DNA requires both `feature_ref` and `include_feature_dna: true`; it is returned in feature orientation. `nucleotide_range` is a non-wrapping interval with start <= end. Read two ranges for an origin-spanning raw nucleotide window.

The feature list includes annotated features by default. `include_orfs: true` adds predicted ORFs. Predicted ORFs can be read and protein-edited; feature-edit operations require an annotation already in the record.

## sequence_feature_edit

Required: `entry_id`, `expected_revision`, `request_id`, `operation` (`insert`, `replace`, `delete`), `mode` (`annotation_only`, `sequence_and_annotation`). Optional common field: `name` for the resulting entry.

| Operation | annotation_only | sequence_and_annotation |
| --- | --- | --- |
| insert | `feature` with name, type, ordered segments; optional strand/description/qualifiers | `after_base`, `feature` with name/type, and `dna` or `source`; new segments are computed |
| replace | `feature_ref` and the changed `feature` fields; omitted locations keep the current ones | `feature_ref`, `dna` or `source`; optional changed metadata in `feature`, without segments |
| delete | `feature_ref`; removes annotation | `feature_ref`; removes the exact feature DNA segments and updates overlaps |

`feature` supports `name`, `type`, `strand`, `segments`, `description`, `qualifiers`. Authored qualifier values are strings in this schema; returned qualifiers can contain arrays for repeated GenBank qualifiers. Preserve returned qualifiers by omitting unchanged fields rather than blindly resubmitting an incompatible array. No sequence payload belongs in annotation mode. Deletion accepts no feature metadata, DNA/source payload, or insertion boundary.

A DNA literal or referenced-feature DNA is interpreted in the target feature's orientation. The tool reverse-complements it for a reverse target; do not pre-reverse-complement it. Do not change strand in the same DNA replacement. Continuous reverse or origin-spanning features are supported. A discontinuous feature supports annotation editing and exact segment deletion; replacing DNA across its gaps is rejected because placement is unspecified.

## sequence_protein_parts

Optional: `query`, `type`, `offset`, `limit`.

Returns existing catalog `items` with stable `part_id`, label, type, amino-acid sequence and notes, plus `codon_profiles` and `default_codon_profile`. Search before choosing a tag/linker/site; do not assume a remembered catalog ID is available. Current default profile is `ecoli`; use returned supported profile IDs for alternatives.

## sequence_protein_build

Required: `request_id`, `parts` (ordered array, 1–100). Optional: `name`, `codon_profile`.

Each part has `kind`:

- `catalog`: `part_id` from the parts tool.
- `feature`: `source` containing entry ID, revision and CDS/ORF feature reference. Optional `label`, `codon_optimize`.
- `custom`: `amino_acids`; optional matching `dna`, `label`, `codon_optimize`.

Source DNA is preserved by default. New protein-only blocks use shared reverse translation with the chosen profile; `codon_optimize: true` explicitly permits recoding a source/custom DNA block. Matching custom DNA must encode the entire protein block. No terminal stop is added to the assembled chain.

Returns `construct_id`, `name`, `protein`, `dna`, ordered DNA `parts`, `protein_parts` with one-based protein boundaries, `warnings`, source identities, and an Open Protein Builder action. DNA block lengths can be accumulated in order to obtain construct-relative DNA boundaries. The construct is persistent and reusable but is not itself a library plasmid entry. Build output can contain large template fields; see the truncation guidance if necessary.

## sequence_protein_get

Required: `entry_id`, `feature_ref`. Optional: `expected_revision`, `offset`, `limit`.

Returns `residue_count`, paginated `residues.items` containing `position`, `amino_acid`, `codon`, `nucleotide_positions`, plus `terminal_stop`, `editable`, and `warnings`.

`nucleotide_positions` are one-based in coding order. Reverse positions descend; origin-spanning codons may cross between the final base and base 1. Standard-code `codon_start` offsets are handled. Unsupported genetic codes, ambiguous/partial/unresolved locations, and internal stops can make a feature readable but not protein-editable. Do not reinterpret a standard-code translation under a different code or bypass `editable: false` with a guessed DNA edit.

## sequence_protein_edit

Required: `entry_id`, `expected_revision`, `feature_ref`, `request_id`, `operations` (1–32). Optional: `name`, `codon_profile`.

| Operation | Fields |
| --- | --- |
| substitute | `position`, `expected_amino_acid`, `amino_acid` |
| delete | inclusive `start`, `end`, `expected_amino_acids` for that exact original range |
| insert | `after_residue`, and either `amino_acids` or `construct_id` |
| replace_cds | either `amino_acids` or `construct_id`; must be the only operation |

All positions in a batch refer to the original revision. Conflicting operations and wrong expected residues reject the whole batch. Unchanged codons stay unchanged; substitutions use minimum-nucleotide-change codon selection, and new residues use shared reverse translation. A referenced construct carries its built DNA. Target strand, frame-offset prefix and terminal-stop policy are preserved. New insertions occur before a terminal stop, which is not an editable numbered protein residue.

## Mutation results

Feature and protein edits return `status: derivative_created`, `entry_id`, `revision`, `entry_status: temporary`, `source_id`, `root_id`, `changes`, `affected_features`, and applicable `ui_actions`; protein edits also return `protein` for verification. `source_id` is the immediate parent. `root_id` is the original lineage entry. Report every material overlapping annotation change/removal, not just the selected feature.

Each edit call creates a separate derivative even when its parent is temporary. Identical retries reuse the result. Source snapshots, parent/root history, constructs and primer plans persist with entry artifacts and participate in library storage recovery/import/export.

## sequence_mutagenesis_primers

Required: derivative `entry_id`, `expected_revision`. Optional: `methods` (1–7 strategy IDs), `donor` (source-feature reference).

Current strategy IDs: `whole-plasmid`, `q5-kld`, `two-step-ligation`, `golden-gate`, `gibson`, `in-fusion`, `overlap-extension`.

Returns `status: design_ready` or `no_feasible_design`, `routes`, `recommended_method`, `ranking_reason`, warnings and actions. Each route has feasibility, stages, stage/edit-site counts, primer and warning counts. Stage/primer fields include product validation, binding verification and template identity/kind. See [primer-review.md](primer-review.md) before interpreting these results. This tool persists a design; it does not order primers or create another edited plasmid.
