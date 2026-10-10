import { reverseComplementDna } from '../calculations/sequence.js';
import { cloningPrimerTm } from '../calculations/oligo.js';
import { CLONING_PRIMER_TM_THRESHOLDS, DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, describeAmbiguousDna, normalizeSequence } from './sequence-utils.js';
import { buildPrimerRecord } from './primer-records.js';
import { countPrimerBindingSites, evaluatePrimerQuality } from './primer-quality.js';

// Insert preparation belongs to the primer plan. Alternating strands overlap
// their neighbors, self-prime to make dsDNA, then the route's outer PCR pair
// amplifies that intermediate with its normal cloning tails.
export function designOligoAssembly(fragment, thresholds, config = {}) {
  const sequence = normalizeSequence(fragment?.sequence);
  const name = String(fragment?.name || 'Insert').trim();
  const maxLength = Math.floor(Number(config.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const minOverlap = Math.max(15, Number(thresholds.primerLength.min));
  const maxOverlap = Math.min(maxLength - 1, Number(thresholds.primerLength.max));
  const ambiguity = describeAmbiguousDna(fragment?.sequence, name);
  const failure = () => ({ feasible: false, primers: [], warnings: [ambiguity || `Unable to cover ${name} with complementary overlapping oligos within the ${maxLength} nt limit and overlap Tm window. Adjust the sequence or primer limits before ordering.`] });
  if (ambiguity || sequence.length < minOverlap || maxLength <= minOverlap) return failure();

  const overlapCache = new Map();
  const qualityCache = new Map();
  const failed = new Set();
  const overlapsAt = (end) => {
    if (!overlapCache.has(end)) {
      const candidates = [];
      for (let length = minOverlap; length <= Math.min(maxOverlap, end); length += 1) {
        const overlap = sequence.slice(end - length, end);
        const tm = cloningPrimerTm(overlap);
        if (tm >= thresholds.overlapTm.min && tm <= thresholds.overlapTm.max
          && countPrimerBindingSites(sequence, overlap) === 1) {
          candidates.push({ length, sequence: overlap, tm });
        }
      }
      candidates.sort((a, b) => a.length - b.length);
      overlapCache.set(end, candidates);
    }
    return overlapCache.get(end);
  };
  const usable = (start, end, reverse) => {
    const key = `${start}:${end}:${reverse}`;
    if (!qualityCache.has(key)) {
      const bases = sequence.slice(start, end);
      qualityCache.set(key, !evaluatePrimerQuality(reverse ? reverseComplementDna(bases) : bases).blockingWarnings.length);
    }
    return qualityCache.get(key);
  };
  // A state is an incoming overlap, rather than every possible oligo length.
  // This DAG search can backtrack around difficult windows without exploring
  // the same downstream tiling once for each upstream primer length.
  const extend = (start, reverse, incoming = null) => {
    if (reverse && sequence.length - start <= maxLength && usable(start, sequence.length, reverse)) {
      return [{ start, end: sequence.length, reverse, incoming }];
    }
    const key = `${start}:${reverse}:${incoming?.length || 0}`;
    if (failed.has(key)) return null;
    const incomingEnd = start + (incoming?.length || 0);
    for (let end = Math.min(sequence.length - 1, start + maxLength); end > incomingEnd + minOverlap; end -= 1) {
      for (const overlap of overlapsAt(end)) {
        // Leave a distinct core between successive overlaps, so non-neighbor
        // oligos cannot displace the intended annealing partner.
        const nextStart = end - overlap.length;
        if (nextStart <= incomingEnd || !usable(start, end, reverse)) continue;
        const remaining = extend(nextStart, !reverse, overlap);
        if (remaining) return [{ start, end, reverse, incoming, outgoing: overlap }, ...remaining];
      }
    }
    failed.add(key);
    return null;
  };
  let tiles = extend(0, false);
  // A short insert can be supplied by a fully complementary oligo pair.
  if (!tiles && sequence.length <= maxLength) {
    const tm = cloningPrimerTm(sequence);
    if (tm >= thresholds.overlapTm.min && tm <= thresholds.overlapTm.max
      && usable(0, sequence.length, false) && usable(0, sequence.length, true)) {
      const overlap = { sequence, length: sequence.length, tm };
      tiles = [{ start: 0, end: sequence.length, reverse: false, outgoing: overlap },
        { start: 0, end: sequence.length, reverse: true, incoming: overlap }];
    }
  }
  if (!tiles) return failure();

  const primers = tiles.map((tile, index) => {
    const bases = sequence.slice(tile.start, tile.end);
    const binding = tile.reverse ? reverseComplementDna(tile.incoming.sequence) : tile.outgoing.sequence;
    return {
      ...buildPrimerRecord({
        name: `${name} oligo ${index + 1}`,
        role: tile.reverse ? 'insert-oligo-reverse' : 'insert-oligo-forward',
        sequence: tile.reverse ? reverseComplementDna(bases) : bases,
        bindingSequence: binding,
        groupLabel: `${name} oligo assembly`,
        ampliconLength: sequence.length,
        templateId: fragment.id,
        warnings: [`Covers insert bases ${tile.start + 1}–${tile.end} on the ${tile.reverse ? 'reverse' : 'forward'} strand; use in the template-free oligo assembly reaction.`]
      }),
      pcrStage: 'oligo-assembly',
      template_kind: 'oligo_pool',
      templateEntryId: '',
      coverageStart: tile.start,
      coverageEnd: tile.end,
      overlapSummary: tile.outgoing ? [{ overlapSequence: tile.outgoing.sequence, overlapLength: tile.outgoing.length, overlapTm: tile.outgoing.tm, overlapGroup: `${fragment.id || name} oligo assembly` }] : []
    };
  });
  return { feasible: true, primers, warnings: [] };
}

// A hard sequence is a note on the plan, not a dead end: an insert that cannot
// be tiled into quality-clean oligos is ordered as synthetic DNA, which is what
// the route did before oligo preparation existed.
export function prepareUntemplatedInsert(fragment, templateDesign, thresholds, config) {
  if (!templateDesign?.requiresOligoAssembly) return { prepared: false, primers: [], warnings: [] };
  // The oligo pool is annealed in its own tube, so it picks its own overlap
  // window instead of failing a route whose primers clear a stricter one.
  let design = designOligoAssembly(fragment, thresholds, config);
  for (const level of Object.values(CLONING_PRIMER_TM_THRESHOLDS)) {
    if (design.feasible) break;
    design = designOligoAssembly(fragment, level, config);
  }
  if (design.feasible) return { prepared: true, primers: design.primers, warnings: [] };
  return {
    prepared: false,
    primers: [],
    warnings: [
      ...asArray(design.warnings),
      `${String(fragment?.name || 'Insert').trim()} must be ordered as synthetic DNA before assembly; the listed primers assume that synthesized fragment is available.`
    ]
  };
}

export function withOligoAssemblyTemplate(primers, preparation, fragment) {
  if (!preparation.prepared) return primers;
  return primers.map((primer) => ({
    ...primer,
    template_kind: 'hypothetical_intermediate',
    templateEntryId: '',
    templateSourceLabel: `${fragment.name || 'Insert'} oligo assembly product`,
    warnings: [...asArray(primer.warnings), 'Amplify from the oligo assembly product after preparing the insert; no donor template is used.']
  }));
}

export function prependOligoAssemblySteps(steps, primers) {
  const groups = new Map();
  asArray(primers).filter((primer) => primer.pcrStage === 'oligo-assembly').forEach((primer) => {
    if (!groups.has(primer.groupLabel)) groups.set(primer.groupLabel, []);
    groups.get(primer.groupLabel).push(primer);
  });
  return [...groups.entries()].map(([label, oligos]) => ({
    title: `Prepare ${label}`,
    details: `Order the ${oligos.length} overlapping oligos listed under ${label}. Combine them in a template-free overlap-extension reaction to build the ${oligos[0].ampliconLength} bp insert. Use that product as the template for the separate outer-primer PCR below, then purify the full-length amplicon before cloning.`
  })).concat(asArray(steps)).map((step, index) => ({ ...step, step: index + 1 }));
}
