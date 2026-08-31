import { reverseComplementDna } from '../calculations/sequence.js';
import { matchesIupacPattern, normalizeIupacPattern } from '../calculations/crispr.js';
import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeFragment, normalizeHostVector } from './fragments.js';

// Count windows of `sequence` (concrete ACGT) that satisfy `site`. Recognition
// sites may carry IUPAC ambiguity codes (e.g. GTMKAC, CACNNNGTG); normalizeSequence
// would strip those codes and corrupt the motif, so match position-by-position.
export function countSiteMatches(sequence, site) {
  const cleaned = normalizeSequence(sequence);
  const rawSite = String(site || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned.length || !rawSite.length) {
    return 0;
  }

  const pattern = normalizeIupacPattern(rawSite);
  let count = 0;
  for (let index = 0; index + pattern.length <= cleaned.length; index += 1) {
    if (matchesIupacPattern(cleaned.slice(index, index + pattern.length), pattern)) {
      count += 1;
    }
  }
  return count;
}

export function sequenceContainsSite(sequence, site) {
  const cleaned = normalizeSequence(sequence);
  if (countSiteMatches(cleaned, site) > 0) {
    return true;
  }
  // Scan the reverse strand by matching the same pattern against the
  // reverse-complement of the (concrete) insert sequence.
  return countSiteMatches(reverseComplementDna(cleaned), site) > 0;
}

export function circularDistance(totalLength, leftStart, rightStart) {
  const safeLength = Math.max(1, Number(totalLength) || 1);
  const distance = Math.abs((Number(rightStart) || 0) - (Number(leftStart) || 0));
  return Math.min(distance, safeLength - distance);
}

export function normalizeVendorFilter(filter) {
  return {
    neb: filter?.neb !== false,
    thermo: filter?.thermo !== false
  };
}

// Classify a REBASE-style cut pattern as producing a sticky or blunt end. Two
// notations appear in the catalog:
//   - symmetric Type II cutters carry a single '^' inside the site
//     ('G^AATTC' = 4 nt 5' overhang, 'GAT^ATC' = blunt, 'GGTAC^C' = 4 nt 3' overhang)
//   - shifted/Type IIS cutters use 'SITE(top/bottom)' offsets ('CACCTGC(4/8)' = 4 nt overhang)
// An overhang length of 0 is blunt; anything else leaves a sticky overhang.
export function restrictionCutOverhang(cutPattern) {
  const pattern = String(cutPattern || '').toUpperCase().trim();
  if (!pattern) {
    return { type: 'unknown', length: 0 };
  }

  const offsetMatch = pattern.match(/\((-?\d+)\/(-?\d+)\)/);
  if (offsetMatch) {
    const overhang = Number(offsetMatch[2]) - Number(offsetMatch[1]);
    return { type: overhang === 0 ? 'blunt' : 'sticky', length: Math.abs(overhang) };
  }

  const caretIndex = pattern.indexOf('^');
  if (caretIndex >= 0) {
    const siteLength = pattern.replace(/\^/g, '').length;
    const overhang = siteLength - (2 * caretIndex);
    return { type: overhang === 0 ? 'blunt' : 'sticky', length: Math.abs(overhang) };
  }

  return { type: 'unknown', length: 0 };
}

function featureCutPattern(feature) {
  if (feature?.cut) {
    return feature.cut;
  }
  const patterns = asArray(feature?.cutPatterns);
  return patterns.length ? patterns[0] : '';
}

function circularlyEquivalent(leftSequence, rightSequence) {
  const left = normalizeSequence(leftSequence);
  const right = normalizeSequence(rightSequence);
  return left.length === right.length && (!left.length || `${left}${left}`.includes(right));
}

function candidateRecreatesRequestedResult(hostSequence, insertSequence, resultSequence, leftFeature, rightFeature, circular = true) {
  const host = normalizeSequence(hostSequence);
  const insert = normalizeSequence(insertSequence);
  const result = normalizeSequence(resultSequence);
  if (!result.length) {
    return true;
  }
  const ordered = [leftFeature, rightFeature]
    .map((feature) => ({
      start: Number(feature?.segments?.[0]?.start),
      end: Number(feature?.segments?.[0]?.end)
    }))
    .sort((left, right) => left.start - right.start);
  if (!host.length || !insert.length || ordered.some((site) => !Number.isFinite(site.start) || !Number.isFinite(site.end))) {
    return false;
  }
  const [first, second] = ordered;
  // Either arc between the two cutters can be replaced. Preserve both complete
  // recognition sites because the same sites are added to the insert primers.
  const replaceInnerArc = `${host.slice(0, first.end)}${insert}${host.slice(second.start)}`;
  const replaceOuterArc = `${host.slice(first.start, second.end)}${insert}`;
  return circular
    ? circularlyEquivalent(replaceInnerArc, result) || circularlyEquivalent(replaceOuterArc, result)
    : replaceInnerArc === result;
}

export function buildRestrictionCandidatePairs(features, hostLength, inserts, options = {}) {
  const candidates = [];
  const hostSequence = normalizeSequence(options?.hostSequence || '');
  const resultSequence = normalizeSequence(options?.resultSequence || '');
  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const left = features[leftIndex];
      const right = features[rightIndex];
      if (!left?.site || !right?.site || left.site === right.site) {
        continue;
      }
      const leftOverhang = restrictionCutOverhang(featureCutPattern(left));
      const rightOverhang = restrictionCutOverhang(featureCutPattern(right));
      if (leftOverhang.type === 'unknown' || rightOverhang.type === 'unknown') {
        continue;
      }
      const leftStart = Number(left?.segments?.[0]?.start);
      const leftEnd = Number(left?.segments?.[0]?.end);
      const rightStart = Number(right?.segments?.[0]?.start);
      const rightEnd = Number(right?.segments?.[0]?.end);
      if (
        Number.isFinite(leftStart)
        && Number.isFinite(leftEnd)
        && Number.isFinite(rightStart)
        && Number.isFinite(rightEnd)
        && leftStart < rightEnd
        && rightStart < leftEnd
      ) {
        continue;
      }

      const rejectedInsert = inserts.find((fragment) => (
        sequenceContainsSite(fragment.sequence, left.site) || sequenceContainsSite(fragment.sequence, right.site)
      ));
      if (rejectedInsert) {
        continue;
      }
      if (resultSequence && !candidateRecreatesRequestedResult(
        hostSequence,
        inserts[0]?.sequence,
        resultSequence,
        left,
        right,
        options?.circular !== false
      )) {
        continue;
      }

      const distance = circularDistance(hostLength, left?.segments?.[0]?.start, right?.segments?.[0]?.start);
      // Sticky-overhang cutters ligate directionally and far more efficiently than
      // blunt ones, so reward them heavily over the proximity tie-breaker.
      const stickyBonus = leftOverhang.type === 'sticky' ? 1 : 0;
      const rightStickyBonus = rightOverhang.type === 'sticky' ? 1 : 0;
      const score = (stickyBonus + rightStickyBonus) * 1000 - distance;

      candidates.push({
        feasible: true,
        left,
        right,
        score,
        distance,
        insertWarnings: []
      });
    }
  }

  return candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    return String(left.left?.name || '').localeCompare(String(right.left?.name || ''));
  });
}


export function evaluateRestrictionLigation(args = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(args?.config || args?.preferences || {})
  };
  const host = args?.host ? normalizeHostVector(args.host, 0) : null;
  const fragments = args?.fragmentMap?.fragments || args?.fragments || [];
  const inserts = asArray(fragments)
    .map((fragment, index) => normalizeFragment(fragment, index))
    .filter((fragment) => String(fragment?.role || fragment?.type || '').toLowerCase() !== 'backbone');

  if (!host || !host.sequence.length || inserts.length !== 1) {
    return {
      feasible: false,
      selectedSites: null,
      candidatePairs: [],
      warnings: ['Restriction-ligation requires one host backbone and exactly one insert fragment.'],
      reason: 'Missing host backbone or a single insert fragment.'
    };
  }

  // buildCommercialRestrictionFeatures only emits enzymes that cut the backbone
  // exactly once, so every candidate site here is already a guaranteed unique cutter.
  const hostFeatures = buildCommercialRestrictionFeatures(host.sequence, host.topology, {
    vendorFilter: normalizeVendorFilter(config.vendorFilter)
  }).filter((feature) => String(feature?.type || '').toLowerCase() === 'restriction_site');

  if (!hostFeatures.length) {
    return {
      feasible: false,
      selectedSites: null,
      candidatePairs: [],
      warnings: ['No unique commercial restriction sites were identified on the host backbone.'],
      reason: 'No usable restriction sites were found.'
    };
  }

  const requestedResult = normalizeSequence(args?.resultSequence || args?.fragmentMap?.resultSequence || '');
  const candidates = buildRestrictionCandidatePairs(hostFeatures, host.sequence.length, inserts, {
    hostSequence: host.sequence,
    resultSequence: requestedResult,
    circular: host.topology !== 'linear'
  });
  const candidatePairs = candidates.slice(0, 5).map((candidate) => ({
    enzymes: [
      candidate.left?.name || candidate.left?.site,
      candidate.right?.name || candidate.right?.site
    ],
    sites: [
      candidate.left?.site,
      candidate.right?.site
    ],
    distance: candidate.distance
  }));

  if (!candidates.length) {
    return {
      feasible: false,
      selectedSites: null,
      candidatePairs,
      warnings: [requestedResult
        ? 'No unique restriction-site pair recreates the requested final sequence after replacing one backbone arc with the insert.'
        : 'Every candidate restriction-site pair conflicts with the insert fragment.'],
      reason: requestedResult
        ? 'No restriction digest-ligation product matches the requested result sequence.'
        : 'No clean host-only restriction-site pair was found.'
    };
  }

  const selected = candidates[0];
  return {
    feasible: true,
    selectedSites: [selected.left, selected.right],
    candidatePairs,
    warnings: [],
    reason: 'Suitable unique restriction sites were identified on the host backbone.'
  };
}
