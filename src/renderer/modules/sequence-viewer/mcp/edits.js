import { reverseComplementDna, reverseTranslateProteinSequence } from '../calculations/sequence.js';
import { chooseClosestAminoAcidCodon } from '../amino-acid-substitution.js';
import { codingContext, dna, fail, featurePositions, integer, peptide, positionsToSegments, refreshTranslation } from './model.js';

// Patches use original zero-based, half-open coordinates, never shifting input coordinates.
export function applyPatches(record, patches, targetIndex = -1) {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    integer(p.start, 0, record.sequence.length, 'patch start');
    integer(p.end, p.start, record.sequence.length, 'patch end');
    if (i && (p.start < sorted[i - 1].end || p.start === sorted[i - 1].start)) fail('Conflicting edits.');
  }
  let cursor = 0;
  let sequence = '';
  const mapping = new Map();
  const inserted = [];
  for (const p of sorted) {
    for (; cursor < p.start; cursor++) { mapping.set(cursor, sequence.length); sequence += record.sequence[cursor]; }
    inserted.push({ ...p, nextStart: sequence.length });
    sequence += p.sequence;
    cursor = p.end;
  }
  for (; cursor < record.sequence.length; cursor++) { mapping.set(cursor, sequence.length); sequence += record.sequence[cursor]; }
  if (!sequence.length) fail('An edit cannot remove the entire plasmid.');
  const affected = [];
  const features = (record.features || []).flatMap((feature, index) => {
    const original = featurePositions(feature, record.sequence.length);
    const members = new Set(original);
    const additions = new Map();
    for (const p of inserted) {
      const overlaps = original.some(i => i >= p.start && i < p.end);
      const interior = members.has(p.start) && members.has((p.start - 1 + record.sequence.length) % record.sequence.length);
      if (!p.sequence.length || !(overlaps || interior || index === targetIndex)) continue;
      // Insert at this position in the feature's forward segment traversal.
      let anchor = original.find(i => i >= p.start && i < p.end);
      if (anchor === undefined && members.has(p.start)) anchor = p.start;
      if (anchor === undefined && members.has(p.start - 1)) anchor = p.start - 1;
      if (anchor === undefined) continue;
      const after = p.start === p.end && anchor === p.start - 1;
      const key = `${anchor}:${after}`;
      additions.set(key, Array.from({ length: p.sequence.length }, (_, j) => p.nextStart + j));
    }
    const next = [];
    for (const i of original) {
      next.push(...(additions.get(`${i}:false`) || []));
      if (mapping.has(i)) next.push(mapping.get(i));
      next.push(...(additions.get(`${i}:true`) || []));
    }
    const segments = positionsToSegments([...new Set(next)]);
    const changed = JSON.stringify(segments) !== JSON.stringify(feature.segments)
      || sorted.some(p => original.some(i => i >= p.start && i < p.end));
    if (changed) affected.push({ index, name: feature.name, action: segments.length ? 'updated' : 'removed' });
    if (!segments.length) return [];
    const updated = { ...feature, segments, ...(changed ? { locationText: '' } : {}) };
    return [changed ? refreshTranslation({ ...record, sequence }, updated) : updated];
  });
  return { record: { ...record, sequence, features }, patches: sorted, affected_features: affected };
}

function externalFeature(input, length) {
  if (!input?.name || !input?.type || !Array.isArray(input.segments) || !input.segments.length) fail('Feature name, type, and segments are required.');
  return {
    name: String(input.name), type: String(input.type), strand: input.strand === -1 ? -1 : 1,
    description: input.description || '', qualifiers: { ...input.qualifiers }, source: 'agent', locationText: '',
    segments: input.segments.map(s => ({ start: integer(s.start, 1, length, 'feature start') - 1, end: integer(s.end, s.start, length, 'feature end') }))
  };
}
function continuousForward(feature, record) {
  const positions = featurePositions(feature, record.sequence.length);
  if (!positions.length || positions.some((p, i) => i && p !== positions[i - 1] + 1 && !(record.topology === 'circular' && p === 0 && positions[i - 1] === record.sequence.length - 1))) fail('Discontinuous feature replacement needs an explicit placement across gaps.', 'unsupported_location');
  return positions;
}
export function patchesForPositions(positions, sequence, _record) {
  const groups = positionsToSegments(positions);
  return groups.map((s, i) => ({ ...s, sequence: i === 0 ? sequence : '' }));
}
export function editFeature(record, args, target, replacement = '') {
  const index = target?.index ?? -1;
  if (args.mode === 'annotation_only') {
    const next = structuredClone(record);
    if (args.operation === 'insert') next.features.push(refreshTranslation(next, externalFeature(args.feature, record.sequence.length)));
    else if (args.operation === 'delete') next.features.splice(index, 1);
    else next.features[index] = refreshTranslation(next, externalFeature({ ...target.feature, ...args.feature, segments: args.feature?.segments || target.feature.segments.map(s => ({ start: s.start + 1, end: s.end })) }, record.sequence.length));
    return { record: next, patches: [], affected_features: [{ index: args.operation === 'insert' ? next.features.length - 1 : index, action: args.operation, name: args.feature?.name || target?.feature.name }] };
  }
  let patches;
  let insertedFeature;
  if (args.operation === 'insert') {
    const boundary = integer(args.after_base, 0, record.sequence.length, 'after_base');
    const sequence = dna(replacement);
    const strand = args.feature?.strand === -1 ? -1 : 1;
    patches = [{ start: boundary, end: boundary, sequence: strand === -1 ? reverseComplementDna(sequence) : sequence }];
    insertedFeature = externalFeature({ ...args.feature, segments: [{ start: boundary + 1, end: boundary + sequence.length }] }, record.sequence.length + sequence.length);
  } else {
    const positions = args.operation === 'delete' ? featurePositions(target.feature, record.sequence.length) : continuousForward(target.feature, record);
    const sequence = args.operation === 'delete' ? '' : dna(replacement);
    patches = patchesForPositions(positions, target.feature.strand === -1 ? reverseComplementDna(sequence) : sequence, record);
  }
  const result = applyPatches(record, patches, index);
  if (insertedFeature) {
    result.record.features.push(refreshTranslation(result.record, insertedFeature));
    result.affected_features.push({ index: result.record.features.length - 1, name: insertedFeature.name, action: 'inserted' });
  }
  if (args.operation === 'replace' && args.feature) {
    // Target retains identity through the remap; deleted preceding features may shift its index.
    const candidate = result.record.features.find(f => f.id === target.feature.id);
    if (candidate) {
      if (args.feature.strand !== undefined && args.feature.strand !== target.feature.strand) fail('Changing strand during DNA replacement is unsupported; use an annotation edit explicitly.');
      if (args.feature.segments) fail('DNA replacement determines the new segments; do not supply annotation coordinates.');
      Object.assign(candidate, { ...args.feature, segments: candidate.segments, strand: target.feature.strand, locationText: '' });
      Object.assign(candidate, refreshTranslation(result.record, candidate));
    }
  }
  return result;
}

export function editProtein(record, feature, index, operations, profile = 'ecoli') {
  const context = codingContext(record, feature);
  if (!context.editable) fail(context.warnings.join(' '), 'protein_not_editable');
  continuousForward(feature, record);
  if (!Array.isArray(operations) || !operations.length) fail('At least one protein operation is required.');
  const edits = operations.map(op => {
    let start, end, sequence = '';
    if (op.operation === 'replace_cds') {
      if (operations.length !== 1) fail('Whole-CDS replacement must be the only operation.');
      start = 0; end = context.residues.length;
    } else if (op.operation === 'insert') {
      start = integer(op.after_residue, 0, context.residues.length, 'after_residue'); end = start;
    } else {
      start = integer(op.position ?? op.start, 1, context.residues.length, 'residue start') - 1;
      end = op.operation === 'substitute' ? start + 1 : integer(op.end ?? op.position ?? op.start, start + 1, context.residues.length, 'residue end');
      const expected = context.protein.slice(start, end);
      if ((op.expected_amino_acid || op.expected_amino_acids) !== expected) fail(`Expected residues do not match ${expected} at ${start + 1}.`, 'residue_mismatch');
    }
    if (op.operation !== 'delete') {
      const protein = peptide(op.amino_acid || op.amino_acids);
      if (op.operation === 'substitute' && protein.length !== 1) fail('Substitution requires one amino acid.');
      sequence = op.dna || (op.operation === 'substitute'
        ? chooseClosestAminoAcidCodon(context.residues[start].codon, protein)
        : reverseTranslateProteinSequence(protein, { organism: profile }).dna);
      if (!sequence) fail('Reverse translation failed.');
      const translated = sequence.match(/.{3}/g)?.map(c => translateCodon(c)).join('');
      if (sequence.length !== protein.length * 3 || translated !== protein) fail('Construct DNA does not encode the requested peptide.');
    }
    return { start, end, sequence, operation: op.operation };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end || edits[i].start === edits[i - 1].start) fail('Overlapping or ambiguous protein operations.');
  const patches = edits.flatMap(edit => {
    const positions = context.positions.slice(edit.start * 3, edit.end * 3);
    const sequence = feature.strand === -1 ? reverseComplementDna(edit.sequence) : edit.sequence;
    if (!positions.length) {
      const previous = context.positions[edit.start * 3 - 1];
      const boundary = edit.start === 0 ? context.positions[0] + (feature.strand === -1 ? 1 : 0) : previous + (feature.strand === -1 ? 0 : 1);
      return [{ start: boundary, end: boundary, sequence }];
    }
    return patchesForPositions(feature.strand === -1 ? positions.reverse() : positions, sequence, record);
  });
  const working = structuredClone(record);
  if (index >= working.features.length) { index = working.features.length; working.features.push({ ...feature, type: 'cds', id: `agent_orf_${index}` }); }
  const result = applyPatches(working, patches, index);
  const target = result.record.features.find(f => f.id === working.features[index].id);
  const expectedDna = edits.reduceRight((text, e) => text.slice(0, e.start * 3) + e.sequence + text.slice(e.end * 3), context.dna);
  if (!target || codingContext(result.record, target).dna !== expectedDna) fail('Edited CDS did not reconstruct the requested sequence.', 'product_mismatch');
  result.protein = codingContext(result.record, target).protein;
  result.changes = operations;
  return result;
}
import { translateDnaCodon as translateCodon } from '../calculations/sequence.js';
