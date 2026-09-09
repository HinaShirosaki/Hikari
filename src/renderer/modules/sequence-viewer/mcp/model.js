import { translateDnaCodon, reverseComplementDna } from '../calculations/sequence.js';
import { buildOrfFeatures } from '../orf-analysis.js';

export function fail(message, code = 'invalid_arguments') {
  throw Object.assign(new Error(message), { code });
}
export function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
export function dna(value) {
  const sequence = String(value || '').replace(/\s/g, '').toUpperCase();
  if (!sequence || !/^[ACGTRYSWKMBDHVN]+$/.test(sequence)) fail('Provide nonempty IUPAC DNA.');
  return sequence;
}
export function peptide(value) {
  const sequence = String(value || '').replace(/\s/g, '').toUpperCase();
  if (!sequence || !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(sequence)) fail('Provide a peptide using the 20 standard one-letter amino acids, without stop symbols.');
  return sequence;
}
export function allFeatures(record, includeOrfs = false) {
  return [...(record.features || []), ...(includeOrfs ? buildOrfFeatures(record.sequence, record.topology) : [])];
}
export function featureRef(revision, index) { return `${revision}:${index}`; }
export function resolveFeature(record, revision, ref) {
  const prefix = `${revision}:`;
  if (typeof ref !== 'string' || !ref.startsWith(prefix) || !/^\d+$/.test(ref.slice(prefix.length))) fail('Feature reference is stale or invalid. Read the feature list again.', 'stale_feature');
  const index = Number(ref.slice(prefix.length));
  const feature = allFeatures(record, true)[index];
  if (!feature) fail('Feature does not exist.', 'not_found');
  return { feature, index };
}
export function featurePositions(feature, length, coding = false) {
  const positions = [];
  for (const s of feature.segments || []) {
    integer(s.start, 0, length - 1, 'segment start');
    integer(s.end, s.start + 1, length, 'segment end');
    for (let i = s.start; i < s.end; i++) positions.push(i);
  }
  if (new Set(positions).size !== positions.length) fail('Overlapping feature segments are unsupported.');
  return coding && feature.strand === -1 ? positions.reverse() : positions;
}
export function featureDna(record, feature) {
  const raw = featurePositions(feature, record.sequence.length).map(i => record.sequence[i]).join('');
  return feature.strand === -1 ? reverseComplementDna(raw) : raw;
}
export function codingContext(record, feature) {
  const warnings = [];
  const qualifiers = feature.qualifiers || {};
  const coding = /^(cds|open_reading_frame|orf)$/i.test(feature.type);
  if (!coding) warnings.push('Select a CDS or ORF feature.');
  const offset = Number(qualifiers.codon_start || 1) - 1;
  if (![0, 1, 2].includes(offset)) warnings.push('Unsupported codon_start.');
  if (Number(qualifiers.transl_table || 1) !== 1) warnings.push('Only the standard genetic code is editable.');
  if (qualifiers.transl_except || /[<>:^]|order\(|join\(complement/i.test(feature.locationText || '')) warnings.push('Partial, remote, or unresolved coding locations are not editable.');
  const positions = featurePositions(feature, record.sequence.length, true).slice(Math.max(0, offset));
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  const bases = positions.map(i => feature.strand === -1 ? (complement[record.sequence[i]] || 'N') : record.sequence[i]);
  const residues = [];
  let terminalStop = null;
  for (let i = 0; i + 2 < bases.length; i += 3) {
    const codon = bases.slice(i, i + 3).join('');
    const aminoAcid = translateDnaCodon(codon) || 'X';
    const item = { position: i / 3 + 1, amino_acid: aminoAcid, codon, nucleotide_positions: positions.slice(i, i + 3).map(p => p + 1) };
    if (aminoAcid === '*' && i + 3 === bases.length) terminalStop = item;
    else residues.push(item);
  }
  if (bases.length % 3) warnings.push('Coding sequence ends with an incomplete codon.');
  if (residues.some(r => r.amino_acid === '*' || r.amino_acid === 'X')) warnings.push('Coding sequence has internal stops or ambiguous codons.');
  return { editable: !warnings.length, warnings, residues, terminal_stop: terminalStop, protein: residues.map(r => r.amino_acid).join(''), dna: bases.join(''), positions, offset };
}
export function summarizeFeature(record, feature, revision, index, includeDna = false) {
  return {
    feature_ref: featureRef(revision, index), name: feature.name, type: feature.type,
    strand: feature.strand, segments: feature.segments.map(s => ({ start: s.start + 1, end: s.end })),
    source: feature.source, qualifiers: feature.qualifiers || {},
    ...(includeDna ? { dna: featureDna(record, feature) } : {})
  };
}
export function positionsToSegments(positions) {
  const segments = [];
  for (const p of positions) {
    const last = segments.at(-1);
    if (last && last.end === p) last.end++;
    else segments.push({ start: p, end: p + 1 });
  }
  return segments;
}
export function refreshTranslation(record, feature) {
  if (!/^(cds|open_reading_frame|orf)$/i.test(feature.type)) return feature;
  const context = codingContext(record, feature);
  const qualifiers = { ...feature.qualifiers };
  delete qualifiers.translation;
  return { ...feature, qualifiers, translation: context.editable ? context.protein : '' };
}
