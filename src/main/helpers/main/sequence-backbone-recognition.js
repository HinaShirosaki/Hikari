'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { annotateCircularPlasmidSequenceSync } = require('./circular-plasmid-annotation');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ORF_ANALYSIS_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'orf-analysis.js'
);
const RESTRICTION_ANALYSIS_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'restriction-analysis.js'
);
const EXPORTED_STANDARD_FEATURES_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'exported-standard-features.js'
);

const MIN_QUERY_LENGTH = 12;
const MIN_ORF_LENGTH = 15;
const DEFAULT_PROMOTER_TO_ORF_MAX_GAP = 1800;
const DEFAULT_RESTRICTION_FLANK_MAX_GAP = 240;
const DEFAULT_MAX_PROMOTER_SELECTIONS = 12;
const MIN_BACKBONE_SHARED_LENGTH = 24;
const MIN_HOST_COVERAGE = 0.45;

let sequenceViewerAnalysisPromise = null;
let exportedStandardPromotersPromise = null;

function clampInteger(value, min, max, fallback = min) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function positiveModulo(value, modulo) {
  if (!Number.isFinite(Number(modulo)) || modulo <= 0) {
    return 0;
  }
  const numeric = Number(value) || 0;
  return ((numeric % modulo) + modulo) % modulo;
}

function normalizeDisplayName(value, fallback = 'feature') {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return text || fallback;
}

function normalizeSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clampInteger(segment?.start, 0, safeLength, 0),
      end: clampInteger(segment?.end, 0, safeLength, 0)
    }))
    .filter((segment) => segment.end > segment.start);
}

function mergeSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  return normalizeSegments(segments, safeLength)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    })
    .reduce((acc, segment) => {
      const previous = acc[acc.length - 1];
      if (!previous || segment.start > previous.end) {
        acc.push({ ...segment });
        return acc;
      }
      previous.end = Math.max(previous.end, segment.end);
      return acc;
    }, []);
}

function sumSegmentLength(segments) {
  return (Array.isArray(segments) ? segments : [])
    .reduce((sum, segment) => sum + Math.max(0, (segment?.end || 0) - (segment?.start || 0)), 0);
}

function circularSlice(sequence, start, length) {
  const text = String(sequence || '');
  const totalLength = text.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!totalLength || !desiredLength) {
    return '';
  }

  let cursor = positiveModulo(Math.round(Number(start) || 0), totalLength);
  let remaining = desiredLength;
  let result = '';
  while (remaining > 0) {
    const chunkLength = Math.min(remaining, totalLength - cursor);
    result += text.slice(cursor, cursor + chunkLength);
    remaining -= chunkLength;
    cursor = 0;
  }
  return result;
}

function circularRangeToSegments(start, length, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!safeLength || !desiredLength) {
    return [];
  }

  if (desiredLength >= safeLength) {
    return [{ start: 0, end: safeLength }];
  }

  const safeStart = positiveModulo(Math.round(Number(start) || 0), safeLength);
  const end = safeStart + desiredLength;
  if (end <= safeLength) {
    return [{ start: safeStart, end }];
  }

  return mergeSegments([
    { start: safeStart, end: safeLength },
    { start: 0, end: end - safeLength }
  ], safeLength);
}

function invertSegments(segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  if (!safeLength) {
    return [];
  }

  const merged = mergeSegments(segments, safeLength);
  if (!merged.length) {
    return [{ start: 0, end: safeLength }];
  }

  const inverse = [];
  let cursor = 0;
  merged.forEach((segment) => {
    if (segment.start > cursor) {
      inverse.push({ start: cursor, end: segment.start });
    }
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < safeLength) {
    inverse.push({ start: cursor, end: safeLength });
  }
  return inverse;
}

function buildSequenceFromSegments(sequence, segments) {
  const text = String(sequence || '');
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => text.slice(segment.start, segment.end))
    .join('');
}

function overlapLength(leftSegments, rightSegments) {
  const left = mergeSegments(leftSegments, Number.MAX_SAFE_INTEGER);
  const right = mergeSegments(rightSegments, Number.MAX_SAFE_INTEGER);
  let leftIndex = 0;
  let rightIndex = 0;
  let total = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftSegment = left[leftIndex];
    const rightSegment = right[rightIndex];
    const start = Math.max(leftSegment.start, rightSegment.start);
    const end = Math.min(leftSegment.end, rightSegment.end);
    if (end > start) {
      total += end - start;
    }
    if (leftSegment.end <= rightSegment.end) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }

  return total;
}

function buildCircularKmerIndex(sequence, kmerLength) {
  const text = String(sequence || '');
  const k = Math.max(1, Math.round(Number(kmerLength) || 0));
  const index = new Map();
  if (!text.length || k > text.length) {
    return index;
  }

  const expanded = `${text}${text.slice(0, Math.max(0, k - 1))}`;
  for (let start = 0; start < text.length; start += 1) {
    const kmer = expanded.slice(start, start + k);
    if (!index.has(kmer)) {
      index.set(kmer, []);
    }
    index.get(kmer).push(start);
  }
  return index;
}

function chooseSeedLength(hostLength, queryLength) {
  const minLength = Math.max(
    1,
    Math.min(Math.max(0, Number(hostLength) || 0), Math.max(0, Number(queryLength) || 0))
  );
  if (minLength >= 4000) {
    return 16;
  }
  if (minLength >= 1200) {
    return 14;
  }
  if (minLength >= 300) {
    return 12;
  }
  if (minLength >= 120) {
    return 10;
  }
  if (minLength >= 60) {
    return 8;
  }
  if (minLength >= 24) {
    return 6;
  }
  return Math.max(4, Math.min(5, Math.floor(minLength / 3)));
}

function collectRotationPairs(hostSequence, querySequence) {
  const hostLength = Math.max(0, String(hostSequence || '').length);
  const queryLength = Math.max(0, String(querySequence || '').length);
  if (!hostLength || !queryLength) {
    return [];
  }

  if (hostLength * queryLength <= 8192) {
    const pairs = [];
    for (let hostStart = 0; hostStart < hostLength; hostStart += 1) {
      for (let queryStart = 0; queryStart < queryLength; queryStart += 1) {
        pairs.push({ hostStart, queryStart, rarity: 1 });
      }
    }
    return pairs;
  }

  const maxPairs = 160;
  const pairs = [];
  const seen = new Set();
  const queryIndexCache = new Map();
  const initialSeedLength = chooseSeedLength(hostLength, queryLength);

  for (let seedLength = initialSeedLength; seedLength >= 4; seedLength -= 2) {
    if (seedLength > hostLength || seedLength > queryLength) {
      continue;
    }

    if (!queryIndexCache.has(seedLength)) {
      queryIndexCache.set(seedLength, buildCircularKmerIndex(querySequence, seedLength));
    }
    const queryIndex = queryIndexCache.get(seedLength);
    const hostExpanded = `${hostSequence}${hostSequence.slice(0, Math.max(0, seedLength - 1))}`;
    const seedPairs = [];

    for (let hostStart = 0; hostStart < hostLength; hostStart += 1) {
      const seed = hostExpanded.slice(hostStart, hostStart + seedLength);
      const queryStarts = queryIndex.get(seed);
      if (!Array.isArray(queryStarts) || !queryStarts.length || queryStarts.length > 16) {
        continue;
      }
      queryStarts.forEach((queryStart) => {
        const key = `${hostStart}:${queryStart}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        seedPairs.push({
          hostStart,
          queryStart,
          rarity: queryStarts.length
        });
      });
    }

    seedPairs.sort((left, right) => {
      if (left.rarity !== right.rarity) {
        return left.rarity - right.rarity;
      }
      if (left.hostStart !== right.hostStart) {
        return left.hostStart - right.hostStart;
      }
      return left.queryStart - right.queryStart;
    });

    pairs.push(...seedPairs.slice(0, Math.max(0, maxPairs - pairs.length)));
    if (pairs.length >= maxPairs || pairs.length >= 32) {
      break;
    }
  }

  if (pairs.length) {
    return pairs;
  }

  const sampledPairs = [];
  const hostStep = Math.max(1, Math.floor(hostLength / 24));
  const queryStep = Math.max(1, Math.floor(queryLength / 24));
  for (let hostStart = 0; hostStart < hostLength; hostStart += hostStep) {
    for (let queryStart = 0; queryStart < queryLength; queryStart += queryStep) {
      sampledPairs.push({ hostStart, queryStart, rarity: 999 });
      if (sampledPairs.length >= maxPairs) {
        return sampledPairs;
      }
    }
  }
  return sampledPairs;
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

function evaluateSingleInsertAlignment(hostSequence, querySequence, hostStart, queryStart) {
  const hostLength = hostSequence.length;
  const queryLength = querySequence.length;
  const rotatedHost = circularSlice(hostSequence, hostStart, hostLength);
  const rotatedQuery = circularSlice(querySequence, queryStart, queryLength);

  const prefixLength = commonPrefixLength(rotatedHost, rotatedQuery, hostLength);
  const suffixLength = Math.min(
    commonSuffixLength(rotatedHost, rotatedQuery, hostLength),
    Math.max(0, hostLength - prefixLength)
  );
  const insertWindowStart = clampInteger(prefixLength, 0, queryLength, 0);
  const insertWindowEnd = clampInteger(queryLength - suffixLength, insertWindowStart, queryLength, insertWindowStart);
  const insertLength = Math.max(0, insertWindowEnd - insertWindowStart);
  const backboneLength = prefixLength + suffixLength;

  return {
    hostStart,
    queryStart,
    prefixLength,
    suffixLength,
    backboneLength,
    insertWindowStart,
    insertWindowEnd,
    insertLength
  };
}

function compareAlignmentCandidates(left, right) {
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
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
  if (left.orientationRank !== right.orientationRank) {
    return left.orientationRank - right.orientationRank;
  }
  if (left.hostStart !== right.hostStart) {
    return left.hostStart - right.hostStart;
  }
  return left.queryStart - right.queryStart;
}

function analyzeHostVectorAgainstQuery(entry, hostSequence, querySequence, reverseComplementIupac) {
  const normalizedHost = String(hostSequence || '');
  const normalizedQuery = String(querySequence || '');
  if (!normalizedHost.length || !normalizedQuery.length) {
    return null;
  }

  const orientations = [
    {
      label: 'forward',
      sequence: normalizedHost,
      orientationRank: 0
    }
  ];
  const reverseHost = reverseComplementIupac(normalizedHost);
  if (reverseHost && reverseHost !== normalizedHost) {
    orientations.push({
      label: 'reverse',
      sequence: reverseHost,
      orientationRank: 1
    });
  }

  let best = null;
  orientations.forEach((orientation) => {
    collectRotationPairs(orientation.sequence, normalizedQuery).forEach((pair) => {
      const candidate = evaluateSingleInsertAlignment(
        orientation.sequence,
        normalizedQuery,
        pair.hostStart,
        pair.queryStart
      );
      const insertSegments = circularRangeToSegments(
        pair.queryStart + candidate.insertWindowStart,
        candidate.insertLength,
        normalizedQuery.length
      );
      const backboneSegments = invertSegments(insertSegments, normalizedQuery.length);
      const enriched = {
        ...candidate,
        entryId: entry.id,
        hostLength: orientation.sequence.length,
        hostCoverage: orientation.sequence.length > 0 ? candidate.backboneLength / orientation.sequence.length : 0,
        orientation: orientation.label,
        orientationRank: orientation.orientationRank,
        insertSegments,
        backboneSegments,
        insertSequence: buildSequenceFromSegments(normalizedQuery, insertSegments),
        backboneSequence: buildSequenceFromSegments(normalizedQuery, backboneSegments)
      };
      if (compareAlignmentCandidates(enriched, best) < 0) {
        best = enriched;
      }
    });
  });

  return best;
}

function isAlignmentAcceptable(alignment) {
  if (!alignment) {
    return false;
  }
  const minimumSharedLength = Math.min(
    Math.max(MIN_BACKBONE_SHARED_LENGTH, Math.floor((alignment?.hostLength || 0) * 0.5)),
    alignment?.hostLength || 0
  );
  if (alignment.backboneLength < minimumSharedLength) {
    return false;
  }
  return alignment.hostCoverage >= MIN_HOST_COVERAGE || alignment.hostLength <= 48;
}

function extractSequenceFromGbkText(normalizeSequenceText, gbkText) {
  const raw = String(gbkText || '');
  if (!raw) {
    return '';
  }
  const originMatch = raw.match(/(^|\n)ORIGIN\b([\s\S]*?)(?:\n\/\/|\s*$)/i);
  if (!originMatch) {
    return '';
  }
  return normalizeSequenceText(originMatch[2].replace(/[0-9\s/]+/g, ''));
}

function extractRecordFromGbkText(normalizeSequenceText, gbkText) {
  const raw = String(gbkText || '');
  const locusLine = raw.match(/^LOCUS.*$/m)?.[0] || '';
  return {
    sequence: extractSequenceFromGbkText(normalizeSequenceText, raw),
    topology: /circular/i.test(locusLine) ? 'circular' : 'linear'
  };
}

async function loadExportedStandardPromoters(normalizeSequenceText) {
  if (!exportedStandardPromotersPromise) {
    exportedStandardPromotersPromise = import(pathToFileURL(EXPORTED_STANDARD_FEATURES_PATH).href)
      .then((module) => {
        const records = Array.isArray(module?.EXPORTED_STANDARD_FEATURES)
          ? module.EXPORTED_STANDARD_FEATURES
          : [];
        const seen = new Set();
        return records
          .map((record, index) => ({
            id: `exported_promoter_${index + 1}`,
            label: normalizeDisplayName(record?.label, ''),
            sequence: normalizeSequenceText(record?.sequence),
            type: 'promoter',
            source: 'exported_standard_features'
          }))
          .filter((record) => record.label && record.sequence.length >= MIN_QUERY_LENGTH)
          .filter((record) => {
            const key = `${record.label}\n${record.sequence}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
      })
      .catch(() => []);
  }
  return exportedStandardPromotersPromise;
}

async function loadSequenceViewerAnalysisModules() {
  if (!sequenceViewerAnalysisPromise) {
    sequenceViewerAnalysisPromise = Promise.all([
      import(pathToFileURL(ORF_ANALYSIS_PATH).href),
      import(pathToFileURL(RESTRICTION_ANALYSIS_PATH).href)
    ])
      .then(([orfAnalysisModule, restrictionAnalysisModule]) => ({
        buildOrfFeatures: typeof orfAnalysisModule?.buildOrfFeatures === 'function'
          ? orfAnalysisModule.buildOrfFeatures
          : () => [],
        buildCommercialRestrictionFeatures: typeof restrictionAnalysisModule?.buildCommercialRestrictionFeatures === 'function'
          ? restrictionAnalysisModule.buildCommercialRestrictionFeatures
          : () => []
      }))
      .catch(() => ({
        buildOrfFeatures: () => [],
        buildCommercialRestrictionFeatures: () => []
      }));
  }
  return sequenceViewerAnalysisPromise;
}

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
    .sort((left, right) => {
      if (left.gap !== right.gap) {
        return left.gap - right.gap;
      }
      if (left.length !== right.length) {
        return right.length - left.length;
      }
      return left.start - right.start;
    });

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
    .map((hit) => ({
      ...hit,
      distance: positiveModulo(orfStart - hit.start, hit.sequenceLength || 0)
    }))
    .sort(compareSiteCandidates);

  const local = ranked.filter((hit) => hit.distance <= DEFAULT_RESTRICTION_FLANK_MAX_GAP);
  return local[0] || ranked[0] || null;
}

function chooseNearestDownstreamSite(hits, orfEnd, usedUpstream = null) {
  const ranked = (Array.isArray(hits) ? hits : [])
    .filter((hit) => !usedUpstream || hit.start !== usedUpstream.start || hit.length !== usedUpstream.length || hit.name !== usedUpstream.name)
    .map((hit) => ({
      ...hit,
      distance: positiveModulo(hit.start - orfEnd, hit.sequenceLength || 0)
    }))
    .sort(compareSiteCandidates);

  const local = ranked.filter((hit) => hit.distance <= DEFAULT_RESTRICTION_FLANK_MAX_GAP);
  return local[0] || ranked[0] || null;
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

  return mergeSegments(
    orientedSegments.map((segment) => ({
      start: totalLength - segment.end,
      end: totalLength - segment.start
    })),
    totalLength
  );
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

  const reverseQuery = reverseComplementIupac(querySequence);
  const minOrfAaLength = Math.max(1, Math.ceil(MIN_ORF_LENGTH / 3) - 1);
  const orientedContexts = new Map([
    [
      1,
      {
        sequence: querySequence,
        orfHits: buildOrfHitsFromFeatures(
          buildOrfFeatures(querySequence, 'circular', { minAaLength: minOrfAaLength }),
          totalLength
        ),
        restrictionHits: buildRestrictionHitsFromFeatures(
          buildCommercialRestrictionFeatures(querySequence, 'circular'),
          totalLength
        )
      }
    ],
    [
      -1,
      {
        sequence: reverseQuery,
        orfHits: buildOrfHitsFromFeatures(
          buildOrfFeatures(reverseQuery, 'circular', { minAaLength: minOrfAaLength }),
          totalLength
        ),
        restrictionHits: buildRestrictionHitsFromFeatures(
          buildCommercialRestrictionFeatures(reverseQuery, 'circular'),
          totalLength
        )
      }
    ]
  ]);

  const candidates = [];
  const seen = new Set();

  (Array.isArray(promoterAnnotationHits) ? promoterAnnotationHits : []).forEach((hit) => {
    const strand = Number(hit?.strand) === -1 ? -1 : 1;
    const context = orientedContexts.get(strand);
    if (!context?.sequence?.length) {
      return;
    }

    const promoterLength = Math.max(
      1,
      Number(hit?.matchedLength) || sumSegmentLength(hit?.segments)
    );
    const promoterName = normalizeDisplayName(hit?.recordName || hit?.recordId, 'Promoter');
    const promoterSegments = mergeSegments(hit?.segments, totalLength);
    const promoterStart = strand === 1
      ? positiveModulo(Number(hit?.start) || promoterSegments[0]?.start || 0, totalLength)
      : positiveModulo(totalLength - positiveModulo((Number(hit?.start) || 0) + promoterLength, totalLength), totalLength);
    const promoterEnd = promoterStart + promoterLength;

    const orf = findNearestDownstreamOrf(context.orfHits, promoterEnd, {
      maxGap: DEFAULT_PROMOTER_TO_ORF_MAX_GAP
    });
    if (!orf) {
      return;
    }

    const orfSegments = orientedRangeToOriginalSegments(orf.start, orf.length, totalLength, strand);
    const promoterInfo = {
      name: promoterName,
      strand,
      matchedLength: promoterLength,
      identity: Number(hit?.identity) || 0,
      coverage: Number(hit?.coverage) || 0,
      segments: promoterSegments,
      gapToOrf: Math.max(0, Number(orf.gap) || 0)
    };
    const orfInfo = {
      name: `Nearest ORF (${Math.max(0, Math.floor(orf.length / 3) - 1)} aa)`,
      strand,
      length: orf.length,
      startCodon: orf.startCodon,
      stopCodon: orf.stopCodon,
      segments: orfSegments
    };

    const candidateKey = `${promoterName}|${strand}|${promoterStart}|${orf.start}|${orf.length}`;
    if (seen.has(candidateKey)) {
      return;
    }
    seen.add(candidateKey);

    const gibsonVariant = buildVariantFromOrientedRange({
      querySequence,
      totalLength,
      strand,
      start: orf.start,
      length: orf.length,
      source: 'promoter_orf',
      startCodon: orf.startCodon,
      stopCodon: orf.stopCodon
    });

    const upstreamSiteHit = chooseNearestUpstreamSite(
      context.restrictionHits,
      orf.start
    );
    const downstreamSiteHit = chooseNearestDownstreamSite(
      context.restrictionHits,
      positiveModulo(orf.start + orf.length, totalLength),
      upstreamSiteHit
    );

    let restrictionVariant = null;
    if (upstreamSiteHit && downstreamSiteHit) {
      const restrictionInsertLength = positiveModulo(downstreamSiteHit.end - upstreamSiteHit.start, totalLength);
      const distanceFromInsertStartToOrf = positiveModulo(orf.start - upstreamSiteHit.start, totalLength);
      if (
        restrictionInsertLength > 0
        && restrictionInsertLength < totalLength
        && distanceFromInsertStartToOrf + orf.length <= restrictionInsertLength
      ) {
        restrictionVariant = buildVariantFromOrientedRange({
          querySequence,
          totalLength,
          strand,
          start: upstreamSiteHit.start,
          length: restrictionInsertLength,
          source: 'promoter_orf',
          startCodon: orf.startCodon,
          stopCodon: orf.stopCodon,
          upstreamSite: buildRestrictionSiteOutput(upstreamSiteHit, totalLength, strand),
          downstreamSite: buildRestrictionSiteOutput(downstreamSiteHit, totalLength, strand),
          siteExtensionApplied: upstreamSiteHit.start !== orf.start || positiveModulo(orf.start + orf.length, totalLength) !== downstreamSiteHit.end
        });
      }
    }

    candidates.push({
      id: `promoter_${candidates.length + 1}_${positiveModulo(promoterStart, totalLength)}`,
      label: promoterName,
      promoter: promoterInfo,
      orf: orfInfo,
      variants: {
        gibson: gibsonVariant,
        restriction: restrictionVariant
      }
    });
  });

  return candidates
    .filter((candidate) => candidate?.variants?.gibson || candidate?.variants?.restriction)
    .sort((left, right) => {
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
    })
    .slice(0, DEFAULT_MAX_PROMOTER_SELECTIONS);
}

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
      // Keep query-anchored segments for the circular preview, but surface the
      // matched host-vector backbone sequence for restriction-cloning output.
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

async function recognizeSequenceBackboneInLibrary(deps, payload = {}) {
  const {
    fs,
    cleanText,
    normalizeSequenceText,
    resolveLibraryPaths,
    ensureLibraryDirectories,
    openDatabase,
    readRows,
    normalizeEntryRow,
    ensurePathWithinRoot,
    STATUS_SAVED,
    reverseComplementIupac
  } = deps;

  const paths = resolveLibraryPaths(payload.storagePath);
  await ensureLibraryDirectories(paths);

  const querySequence = normalizeSequenceText(payload.sequence);
  if (querySequence.length < MIN_QUERY_LENGTH) {
    return {
      queryLength: querySequence.length,
      match: null
    };
  }

  const {
    buildOrfFeatures,
    buildCommercialRestrictionFeatures
  } = await loadSequenceViewerAnalysisModules();
  const exportedPromoters = await loadExportedStandardPromoters(normalizeSequenceText);
  const promoterAnnotation = exportedPromoters.length
    ? annotateCircularPlasmidSequenceSync(querySequence, exportedPromoters, {
      maxWorkers: 1,
      maxHitsPerRecord: 16,
      minRecordLength: MIN_QUERY_LENGTH
    })
    : { matches: [] };
  const promoterCandidates = buildPromoterCandidateSelections({
    reverseComplementIupac,
    querySequence,
    promoterAnnotationHits: promoterAnnotation?.matches || [],
    buildOrfFeatures,
    buildCommercialRestrictionFeatures
  });

  const safeExcludeEntryId = cleanText(payload.excludeEntryId, 200);
  const db = await openDatabase(paths.sqlitePath);
  let entries = [];
  try {
    entries = readRows(
      db,
      `SELECT * FROM sequence_entries
       ORDER BY
         CASE WHEN status = '${STATUS_SAVED}' THEN 0 ELSE 1 END,
         ABS(sequence_length - ?) ASC,
         updated_at DESC,
         name COLLATE NOCASE ASC`,
      [querySequence.length]
    )
      .map((row) => normalizeEntryRow(row))
      .filter(Boolean)
      .filter((entry) => entry.id !== safeExcludeEntryId);
  } finally {
    db.close();
  }

  let bestMatch = null;

  for (const entry of entries) {
    try {
      const gbkPath = ensurePathWithinRoot(paths.libraryRoot, entry.gbkRelPath);
      const gbkText = await fs.readFile(gbkPath, 'utf8');
      const hostRecord = extractRecordFromGbkText(normalizeSequenceText, gbkText);
      if (!hostRecord.sequence.length) {
        continue;
      }

      const alignment = analyzeHostVectorAgainstQuery(
        entry,
        hostRecord.sequence,
        querySequence,
        reverseComplementIupac
      );
      if (!isAlignmentAcceptable(alignment)) {
        continue;
      }

      const candidate = buildRecognitionMatch(entry, alignment, promoterCandidates);
      if (compareRecognitionMatches(candidate, bestMatch, STATUS_SAVED) < 0) {
        bestMatch = candidate;
      }
    } catch {
      // Ignore malformed entries and keep checking the rest of the library.
    }
  }

  return {
    queryLength: querySequence.length,
    match: bestMatch || buildPromoterAlignedRecognitionMatch(promoterCandidates)
  };
}

module.exports = {
  recognizeSequenceBackboneInLibrary
};
