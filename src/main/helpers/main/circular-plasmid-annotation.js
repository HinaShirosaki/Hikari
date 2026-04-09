'use strict';

const os = require('os');

// Standalone circular plasmid annotator for future database integration.
// Fast path: native string search on the circularized query.
// Fallback path: seed-and-extend with IUPAC-aware Hamming distance.
// Parallel path: splits database records across worker_threads.

let workerThreads = null;
try {
  workerThreads = require('worker_threads');
} catch (error) {
  workerThreads = null;
}

const WORKER_MODE = 'annotate-circular-plasmid-chunk';

const BASE_MASKS = Object.freeze({
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 1 | 4,
  Y: 2 | 8,
  S: 2 | 4,
  W: 1 | 8,
  K: 4 | 8,
  M: 1 | 2,
  B: 2 | 4 | 8,
  D: 1 | 4 | 8,
  H: 1 | 2 | 8,
  V: 1 | 2 | 4,
  N: 1 | 2 | 4 | 8,
  X: 1 | 2 | 4 | 8
});

const REVERSE_COMPLEMENT_MAP = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
  X: 'N'
});

const DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS = Object.freeze({
  minRecordLength: 12,
  allowReverseComplement: true,
  maxHitsPerRecord: 8,
  maxWorkers: 0,
  workerThreshold: 256,
  recordsPerWorker: 256,
  maxMismatchCount: 0,
  maxMismatchRate: 0,
  minSeedLength: 12,
  approximateCandidateCap: 4096,
  bruteForceCompatibilityLimit: 2_000_000,
  sortResults: true
});

function cleanText(value, maxLength = 240) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function clampInteger(value, min, max, fallback = min) {
  const numeric = Math.trunc(Number(value));
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

function normalizeTopology(value) {
  return String(value || '').trim().toLowerCase() === 'linear' ? 'linear' : 'circular';
}

function normalizeDnaSequence(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/^>.*$/gm, '')
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYSWKMBDHVNX]/g, '');
}

function containsOnlyStrictBases(sequence) {
  return /^[ACGT]+$/.test(String(sequence || ''));
}

function reverseComplementDna(sequence) {
  const text = String(sequence || '').toUpperCase();
  let output = '';
  for (let index = text.length - 1; index >= 0; index -= 1) {
    output += REVERSE_COMPLEMENT_MAP[text[index]] || 'N';
  }
  return output;
}

function buildBaseMaskArray(sequence) {
  const text = String(sequence || '');
  const masks = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    masks[index] = BASE_MASKS[text[index]] || BASE_MASKS.N;
  }
  return masks;
}

function resolveAllowedMismatchCount(patternLength, options) {
  const byCount = clampInteger(
    options?.maxMismatchCount,
    0,
    Math.max(0, patternLength),
    0
  );
  const numericRate = Number(options?.maxMismatchRate);
  const byRate = Number.isFinite(numericRate) && numericRate > 0
    ? Math.floor(patternLength * numericRate)
    : 0;
  return Math.max(0, Math.min(patternLength, Math.max(byCount, byRate)));
}

function buildCircularSegments(start, length, queryLength) {
  const normalizedQueryLength = Math.max(0, Number(queryLength) || 0);
  const normalizedLength = Math.max(0, Number(length) || 0);
  if (!normalizedQueryLength || !normalizedLength) {
    return [];
  }

  const safeStart = positiveModulo(start, normalizedQueryLength);
  if (normalizedLength >= normalizedQueryLength) {
    if (safeStart === 0) {
      return [{ start: 0, end: normalizedQueryLength }];
    }
    return [
      { start: safeStart, end: normalizedQueryLength },
      { start: 0, end: safeStart }
    ];
  }

  const rawEnd = safeStart + normalizedLength;
  if (rawEnd <= normalizedQueryLength) {
    return [{ start: safeStart, end: rawEnd }];
  }

  return [
    { start: safeStart, end: normalizedQueryLength },
    { start: 0, end: rawEnd - normalizedQueryLength }
  ];
}

function formatCircularLocation(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => `${segment.start + 1}..${segment.end}`)
    .join(', ');
}

function longestStrictRun(text, minLength) {
  const sequence = String(text || '');
  const minimum = Math.max(1, Number(minLength) || 1);
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= sequence.length; index += 1) {
    const strict = index < sequence.length && /[ACGT]/.test(sequence[index]);
    if (strict) {
      if (currentStart === -1) {
        currentStart = index;
      }
      currentLength += 1;
      continue;
    }

    if (currentLength >= minimum && currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }

    currentStart = -1;
    currentLength = 0;
  }

  return bestStart >= 0 ? { start: bestStart, length: bestLength } : null;
}

function chooseSeedWindows(pattern, allowedMismatches, minSeedLength) {
  const sequence = String(pattern || '');
  if (!sequence.length) {
    return [];
  }

  const segmentCount = Math.max(1, allowedMismatches + 1);
  const desiredSeedLength = Math.max(
    1,
    Math.min(
      sequence.length,
      Math.max(
        1,
        Math.floor(sequence.length / segmentCount),
        Number(minSeedLength) || 1
      )
    )
  );

  const seeds = [];
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const segmentStart = Math.floor((segmentIndex * sequence.length) / segmentCount);
    const segmentEnd = Math.floor(((segmentIndex + 1) * sequence.length) / segmentCount);
    const segment = sequence.slice(segmentStart, segmentEnd);
    if (!segment.length) {
      continue;
    }

    const strictRun = longestStrictRun(segment, Math.min(desiredSeedLength, segment.length));
    if (!strictRun) {
      continue;
    }

    seeds.push({
      offset: segmentStart + strictRun.start,
      text: segment.slice(strictRun.start, strictRun.start + strictRun.length)
    });
  }

  return seeds
    .filter((seed) => seed.text.length > 0)
    .sort((left, right) => right.text.length - left.text.length);
}

function countCircularMismatches(queryMasks, patternMasks, start, allowedMismatches) {
  const limit = Math.max(0, Number(allowedMismatches) || 0);
  let mismatches = 0;

  for (let index = 0; index < patternMasks.length; index += 1) {
    if ((queryMasks[start + index] & patternMasks[index]) === 0) {
      mismatches += 1;
      if (mismatches > limit) {
        return Number.POSITIVE_INFINITY;
      }
    }
  }

  return mismatches;
}

function buildAnnotationHit(record, orientation, start, queryLength, mismatches, mode) {
  const patternLength = orientation.sequence.length;
  const segments = buildCircularSegments(start, patternLength, queryLength);
  const spansOrigin = segments.length > 1;
  const end = positiveModulo(start + patternLength, queryLength);
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
    end,
    spansOrigin,
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
    while (
      fromIndex < context.queryLength
      && candidateStarts.size < options.approximateCandidateCap
    ) {
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

  if (!candidateStarts.size) {
    return [];
  }

  const hits = [];
  const patternMasks = buildBaseMaskArray(pattern);
  const sortedCandidates = [...candidateStarts].sort((left, right) => left - right);

  for (const start of sortedCandidates) {
    if (hits.length >= options.maxHitsPerRecord) {
      break;
    }

    const mismatches = countCircularMismatches(
      context.queryMasks,
      patternMasks,
      start,
      allowedMismatches
    );
    if (!Number.isFinite(mismatches)) {
      continue;
    }

    const hitKey = `${record.recordIndex}|${orientation.strand}|${start}|${mismatches}|seeded-hamming`;
    if (dedupe.has(hitKey)) {
      continue;
    }

    dedupe.add(hitKey);
    hits.push(
      buildAnnotationHit(
        record,
        orientation,
        start,
        context.queryLength,
        mismatches,
        mismatches === 0 ? 'compatible-exact' : 'seeded-hamming'
      )
    );
  }

  return hits;
}

function scanSingleRecord(context, record, options) {
  if (!record.sequence || record.sequence.length < options.minRecordLength) {
    return {
      matches: [],
      exactMatches: 0,
      approximateMatches: 0,
      skipped: true
    };
  }

  if (record.sequence.length > context.queryLength) {
    return {
      matches: [],
      exactMatches: 0,
      approximateMatches: 0,
      skipped: true
    };
  }

  const orientations = [
    { label: 'forward', strand: 1, sequence: record.sequence }
  ];

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
    if (approximateHits.length) {
      approximateMatches += approximateHits.length;
      matches.push(...approximateHits);
    }
  }

  matches.sort((left, right) => {
    if (left.mismatches !== right.mismatches) {
      return left.mismatches - right.mismatches;
    }
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return right.strand - left.strand;
  });

  return {
    matches: matches.slice(0, options.maxHitsPerRecord),
    exactMatches,
    approximateMatches,
    skipped: false
  };
}

function createSearchContext(querySequence) {
  const query = normalizeDnaSequence(querySequence);
  const queryTwice = `${query}${query}`;
  return {
    query,
    queryLength: query.length,
    queryTwice,
    queryIsStrict: containsOnlyStrictBases(query),
    queryMasks: buildBaseMaskArray(queryTwice)
  };
}

function scanDatabaseChunk(querySequence, records, options) {
  const context = createSearchContext(querySequence);
  const matches = [];
  let scannedRecords = 0;
  let skippedRecords = 0;
  let exactMatches = 0;
  let approximateMatches = 0;

  for (const record of records) {
    scannedRecords += 1;
    const result = scanSingleRecord(context, record, options);
    if (result.skipped) {
      skippedRecords += 1;
      continue;
    }

    exactMatches += result.exactMatches;
    approximateMatches += result.approximateMatches;
    if (result.matches.length) {
      matches.push(...result.matches);
    }
  }

  return {
    matches,
    stats: {
      queryLength: context.queryLength,
      scannedRecords,
      skippedRecords,
      exactMatches,
      approximateMatches
    }
  };
}

function prepareDatabaseRecords(databaseRecords, options) {
  const records = Array.isArray(databaseRecords) ? databaseRecords : [];
  return records
    .map((record, index) => {
      const sequence = normalizeDnaSequence(
        record?.sequence
        || record?.seq
        || record?.dna
        || record?.bases
        || ''
      );

      return {
        recordIndex: index,
        recordId: cleanText(record?.id || record?.accession || `record_${index + 1}`, 120),
        recordName: cleanText(
          record?.name
          || record?.label
          || record?.feature
          || record?.accession
          || `record_${index + 1}`,
          240
        ),
        featureType: cleanText(record?.type || record?.featureType || '', 80),
        source: cleanText(record?.source || record?.db || '', 80),
        topology: normalizeTopology(record?.topology),
        sequence
      };
    })
    .filter((record) => record.sequence.length >= options.minRecordLength);
}

function getAvailableParallelism() {
  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, os.availableParallelism());
  }
  const cpus = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  return Math.max(1, cpus || 1);
}

function resolveRuntimeOptions(options = {}) {
  const merged = {
    ...DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS,
    ...(options && typeof options === 'object' ? options : {})
  };

  const availableParallelism = getAvailableParallelism();
  return {
    minRecordLength: clampInteger(merged.minRecordLength, 1, 1_000_000, 12),
    allowReverseComplement: merged.allowReverseComplement !== false,
    maxHitsPerRecord: clampInteger(merged.maxHitsPerRecord, 1, 10_000, 8),
    maxWorkers: clampInteger(
      merged.maxWorkers || availableParallelism,
      1,
      availableParallelism,
      availableParallelism
    ),
    workerThreshold: clampInteger(merged.workerThreshold, 1, 1_000_000, 256),
    recordsPerWorker: clampInteger(merged.recordsPerWorker, 1, 1_000_000, 256),
    maxMismatchCount: clampInteger(merged.maxMismatchCount, 0, 1_000_000, 0),
    maxMismatchRate: Number.isFinite(Number(merged.maxMismatchRate))
      ? Math.max(0, Number(merged.maxMismatchRate))
      : 0,
    minSeedLength: clampInteger(merged.minSeedLength, 1, 10_000, 12),
    approximateCandidateCap: clampInteger(merged.approximateCandidateCap, 8, 1_000_000, 4096),
    bruteForceCompatibilityLimit: clampInteger(
      merged.bruteForceCompatibilityLimit,
      1_000,
      1_000_000_000,
      2_000_000
    ),
    sortResults: merged.sortResults !== false
  };
}

function splitIntoChunks(records, chunkCount) {
  const items = Array.isArray(records) ? records : [];
  const desiredChunks = Math.max(1, Math.min(items.length || 1, chunkCount || 1));
  const chunkSize = Math.ceil(items.length / desiredChunks);
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function sortMatches(matches) {
  return [...matches].sort((left, right) => {
    if (left.recordIndex !== right.recordIndex) {
      return left.recordIndex - right.recordIndex;
    }
    if (left.mismatches !== right.mismatches) {
      return left.mismatches - right.mismatches;
    }
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return right.strand - left.strand;
  });
}

async function runWorkerChunk(querySequence, records, options) {
  if (!workerThreads?.Worker) {
    return scanDatabaseChunk(querySequence, records, options);
  }

  return new Promise((resolve, reject) => {
    const worker = new workerThreads.Worker(__filename, {
      workerData: {
        mode: WORKER_MODE,
        querySequence,
        records,
        options
      }
    });

    worker.once('message', (message) => {
      if (message?.ok) {
        resolve(message.result);
        return;
      }
      reject(new Error(message?.error || 'Circular plasmid annotation worker failed.'));
    });

    worker.once('error', reject);

    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Circular plasmid annotation worker exited with code ${code}.`));
      }
    });
  });
}

function buildEmptyAnnotationResult(queryLength, options, databaseSize = 0) {
  return {
    queryTopology: 'circular',
    queryLength,
    databaseSize,
    matches: [],
    stats: {
      workerCount: 1,
      scannedRecords: 0,
      skippedRecords: 0,
      exactMatches: 0,
      approximateMatches: 0,
      elapsedMs: 0,
      maxHitsPerRecord: options.maxHitsPerRecord
    }
  };
}

function finalizeAnnotationResult(matches, chunkResults, queryLength, databaseSize, workerCount, startedAt, options) {
  const scannedRecords = chunkResults.reduce(
    (sum, chunk) => sum + (chunk?.stats?.scannedRecords || 0),
    0
  );
  const skippedRecords = chunkResults.reduce(
    (sum, chunk) => sum + (chunk?.stats?.skippedRecords || 0),
    0
  );
  const exactMatches = chunkResults.reduce(
    (sum, chunk) => sum + (chunk?.stats?.exactMatches || 0),
    0
  );
  const approximateMatches = chunkResults.reduce(
    (sum, chunk) => sum + (chunk?.stats?.approximateMatches || 0),
    0
  );

  return {
    queryTopology: 'circular',
    queryLength,
    databaseSize,
    matches: options.sortResults ? sortMatches(matches) : matches,
    stats: {
      workerCount,
      scannedRecords,
      skippedRecords,
      exactMatches,
      approximateMatches,
      elapsedMs: Date.now() - startedAt,
      maxHitsPerRecord: options.maxHitsPerRecord
    }
  };
}

async function annotateCircularPlasmidSequence(querySequence, databaseRecords, options = {}) {
  const runtimeOptions = resolveRuntimeOptions(options);
  const query = normalizeDnaSequence(querySequence);
  if (!query.length) {
    return buildEmptyAnnotationResult(0, runtimeOptions, 0);
  }

  const preparedRecords = prepareDatabaseRecords(databaseRecords, runtimeOptions);
  if (!preparedRecords.length) {
    return buildEmptyAnnotationResult(query.length, runtimeOptions, 0);
  }

  const startedAt = Date.now();
  const canUseWorkers = Boolean(workerThreads?.Worker)
    && preparedRecords.length >= runtimeOptions.workerThreshold
    && runtimeOptions.maxWorkers > 1;

  if (!canUseWorkers) {
    const result = scanDatabaseChunk(query, preparedRecords, runtimeOptions);
    return finalizeAnnotationResult(
      result.matches,
      [result],
      query.length,
      preparedRecords.length,
      1,
      startedAt,
      runtimeOptions
    );
  }

  const desiredWorkers = Math.min(
    runtimeOptions.maxWorkers,
    Math.max(1, Math.ceil(preparedRecords.length / runtimeOptions.recordsPerWorker))
  );
  const chunks = splitIntoChunks(preparedRecords, desiredWorkers);
  const chunkResults = await Promise.all(
    chunks.map((chunk) => runWorkerChunk(query, chunk, runtimeOptions))
  );
  const matches = chunkResults.flatMap((chunk) => chunk.matches || []);

  return finalizeAnnotationResult(
    matches,
    chunkResults,
    query.length,
    preparedRecords.length,
    chunks.length,
    startedAt,
    runtimeOptions
  );
}

function annotateCircularPlasmidSequenceSync(querySequence, databaseRecords, options = {}) {
  const runtimeOptions = resolveRuntimeOptions({
    ...options,
    maxWorkers: 1
  });
  const query = normalizeDnaSequence(querySequence);
  if (!query.length) {
    return buildEmptyAnnotationResult(0, runtimeOptions, 0);
  }

  const preparedRecords = prepareDatabaseRecords(databaseRecords, runtimeOptions);
  if (!preparedRecords.length) {
    return buildEmptyAnnotationResult(query.length, runtimeOptions, 0);
  }

  const startedAt = Date.now();
  const result = scanDatabaseChunk(query, preparedRecords, runtimeOptions);
  return finalizeAnnotationResult(
    result.matches,
    [result],
    query.length,
    preparedRecords.length,
    1,
    startedAt,
    runtimeOptions
  );
}

module.exports = {
  DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS,
  annotateCircularPlasmidSequence,
  annotateCircularPlasmidSequenceSync,
  normalizeDnaSequence,
  reverseComplementDna
};

if (
  workerThreads
  && workerThreads.isMainThread === false
  && workerThreads.workerData?.mode === WORKER_MODE
) {
  try {
    const result = scanDatabaseChunk(
      workerThreads.workerData.querySequence,
      workerThreads.workerData.records,
      resolveRuntimeOptions(workerThreads.workerData.options)
    );
    workerThreads.parentPort.postMessage({ ok: true, result });
  } catch (error) {
    workerThreads.parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error || 'Unknown worker error.')
    });
  }
}
