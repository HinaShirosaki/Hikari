import { reverseComplementDna } from '../calculations/sequence.js';
import { matchesIupacPattern, normalizeIupacPattern } from '../calculations/crispr.js';
import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, circularSlice, describeAmbiguousDna, normalizeIupacSequence, normalizeSequence } from './sequence-utils.js';
import { normalizeFragment, normalizeHostVector } from './fragments.js';

// Count windows of `sequence` (concrete ACGT) that satisfy `site`. Recognition
// sites may carry IUPAC ambiguity codes (e.g. GTMKAC, CACNNNGTG); normalizeSequence
// would strip those codes and corrupt the motif, so match position-by-position.
function countSiteMatches(sequence, site, circular = false) {
  const cleaned = normalizeSequence(sequence);
  const rawSite = String(site || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned.length || !rawSite.length) {
    return 0;
  }

  const pattern = normalizeIupacPattern(rawSite);
  if (!circular && pattern.length > cleaned.length) {
    return 0;
  }
  const limit = circular ? cleaned.length : cleaned.length - pattern.length + 1;
  const scanLength = circular ? cleaned.length + pattern.length - 1 : cleaned.length;
  const scanSequence = circular
    ? cleaned.repeat(Math.ceil(scanLength / cleaned.length)).slice(0, scanLength)
    : cleaned;
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (matchesIupacPattern(scanSequence.slice(index, index + pattern.length), pattern)) {
      count += 1;
    }
  }
  return count;
}

export function sequenceContainsSite(sequence, site, circular = false) {
  const cleaned = normalizeSequence(sequence);
  if (countSiteMatches(cleaned, site, circular) > 0) {
    return true;
  }
  // Scan the reverse strand by matching the same pattern against the
  // reverse-complement of the (concrete) insert sequence.
  return countSiteMatches(reverseComplementDna(cleaned), site, circular) > 0;
}

function circularDistance(totalLength, leftStart, rightStart) {
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
  const patterns = [...new Set(asArray(feature?.cutPatterns).filter(Boolean))];
  // A catalog feature may group isoschizomers that recognize the same site but
  // cut it differently. Do not invent one enzyme/end chemistry by taking the
  // first pattern from an ambiguous group.
  return patterns.length === 1 ? patterns[0] : '';
}

export function expandRestrictionFeatureVariants(feature) {
  if (!feature?.site) {
    return [];
  }
  const directCut = String(feature?.cut || '').trim();
  if (directCut) {
    return [{ ...feature, cut: directCut }];
  }
  return asArray(feature?.enzymes)
    .map((enzyme) => ({
      ...feature,
      ...enzyme,
      site: feature.site,
      segments: asArray(feature?.segments),
      cut: String(enzyme?.cut || '').trim(),
      cutPatterns: [String(enzyme?.cut || '').trim()].filter(Boolean),
      enzymes: [enzyme]
    }))
    .filter((variant) => variant.cut && !variant.cut.includes('?'));
}

export function resolveRestrictionRecognitionSequence(feature, hostSequence) {
  const host = normalizeSequence(hostSequence);
  const site = normalizeIupacSequence(feature?.site || '');
  if (!site.length) {
    return '';
  }
  if (!host.length) {
    return /^[ACGT]+$/.test(site) ? site : '';
  }
  const segments = asArray(feature?.segments)
    .map((segment) => ({
      start: Number(segment?.start),
      end: Number(segment?.end)
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
  let concrete = segments.length ? circularSlice(host, segments[0].start, site.length) : '';
  if (String(feature?.strand || '') === '-1' || Number(feature?.strand) === -1) {
    concrete = reverseComplementDna(concrete);
  }
  return concrete.length === site.length && /^[ACGT]+$/.test(concrete) && matchesIupacPattern(concrete, site)
    ? concrete
    : '';
}

export function restrictionCutEnd(feature, hostSequence = '') {
  const cutPattern = featureCutPattern(feature);
  const caretIndex = cutPattern.indexOf('^');
  const patternSite = normalizeIupacSequence(cutPattern.replace(/\^/g, ''));
  const recognitionSequence = resolveRestrictionRecognitionSequence(feature, hostSequence)
    || (/^[ACGT]+$/.test(patternSite) ? patternSite : '');
  if (caretIndex < 0 || !patternSite.length || recognitionSequence.length !== patternSite.length) {
    return { type: 'unknown', polarity: 'unknown', sequence: '', length: 0 };
  }
  const signedLength = patternSite.length - (2 * caretIndex);
  if (!signedLength) {
    return { type: 'blunt', polarity: 'blunt', sequence: '', length: 0 };
  }
  const start = Math.min(caretIndex, patternSite.length - caretIndex);
  const end = Math.max(caretIndex, patternSite.length - caretIndex);
  return {
    type: 'sticky',
    polarity: signedLength > 0 ? '5-prime' : '3-prime',
    sequence: recognitionSequence.slice(start, end),
    length: Math.abs(signedLength)
  };
}

export function restrictionEndsAreCrossCompatible(leftEnd, rightEnd) {
  if (leftEnd.type === 'blunt' && rightEnd.type === 'blunt') {
    return true;
  }
  return leftEnd.type === 'sticky'
    && rightEnd.type === 'sticky'
    && leftEnd.polarity === rightEnd.polarity
    && leftEnd.sequence === rightEnd.sequence;
}

function circularlyEquivalent(leftSequence, rightSequence) {
  const left = normalizeSequence(leftSequence);
  const right = normalizeSequence(rightSequence);
  return left.length === right.length && (!left.length || `${left}${left}`.includes(right));
}

function matchCandidateToRequestedResult(hostSequence, insertSequence, resultSequence, leftFeature, rightFeature, circular = true) {
  const host = normalizeSequence(hostSequence);
  const insert = normalizeSequence(insertSequence);
  const result = normalizeSequence(resultSequence);
  const orderedFeatures = [leftFeature, rightFeature].sort((left, right) => (
    Number(left?.segments?.[0]?.start) - Number(right?.segments?.[0]?.start)
  ));
  if (!result.length) {
    return {
      matches: true,
      forwardFeature: orderedFeatures[0],
      reverseFeature: orderedFeatures[1],
      replacedArc: 'unspecified'
    };
  }
  const ordered = orderedFeatures
    .map((feature) => ({
      start: Number(feature?.segments?.[0]?.start),
      end: Number(feature?.segments?.[0]?.end)
    }))
    .sort((left, right) => left.start - right.start);
  if (!host.length || !insert.length || ordered.some((site) => !Number.isFinite(site.start) || !Number.isFinite(site.end))) {
    return { matches: false };
  }
  const [first, second] = ordered;
  // Either arc between the two cutters can be replaced. Preserve both complete
  // recognition sites because the same sites are added to the insert primers.
  const replaceInnerArc = `${host.slice(0, first.end)}${insert}${host.slice(second.start)}`;
  const replaceOuterArc = `${host.slice(first.start, second.end)}${insert}`;
  const innerMatches = circular
    ? circularlyEquivalent(replaceInnerArc, result)
    : replaceInnerArc === result;
  if (innerMatches) {
    return {
      matches: true,
      forwardFeature: orderedFeatures[0],
      reverseFeature: orderedFeatures[1],
      replacedArc: 'inner'
    };
  }
  if (circular && circularlyEquivalent(replaceOuterArc, result)) {
    // The retained vector arc runs first -> second, so the insert closes the
    // circle from the second cutter back to the first cutter.
    return {
      matches: true,
      forwardFeature: orderedFeatures[1],
      reverseFeature: orderedFeatures[0],
      replacedArc: 'outer'
    };
  }
  return { matches: false };
}

export function buildRestrictionCandidatePairs(features, hostLength, inserts, options = {}) {
  const candidates = [];
  const hostSequence = normalizeSequence(options?.hostSequence || '');
  const resultSequence = normalizeSequence(options?.resultSequence || '');
  const concreteFeatures = asArray(features).flatMap(expandRestrictionFeatureVariants);
  for (let leftIndex = 0; leftIndex < concreteFeatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concreteFeatures.length; rightIndex += 1) {
      const left = concreteFeatures[leftIndex];
      const right = concreteFeatures[rightIndex];
      if (!left?.site || !right?.site || left.site === right.site) {
        continue;
      }
      // Conventional restriction-ligation adds the complete recognition site to
      // each PCR primer. Offset cutters belong in the Type IIS/Golden Gate route.
      if (!featureCutPattern(left).includes('^') || !featureCutPattern(right).includes('^')) {
        continue;
      }
      const leftCutEnd = restrictionCutEnd(left, hostSequence);
      const rightCutEnd = restrictionCutEnd(right, hostSequence);
      if (leftCutEnd.type === 'unknown' || rightCutEnd.type === 'unknown') {
        continue;
      }
      // The two vector ends must not ligate to one another. BamHI/BglII is the
      // classic counterexample: different sites, but both expose 5'-GATC.
      if (restrictionEndsAreCrossCompatible(leftCutEnd, rightCutEnd)) {
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
      const resultMatch = matchCandidateToRequestedResult(
        hostSequence,
        inserts[0]?.sequence,
        resultSequence,
        left,
        right,
        options?.circular !== false
      );
      if (resultSequence && !resultMatch.matches) {
        continue;
      }

      const distance = circularDistance(hostLength, left?.segments?.[0]?.start, right?.segments?.[0]?.start);
      // Sticky-overhang cutters ligate directionally and far more efficiently than
      // blunt ones, so reward them heavily over the proximity tie-breaker.
      const stickyEnds = (leftCutEnd.type === 'sticky' ? 1 : 0) + (rightCutEnd.type === 'sticky' ? 1 : 0);
      const score = stickyEnds * 1000 - distance;

      candidates.push({
        feasible: true,
        left: {
          ...resultMatch.forwardFeature,
          cutEnd: restrictionCutEnd(resultMatch.forwardFeature, hostSequence)
        },
        right: {
          ...resultMatch.reverseFeature,
          cutEnd: restrictionCutEnd(resultMatch.reverseFeature, hostSequence)
        },
        replacedArc: resultMatch.replacedArc,
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
  const fragments = args?.fragmentMap?.fragments || args?.fragments || [];
  const ambiguityWarnings = [
    describeAmbiguousDna(args?.host?.sequence, `Host vector ${args?.host?.name || ''}`.trim()),
    describeAmbiguousDna(args?.resultSequence || args?.fragmentMap?.resultSequence, 'Designed result'),
    ...asArray(fragments).map((fragment, index) => (
      describeAmbiguousDna(fragment?.sequence, `Fragment ${fragment?.name || index + 1}`)
    ))
  ].filter(Boolean);
  if (ambiguityWarnings.length) {
    return {
      feasible: false,
      selectedSites: null,
      candidatePairs: [],
      warnings: ambiguityWarnings,
      reason: 'Ambiguous DNA input must be resolved before restriction-ligation design.'
    };
  }
  const host = args?.host ? normalizeHostVector(args.host, 0) : null;
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
    distance: candidate.distance,
    cutEnds: [candidate.left?.cutEnd, candidate.right?.cutEnd]
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
    warnings: ['Confirm both enzymes are active in one manufacturer-recommended buffer and share compatible incubation/heat-inactivation conditions; otherwise digest sequentially and purify between enzymes.'],
    reason: 'Suitable unique restriction sites with non-cross-compatible vector ends were identified on the host backbone.'
  };
}
