# Worked workflows

The JSON blocks are MCP call envelopes: send `arguments` to the tool named by `tool`. Uppercase tokens such as `ENTRY_ID`, `REVISION`, and `FEATURE_REF` are illustrative placeholders. Replace them with exact returned values; they are not a variable-substitution syntax understood by the tools. Generate your own request IDs. Example residue identities and coordinates are valid only after inspection confirms them for the selected entry.

## Find and inspect a plasmid

Start by searching the user's name, then resolve ambiguity using folder/status/length. A name is not an entry ID.

```json
{"tool":"sequence_search","arguments":{"mode":"name","query":"Training plasmid","limit":10}}
```

If there are duplicate names and the user identified a folder, discover its ID and filter a new search. Do not take the first duplicate merely because it appears first.

```json
{"tool":"sequence_list","arguments":{"status":"all","limit":50}}
```

```json
{"tool":"sequence_search","arguments":{"mode":"name","query":"Training plasmid","folder_id":"FOLDER_ID","limit":10}}
```

Read the selected entry and choose a feature occurrence from the returned page. Continue feature pagination if the required annotation is not on that page.

```json
{"tool":"sequence_get","arguments":{"entry_id":"ENTRY_ID","limit":50}}
```

For a search by feature name/type, use `mode: feature`. For exact amino-acid sequence identity, use `mode: protein`; do not put protein letters into DNA search. An exact sequence hit is not an alignment or homology assessment.

```json
{"tool":"sequence_search","arguments":{"mode":"feature","query":"Target protein","limit":10}}
```

```json
{"tool":"sequence_search","arguments":{"mode":"protein","query":"HLFSGCTVGS","limit":10}}
```

Inspect only the needed DNA window or selected feature unless the full plasmid is necessary.

```json
{"tool":"sequence_get","arguments":{"entry_id":"ENTRY_ID","feature_ref":"FEATURE_REF","include_feature_dna":true}}
```

## Design a protein fusion with Protein Builder

Example user intent: add a 6xHis tag and TEV site to a selected protein while preserving its source codons. Search the actual catalog first.

```json
{"tool":"sequence_protein_parts","arguments":{"query":"His","limit":20}}
```

```json
{"tool":"sequence_protein_parts","arguments":{"query":"TEV","limit":20}}
```

Select the requested tag length and cleavage variant. TEV variants can leave different residues after cleavage; use their returned sequences/notes. Read the target with `sequence_protein_get` and check editability before assembly.

```json
{"tool":"sequence_protein_build","arguments":{"request_id":"build-his-tev-01","name":"6xHis-TEV-Target","codon_profile":"ecoli","parts":[{"kind":"catalog","part_id":"HIS_PART_ID"},{"kind":"catalog","part_id":"TEV_PART_ID"},{"kind":"feature","source":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF"}}]}}
```

The parts are N-to-C. The source block preserves its DNA because `codon_optimize` was omitted. New tag/site residues use the selected profile. If the user explicitly requests whole-chain optimization, set `codon_optimize: true` on each source/custom block with supplied DNA; select the desired profile for the build.

Inspect `protein`, `dna`, `protein_parts`, `parts`, and `warnings`. A 6xHis-first build does not automatically begin with methionine. If an initiating M is part of the user's intended expression construct, include an explicit custom M block before the tag. Do not silently change the requested protein to remove a warning.

To replace the selected CDS with the entire assembled fusion:

```json
{"tool":"sequence_protein_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"insert-fusion-01","name":"Training plasmid - 6xHis-TEV-Target","operations":[{"operation":"replace_cds","construct_id":"CONSTRUCT_ID"}]}}
```

A whole fusion containing the target must replace the CDS. Inserting that same fusion inside the target would duplicate the target protein. For only a tag/linker insertion, build only that payload and use `operation: insert` with the requested `after_residue` boundary.

After success, use the new entry and its new feature reference to read the beginning, junctions and end of the protein. Verify the original terminal stop policy was retained. Return Open Protein Builder for chain inspection and Open Plasmid for the derivative.

## Apply a batch without numbering drift

Example user design: E45G, delete residues 48–49, and insert GS after original residue 50. Read that original window first; `offset: 40` starts at residue 41.

```json
{"tool":"sequence_protein_get","arguments":{"entry_id":"ENTRY_ID","feature_ref":"FEATURE_REF","offset":40,"limit":15}}
```

Proceed with the following example only if the read confirms E45 and NW at residues 48–49. If not, report the discrepancy and resolve the target/design; do not change the expected letters to make the call pass.

```json
{"tool":"sequence_protein_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"target-batch-01","name":"Training plasmid - E45G del48-49 insGS-after50","operations":[{"operation":"substitute","position":45,"expected_amino_acid":"E","amino_acid":"G"},{"operation":"delete","start":48,"end":49,"expected_amino_acids":"NW"},{"operation":"insert","after_residue":50,"amino_acids":"GS"}]}}
```

All three operations refer to the original read. If original residues 41–55 were `HLFSECTNWVFIDQP`, the result should be `HLFSGCTVGSFIDQP`. Net length is unchanged: delete two residues, insert two. Retained original V50 becomes V48; the inserted G/S become residues 49/50. This is expected renumbering in the product, not a shift of the input coordinate convention.

Read `sequence_get` on the returned derivative, then `sequence_protein_get` with its new feature reference. Verify E45G, the retained V codon, inserted residues, unchanged downstream residues and terminal stop. On a reverse feature, use the same residue numbers; codon genomic positions may be `[541,540,539]`. Do not reverse the requested peptide or substitute a genomic coordinate for residue 45.

If primer review is requested, design from this derivative so the recorded three edits remain available. Do not create a second broad replacement just to give primer design a single target interval.

## Edit annotations separately from DNA

Example: label bases 100–120 without changing sequence.

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","request_id":"annotate-region-01","name":"Training plasmid - annotated region","operation":"insert","mode":"annotation_only","feature":{"name":"Reviewed region","type":"misc_feature","strand":1,"segments":[{"start":100,"end":120}],"description":"Region identified in the requested review"}}}
```

Rename a selected annotation or replace its location by supplying only the changed metadata. Preserve other qualifiers by leaving them out of the payload.

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"rename-feature-01","name":"Training plasmid - reviewed feature label","operation":"replace","mode":"annotation_only","feature":{"name":"Confirmed region"}}}
```

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"remove-annotation-01","name":"Training plasmid - annotation removed","operation":"delete","mode":"annotation_only"}}
```

DNA insertion requires an explicit boundary and an annotation for the inserted payload. This example inserts a reverse-strand feature after base 100; the DNA is supplied in feature orientation.

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","request_id":"insert-dna-block-01","name":"Training plasmid - reverse block after100","operation":"insert","mode":"sequence_and_annotation","after_base":100,"dna":"ATGGGTGGTGGTTAATAG","feature":{"name":"Synthetic block","type":"misc_feature","strand":-1}}}
```

DNA replacement can copy a referenced feature. Read both target and source first; their revisions and references need not be the same.

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"replace-from-library-01","name":"Training plasmid - library block replacement","operation":"replace","mode":"sequence_and_annotation","source":{"entry_id":"SOURCE_ENTRY_ID","expected_revision":"SOURCE_REVISION","feature_ref":"SOURCE_FEATURE_REF"}}}
```

```json
{"tool":"sequence_feature_edit","arguments":{"entry_id":"ENTRY_ID","expected_revision":"REVISION","feature_ref":"FEATURE_REF","request_id":"delete-feature-dna-01","name":"Training plasmid - selected feature deleted","operation":"delete","mode":"sequence_and_annotation"}}
```

For a circular feature such as `[{"start":950,"end":1000},{"start":1,"end":120}]`, preserve that ordered representation. For a genuinely gapped feature, annotation edits and exact deletion are permitted; a DNA replacement without defined placement across gaps is rejected. Inspect `affected_features` and the new coordinates after every DNA edit, including annotations shifted downstream of the edit.

## Compare primers and report an actionable result

```json
{"tool":"sequence_mutagenesis_primers","arguments":{"entry_id":"DERIVATIVE_ENTRY_ID","expected_revision":"DERIVATIVE_REVISION"}}
```

An explicit donor is a library source reference. It does not mean the desired in-silico product is a physical template.

```json
{"tool":"sequence_mutagenesis_primers","arguments":{"entry_id":"DERIVATIVE_ENTRY_ID","expected_revision":"DERIVATIVE_REVISION","methods":["gibson","in-fusion","golden-gate"],"donor":{"entry_id":"DONOR_ENTRY_ID","expected_revision":"DONOR_REVISION","feature_ref":"DONOR_FEATURE_REF"}}}
```

Apply [primer-review.md](primer-review.md). A useful answer states which derivative is available, its verified protein/feature change, the feasible recommended route and its stage/primer counts, any unsupplied donor/intermediate requirement, and the returned Open actions. If no route is feasible, the edited derivative still remains available.
