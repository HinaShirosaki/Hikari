'use strict';
const str = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength });
const enumeration = (...values) => ({ type: 'string', enum: values });
const number = (minimum = 0, maximum = 2000000) => ({ type: 'integer', minimum, maximum });
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const array = (items, maxItems = 100, minItems = 1) => ({ type: 'array', items, minItems, maxItems });
const bool = { type: 'boolean' };
const range = object({ start: number(1), end: number(1) }, ['start', 'end']);
const source = object({ entry_id: str(), expected_revision: str(), feature_ref: str() }, ['entry_id', 'expected_revision', 'feature_ref']);
const feature = object({ name: str(), type: str(), strand: { type: 'integer', enum: [-1, 1] }, segments: array(range), description: str(4000), qualifiers: { type: 'object', additionalProperties: { type: 'string', maxLength: 20000 } } });
const page = { offset: number(0), limit: number(1, 200) };
const filters = { status: enumeration('saved', 'temporary', 'all'), folder_id: { type: 'string', maxLength: 200 }, project_id: str(), topology: enumeration('linear', 'circular') };
const target = { entry_id: str(), expected_revision: str(), feature_ref: str() };
const mutation = { ...target, request_id: str(), name: str(140) };
const profile = { codon_profile: str(80) };
const part = object({ kind: enumeration('catalog', 'feature', 'custom'), part_id: str(), source, label: str(), amino_acids: str(24000), dna: str(72000), codon_optimize: bool }, ['kind']);
const operation = object({ operation: enumeration('substitute', 'delete', 'insert', 'replace_cds'), position: number(1), start: number(1), end: number(1), after_residue: number(), expected_amino_acid: str(1), expected_amino_acids: str(24000), amino_acid: str(1), amino_acids: str(24000), construct_id: str() }, ['operation']);
const definitions = [
  ['sequence_list', 'List local Sequence Viewer plasmids and linear sequences. Includes saved and temporary records by default. Coordinates are one-based inclusive; mutations require the returned revision.', object({ ...filters, ...page })],
  ['sequence_search', 'Search local plasmids by an explicit mode: plasmid name, feature name/type, exact DNA substring (both strands), or exact protein substring. Returns matching features and positions.', object({ ...filters, ...page, query: str(72000), mode: enumeration('name', 'feature', 'dna', 'protein') }, ['query', 'mode'])],
  ['sequence_get', 'Read plasmid metadata and revision-bound feature references. Include predicted ORFs explicitly. Full DNA is opt-in; nucleotide ranges are one-based inclusive.', object({ entry_id: str(), ...page, include_orfs: bool, include_sequence: bool, feature_ref: str(), include_feature_dna: bool, nucleotide_range: range }, ['entry_id'])],
  ['sequence_feature_edit', 'Create a temporary derivative by inserting, replacing, or deleting a feature. Explicitly choose annotation_only or sequence_and_annotation. DNA payloads are in feature orientation. after_base=0 means before base 1. Never overwrites the source; retry with the same request_id and identical arguments.', object({ ...mutation, operation: enumeration('insert', 'replace', 'delete'), mode: enumeration('annotation_only', 'sequence_and_annotation'), feature, after_base: number(), dna: str(2000000), source }, ['entry_id', 'expected_revision', 'request_id', 'operation', 'mode']), true],
  ['sequence_protein_parts', 'List Protein Builder catalog parts and supported codon usage profiles. IDs can be used in sequence_protein_build.', object({ ...page, query: str(), type: str() })],
  ['sequence_protein_build', 'Build an ordered Protein Builder chain in the background. Catalog, local CDS/ORF, and custom peptide blocks are supported. Source DNA is preserved unless codon_optimize is true. Returns an openable reusable construct. No terminal stop is added; target stop is preserved on insertion.', object({ request_id: str(), name: str(140), parts: array(part, 100), ...profile }, ['request_id', 'parts']), true],
  ['sequence_protein_get', 'Read numbered CDS/ORF residues in protein N-to-C order, with codons and one-based plasmid positions. Terminal stop is separate. Use these references and expected amino acids for editing.', object({ ...target, ...page }, ['entry_id', 'feature_ref'])],
  ['sequence_protein_edit', 'Create a temporary plasmid derivative from a batch of protein edits. All positions refer to the original revision. Substitution/deletion require matching expected amino acids. Insert after_residue=0 at N terminus; C-terminal insertions precede the terminal stop. Accept a construct_id for insert or replace_cds. Choose edits according to the user design objective.', object({ ...mutation, ...profile, operations: array(operation, 32) }, ['entry_id', 'expected_revision', 'feature_ref', 'request_id', 'operations']), true],
  ['sequence_mutagenesis_primers', 'Compare existing cloning routes for a recorded derivative. Uses original source snapshots and separate edit locations. Returns feasible designs with template identities, quality warnings, ranking reasons, and openable results; never orders primers.', object({ entry_id: str(), expected_revision: str(), donor: source, methods: array(enumeration('whole-plasmid', 'q5-kld', 'two-step-ligation', 'golden-gate', 'gibson', 'in-fusion', 'overlap-extension'), 7) }, ['entry_id', 'expected_revision']), true]
].map(([name, description, inputSchema, writes = false]) => ({
  name, description, inputSchema,
  annotations: { title: name.replaceAll('_', ' '), readOnlyHint: !writes, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}));
module.exports = { definitions };
