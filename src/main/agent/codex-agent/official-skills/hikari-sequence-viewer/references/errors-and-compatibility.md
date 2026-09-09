# Error recovery and current compatibility notes

Use exact tool results. Do not retry a failing mutation by dropping expected residues, switching edit mode, discarding provenance, or changing the target until the underlying issue is understood.

## Recovery by status

| Status or condition | Response |
| --- | --- |
| `stale_revision` / `stale_feature` | Reread the same entry, resolve the feature occurrence again, and re-evaluate the requested residues/coordinates. For a revised payload, use a new request ID. Never transplant an old feature reference into a new entry. |
| `residue_mismatch` | Show the requested versus observed residue/range. Resolve target or numbering ambiguity; do not change the expected letter solely to bypass validation. |
| `invalid_arguments` | Check the live schema and operation-specific requirements. Examples: missing search mode, unsupported field, conflicting operations, or both literal and referenced payloads. Repair only the intended request. |
| `unsupported_location` | Keep ordered segments/strand. Annotation edits or exact segment deletion can be supported for a gapped feature while DNA/protein replacement is not. Do not invent placement across gaps. |
| `protein_not_editable` | Read warnings for genetic code, frame/partial location, ambiguity or stops. Do not force an amino-acid edit with a guessed DNA rewrite. |
| `request_conflict` | That request ID already names a different payload. Retrieve the prior result if appropriate. Use a new ID for a genuinely different operation; do not loop the conflicting request. |
| `not_found` / missing construct | Re-discover the entry or catalog/build artifact. Never invent a replacement ID or assume an unsaved editor buffer is in the library. |
| `library_busy` or uncertain transport failure | Retry the identical mutation arguments with the same request ID. If the same operational failure persists after a bounded retry, report it and keep the request ID for later recovery. Do not create a second request ID just because the response was lost. |
| `product_mismatch` | No validated derivative was produced by that call. Report the failed reconstruction and preserve the source; do not claim success from a requested sequence alone. |
| `stale_design` | The entry no longer matches its recorded design history. A new revision value alone does not repair provenance; see primer-review.md. |
| `no_feasible_design` | The comparison can complete successfully without a viable route. Keep the valid derivative and report route-specific reasons. |
| Storage unavailable | The tool uses the host's configured library. Do not add a storage path argument or initialize a new empty library to hide the failure. |

A read-only retry does not need a request ID. `sequence_protein_build` and both edit tools do. Primer comparisons use the entry/revision and persist their result, with no request-ID argument in the current schema.

## Revisions and retries

When a mutation response is uncertain, first retry exactly the same request; successful mutations are deduplicated before stale-parent checks. Once the result is known, use its returned entry ID for subsequent work. An intended second edit has a new request ID and targets the newly read derivative. A retry is not an instruction to apply the same mutation twice.

When the tool explicitly rejects stale references or invalid arguments, make a fresh read and review the design before building corrected arguments. Do not reuse a prior request ID for changed arguments, even if the previous rejection appears to have occurred before a write.

## Oversized results

Reads are compact by default. Use entry/feature/residue pagination and request only the necessary sequence window. Protein Builder can return source-template data alongside protein/DNA blocks, and primer comparisons can be large across many edits and routes.

Some clients expose `structuredContent`; the Hikari stdio server also supplies model-readable text. If the text response reports truncation, its `result_preview` can end in the middle of a JSON document. Do not parse that preview as a complete object or infer omitted fields. Use accessible complete structured content, make a narrower read/route query when that preserves the task, or clearly report the limitation. Do not repeat a successful build under a new request ID just to obtain a shorter response.

## Confirmed output issues as of 2026-09-07

These were observed through the actual MCP stdio interface; they describe output interpretation, not a change to mutation authorization or biological design.

- **Template-label inconsistency:** with no donor, complementary mutagenesis primers using split annealing arms can report `template_kind: supplied_template` even for `template_id: intermediate_1` or a later intermediate. The enclosing stage still says `hypothetical_intermediate`. Use the stage and template identity to retain the real intermediate requirement; do not claim the intermediate is supplied based on the inconsistent primer field.
- **Default derivative-name defect:** a length-changing DNA edit or CDS replacement can receive a generic `g.1delins` suffix even when the actual edit is elsewhere. Pass an explicit descriptive `name` for edits, and verify the sequence/operation fields. Do not use the generated suffix as a coordinate source. Repeated annotations can also accumulate `edited` suffixes; explicit names avoid this ambiguity.

If a newer server produces corrected, consistent outputs, use those outputs. These compatibility notes do not authorize silently modifying stored names, primer plans, or library metadata outside the MCP tools.
