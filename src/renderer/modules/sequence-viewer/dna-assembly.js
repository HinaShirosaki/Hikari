import { reverseComplementIupac } from './shared.js';
import { buildDnaFragmentRecord } from './dna-fragments.js';

export const DNA_ASSEMBLY_ERRORS = {
  fragments: 'Choose at least two DNA fragments.',
  method: 'Choose an assembly method.',
  linear: '{name} is circular. Digest it into a linear fragment before assembly.',
  sequence: '{name} has an invalid DNA sequence.',
  ends: '{name} has invalid terminal overhang data.',
  sticky: '{left} → {right}: sticky ends are not compatible.',
  blunt: '{left} → {right}: both joining ends must be blunt.',
  overlap: '{left} → {right}: no exact terminal overlap of at least {minimum} bp.',
  minimum: 'Enter a minimum overlap between 12 and 1000 bp.',
  pcrTopology: 'Overlap PCR produces linear DNA.',
  contained: '{left} → {right}: the overlap consumes an entire fragment.',
  name: 'Enter an assembled DNA name.'
};

function fail(code, params = {}) {
  const error = new Error(DNA_ASSEMBLY_ERRORS[code].replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key));
  error.assemblyCode = code;
  error.assemblyParams = params;
  throw error;
}

const value = raw => String(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '');
const blunt = () => ({ kind: 'blunt', sequence: '', enzyme: '' });
const isEndFeature = feature => Boolean(feature.qualifiers?.hikari_digest_end);

// Digest overhangs are stored in the protruding strand's 5′–3′ orientation.
// They survive GenBank reloads as qualifiers on the actual terminal bases.
export function getDnaFragmentEnds(record) {
  const ends = {};
  for (const side of ['left', 'right']) {
    const at = side === 'left' ? 0 : record.sequence.length - 1;
    const markers = (record.features || []).filter(feature => value(feature.qualifiers?.hikari_digest_end) === side
      && feature.segments?.some(segment => segment.start <= at && segment.end > at));
    if (markers.length > 1) fail('ends', { name: record.name });
    const q = markers[0]?.qualifiers;
    const raw = record.digestEnds?.[side] || (q && {
      kind: value(q.hikari_digest_end_type), sequence: value(q.hikari_digest_overhang), enzyme: value(q.hikari_digest_enzyme)
    });
    const end = !raw || raw.kind === 'original' ? blunt() : {
      kind: raw.kind, sequence: value(raw.sequence).toUpperCase(), enzyme: value(raw.enzyme)
    };
    if (!['blunt', '5-prime', '3-prime'].includes(end.kind)
      || (end.kind === 'blunt' ? Boolean(end.sequence) : !/^[ACGT]+$/.test(end.sequence))) fail('ends', { name: record.name });
    ends[side] = end;
  }
  const { left, right } = ends;
  if ((left.kind === '5-prime' && !record.sequence.startsWith(left.sequence))
    || (right.kind === '3-prime' && !record.sequence.endsWith(right.sequence))
    || (left.kind === '5-prime' ? left.sequence.length : 0) + (right.kind === '3-prime' ? right.sequence.length : 0) >= record.sequence.length) fail('ends', { name: record.name });
  return ends;
}

export function orientDnaAssemblyFragment(input) {
  const record = input.record || input;
  const sequence = String(record.sequence || '').replace(/\s/g, '').toUpperCase().replace(/U/g, 'T');
  if (!/^[ACGTRYSWKMBDHVN]+$/.test(sequence)) fail('sequence', { name: record.name });
  if (String(record.topology).toLowerCase() === 'circular') fail('linear', { name: record.name });
  const ends = getDnaFragmentEnds({ ...record, sequence });
  const reverse = input.orientation === 'reverse';
  const start = reverse && ends.left.kind === '5-prime' ? ends.left.sequence.length : 0;
  const end = sequence.length - (reverse && ends.right.kind === '3-prime' ? ends.right.sequence.length : 0);
  if (end <= start) fail('ends', { name: record.name });
  const clipped = buildDnaFragmentRecord({ ...record, sequence, topology: 'linear',
    features: (record.features || []).filter(feature => !isEndFeature(feature)) }, { start, end }, record.name || 'DNA');
  if (!reverse) return { ...clipped, ends, sourceId: input.entryId || '', orientation: 'forward' };
  // Reverse-complement the physical bottom strand. Its recessed/protruding
  // termini can differ from the saved plus strand in both sequence and length.
  const prefix = ends.right.kind === '5-prime' ? ends.right.sequence : '';
  const suffix = ends.left.kind === '3-prime' ? ends.left.sequence : '';
  const pairedLength = end - start;
  return { ...clipped, sequence: prefix + reverseComplementIupac(clipped.sequence) + suffix,
    features: clipped.features.map(feature => ({ ...feature, strand: feature.strand === -1 ? 1 : -1,
      segments: [...feature.segments].reverse().map(segment => ({
        start: prefix.length + pairedLength - segment.end, end: prefix.length + pairedLength - segment.start
      })), locationText: '' })),
    ends: { left: ends.right, right: ends.left }, sourceId: input.entryId || '', orientation: 'reverse' };
}

// Linear time suffix/prefix matching; repetitive or long fragments must not
// turn a preview into a quadratic substring scan. Ambiguous bases never prove
// terminal homology.
export function findDnaTerminalOverlap(left, right) {
  const pattern = right.slice(0, Math.min(left.length, right.length));
  const table = new Uint32Array(pattern.length);
  for (let i = 1, matched = 0; i < pattern.length; i++) {
    while (matched && pattern[i] !== pattern[matched]) matched = table[matched - 1];
    if (pattern[i] === pattern[matched]) matched++;
    table[i] = matched;
  }
  let matched = 0;
  for (const base of left.slice(-pattern.length)) {
    while (matched && (matched === pattern.length || base !== pattern[matched] || !/[ACGT]/.test(base))) matched = table[matched - 1];
    if (base === pattern[matched] && /[ACGT]/.test(base)) matched++;
  }
  return matched;
}

function terminalFeature(side, end, length) {
  const at = side === 'left' ? 0 : length - 1;
  return { id: `assembly-${side}-end`, name: `${side} assembly end`, type: 'misc_feature', strand: 1,
    segments: [{ start: at, end: at + 1 }], qualifiers: { hikari_digest_end: side,
      hikari_digest_end_type: end.kind, hikari_digest_overhang: end.sequence, hikari_digest_enzyme: end.enzyme } };
}

export function buildDnaAssemblyRecord(inputs, { method = 'sticky', topology = 'linear', name = 'Assembled DNA', minimumOverlap = 15 } = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) fail('fragments');
  if (!['sticky', 'blunt', 'overlap-pcr'].includes(method)) fail('method');
  if (!String(name).trim()) fail('name');
  if (method === 'overlap-pcr' && (!Number.isInteger(Number(minimumOverlap)) || minimumOverlap < 12 || minimumOverlap > 1000)) fail('minimum');
  if (method === 'overlap-pcr' && topology === 'circular') fail('pcrTopology');
  topology = topology === 'circular' ? 'circular' : 'linear';
  const fragments = inputs.map(orientDnaAssemblyFragment);
  const junctions = [];
  const offsets = [0];
  let sequence = fragments[0].sequence;
  for (let index = 0; index < fragments.length - (topology === 'circular' ? 0 : 1); index++) {
    const left = fragments[index];
    const right = fragments[(index + 1) % fragments.length];
    const params = { left: left.name, right: right.name, minimum: minimumOverlap };
    let overlap = 0;
    if (method === 'sticky') {
      if (left.ends.right.kind === 'blunt' || left.ends.right.kind !== right.ends.left.kind
        || left.ends.right.sequence !== reverseComplementIupac(right.ends.left.sequence)) fail('sticky', params);
    } else if (method === 'blunt') {
      if (left.ends.right.kind !== 'blunt' || right.ends.left.kind !== 'blunt') fail('blunt', params);
    } else {
      overlap = findDnaTerminalOverlap(left.sequence, right.sequence);
      if (overlap < minimumOverlap) fail('overlap', params);
      if (overlap >= Math.min(left.sequence.length, right.sequence.length)) fail('contained', params);
    }
    junctions.push({ left: left.name, right: right.name, overlap });
    if (index < fragments.length - 1) {
      offsets.push(sequence.length - overlap);
      sequence += right.sequence.slice(overlap);
    }
  }
  const features = fragments.flatMap((fragment, index) => [
    ...fragment.features.map((feature, featureIndex) => ({ ...feature,
      id: `assembly-${index}-${featureIndex}-${feature.id || 'feature'}`,
      segments: feature.segments.map(segment => ({ start: segment.start + offsets[index], end: segment.end + offsets[index] })),
      locationText: '' })),
    { id: `assembly-source-${index}`, name: fragment.name, type: 'misc_feature', strand: 1,
      segments: [{ start: offsets[index], end: offsets[index] + fragment.sequence.length }],
      qualifiers: { hikari_assembly_source: fragment.sourceId || fragment.name,
        hikari_assembly_orientation: fragment.orientation, hikari_assembly_method: method } }
  ]);
  const digestEnds = method === 'overlap-pcr' ? { left: blunt(), right: blunt() }
    : { left: fragments[0].ends.left, right: fragments.at(-1).ends.right };
  if (topology === 'linear') features.push(...['left', 'right'].map(side => terminalFeature(side, digestEnds[side], sequence.length)));
  return { name: String(name).trim(), sequence, topology, sourceFormat: 'genbank', features, junctions,
    ...(topology === 'linear' ? { digestEnds } : {}),
    description: `DNA assembly (${method}): ${fragments.map(fragment => `${fragment.name} (${fragment.orientation})`).join(' + ')}.` };
}
