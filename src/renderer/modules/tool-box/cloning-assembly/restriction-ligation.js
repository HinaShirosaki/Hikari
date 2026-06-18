import { reverseComplementDna } from '../sequence.js';
import { buildCommercialRestrictionFeatures } from '../../sequence-viewer/restriction-analysis.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeFragment, normalizeHostVector } from './fragments.js';

export function countSiteMatches(sequence, site) {
  const cleaned = normalizeSequence(sequence);
  const motif = normalizeSequence(site);
  if (!cleaned.length || !motif.length) {
    return 0;
  }

  let count = 0;
  for (let index = 0; index <= cleaned.length - motif.length; index += 1) {
    if (cleaned.slice(index, index + motif.length) === motif) {
      count += 1;
    }
  }
  return count;
}

export function sequenceContainsSite(sequence, site) {
  const motif = normalizeSequence(site);
  if (!motif.length) {
    return false;
  }
  if (countSiteMatches(sequence, motif) > 0) {
    return true;
  }
  const reverseSite = reverseComplementDna(motif);
  if (reverseSite === motif) {
    return false;
  }
  return countSiteMatches(sequence, reverseSite) > 0;
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

export function buildRestrictionCandidatePairs(features, hostLength, inserts) {
  const candidates = [];
  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const left = features[leftIndex];
      const right = features[rightIndex];
      if (!left?.site || !right?.site || left.site === right.site) {
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

      const distance = circularDistance(hostLength, left?.segments?.[0]?.start, right?.segments?.[0]?.start);
      // Sticky-overhang cutters ligate directionally and far more efficiently than
      // blunt ones, so reward them heavily over the proximity tie-breaker.
      const stickyBonus = restrictionCutOverhang(featureCutPattern(left)).type === 'sticky' ? 1 : 0;
      const rightStickyBonus = restrictionCutOverhang(featureCutPattern(right)).type === 'sticky' ? 1 : 0;
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

  if (!host || !host.sequence.length || !inserts.length) {
    return {
      feasible: false,
      selectedSites: null,
      candidatePairs: [],
      warnings: ['Restriction-ligation requires a host backbone and at least one insert fragment.'],
      reason: 'Missing host backbone or insert fragment.'
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

  const candidates = buildRestrictionCandidatePairs(hostFeatures, host.sequence.length, inserts);
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
      warnings: ['Every candidate restriction-site pair conflicts with at least one insert fragment.'],
      reason: 'No clean host-only restriction-site pair was found.'
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
