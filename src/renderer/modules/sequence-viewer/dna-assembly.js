import { reverseComplementIupac } from './shared.js';
import { buildDnaFragmentRecord } from './dna-fragments.js';

export const DNA_ASSEMBLY_ERRORS = {
  fragments: 'Choose at least two DNA fragments.',
  linear: '{name} is circular. Digest it into a linear fragment before assembly.',
  sequence: '{name} has an invalid DNA sequence.',
  ends: '{name} has invalid terminal overhang data.',
  compatible: 'No compatible assembly was found. Use matching sticky ends or terminal overlaps of at least {minimum} bp.',
  minimum: 'Enter a minimum overlap between 12 and 1000 bp.',
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

// How many terminal bases of the stored plus strand have no partner. Only a
// protruding plus strand is inside the record: where the bottom strand
// protrudes instead, its single-stranded bases lie outside the stored span.
// Reads the whole record, never the viewer's filtered feature list, so hiding
// the end markers cannot re-pair an overhang.
export function getUnpairedStrandEnds(record) {
  try {
    const ends = getDnaFragmentEnds({ ...record, sequence: String(record?.sequence || '').toUpperCase() });
    return { left: ends.left.kind === '5-prime' ? ends.left.sequence.length : 0,
      right: ends.right.kind === '3-prime' ? ends.right.sequence.length : 0 };
  } catch {
    return { left: 0, right: 0 };
  }
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
  if (!reverse) return { ...clipped, ends, orientation: 'forward' };
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
    ends: { left: ends.right, right: ends.left }, orientation: 'reverse' };
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

function junctionOverlap(left, right, method, minimum) {
  if (method === 'sticky') return left.ends.right.kind !== 'blunt' && left.ends.right.kind === right.ends.left.kind
    && left.ends.right.sequence === reverseComplementIupac(right.ends.left.sequence) ? 0 : null;
  const overlap = findDnaTerminalOverlap(left.sequence, right.sequence);
  return overlap >= minimum && overlap < Math.min(left.sequence.length, right.sequence.length) ? overlap : null;
}

// Edges represent physical compatibility, independent of selection order.
// Search only compatible neighbors, using each source once. Failed subsets
// are memoized; reachability pruning keeps long sparse chains inexpensive.
function createAssemblyResolver(variants, method, minimum) {
  const nodes = variants.flat();
  const source = node => Math.floor(node / 2);
  const bits = variants.map((_, index) => 1n << BigInt(index));
  const all = (1n << BigInt(variants.length)) - 1n;
  const keys = variants.map(([fragment, reverse]) => `${fragment.name}\n${[fragment.sequence, reverse.sequence].sort()[0]}`);
  const compareSource = (a, b) => keys[source(a)] < keys[source(b)] ? -1 : keys[source(a)] > keys[source(b)] ? 1 : source(a) - source(b);
  const edges = nodes.map((left, from) => nodes.flatMap((right, to) => {
    const overlap = source(from) === source(to) ? null : junctionOverlap(left, right, method, minimum);
    return overlap === null ? [] : [{ to, overlap }];
  }).sort((a, b) => b.overlap - a.overlap || compareSource(a.to, b.to) || a.to % 2 - b.to % 2));

  function reachable(last, visited) {
    let reached = visited;
    const seen = new Set([last]);
    const pending = [last];
    while (pending.length) for (const { to } of edges[pending.pop()]) {
      if ((visited & bits[source(to)]) || seen.has(to)) continue;
      seen.add(to);
      reached |= bits[source(to)];
      pending.push(to);
    }
    return reached === all;
  }

  return circular => {
    const starts = circular ? [0, 1] : nodes.map((_, index) => index).sort((a, b) => compareSource(a, b) || a % 2 - b % 2);
    const failedLinear = new Set();
    const solutions = [];
    for (const first of starts) {
      const failed = circular ? new Set() : failedLinear;
      const path = [first];
      function visit(last, visited, length, longest) {
        if (visited === all) {
          if (!circular) return [...path];
          const closing = edges[last].find(edge => edge.to === first);
          // Repeated termini cannot collapse a source into multiple trips
          // around a circle shorter than that source.
          return closing && length - closing.overlap >= longest ? [...path] : null;
        }
        const key = `${visited}:${last}${circular ? `:${length}:${longest}` : ''}`;
        if (failed.has(key)) return null;
        const canClose = !circular || edges.some((outgoing, node) => !(visited & bits[source(node)]) && outgoing.some(edge => edge.to === first));
        if (canClose && reachable(last, visited)) for (const { to, overlap } of edges[last]) {
          const bit = bits[source(to)];
          if (visited & bit) continue;
          path.push(to);
          const result = visit(to, visited | bit, length + nodes[to].sequence.length - overlap, Math.max(longest, nodes[to].sequence.length));
          path.pop();
          if (result) return result;
        }
        failed.add(key);
        return null;
      }
      const result = visit(first, bits[source(first)], nodes[first].sequence.length, nodes[first].sequence.length);
      if (result) {
        if (!circular) return result.map(node => nodes[node]);
        solutions.push(result);
      }
    }
    // Keep the first selected source as a circle's origin. Break direction
    // ties by source indices, then by the origin's original orientation.
    solutions.sort((a, b) => {
      for (let index = 1; index < a.length; index++) {
        const difference = source(a[index]) - source(b[index]);
        if (difference) return difference;
      }
      return a[0] - b[0];
    });
    return solutions[0]?.map(node => nodes[node]) || null;
  };
}

function wrapAssemblyFeatures(features, length) {
  return features.map(feature => {
    const segments = [];
    for (const segment of feature.segments) {
      const start = segment.start % length;
      const end = start + segment.end - segment.start;
      for (const part of [{ start, end: Math.min(end, length) }, ...(end > length ? [{ start: 0, end: end - length }] : [])]) {
        const previous = segments.at(-1);
        if (previous?.end === part.start) previous.end = part.end;
        else segments.push(part);
      }
    }
    return { ...feature, segments, locationText: '' };
  });
}

export function buildDnaAssemblyRecord(inputs, { name = 'Assembled DNA', minimumOverlap = 15 } = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) fail('fragments');
  if (!String(name).trim()) fail('name');
  const variants = inputs.map(input => ['forward', 'reverse'].map(orientation => orientDnaAssemblyFragment({ ...input,
    record: input.record || input, orientation })));
  let method = 'sticky';
  let topology = 'circular';
  let resolve = createAssemblyResolver(variants, method, minimumOverlap);
  let fragments = resolve(true);
  if (!fragments) {
    fragments = resolve(false);
    topology = 'linear';
  }
  if (!fragments) {
    if (!Number.isInteger(Number(minimumOverlap)) || minimumOverlap < 12 || minimumOverlap > 1000) fail('minimum');
    method = 'overlap-pcr';
    resolve = createAssemblyResolver(variants, method, Number(minimumOverlap));
    fragments = resolve(true);
    topology = 'circular';
    if (fragments) method = 'overlap-assembly';
    else {
      fragments = resolve(false);
      topology = 'linear';
    }
    if (!fragments) fail('compatible', { minimum: minimumOverlap });
  }
  const junctions = [];
  const offsets = [0];
  let sequence = fragments[0].sequence;
  for (let index = 0; index < fragments.length - (topology === 'circular' ? 0 : 1); index++) {
    const left = fragments[index];
    const right = fragments[(index + 1) % fragments.length];
    const overlap = junctionOverlap(left, right, method, minimumOverlap);
    junctions.push({ left: left.name, right: right.name, overlap });
    if (index < fragments.length - 1) {
      offsets.push(sequence.length - overlap);
      sequence += right.sequence.slice(overlap);
    }
  }
  // Only the inputs' own annotations are remapped; fragment provenance stays
  // in the description instead of a full-span feature over every fragment.
  let features = fragments.flatMap((fragment, index) => fragment.features.map((feature, featureIndex) => ({ ...feature,
    id: `assembly-${index}-${featureIndex}-${feature.id || 'feature'}`,
    segments: feature.segments.map(segment => ({ start: segment.start + offsets[index], end: segment.end + offsets[index] })),
    locationText: '' })));
  if (topology === 'circular' && junctions.at(-1).overlap > 0) {
    sequence = sequence.slice(0, -junctions.at(-1).overlap);
    features = wrapAssemblyFeatures(features, sequence.length);
  }
  const digestEnds = method === 'overlap-pcr' ? { left: blunt(), right: blunt() }
    : { left: fragments[0].ends.left, right: fragments.at(-1).ends.right };
  if (topology === 'linear') features.push(...['left', 'right'].map(side => terminalFeature(side, digestEnds[side], sequence.length)));
  return { name: String(name).trim(), sequence, topology, sourceFormat: 'genbank', features, junctions, assemblyMethod: method,
    ...(topology === 'linear' ? { digestEnds } : {}),
    description: `DNA assembly (${method}; ${topology}): ${fragments.map(fragment => `${fragment.name} (${fragment.orientation})`).join(' + ')}.` };
}
