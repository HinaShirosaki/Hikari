# Primer design and template review

Use the derivative's recorded source and edits. `sequence_mutagenesis_primers` compares the existing cloning routes; it does not invent the requested mutation, order oligos, or establish that a designed plasmid has been made.

## Inputs and applicability

1. Read the derivative's current `entry_id` and `revision`. A source entry without recorded DNA edits, or an annotation-only derivative, can return `no_feasible_design` without route plans.
2. Leave `methods` omitted to compare all current routes. Restrict it only when the user specifies a route or constraints that justify the restriction.
3. Supply `donor` only when an actual source template is identified. Resolve its entry/revision/feature reference; do not pass a filename or substitute the desired product sequence as an available donor. The referenced donor record is used as the physical specificity template.
4. If the derivative changed after its recorded edit, respect `stale_design`. A reread supplies the current revision but does not repair missing edit history. Recreate the desired derivative from a valid recorded source/design if the user authorized it; otherwise explain the provenance gap.

## Read the response at three levels

**Comparison:** `status`, `recommended_method`, `ranking_reason`, and top-level warnings. `ok: true` can accompany `no_feasible_design`; that means the comparison completed, not that a cloning route is ready.

**Route:** `method`, `feasible`, `stage_count`, `edit_site_count`, `primer_count`, `warning_count`, `stages`. In the current implementation, edits are processed separately in sequential stages. Two-step ligation and overlap-extension have additional method stages, so `stage_count` can exceed `edit_site_count`.

**Stage and primer:** `feasible`, `product_matches`, `product_validation`, `template_kind`, warnings; each primer's `sequence`, annealing/tail fields, `template_id`, `template_kind`, `binding_verified`, Tm and quality warnings. Use the actual returned oligo sequence if reporting primers; do not reconstruct it by concatenating the displayed fields for complementary mutagenesis primers, whose annealing arms can be split around the edit.

A recommended route must be feasible across every stage. Product matching covers the complete desired plasmid, not just the mutated codon. The implementation checks Q5 primer reconstruction, complementary whole-plasmid mutagenesis primers, PCR fragment coverage for assembly, and amplified fragment plus retained source backbone for restriction routes. Binding specificity must be evaluated against the stated source template, including its topology. A favorable Tm alone does not prove specificity or complete-product correctness.

## Keep physical provenance explicit

| Evidence | How to describe it |
| --- | --- |
| Original source/donor identified as supplied | Source template for that reaction; do not infer stock quantity or experimental verification |
| `template_id` such as `intermediate_1`, a later-stage template, or a derived source marked hypothetical | Hypothetical intermediate until the preceding stage is made and verified |
| Insert has no physical template and the route asks for a donor/synthesis | Missing template; a donor or synthesis fragment still needs to be supplied |
| A Protein Builder construct or temporary edited entry exists in the library | Persistent digital design; its presence alone does not make it a physical template |

Cross-check per-primer labels with the enclosing stage and template identity. A later-stage intermediate cannot become a supplied physical template merely because one primer object says `supplied_template`. For that known inconsistency, treat availability conservatively, mention the inconsistency if it affects the plan, and keep the intermediate requirement in the user-facing answer. See the dated compatibility note in [errors-and-compatibility.md](errors-and-compatibility.md).

If the user explicitly says a previously designed intermediate now exists physically, distinguish that statement from the tool's recorded hypothetical provenance. There is no `template_is_physical` argument in this contract. Do not fabricate one or edit stored metadata to make the label agree.

Do not silently combine distant changes into one single-site primer design. The currently returned multistage comparison is a computational route proposal, not an assertion that a multiplex or one-pot reaction will install every edit. Every later stage needs its preceding intermediate.

## Ranking and recommendations

The default order is:

1. Feasible routes first.
2. Fewer required stages.
3. Fewer primers.
4. Fewer quality warnings.
5. Existing strategy order as a tie-breaker.

Explain the factors that actually decided the returned recommendation. Do not claim the selected route is cheapest, fastest in calendar time, highest-yielding, or best experimentally unless separate evidence supports that claim. Preserve user constraints when they favor another feasible route; state the tradeoff using returned counts/warnings.

Typical report: “The temporary E45G/indel derivative is available. Whole-plasmid PCR is the returned recommendation: three stages and six primers. Stages 2 and 3 require intermediates produced by the preceding reactions. Review the reported dimer warnings in Open Primer Design.” Use this pattern only when those facts appear in the actual response.

## No feasible design or incomplete evidence

Keep the derivative and explain route-specific failures: missing donor, insufficient binding window, ambiguous bases, internal restriction sites, nonunique binding, or failed full-product reconstruction. Do not turn `no_feasible_design` into a fabricated primer list. If a supplied donor or a user-approved boundary change would resolve the specific obstacle, state that next step; do not mutate the sequence merely to make a method appear feasible.

Saved comparisons reopen through the returned Open Primer Design action. The action opens the saved comparison; it is not proof the screen has already opened. Source changes can make saved designs stale. User UI save and primer ordering remain separate actions outside these tools.
