---
name: "hikari-protocol-generation"
description: "Use Hikari MCP protocol_generation to normalize complete protocol JSON and queue protocol saves for user approval."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:protocol-generation -->

# Hikari Protocol Generation MCP

Use this skill when the user asks Codex to prepare, normalize, add, save, or import a wet-lab protocol for Hikari.
Also use it when the user asks to turn paper methods, selected paper text, local records, or a draft procedure into a Protocols-module candidate.

Direct tool:

- Call the direct Hikari MCP tool `protocol_generation`.

Quality bar: a competent lab member who has not read the source should be able to run the protocol at the bench tomorrow without asking a follow-up question.

Protocol JSON checklist:

- `protocol.name`: concise specific title naming the procedure and its system, such as `PD-L1 surface staining by flow cytometry (HEK293 stable line)`.
- `protocol.purpose`: one or two sentences giving the biological system, what is measured, and the decision the result supports.
- `protocol.materials`: array of short item strings covering reagents, samples, strains, plasmids, cell lines, buffers, controls, and result-determining equipment such as plate format, column, or filter set. Carry the attribute the steps depend on: working or stock concentration, buffer composition, grade, clone, or host. Every reagent used in a step appears here, and every listed item is used by a step.
- `protocol.steps`: ordered array of strings or step objects, one operation per step, as many steps as the procedure genuinely needs. Do not merge several operations into one step or split one action across several.
- `protocol.troubleshooting`: one plain-text block, written as labeled lines so it stays readable after normalization: `Expected outcome:`, `Quality checks:`, `Starting defaults:` (each conventional value you chose and why), `Failure modes:` (symptom then corrective action), `Safety:`, `Source limitations:`. Omit a label with nothing real to report.
- `result_summary`: one sentence describing what was prepared.
- `save: true`: include this when the user asks to add, save, import, persist, or queue the generated protocol for review.

Step writing:

- Every step carries its own numbers: volume, concentration, time, temperature, centrifugation as `x g` rather than rpm, pH, plate or tube format, replicate count.
- Follow the real run order: reagent and sample preparation, setup, incubation and processing, readout, analysis. Mark day boundaries and safe hold points inline, such as `hold the pellet at -20 C overnight before step 9`.
- Name each control next to the sample it controls, with its own volumes and treatment: untreated or vehicle, isotype or no-primary, positive reference, and blank where the readout needs one.
- Give every readout, checkpoint, and QC step its acceptance criterion or expected observation, such as `expect A260/A280 of 1.8-2.0; re-purify below 1.7`.
- No vague direction: never `as appropriate`, `if needed`, or `optimize as required` without the value or the criterion that resolves it.
- Use SI units with a space before the unit, and write a dilution together with the resulting working concentration, such as `1:1000 (final 1 ug/mL)`.
- State the hazard and its control in the step that creates it, such as BSL-2 handling, fume-hood use for phenol or chloroform, UV shielding, or concentrated acid.
- Refer to an item prepared earlier by name and step, such as `the blocking buffer from step 2`, instead of restating its recipe.

Evidence handling:

- Keep source-reported values as reported. Convert a unit only when the step needs it and keep the original in parentheses.
- Where sources disagree, run the protocol on one value and record the alternative and its source under `Source limitations:`.
- Never invent catalog numbers, lot numbers, supplier names, exact instrument models, or paper-specific values the evidence does not contain.
- When the source is silent on a routine parameter, choose a scientifically conventional starting value and label it under `Starting defaults:` as a recommended starting condition rather than a source-reported fact.

Placeholder usage:

- Produce an executable starting protocol, not a questionnaire. Fill routine, low-risk procedural parameters from evidence; when the source is silent, select a scientifically conventional starting value and identify it in troubleshooting as a recommended starting condition rather than a source-reported fact.
- Do not create placeholders for routine defaults such as replicate count, dilution factor, concentration-series point count, common staining or wash buffer, wash count, incubation time or temperature, acquisition volume, or minimum event target when a reasonable starting value can be selected.
- Reserve placeholders for genuinely user-, reagent-, sample-, or instrument-specific choices that would be unreliable to infer: exact biological sample or clone identity, reagent identity, stock concentration or solvent, affinity tag or catalog-specific reagent, and instrument-specific channel or detector settings.
- Aim for 0-3 unresolved placeholders and do not exceed 5 unless the source explicitly defines more independent choices. If more than 5 would remain, replace routine placeholders with labeled starting defaults or ask one blocking clarification before generation.
- Represent each real decision with one placeholder at its first executable use, then refer to the selected value later without creating duplicate placeholders for the same buffer, sample, or setting.
- Write a placeholder as a bracket name in the step text, such as `[cell line]`, `[stock concentration]`, or `[detector channel]`, matching the value the user will fill. Use square brackets for nothing else; write concentrations as `Ca2+ concentration`, not `[Ca2+]`.
- In materials, prefer a clear generic category such as `the user's PD-L1 stable cell line` over a bracket placeholder that does not map to an executable step.
- If supplying structured step objects with explicit placeholder ids, bind each placeholder in `text` with `{{ph:<id>}}` and include matching `placeholders: [{ id: "<id>", name: "<display name>" }]`.
- Do not invent identity-, stock-, or instrument-specific values merely to remove a placeholder. Routine recommended starting conditions are allowed when clearly labeled as recommendations.

Workflow:

1. Gather the source evidence first: active paper markdown, selected methods text, local protocols, records, or user-provided procedure text.
2. Call `protocol_lookup` when the lab may already have a protocol for this procedure. Extend or follow the existing one rather than adding a near-duplicate, and reuse the local reagent and buffer naming it establishes.
3. Author the complete protocol JSON yourself from that evidence, using labeled starting defaults for routine settings and placeholders only for genuinely specific unresolved decisions.
4. Check the draft before calling the tool: every step has its numbers, every material is used and every step reagent is listed, controls and acceptance criteria are present, square brackets appear only as placeholders, the placeholder count is within budget, and the chosen starting defaults are labeled in troubleshooting. Fix what fails instead of submitting it.
5. Call `protocol_generation` once with `{ protocol, result_summary, save: true }` for generated protocols that should enter Hikari review.
6. Read the tool result and use the returned `protocol`, `status`, `save_requested`, and `requires_user_approval` fields as the source of truth.
7. Reply in normal assistant prose that the generated protocol is ready for review, naming the normalized protocol, the starting defaults you selected, and any remaining user-fillable placeholders.

The `protocol_generation` tool expects complete protocol JSON and returns the normalized protocol fields plus approval status.
