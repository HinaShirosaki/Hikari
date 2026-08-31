import { clamp, reverseComplementIupac } from './shared.js';

// Designed primers were only ever shown in a table, so nothing put them on the
// map. Every design path now writes them back as primer_bind features, which
// the existing Primers toggle already knows how to show and hide.
export const PRIMER_FEATURE_SOURCE = 'primer_design';

// Uppercase and U->T are length-preserving, so indices found here still address
// the stored sequence.
function searchableSequence(value) {
  return String(value || '').toUpperCase().replace(/U/g, 'T');
}

// Only the binding region anneals, so a 5' tail (overhang or restriction site)
// must not be annotated. Mutagenesis primers are the exception: they carry the
// edit inside the oligo, so their binding half matches no template and the full
// primer is what lands on the edited construct. Try the narrower one first.
function bindingCandidates(primer) {
  const clean = (value) => searchableSequence(value).replace(/[^A-Z]/g, '');
  return [clean(primer?.bindingSequence), clean(primer?.sequence)]
    .filter((candidate, index, list) => candidate.length >= 8 && list.indexOf(candidate) === index);
}

function primerFeatureId(name, index, used) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = `primer_bind_${slug || `primer_${index + 1}`}`;
  return used.has(base) ? `${base}_${index + 1}` : base;
}

function locateBinding(sequence, binding, isCircular) {
  // A primer on a plasmid can straddle the origin, so search a wrapped copy.
  const haystack = isCircular && binding.length > 1
    ? sequence + sequence.slice(0, binding.length - 1)
    : sequence;
  const matches = [];
  const limit = isCircular ? sequence.length : Math.max(0, sequence.length - binding.length + 1);
  const reverseBinding = reverseComplementIupac(binding);
  for (let start = 0; start < limit; start += 1) {
    if (haystack.slice(start, start + binding.length) === binding) {
      matches.push({ start, strand: 1 });
    }
    if (reverseBinding !== binding && haystack.slice(start, start + binding.length) === reverseBinding) {
      matches.push({ start, strand: -1 });
    }
  }
  if (matches.length !== 1) {
    return matches.length ? { ambiguous: true, count: matches.length } : null;
  }
  return matches[0];
}

function segmentsFor(start, length, sequenceLength) {
  const end = start + length;
  return end <= sequenceLength
    ? [{ start, end }]
    : [{ start, end: sequenceLength }, { start: 0, end: end - sequenceLength }];
}

function describePrimer(primer, matchedLength) {
  const role = String(primer?.role || 'primer').replace(/[-_]+/g, ' ');
  const tm = Number(primer?.tm);
  const tail = Math.max(0, String(primer?.sequence || '').length - matchedLength);
  return [
    `Designed ${role}`,
    Number.isFinite(tm) && tm > 0 ? `Tm ${tm.toFixed(1)} C` : '',
    tail ? `${tail} nt 5' tail not annotated` : ''
  ].filter(Boolean).join(' | ');
}

// Returns the record's features with a primer_bind feature per placed primer.
// Re-running a design replaces its own features instead of stacking duplicates.
export function withPrimerBindFeatures(record, primers) {
  const sequence = searchableSequence(record?.sequence || '');
  const isCircular = String(record?.topology || '').toLowerCase() !== 'linear';
  const existing = Array.isArray(record?.features) ? record.features : [];
  const safePrimers = Array.isArray(primers) ? primers : [];
  const used = new Set();
  const added = [];
  const unplaced = [];
  const ambiguous = [];

  safePrimers.forEach((primer, index) => {
    const name = String(primer?.name || '').trim() || `Primer ${index + 1}`;
    let hit = null;
    let binding = '';
    let ambiguousHit = false;
    for (const candidate of (sequence.length ? bindingCandidates(primer) : [])) {
      hit = locateBinding(sequence, candidate, isCircular);
      binding = candidate;
      if (hit?.ambiguous) {
        ambiguous.push({ name, count: hit.count });
        ambiguousHit = true;
        hit = null;
        break;
      }
      if (hit) {
        break;
      }
    }
    if (!hit) {
      if (!ambiguousHit) {
        unplaced.push(name);
      }
      return;
    }
    const id = primerFeatureId(name, index, used);
    used.add(id);
    added.push({
      id,
      name,
      type: 'primer_bind',
      strand: hit.strand,
      source: PRIMER_FEATURE_SOURCE,
      // The oligo as ordered, tail included: the feature only spans the part
      // that matches here, but the hover readout has to show the whole primer.
      primerSequence: searchableSequence(primer?.sequence || '') || binding,
      description: describePrimer(primer, binding.length),
      locationText: '',
      segments: segmentsFor(hit.start, binding.length, sequence.length)
    });
  });

  return {
    // Drop every feature this module previously placed, not just the ids this run
    // happens to regenerate -- renaming a primer between designs would otherwise
    // leave the old annotation behind forever.
    features: [...existing.filter((feature) => feature?.source !== PRIMER_FEATURE_SOURCE), ...added],
    added,
    unplaced,
    ambiguous
  };
}

// Writes the primer features onto the selected record and saves it. Returns the
// number of primers placed so callers can fold it into their status line.
export async function annotatePrimersOnSelectedRecord({
  state,
  primers,
  persistFeatureMutation,
  label = 'Added designed primers to the sequence.'
} = {}) {
  const records = Array.isArray(state?.records) ? [...state.records] : [];
  const index = clamp(state?.selectedRecordIndex, 0, Math.max(0, records.length - 1));
  const record = records[index];
  if (!record) {
    return 0;
  }

  const { features, added } = withPrimerBindFeatures(record, primers);
  if (!added.length) {
    return 0;
  }

  const nextRecord = { ...record, features };
  records[index] = nextRecord;
  state.records = records;
  // Feature indices shifted, so any prior selection now points at the wrong row.
  state.selectedFeatureIndex = -1;
  if (typeof persistFeatureMutation === 'function') {
    await persistFeatureMutation(nextRecord, label);
  }
  return added.length;
}
