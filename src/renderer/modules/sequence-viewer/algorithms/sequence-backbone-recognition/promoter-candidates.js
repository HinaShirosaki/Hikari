'use strict';
const {
  DEFAULT_MAX_PROMOTER_SELECTIONS,
  DEFAULT_PROMOTER_TO_ORF_MAX_GAP,
  MIN_ORF_LENGTH
} = require('./constants');
const {
  mergeSegments,
  normalizeDisplayName,
  positiveModulo,
  sumSegmentLength
} = require('./segment-utils');
const {
  buildOrfHitsFromFeatures,
  buildRestrictionHitsFromFeatures,
  buildRestrictionSiteOutput,
  buildVariantFromOrientedRange,
  chooseNearestDownstreamSite,
  chooseNearestUpstreamSite,
  findNearestDownstreamOrf,
  orientedRangeToOriginalSegments
} = require('./promoter-feature-utils');
function buildPromoterCandidateSelections({
  reverseComplementIupac,
  querySequence,
  promoterAnnotationHits,
  buildOrfFeatures,
  buildCommercialRestrictionFeatures
}) {
  const totalLength = Math.max(0, String(querySequence || '').length);
  if (!totalLength) {
    return [];
  }
  const contexts = buildOrientedContexts({
    reverseComplementIupac,
    querySequence,
    totalLength,
    buildOrfFeatures,
    buildCommercialRestrictionFeatures
  });
  const candidates = [];
  const seen = new Set();
  (Array.isArray(promoterAnnotationHits) ? promoterAnnotationHits : []).forEach((hit) => {
    const candidate = buildPromoterCandidate(hit, contexts, querySequence, totalLength);
    if (!candidate) {
      return;
    }
    const key = `${candidate.label}|${candidate.promoter.strand}|${candidate._promoterStart}|${candidate._orfStart}|${candidate.orf.length}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const idStart = candidate._promoterStart;
    delete candidate._promoterStart;
    delete candidate._orfStart;
    candidates.push({
      ...candidate,
      id: `promoter_${candidates.length + 1}_${positiveModulo(idStart, totalLength)}`
    });
  });
  return candidates
    .filter((candidate) => candidate?.variants?.gibson || candidate?.variants?.restriction)
    .sort(comparePromoterCandidates)
    .slice(0, DEFAULT_MAX_PROMOTER_SELECTIONS);
}
function buildOrientedContexts({
  reverseComplementIupac,
  querySequence,
  totalLength,
  buildOrfFeatures,
  buildCommercialRestrictionFeatures
}) {
  const reverseQuery = reverseComplementIupac(querySequence);
  const minOrfAaLength = Math.max(1, Math.ceil(MIN_ORF_LENGTH / 3) - 1);
  const contextFor = (sequence) => ({
    sequence,
    orfHits: buildOrfHitsFromFeatures(buildOrfFeatures(sequence, 'circular', { minAaLength: minOrfAaLength }), totalLength),
    restrictionHits: buildRestrictionHitsFromFeatures(buildCommercialRestrictionFeatures(sequence, 'circular'), totalLength)
  });
  return new Map([[1, contextFor(querySequence)], [-1, contextFor(reverseQuery)]]);
}
function buildPromoterCandidate(hit, contexts, querySequence, totalLength) {
  const strand = Number(hit?.strand) === -1 ? -1 : 1;
  const context = contexts.get(strand);
  if (!context?.sequence?.length) {
    return null;
  }
  const promoterLength = Math.max(1, Number(hit?.matchedLength) || sumSegmentLength(hit?.segments));
  const promoterName = normalizeDisplayName(hit?.recordName || hit?.recordId, 'Promoter');
  const promoterSegments = mergeSegments(hit?.segments, totalLength);
  const promoterStart = strand === 1
    ? positiveModulo(Number(hit?.start) || promoterSegments[0]?.start || 0, totalLength)
    : positiveModulo(totalLength - positiveModulo((Number(hit?.start) || 0) + promoterLength, totalLength), totalLength);
  const promoterEnd = promoterStart + promoterLength;
  const orf = findNearestDownstreamOrf(context.orfHits, promoterEnd, { maxGap: DEFAULT_PROMOTER_TO_ORF_MAX_GAP });
  if (!orf) {
    return null;
  }
  const variants = buildCandidateVariants({ querySequence, totalLength, strand, orf, restrictionHits: context.restrictionHits });
  return {
    _promoterStart: promoterStart,
    _orfStart: orf.start,
    label: promoterName,
    promoter: {
      name: promoterName,
      strand,
      matchedLength: promoterLength,
      identity: Number(hit?.identity) || 0,
      coverage: Number(hit?.coverage) || 0,
      segments: promoterSegments,
      gapToOrf: Math.max(0, Number(orf.gap) || 0)
    },
    orf: {
      name: `Nearest ORF (${Math.max(0, Math.floor(orf.length / 3) - 1)} aa)`,
      strand,
      length: orf.length,
      startCodon: orf.startCodon,
      stopCodon: orf.stopCodon,
      segments: orientedRangeToOriginalSegments(orf.start, orf.length, totalLength, strand)
    },
    variants
  };
}
function buildCandidateVariants({ querySequence, totalLength, strand, orf, restrictionHits }) {
  const gibson = buildVariantFromOrientedRange({
    querySequence,
    totalLength,
    strand,
    start: orf.start,
    length: orf.length,
    source: 'promoter_orf',
    startCodon: orf.startCodon,
    stopCodon: orf.stopCodon
  });
  const upstreamSite = chooseNearestUpstreamSite(restrictionHits, orf.start);
  const downstreamSite = chooseNearestDownstreamSite(
    restrictionHits,
    positiveModulo(orf.start + orf.length, totalLength),
    upstreamSite
  );
  return {
    gibson,
    restriction: buildRestrictionVariant({
      querySequence,
      totalLength,
      strand,
      orf,
      upstreamSite,
      downstreamSite
    })
  };
}
function buildRestrictionVariant({ querySequence, totalLength, strand, orf, upstreamSite, downstreamSite }) {
  if (!upstreamSite || !downstreamSite) {
    return null;
  }
  const restrictionInsertLength = positiveModulo(downstreamSite.end - upstreamSite.start, totalLength);
  const distanceFromInsertStartToOrf = positiveModulo(orf.start - upstreamSite.start, totalLength);
  if (
    restrictionInsertLength <= 0
    || restrictionInsertLength >= totalLength
    || distanceFromInsertStartToOrf + orf.length > restrictionInsertLength
  ) {
    return null;
  }
  return buildVariantFromOrientedRange({
    querySequence,
    totalLength,
    strand,
    start: upstreamSite.start,
    length: restrictionInsertLength,
    source: 'promoter_orf',
    startCodon: orf.startCodon,
    stopCodon: orf.stopCodon,
    upstreamSite: buildRestrictionSiteOutput(upstreamSite, totalLength, strand),
    downstreamSite: buildRestrictionSiteOutput(downstreamSite, totalLength, strand),
    siteExtensionApplied: upstreamSite.start !== orf.start
      || positiveModulo(orf.start + orf.length, totalLength) !== downstreamSite.end
  });
}
function comparePromoterCandidates(left, right) {
  const leftGap = Math.max(0, Number(left?.promoter?.gapToOrf) || 0);
  const rightGap = Math.max(0, Number(right?.promoter?.gapToOrf) || 0);
  if (leftGap !== rightGap) {
    return leftGap - rightGap;
  }
  const leftOrfLength = Math.max(0, Number(left?.orf?.length) || 0);
  const rightOrfLength = Math.max(0, Number(right?.orf?.length) || 0);
  if (leftOrfLength !== rightOrfLength) {
    return rightOrfLength - leftOrfLength;
  }
  const leftIdentity = Number(left?.promoter?.identity) || 0;
  const rightIdentity = Number(right?.promoter?.identity) || 0;
  if (leftIdentity !== rightIdentity) {
    return rightIdentity - leftIdentity;
  }
  return String(left?.label || '').localeCompare(String(right?.label || ''));
}
module.exports = { buildPromoterCandidateSelections };
