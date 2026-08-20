import { translateDnaCodon } from './calculations/sequence.js';
import { normalizeFeatureType } from './feature-types.js';
import { cleanText, normalizeSequenceText, reverseComplementIupac } from './shared.js';

// Primer names read like a bench label, in the order a bench scientist says
// them: what the primer adds, what it targets, then the direction.
//
//   EcoRI His F   added site, added tag
//   GST APA2 R    fusion partner, insert
//   MPM2 A34J F   gene, amino-acid substitution
//   vector R      the backbone half of the same assembly
//
// Engine-level names (mutagenesis_F, gg_backbone_R, ApoI_F) stay as they are;
// this renames the finished plan, where the record and the construct are known.

const CODING_FEATURE_TYPES = new Set(['cds', 'gene', 'open_reading_frame']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function featureSegments(feature) {
  return asArray(feature?.segments)
    .map((segment) => ({
      start: Math.max(0, Math.round(Number(segment?.start) || 0)),
      end: Math.max(0, Math.round(Number(segment?.end) || 0))
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
}

// The smallest coding feature over the edit — a CDS inside a gene names the
// protein the mutation is actually reported against.
function findCodingFeatureAt(record, index) {
  return asArray(record?.features)
    .map((feature) => ({ feature, segments: featureSegments(feature) }))
    .filter(({ feature, segments }) => (
      segments.length
      && CODING_FEATURE_TYPES.has(normalizeFeatureType(feature?.type, ''))
      && segments.some((segment) => index >= segment.start && index < segment.end)
    ))
    .sort((left, right) => (
      left.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
      - right.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
    ))[0] || null;
}

function codingSequenceOf(sequence, segments, strand) {
  const joined = segments.map((segment) => sequence.slice(segment.start, segment.end)).join('');
  return strand === -1 ? reverseComplementIupac(joined) : joined;
}

// Position of a genomic index along the spliced coding strand.
function codingIndexOf(segments, strand, index) {
  let seen = 0;
  let found = -1;
  segments.forEach((segment) => {
    if (index >= segment.start && index < segment.end) {
      found = seen + (index - segment.start);
    }
    seen += segment.end - segment.start;
  });
  if (found < 0) {
    return -1;
  }
  return strand === -1 ? seen - 1 - found : found;
}

// "MPM2 A34J" for a coding substitution, "MPM2 G156A" when the protein does not
// change, "MPM2 del9" / "MPM2 ins9" for length changes.
export function describeEditTarget({ record, originalSequence, editRequest } = {}) {
  const edited = normalizeSequenceText(record?.sequence || '');
  const original = normalizeSequenceText(originalSequence || '');
  const start = Math.max(0, Math.round(Number(editRequest?.start) || 1) - 1);
  const originalEdit = normalizeSequenceText(editRequest?.originalSequence || '');
  const editedEdit = normalizeSequenceText(editRequest?.editedSequence || '');
  const coding = findCodingFeatureAt(record, start);
  const gene = cleanText(coding?.feature?.name, 60) || cleanText(record?.name, 60);

  if (!edited.length || originalEdit.length !== editedEdit.length) {
    const delta = Math.abs(editedEdit.length - originalEdit.length);
    const change = editedEdit.length > originalEdit.length ? `ins${delta}` : `del${delta}`;
    return { gene, mutation: delta ? change : '' };
  }

  // Equal-length edit: the record's coordinates still address both sequences, so
  // the same codon can be pulled from each and translated.
  const nucleotideChange = original.length === edited.length && original[start] && edited[start]
    ? `${original[start]}${start + 1}${edited[start]}`
    : '';
  if (!coding) {
    return { gene, mutation: nucleotideChange };
  }

  const strand = Number(coding.feature?.strand) === -1 ? -1 : 1;
  const codingIndex = codingIndexOf(coding.segments, strand, start);
  if (codingIndex < 0) {
    return { gene, mutation: nucleotideChange };
  }

  const residue = Math.floor(codingIndex / 3);
  const codonAt = (sequence) => codingSequenceOf(sequence, coding.segments, strand)
    .slice(residue * 3, residue * 3 + 3);
  const wild = translateDnaCodon(codonAt(original));
  const mutant = translateDnaCodon(codonAt(edited));
  if (!wild || !mutant || wild === mutant) {
    return { gene, mutation: nucleotideChange };
  }
  return { gene, mutation: `${wild}${residue + 1}${mutant}` };
}

function directionOf(primer) {
  const role = String(primer?.role || '').toLowerCase();
  if (role.includes('reverse')) {
    return 'R';
  }
  if (role.includes('forward')) {
    return 'F';
  }
  return /[_ ]R$/.test(String(primer?.name || '')) ? 'R' : 'F';
}

function isBackbonePrimer(primer, base, context) {
  const role = String(primer?.role || '').toLowerCase();
  return role.includes('backbone')
    || /backbone$/i.test(base)
    || base.toLowerCase() === 'gg_backbone'
    || asArray(context?.backboneNames).some((name) => cleanText(name, 160) && base === cleanText(name, 160));
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let suffix = 2;
  while (used.has(`${name} ${suffix}`)) {
    suffix += 1;
  }
  const next = `${name} ${suffix}`;
  used.add(next);
  return next;
}

// context: { targetLabel, gene, mutation, enzyme, tags: { start, end }, backboneNames }
export function renamePrimers(primers, context = {}) {
  const used = new Set();
  return asArray(primers).map((primer) => {
    const base = String(primer?.name || '').replace(/[_ ]([FR])$/, '');
    const role = String(primer?.role || '').toLowerCase();
    const direction = directionOf(primer);
    const tags = context?.tags || {};

    if (isBackbonePrimer(primer, base, context)) {
      const enzyme = role.includes('restriction') || role.includes('golden-gate')
        ? cleanText(context?.enzyme, 40)
        : '';
      return { ...primer, name: uniqueName([enzyme, 'vector', direction].filter(Boolean).join(' '), used) };
    }

    const isMutagenesis = role.includes('mutagenesis');
    // A restriction primer is named for the site it carries; the engine already
    // put that enzyme in the base name.
    const enzyme = role.includes('restriction')
      ? base
      : (role.includes('golden-gate') ? cleanText(context?.enzyme, 40) : '');
    const tag = cleanText(direction === 'R' ? tags.end : tags.start, 40);
    const fallbackTarget = /^(gg_insert|q5|mutagenesis|selection)$/i.test(base) ? '' : base;
    const target = isMutagenesis
      ? (cleanText(context?.gene, 60) || cleanText(context?.targetLabel, 60))
      : (cleanText(context?.targetLabel, 60) || fallbackTarget);
    const mutation = isMutagenesis ? cleanText(context?.mutation, 40) : '';

    const parts = [enzyme, tag, target, mutation, direction]
      .map((part) => cleanText(part, 60))
      .filter((part, index, list) => part && list.indexOf(part) === index);
    return { ...primer, name: uniqueName(parts.join(' '), used) };
  });
}
