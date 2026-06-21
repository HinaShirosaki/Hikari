'use strict';
const { normalizeDisplayName, overlapLength } = require('./segment-utils');
function buildAlignmentFallbackVariant(alignment) {
  return {
    source: 'alignment',
    backboneLength: alignment.backboneLength,
    insertLength: alignment.insertLength,
    backboneSegments: alignment.backboneSegments,
    insertSegments: alignment.insertSegments,
    backboneSequence: alignment.backboneSequence,
    insertSequence: alignment.insertSequence,
    startCodon: '',
    stopCodon: '',
    upstreamSite: null,
    downstreamSite: null,
    siteExtensionApplied: false
  };
}
function choosePreferredVariant(variants) {
  const safeVariants = variants && typeof variants === 'object' ? variants : {};
  return (safeVariants.gibson && typeof safeVariants.gibson === 'object')
    ? safeVariants.gibson
    : ((safeVariants.restriction && typeof safeVariants.restriction === 'object')
      ? safeVariants.restriction
      : null);
}
function buildPromoterAlignedRecognitionMatch(promoterCandidates) {
  const candidateSelections = (Array.isArray(promoterCandidates) ? promoterCandidates : []).filter(Boolean);
  const defaultSelection = candidateSelections[0] || null;
  const defaultVariant = choosePreferredVariant(defaultSelection?.variants);
  if (!defaultSelection || !defaultVariant) {
    return null;
  }
  return {
    hostVectorId: '',
    hostVectorName: 'Promoter-aligned backbone',
    hostVectorStatus: 'recognized',
    hostCoverage: 0,
    orientation: Number(defaultSelection?.promoter?.strand) === -1 ? 'reverse' : 'forward',
    recognitionSource: 'promoter_alignment',
    backboneLength: Math.max(0, Number(defaultVariant.backboneLength) || 0),
    insertLength: Math.max(0, Number(defaultVariant.insertLength) || 0),
    backboneSegments: Array.isArray(defaultVariant.backboneSegments) ? defaultVariant.backboneSegments : [],
    insertSegments: Array.isArray(defaultVariant.insertSegments) ? defaultVariant.insertSegments : [],
    promoter: defaultSelection.promoter || null,
    orf: defaultSelection.orf || null,
    variants: defaultSelection.variants || {},
    candidateSelections,
    selectedCandidateId: String(defaultSelection?.id || '')
  };
}
function scorePromoterCandidateAgainstAlignment(candidate, alignmentInsertSegments) {
  const variantScores = ['gibson', 'restriction']
    .map((mode) => {
      const variant = candidate?.variants?.[mode];
      if (!variant) {
        return null;
      }
      const overlap = overlapLength(variant.insertSegments, alignmentInsertSegments);
      return {
        mode,
        overlap,
        overlapRatio: variant.insertLength > 0 ? overlap / variant.insertLength : 0
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.overlap !== right.overlap) {
        return right.overlap - left.overlap;
      }
      if (left.overlapRatio !== right.overlapRatio) {
        return right.overlapRatio - left.overlapRatio;
      }
      return left.mode === 'gibson' ? -1 : 1;
    });
  const bestVariant = variantScores[0] || { overlap: 0, overlapRatio: 0 };
  return {
    overlap: bestVariant.overlap,
    overlapRatio: bestVariant.overlapRatio,
    promoterGap: Math.max(0, Number(candidate?.promoter?.gapToOrf) || 0),
    orfLength: Math.max(0, Number(candidate?.orf?.length) || 0),
    promoterIdentity: Number(candidate?.promoter?.identity) || 0,
    hasRestriction: Boolean(candidate?.variants?.restriction)
  };
}
function rankPromoterCandidatesForAlignment(candidates, alignmentInsertSegments) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      candidate,
      score: scorePromoterCandidateAgainstAlignment(candidate, alignmentInsertSegments)
    }))
    .sort((left, right) => {
      if (left.score.overlap !== right.score.overlap) {
        return right.score.overlap - left.score.overlap;
      }
      if (left.score.overlapRatio !== right.score.overlapRatio) {
        return right.score.overlapRatio - left.score.overlapRatio;
      }
      if (left.score.promoterGap !== right.score.promoterGap) {
        return left.score.promoterGap - right.score.promoterGap;
      }
      if (left.score.orfLength !== right.score.orfLength) {
        return right.score.orfLength - left.score.orfLength;
      }
      if (left.score.promoterIdentity !== right.score.promoterIdentity) {
        return right.score.promoterIdentity - left.score.promoterIdentity;
      }
      if (left.score.hasRestriction !== right.score.hasRestriction) {
        return left.score.hasRestriction ? -1 : 1;
      }
      return String(left.candidate?.label || '').localeCompare(String(right.candidate?.label || ''));
    })
    .map((entry) => entry.candidate);
}
function applyAlignmentBackboneToPromoterCandidate(candidate, alignment) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const normalizedCandidate = {
    ...candidate,
    variants: {
      ...(candidate.variants && typeof candidate.variants === 'object' ? candidate.variants : {})
    }
  };
  const restrictionVariant = normalizedCandidate.variants?.restriction;
  if (restrictionVariant && typeof restrictionVariant === 'object' && alignment?.backboneSequence) {
    normalizedCandidate.variants.restriction = {
      ...restrictionVariant,
      backboneSequence: alignment.backboneSequence
    };
  }
  return normalizedCandidate;
}
function buildRecognitionMatch(entry, alignment, promoterCandidates) {
  const rankedSelections = rankPromoterCandidatesForAlignment(promoterCandidates, alignment.insertSegments)
    .map((candidate) => applyAlignmentBackboneToPromoterCandidate(candidate, alignment))
    .filter(Boolean);
  const fallbackVariant = buildAlignmentFallbackVariant(alignment);
  const fallbackSelection = {
    id: 'alignment_fallback',
    label: 'Alignment fallback',
    promoter: null,
    orf: null,
    variants: {
      gibson: { ...fallbackVariant },
      restriction: { ...fallbackVariant }
    }
  };
  const candidateSelections = rankedSelections.length ? rankedSelections : [fallbackSelection];
  const defaultSelection = candidateSelections[0] || fallbackSelection;
  return {
    hostVectorId: entry.id,
    hostVectorName: normalizeDisplayName(entry.name, 'vector'),
    hostVectorStatus: String(entry.status || '').trim().toLowerCase() === 'saved' ? 'saved' : 'temporary',
    hostCoverage: alignment.hostCoverage,
    orientation: alignment.orientation,
    recognitionSource: 'library_alignment',
    backboneLength: alignment.backboneLength,
    insertLength: alignment.insertLength,
    backboneSegments: alignment.backboneSegments,
    insertSegments: alignment.insertSegments,
    promoter: defaultSelection?.promoter || null,
    orf: defaultSelection?.orf || null,
    variants: defaultSelection?.variants || fallbackSelection.variants,
    candidateSelections,
    selectedCandidateId: String(defaultSelection?.id || '')
  };
}
function compareRecognitionMatches(left, right, savedStatus) {
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  const leftSavedRank = String(left.hostVectorStatus || '') === savedStatus ? 0 : 1;
  const rightSavedRank = String(right.hostVectorStatus || '') === savedStatus ? 0 : 1;
  if (leftSavedRank !== rightSavedRank) {
    return leftSavedRank - rightSavedRank;
  }
  if (left.backboneLength !== right.backboneLength) {
    return right.backboneLength - left.backboneLength;
  }
  if (left.hostCoverage !== right.hostCoverage) {
    return right.hostCoverage - left.hostCoverage;
  }
  if (left.insertLength !== right.insertLength) {
    return left.insertLength - right.insertLength;
  }
  return String(left.hostVectorName || '').localeCompare(String(right.hostVectorName || ''));
}
module.exports = {
  buildPromoterAlignedRecognitionMatch,
  buildRecognitionMatch,
  compareRecognitionMatches
};
