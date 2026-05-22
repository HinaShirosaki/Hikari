'use strict';

const {
  DEFAULT_PROMOTER_TO_ORF_MAX_GAP,
  DEFAULT_RESTRICTION_FLANK_MAX_GAP
} = require('./constants');
const {
  buildSequenceFromSegments,
  circularRangeToSegments,
  invertSegments,
  mergeSegments,
  normalizeDisplayName,
  positiveModulo,
  sumSegmentLength
} = require('./segment-utils');

function buildRestrictionHitsFromFeatures(features, totalLength) {
  return (Array.isArray(features) ? features : [])
    .map((feature) => {
      const segments = mergeSegments(feature?.segments, totalLength);
      const length = sumSegmentLength(segments);
      if (!segments.length || length <= 0) {
        return null;
      }

      const start = positiveModulo(segments[0]?.start || 0, totalLength);
      const site = String(feature?.site || '').trim().toUpperCase();
      return {
        name: normalizeDisplayName(feature?.name, 'Restriction site'),
        site,
        cutPatterns: Array.isArray(feature?.cutPatterns) ? feature.cutPatterns.slice(0, 6) : [],
        start,
        end: positiveModulo(start + length, totalLength),
        length,
        unique: true,
        ambiguityCount: (site.match(/[^ACGT]/g) || []).length,
        sequenceLength: totalLength
      };
    })
    .filter(Boolean);
}

function buildOrfHitsFromFeatures(features, totalLength) {
  return (Array.isArray(features) ? features : [])
    .filter((feature) => Number(feature?.strand) !== -1)
    .map((feature) => {
      const segments = mergeSegments(feature?.segments, totalLength);
      const length = Math.max(0, Number(feature?.orfLengthNt) || sumSegmentLength(segments));
      if (!segments.length || length <= 0) {
        return null;
      }

      const start = positiveModulo(segments[0]?.start || 0, totalLength);
      return {
        start,
        end: positiveModulo(start + length, totalLength),
        length,
        startCodon: String(feature?.startCodon || 'ATG').trim().toUpperCase() || 'ATG',
        stopCodon: String(feature?.stopCodon || '').trim().toUpperCase(),
        sequenceLength: totalLength
      };
    })
    .filter(Boolean);
}

function findNearestDownstreamOrf(orfs, promoterEnd, options = {}) {
  const maxGap = Math.max(0, Number(options?.maxGap) || DEFAULT_PROMOTER_TO_ORF_MAX_GAP);
  const hits = (Array.isArray(orfs) ? orfs : [])
    .map((orf) => ({
      ...orf,
      gap: positiveModulo((Number(orf?.start) || 0) - promoterEnd, orf?.sequenceLength || 0)
    }))
    .sort((left, right) => (left.gap - right.gap) || (right.length - left.length) || (left.start - right.start));

  return hits.find((hit) => hit.gap <= maxGap) || hits[0] || null;
}

function compareSiteCandidates(left, right) {
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  if (Boolean(left.unique) !== Boolean(right.unique)) {
    return left.unique ? -1 : 1;
  }
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if ((left.ambiguityCount || 0) !== (right.ambiguityCount || 0)) {
    return (left.ambiguityCount || 0) - (right.ambiguityCount || 0);
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return String(left.name || '').localeCompare(String(right.name || ''));
}

function chooseNearestUpstreamSite(hits, orfStart) {
  const ranked = (Array.isArray(hits) ? hits : [])
    .map((hit) => ({ ...hit, distance: positiveModulo(orfStart - hit.start, hit.sequenceLength || 0) }))
    .sort(compareSiteCandidates);
  return ranked.filter((hit) => hit.distance <= DEFAULT_RESTRICTION_FLANK_MAX_GAP)[0] || ranked[0] || null;
}

function chooseNearestDownstreamSite(hits, orfEnd, usedUpstream = null) {
  const ranked = (Array.isArray(hits) ? hits : [])
    .filter((hit) => !usedUpstream || hit.start !== usedUpstream.start || hit.length !== usedUpstream.length || hit.name !== usedUpstream.name)
    .map((hit) => ({ ...hit, distance: positiveModulo(hit.start - orfEnd, hit.sequenceLength || 0) }))
    .sort(compareSiteCandidates);
  return ranked.filter((hit) => hit.distance <= DEFAULT_RESTRICTION_FLANK_MAX_GAP)[0] || ranked[0] || null;
}

function buildVariantFromOrientedRange({
  querySequence,
  totalLength,
  strand,
  start,
  length,
  source,
  startCodon,
  stopCodon,
  upstreamSite,
  downstreamSite,
  siteExtensionApplied
}) {
  const insertSegments = orientedRangeToOriginalSegments(start, length, totalLength, strand);
  const backboneSegments = invertSegments(insertSegments, totalLength);
  return {
    source,
    backboneLength: sumSegmentLength(backboneSegments),
    insertLength: sumSegmentLength(insertSegments),
    backboneSegments,
    insertSegments,
    backboneSequence: buildSequenceFromSegments(querySequence, backboneSegments),
    insertSequence: buildSequenceFromSegments(querySequence, insertSegments),
    startCodon: String(startCodon || '').trim(),
    stopCodon: String(stopCodon || '').trim(),
    upstreamSite: upstreamSite || null,
    downstreamSite: downstreamSite || null,
    siteExtensionApplied: Boolean(siteExtensionApplied)
  };
}

function orientedRangeToOriginalSegments(start, length, totalLength, strand) {
  const orientedSegments = circularRangeToSegments(start, length, totalLength);
  if (Number(strand) !== -1) {
    return orientedSegments;
  }
  return mergeSegments(orientedSegments.map((segment) => ({
    start: totalLength - segment.end,
    end: totalLength - segment.start
  })), totalLength);
}

function buildRestrictionSiteOutput(site, totalLength, strand) {
  if (!site) {
    return null;
  }
  return {
    name: normalizeDisplayName(site.name, 'Restriction site'),
    site: String(site.site || '').trim(),
    cutPatterns: Array.isArray(site.cutPatterns) ? site.cutPatterns.slice(0, 6) : [],
    unique: Boolean(site.unique),
    strand,
    segments: orientedRangeToOriginalSegments(site.start, site.length, totalLength, strand)
  };
}

module.exports = {
  buildOrfHitsFromFeatures,
  buildRestrictionHitsFromFeatures,
  buildRestrictionSiteOutput,
  buildVariantFromOrientedRange,
  chooseNearestDownstreamSite,
  chooseNearestUpstreamSite,
  findNearestDownstreamOrf,
  orientedRangeToOriginalSegments
};
