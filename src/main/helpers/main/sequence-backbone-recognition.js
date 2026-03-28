'use strict';

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

function circularSlice(normalizeSequenceText, sequence, start, length) {
  const text = normalizeSequenceText(sequence);
  const textLength = text.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!textLength || !desiredLength) {
    return '';
  }

  let cursor = ((Math.round(Number(start) || 0) % textLength) + textLength) % textLength;
  let remaining = desiredLength;
  let result = '';

  while (remaining > 0) {
    const chunkLength = Math.min(remaining, textLength - cursor);
    result += text.slice(cursor, cursor + chunkLength);
    remaining -= chunkLength;
    cursor = 0;
  }

  return result;
}

function buildCircularKmerIndex(normalizeSequenceText, sequence, kmerLength) {
  const text = normalizeSequenceText(sequence);
  const length = text.length;
  const k = Math.max(1, Math.round(Number(kmerLength) || 0));
  const index = new Map();
  if (!length || k > length) {
    return index;
  }

  const expanded = `${text}${text.slice(0, Math.max(0, k - 1))}`;
  for (let start = 0; start < length; start += 1) {
    const kmer = expanded.slice(start, start + k);
    if (!index.has(kmer)) {
      index.set(kmer, []);
    }
    index.get(kmer).push(start);
  }

  return index;
}

function commonPrefixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeMax = Math.min(
    Math.max(0, Math.round(Number(maxLength) || 0)),
    String(left || '').length,
    String(right || '').length
  );
  let matched = 0;
  while (matched < safeMax && left[matched] === right[matched]) {
    matched += 1;
  }
  return matched;
}

function commonSuffixLength(left, right, maxLength = Number.POSITIVE_INFINITY) {
  const safeLeft = String(left || '');
  const safeRight = String(right || '');
  const safeMax = Math.min(
    Math.max(0, Math.round(Number(maxLength) || 0)),
    safeLeft.length,
    safeRight.length
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

function determineBackboneSeedLength(hostLength, queryLength) {
  const minLength = Math.max(1, Math.min(Math.max(0, Number(hostLength) || 0), Math.max(0, Number(queryLength) || 0)));
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

function collectCircularRotationPairs(normalizeSequenceText, hostSequence, querySequence) {
  const hostLength = Math.max(0, String(hostSequence || '').length);
  const queryLength = Math.max(0, String(querySequence || '').length);
  if (!hostLength || !queryLength) {
    return [];
  }

  if (hostLength * queryLength <= 8192) {
    const bruteForcePairs = [];
    for (let hostStart = 0; hostStart < hostLength; hostStart += 1) {
      for (let queryStart = 0; queryStart < queryLength; queryStart += 1) {
        bruteForcePairs.push({ hostStart, queryStart, rarity: 1 });
      }
    }
    return bruteForcePairs;
  }

  const maxPairs = 144;
  const pairs = [];
  const seen = new Set();
  const targetIndexCache = new Map();
  const initialSeedLength = determineBackboneSeedLength(hostLength, queryLength);

  for (let seedLength = initialSeedLength; seedLength >= 4; seedLength -= 2) {
    if (seedLength > hostLength || seedLength > queryLength) {
      continue;
    }

    if (!targetIndexCache.has(seedLength)) {
      targetIndexCache.set(seedLength, buildCircularKmerIndex(normalizeSequenceText, querySequence, seedLength));
    }

    const targetIndex = targetIndexCache.get(seedLength);
    const hostExpanded = `${hostSequence}${hostSequence.slice(0, Math.max(0, seedLength - 1))}`;
    const seedPairs = [];

    for (let hostStart = 0; hostStart < hostLength; hostStart += 1) {
      const seed = hostExpanded.slice(hostStart, hostStart + seedLength);
      const queryStarts = targetIndex.get(seed);
      if (!Array.isArray(queryStarts) || !queryStarts.length || queryStarts.length > 12) {
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
    if (pairs.length >= maxPairs || pairs.length >= 24) {
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

function evaluateCircularInsertionCandidate(clamp, normalizeSequenceText, hostSequence, querySequence, hostStart, queryStart) {
  const hostLength = hostSequence.length;
  const queryLength = querySequence.length;
  const rotatedHost = circularSlice(normalizeSequenceText, hostSequence, hostStart, hostLength);
  const rotatedQuery = circularSlice(normalizeSequenceText, querySequence, queryStart, queryLength);

  const prefixLength = commonPrefixLength(rotatedHost, rotatedQuery, hostLength);
  const rawSuffixLength = commonSuffixLength(rotatedHost, rotatedQuery, hostLength);
  const suffixLength = Math.min(rawSuffixLength, Math.max(0, hostLength - prefixLength));
  const backboneLength = prefixLength + suffixLength;
  const insertWindowStart = clamp(Math.max(0, prefixLength), 0, queryLength);
  const insertWindowEnd = clamp(queryLength - suffixLength, insertWindowStart, queryLength);

  return {
    hostStart,
    queryStart,
    prefixLength,
    suffixLength,
    backboneLength,
    insertWindowStart,
    insertWindowEnd,
    insertLength: Math.max(0, insertWindowEnd - insertWindowStart)
  };
}

function mergeSegments(clamp, segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, safeLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, safeLength)
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    })
    .reduce((acc, segment) => {
      const previous = acc[acc.length - 1];
      if (!previous || segment.start > previous.end) {
        acc.push(segment);
        return acc;
      }
      previous.end = Math.max(previous.end, segment.end);
      return acc;
    }, []);
}

function mapRotatedWindowRangeToSegments(clamp, queryStart, rangeStart, rangeEnd, queryLength) {
  const safeLength = Math.max(0, Number(queryLength) || 0);
  const start = clamp(Math.round(Number(rangeStart) || 0), 0, safeLength);
  const end = clamp(Math.round(Number(rangeEnd) || 0), start, safeLength);
  if (!safeLength || end <= start) {
    return [];
  }

  const normalizedWindowStart = ((Math.round(Number(queryStart) || 0) % safeLength) + safeLength) % safeLength;
  const absoluteStart = (normalizedWindowStart + start) % safeLength;
  const absoluteEnd = (normalizedWindowStart + end) % safeLength;

  if (absoluteStart < absoluteEnd) {
    return [{ start: absoluteStart, end: absoluteEnd }];
  }

  return mergeSegments(clamp, [
    { start: absoluteStart, end: safeLength },
    { start: 0, end: absoluteEnd }
  ], safeLength);
}

function buildRecognitionThresholds(hostLength, queryLength) {
  const minLength = Math.max(0, Math.min(Math.max(0, Number(hostLength) || 0), Math.max(0, Number(queryLength) || 0)));
  return {
    minBackboneLength: minLength >= 1000
      ? Math.max(400, Math.floor(minLength * 0.35))
      : Math.max(12, Math.floor(minLength * 0.45)),
    minHostCoverage: minLength >= 1000 ? 0.6 : 0.55,
    minQueryCoverage: minLength >= 1000 ? 0.5 : 0.45
  };
}

function isRecognitionCandidateAcceptable(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const thresholds = buildRecognitionThresholds(candidate.hostSequenceLength, candidate.queryLength);
  return candidate.backboneLength >= thresholds.minBackboneLength
    && candidate.hostCoverage >= thresholds.minHostCoverage
    && candidate.queryCoverage >= thresholds.minQueryCoverage;
}

function compareRecognitionCandidates(left, right, STATUS_SAVED) {
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
  const leftSaved = left.hostVectorStatus === STATUS_SAVED ? 1 : 0;
  const rightSaved = right.hostVectorStatus === STATUS_SAVED ? 1 : 0;
  if (leftSaved !== rightSaved) {
    return rightSaved - leftSaved;
  }
  if (left.insertLength !== right.insertLength) {
    return left.insertLength - right.insertLength;
  }
  return String(left.hostVectorName || '').localeCompare(String(right.hostVectorName || ''));
}

function analyzeStoredVectorAgainstQuery(deps, entry, hostSequence, querySequence) {
  const {
    cleanText,
    normalizeSequenceText,
    normalizeStatus,
    clamp,
    reverseComplementIupac,
    STATUS_SAVED
  } = deps;
  const normalizedHostSequence = normalizeSequenceText(hostSequence);
  const normalizedQuerySequence = normalizeSequenceText(querySequence);
  const hostLength = normalizedHostSequence.length;
  const queryLength = normalizedQuerySequence.length;
  if (!hostLength || !queryLength) {
    return null;
  }

  const candidatePool = [];
  [
    { orientation: 'forward', sequence: normalizedHostSequence },
    { orientation: 'reverse', sequence: reverseComplementIupac(normalizedHostSequence) }
  ].forEach((orientationCandidate) => {
    const rotationPairs = collectCircularRotationPairs(normalizeSequenceText, orientationCandidate.sequence, normalizedQuerySequence);
    rotationPairs.forEach((pair) => {
      const evaluated = evaluateCircularInsertionCandidate(
        clamp,
        normalizeSequenceText,
        orientationCandidate.sequence,
        normalizedQuerySequence,
        pair.hostStart,
        pair.queryStart
      );

      const backboneSegments = mergeSegments(clamp, [
        ...mapRotatedWindowRangeToSegments(clamp, pair.queryStart, 0, evaluated.prefixLength, queryLength),
        ...mapRotatedWindowRangeToSegments(clamp, pair.queryStart, queryLength - evaluated.suffixLength, queryLength, queryLength)
      ], queryLength);
      const insertSegments = mapRotatedWindowRangeToSegments(
        clamp,
        pair.queryStart,
        evaluated.insertWindowStart,
        evaluated.insertWindowEnd,
        queryLength
      );

      candidatePool.push({
        hostVectorId: cleanText(entry?.id, 200),
        hostVectorName: cleanText(entry?.name, 140),
        hostVectorStatus: normalizeStatus(entry?.status),
        hostTopology: cleanText(entry?.topology, 40) || 'linear',
        hostSequenceLength: hostLength,
        queryLength,
        orientation: orientationCandidate.orientation,
        backboneLength: evaluated.backboneLength,
        insertLength: evaluated.insertLength,
        hostCoverage: hostLength ? evaluated.backboneLength / hostLength : 0,
        queryCoverage: queryLength ? evaluated.backboneLength / queryLength : 0,
        prefixLength: evaluated.prefixLength,
        suffixLength: evaluated.suffixLength,
        backboneSegments,
        insertSegments
      });
    });
  });

  const ranked = candidatePool
    .filter(isRecognitionCandidateAcceptable)
    .sort((left, right) => compareRecognitionCandidates(left, right, STATUS_SAVED));
  return ranked[0] || null;
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
    STATUS_SAVED
  } = deps;

  const paths = resolveLibraryPaths(payload.storagePath);
  await ensureLibraryDirectories(paths);

  const querySequence = normalizeSequenceText(payload.sequence);
  if (querySequence.length < 12) {
    return {
      queryLength: querySequence.length,
      match: null
    };
  }

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
      const hostSequence = extractSequenceFromGbkText(normalizeSequenceText, gbkText);
      if (!hostSequence.length) {
        continue;
      }

      const candidate = analyzeStoredVectorAgainstQuery(deps, entry, hostSequence, querySequence);
      if (compareRecognitionCandidates(candidate, bestMatch, STATUS_SAVED) < 0) {
        bestMatch = candidate;
      }
    } catch {
      // Ignore malformed entries and keep evaluating the rest of the library.
    }
  }

  return {
    queryLength: querySequence.length,
    match: bestMatch
  };
}

module.exports = {
  recognizeSequenceBackboneInLibrary
};
