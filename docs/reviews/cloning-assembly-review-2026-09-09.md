# Cloning review — 2026-09-09

Assembly fixes are implemented. Mutagenesis was reviewed without changing its algorithms. The workspace already contained cloning and mutagenesis edits; those were preserved.

## Design model

The ordered fragments describe the intended assembled sequence. Junction sequences come from those boundaries. Primer annealing regions and junction overlaps have separate Tm constraints, and each complete oligo must fit its length budget, including tags, linkers, and enzyme tails. This distinction agrees with [NEB's Gibson primer-design guidance](https://www.neb.com/en/-/media/nebus/files/manuals/manuale2611_e5510.pdf), which separates the gene-specific annealing portion from the assembly overlap.

The chosen backbone and donor remain the source of template identity. Automatic backbone ranking against stock sequences was removed. Arbitrary longest-common-block matching was replaced with a bounded check for terminal additions against the chosen template. This retains necessary handling of primer-encoded tags, reverse-strand features, and circular origins without letting an unrelated internal stock match redefine the fragment.

A chosen template is not proof that every desired block is physically present. Existing donor-mismatch warnings, repeat checks, and explicit synthesis labels remain. Product-geometry validation does not claim experimental PCR validation of a missing or mismatched donor.

## Fixed assembly defects

| Defect | Resulting behavior |
| --- | --- |
| Multiple stocks could be ranked to choose a backbone implicitly; a missing requested ID could leave an insert-only design. | One supplied backbone is accepted; otherwise an available backbone must be explicitly selected. Unselected stock ambiguity no longer blocks the plan. |
| Gibson evaluation rebuilt its own fragment list and discarded backbone metadata or explicitly supplied backbone fragments. | Evaluation and primer design use the same ordered fragment map, retaining chosen-template specificity metadata. |
| Overlap selection ignored primer-encoded tag/linker additions and tried only one-sided or half-and-half tails. | The search includes existing additions in both oligo budgets, checks both annealing windows, and searches every split if the original one-sided design fails. |
| The overlap minimum was clamped down to the available maximum. | An impossible requested minimum fails instead of silently producing shorter overlaps. |
| Primer fallback reused previously evaluated junctions. | Each threshold level recomputes junction geometry; the final primer, junction, and procedure summaries refer to the same selected design. |
| A weak declared overlap was treated as two disjoint fragments when engineering a new overlap. | The route requests adjusted boundaries rather than duplicating the shared region. |
| Gibson could report an unrelated requested result without verifying its fragment order. | Ordered fragments must reconstruct the supplied result; circular products permit rotation. Duplicate fragment IDs and empty fragments are rejected. |
| Donor matching missed origin-spanning inserts or inferred huge tails from arbitrary internal matches. | Circular matching works on either strand, including short terminal additions; arbitrary internal similarity does not change primer geometry. |

Code owners: `cloning-assembly/assembly-plan.js`, `primer-design.js`, `assembly-primers.js`, `overlap-evaluation.js`, `overlap-windows.js`, `primer-records.js`, and `host-vector-selection.js` under `src/renderer/modules/sequence-viewer/`.

## Mutagenesis finding — review only

**[P1] Q5/KLD can approve a result its primers do not produce.** In `q5-kld-mutagenesis.js:52-87`, the complete requested `editedSequence` is used for its length and ambiguity checks, while primer design uses only `editRequest`. There is no comparison between the requested result and the sequence produced by applying that edit to the original template.

Reproduced with a deterministic 900 bp circular template: request a substitution at position 301 in `editRequest`, but pass a complete result containing substitutions at positions 301 and 601. The function returns `feasible: true` and two primers that introduce only the position-301 substitution. This can occur with a stale edit description accompanying a newer result record. A future fix should reconstruct the requested edit product, compare it with the complete result, and reject inconsistent inputs before reporting success.

The Q5/KLD route otherwise models divergent primers and split 5′ additions, consistent with the [NEB back-to-back primer requirement](https://www.neb.com/en-us/faqs/how-do-i-design-primers-to-use-with-the-q5-site-directed-mutagenesis-kit). Its Tm values are Hikari estimates, not a reproduction of NEBaseChanger's polymerase-specific annealing-temperature calculation.

No edits were made to `mutagenesis-simple.js`, `mutagenesis.js`, `q5-kld-mutagenesis.js`, `site-mutagenesis-evaluation.js`, `edit-map.js`, or `strategy.js`; their contents were checked against hashes recorded at the start of this review. This preserves the pre-existing mutagenesis modifications.

## Validation

- Before changes: focused cloning/primer/builder suite, **248/248** passed.
- After changes: same suite, **248/248** passed.
- New `tests/cloning-assembly-product-selfcheck.mjs`: **10/10** passed, including exact amplicon/product reconstruction, asymmetric tag tails, actual strict-to-relaxed fallback, donor-origin handling, and explicit host selection.
- `tests/cloning-donor-strand-selfcheck.mjs`: passed.
- `tests/sequence-mcp-selfcheck.cjs`: **13/13** passed.
- ESLint on the changed assembly source files and new regression file: passed.
- `git diff --check`: passed.
- Repository-wide lint has an unrelated existing failure at `src/renderer/modules/biology-notebook/notebook/viewer-render.js:38`: unused `getEditingEntryId`. That file was not changed.

This was source and functional validation. No UI changes, packaged-app rebuild, wet-lab validation, or full repository test run were performed.
