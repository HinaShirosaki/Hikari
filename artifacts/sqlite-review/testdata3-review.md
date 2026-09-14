# TestData3 SQLite review

Reviewed 2026-09-13T22:45:25-05:00. All databases were opened with SQLite mode=ro. No database or source-code changes were made. Scope: five main TestData3 databases and three nested TestData4 databases; TestData7 and tests were discovered but not reviewed.

## Findings

1. **Missing paper files:** 24 of 47 common paper-index records marked uploaded_pdf have no file at the stored path. The knowledge index also has 2 missing PDF location paths. These observations do not establish deletion or whether another copy exists elsewhere.
2. **Incomplete section-search coverage:** 20 of 22 knowledge papers have no paper_chunks, despite ready wiki/extraction statuses and existing wiki files. The seven chunks cover only two papers. The section search reads paper_chunks directly (src/main/papers/retrieve/agent-paper-wiki-search.js); an explicit chunkAllPapers operation exists in agent-paper-wiki-chunker.js.
3. **Metadata quality:** Some titles are filename-like or contain encoding artifacts (for example the YEATS title contains Ï€). The knowledge collection also contains non-paper documents; classification expectations should be checked before cleanup.
4. **Sequence count differences require interpretation:** anti-CD19-VH has 15 declared features / 14 indexed occurrences; ISG15_3 has 29 / 14; temporary VHHn2 has 30 / 16. The indexing implementation filters empty/invalid features and uses stable occurrence IDs that deduplicate matching annotations, so count equality is not a guaranteed invariant.

## Verified consistency

- All eight SQLite integrity checks returned ok; declared foreign_key_check results were empty. Most logical relationships have no declared foreign keys, so this alone is not proof of complete referential integrity.
- All 1,792 populated JSON fields checked parsed successfully.
- All 25 referenced sequence GenBank files exist. No missing non-empty sequence folder references, orphan feature occurrences, or mismatches in occurrence host name/status/topology/length were found.
- Stored feature DNA, CDS DNA/amino-acid, and protein lengths match their stored sequence strings. This is a length check, not biological validation.
- Every notebook protocol reference resolves within protocol_index. Knowledge locations, chunks, and tags have no orphan paper references. All 22 wiki paths exist.

## Database and table inventory

| Database | Table | Rows |
| --- | --- | --- |
| TestData3/KnowledgeBase/knowledge.index.sqlite | paper_chunks | 7 |
| TestData3/KnowledgeBase/knowledge.index.sqlite | paper_links | 0 |
| TestData3/KnowledgeBase/knowledge.index.sqlite | paper_locations | 23 |
| TestData3/KnowledgeBase/knowledge.index.sqlite | paper_tags | 0 |
| TestData3/KnowledgeBase/knowledge.index.sqlite | papers | 22 |
| TestData3/Protocol/protocol.index.sqlite | inventory_personal | 21 |
| TestData3/Protocol/protocol.index.sqlite | inventory_samples | 0 |
| TestData3/Protocol/protocol.index.sqlite | notebook_index | 155 |
| TestData3/Protocol/protocol.index.sqlite | paper_index | 47 |
| TestData3/Protocol/protocol.index.sqlite | protocol_index | 54 |
| TestData3/Protocol/protocol.index.sqlite | record_index | 285 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_entries | 25 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_feature_cds_sequences | 39 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_feature_occurrences | 684 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_feature_proteins | 39 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_features | 248 |
| TestData3/SequenceViewer/sequence-library.sqlite | sequence_folders | 14 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | inventory_personal | 0 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | inventory_samples | 0 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | notebook_index | 0 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | paper_index | 0 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | protocol_index | 0 |
| TestData3/TestData4/Protocol/protocol.index.sqlite | record_index | 0 |
| TestData3/TestData4/Workflow/workflow-status.sqlite | workflow_runs | 0 |
| TestData3/TestData4/Workflow/workflow-status.sqlite | workflow_step_status | 0 |
| TestData3/TestData4/Workflow/workflow-status.sqlite | workflow_templates | 0 |
| TestData3/TestData4/hikari-chemicals.index.sqlite | inventory_chemicals | 0 |
| TestData3/TestData4/hikari-chemicals.index.sqlite | inventory_meta | 4 |
| TestData3/Workflow/workflow-status.sqlite | workflow_runs | 10 |
| TestData3/Workflow/workflow-status.sqlite | workflow_templates | 6 |
| TestData3/hikari-chemicals.index.sqlite | inventory_chemicals | 1130 |
| TestData3/hikari-chemicals.index.sqlite | inventory_meta | 4 |

Counts include derived and mirrored records; do not add them together as unique items. record_index mirrors 155 notebooks, 54 protocols, 47 papers, 10 workflows, 11 assays, and 8 gels. The common database is named Protocol/protocol.index.sqlite but contains more than protocols. Nested TestData4 databases contain no item rows, only four chemical metadata rows. Their older, wider schemas differ from the main current schema; the main workflow schema matches the current source.

## Missing files in paper_index

| ID | Title | Stored path | Status |
| --- | --- | --- | --- |
| paper-h2e034d3 | Cell based potency assays for checkpoint blocking binders | Project/CD47_VHH_Blocker_Campaign/Papers/Cell-based_potency_assays_for_checkpoint-blocking_binders.pdf | uploaded_pdf |
| paper-h30f1f4b3 | Stability of single domain antibodies in serum | Project/CD47_VHH_Blocker_Campaign/Papers/Stability_of_single-domain_antibodies_in_serum.pdf | uploaded_pdf |
| paper-h2d4bcd07 | Calibration buffers for free calcium titrations | Project/cpGFP_Calcium_Biosensor_Engineering/Papers/Calibration_buffers_for_free_calcium_titrations.pdf | uploaded_pdf |
| paper-h3df8fbbe | Arabinose inducible expression of secreted fungal enzymes | Project/CalB_Lipase_Thermostability/Papers/Arabinose-inducible_expression_of_secreted_fungal_enzymes.pdf | uploaded_pdf |
| paper-h77a80022 | bst089.dvi | Project/PD-1_Nanobody_Binder_Discovery/Papers/bst0351389.pdf | uploaded_pdf |
| paper-h30708db7 | 02 IR ILN Rubric SP26 v2 | Project/SUMO1/Papers/02_IR_ILN_Rubric_SP26_v2.pdf | uploaded_pdf |
| paper-h79976f3c | 02 IR ILN Rubric SP26 v2 2 | Project/SUMO1/Papers/02_IR_ILN_Rubric_SP26_v2_2.pdf | uploaded_pdf |
| paper-h5e97f9d2 | LEXUS 4037 (Generic) form | Project/SUMO1/Papers/2025_Interest_Statement-2025-12-16.pdf | uploaded_pdf |
| paper-h2d67fbe4 | Q857029 V1 TEXAS A&M UNIV 20260402 111311 | Project/SUMO1/Papers/Q857029_V1_TEXAS_A&M_UNIV_20260402_111311.pdf | uploaded_pdf |
| paper-h6dc6e563 | Stretching Peptides to Generate Small Molecule β-Strand Mimics | Project/SUMO1/Papers/adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics.pdf | uploaded_pdf |
| paper-h31a26958 | Imprint of mechanical forces on antibody affinity maturation in B cell immune responses | Papers/rabbit_GALT_antibody_affinity_maturation_mechanism_gut_associated_lymphoid_tissue/Imprint_of_mechanical_forces_on_antibody_affinity_maturation_in_B_cell_immune_responses.pdf | uploaded_pdf |
| paper-h28493c76 | RETRACTED: Somatic hypermutation maintains antibody thermodynamic stability during affinity maturation | Papers/rabbit_antibody_repertoire_diversification_affinity_maturation_GALT_appendix_Peyer's_patches_somatic_hypermutation_gene_conversion/Faculty_Opinions_recommendation_of_Somatic_hypermutation_maintains_antibody_thermodynamic_stability_during_affinity_maturation..pdf | uploaded_pdf |
| paper-h16d61ea5 | Poster Sessions | Papers/rabbit_antibody_repertoire_diversification_affinity_maturation_GALT_appendix_Peyer's_patches_somatic_hypermutation_gene_conversion/Poster_Sessions.pdf | uploaded_pdf |
| paper-h7870fdcb | Diversification of the VH3‐53 immunoglobulin gene segment by somatic hypermutation results in neutralization of SARS‐CoV‐2 virus variants | Papers/rabbit_appendix_Peyer's_patches_antibody_repertoire_diversification_review_gene_conversion_somatic_hypermutation/Review_for__Diversification_of_the_VH3-53_immunoglobulin_gene_segment_by_somatic_hypermutation_results_in_neutralization_of_SARS-CoV-2_virus_variants.pdf | uploaded_pdf |
| paper-h55e2822f | Periplasmic expression strategies for nanobody production in Escherichia coli | Papers/CD47_SIRPalpha_blockade_nanobody_therapeutics/Periplasmic_expression_strategies_for_nanobody_production_in_Escherichia_coli.pdf | uploaded_pdf |
| paper-h7d2c0476 | Single domain antibodies that block the CD47 SIRPalpha checkpoint | Papers/CD47_SIRPalpha_blockade_nanobody_therapeutics/Single-domain_antibodies_that_block_the_CD47-SIRPalpha_checkpoint.pdf | uploaded_pdf |
| paper-h57b9f5af | Structural determinants of CD47 recognition by camelid VHH domains | Papers/CD47_SIRPalpha_blockade_nanobody_therapeutics/Structural_determinants_of_CD47_recognition_by_camelid_VHH_domains.pdf | uploaded_pdf |
| paper-hc609208 | Chromophore environment mutations tune the dynamic range of GECIs | Papers/Genetically_encoded_calcium_indicators_design/Chromophore_environment_mutations_tune_the_dynamic_range_of_GECIs.pdf | uploaded_pdf |
| paper-h4ccd5562 | Linker optimisation in circularly permuted GFP calcium indicators | Papers/Genetically_encoded_calcium_indicators_design/Linker_optimisation_in_circularly_permuted_GFP_calcium_indicators.pdf | uploaded_pdf |
| paper-h2ec9b195 | High throughput screening of lipase libraries with chromogenic esters | Papers/Lipase_thermostability_directed_evolution/High-throughput_screening_of_lipase_libraries_with_chromogenic_esters.pdf | uploaded_pdf |
| paper-h5dd13489 | Loop rigidification improves the thermostability of a fungal lipase | Papers/Lipase_thermostability_directed_evolution/Loop_rigidification_improves_the_thermostability_of_a_fungal_lipase.pdf | uploaded_pdf |
| paper-h3fd446de | Differential scanning fluorimetry as a stability triage tool | Papers/Protein_purification_methods_reference/Differential_scanning_fluorimetry_as_a_stability_triage_tool.pdf | uploaded_pdf |
| paper-h164b9f5e | Practical imidazole gradients for IMAC of small his tagged binders | Papers/Protein_purification_methods_reference/Practical_imidazole_gradients_for_IMAC_of_small_his-tagged_binders.pdf | uploaded_pdf |
| paper-h722880b9 | Size exclusion chromatography for oligomeric state assignment | Papers/Protein_purification_methods_reference/Size-exclusion_chromatography_for_oligomeric_state_assignment.pdf | uploaded_pdf |

## Missing knowledge PDF locations

| Location ID | Paper ID | Stored path |
| --- | --- | --- |
| location-92742f06b2744999642a582b | paper-sha256-d98805d7dbc7b733 | Project/CD19_CAR_Binder_Optimization/Papers/adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics.pdf |
| location-88b9ac4771c0b7e058a96997 | paper-sha256-be69fe3e144f6142 | Project/CD19_CAR_Binder_Optimization/Papers/anie202300691-sup-0001-misc_information.pdf |

## Papers without search chunks

| Paper ID | Title |
| --- | --- |
| paper-doi-10.1007_978-3-031-85923-6_19 | UAV path planning method for avoiding restricted areas |
| paper-doi-10.1007_s00280-026-04911-y | s00280 026 04911 y |
| paper-doi-10.1038_s41467-017-00836-6 | Molecular basis of human CD22 function and therapeutic targeting |
| paper-doi-10.1038_s41467-018-07072-6 | Structural insights into the Ï€-Ï€-Ï€ stacking mechanism and DNA-binding activity of the YEATS domain |
| paper-doi-10.1038_s41467-024-52871-9 | Design of a Cereblon construct for crystallographic and biophysical studies of protein degraders |
| paper-doi-10.1038_s41577-025-01207-9 | Fifty years of monoclonals: the past, present and future of antibody therapeutics |
| paper-doi-10.1038_s41589-025-02063-3 | A gasdermin-based life–death evolution system for reprogramming protease specificity |
| paper-doi-10.1056_NEJMp0906597 | BIODESIGN |
| paper-doi-10.1126_science.adk4422 | Continuous evolution of compact protein degradation tags regulated by selective molecular glues |
| paper-doi-10.1186_s43046-026-00379-2 | s43046 026 00379 2 |
| paper-doi-10.1186_s43556-026-00510-8 | Plasma proteomics-based liquid biopsy for predicting efficacy of PD-1-based immunochemotherapy in advanced gastric cancer: a prospective cohort study |
| paper-doi-10.3389_fimmu.2026.1837275 | fimmu.2026.1837275 |
| paper-sha256-16088f5dd05d2ab2 | CHEMISTRY DEPARTMENT PURCHASE REQUISITION |
| paper-sha256-16799da5bb6b9b14 | Role of pharmacogenetics and tacrolimus dosing in liver transplantation |
| paper-sha256-431eb87bfa7d4110 | 68236-H001A |
| paper-sha256-be69fe3e144f6142 | anie202300691-sup-0001-misc_information |
| paper-sha256-d784d65cce6a349b | ja0c00252_si_001 |
| paper-sha256-d98805d7dbc7b733 | adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics |
| paper-sha256-e415ef08f2a2e894 | Build-a-large-language-models |
| paper-sha256-f24b2f016790c158 | Blank Rental Application |

## Workflow relationship checks

All ten run directories exist; checked template IDs and top-level notebookEntryIds resolve.

## Sequence items

| ID | Name | Status | Bases | Features | Folder |
| --- | --- | --- | --- | --- | --- |
| seq_1777330639992_c41eb584 | CZ013_pFUSE-PD-1 | saved | 4713 | 30 | New Folder |
| seq_1788285155838_b8b6ad74 | ISG15 | temporary | 5754 | 16 |  |
| seq_1788284869582_1dc1e2fc | ISG15 | saved | 5758 | 16 |  |
| seq_1788284941392_b9e38c28 | ISG15_2 | saved | 5758 | 16 |  |
| seq_1788284996072_b2aa2570 | ISG15_3 | saved | 5758 | 29 |  |
| seq_1779207092853_b10ef9f5 | NC_000002 | saved | 9011 | 8 |  |
| seq_1779832102896_8d1b58ca | NC_000002_2 | saved | 9011 | 8 |  |
| seq_1777332124519_579b5313 | Protein Builder Insert (Promoter-aligned backbone) | saved | 3825 | 19 |  |
| seq_1777340956927_5765db70 | Protein_Builder_ | saved | 3825 | 15 |  |
| seq_1780090025456_ff99b361 | Protein_Builder__4 | saved | 4048 | 25 |  |
| seq_1788284872098_dbad44c9 | VHHn2 | saved | 5637 | 16 |  |
| seq_1788285172894_4a378d2f | VHHn2 | temporary | 5637 | 30 |  |
| seq_1777332995045_1e49b1cf | a | saved | 3828 | 19 |  |
| seq_1788224940637_cdddf94b | anti-CD19-VH | saved | 5628 | 15 |  |
| seq_1777330646329_c7870978 | pET28a-His-sfGFP | saved | 6389 | 46 |  |
| seq_1787633760296_b435738d | pET28a-His-sfGFP · 6xHis H1A | saved | 6389 | 48 |  |
| seq_1787633300399_c0c59940 | pET28a-His-sfGFP · KanR A49K | saved | 6389 | 48 |  |
| seq_1780364564919_53a4b390 | pETDuet-1-NdeI-F | saved | 5691 | 33 |  |
| seq_1787633866563_23059062 | pETDuet-1-NdeI-F · SUMO-2(C48A,G93C) L28A | saved | 5691 | 43 |  |
| seq_1788996097078_7307830c | pETDuet-1-NdeI-F · SUMO-2(C48A,G93C) L28A g.1390delins808bp | temporary | 5646 | 43 |  |
| seq_1787765443037_8b01bc84 | pETDuet-1-NdeI-F · SUMO-2(C48A,G93C) L28A · 6xHis H2I | saved | 5691 | 42 |  |
| seq_1789223425383_0f0523b0 | pETDuet-1-NdeI-F · SUMO-2(C48A,G93C) L28A · 6xHis H2I g.5287_5288insATT | temporary | 5694 | 38 |  |
| seq_1787689314993_b82be74b | pETDuet-1-NdeI-F · SUMO-2(C48A,G93C) L28A · FLAG Y2A | saved | 5691 | 37 |  |
| seq_1786240924562_5171cb47 | pYDL13 | saved | 4517 | 37 |  |
| seq_1787634613888_e8aa4bb1 | pYDL13 · Aga2p Q35A | saved | 4517 | 37 |  |

## Table columns and sample items

Up to three sample rows per table follow. Long text fields are truncated to 150 characters. These are examples, not a full data export.

### TestData3/KnowledgeBase/knowledge.index.sqlite

#### paper_chunks (7 rows)

Columns: `id` TEXT PRIMARY KEY, `paper_id` TEXT, `section_index` INTEGER, `section_heading` TEXT, `body` TEXT, `body_lower` TEXT, `page_start` INTEGER, `page_end` INTEGER, `char_length` INTEGER, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "ff1d1d01e3fd03397b62bdc6",
    "paper_id": "paper-sha256-4e997d9f48125458",
    "section_index": 0,
    "section_heading": "Preamble",
    "body": "# Diverse organic molecules on Mars revealed by the first SAM TMAH experiment\n\n**Authors:** -",
    "body_lower": "# diverse organic molecules on mars revealed by the first sam tmah experiment\n\n**authors:** -",
    "page_start": null,
    "page_end": null,
    "char_length": 93,
    "created_at": "2026-06-05T14:00:22.710Z",
    "updated_at": "2026-06-05T14:00:22.710Z"
  },
  {
    "id": "3b6ea00fd3304eeb272a5fac",
    "paper_id": "paper-sha256-4e997d9f48125458",
    "section_index": 1,
    "section_heading": "Metadata",
    "body": "- Format: hikari-pdf-to-md-v1\n- Page count: 11\n- Extracted pages: 11\n- DOI: 10.1038/s41467-026-70656-0\n- Source PDF: Papers/spleen_B_cell_intact_antig…",
    "body_lower": "- format: hikari-pdf-to-md-v1\n- page count: 11\n- extracted pages: 11\n- doi: 10.1038/s41467-026-70656-0\n- source pdf: papers/spleen_b_cell_intact_antig…",
    "page_start": null,
    "page_end": null,
    "char_length": 276,
    "created_at": "2026-06-05T14:00:22.710Z",
    "updated_at": "2026-06-05T14:00:22.710Z"
  },
  {
    "id": "1094c336ac77d144fbccbb73",
    "paper_id": "paper-sha256-4e997d9f48125458",
    "section_index": 2,
    "section_heading": "Sections",
    "body": "### Diverse organic molecules on Mars revealed by the first SAM TMAH experiment (pp. 1-11)\n\nArticle https://doi.org/10.1038/s41467-026-70656-0\nDiverse…",
    "body_lower": "### diverse organic molecules on mars revealed by the first sam tmah experiment (pp. 1-11)\n\narticle https://doi.org/10.1038/s41467-026-70656-0\ndiverse…",
    "page_start": 1,
    "page_end": 11,
    "char_length": 12000,
    "created_at": "2026-06-05T14:00:22.710Z",
    "updated_at": "2026-06-05T14:00:22.710Z"
  }
]
```

#### paper_links (0 rows)

Columns: `from_paper_id` TEXT PRIMARY KEY, `to_paper_id` TEXT PRIMARY KEY, `relation` TEXT PRIMARY KEY.

```json
[]
```

#### paper_locations (23 rows)

Columns: `id` TEXT PRIMARY KEY, `paper_id` TEXT, `scope` TEXT, `container` TEXT, `folder_path` TEXT, `pdf_filename` TEXT, `pdf_path` TEXT, `discovered_at` TEXT.

```json
[
  {
    "id": "location-3df1a35b7eb77e3c6eb85e55",
    "paper_id": "paper-sha256-16799da5bb6b9b14",
    "scope": "global",
    "container": "",
    "folder_path": "Papers/spleen_B_cell_intact_antigen_marginal_zone_macrophage_follicular_dendritic_cell_review",
    "pdf_filename": "Role_of_pharmacogenetics_and_tacrolimus_dosing_in_liver_transplantation..pdf",
    "pdf_path": "Papers/spleen_B_cell_intact_antigen_marginal_zone_macrophage_follicular_dendritic_cell_review/Role_of_pharmacogenetics_and_tacrolimus_dosing_in_liver_…",
    "discovered_at": "2026-05-11T19:56:09.751Z"
  },
  {
    "id": "location-4d5b77bca5872a0f6ae0663e",
    "paper_id": "paper-sha256-4e997d9f48125458",
    "scope": "global",
    "container": "",
    "folder_path": "Papers/spleen_B_cell_intact_antigen_marginal_zone_macrophage_follicular_dendritic_cell_review",
    "pdf_filename": "s41467-026-70656-0.pdf",
    "pdf_path": "Papers/spleen_B_cell_intact_antigen_marginal_zone_macrophage_follicular_dendritic_cell_review/s41467-026-70656-0.pdf",
    "discovered_at": "2026-05-11T19:56:09.686Z"
  },
  {
    "id": "location-92742f06b2744999642a582b",
    "paper_id": "paper-sha256-d98805d7dbc7b733",
    "scope": "global",
    "container": "",
    "folder_path": "Project/CD19_CAR_Binder_Optimization/Papers",
    "pdf_filename": "adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics.pdf",
    "pdf_path": "Project/CD19_CAR_Binder_Optimization/Papers/adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics.pdf",
    "discovered_at": "2026-05-11T19:56:10.018Z"
  }
]
```

#### paper_tags (0 rows)

Columns: `paper_id` TEXT PRIMARY KEY, `tag` TEXT PRIMARY KEY.

```json
[]
```

#### papers (22 rows)

Columns: `id` TEXT PRIMARY KEY, `doi` TEXT, `title` TEXT, `abstract` TEXT, `authors_json` TEXT, `journal` TEXT, `year` TEXT, `url` TEXT, `pdf_sha256` TEXT, `added_at` TEXT, `updated_at` TEXT, `source` TEXT, `wiki_status` TEXT, `wiki_path` TEXT, `extraction_status` TEXT, `notes` TEXT, `search_text` TEXT, `pmid` TEXT, `pmcid` TEXT.

```json
[
  {
    "id": "paper-sha256-16799da5bb6b9b14",
    "doi": "10.1007/s12072-022-10437-1",
    "title": "Role of pharmacogenetics and tacrolimus dosing in liver transplantation",
    "abstract": "",
    "authors_json": "[]",
    "journal": "",
    "year": "",
    "url": "",
    "pdf_sha256": "16799da5bb6b9b1432544fa7bbc7e137660df1c5cf427a48fa477fad1df775d3",
    "added_at": "2026-05-11T19:49:34.683Z",
    "updated_at": "2026-08-01T03:22:43.059Z",
    "source": "repair-empty-pdf-text",
    "wiki_status": "ready",
    "wiki_path": "KnowledgeBase/papers.md/Role_of_pharmacogenetics_and_tacrolimus_dosing_in_liver_transplantation/Role_of_pharmacogenetics_and_tacrolimus_dosing_in_live…",
    "extraction_status": "ready",
    "notes": "",
    "search_text": "role of pharmacogenetics and tacrolimus dosing in liver transplantation 10.1007/s12072-022-10437-1",
    "pmid": null,
    "pmcid": null
  },
  {
    "id": "paper-sha256-4e997d9f48125458",
    "doi": "10.1038/s41467-026-70656-0",
    "title": "Diverse organic molecules on Mars revealed by the first SAM TMAH experiment",
    "abstract": "",
    "authors_json": "[]",
    "journal": "",
    "year": "",
    "url": "",
    "pdf_sha256": "4e997d9f48125458462139d1bd98a241febe10dabb757794d94e001160418cbd",
    "added_at": "2026-05-11T19:49:34.691Z",
    "updated_at": "2026-08-01T03:22:43.081Z",
    "source": "repair-empty-pdf-text",
    "wiki_status": "ready",
    "wiki_path": "KnowledgeBase/papers.md/Diverse_organic_molecules_on_Mars_revealed_by_the_first_SAM_TMAH_experiment/Diverse_organic_molecules_on_Mars_revealed_by_the_…",
    "extraction_status": "ready",
    "notes": "",
    "search_text": "diverse organic molecules on mars revealed by the first sam tmah experiment 10.1038/s41467-026-70656-0",
    "pmid": null,
    "pmcid": null
  },
  {
    "id": "paper-sha256-d98805d7dbc7b733",
    "doi": "10.1021/acscentsci.2c01462",
    "title": "adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics",
    "abstract": "",
    "authors_json": "[]",
    "journal": "",
    "year": "",
    "url": "",
    "pdf_sha256": "d98805d7dbc7b7330356aebd097c275f5ef5c30a0ecf9280adb26c52a3bbd830",
    "added_at": "2026-05-11T19:49:48.305Z",
    "updated_at": "2026-05-11T19:56:10.018Z",
    "source": "repair-empty-pdf-text",
    "wiki_status": "ready",
    "wiki_path": "KnowledgeBase/papers.md/adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%CE%B2-strand-mimics/paper.md",
    "extraction_status": "ready",
    "notes": "",
    "search_text": "adams-et-al-2023-stretching-peptides-to-generate-small-molecule-%ce%b2-strand-mimics 10.1021/acscentsci.2c01462",
    "pmid": null,
    "pmcid": null
  }
]
```

### TestData3/Protocol/protocol.index.sqlite

#### inventory_personal (21 rows)

Columns: `zone` TEXT PRIMARY KEY, `id` TEXT PRIMARY KEY, `name` TEXT, `quantity` TEXT, `location` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[
  {
    "zone": "Room Temp",
    "id": "1774831110458-5e095a58859fd",
    "name": "sss",
    "quantity": "",
    "location": "",
    "search_text": "room temp 1774831110458-5e095a58859fd sss box81",
    "raw_json": "{\"id\":\"1774831110458-5e095a58859fd\",\"name\":\"sss\",\"type\":\"box81\",\"wells\":[\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"…"
  },
  {
    "zone": "Room Temp",
    "id": "1775091016826-2cedd14cef8f98",
    "name": "b",
    "quantity": "",
    "location": "",
    "search_text": "room temp 1775091016826-2cedd14cef8f98 b plate96",
    "raw_json": "{\"id\":\"1775091016826-2cedd14cef8f98\",\"name\":\"b\",\"type\":\"plate96\",\"wells\":[{\"name\":\"A1\",\"content\":\"\"},{\"name\":\"A2\",\"content\":\"\"},{\"name\":\"A3\",\"content\"…"
  },
  {
    "zone": "Room Temp",
    "id": "1776960456374-bbd09a27ecc2c8",
    "name": "aaaaa",
    "quantity": "",
    "location": "",
    "search_text": "room temp 1776960456374-bbd09a27ecc2c8 aaaaa customgrid",
    "raw_json": "{\"id\":\"1776960456374-bbd09a27ecc2c8\",\"name\":\"aaaaa\",\"type\":\"customGrid\",\"gridRows\":9,\"gridCols\":10,\"wells\":[{\"name\":\"W1\",\"content\":\"\"},{\"name\":\"W2\",\"c…"
  }
]
```

#### inventory_samples (0 rows)

Columns: `id` TEXT PRIMARY KEY, `code` TEXT, `name` TEXT, `sample_type` TEXT, `lot` TEXT, `concentration` TEXT, `section` TEXT, `container_id` TEXT, `container_name` TEXT, `well_index` INTEGER, `location_text` TEXT, `notes` TEXT, `chemical_links_json` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

#### notebook_index (155 rows)

Columns: `id` TEXT PRIMARY KEY, `protocol_id` TEXT, `protocol_name` TEXT, `project_id` TEXT, `project_name` TEXT, `result` TEXT, `notebook_state` TEXT, `executed_at` TEXT, `agent_draft_status` TEXT, `workflow_id` TEXT, `proposal_id` TEXT, `updated_at` TEXT, `created_at` TEXT, `linked_refs_json` TEXT.

```json
[
  {
    "id": "1780571100000-cfc684f00ab04",
    "protocol_id": "1779271200000-ea0a83f35f7b9",
    "protocol_name": "Colony PCR Screen",
    "project_id": "1780391700000-191669e62e469",
    "project_name": "CD47 VHH Blocker Campaign",
    "result": "Screened 24 colonies with the pHEN framework primers. Expected insert 420 bp.\n19 of 24 gave a clean single band at the expected size; lanes 6, 11, 14,…",
    "notebook_state": "executed",
    "executed_at": "2026-06-04T14:05:00.000Z",
    "agent_draft_status": "",
    "workflow_id": "",
    "proposal_id": "",
    "updated_at": "2026-06-04T15:05:00.000Z",
    "created_at": "2026-06-04T11:05:00.000Z",
    "linked_refs_json": "{\"assays\":[],\"gels\":[],\"files\":[]}"
  },
  {
    "id": "1780928100000-dd0bbaebf568d",
    "protocol_id": "1779278400000-5626b20123402",
    "protocol_name": "DpnI Digest and Gibson Assembly",
    "project_id": "1780391700000-191669e62e469",
    "project_name": "CD47 VHH Blocker Campaign",
    "result": "Amplified both VHH ORFs with 25 nt Gibson overlaps and assembled into the NdeI/XhoI-linearised\npET28a backbone. DpnI digest for 2 h. Assembly gave 84 …",
    "notebook_state": "executed",
    "executed_at": "2026-06-08T17:15:00.000Z",
    "agent_draft_status": "",
    "workflow_id": "",
    "proposal_id": "",
    "updated_at": "2026-06-08T18:15:00.000Z",
    "created_at": "2026-06-08T14:15:00.000Z",
    "linked_refs_json": "{\"assays\":[],\"gels\":[],\"files\":[]}"
  },
  {
    "id": "1782300300000-2fb581923e501",
    "protocol_id": "1779537600000-f49c665374a0d",
    "protocol_name": "Flow Cytometric Receptor Blocking Assay",
    "project_id": "1780391700000-191669e62e469",
    "project_name": "CD47 VHH Blocker Campaign",
    "result": "Eight-point three-fold titration from 3 uM, duplicate wells, CD47-high reporter cells.\nBiotinylated SIRPalpha-Fc at EC80 (12 nM) detected with strepta…",
    "notebook_state": "executed",
    "executed_at": "2026-06-24T14:25:00.000Z",
    "agent_draft_status": "",
    "workflow_id": "",
    "proposal_id": "",
    "updated_at": "2026-06-24T15:25:00.000Z",
    "created_at": "2026-06-24T11:25:00.000Z",
    "linked_refs_json": "{\"assays\":[\"1782315600000-5dd841e0221b2\"],\"gels\":[],\"files\":[\"flow-gating.png\"]}"
  }
]
```

#### paper_index (47 rows)

Columns: `id` TEXT PRIMARY KEY, `title` TEXT, `file_name` TEXT, `linked_type` TEXT, `linked_id` TEXT, `linked_name` TEXT, `stored_relative_path` TEXT, `availability_status` TEXT, `ingestion_status` TEXT, `summary_status` TEXT, `methods_status` TEXT, `reagents_status` TEXT, `discovered_at` TEXT, `updated_at` TEXT, `raw_json` TEXT.

```json
[
  {
    "id": "paper-h2e034d3",
    "title": "Cell based potency assays for checkpoint blocking binders",
    "file_name": "Cell-based_potency_assays_for_checkpoint-blocking_binders.pdf",
    "linked_type": "project",
    "linked_id": "1780391700000-191669e62e469",
    "linked_name": "CD47 VHH Blocker Campaign",
    "stored_relative_path": "Project/CD47_VHH_Blocker_Campaign/Papers/Cell-based_potency_assays_for_checkpoint-blocking_binders.pdf",
    "availability_status": "uploaded_pdf",
    "ingestion_status": "uploaded",
    "summary_status": "idle",
    "methods_status": "idle",
    "reagents_status": "idle",
    "discovered_at": "2026-08-28T03:30:21.058Z",
    "updated_at": "2026-08-28T03:30:21.058Z",
    "raw_json": "{\"id\":\"paper-h2e034d3\",\"title\":\"Cell based potency assays for checkpoint blocking binders\",\"fileName\":\"Cell-based_potency_assays_for_checkpoint-blocki…"
  },
  {
    "id": "paper-h30f1f4b3",
    "title": "Stability of single domain antibodies in serum",
    "file_name": "Stability_of_single-domain_antibodies_in_serum.pdf",
    "linked_type": "project",
    "linked_id": "1780391700000-191669e62e469",
    "linked_name": "CD47 VHH Blocker Campaign",
    "stored_relative_path": "Project/CD47_VHH_Blocker_Campaign/Papers/Stability_of_single-domain_antibodies_in_serum.pdf",
    "availability_status": "uploaded_pdf",
    "ingestion_status": "uploaded",
    "summary_status": "idle",
    "methods_status": "idle",
    "reagents_status": "idle",
    "discovered_at": "2026-08-28T03:30:21.274Z",
    "updated_at": "2026-08-28T03:30:21.274Z",
    "raw_json": "{\"id\":\"paper-h30f1f4b3\",\"title\":\"Stability of single domain antibodies in serum\",\"fileName\":\"Stability_of_single-domain_antibodies_in_serum.pdf\",\"pdfD…"
  },
  {
    "id": "paper-h2d4bcd07",
    "title": "Calibration buffers for free calcium titrations",
    "file_name": "Calibration_buffers_for_free_calcium_titrations.pdf",
    "linked_type": "project",
    "linked_id": "1781085600000-b1ac44e3e8ab9",
    "linked_name": "cpGFP Calcium Biosensor Engineering",
    "stored_relative_path": "Project/cpGFP_Calcium_Biosensor_Engineering/Papers/Calibration_buffers_for_free_calcium_titrations.pdf",
    "availability_status": "uploaded_pdf",
    "ingestion_status": "uploaded",
    "summary_status": "idle",
    "methods_status": "idle",
    "reagents_status": "idle",
    "discovered_at": "2026-08-28T03:30:21.488Z",
    "updated_at": "2026-08-28T03:30:21.488Z",
    "raw_json": "{\"id\":\"paper-h2d4bcd07\",\"title\":\"Calibration buffers for free calcium titrations\",\"fileName\":\"Calibration_buffers_for_free_calcium_titrations.pdf\",\"pd…"
  }
]
```

#### protocol_index (54 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `category` TEXT, `description` TEXT, `tags_json` TEXT, `linked_project` TEXT, `step_count` INTEGER, `steps_preview_json` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "1779357600000-dd0869fc456a1",
    "name": "Agarose Gel Electrophoresis of DNA",
    "category": "Analysis",
    "description": "Resolve DNA fragments on an agarose gel and document the result.",
    "tags_json": "[\"Analysis\",\"bench\"]",
    "linked_project": "",
    "step_count": 5,
    "steps_preview_json": "[\"Melt {{ph:1779357600000-f0c0e541d32a}} agarose in {{ph:1779357600000-cde33d12dd92}} 1x TAE to cast a {{ph:1779357600000-c40600d82e72}}% gel.\",\"Cool …",
    "updated_at": "2026-06-05T10:00:00.000Z"
  },
  {
    "id": "1774024745003-46df848e78c068",
    "name": "Avi-Tag Protein Biotinylation",
    "category": "",
    "description": "Biotinylate an Avi-tagged protein for downstream binding assays or immobilization.",
    "tags_json": "[]",
    "linked_project": "",
    "step_count": 4,
    "steps_preview_json": "[\"Prepare the biotinylation reaction by combining {{ph:1774024745003-093192d094133}} of Avi-tagged protein, {{ph:1774024745003-fbbbfbaa73e5b}} of BirA…",
    "updated_at": "2026-03-20T16:39:05.003Z"
  },
  {
    "id": "1774024047007-d137dae96cab78",
    "name": "BL21(DE3) Chemical Transformation with pET28a",
    "category": "",
    "description": "Introduce a plasmid into BL21(DE3) competent E. coli cells for protein expression.",
    "tags_json": "[]",
    "linked_project": "",
    "step_count": 7,
    "steps_preview_json": "[\"Thaw 1 tube of BL21(DE3) competent cells on ice.\",\"Add 200ng of {{ph:1774125436234-cac9aa958fe75}} DNA to the cells and gently flick to mix.\",\"Incub…",
    "updated_at": "2026-03-21T20:37:16.234Z"
  }
]
```

#### record_index (285 rows)

Columns: `record_type` TEXT PRIMARY KEY, `record_id` TEXT PRIMARY KEY, `raw_json` TEXT.

```json
[
  {
    "record_type": "notebook",
    "record_id": "1780571100000-cfc684f00ab04",
    "raw_json": "{\"id\":\"1780571100000-cfc684f00ab04\",\"notebookType\":\"biology\",\"projectId\":\"1780391700000-191669e62e469\",\"projectName\":\"CD47 VHH Blocker Campaign\",\"prot…"
  },
  {
    "record_type": "notebook",
    "record_id": "1780928100000-dd0bbaebf568d",
    "raw_json": "{\"id\":\"1780928100000-dd0bbaebf568d\",\"notebookType\":\"biology\",\"projectId\":\"1780391700000-191669e62e469\",\"projectName\":\"CD47 VHH Blocker Campaign\",\"prot…"
  },
  {
    "record_type": "notebook",
    "record_id": "1782300300000-2fb581923e501",
    "raw_json": "{\"id\":\"1782300300000-2fb581923e501\",\"notebookType\":\"biology\",\"projectId\":\"1780391700000-191669e62e469\",\"projectName\":\"CD47 VHH Blocker Campaign\",\"prot…"
  }
]
```

### TestData3/SequenceViewer/sequence-library.sqlite

#### sequence_entries (25 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `normalized_name` TEXT, `status` TEXT, `source_format` TEXT, `topology` TEXT, `sequence_length` INTEGER, `feature_count` INTEGER, `feature_index_version` INTEGER, `gbk_rel_path` TEXT, `html_rel_path` TEXT, `folder_id` TEXT, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "seq_1788285155838_b8b6ad74",
    "name": "ISG15",
    "normalized_name": "isg15",
    "status": "temporary",
    "source_format": "genbank",
    "topology": "circular",
    "sequence_length": 5754,
    "feature_count": 16,
    "feature_index_version": 1,
    "gbk_rel_path": "entries/seq_1788285155838_b8b6ad74/ISG15.gbk",
    "html_rel_path": "",
    "folder_id": "",
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  },
  {
    "id": "seq_1777330639992_c41eb584",
    "name": "CZ013_pFUSE-PD-1",
    "normalized_name": "cz013_pfuse-pd-1",
    "status": "saved",
    "source_format": "genbank",
    "topology": "circular",
    "sequence_length": 4713,
    "feature_count": 30,
    "feature_index_version": 1,
    "gbk_rel_path": "entries/seq_1777330639992_c41eb584/CZ013_pFUSE-PD-1.gbk",
    "html_rel_path": "",
    "folder_id": "seq_folder_1788362725296_ad0d64f9",
    "created_at": "2026-04-27T22:57:20.983Z",
    "updated_at": "2026-09-04T01:36:53.483Z"
  },
  {
    "id": "seq_1777330646329_c7870978",
    "name": "pET28a-His-sfGFP",
    "normalized_name": "pet28a-his-sfgfp",
    "status": "saved",
    "source_format": "genbank",
    "topology": "circular",
    "sequence_length": 6389,
    "feature_count": 46,
    "feature_index_version": 1,
    "gbk_rel_path": "entries/seq_1777330646329_c7870978/pET28a-His-sfGFP.gbk",
    "html_rel_path": "",
    "folder_id": "",
    "created_at": "2026-08-25T04:56:00.324Z",
    "updated_at": "2026-08-25T04:56:00.324Z"
  }
]
```

#### sequence_feature_cds_sequences (39 rows)

Columns: `feature_id` TEXT PRIMARY KEY, `dna_sequence` TEXT, `dna_length` INTEGER, `amino_acid_sequence` TEXT, `amino_acid_length` INTEGER, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "feature_id": "feature_c02e9ae28a301d7192cc3dfc",
    "dna_sequence": "GGTCTGAACGATATCTTCGAAGCTCAGAAAATCGAATGGCACGAA",
    "dna_length": 45,
    "amino_acid_sequence": "GLNDIFEAQKIEWHE",
    "amino_acid_length": 15,
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.856Z"
  },
  {
    "feature_id": "feature_a087c7c9e87ea8fdc7f6c35e",
    "dna_sequence": "ATGGCCAAGTTGACCAGTGCCGTTCCGGTGCTCACCGCGCGCGACGTCGCCGGAGCGGTCGAGTTCTGGACCGACCGGCTCGGGTTCTCCCGGGACTTCGTGGAGGACGACTTCGCCGGTGTGGTCCGGGACGACGTGACCCTGTTCATC…",
    "dna_length": 375,
    "amino_acid_sequence": "MAKLTSAVPVLTARDVAGAVEFWTDRLGFSRDFVEDDFAGVVRDDVTLFISAVQDQVVPDNTLAWVWVRGLDELYAEWSEVVSTNFRDASGPAMTEIGEQPWGREFALRDPAGNCVHFVAEEQD",
    "amino_acid_length": 124,
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.923Z"
  },
  {
    "feature_id": "feature_2f323660bfe773c04e754c5a",
    "dna_sequence": "TTCTTAGACTCCCCAGACAGGCCCTGGAACCCCCCCACCTTCTCCCCAGCCCTGCTCGTGGTGACCGAAGGGGACAACGCCACCTTCACCTGCAGCTTCTCCAACACATCGGAGAGCTTCGTGCTAAACTGGTACCGCATGAGCCCCAGC…",
    "dna_length": 504,
    "amino_acid_sequence": "FLDSPDRPWNPPTFSPALLVVTEGDNATFTCSFSNTSESFVLNWYRMSPSNQTDKLAAFPEDRSQPGQDCRFRVTQLPNGRDFHMSVVRARRNDSGTYLCGAISLAPKAQIKESLRAELRVTERRAEVPTAHPSPSPRPAGQFQTLVGGS…",
    "amino_acid_length": 168,
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.856Z"
  }
]
```

#### sequence_feature_occurrences (684 rows)

Columns: `id` TEXT PRIMARY KEY, `feature_id` TEXT, `host_vector_id` TEXT, `host_vector_name` TEXT, `host_vector_status` TEXT, `host_topology` TEXT, `host_sequence_length` INTEGER, `source_format` TEXT, `annotation_source` TEXT, `strand` INTEGER, `start_pos` INTEGER, `end_pos` INTEGER, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "feature_occurrence_95cd7343fc06c5ea1ece1497",
    "feature_id": "feature_447afdd136f5da0aca4187ff",
    "host_vector_id": "seq_1788285155838_b8b6ad74",
    "host_vector_name": "ISG15",
    "host_vector_status": "temporary",
    "host_topology": "circular",
    "host_sequence_length": 5754,
    "source_format": "genbank",
    "annotation_source": "genbank",
    "strand": 1,
    "start_pos": 1,
    "end_pos": 28,
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  },
  {
    "id": "feature_occurrence_5cd3de2536a7607336f58df9",
    "feature_id": "feature_e8e60c5c8db5264766e00a0a",
    "host_vector_id": "seq_1788285155838_b8b6ad74",
    "host_vector_name": "ISG15",
    "host_vector_status": "temporary",
    "host_topology": "circular",
    "host_sequence_length": 5754,
    "source_format": "genbank",
    "annotation_source": "genbank",
    "strand": 1,
    "start_pos": 1,
    "end_pos": 521,
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  },
  {
    "id": "feature_occurrence_55f11320db92b2c924b6c6e5",
    "feature_id": "feature_6f4a3f02fb4719c3b597cfaf",
    "host_vector_id": "seq_1788285155838_b8b6ad74",
    "host_vector_name": "ISG15",
    "host_vector_status": "temporary",
    "host_topology": "circular",
    "host_sequence_length": 5754,
    "source_format": "genbank",
    "annotation_source": "genbank",
    "strand": 1,
    "start_pos": 522,
    "end_pos": 5754,
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  }
]
```

#### sequence_feature_proteins (39 rows)

Columns: `feature_id` TEXT PRIMARY KEY, `protein_sequence` TEXT, `protein_length` INTEGER, `translation_source` TEXT, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "feature_id": "feature_cdc03411506142bbb6f9f341",
    "protein_sequence": "MYRMQLLSCIALSLALVTNS",
    "protein_length": 20,
    "translation_source": "qualifier",
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.856Z"
  },
  {
    "feature_id": "feature_2f323660bfe773c04e754c5a",
    "protein_sequence": "FLDSPDRPWNPPTFSPALLVVTEGDNATFTCSFSNTSESFVLNWYRMSPSNQTDKLAAFPEDRSQPGQDCRFRVTQLPNGRDFHMSVVRARRNDSGTYLCGAISLAPKAQIKESLRAELRVTERRAEVPTAHPSPSPRPAGQFQTLVGGS…",
    "protein_length": 168,
    "translation_source": "qualifier",
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.856Z"
  },
  {
    "feature_id": "feature_25d0d97c2132381371bf67c6",
    "protein_sequence": "FLDSPDRPWNPPTFSPALLVVTEGDNATFTCSFSNTSESFVLNWYRMSPSNQTDKLAAFPEDRSQPGQDCRFRVTQLPNGRDFHMSVVRARRNDSGTYLCGAISLAPKAQIKESLRAELRVTERRAEVPTAHPSPSPRPAGQFQTLV",
    "protein_length": 147,
    "translation_source": "qualifier",
    "created_at": "2026-09-01T17:52:35.856Z",
    "updated_at": "2026-09-01T17:52:35.856Z"
  }
]
```

#### sequence_features (248 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `normalized_name` TEXT, `feature_type` TEXT, `sequence` TEXT, `sequence_length` INTEGER, `dedupe_key` TEXT, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "feature_447afdd136f5da0aca4187ff",
    "name": "source",
    "normalized_name": "source",
    "feature_type": "source",
    "sequence": "ACTACAAAGACGATGATGACAAAGCTGC",
    "sequence_length": 28,
    "dedupe_key": "67dadd9e3db8b6c4a5cd13801f021bd6e32f08c4",
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  },
  {
    "id": "feature_e8e60c5c8db5264766e00a0a",
    "name": "misc_feature_",
    "normalized_name": "misc_feature_",
    "feature_type": "misc_feature",
    "sequence": "ACTACAAAGACGATGATGACAAAGCTGCAATGGGCTGGGACCTGACTGTCAAGATGCTGGCAGGTAACGAGTTTCAGGTTAGCCTGAGCAGCAGCATGAGCGTGAGCGAGCTGAAAGCTCAGATTACTCAGAAGATTGGTGTCCACGCCT…",
    "sequence_length": 521,
    "dedupe_key": "402a6248ba28cc8388b4ab0209f273206605a540",
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-01T17:52:35.839Z"
  },
  {
    "id": "feature_6f4a3f02fb4719c3b597cfaf",
    "name": "misc_feature_",
    "normalized_name": "misc_feature_",
    "feature_type": "misc_feature",
    "sequence": "CTCGAGCACCACCACCACCACCACTGAGATCCGGCTGCTAACAAAGCCCGAAAGGAAGCTGAGTTGGCTGCTGCCACCGCTGAGCAATAACTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTGCTGAAAGGAGGA…",
    "sequence_length": 5233,
    "dedupe_key": "39724f7563296ce811ae927a8bd4e8f724c201a1",
    "created_at": "2026-09-01T17:52:35.839Z",
    "updated_at": "2026-09-09T22:31:01.833Z"
  }
]
```

#### sequence_folders (14 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `normalized_name` TEXT, `created_at` TEXT, `updated_at` TEXT.

```json
[
  {
    "id": "seq_folder_1788362725296_ad0d64f9",
    "name": "New Folder",
    "normalized_name": "new folder",
    "created_at": "2026-09-02T15:25:25.307Z",
    "updated_at": "2026-09-02T15:25:25.307Z"
  },
  {
    "id": "project:project_folder_cd19_car_binder_optimization",
    "name": "CD19 CAR Binder Optimization",
    "normalized_name": "cd19 car binder optimization",
    "created_at": "2026-09-06T03:06:36.780Z",
    "updated_at": "2026-09-06T03:06:36.780Z"
  },
  {
    "id": "project:1780391700000-191669e62e469",
    "name": "CD47 VHH Blocker Campaign",
    "normalized_name": "cd47 vhh blocker campaign",
    "created_at": "2026-09-06T03:06:36.780Z",
    "updated_at": "2026-09-06T03:06:36.780Z"
  }
]
```

### TestData3/TestData4/Protocol/protocol.index.sqlite

#### inventory_personal (0 rows)

Columns: `zone` TEXT PRIMARY KEY, `id` TEXT PRIMARY KEY, `name` TEXT, `quantity` TEXT, `location` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

#### inventory_samples (0 rows)

Columns: `id` TEXT PRIMARY KEY, `code` TEXT, `name` TEXT, `sample_type` TEXT, `lot` TEXT, `concentration` TEXT, `section` TEXT, `container_id` TEXT, `container_name` TEXT, `well_index` INTEGER, `location_text` TEXT, `notes` TEXT, `chemical_links_json` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

#### notebook_index (0 rows)

Columns: `id` TEXT PRIMARY KEY, `protocol_id` TEXT, `protocol_name` TEXT, `project_id` TEXT, `project_name` TEXT, `result` TEXT, `notebook_state` TEXT, `executed_at` TEXT, `agent_draft_status` TEXT, `workflow_id` TEXT, `proposal_id` TEXT, `updated_at` TEXT, `created_at` TEXT, `linked_refs_json` TEXT, `search_text` TEXT.

```json
[]
```

#### paper_index (0 rows)

Columns: `id` TEXT PRIMARY KEY, `title` TEXT, `file_name` TEXT, `linked_type` TEXT, `linked_id` TEXT, `linked_name` TEXT, `stored_relative_path` TEXT, `availability_status` TEXT, `ingestion_status` TEXT, `summary_status` TEXT, `methods_status` TEXT, `reagents_status` TEXT, `discovered_at` TEXT, `updated_at` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

#### protocol_index (0 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `category` TEXT, `description` TEXT, `tags_json` TEXT, `linked_project` TEXT, `step_count` INTEGER, `steps_preview_json` TEXT, `search_text` TEXT, `updated_at` TEXT.

```json
[]
```

#### record_index (0 rows)

Columns: `record_type` TEXT PRIMARY KEY, `record_id` TEXT PRIMARY KEY, `title` TEXT, `project_id` TEXT, `project_name` TEXT, `summary` TEXT, `linked_protocol_id` TEXT, `linked_protocol_name` TEXT, `updated_at` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

### TestData3/TestData4/Workflow/workflow-status.sqlite

#### workflow_runs (0 rows)

Columns: `id` TEXT PRIMARY KEY, `template_id` TEXT, `template_name` TEXT, `name` TEXT, `description` TEXT, `project_id` TEXT, `project_name` TEXT, `folder_name` TEXT, `relative_folder_path` TEXT, `overall_status` TEXT, `percent_complete` INTEGER, `completed_steps` INTEGER, `total_steps` INTEGER, `notebook_count` INTEGER, `paper_count` INTEGER, `result_file_count` INTEGER, `updated_at` TEXT, `created_at` TEXT, `raw_json` TEXT.

```json
[]
```

#### workflow_step_status (0 rows)

Columns: `workflow_id` TEXT PRIMARY KEY, `entry_id` TEXT PRIMARY KEY, `block_id` TEXT PRIMARY KEY, `entry_name` TEXT, `block_name` TEXT, `status` TEXT, `notebook_entry_id` TEXT, `values_json` TEXT, `result_files_json` TEXT, `assay_ids_json` TEXT, `gel_analysis_ids_json` TEXT, `completed_at` TEXT, `updated_at` TEXT.

```json
[]
```

#### workflow_templates (0 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `description` TEXT, `folder_name` TEXT, `relative_folder_path` TEXT, `updated_at` TEXT, `created_at` TEXT, `raw_json` TEXT.

```json
[]
```

### TestData3/TestData4/hikari-chemicals.index.sqlite

#### inventory_chemicals (0 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `amount` TEXT, `cas` TEXT, `location` TEXT, `supplier` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[]
```

#### inventory_meta (4 rows)

Columns: `key` TEXT PRIMARY KEY, `value_json` TEXT.

```json
[
  {
    "key": "lab_blocks",
    "value_json": "[]"
  },
  {
    "key": "lab_last_location_number",
    "value_json": "0"
  },
  {
    "key": "lab_location_code_map",
    "value_json": "{}"
  }
]
```

### TestData3/Workflow/workflow-status.sqlite

#### workflow_runs (10 rows)

Columns: `id` TEXT PRIMARY KEY, `relative_folder_path` TEXT, `raw_json` TEXT.

```json
[
  {
    "id": "1776270538561-6c07e18af542f",
    "relative_folder_path": "NiNTA__1776270512198-af3480c2ef55c8/NiNTA_1__1776270538561-6c07e18af542f",
    "raw_json": "{\"id\":\"1776270538561-6c07e18af542f\",\"templateId\":\"1776270512198-af3480c2ef55c8\",\"name\":\"NiNTA 1\",\"description\":\"\",\"projectId\":\"\",\"notebookEntryIds\":[\"…"
  },
  {
    "id": "1778262694218-ff48770da4f03",
    "relative_folder_path": "NiNTA__1776270512198-af3480c2ef55c8/NiNTA_2__1778262694218-ff48770da4f03",
    "raw_json": "{\"id\":\"1778262694218-ff48770da4f03\",\"templateId\":\"1776270512198-af3480c2ef55c8\",\"name\":\"NiNTA 2\",\"description\":\"\",\"projectId\":\"\",\"notebookEntryIds\":[\"…"
  },
  {
    "id": "1782246245375-9fad20fbec2dd",
    "relative_folder_path": "Make__1782246238284-5ac6aa16a37cf8/Make_1__1782246245375-9fad20fbec2dd",
    "raw_json": "{\"id\":\"1782246245375-9fad20fbec2dd\",\"templateId\":\"1782246238284-5ac6aa16a37cf8\",\"name\":\"Make 1\",\"description\":\"\",\"projectId\":\"\",\"notebookEntryIds\":[\"1…"
  }
]
```

#### workflow_templates (6 rows)

Columns: `id` TEXT PRIMARY KEY, `raw_json` TEXT.

```json
[
  {
    "id": "1776270512198-af3480c2ef55c8",
    "raw_json": "{\"id\":\"1776270512198-af3480c2ef55c8\",\"name\":\"NiNTA\",\"description\":\"\",\"projectId\":\"\",\"blocks\":[{\"id\":\"1776270449257-17e473bb99632\",\"type\":\"protocol\",\"p…"
  },
  {
    "id": "1777764556913-1c5e79ecfdf6d8",
    "raw_json": "{\"id\":\"1777764556913-1c5e79ecfdf6d8\",\"name\":\"grdr\",\"description\":\"\",\"projectId\":\"\",\"blocks\":[{\"id\":\"1777764548664-4d16b003042ba8\",\"type\":\"protocol\",\"p…"
  },
  {
    "id": "1782246238284-5ac6aa16a37cf8",
    "raw_json": "{\"id\":\"1782246238284-5ac6aa16a37cf8\",\"name\":\"Make\",\"description\":\"\",\"projectId\":\"\",\"blocks\":[{\"id\":\"1782246198100-5f3a749e2e436\",\"type\":\"protocol\",\"pr…"
  }
]
```

### TestData3/hikari-chemicals.index.sqlite

#### inventory_chemicals (1130 rows)

Columns: `id` TEXT PRIMARY KEY, `name` TEXT, `amount` TEXT, `cas` TEXT, `location` TEXT, `supplier` TEXT, `search_text` TEXT, `raw_json` TEXT.

```json
[
  {
    "id": "1773447874677-dfc59d46b472a",
    "name": "Acetic Acid",
    "amount": "",
    "cas": "64-19-7",
    "location": "Acid Cabinet C1",
    "supplier": "",
    "search_text": "1773447874677-dfc59d46b472a acetic acid 64-19-7 acid cabinet c1",
    "raw_json": "{\"id\":\"1773447874677-dfc59d46b472a\",\"name\":\"Acetic Acid\",\"casNumber\":\"64-19-7\",\"location\":\"Acid Cabinet C1\",\"locationNumber\":589026,\"vendor\":\"\",\"catal…"
  },
  {
    "id": "1773447852041-591a6d4e722738",
    "name": "Ethanol",
    "amount": "",
    "cas": "64-17-5",
    "location": "Flammables Cabinet B2",
    "supplier": "",
    "search_text": "1773447852041-591a6d4e722738 ethanol 64-17-5 flammables cabinet b2",
    "raw_json": "{\"id\":\"1773447852041-591a6d4e722738\",\"name\":\"Ethanol\",\"casNumber\":\"64-17-5\",\"location\":\"Flammables Cabinet B2\",\"locationNumber\":100430,\"vendor\":\"\",\"ca…"
  },
  {
    "id": "1773447836484-1ebf227e69da9",
    "name": "Sodium Chloride",
    "amount": "",
    "cas": "7647-14-5",
    "location": "Shelf A1",
    "supplier": "",
    "search_text": "1773447836484-1ebf227e69da9 sodium chloride 7647-14-5 shelf a1",
    "raw_json": "{\"id\":\"1773447836484-1ebf227e69da9\",\"name\":\"Sodium Chloride\",\"casNumber\":\"7647-14-5\",\"location\":\"Shelf A1\",\"locationNumber\":681675,\"vendor\":\"\",\"catalo…"
  }
]
```

#### inventory_meta (4 rows)

Columns: `key` TEXT PRIMARY KEY, `value_json` TEXT.

```json
[
  {
    "key": "lab_blocks",
    "value_json": "[{\"index\":1,\"timestamp\":\"2026-03-11T02:43:02.647Z\",\"action\":\"UPSERT_CHEMICAL\",\"prevHash\":\"GENESIS\",\"payload\":{\"chemicalId\":\"1773196982647-34b6863fed36…"
  },
  {
    "key": "lab_last_location_number",
    "value_json": "999776"
  },
  {
    "key": "lab_location_code_map",
    "value_json": "{\"acid cabinet c1\":\"M\",\"flammables cabinet b2\":\"F\",\"shelf a1\":\"A\",\"shelf b pos 32\":\"D\",\"fridge 4c pos 18\":\"E\",\"flammables cabinet pos 49\":\"F\",\"bench p…"
  }
]
```
