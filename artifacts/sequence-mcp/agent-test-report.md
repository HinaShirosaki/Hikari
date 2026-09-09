# Sequence Viewer agent-style MCP test

Tested on 2026-09-07 through an MCP SDK client connected to a separate Hikari stdio-server process. Target IDs, revisions, feature references and catalog IDs came from preceding tool responses. This was a manually directed agent simulation using synthetic local records, without an external LLM.

## Result

37 tool calls across all nine Sequence Viewer tools, plus tools/list discovery. Restarted the MCP server and verified every source GenBank file stayed unchanged. The isolated test library was removed after verification.

Passed: duplicate-name disambiguation by folder/status; feature and exact DNA/protein searches; residue/codon inspection; 6xHis–TEV fusion assembly and CDS replacement; E45G substitution, deletion of original residues 48–49 and GS insertion after original residue 50 in one batch; all three feature operations in both modes; reverse-strand E45G; retry deduplication; wrong-residue, stale-revision and conflicting-batch rejection; persisted derivatives and UI actions after MCP process restart.

The batch retained 90 residues and returned HLFSGCTVGSFIDQP at residues 41–55. Primer comparison retained three stages and recommended whole-plasmid PCR with six primers.

## Confirmed defects

1. **High: hypothetical intermediate primers can be mislabeled as supplied physical templates.** Whole-plasmid stages 2 and 3 have stage.template_kind = hypothetical_intermediate, while their primer objects report template_id = intermediate_1/intermediate_2 and template_kind = supplied_template. Six inconsistent primer labels occurred across route outputs. At src/renderer/modules/sequence-viewer/mcp/primers.js:71, absent exact binding and an absent donor make matches[0]?.id === donor?.id evaluate true (undefined === undefined). An agent trusting the per-primer field could incorrectly report template availability.

2. **Medium: default names report the wrong edit location.** A DNA insertion after base 100, replacement at bases 100–120, and the protein fusion all received g.1delins names; later edits append the same token. src/renderer/modules/sequence-viewer/main-process/mcp/service.js:190 invokes buildEditedSequenceName without editRequest, which the shared naming helper requires for length-changing edits. Explicit user names work around the label problem; sequence products and recorded operations were correct in this test.

No implementation files were changed during this testing request.

Full request/response transcript: [agent-session.json](agent-session.json). Machine-readable summary: [agent-session-summary.json](agent-session-summary.json).
