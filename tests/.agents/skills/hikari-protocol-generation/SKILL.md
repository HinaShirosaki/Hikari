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

Protocol JSON checklist:

- `protocol.name`: concise protocol title suitable for the Protocols module.
- `protocol.purpose`: short experimental goal, including the biological system or assay when known.
- `protocol.materials`: array of reagents, samples, equipment, strains, plasmids, cell lines, buffers, and controls supported by the loaded evidence.
- `protocol.steps`: ordered array of strings or step objects. Include timing, temperature, volumes, concentrations, incubation conditions, controls, and readouts inside the relevant step text. When a genuinely user-specific value should remain user-fillable, write a bracket placeholder directly in the step text, such as `[cell line]`, `[stock concentration]`, or `[detector channel]`, and follow the placeholder rules below. Use square brackets for nothing else; write concentrations as `Ca2+ concentration`, not `[Ca2+]`.
- `protocol.troubleshooting`: caveats, quality checks, expected outcomes, failure modes, safety notes, and paper-specific limitations when available.
- `result_summary`: one sentence describing what was prepared.
- `save: true`: include this when the user asks to add, save, import, persist, or queue the generated protocol for review.

Placeholder usage:

- Produce an executable starting protocol, not a questionnaire. Fill routine, low-risk procedural parameters from evidence; when the source is silent, select a scientifically conventional starting value and identify it in troubleshooting as a recommended starting condition rather than a source-reported fact.
- Do not create placeholders for routine defaults such as replicate count, dilution factor, concentration-series point count, common staining or wash buffer, wash count, incubation time or temperature, acquisition volume, or minimum event target when a reasonable starting value can be selected.
- Reserve placeholders for genuinely user-, reagent-, sample-, or instrument-specific choices that would be unreliable to infer: exact biological sample or clone identity, reagent identity, stock concentration or solvent, affinity tag or catalog-specific reagent, and instrument-specific channel or detector settings.
- In materials, prefer a clear generic category such as `the user's PD-L1 stable cell line` over a bracket placeholder that does not map to an executable step.
- Aim for 0-3 unresolved placeholders and do not exceed 5 unless the source explicitly defines more independent choices. If more than 5 would remain, replace routine placeholders with labeled starting defaults or ask one blocking clarification before generation.
- Represent each real decision with one placeholder at its first executable use, then refer to the selected value later without creating duplicate placeholders for the same buffer, sample, or setting.
- Use meaningful placeholder names that match the value the user will fill, for example `[plasmid identity]`, `[stock concentration]`, or `[detector channel]`.
- If supplying structured step objects with explicit placeholder ids, bind each placeholder in `text` with `{{ph:<id>}}` and include matching `placeholders: [{ id: "<id>", name: "<display name>" }]`.
- Do not invent identity-, stock-, or instrument-specific values merely to remove a placeholder. Routine recommended starting conditions are allowed when clearly labeled as recommendations.

Workflow:

1. Gather the source evidence first: active paper markdown, selected methods text, local protocols, records, or user-provided procedure text.
2. Author the complete protocol JSON yourself from that evidence, using labeled starting defaults for routine settings and placeholders only for genuinely specific unresolved decisions.
3. Call `protocol_generation` once with `{ protocol, result_summary, save: true }` for generated protocols that should enter Hikari review.
4. Read the tool result and use the returned `protocol`, `status`, `save_requested`, and `requires_user_approval` fields as the source of truth.
5. Reply in normal assistant prose that the generated protocol is ready for review, and mention the normalized protocol name plus any important caveats or user-fillable placeholders.

The `protocol_generation` tool expects complete protocol JSON and returns the normalized protocol fields plus approval status.
