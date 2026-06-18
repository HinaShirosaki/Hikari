'use strict';
const {
  buildBaseMaskArray,
  buildCircularSegments,
  containsOnlyStrictBases,
  formatCircularLocation,
  normalizeDnaSequence,
  positiveModulo,
  reverseComplementDna
} = require('./dna-utils');
const {
  chooseSeedWindows,
  countCircularMismatches,
  resolveAllowedMismatchCount
} = require('./seed-search');
function buildAnnotationHit(record, orientation, start, queryLength, mismatches, mode) {
  const patternLength = orientation.sequence.length;
  const segments = buildCircularSegments(start, patternLength, queryLength);
  const identity = patternLength > 0
    ? Math.max(0, (patternLength - mismatches) / patternLength)
    : 0;
  return {
    recordIndex: record.recordIndex,
    recordId: record.recordId,
    recordName: record.recordName,
    featureType: record.featureType,
    source: record.source,
    recordTopology: record.topology,
    strand: orientation.strand,
    orientation: orientation.label,
    mode,
    start,
    end: positiveModulo(start + patternLength, queryLength),
    spansOrigin: segments.length > 1,
    segments,
    locationText: formatCircularLocation(segments),
    recordLength: record.sequence.length,
    matchedLength: patternLength,
    mismatches,
    identity,
    coverage: record.sequence.length > 0 ? patternLength / record.sequence.length : 0
  };
}
function collectExactCircularHits(context, record, orientation, options, dedupe) {
  const pattern = orientation.sequence;
  if (!pattern.length || pattern.length > context.queryLength) {
    return [];
  }
  if (!context.queryIsStrict || !containsOnlyStrictBases(pattern)) {
    return [];
  }
  const hits = [];
  let fromIndex = 0;
  while (fromIndex < context.queryLength && hits.length < options.maxHitsPerRecord) {
    const position = context.queryTwice.indexOf(pattern, fromIndex);
    if (position === -1 || position >= context.queryLength) {
      break;
    }
    const hitKey = `${record.recordIndex}|${orientation.strand}|${position}|0|exact`;
    if (!dedupe.has(hitKey)) {
      dedupe.add(hitKey);
      hits.push(buildAnnotationHit(record, orientation, position, context.queryLength, 0, 'exact'));
    }
    fromIndex = position + 1;
  }
  return hits;
}
function collectApproximateCircularHits(context, record, orientation, options, dedupe) {
  const pattern = orientation.sequence;
  if (!pattern.length || pattern.length > context.queryLength) {
    return [];
  }
  const allowedMismatches = resolveAllowedMismatchCount(pattern.length, options);
  const needsCompatibilitySearch = !context.queryIsStrict || !containsOnlyStrictBases(pattern);
  if (!needsCompatibilitySearch && allowedMismatches <= 0) {
    return [];
  }
  const seeds = chooseSeedWindows(pattern, allowedMismatches, options.minSeedLength);
  const candidateStarts = new Set();
  for (const seed of seeds) {
    let fromIndex = 0;
    while (fromIndex < context.queryLength && candidateStarts.size < options.approximateCandidateCap) {
      const seedPosition = context.queryTwice.indexOf(seed.text, fromIndex);
      if (seedPosition === -1 || seedPosition >= context.queryLength) {
        break;
      }
      candidateStarts.add(positiveModulo(seedPosition - seed.offset, context.queryLength));
      fromIndex = seedPosition + 1;
    }
    if (candidateStarts.size >= options.approximateCandidateCap) {
      break;
    }
  }
  if (!candidateStarts.size && (context.queryLength * pattern.length) <= options.bruteForceCompatibilityLimit) {
    for (let start = 0; start < context.queryLength; start += 1) {
      candidateStarts.add(start);
    }
  }
  return buildApproximateHits([...candidateStarts].sort((left, right) => left - right), context, record, orientation, options, dedupe, allowedMismatches);
}
function buildApproximateHits(candidates, context, record, orientation, options, dedupe, allowedMismatches) {
  const hits = [];
  for (const start of candidates) {
    if (hits.length >= options.maxHitsPerRecord) {
      break;
    }
    const mismatches = countCircularMismatches(context.queryMasks, orientation.sequence, start, allowedMismatches);
    if (!Number.isFinite(mismatches)) {
      continue;
    }
    const hitKey = `${record.recordIndex}|${orientation.strand}|${start}|${mismatches}|seeded-hamming`;
    if (dedupe.has(hitKey)) {
      continue;
    }
    dedupe.add(hitKey);
    hits.push(buildAnnotationHit(
      record,
      orientation,
      start,
      context.queryLength,
      mismatches,
      mismatches === 0 ? 'compatible-exact' : 'seeded-hamming'
    ));
  }
  return hits;
}
function scanSingleRecord(context, record, options) {
  if (!record.sequence || record.sequence.length < options.minRecordLength || record.sequence.length > context.queryLength) {
    return { matches: [], exactMatches: 0, approximateMatches: 0, skipped: true };
  }
  const orientations = [{ label: 'forward', strand: 1, sequence: record.sequence }];
  if (options.allowReverseComplement) {
    const reverse = reverseComplementDna(record.sequence);
    if (reverse !== record.sequence) {
      orientations.push({ label: 'reverse_complement', strand: -1, sequence: reverse });
    }
  }
  const dedupe = new Set();
  const matches = [];
  let exactMatches = 0;
  let approximateMatches = 0;
  for (const orientation of orientations) {
    if (matches.length >= options.maxHitsPerRecord) {
      break;
    }
    const exactHits = collectExactCircularHits(context, record, orientation, options, dedupe);
    if (exactHits.length) {
      exactMatches += exactHits.length;
      matches.push(...exactHits);
      continue;
    }
    const approximateHits = collectApproximateCircularHits(context, record, orientation, options, dedupe);
    approximateMatches += approximateHits.length;
    matches.push(...approximateHits);
  }
  matches.sort((left, right) => (left.mismatches - right.mismatches) || (left.start - right.start) || (right.strand - left.strand));
  return { matches: matches.slice(0, options.maxHitsPerRecord), exactMatches, approximateMatches, skipped: false };
}
function scanDatabaseChunk(querySequence, records, options) {
  const query = normalizeDnaSequence(querySequence);
  const context = {
    query,
    queryLength: query.length,
    queryTwice: `${query}${query}`,
    queryIsStrict: containsOnlyStrictBases(query),
    queryMasks: buildBaseMaskArray(`${query}${query}`)
  };
  const stats = { queryLength: context.queryLength, scannedRecords: 0, skippedRecords: 0, exactMatches: 0, approximateMatches: 0 };
  const matches = [];
  for (const record of records) {
    stats.scannedRecords += 1;
    const result = scanSingleRecord(context, record, options);
    if (result.skipped) {
      stats.skippedRecords += 1;
      continue;
    }
    stats.exactMatches += result.exactMatches;
    stats.approximateMatches += result.approximateMatches;
    matches.push(...result.matches);
  }
  return { matches, stats };
}
module.exports = { scanDatabaseChunk };
