import { normalizeSequenceText, normalizeTopology, reverseComplementIupac } from './shared.js';
import { isPrimerBindingFeature } from './feature-types.js';

const mod = (value, length) => ((value % length) + length) % length;
const sliceTemplate = (record, start, end) => (normalizeTopology(record.topology) === 'circular'
  ? record.sequence + record.sequence : record.sequence).slice(start, end);

// All ranges are zero-based, end-exclusive. Circular ranges may cross the
// origin, but a fragment never contains more than one copy of the template.
export function buildDnaFragmentRecord(template, range, name = '') {
  const sequence = normalizeSequenceText(template?.sequence || '');
  const length = sequence.length;
  const start = Number(range?.start);
  let end = Number(range?.end);
  const circular = normalizeTopology(template?.topology) === 'circular';
  if (circular && end < start) end += length;
  if (!length || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || start >= length || end <= start || end - start > length || (!circular && end > length)) {
    throw new Error('Select a valid DNA range before saving a fragment.');
  }
  const windows = [{ start, end: Math.min(end, length), offset: -start }];
  if (end > length) windows.push({ start: 0, end: end - length, offset: length - start });
  const features = (template.features || []).flatMap(feature => {
    const original = feature.segments || [];
    const segments = original.flatMap(segment => windows.flatMap(window => {
      const left = Math.max(segment.start, window.start);
      const right = Math.min(segment.end, window.end);
      return right > left ? [{ start: left + window.offset, end: right + window.offset }] : [];
    }));
    if (!segments.length) return [];
    const originalLength = original.reduce((sum, segment) => sum + segment.end - segment.start, 0);
    const retainedLength = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
    const partial = originalLength !== retainedLength;
    const qualifiers = { ...feature.qualifiers };
    // These qualifiers contain coordinates or a translation of the old CDS.
    delete qualifiers.transl_except;
    if (partial) {
      delete qualifiers.translation;
      qualifiers.partial = 'true';
      // Keep the frame of a CDS clipped at its coding start.
      const traversal = feature.strand === -1 ? [...original].reverse() : original;
      let removed = 0;
      for (const segment of traversal) {
        const kept = windows.map(window => ({ start: Math.max(segment.start, window.start), end: Math.min(segment.end, window.end) }))
          .filter(part => part.end > part.start);
        if (kept.length) {
          removed += feature.strand === -1
            ? segment.end - Math.max(...kept.map(part => part.end))
            : Math.min(...kept.map(part => part.start)) - segment.start;
          break;
        }
        removed += segment.end - segment.start;
      }
      if (String(feature.type).toLowerCase() === 'cds') {
        qualifiers.codon_start = String(mod((Number(qualifiers.codon_start) || 1) - 1 - removed, 3) + 1);
      }
    }
    return [{ ...feature, segments, qualifiers, locationText: '', ...(partial ? { translation: '' } : {}) }];
  });
  return {
    name: name.trim() || `${template.name || 'DNA'}_${start + 1}-${mod(end - 1, length) + 1}`,
    sequence: sliceTemplate({ ...template, sequence }, start, end),
    topology: 'linear', sourceFormat: 'genbank', features,
    description: `Fragment of ${template.name || 'DNA'}, bases ${start + 1}..${mod(end - 1, length) + 1}.`
  };
}

// An annotated site chooses a particular copy on repetitive templates. For a
// pasted oligo, use its longest exact 3′ match and require an unambiguous site.
export function resolveFragmentPrimer(template, primer, strand) {
  const sequence = normalizeSequenceText(template?.sequence || '');
  const length = sequence.length;
  const circular = normalizeTopology(template?.topology) === 'circular';
  const search = circular ? sequence + sequence : sequence;
  let oligo = normalizeSequenceText(primer?.primerSequence || primer?.sequence || '');
  if (Array.isArray(primer?.segments) && primer.segments.length) {
    if ((primer.strand === -1 ? -1 : 1) !== strand) throw new Error('Choose primers on opposite strands.');
    const parts = primer.segments.map(part => ({ start: Number(part.start), end: Number(part.end) }))
      .sort((a, b) => a.start - b.start);
    if (parts.some(part => !Number.isInteger(part.start) || !Number.isInteger(part.end)
      || part.start < 0 || part.end > length || part.end <= part.start)) throw new Error('Invalid primer binding site.');
    const merged = [];
    for (const part of parts) {
      const previous = merged.at(-1);
      if (previous && part.start <= previous.end) previous.end = Math.max(previous.end, part.end);
      else merged.push({ ...part });
    }
    let start = merged[0].start;
    let end = merged[0].end;
    if (merged.length === 2 && circular && merged[0].start === 0 && merged[1].end === length) {
      start = merged[1].start;
      end = length + merged[0].end;
    } else if (merged.length !== 1) throw new Error('The primer must have one contiguous binding site.');
    const binding = search.slice(start, end);
    const oriented = strand === -1 ? reverseComplementIupac(binding) : binding;
    oligo ||= oriented;
    if (oligo.length < end - start) throw new Error('The primer oligo is shorter than its annotated binding site.');
    const terminalLength = Math.min(8, oriented.length);
    if (oligo.slice(-terminalLength) !== oriented.slice(-terminalLength)) {
      throw new Error('The primer’s 3′ end does not match its annotated template site.');
    }
    return { start, end, sequence: oligo, name: primer.name || 'Primer', strand };
  }
  if (!/^[ACGT]{12,}$/.test(oligo)) throw new Error('Enter a primer with at least 12 A, C, G or T bases (5′ to 3′).');
  for (let size = Math.min(oligo.length, length); size >= 12; size--) {
    const suffix = oligo.slice(-size);
    const target = strand === -1 ? reverseComplementIupac(suffix) : suffix;
    const sites = [];
    for (let at = search.indexOf(target); at >= 0 && at < length; at = search.indexOf(target, at + 1)) {
      sites.push(at);
      if (sites.length > 1) break;
    }
    if (sites.length > 1) throw new Error('This primer matches multiple sites. Choose an annotated primer binding site.');
    if (sites.length === 1) return { start: sites[0], end: sites[0] + size, sequence: oligo, name: primer.name || 'Primer', strand };
  }
  throw new Error('No matching 3′ primer binding site was found on this template.');
}

export function buildPcrFragmentRecord(template, forwardPrimer, reversePrimer, name = '') {
  template = { ...template, sequence: normalizeSequenceText(template?.sequence || '') };
  const forward = resolveFragmentPrimer(template, forwardPrimer, 1);
  const reverse = resolveFragmentPrimer(template, reversePrimer, -1);
  const length = template.sequence.length;
  if (normalizeTopology(template.topology) === 'circular' && reverse.start < forward.start) {
    reverse.start += length;
    reverse.end += length;
  }
  if (reverse.start < forward.start || reverse.end < forward.end || reverse.end - forward.start > length) {
    throw new Error('These primers do not face inward along a valid template fragment.');
  }
  const product = buildDnaFragmentRecord(template, { start: forward.start, end: reverse.end }, name || `${template.name || 'DNA'}_PCR`);
  const reverseOligo = reverseComplementIupac(reverse.sequence);
  const overlap = forward.end - reverse.start;
  if (overlap > 0 && forward.sequence.slice(-overlap) !== reverseOligo.slice(0, overlap)) {
    throw new Error('The overlapping primer sequences disagree.');
  }
  product.sequence = forward.sequence + (overlap > 0
    ? reverseOligo.slice(overlap)
    : sliceTemplate(template, forward.end, reverse.start) + reverseOligo);
  const offset = forward.sequence.length - (forward.end - forward.start);
  product.features = product.features.filter(feature => !isPrimerBindingFeature(feature.type)).map(feature => {
    const segments = feature.segments.map(segment => ({ start: segment.start + offset, end: segment.end + offset }));
    const qualifiers = { ...feature.qualifiers };
    // Primers can introduce substitutions. Recompute CDS translations on read.
    delete qualifiers.translation;
    return { ...feature, segments, qualifiers, locationText: '', translation: '' };
  });
  product.features.push(...[forward, reverse].map((primer, index) => ({
    id: `pcr-primer-${index}`, name: primer.name, type: 'primer_bind', strand: primer.strand,
    primerSequence: primer.sequence, source: 'manual',
    segments: [{ start: index ? product.sequence.length - primer.sequence.length : 0,
      end: index ? product.sequence.length : primer.sequence.length }]
  })));
  product.description = `PCR product of ${template.name || 'DNA'} with ${forward.name} and ${reverse.name}.`;
  return product;
}
