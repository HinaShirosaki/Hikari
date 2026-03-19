import { PLANNOTATE_REFERENCE_FEATURES } from './plannotate-reference-db.js';

const MAX_PLASMID_SIZE = 50000;

const PROBLEM_HITS = new Set(['P03851', 'P03845', 'ISS', 'P03846']);

const COMPLEMENT = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
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
  N: 'N'
};

const DEFAULT_OPTIONS = {
  topology: 'circular',
  detailed: false,
  minIdentity: 85,
  minCoverage: 0.25,
  minHitLength: 24,
  maxHits: 60
};

function mod(value, by) {
  if (!by) {
    return 0;
  }
  return ((value % by) + by) % by;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toCanonicalDna(value) {
  return String(value || '').toUpperCase().replace(/[^ACGT]/g, 'N');
}

export function sanitizePlannotateInput(raw) {
  const noHeaders = String(raw || '').replace(/^>.*$/gm, '');
  return noHeaders
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYSWKMBDHVN]/g, '');
}

function reverseComplement(sequence) {
  return [...sequence]
    .reverse()
    .map((base) => COMPLEMENT[base] || 'N')
    .join('');
}

function resolveOptions(overrides = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...overrides };
  return {
    topology: merged.topology === 'linear' ? 'linear' : 'circular',
    detailed: Boolean(merged.detailed),
    minIdentity: clamp(Number(merged.minIdentity) || DEFAULT_OPTIONS.minIdentity, 50, 100),
    minCoverage: clamp(Number(merged.minCoverage) || DEFAULT_OPTIONS.minCoverage, 0.05, 1),
    minHitLength: clamp(Math.floor(Number(merged.minHitLength) || DEFAULT_OPTIONS.minHitLength), 12, 2000),
    maxHits: clamp(Math.floor(Number(merged.maxHits) || DEFAULT_OPTIONS.maxHits), 1, 500)
  };
}

function calculateScore(hit) {
  const percmatch = (hit.length / hit.slen) * 100;
  const absPercmatch = 100 - Math.abs(100 - percmatch);
  const piPermatch = (hit.pident * absPercmatch) / 100;
  const priority = Math.max(1, Number(hit.priority) || 1);

  let score = (piPermatch / 100) * hit.length;
  score *= (2 ** (-1 * priority)) * 2;

  if (piPermatch === 100) {
    score *= (1 / priority) * 10;
  }

  return {
    percmatch,
    absPercmatch,
    piPermatch,
    score
  };
}

function makeWiggleCoords(qstart, qend, length, qlen, topology) {
  const wiggle = Math.floor(length * 0.15);
  const endInclusive = mod(qend - 1, qlen);
  if (topology === 'linear') {
    const wstart = clamp(qstart + wiggle, qstart, Math.max(qstart, qend - 1));
    const wend = clamp(endInclusive - wiggle, qstart, Math.max(qstart, endInclusive));
    return { wiggle, wstart, wend };
  }
  const wstart = mod(qstart + wiggle, qlen);
  const wend = mod(endInclusive - wiggle, qlen);
  return { wiggle, wstart, wend };
}

function estimateEvalue(rawScore, isExact) {
  if (isExact) {
    return 0;
  }
  const bounded = Math.max(1, rawScore);
  return 1 / bounded;
}

function buildHit({
  feature,
  sframe,
  isExact,
  pident,
  rawStart,
  rawEnd,
  length,
  qlen,
  topology,
  searchSpace
}) {
  if (length <= 0) {
    return null;
  }

  const qstart = topology === 'circular' ? mod(rawStart, qlen) : clamp(rawStart, 0, qlen);
  const qendRaw = topology === 'circular' ? rawStart + length : clamp(rawEnd, 0, qlen);
  const qend = topology === 'circular' ? mod(qendRaw, qlen) : qendRaw;

  const qseqRaw = searchSpace.slice(qstart, qstart + length);
  const qseq = sframe === -1 ? reverseComplement(qseqRaw) : qseqRaw;

  const base = {
    sseqid: feature.sseqid,
    Feature: feature.feature,
    Description: feature.description,
    Type: feature.type || 'misc_feature',
    db: feature.db || 'snapgene',
    priority: Math.max(1, Number(feature.priority) || 1),
    qstart,
    qend,
    qlen,
    sframe,
    sstart: 1,
    send: length,
    qseq,
    length,
    slen: feature.sequence.length,
    pident,
    matchMode: isExact ? 'exact' : 'partial',
    kind: feature.type || 'misc_feature'
  };

  const metrics = calculateScore(base);
  Object.assign(base, metrics);
  base.evalue = estimateEvalue(base.score, isExact);

  const wiggle = makeWiggleCoords(base.qstart, base.qend, base.length, base.qlen, topology);
  Object.assign(base, wiggle);

  if (topology === 'circular') {
    const rawEndNorm = mod(qendRaw, qlen);
    base.crossesOrigin = rawEndNorm <= qstart;
  } else {
    base.crossesOrigin = false;
  }

  return base;
}

function findAllExactMatches(searchSpace, motif, sequenceLength, topology) {
  const starts = [];
  if (!motif || motif.length > searchSpace.length) {
    return starts;
  }

  let cursor = 0;
  while (cursor >= 0) {
    const found = searchSpace.indexOf(motif, cursor);
    if (found === -1) {
      break;
    }

    const inWindow = topology === 'circular'
      ? found < sequenceLength
      : found + motif.length <= sequenceLength;

    if (inWindow) {
      starts.push(found);
    }

    cursor = found + 1;
  }

  return starts;
}

function scoreLinearOffset(query, featureSeq, offset) {
  const featureOffset = Math.max(0, -offset);
  const queryStart = Math.max(0, offset);
  const maxLen = Math.min(featureSeq.length - featureOffset, query.length - queryStart);

  if (maxLen <= 0) {
    return null;
  }

  const querySlice = query.slice(queryStart, queryStart + maxLen);
  const featureSlice = featureSeq.slice(featureOffset, featureOffset + maxLen);

  let matches = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if (querySlice[i] === featureSlice[i]) {
      matches += 1;
    }
  }

  return {
    rawStart: queryStart,
    rawEnd: queryStart + maxLen,
    length: maxLen,
    pident: (matches / maxLen) * 100
  };
}

function scoreCircularOffset(searchSpace, featureSeq, offset, qlen) {
  const queryStart = mod(offset, qlen);
  const maxLen = Math.min(featureSeq.length, qlen);
  if (maxLen <= 0) {
    return null;
  }

  const querySlice = searchSpace.slice(queryStart, queryStart + maxLen);
  const featureSlice = featureSeq.slice(0, maxLen);

  let matches = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if (querySlice[i] === featureSlice[i]) {
      matches += 1;
    }
  }

  return {
    rawStart: queryStart,
    rawEnd: queryStart + maxLen,
    length: maxLen,
    pident: (matches / maxLen) * 100
  };
}

function findBestPartialMatch({
  query,
  searchSpace,
  featureSeq,
  topology,
  minIdentity,
  minCoverage,
  minHitLength
}) {
  const seedLength = clamp(Math.floor(featureSeq.length * 0.14), 10, 22);
  if (featureSeq.length < seedLength || query.length < seedLength) {
    return null;
  }

  const seedStep = clamp(Math.floor(featureSeq.length / 30), 1, 16);
  const offsets = new Set();

  for (let featureSeedStart = 0; featureSeedStart + seedLength <= featureSeq.length; featureSeedStart += seedStep) {
    const seed = featureSeq.slice(featureSeedStart, featureSeedStart + seedLength);
    if (seed.includes('N')) {
      continue;
    }

    let cursor = 0;
    while (cursor >= 0) {
      const querySeedStart = searchSpace.indexOf(seed, cursor);
      if (querySeedStart === -1) {
        break;
      }

      if (topology === 'linear' && querySeedStart >= query.length) {
        break;
      }
      if (topology === 'circular' && querySeedStart >= query.length) {
        break;
      }

      offsets.add(querySeedStart - featureSeedStart);
      if (offsets.size > 3000) {
        break;
      }

      cursor = querySeedStart + 1;
    }

    if (offsets.size > 3000) {
      break;
    }
  }

  let best = null;
  for (const offset of offsets) {
    const scored = topology === 'circular'
      ? scoreCircularOffset(searchSpace, featureSeq, offset, query.length)
      : scoreLinearOffset(query, featureSeq, offset);

    if (!scored) {
      continue;
    }

    const coverage = scored.length / featureSeq.length;
    if (scored.length < minHitLength || coverage < minCoverage || scored.pident < minIdentity) {
      continue;
    }

    const raw = scored.length * scored.pident * coverage;
    if (!best || raw > best.raw) {
      best = { ...scored, raw };
    }
  }

  return best;
}

function getIntervals(hit, topology) {
  if (topology === 'linear') {
    const start = Math.min(hit.wstart, hit.wend);
    const end = Math.max(hit.wstart, hit.wend);
    return [[start, end]];
  }

  if (hit.wend >= hit.wstart) {
    return [[hit.wstart, hit.wend]];
  }

  return [
    [0, hit.wend],
    [hit.wstart, hit.qlen - 1]
  ];
}

function intervalsOverlap(left, right) {
  return left[0] <= right[1] && right[0] <= left[1];
}

function isFragment(hit) {
  if (hit.Type === 'CDS') {
    if (hit.piPermatch === 100) {
      return false;
    }
    if ((hit.length % 3) === 0 && hit.percmatch > 95) {
      return false;
    }
    return true;
  }

  return hit.percmatch < 95;
}

function dedupeHits(hits) {
  const map = new Map();
  hits.forEach((hit) => {
    const key = [
      hit.sseqid,
      hit.qstart,
      hit.qend,
      hit.sframe,
      Math.round(hit.pident * 1000) / 1000,
      hit.matchMode
    ].join('|');

    const existing = map.get(key);
    if (!existing || hit.score > existing.score) {
      map.set(key, hit);
    }
  });
  return [...map.values()];
}

function cleanHits(hits, options) {
  const sorted = hits
    .filter((hit) => !PROBLEM_HITS.has(hit.sseqid))
    .filter((hit) => hit.evalue < 1)
    .filter((hit) => hit.piPermatch > 3)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.length !== a.length) {
        return b.length - a.length;
      }
      return b.percmatch - a.percmatch;
    });

  const kept = [];
  sorted.forEach((candidate) => {
    const candidateIntervals = getIntervals(candidate, options.topology);
    const kind = options.detailed ? candidate.kind : 'all';

    const overlaps = kept.some((existing) => {
      const existingKind = options.detailed ? existing.kind : 'all';
      if (kind !== existingKind) {
        return false;
      }
      const existingIntervals = getIntervals(existing, options.topology);
      return candidateIntervals.some((left) => existingIntervals.some((right) => intervalsOverlap(left, right)));
    });

    if (!overlaps) {
      kept.push(candidate);
    }
  });

  return kept.map((hit) => ({
    ...hit,
    fragment: isFragment(hit)
  }));
}

export function annotatePlasmidSequence(rawSequence, overrides = {}) {
  const options = resolveOptions(overrides);
  const warnings = [];

  let cleaned = sanitizePlannotateInput(rawSequence);
  if (cleaned.length > MAX_PLASMID_SIZE) {
    cleaned = cleaned.slice(0, MAX_PLASMID_SIZE);
    warnings.push(`Input was truncated to ${MAX_PLASMID_SIZE.toLocaleString()} bases to match pLannotate size guidance.`);
  }

  const canonical = toCanonicalDna(cleaned);
  const qlen = canonical.length;

  if (!qlen) {
    return {
      sequence: '',
      sequenceLength: 0,
      topology: options.topology,
      options,
      warnings,
      stats: {
        referenceFeatures: PLANNOTATE_REFERENCE_FEATURES.length,
        rawHits: 0,
        finalHits: 0,
        exactHits: 0,
        partialHits: 0
      },
      hits: []
    };
  }

  const searchSpace = options.topology === 'circular' ? `${canonical}${canonical}` : canonical;
  const rawHits = [];

  PLANNOTATE_REFERENCE_FEATURES.forEach((feature) => {
    const featureSequence = toCanonicalDna(feature.sequence);
    if (!featureSequence.length) {
      return;
    }

    const orientations = [{ sframe: 1, sequence: featureSequence }];
    const reverse = reverseComplement(featureSequence);
    if (reverse !== featureSequence) {
      orientations.push({ sframe: -1, sequence: reverse });
    }

    orientations.forEach((orientation) => {
      const exactStarts = findAllExactMatches(searchSpace, orientation.sequence, qlen, options.topology);
      exactStarts.forEach((start) => {
        const hit = buildHit({
          feature,
          sframe: orientation.sframe,
          isExact: true,
          pident: 100,
          rawStart: start,
          rawEnd: start + orientation.sequence.length,
          length: orientation.sequence.length,
          qlen,
          topology: options.topology,
          searchSpace
        });
        if (hit) {
          rawHits.push(hit);
        }
      });

      if (options.detailed && exactStarts.length === 0) {
        const partial = findBestPartialMatch({
          query: canonical,
          searchSpace,
          featureSeq: orientation.sequence,
          topology: options.topology,
          minIdentity: options.minIdentity,
          minCoverage: options.minCoverage,
          minHitLength: options.minHitLength
        });

        if (partial) {
          const hit = buildHit({
            feature,
            sframe: orientation.sframe,
            isExact: false,
            pident: partial.pident,
            rawStart: partial.rawStart,
            rawEnd: partial.rawEnd,
            length: partial.length,
            qlen,
            topology: options.topology,
            searchSpace
          });
          if (hit) {
            rawHits.push(hit);
          }
        }
      }
    });
  });

  const deduped = dedupeHits(rawHits);
  const cleanedHits = cleanHits(deduped, options);
  const limited = cleanedHits.slice(0, options.maxHits);

  if (options.detailed && !limited.some((hit) => hit.matchMode === 'partial')) {
    warnings.push('Detailed mode enabled, but no partial matches passed thresholds.');
  }

  return {
    sequence: canonical,
    sequenceLength: qlen,
    topology: options.topology,
    options,
    warnings,
    stats: {
      referenceFeatures: PLANNOTATE_REFERENCE_FEATURES.length,
      rawHits: rawHits.length,
      finalHits: limited.length,
      exactHits: limited.filter((hit) => hit.matchMode === 'exact').length,
      partialHits: limited.filter((hit) => hit.matchMode === 'partial').length
    },
    hits: limited
  };
}
