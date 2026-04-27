import { cleanNucleotideSequence, reverseComplementDna } from './sequence.js';
import { oligoTm } from './oligo.js';
import { buildCommercialRestrictionFeatures } from '../sequence-viewer/restriction-analysis.js';

const SUPPORTED_EDIT_TYPES = new Set([
  'point-mutation',
  'insertion',
  'deletion',
  'replacement'
]);

const DEFAULT_VENDOR_FILTER = Object.freeze({
  neb: true,
  thermo: true
});

const DEFAULT_GIBSON_MIN_FRAGMENT_COUNT = 2;
const DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT = 2;
const DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH = 12;
const DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH = 40;

export const CLONING_PRIMER_TM_THRESHOLDS = Object.freeze({
  strict: Object.freeze({
    primerLength: Object.freeze({ min: 18, max: 32 }),
    primerTm: Object.freeze({ min: 58, max: 64 }),
    maxPrimerTmDifference: 2,
    overlapTm: Object.freeze({ min: 60, max: 68 }),
    maxOverlapTmDifference: 2
  }),
  moderate: Object.freeze({
    primerLength: Object.freeze({ min: 16, max: 36 }),
    primerTm: Object.freeze({ min: 56, max: 66 }),
    maxPrimerTmDifference: 4,
    overlapTm: Object.freeze({ min: 58, max: 70 }),
    maxOverlapTmDifference: 4
  }),
  relaxed: Object.freeze({
    primerLength: Object.freeze({ min: 15, max: 40 }),
    primerTm: Object.freeze({ min: 54, max: 68 }),
    maxPrimerTmDifference: 6,
    overlapTm: Object.freeze({ min: 56, max: 72 }),
    maxOverlapTmDifference: 6
  })
});

export const DEFAULT_CLONING_PREFERENCES = Object.freeze({
  allowRestrictionLigation: true,
  preferRestrictionLigation: true,
  preferGibsonForMultiFragment: true,
  maxPrimerEncodedInsertionAA: 30,
  maxPrimerLength: 60,
  requireUniqueRestrictionSites: true,
  topology: 'circular',
  vendorFilter: DEFAULT_VENDOR_FILTER,
  primerClampSequence: 'GCGC',
  minEngineeredOverlapLength: DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH,
  maxEngineeredOverlapLength: DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSequence(raw) {
  return cleanNucleotideSequence(raw, 'DNA');
}

function normalizeTopology(value) {
  return String(value || '').toLowerCase() === 'linear' ? 'linear' : 'circular';
}

function normalizeOrientation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'reverse' || normalized === 'reverse-complement' || normalized === 'reverse_complement') {
    return 'reverse';
  }
  return 'forward';
}

function computeGcContent(sequence) {
  const cleaned = normalizeSequence(sequence);
  if (!cleaned.length) {
    return 0;
  }
  const gc = [...cleaned].reduce((sum, base) => sum + ((base === 'G' || base === 'C') ? 1 : 0), 0);
  return (gc / cleaned.length) * 100;
}

function clampIndex(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function mean(values) {
  const numbers = asArray(values).filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return 0;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function createMidpoint(range) {
  return (Number(range?.min) + Number(range?.max)) / 2;
}

function commonPrefixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (matched < safeMax && safeLeft[matched] === safeRight[matched]) {
    matched += 1;
  }
  return matched;
}

function commonSuffixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    safeLeft.length,
    safeRight.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );
  let matched = 0;
  while (
    matched < safeMax
    && safeLeft[safeLeft.length - 1 - matched] === safeRight[safeRight.length - 1 - matched]
  ) {
    matched += 1;
  }
  return matched;
}

function circularSlice(sequence, start, length) {
  const cleaned = normalizeSequence(sequence);
  const totalLength = cleaned.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!totalLength || !desiredLength) {
    return '';
  }

  let cursor = ((Math.round(Number(start) || 0) % totalLength) + totalLength) % totalLength;
  let remaining = desiredLength;
  let result = '';

  while (remaining > 0) {
    const chunkLength = Math.min(remaining, totalLength - cursor);
    result += cleaned.slice(cursor, cursor + chunkLength);
    remaining -= chunkLength;
    cursor = 0;
  }

  return result;
}

function buildStableFragmentId(prefix, index) {
  return `${prefix}_${index + 1}`;
}

function normalizeFragment(fragment, index) {
  const orientation = normalizeOrientation(fragment?.orientation);
  const baseSequence = normalizeSequence(fragment?.sequence || '');
  const sequence = orientation === 'reverse'
    ? reverseComplementDna(baseSequence)
    : baseSequence;
  const type = String(fragment?.type || '').trim().toLowerCase() || 'insert';

  return {
    id: String(fragment?.id || buildStableFragmentId('fragment', index)),
    name: String(fragment?.name || fragment?.id || buildStableFragmentId('fragment', index)).trim() || buildStableFragmentId('fragment', index),
    type,
    orientation,
    metadata: fragment?.metadata && typeof fragment.metadata === 'object'
      ? { ...fragment.metadata }
      : {},
    sequence
  };
}

function normalizeHostVector(host, index) {
  return {
    id: String(host?.id || buildStableFragmentId('host', index)),
    name: String(host?.name || host?.id || buildStableFragmentId('host', index)).trim() || buildStableFragmentId('host', index),
    topology: normalizeTopology(host?.topology || DEFAULT_CLONING_PREFERENCES.topology),
    sequence: normalizeSequence(host?.sequence || '')
  };
}

function longestTerminalOverlap(leftSequence, rightSequence, maxLength = Number.POSITIVE_INFINITY) {
  const left = normalizeSequence(leftSequence);
  const right = normalizeSequence(rightSequence);
  const safeMax = Math.min(
    left.length,
    right.length,
    Number.isFinite(maxLength) ? Math.max(0, Math.round(maxLength)) : Number.MAX_SAFE_INTEGER
  );

  for (let length = safeMax; length >= 1; length -= 1) {
    const suffix = left.slice(left.length - length);
    const prefix = right.slice(0, length);
    if (suffix === prefix) {
      return {
        sequence: suffix,
        length
      };
    }
  }

  return {
    sequence: '',
    length: 0
  };
}

function candidateScore(tm, midpoint, length, preferredLength) {
  return Math.abs(tm - midpoint) + (Math.abs(length - preferredLength) * 0.25);
}

function selectBindingWindow(sequence, direction, thresholds, tailLength = 0, config = DEFAULT_CLONING_PREFERENCES) {
  const cleaned = normalizeSequence(sequence);
  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const minLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxLength = Math.min(
    cleaned.length,
    Number(thresholds?.primerLength?.max) || cleaned.length,
    Math.max(0, maxPrimerLength - Math.max(0, Number(tailLength) || 0))
  );

  if (maxLength < minLength) {
    return null;
  }

  const preferredTm = createMidpoint(thresholds?.primerTm);
  const preferredLength = createMidpoint(thresholds?.primerLength);
  let best = null;

  for (let length = minLength; length <= maxLength; length += 1) {
    const bindingSource = direction === 'reverse'
      ? cleaned.slice(Math.max(0, cleaned.length - length))
      : cleaned.slice(0, length);
    const bindingSequence = direction === 'reverse'
      ? reverseComplementDna(bindingSource)
      : bindingSource;
    const tm = oligoTm(bindingSequence, 'DNA');
    if (tm < thresholds.primerTm.min || tm > thresholds.primerTm.max) {
      continue;
    }
    const score = candidateScore(tm, preferredTm, length, preferredLength);
    if (!best || score < best.score) {
      best = {
        bindingSequence,
        sourceSequence: bindingSource,
        length,
        tm,
        gcContent: computeGcContent(bindingSequence),
        score
      };
    }
  }

  return best;
}

function selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const leftSequence = normalizeSequence(leftFragment?.sequence || '');
  const rightSequence = normalizeSequence(rightFragment?.sequence || '');
  const maxTailLength = Math.min(
    rightSequence.length,
    Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength) - Number(thresholds?.primerLength?.min || 0),
    Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
  );
  const minLength = Math.min(
    maxTailLength,
    Math.max(1, Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH)
  );
  const preferredTm = createMidpoint(thresholds?.overlapTm);

  let best = null;
  for (let length = minLength; length <= maxTailLength; length += 1) {
    const overlapSequence = rightSequence.slice(0, length);
    const overlapTm = oligoTm(overlapSequence, 'DNA');
    if (overlapTm < thresholds.overlapTm.min || overlapTm > thresholds.overlapTm.max) {
      continue;
    }
    const leftBinding = selectBindingWindow(leftSequence, 'reverse', thresholds, length, config);
    if (!leftBinding) {
      continue;
    }
    const score = Math.abs(overlapTm - preferredTm) + Math.abs(length - minLength) * 0.1;
    if (!best || score < best.score) {
      best = {
        sequence: overlapSequence,
        length,
        tm: overlapTm,
        gcContent: computeGcContent(overlapSequence),
        leftBinding,
        score
      };
    }
  }

  return best;
}

function evaluateJunction(leftFragment, rightFragment, thresholds, config = DEFAULT_CLONING_PREFERENCES) {
  const natural = longestTerminalOverlap(leftFragment?.sequence || '', rightFragment?.sequence || '');
  const naturalTm = natural.length ? oligoTm(natural.sequence, 'DNA') : 0;
  const naturalGc = natural.length ? computeGcContent(natural.sequence) : 0;
  if (
    natural.length
    && naturalTm >= thresholds.overlapTm.min
    && naturalTm <= thresholds.overlapTm.max
  ) {
    return {
      feasible: true,
      mode: 'existing',
      overlapSequence: natural.sequence,
      overlapLength: natural.length,
      overlapTm: naturalTm,
      overlapGcContent: naturalGc,
      warnings: []
    };
  }

  const engineered = selectEngineeredOverlap(leftFragment, rightFragment, thresholds, config);
  if (engineered) {
    const warnings = [];
    if (natural.length && naturalTm < thresholds.overlapTm.min) {
      warnings.push('Existing terminal overlap is too weak; engineered primer overlap is recommended.');
    } else if (!natural.length) {
      warnings.push('No terminal overlap is present; a primer-introduced overlap is required.');
    }
    return {
      feasible: true,
      mode: 'primer-introduced',
      overlapSequence: engineered.sequence,
      overlapLength: engineered.length,
      overlapTm: engineered.tm,
      overlapGcContent: engineered.gcContent,
      leftBindingTm: engineered.leftBinding?.tm || 0,
      warnings
    };
  }

  return {
    feasible: false,
    mode: natural.length ? 'weak-existing' : 'missing',
    overlapSequence: natural.sequence,
    overlapLength: natural.length,
    overlapTm: naturalTm,
    overlapGcContent: naturalGc,
    warnings: [
      natural.length
        ? 'Existing overlap does not reach the required Tm range and no primer-compatible engineered overlap was found.'
        : 'No terminal overlap is present and no primer-compatible engineered overlap was found.'
    ]
  };
}

function buildJunctionPairs(fragments, circular = false) {
  const list = asArray(fragments);
  const pairs = [];
  if (list.length < 2) {
    return pairs;
  }
  for (let index = 0; index < list.length - 1; index += 1) {
    pairs.push({
      left: list[index],
      right: list[index + 1],
      wrapAround: false
    });
  }
  if (circular) {
    pairs.push({
      left: list[list.length - 1],
      right: list[0],
      wrapAround: true
    });
  }
  return pairs;
}

function evaluateFragmentAssembly(fragments, options = {}) {
  const normalizedFragments = asArray(fragments).map((fragment, index) => normalizeFragment(fragment, index));
  const circular = Boolean(options?.circular);
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(options?.preferences || {})
  };
  const thresholds = options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict;
  const pairs = buildJunctionPairs(normalizedFragments, circular);
  const junctions = pairs.map((pair) => {
    const evaluation = evaluateJunction(pair.left, pair.right, thresholds, config);
    return {
      leftFragmentId: pair.left.id,
      leftFragmentName: pair.left.name,
      rightFragmentId: pair.right.id,
      rightFragmentName: pair.right.name,
      wrapAround: pair.wrapAround,
      ...evaluation
    };
  });

  const warnings = junctions.flatMap((junction) => asArray(junction.warnings));
  return {
    fragments: normalizedFragments,
    junctions,
    feasible: junctions.length > 0 && junctions.every((junction) => junction.feasible),
    warnings
  };
}

function countSiteMatches(sequence, site) {
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

function sequenceContainsSite(sequence, site) {
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

function circularDistance(totalLength, leftStart, rightStart) {
  const safeLength = Math.max(1, Number(totalLength) || 1);
  const distance = Math.abs((Number(rightStart) || 0) - (Number(leftStart) || 0));
  return Math.min(distance, safeLength - distance);
}

function normalizeVendorFilter(filter) {
  return {
    neb: filter?.neb !== false,
    thermo: filter?.thermo !== false
  };
}

function buildRestrictionCandidatePairs(features, hostLength, inserts, config) {
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
      const stickyBonus = String(left?.cut || '').includes('^') ? 1 : 0;
      const rightStickyBonus = String(right?.cut || '').includes('^') ? 1 : 0;
      const score = (stickyBonus + rightStickyBonus) * 1000 - distance;

      candidates.push({
        feasible: true,
        left,
        right,
        score,
        distance,
        insertWarnings: [],
        requiresUniqueRestrictionSites: Boolean(config?.requireUniqueRestrictionSites)
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

function commonCircularCoverage(hostSequence, querySequence, hostStart, queryStart) {
  const hostLength = hostSequence.length;
  const queryLength = querySequence.length;
  const rotatedHost = circularSlice(hostSequence, hostStart, hostLength);
  const rotatedQuery = circularSlice(querySequence, queryStart, queryLength);
  const prefixLength = commonPrefixLength(rotatedHost, rotatedQuery, hostLength);
  const suffixLength = Math.min(
    commonSuffixLength(rotatedHost, rotatedQuery, hostLength),
    Math.max(0, hostLength - prefixLength)
  );

  return {
    prefixLength,
    suffixLength,
    backboneCoverage: prefixLength + suffixLength
  };
}

function scoreHostVectorAgainstResult(hostSequence, resultSequence) {
  const host = normalizeSequence(hostSequence);
  const result = normalizeSequence(resultSequence);
  if (!host.length || !result.length) {
    return {
      backboneCoverage: 0,
      hostStart: 0,
      queryStart: 0,
      prefixLength: 0,
      suffixLength: 0
    };
  }

  const hostStep = Math.max(1, Math.floor(host.length / 24));
  const queryStep = Math.max(1, Math.floor(result.length / 24));
  let best = {
    backboneCoverage: 0,
    hostStart: 0,
    queryStart: 0,
    prefixLength: 0,
    suffixLength: 0
  };

  for (let hostStart = 0; hostStart < host.length; hostStart += hostStep) {
    for (let queryStart = 0; queryStart < result.length; queryStart += queryStep) {
      const score = commonCircularCoverage(host, result, hostStart, queryStart);
      if (score.backboneCoverage > best.backboneCoverage) {
        best = {
          ...score,
          hostStart,
          queryStart
        };
      }
    }
  }

  return best;
}

function findSelectedHostVector(hostVectors, resultSequence, hostVectorId = '') {
  const normalizedHosts = asArray(hostVectors)
    .map((host, index) => normalizeHostVector(host, index))
    .filter((host) => host.sequence.length);

  if (!normalizedHosts.length) {
    return null;
  }

  const requestedId = String(hostVectorId || '').trim();
  if (requestedId) {
    return normalizedHosts.find((host) => host.id === requestedId) || null;
  }

  if (normalizedHosts.length === 1) {
    return normalizedHosts[0];
  }

  const normalizedResult = normalizeSequence(resultSequence);
  if (!normalizedResult.length) {
    return normalizedHosts[0];
  }

  return [...normalizedHosts]
    .map((host) => ({
      host,
      score: scoreHostVectorAgainstResult(host.sequence, normalizedResult)
    }))
    .sort((left, right) => {
      if (right.score.backboneCoverage !== left.score.backboneCoverage) {
        return right.score.backboneCoverage - left.score.backboneCoverage;
      }
      return String(left.host.name || '').localeCompare(String(right.host.name || ''));
    })[0]?.host || normalizedHosts[0];
}

function normalizeEditRequest(editRequest, templateSequence = '') {
  if (!editRequest || typeof editRequest !== 'object') {
    return null;
  }

  const type = String(editRequest.type || '').trim().toLowerCase();
  if (!SUPPORTED_EDIT_TYPES.has(type)) {
    return null;
  }

  const template = normalizeSequence(templateSequence);
  const originalSequence = normalizeSequence(editRequest.originalSequence || '');
  const editedSequence = normalizeSequence(editRequest.editedSequence || '');
  const position = Number.isFinite(Number(editRequest.position)) ? Math.round(Number(editRequest.position)) : null;
  let start = Number.isFinite(Number(editRequest.start)) ? Math.round(Number(editRequest.start)) : null;
  let end = Number.isFinite(Number(editRequest.end)) ? Math.round(Number(editRequest.end)) : null;

  if (!Number.isFinite(start) && Number.isFinite(position)) {
    start = type === 'insertion' ? position : position;
  }
  if (!Number.isFinite(end) && Number.isFinite(start)) {
    if (type === 'insertion') {
      end = start;
    } else if (originalSequence.length) {
      end = start + originalSequence.length - 1;
    } else if (editedSequence.length) {
      end = start + editedSequence.length - 1;
    } else {
      end = start;
    }
  }

  if ((!Number.isFinite(start) || !Number.isFinite(end)) && originalSequence.length && template.length) {
    const matchIndex = template.indexOf(originalSequence);
    if (matchIndex >= 0) {
      start = matchIndex + 1;
      end = matchIndex + originalSequence.length;
    }
  }

  const startIndex = Number.isFinite(start) ? clampIndex(start - 1, 0, template.length) : 0;
  const endIndex = Number.isFinite(end)
    ? clampIndex(end, startIndex, template.length)
    : clampIndex(startIndex + originalSequence.length, startIndex, template.length);

  return {
    type,
    position: Number.isFinite(position) ? position : null,
    start: Number.isFinite(start) ? start : (startIndex + 1),
    end: Number.isFinite(end) ? end : endIndex,
    startIndex,
    endIndex,
    originalSequence: originalSequence || template.slice(startIndex, endIndex),
    editedSequence,
    size: Math.max(0, Number(editRequest.size) || editedSequence.length || originalSequence.length)
  };
}

function buildOrderedFragmentMap({ host, fragments, resultSequence, editRequest }) {
  const orderedFragments = [];
  if (host) {
    orderedFragments.push({
      id: 'host_backbone',
      name: host.name,
      role: 'backbone',
      type: 'backbone',
      orientation: 'forward',
      sequence: host.sequence,
      topology: host.topology,
      metadata: {}
    });
  }

  asArray(fragments).forEach((fragment) => {
    orderedFragments.push({
      id: fragment.id,
      name: fragment.name,
      role: fragment.type === 'backbone' ? 'backbone' : 'insert',
      type: fragment.type,
      orientation: fragment.orientation,
      sequence: fragment.sequence,
      metadata: { ...fragment.metadata }
    });
  });

  return {
    fragments: orderedFragments,
    fragmentCount: orderedFragments.length,
    resultSequence: normalizeSequence(resultSequence),
    editSummary: editRequest
      ? {
          type: editRequest.type,
          start: editRequest.start,
          end: editRequest.end,
          size: editRequest.size
        }
      : null
  };
}

function buildPrimerRecord({ name, role, sequence, tailSequence = '', bindingSequence = '', warnings = [] }) {
  const safeSequence = normalizeSequence(sequence);
  const safeTail = normalizeSequence(tailSequence);
  const safeBinding = normalizeSequence(bindingSequence);
  const tmTarget = safeBinding.length ? safeBinding : safeSequence;

  return {
    name: String(name || '').trim() || 'primer',
    role: String(role || '').trim() || 'primer',
    sequence: safeSequence,
    tailSequence: safeTail,
    bindingSequence: safeBinding,
    tm: tmTarget.length ? oligoTm(tmTarget, 'DNA') : 0,
    length: safeSequence.length,
    gcContent: computeGcContent(safeSequence),
    warnings: asArray(warnings).filter(Boolean)
  };
}

function summarizePrimerPlan(primers, overlaps = []) {
  const safePrimers = asArray(primers);
  const tmValues = safePrimers.map((primer) => Number(primer?.tm) || 0);
  const sortedTm = [...tmValues].sort((left, right) => left - right);
  const primerTmDifferences = [];
  for (let index = 1; index < sortedTm.length; index += 1) {
    primerTmDifferences.push(Math.abs(sortedTm[index] - sortedTm[index - 1]));
  }

  return {
    primerCount: safePrimers.length,
    primerOrder: safePrimers.map((primer) => primer.name),
    primerTmSummary: {
      min: safePrimers.length ? sortedTm[0] : 0,
      max: safePrimers.length ? sortedTm[sortedTm.length - 1] : 0,
      mean: mean(tmValues)
    },
    primerTmDifferences,
    overlapSummary: asArray(overlaps).map((item) => ({
      leftFragmentId: item.leftFragmentId,
      rightFragmentId: item.rightFragmentId,
      overlapLength: item.overlapLength,
      overlapTm: item.overlapTm,
      mode: item.mode
    }))
  };
}

function buildRouteWarnings(result) {
  return asArray(result?.warnings).filter(Boolean);
}

function designRestrictionLigationPrimers(fragmentMap, restrictionEvaluation, thresholds, config) {
  const inserts = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone');
  const selectedSites = asArray(restrictionEvaluation?.selectedSites);
  if (!inserts.length || selectedSites.length < 2) {
    return {
      feasible: false,
      warnings: ['Restriction-ligation primer design requires at least one insert and two selected restriction sites.']
    };
  }

  const insert = inserts[0];
  const clampSequence = normalizeSequence(config?.primerClampSequence || DEFAULT_CLONING_PREFERENCES.primerClampSequence);
  const forwardTail = `${clampSequence}${normalizeSequence(selectedSites[0].site || '')}`;
  const reverseTail = `${clampSequence}${normalizeSequence(selectedSites[1].site || '')}`;
  const forwardBinding = selectBindingWindow(insert.sequence, 'forward', thresholds, forwardTail.length, config);
  const reverseBinding = selectBindingWindow(insert.sequence, 'reverse', thresholds, reverseTail.length, config);

  if (!forwardBinding || !reverseBinding) {
    return {
      feasible: false,
      warnings: ['Unable to find insert-binding primer windows compatible with the selected restriction tails.']
    };
  }

  const primers = [
    buildPrimerRecord({
      name: `${insert.name}_F`,
      role: 'restriction-forward',
      sequence: `${forwardTail}${forwardBinding.bindingSequence}`,
      tailSequence: forwardTail,
      bindingSequence: forwardBinding.bindingSequence,
      warnings: [`Adds ${selectedSites[0].name || selectedSites[0].site} to the 5' end.`]
    }),
    buildPrimerRecord({
      name: `${insert.name}_R`,
      role: 'restriction-reverse',
      sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
      tailSequence: reverseTail,
      bindingSequence: reverseBinding.bindingSequence,
      warnings: [`Adds ${selectedSites[1].name || selectedSites[1].site} to the 5' end.`]
    })
  ];

  return {
    feasible: true,
    primers,
    warnings: []
  };
}

function designAssemblyPrimersForRoute(fragments, junctions, thresholds, config) {
  const safeFragments = asArray(fragments);
  const safeJunctions = asArray(junctions);
  const primers = [];
  const warnings = [];

  safeFragments.forEach((fragment, index) => {
    const nextJunction = safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && !junction.wrapAround)
      || safeJunctions.find((junction) => junction.leftFragmentId === fragment.id && junction.wrapAround);
    const reverseTail = nextJunction && nextJunction.mode === 'primer-introduced'
      ? normalizeSequence(nextJunction.overlapSequence)
      : '';
    const forwardBinding = selectBindingWindow(fragment.sequence, 'forward', thresholds, 0, config);
    const reverseBinding = selectBindingWindow(fragment.sequence, 'reverse', thresholds, reverseTail.length, config);

    if (!forwardBinding || !reverseBinding) {
      warnings.push(`Unable to find compatible binding windows for ${fragment.name}.`);
      return;
    }

    primers.push(
      buildPrimerRecord({
        name: `${fragment.name}_F`,
        role: index === 0 ? 'assembly-forward-start' : 'assembly-forward',
        sequence: forwardBinding.bindingSequence,
        bindingSequence: forwardBinding.bindingSequence,
        warnings: []
      })
    );
    primers.push(
      buildPrimerRecord({
        name: `${fragment.name}_R`,
        role: nextJunction?.mode === 'primer-introduced' ? 'assembly-reverse-overlap' : 'assembly-reverse',
        sequence: `${reverseTail}${reverseBinding.bindingSequence}`,
        tailSequence: reverseTail,
        bindingSequence: reverseBinding.bindingSequence,
        warnings: nextJunction?.mode === 'primer-introduced'
          ? [`Carries a ${nextJunction.overlapLength} nt overlap into ${nextJunction.rightFragmentName}.`]
          : []
      })
    );
  });

  if (!primers.length || warnings.length) {
    return {
      feasible: false,
      primers,
      warnings: warnings.length ? warnings : ['Unable to design a complete assembly primer set.']
    };
  }

  return {
    feasible: true,
    primers,
    warnings: []
  };
}

function findMutagenesisWindow(flankSequence, side, thresholds, targetBudget) {
  const cleaned = normalizeSequence(flankSequence);
  if (!cleaned.length) {
    return null;
  }

  const minLength = Math.max(1, Number(thresholds?.primerLength?.min) || 1);
  const maxLength = Math.min(cleaned.length, Math.max(minLength, targetBudget));
  const preferredTm = createMidpoint(thresholds?.primerTm);
  let best = null;

  for (let length = minLength; length <= maxLength; length += 1) {
    const sequence = side === 'left'
      ? cleaned.slice(cleaned.length - length)
      : cleaned.slice(0, length);
    const tm = oligoTm(sequence, 'DNA');
    if (tm < thresholds.primerTm.min || tm > thresholds.primerTm.max) {
      continue;
    }
    const score = Math.abs(tm - preferredTm) + Math.abs(length - minLength) * 0.1;
    if (!best || score < best.score) {
      best = {
        sequence,
        tm,
        length,
        score
      };
    }
  }

  return best;
}

function designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const template = normalizeSequence(templateSequence);
  const leftFlank = template.slice(0, normalizedEdit.startIndex);
  const rightFlank = template.slice(normalizedEdit.endIndex);
  const replacement = normalizedEdit.type === 'deletion'
    ? ''
    : normalizeSequence(normalizedEdit.editedSequence || '');
  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);

  for (let availableFlank = Math.max(0, maxPrimerLength - replacement.length); availableFlank >= Number(thresholds.primerLength.min || 0); availableFlank -= 1) {
    const leftBudget = Math.max(1, Math.floor(availableFlank / 2));
    const rightBudget = Math.max(1, availableFlank - leftBudget);
    const leftWindow = findMutagenesisWindow(leftFlank, 'left', thresholds, leftBudget);
    const rightWindow = findMutagenesisWindow(rightFlank, 'right', thresholds, rightBudget);
    if (!leftWindow || !rightWindow) {
      continue;
    }
    const forwardSequence = `${leftWindow.sequence}${replacement}${rightWindow.sequence}`;
    if (forwardSequence.length > maxPrimerLength) {
      continue;
    }
    const forwardTm = oligoTm(forwardSequence, 'DNA');
    if (forwardTm < thresholds.primerTm.min || forwardTm > thresholds.primerTm.max) {
      continue;
    }

    const reverseSequence = reverseComplementDna(forwardSequence);
    return {
      feasible: true,
      primers: [
        buildPrimerRecord({
          name: 'mutagenesis_F',
          role: 'mutagenesis-forward',
          sequence: forwardSequence,
          tailSequence: replacement,
          bindingSequence: `${leftWindow.sequence}${rightWindow.sequence}`,
          warnings: []
        }),
        buildPrimerRecord({
          name: 'mutagenesis_R',
          role: 'mutagenesis-reverse',
          sequence: reverseSequence,
          tailSequence: reverseComplementDna(replacement),
          bindingSequence: reverseComplementDna(`${leftWindow.sequence}${rightWindow.sequence}`),
          warnings: []
        })
      ],
      warnings: []
    };
  }

  return {
    feasible: false,
    warnings: ['No simple mutagenesis primer pair satisfied the current threshold set.']
  };
}

function buildOverlappingWindows(sequence, maxWindowLength, overlapLength) {
  const cleaned = normalizeSequence(sequence);
  if (!cleaned.length || maxWindowLength <= 0) {
    return [];
  }

  const windows = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + maxWindowLength);
    windows.push({
      start,
      end,
      sequence: cleaned.slice(start, end)
    });
    if (end >= cleaned.length) {
      break;
    }
    const nextStart = end - overlapLength;
    if (nextStart <= start) {
      return [];
    }
    start = nextStart;
  }
  return windows;
}

function designTiledInsertionOligos(templateSequence, normalizedEdit, thresholds, config) {
  const template = normalizeSequence(templateSequence);
  const insertedSequence = normalizeSequence(normalizedEdit.editedSequence || '');
  const leftFlank = template.slice(0, normalizedEdit.startIndex);
  const rightFlank = template.slice(normalizedEdit.endIndex);
  if (!insertedSequence.length) {
    return {
      feasible: false,
      warnings: ['Multi-primer tiling only applies to edits that insert DNA.']
    };
  }

  const maxPrimerLength = Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength);
  const leftAnchor = findMutagenesisWindow(leftFlank, 'left', thresholds, Math.min(maxPrimerLength, Number(thresholds?.primerLength?.max) || maxPrimerLength));
  const rightAnchor = findMutagenesisWindow(rightFlank, 'right', thresholds, Math.min(maxPrimerLength, Number(thresholds?.primerLength?.max) || maxPrimerLength));
  if (!leftAnchor || !rightAnchor) {
    return {
      feasible: false,
      warnings: ['Failed to locate left/right anchor windows for tiled insertion design.']
    };
  }

  const maxWindowLength = Math.max(
    Number(thresholds?.primerLength?.max) || 0,
    maxPrimerLength - Math.max(leftAnchor.length, rightAnchor.length)
  );

  for (let overlapLength = Number(config?.minEngineeredOverlapLength) || DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH;
    overlapLength <= Math.min(insertedSequence.length - 1, Number(config?.maxEngineeredOverlapLength) || DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH);
    overlapLength += 1) {
    const windows = buildOverlappingWindows(insertedSequence, maxWindowLength, overlapLength);
    if (windows.length < 2) {
      continue;
    }

    const overlapSummary = [];
    let overlapsValid = true;
    for (let index = 0; index < windows.length - 1; index += 1) {
      const left = windows[index].sequence;
      const right = windows[index + 1].sequence;
      const overlap = longestTerminalOverlap(left, right, overlapLength);
      const overlapTm = oligoTm(overlap.sequence, 'DNA');
      if (
        overlap.length !== overlapLength
        || overlapTm < thresholds.overlapTm.min
        || overlapTm > thresholds.overlapTm.max
      ) {
        overlapsValid = false;
        break;
      }
      overlapSummary.push({
        leftFragmentId: index === 0 ? 'tile_outer_left' : `tile_${index}`,
        rightFragmentId: index === windows.length - 2 ? 'tile_outer_right' : `tile_${index + 1}`,
        overlapSequence: overlap.sequence,
        overlapLength: overlap.length,
        overlapTm,
        mode: 'tiled-insert'
      });
    }

    if (!overlapsValid) {
      continue;
    }

    const firstSequence = `${leftAnchor.sequence}${windows[0].sequence}`;
    const lastSequence = `${windows[windows.length - 1].sequence}${rightAnchor.sequence}`;
    if (firstSequence.length > maxPrimerLength || lastSequence.length > maxPrimerLength) {
      continue;
    }

    const primers = [
      buildPrimerRecord({
        name: 'tile_outer_left',
        role: 'mutagenesis-outer-left',
        sequence: firstSequence,
        tailSequence: windows[0].sequence,
        bindingSequence: leftAnchor.sequence,
        warnings: []
      }),
      ...windows.slice(1, -1).map((window, index) => buildPrimerRecord({
        name: `tile_${index + 1}`,
        role: 'insert-tile',
        sequence: window.sequence,
        tailSequence: window.sequence.slice(0, overlapLength),
        bindingSequence: window.sequence.slice(overlapLength),
        warnings: []
      })),
      buildPrimerRecord({
        name: 'tile_outer_right',
        role: 'mutagenesis-outer-right',
        sequence: lastSequence,
        tailSequence: windows[windows.length - 1].sequence.slice(-overlapLength),
        bindingSequence: rightAnchor.sequence,
        warnings: []
      })
    ];

    return {
      feasible: true,
      primers,
      overlapSummary,
      warnings: ['Long insertion uses multi-primer tiling rather than a single primer pair.']
    };
  }

  return {
    feasible: false,
    warnings: ['Unable to find a tiled insertion design that satisfies the current overlap and primer thresholds.']
  };
}

function designMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config) {
  const simpleDesign = designSimpleMutagenesisPrimers(templateSequence, normalizedEdit, thresholds, config);
  if (simpleDesign.feasible) {
    return simpleDesign;
  }

  if (normalizedEdit.type === 'insertion' || normalizedEdit.type === 'replacement') {
    return designTiledInsertionOligos(templateSequence, normalizedEdit, thresholds, config);
  }

  return simpleDesign;
}

function designWithThresholdFallback(designCallback) {
  const levels = [
    ['strict', CLONING_PRIMER_TM_THRESHOLDS.strict],
    ['moderate', CLONING_PRIMER_TM_THRESHOLDS.moderate],
    ['relaxed', CLONING_PRIMER_TM_THRESHOLDS.relaxed]
  ];
  const attempts = [];

  for (const [levelName, thresholds] of levels) {
    const result = designCallback(thresholds, levelName);
    attempts.push({
      level: levelName,
      feasible: Boolean(result?.feasible),
      warningCount: asArray(result?.warnings).length
    });
    if (result?.feasible) {
      return {
        ...result,
        feasible: true,
        selectedThresholdLevel: levelName,
        attempts
      };
    }
  }

  return {
    feasible: false,
    selectedThresholdLevel: null,
    attempts,
    warnings: [
      'Primer design failed under strict, moderate, and relaxed thresholds. Consider Gibson assembly, overlap PCR, or synthesis.'
    ]
  };
}

function buildGlobalWarnings(routeEvaluations, primerPlan, strategyName) {
  const warnings = [];
  Object.values(routeEvaluations || {}).forEach((result) => {
    warnings.push(...buildRouteWarnings(result));
  });
  warnings.push(...asArray(primerPlan?.warnings));
  if (!strategyName) {
    warnings.push('No feasible assembly strategy was identified from the provided inputs.');
  }
  return [...new Set(warnings.filter(Boolean))];
}

function buildAlternateStrategyRecommendation(routeEvaluations) {
  const options = [];
  if (routeEvaluations?.restrictionLigation?.feasible) {
    options.push('restriction-ligation');
  }
  if (routeEvaluations?.gibson?.feasible) {
    options.push('Gibson assembly');
  }
  if (routeEvaluations?.overlapPCR?.feasible) {
    options.push('overlap PCR');
  }
  if (routeEvaluations?.siteDirectedMutagenesis?.feasible) {
    options.push('site-directed mutagenesis');
  }
  if (!options.length) {
    return 'Provide a clearer host backbone, fragment order, or edit request to enable route evaluation.';
  }
  return `Consider ${options.join(' or ')} as an alternate route.`;
}

function chooseAssemblyStrategy({ fragmentMap, routeEvaluations, editRequest, config }) {
  const insertCount = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone').length;
  if (editRequest && routeEvaluations?.siteDirectedMutagenesis?.feasible) {
    return {
      feasible: true,
      name: 'site-directed-mutagenesis',
      reason: 'A local edit is feasible on the selected template backbone.'
    };
  }

  if (
    config?.preferRestrictionLigation !== false
    && insertCount <= 1
    && routeEvaluations?.restrictionLigation?.feasible
  ) {
    return {
      feasible: true,
      name: 'restriction-ligation',
      reason: 'A clean unique restriction site pair is available for a simple host-plus-insert path.'
    };
  }

  if (
    insertCount > 1
    && config?.preferGibsonForMultiFragment !== false
    && routeEvaluations?.gibson?.feasible
  ) {
    return {
      feasible: true,
      name: 'gibson',
      reason: 'Multiple fragments are present and Gibson assembly is feasible across all required junctions.'
    };
  }

  if (routeEvaluations?.gibson?.feasible) {
    return {
      feasible: true,
      name: 'gibson',
      reason: 'Gibson assembly is feasible across the proposed fragment order.'
    };
  }

  if (routeEvaluations?.overlapPCR?.feasible) {
    const downstreamAssemblyMethod = routeEvaluations?.restrictionLigation?.feasible
      ? 'restriction-ligation'
      : (routeEvaluations?.gibson?.feasible ? 'gibson' : null);
    if (downstreamAssemblyMethod) {
      return {
        feasible: true,
        name: 'overlap-pcr',
        downstreamAssemblyMethod,
        reason: 'Insert fragments can be fused by overlap PCR and a downstream backbone insertion method is available.'
      };
    }
  }

  if (routeEvaluations?.restrictionLigation?.feasible) {
    return {
      feasible: true,
      name: 'restriction-ligation',
      reason: 'Restriction-ligation remains the only feasible evaluated route.'
    };
  }

  return {
    feasible: false,
    name: null,
    reason: 'No evaluated assembly route is currently feasible.'
  };
}

function buildProcedureSteps(strategyName, assemblyDesign, primerPlan, routeEvaluations) {
  const downstreamAssemblyMethod = assemblyDesign?.downstreamAssemblyMethod || null;

  if (strategyName === 'restriction-ligation') {
    return [
      { step: 1, title: 'Amplify insert', details: 'PCR-amplify the insert with restriction-site tails from the primer plan.', inputs: ['insert template', 'restriction-tailed primers'], expectedOutput: 'clean insert amplicon' },
      { step: 2, title: 'Digest DNA', details: 'Digest backbone and insert with the selected enzyme pair, then purify both products.', inputs: ['backbone', 'insert amplicon'], expectedOutput: 'compatible digested fragments' },
      { step: 3, title: 'Ligate construct', details: 'Ligate digested insert into the prepared backbone.', inputs: ['digested backbone', 'digested insert'], expectedOutput: 'ligation mixture' },
      { step: 4, title: 'Transform and screen', details: 'Transform competent cells and screen colonies by colony PCR and sequencing.', inputs: ['ligation mixture'], expectedOutput: 'validated recombinant clones' }
    ];
  }

  if (strategyName === 'gibson') {
    return [
      { step: 1, title: 'Amplify fragments', details: 'PCR-amplify all fragments using the overlap-bearing primer set.', inputs: ['fragment templates', 'assembly primers'], expectedOutput: 'purified assembly fragments' },
      { step: 2, title: 'Assemble reaction', details: 'Combine fragments in a Gibson-style assembly reaction using the planned overlap order.', inputs: ['purified fragments'], expectedOutput: 'assembled construct' },
      { step: 3, title: 'Transform and recover', details: 'Transform the assembly reaction into competent cells and recover colonies.', inputs: ['assembly reaction'], expectedOutput: 'candidate colonies' },
      { step: 4, title: 'Validate junctions', details: 'Screen every junction by colony PCR and sequence through the assembled insert.', inputs: ['candidate colonies'], expectedOutput: 'validated assembled plasmid' }
    ];
  }

  if (strategyName === 'overlap-pcr') {
    return [
      { step: 1, title: 'Fuse inserts', details: 'Generate the fused insert by overlap PCR across the planned fragment order.', inputs: ['insert templates', 'fusion primers'], expectedOutput: 'fused insert amplicon' },
      { step: 2, title: 'Verify fused insert', details: 'Confirm fused insert size before backbone insertion.', inputs: ['fused insert amplicon'], expectedOutput: 'validated fused insert' },
      { step: 3, title: 'Insert into backbone', details: `Insert the fused insert into the backbone using ${downstreamAssemblyMethod || 'the planned downstream assembly route'}.`, inputs: ['fused insert', 'selected backbone'], expectedOutput: 'candidate recombinant construct' },
      { step: 4, title: 'Screen and sequence', details: 'Validate both fusion and backbone junctions by PCR and sequencing.', inputs: ['candidate clones'], expectedOutput: 'validated final construct' }
    ];
  }

  if (strategyName === 'site-directed-mutagenesis') {
    return [
      { step: 1, title: 'Set up mutagenesis', details: 'Use the designed mutagenesis primers or tiled oligos on the selected template backbone.', inputs: ['template plasmid', 'mutagenesis primer set'], expectedOutput: 'edited amplification product' },
      { step: 2, title: 'Remove template background', details: 'Reduce parental-template carryover before transformation.', inputs: ['amplification product'], expectedOutput: 'enriched edited DNA' },
      { step: 3, title: 'Transform and isolate', details: 'Transform competent cells and isolate candidate colonies.', inputs: ['edited DNA'], expectedOutput: 'candidate edited clones' },
      { step: 4, title: 'Sequence edit window', details: 'Sequence the edited region and flanking sequence to confirm the requested change.', inputs: ['candidate clones'], expectedOutput: 'validated edited plasmid' }
    ];
  }

  return [
    { step: 1, title: 'Reassess inputs', details: 'No executable route was identified. Re-check backbone choice, fragment order, or edit size.', inputs: [], expectedOutput: 'revised plan inputs' }
  ];
}

function buildValidationPlan(strategyName, assemblyDesign, fragmentMap) {
  const fragmentIds = asArray(fragmentMap?.fragments).map((fragment) => fragment.id);
  if (strategyName === 'restriction-ligation') {
    return [
      { method: 'colony-pcr', target: 'left/right cloning junctions', rationale: 'Confirm insert presence and orientation.' },
      { method: 'sanger-sequencing', target: 'entire insert region', rationale: 'Verify insert integrity after ligation.' }
    ];
  }
  if (strategyName === 'gibson') {
    return [
      { method: 'colony-pcr', target: 'all designed assembly junctions', rationale: 'Confirm that every overlap assembled as planned.' },
      { method: 'sanger-sequencing', target: 'assembled insert and adjacent backbone sequence', rationale: 'Verify seamless junction formation.' }
    ];
  }
  if (strategyName === 'overlap-pcr') {
    return [
      { method: 'gel-check', target: 'fused insert amplicon', rationale: 'Confirm expected fused-insert size before backbone insertion.' },
      { method: 'colony-pcr', target: 'fusion and backbone insertion junctions', rationale: 'Confirm the fused insert entered the backbone correctly.' },
      { method: 'sanger-sequencing', target: 'fusion boundaries', rationale: 'Verify that the fused coding sequence is scar-free and in-frame.' }
    ];
  }
  if (strategyName === 'site-directed-mutagenesis') {
    return [
      { method: 'sanger-sequencing', target: 'edited window and flanking sequence', rationale: 'Confirm the requested edit and exclude local byproducts.' }
    ];
  }
  return [
    { method: 'review-inputs', target: fragmentIds.join(', '), rationale: 'No feasible route was selected.' }
  ];
}

function buildAssemblyDesign(strategy, fragmentMap, routeEvaluations, resultSequence) {
  const predictedResultSequence = normalizeSequence(resultSequence);
  const strategyName = strategy?.name || null;
  const routeJunctions = strategyName === 'gibson'
    ? asArray(routeEvaluations?.gibson?.junctions)
    : strategyName === 'overlap-pcr'
      ? asArray(routeEvaluations?.overlapPCR?.junctions)
      : [];

  return {
    strategy: strategyName,
    fragmentOrder: asArray(fragmentMap?.fragments).map((fragment) => ({
      id: fragment.id,
      name: fragment.name,
      role: fragment.role,
      length: fragment.sequence.length
    })),
    predictedResultSequence,
    predictedResultLength: predictedResultSequence.length,
    junctions: routeJunctions,
    downstreamAssemblyMethod: strategy?.downstreamAssemblyMethod || null,
    notes: [
      strategy?.reason || '',
      strategy?.downstreamAssemblyMethod
        ? `Downstream backbone insertion should use ${strategy.downstreamAssemblyMethod}.`
        : ''
    ].filter(Boolean)
  };
}

export function evaluateOverlapPcr(fragments, options = {}) {
  const evaluation = evaluateFragmentAssembly(fragments, {
    ...options,
    circular: false,
    thresholds: options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict
  });
  return {
    feasible: evaluation.fragments.length >= DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT && evaluation.feasible,
    fragmentOrder: evaluation.fragments.map((fragment) => fragment.id),
    junctions: evaluation.junctions,
    warnings: evaluation.warnings,
    failureReasons: evaluation.feasible
      ? []
      : ['At least one fragment junction lacks a usable natural or primer-introduced overlap.']
  };
}

export function evaluateGibsonAssembly(fragments, options = {}) {
  const evaluation = evaluateFragmentAssembly(fragments, {
    ...options,
    circular: Boolean(options?.circular),
    thresholds: options?.thresholds || CLONING_PRIMER_TM_THRESHOLDS.strict
  });
  return {
    feasible: evaluation.fragments.length >= DEFAULT_GIBSON_MIN_FRAGMENT_COUNT && evaluation.feasible,
    fragmentOrder: evaluation.fragments.map((fragment) => fragment.id),
    junctions: evaluation.junctions,
    warnings: evaluation.warnings,
    failureReasons: evaluation.feasible
      ? []
      : ['One or more Gibson junctions could not reach the required overlap window with the current fragment set.']
  };
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

  const candidates = buildRestrictionCandidatePairs(hostFeatures, host.sequence.length, inserts, config);
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

export function evaluateSiteDirectedMutagenesis(args = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(args?.config || args?.preferences || {})
  };
  const host = args?.host ? normalizeHostVector(args.host, 0) : null;
  const templateSequence = host?.sequence || normalizeSequence(args?.resultSequence || '');
  const normalizedEdit = normalizeEditRequest(args?.editRequest, templateSequence);

  if (!normalizedEdit) {
    return {
      feasible: false,
      warnings: ['No supported edit request was provided.'],
      reason: 'Edit request is missing or unsupported.'
    };
  }

  const changedNt = normalizedEdit.type === 'replacement'
    ? Math.max(normalizedEdit.originalSequence.length, normalizedEdit.editedSequence.length)
    : Math.max(Math.abs(normalizedEdit.editedSequence.length - normalizedEdit.originalSequence.length), normalizedEdit.editedSequence.length);
  const aminoAcidDelta = changedNt / 3;
  const feasible = Boolean(templateSequence.length)
    && aminoAcidDelta <= (Number(config?.maxPrimerEncodedInsertionAA) || DEFAULT_CLONING_PREFERENCES.maxPrimerEncodedInsertionAA);

  return {
    feasible,
    editType: normalizedEdit.type,
    deltaLength: normalizedEdit.editedSequence.length - normalizedEdit.originalSequence.length,
    aminoAcidDelta,
    start: normalizedEdit.start,
    end: normalizedEdit.end,
    requiresTiling: normalizedEdit.editedSequence.length > Math.max(0, Number(config?.maxPrimerLength) || DEFAULT_CLONING_PREFERENCES.maxPrimerLength),
    warnings: feasible ? [] : ['The requested edit exceeds the configured size cap for primer-driven mutagenesis.'],
    reason: feasible
      ? 'The requested local edit is suitable for primer-driven mutagenesis on the selected template.'
      : 'The requested edit is too large or lacks a usable template sequence for site-directed mutagenesis.'
  };
}

export function designCloningPrimers(args = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(args?.preferences || {})
  };
  const strategyName = String(args?.strategy || args?.recommendedAssemblyStrategy || '').trim().toLowerCase();
  const fragmentMap = args?.fragmentMap || args?.orderedFragmentMap || null;
  const routeEvaluations = args?.routeEvaluations || {};
  const host = args?.selectedHost || args?.host || null;
  const normalizedEdit = normalizeEditRequest(args?.editRequest, host?.sequence || fragmentMap?.resultSequence || '');

  return designWithThresholdFallback((thresholds) => {
    if (strategyName === 'restriction-ligation') {
      const base = designRestrictionLigationPrimers(
        fragmentMap,
        routeEvaluations?.restrictionLigation || args?.restrictionEvaluation || {},
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers)
      };
    }

    if (strategyName === 'gibson') {
      const base = designAssemblyPrimersForRoute(
        asArray(fragmentMap?.fragments),
        routeEvaluations?.gibson?.junctions,
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, routeEvaluations?.gibson?.junctions)
      };
    }

    if (strategyName === 'overlap-pcr') {
      const insertFragments = asArray(fragmentMap?.fragments).filter((fragment) => fragment.role !== 'backbone');
      const base = designAssemblyPrimersForRoute(
        insertFragments,
        routeEvaluations?.overlapPCR?.junctions,
        thresholds,
        config
      );
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, routeEvaluations?.overlapPCR?.junctions),
        warnings: [
          ...asArray(base.warnings),
          args?.assembledVectorDesign?.downstreamAssemblyMethod
            ? `Backbone insertion should proceed by ${args.assembledVectorDesign.downstreamAssemblyMethod} after insert fusion.`
            : ''
        ].filter(Boolean)
      };
    }

    if (strategyName === 'site-directed-mutagenesis' && normalizedEdit) {
      const base = designMutagenesisPrimers(host?.sequence || fragmentMap?.resultSequence || '', normalizedEdit, thresholds, config);
      if (!base.feasible) {
        return base;
      }
      return {
        ...base,
        ...summarizePrimerPlan(base.primers, base.overlapSummary)
      };
    }

    return {
      feasible: false,
      warnings: ['No primer-design route matches the selected assembly strategy.']
    };
  });
}

export function assembleCloningPlan(payload = {}) {
  const config = {
    ...DEFAULT_CLONING_PREFERENCES,
    ...(payload?.preferences || {})
  };
  const normalizedResultSequence = normalizeSequence(payload?.resultSequence || '');
  const normalizedFragments = asArray(payload?.fragments).map((fragment, index) => normalizeFragment(fragment, index));
  const selectedHost = findSelectedHostVector(payload?.hostVectors, normalizedResultSequence, payload?.hostVectorId);
  const normalizedEdit = normalizeEditRequest(payload?.editRequest, selectedHost?.sequence || normalizedResultSequence || '');
  const orderedFragmentMap = buildOrderedFragmentMap({
    host: selectedHost,
    fragments: normalizedFragments,
    resultSequence: normalizedResultSequence,
    editRequest: normalizedEdit
  });

  const insertFragments = normalizedFragments.filter((fragment) => fragment.type !== 'backbone');
  const assemblyFragments = selectedHost
    ? [
        {
          id: 'host_backbone',
          name: selectedHost.name,
          type: 'backbone',
          sequence: selectedHost.sequence,
          orientation: 'forward',
          metadata: {}
        },
        ...insertFragments
      ]
    : insertFragments;

  const overlapPCR = evaluateOverlapPcr(insertFragments, {
    preferences: config
  });
  const gibson = evaluateGibsonAssembly(assemblyFragments, {
    preferences: config,
    circular: Boolean(selectedHost)
  });
  const restrictionLigation = config?.allowRestrictionLigation === false
    ? {
        feasible: false,
        selectedSites: null,
        candidatePairs: [],
        warnings: [],
        reason: 'Restriction-ligation is disabled for this cloning plan.'
      }
    : evaluateRestrictionLigation({
        host: selectedHost,
        fragmentMap: orderedFragmentMap,
        preferences: config
      });
  const siteDirectedMutagenesis = evaluateSiteDirectedMutagenesis({
    host: selectedHost,
    resultSequence: normalizedResultSequence,
    editRequest: normalizedEdit,
    preferences: config
  });

  const routeEvaluations = {
    overlapPCR,
    gibson,
    restrictionLigation,
    siteDirectedMutagenesis
  };

  const recommendedStrategy = chooseAssemblyStrategy({
    fragmentMap: orderedFragmentMap,
    routeEvaluations,
    editRequest: normalizedEdit,
    config
  });
  const assembledVectorDesign = buildAssemblyDesign(
    recommendedStrategy,
    orderedFragmentMap,
    routeEvaluations,
    normalizedResultSequence
  );
  const primerOligoPlan = designCloningPrimers({
    strategy: recommendedStrategy?.name,
    fragmentMap: orderedFragmentMap,
    orderedFragmentMap,
    routeEvaluations,
    selectedHost,
    host: selectedHost,
    editRequest: normalizedEdit,
    preferences: config,
    assembledVectorDesign
  });
  const stepByStepProcedure = buildProcedureSteps(
    recommendedStrategy?.name,
    assembledVectorDesign,
    primerOligoPlan,
    routeEvaluations
  );
  const validationPlan = buildValidationPlan(
    recommendedStrategy?.name,
    assembledVectorDesign,
    orderedFragmentMap
  );
  const warnings = buildGlobalWarnings(routeEvaluations, primerOligoPlan, recommendedStrategy?.name);

  return {
    feasible: Boolean(recommendedStrategy?.feasible),
    recommendedAssemblyStrategy: recommendedStrategy?.name || null,
    selectedHost: selectedHost
      ? {
          id: selectedHost.id,
          name: selectedHost.name,
          topology: selectedHost.topology,
          sequenceLength: selectedHost.sequence.length
        }
      : null,
    orderedFragmentMap,
    routeEvaluations,
    assembledVectorDesign,
    primerOligoPlan,
    restrictionEnzymeSelection: recommendedStrategy?.name === 'restriction-ligation'
      ? restrictionLigation.selectedSites
      : null,
    expectedJunctionLogic: assembledVectorDesign.junctions || [],
    stepByStepProcedure,
    validationPlan,
    warnings,
    alternateStrategyRecommendation: recommendedStrategy?.feasible
      ? null
      : buildAlternateStrategyRecommendation(routeEvaluations)
  };
}
