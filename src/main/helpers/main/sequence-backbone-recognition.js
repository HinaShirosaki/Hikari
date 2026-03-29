'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const COMMERCIAL_RESTRICTION_ENZYMES_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'commercial-restriction-enzymes.js'
);

const DEFAULT_MIN_ORF_LENGTH = 15;
const DEFAULT_PROMOTER_TO_ORF_MAX_GAP = 260;
const DEFAULT_ORF_BOUNDARY_SLACK = 96;
const DEFAULT_RESTRICTION_FLANK_MAX_GAP = 32;

const COMMON_CLONING_RESTRICTION_ENZYMES = Object.freeze([
  { name: 'EcoRI', site: 'GAATTC', cutPatterns: ['G^AATTC'] },
  { name: 'BamHI', site: 'GGATCC', cutPatterns: ['G^GATCC'] },
  { name: 'HindIII', site: 'AAGCTT', cutPatterns: ['A^AGCTT'] },
  { name: 'XhoI', site: 'CTCGAG', cutPatterns: ['C^TCGAG'] },
  { name: 'NdeI', site: 'CATATG', cutPatterns: ['CA^TATG'] },
  { name: 'NcoI', site: 'CCATGG', cutPatterns: ['C^CATGG'] },
  { name: 'NotI', site: 'GCGGCCGC', cutPatterns: ['GC^GGCCGC'] },
  { name: 'KpnI', site: 'GGTACC', cutPatterns: ['GGTAC^C'] },
  { name: 'SacI', site: 'GAGCTC', cutPatterns: ['GAGCT^C'] },
  { name: 'SalI', site: 'GTCGAC', cutPatterns: ['G^TCGAC'] },
  { name: 'XbaI', site: 'TCTAGA', cutPatterns: ['T^CTAGA'] },
  { name: 'SpeI', site: 'ACTAGT', cutPatterns: ['A^CTAGT'] },
  { name: 'NheI', site: 'GCTAGC', cutPatterns: ['G^CTAGC'] },
  { name: 'BglII', site: 'AGATCT', cutPatterns: ['A^GATCT'] },
  { name: 'PstI', site: 'CTGCAG', cutPatterns: ['CTGCA^G'] },
  { name: 'AgeI', site: 'ACCGGT', cutPatterns: ['A^CCGGT'] }
]);

const CLONING_ENZYME_PRIORITY = Object.freeze([
  'NdeI',
  'NcoI',
  'BamHI',
  'EcoRI',
  'XhoI',
  'NotI',
  'HindIII',
  'KpnI',
  'SacI',
  'NheI',
  'XbaI',
  'SpeI',
  'BglII',
  'SalI',
  'PstI',
  'AgeI'
]);

let commercialRestrictionEnzymesPromise = null;

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
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

async function loadCommercialRestrictionEnzymes() {
  if (!commercialRestrictionEnzymesPromise) {
    commercialRestrictionEnzymesPromise = import(pathToFileURL(COMMERCIAL_RESTRICTION_ENZYMES_PATH).href)
      .then((module) => {
        const list = Array.isArray(module?.COMMERCIAL_RESTRICTION_ENZYMES)
          ? module.COMMERCIAL_RESTRICTION_ENZYMES
          : [];
        return list.length ? list : COMMON_CLONING_RESTRICTION_ENZYMES;
      })
      .catch(() => COMMON_CLONING_RESTRICTION_ENZYMES);
  }
  return commercialRestrictionEnzymesPromise;
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

function circularSlice(normalizeSequenceText, sequence, start, length) {
  const text = normalizeSequenceText(sequence);
  const textLength = text.length;
  const desiredLength = Math.max(0, Math.round(Number(length) || 0));
  if (!textLength || !desiredLength) {
    return '';
  }

  let cursor = positiveModulo(Math.round(Number(start) || 0), textLength);
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

function determineBackboneSeedLength(hostLength, queryLength) {
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
    insertLength: Math.max(0, insertWindowEnd - insertWindowStart),
    rotatedHost,
    rotatedQuery
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

  const normalizedWindowStart = positiveModulo(Math.round(Number(queryStart) || 0), safeLength);
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

function invertSegments(clamp, segments, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  if (!safeLength) {
    return [];
  }

  const merged = mergeSegments(clamp, segments, safeLength);
  if (!merged.length) {
    return [{ start: 0, end: safeLength }];
  }

  const inverted = [];
  let cursor = 0;
  merged.forEach((segment) => {
    if (segment.start > cursor) {
      inverted.push({ start: cursor, end: segment.start });
    }
    cursor = Math.max(cursor, segment.end);
  });
  if (cursor < safeLength) {
    inverted.push({ start: cursor, end: safeLength });
  }
  return inverted;
}

function buildSequenceFromSegments(sequence, segments) {
  const text = String(sequence || '');
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => text.slice(segment.start, segment.end))
    .join('');
}

function mapAbsoluteSegmentsToRotatedIntervals(segments, rotationStart, totalLength) {
  const safeLength = Math.max(0, Number(totalLength) || 0);
  if (!safeLength) {
    return [];
  }

  const intervals = [];
  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    const start = clampNumber(Math.round(Number(segment?.start) || 0), 0, safeLength);
    const end = clampNumber(Math.round(Number(segment?.end) || 0), 0, safeLength);
    if (end <= start) {
      return;
    }

    const shiftedStart = positiveModulo(start - rotationStart, safeLength);
    const shiftedEnd = shiftedStart + (end - start);
    if (shiftedEnd <= safeLength) {
      intervals.push({ start: shiftedStart, end: shiftedEnd });
      return;
    }

    intervals.push({ start: shiftedStart, end: safeLength });
    intervals.push({ start: 0, end: shiftedEnd - safeLength });
  });

  return mergeSegments(clampNumber, intervals, safeLength);
}

function splitTopLevelArguments(raw) {
  const input = String(raw || '');
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(input.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeFeatureRange(startRaw, endRaw, sequenceLength, strand) {
  const len = Math.max(0, Number(sequenceLength) || 0);
  if (!len) {
    return [];
  }

  const start = clampNumber(Math.round(Number(startRaw) || 0), 1, len);
  const end = clampNumber(Math.round(Number(endRaw) || 0), 1, len);

  if (start <= end) {
    return [{
      start: start - 1,
      end,
      strand
    }];
  }

  return [
    {
      start: start - 1,
      end: len,
      strand
    },
    {
      start: 0,
      end,
      strand
    }
  ];
}

function parseSimpleLocationAtom(atom, sequenceLength, strand = 1) {
  const raw = String(atom || '').trim();
  if (!raw) {
    return [];
  }

  const body = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  const numbers = body.match(/\d+/g)?.map((part) => Number(part)) || [];
  if (!numbers.length) {
    return [];
  }

  if (body.includes('..') || body.includes('^')) {
    return normalizeFeatureRange(numbers[0], numbers[numbers.length - 1], sequenceLength, strand);
  }

  return normalizeFeatureRange(numbers[0], numbers[0], sequenceLength, strand);
}

function parseGenBankLocationSegments(rawExpression, sequenceLength, strand = 1) {
  const expression = String(rawExpression || '').replace(/\s+/g, '');
  if (!expression) {
    return [];
  }

  const lower = expression.toLowerCase();
  if (lower.startsWith('complement(') && expression.endsWith(')')) {
    return parseGenBankLocationSegments(expression.slice('complement('.length, -1), sequenceLength, strand * -1);
  }

  if ((lower.startsWith('join(') || lower.startsWith('order(')) && expression.endsWith(')')) {
    const fnLength = lower.startsWith('join(') ? 'join('.length : 'order('.length;
    return splitTopLevelArguments(expression.slice(fnLength, -1))
      .flatMap((part) => parseGenBankLocationSegments(part, sequenceLength, strand));
  }

  return parseSimpleLocationAtom(expression, sequenceLength, strand);
}

function parseFeatureQualifier(line) {
  const token = String(line || '').trim().replace(/^\//, '');
  if (!token) {
    return null;
  }

  const equalIndex = token.indexOf('=');
  if (equalIndex === -1) {
    return { key: token.toLowerCase(), value: 'true', openQuote: false };
  }

  const key = token.slice(0, equalIndex).trim().toLowerCase();
  let value = token.slice(equalIndex + 1).trim();

  const quoted = value.startsWith('"');
  if (quoted) {
    value = value.slice(1);
  }

  let openQuote = false;
  if (value.endsWith('"')) {
    value = value.slice(0, -1);
  } else if (quoted) {
    openQuote = true;
  }

  return {
    key,
    value,
    openQuote
  };
}

function normalizeFeatureName(value, fallback = 'feature') {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return text || fallback;
}

function parseGenBankFeatureEntries(featureBlock, sequenceLength) {
  const lines = String(featureBlock || '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let current = null;

  const flush = () => {
    if (!current) {
      return;
    }
    entries.push(current);
    current = null;
  };

  lines.forEach((line) => {
    const featureMatch = line.match(/^\s{5}(\S+)\s+(.+)$/);
    if (featureMatch) {
      flush();
      current = {
        type: featureMatch[1],
        location: String(featureMatch[2] || '').trim(),
        qualifiers: {},
        pendingQualifierKey: ''
      };
      return;
    }

    if (!current) {
      return;
    }

    const qualifierMatch = line.match(/^\s{21}\/(.+)$/);
    if (qualifierMatch) {
      const parsed = parseFeatureQualifier(qualifierMatch[1]);
      if (!parsed) {
        return;
      }
      current.qualifiers[parsed.key] = parsed.value;
      current.pendingQualifierKey = parsed.openQuote ? parsed.key : '';
      return;
    }

    const continuationMatch = line.match(/^\s{21}(.+)$/);
    if (!continuationMatch) {
      return;
    }

    const continuation = String(continuationMatch[1] || '').trim();
    if (!continuation) {
      return;
    }

    if (current.pendingQualifierKey) {
      let text = continuation;
      let closed = false;
      if (text.endsWith('"')) {
        text = text.slice(0, -1);
        closed = true;
      }
      current.qualifiers[current.pendingQualifierKey] = [
        current.qualifiers[current.pendingQualifierKey],
        text
      ].filter(Boolean).join(' ');
      if (closed) {
        current.pendingQualifierKey = '';
      }
      return;
    }

    current.location += continuation;
  });

  flush();

  return entries
    .map((entry, index) => {
      const segmentsWithStrand = parseGenBankLocationSegments(entry.location, sequenceLength);
      if (!segmentsWithStrand.length) {
        return null;
      }

      const strand = segmentsWithStrand[0].strand === -1 ? -1 : 1;
      return {
        id: `gbk_feature_${index + 1}`,
        name: normalizeFeatureName(
          entry.qualifiers.label
            || entry.qualifiers.gene
            || entry.qualifiers.locus_tag
            || entry.qualifiers.product
            || entry.type
            || `feature_${index + 1}`,
          `feature_${index + 1}`
        ),
        type: String(entry.type || 'misc_feature').toLowerCase(),
        strand,
        description: normalizeFeatureName(
          entry.qualifiers.note
            || entry.qualifiers.product
            || entry.qualifiers.function
            || '',
          ''
        ),
        segments: segmentsWithStrand.map((segment) => ({
          start: segment.start,
          end: segment.end
        }))
      };
    })
    .filter(Boolean);
}

function extractRecordFromGbkText(normalizeSequenceText, gbkText) {
  const raw = String(gbkText || '');
  const sequence = extractSequenceFromGbkText(normalizeSequenceText, raw);
  if (!sequence.length) {
    return {
      name: '',
      topology: 'linear',
      sequence: '',
      features: []
    };
  }

  const locusMatch = raw.match(/^\s*LOCUS\s+(\S+)(.*)$/im);
  const locusTail = String(locusMatch?.[2] || '');
  const featuresMatch = raw.match(/^\s*FEATURES\b([\s\S]*?)(?=^\s*ORIGIN\b)/im);

  return {
    name: normalizeFeatureName(locusMatch?.[1] || ''),
    topology: /\bcircular\b/i.test(locusTail) ? 'circular' : 'linear',
    sequence,
    features: parseGenBankFeatureEntries(featuresMatch?.[1] || '', sequence.length)
  };
}

function reverseComplementFeatures(features, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(features) ? features : []).map((feature, index) => ({
    ...feature,
    id: feature?.id || `rev_feature_${index + 1}`,
    strand: feature?.strand === -1 ? 1 : -1,
    segments: (Array.isArray(feature?.segments) ? feature.segments : [])
      .map((segment) => {
        const start = clampNumber(Math.round(Number(segment?.start) || 0), 0, safeLength);
        const end = clampNumber(Math.round(Number(segment?.end) || 0), 0, safeLength);
        if (end <= start) {
          return null;
        }
        return {
          start: safeLength - end,
          end: safeLength - start
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start)
  }));
}

function buildRecognitionThresholds(hostLength, queryLength) {
  const minLength = Math.max(
    0,
    Math.min(Math.max(0, Number(hostLength) || 0), Math.max(0, Number(queryLength) || 0))
  );
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

function getVariantPriority(candidate) {
  const source = String(candidate?.variants?.gibson?.source || '').toLowerCase();
  if (source === 'promoter_orf') {
    return 2;
  }
  if (source === 'orf_overlap') {
    return 1;
  }
  return 0;
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
  const leftVariantPriority = getVariantPriority(left);
  const rightVariantPriority = getVariantPriority(right);
  if (leftVariantPriority !== rightVariantPriority) {
    return rightVariantPriority - leftVariantPriority;
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

function scoreExpressionPromoter(feature) {
  const haystack = `${String(feature?.name || '')} ${String(feature?.description || '')}`.toLowerCase();
  let score = 0;
  if (String(feature?.type || '').toLowerCase() === 'promoter') {
    score += 20;
  }

  if (/(^|[^a-z])(t7|cmv|ef1a|cag|pgk|ubc|pbad|ara|arabad|aox1|gal1|tac|trc|lac|tet|ptet|rha|rhamnose|polh|polyhedrin|cspa)([^a-z]|$)/i.test(haystack)) {
    score += 120;
  }
  if (/(expression|inducible|recombinant|phage)/i.test(haystack)) {
    score += 24;
  }
  if (/(amp|bla|kan|neo|cat|chloramphenicol|laci|laci promoter|rep|ori|origin|selection)/i.test(haystack)) {
    score -= 90;
  }

  return score;
}

function intervalOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function detectLinearOrfHits(sequence, minNtLength = DEFAULT_MIN_ORF_LENGTH) {
  const text = String(sequence || '').replace(/[^ACGT]/g, 'N');
  const length = text.length;
  if (length < 6) {
    return [];
  }

  const hits = [];
  for (let frame = 0; frame < 3; frame += 1) {
    for (let start = frame; start <= length - 3; start += 3) {
      if (text.slice(start, start + 3) !== 'ATG') {
        continue;
      }

      for (let position = start + 3; position <= length - 3; position += 3) {
        const stopCodon = text.slice(position, position + 3);
        if (!['TAA', 'TAG', 'TGA'].includes(stopCodon)) {
          continue;
        }

        const orfLength = (position + 3) - start;
        if (orfLength >= minNtLength) {
          hits.push({
            start,
            end: position + 3,
            frame,
            stopCodon,
            length: orfLength
          });
        }
        break;
      }
    }
  }

  return hits;
}

function selectPromoterCandidate(hostFeatures, hostStart, hostLength, insertWindowStart) {
  const promoters = (Array.isArray(hostFeatures) ? hostFeatures : [])
    .filter((feature) => String(feature?.type || '').toLowerCase() === 'promoter')
    .map((feature) => {
      const intervals = mapAbsoluteSegmentsToRotatedIntervals(feature.segments, hostStart, hostLength);
      if (!intervals.length) {
        return null;
      }

      const upstreamIntervals = intervals.filter((interval) => interval.end <= insertWindowStart);
      if (!upstreamIntervals.length) {
        return null;
      }

      const rotatedStart = Math.min(...upstreamIntervals.map((interval) => interval.start));
      const rotatedEnd = Math.max(...upstreamIntervals.map((interval) => interval.end));
      const gapToInsert = insertWindowStart - rotatedEnd;
      if (gapToInsert < 0 || gapToInsert > DEFAULT_PROMOTER_TO_ORF_MAX_GAP) {
        return null;
      }

      return {
        feature,
        intervals: upstreamIntervals,
        rotatedStart,
        rotatedEnd,
        gapToInsert,
        score: scoreExpressionPromoter(feature) + Math.max(0, DEFAULT_PROMOTER_TO_ORF_MAX_GAP - gapToInsert)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.gapToInsert !== right.gapToInsert) {
        return left.gapToInsert - right.gapToInsert;
      }
      return String(left.feature?.name || '').localeCompare(String(right.feature?.name || ''));
    });

  return promoters[0] || null;
}

function selectOrfCandidate(orfs, roughStart, roughEnd, promoter) {
  const roughLength = Math.max(0, roughEnd - roughStart);
  const best = (Array.isArray(orfs) ? orfs : [])
    .map((orf) => {
      const overlap = intervalOverlap(orf.start, orf.end, roughStart, roughEnd);
      const startDelta = Math.abs(orf.start - roughStart);
      const endDelta = Math.abs(orf.end - roughEnd);
      const leftSlack = roughStart - orf.start;
      const rightSlack = orf.end - roughEnd;

      if (!overlap) {
        return null;
      }
      if (startDelta > DEFAULT_ORF_BOUNDARY_SLACK || endDelta > DEFAULT_ORF_BOUNDARY_SLACK) {
        return null;
      }

      let score = (overlap * 8) - (startDelta * 2) - (endDelta * 2);
      if (leftSlack >= 0) {
        score += Math.min(leftSlack, 24);
      }
      if (rightSlack >= 0) {
        score += Math.min(rightSlack, 24);
      }
      if (roughLength && overlap >= Math.max(9, Math.floor(roughLength * 0.7))) {
        score += 48;
      }

      if (promoter) {
        const promoterGap = orf.start - promoter.rotatedEnd;
        if (promoterGap < 0 || promoterGap > DEFAULT_PROMOTER_TO_ORF_MAX_GAP) {
          return null;
        }
        score += promoter.score + Math.max(0, DEFAULT_PROMOTER_TO_ORF_MAX_GAP - promoterGap);
      }

      return {
        ...orf,
        overlap,
        score
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.overlap !== right.overlap) {
        return right.overlap - left.overlap;
      }
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return right.length - left.length;
    });

  return best[0] || null;
}

function buildGibsonVariant(clamp, querySequence, queryStart, insertStart, insertEnd, queryLength, source, extra = {}) {
  const insertSegments = mapRotatedWindowRangeToSegments(clamp, queryStart, insertStart, insertEnd, queryLength);
  const backboneSegments = invertSegments(clamp, insertSegments, queryLength);
  return {
    source,
    insertLength: Math.max(0, insertEnd - insertStart),
    insertSegments,
    insertSequence: buildSequenceFromSegments(querySequence, insertSegments),
    backboneLength: Math.max(0, queryLength - (insertEnd - insertStart)),
    backboneSegments,
    backboneSequence: buildSequenceFromSegments(querySequence, backboneSegments),
    backboneSource: 'query_minus_insert',
    ...extra
  };
}

function buildRestrictionVariant({
  clamp,
  querySequence,
  queryStart,
  queryLength,
  insertStart,
  insertEnd,
  hostBackboneSequence,
  hostBackboneSegments,
  hostLength,
  source,
  extra = {}
}) {
  const insertSegments = mapRotatedWindowRangeToSegments(clamp, queryStart, insertStart, insertEnd, queryLength);
  return {
    source,
    insertLength: Math.max(0, insertEnd - insertStart),
    insertSegments,
    insertSequence: buildSequenceFromSegments(querySequence, insertSegments),
    backboneLength: Math.max(0, hostLength),
    backboneSegments: Array.isArray(hostBackboneSegments) ? hostBackboneSegments : [],
    backboneSequence: String(hostBackboneSequence || ''),
    backboneSource: 'matched_host_vector',
    ...extra
  };
}

function motifToRegexBody(motif) {
  const normalized = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  if (!normalized) {
    return '';
  }

  const classes = [...normalized].map((base) => ({
    A: 'A',
    C: 'C',
    G: 'G',
    T: 'T',
    R: '[AG]',
    Y: '[CT]',
    S: '[GC]',
    W: '[AT]',
    K: '[GT]',
    M: '[AC]',
    B: '[CGT]',
    D: '[AGT]',
    H: '[ACT]',
    V: '[ACG]',
    N: '[ACGT]'
  }[base] || ''));

  if (classes.some((entry) => !entry)) {
    return '';
  }
  return classes.join('');
}

function findMotifHits(normalizeSequenceText, sequence, motif, topology = 'linear') {
  const text = normalizeSequenceText(sequence);
  const normalizedMotif = String(motif || '').toUpperCase().replace(/U/g, 'T').trim();
  const patternBody = motifToRegexBody(normalizedMotif);
  if (!text.length || !normalizedMotif.length || !patternBody.length) {
    return [];
  }

  const sequenceLength = text.length;
  const motifLength = normalizedMotif.length;
  const circular = String(topology || '').toLowerCase() === 'circular';
  const scanText = circular && motifLength > 1
    ? `${text}${text.slice(0, motifLength - 1)}`
    : text;
  const regex = new RegExp(`(?=(${patternBody}))`, 'g');
  const hits = [];

  let match = regex.exec(scanText);
  while (match) {
    const start = match.index;
    if (start < sequenceLength) {
      const end = start + motifLength;
      hits.push({
        start,
        length: motifLength,
        end,
        segments: end <= sequenceLength
          ? [{ start, end }]
          : [
            { start, end: sequenceLength },
            { start: 0, end: end - sequenceLength }
          ]
      });
    }
    regex.lastIndex = start + 1;
    match = regex.exec(scanText);
  }

  return hits;
}

function collectUniqueRestrictionSiteHits(normalizeSequenceText, reverseComplementIupac, querySequence, topology, restrictionEnzymes) {
  const hits = [];
  (Array.isArray(restrictionEnzymes) ? restrictionEnzymes : []).forEach((enzyme) => {
    const motif = String(enzyme?.site || '').toUpperCase().replace(/U/g, 'T').trim();
    if (!motif) {
      return;
    }

    const hitsBySegmentKey = new Map();
    const collect = (scanMotif) => {
      findMotifHits(normalizeSequenceText, querySequence, scanMotif, topology).forEach((hit) => {
        const key = hit.segments.map((segment) => `${segment.start}-${segment.end}`).join(',');
        if (!hitsBySegmentKey.has(key)) {
          hitsBySegmentKey.set(key, hit);
        }
      });
    };

    collect(motif);
    const reverseMotif = reverseComplementIupac(motif);
    if (reverseMotif && reverseMotif !== motif) {
      collect(reverseMotif);
    }

    if (hitsBySegmentKey.size !== 1) {
      return;
    }

    const hit = [...hitsBySegmentKey.values()][0];
    hits.push({
      name: String(enzyme?.name || motif),
      site: motif,
      cutPatterns: Array.isArray(enzyme?.cutPatterns) ? enzyme.cutPatterns : [],
      start: hit.start,
      end: hit.end,
      length: hit.length,
      segments: hit.segments
    });
  });

  return hits;
}

function scoreRestrictionSiteCandidate(site, gap) {
  const priorityIndex = CLONING_ENZYME_PRIORITY.indexOf(String(site?.name || ''));
  return (priorityIndex === -1 ? 0 : 100 - priorityIndex) - (gap * 10) + Math.min(12, Number(site?.length) || 0);
}

function selectFlankingRestrictionSites(clamp, uniqueRestrictionHits, queryStart, queryLength, orfStart, orfEnd) {
  const upstreamCandidates = [];
  const downstreamCandidates = [];

  (Array.isArray(uniqueRestrictionHits) ? uniqueRestrictionHits : []).forEach((site) => {
    const rotatedIntervals = mapAbsoluteSegmentsToRotatedIntervals(site.segments, queryStart, queryLength);
    if (rotatedIntervals.length !== 1) {
      return;
    }

    const interval = rotatedIntervals[0];
    const overlapsOrfStart = interval.start <= orfStart && interval.end >= orfStart;
    if (interval.end <= orfStart || overlapsOrfStart) {
      const gap = interval.end <= orfStart ? (orfStart - interval.end) : 0;
      if (gap <= DEFAULT_RESTRICTION_FLANK_MAX_GAP) {
        upstreamCandidates.push({
          ...site,
          rotatedStart: interval.start,
          rotatedEnd: interval.end,
          gap,
          overlapsBoundary: overlapsOrfStart,
          score: scoreRestrictionSiteCandidate(site, gap)
        });
      }
    }

    const overlapsOrfEnd = interval.start <= orfEnd && interval.end >= orfEnd;
    if (interval.start >= orfEnd || overlapsOrfEnd) {
      const gap = interval.start >= orfEnd ? (interval.start - orfEnd) : 0;
      if (gap <= DEFAULT_RESTRICTION_FLANK_MAX_GAP) {
        downstreamCandidates.push({
          ...site,
          rotatedStart: interval.start,
          rotatedEnd: interval.end,
          gap,
          overlapsBoundary: overlapsOrfEnd,
          score: scoreRestrictionSiteCandidate(site, gap)
        });
      }
    }
  });

  upstreamCandidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (Boolean(left.overlapsBoundary) !== Boolean(right.overlapsBoundary)) {
      return left.overlapsBoundary ? -1 : 1;
    }
    if (left.gap !== right.gap) {
      return left.gap - right.gap;
    }
    return String(left.name || '').localeCompare(String(right.name || ''));
  });

  downstreamCandidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (Boolean(left.overlapsBoundary) !== Boolean(right.overlapsBoundary)) {
      return left.overlapsBoundary ? -1 : 1;
    }
    if (left.gap !== right.gap) {
      return left.gap - right.gap;
    }
    return String(left.name || '').localeCompare(String(right.name || ''));
  });

  return {
    upstream: upstreamCandidates[0] || null,
    downstream: downstreamCandidates[0] || null
  };
}

function mapSiteToMetadata(site) {
  if (!site) {
    return null;
  }
  return {
    name: site.name,
    site: site.site,
    cutPatterns: Array.isArray(site.cutPatterns) ? site.cutPatterns : [],
    segments: Array.isArray(site.segments) ? site.segments : [],
    gapToOrf: Math.max(0, Number(site.gap) || 0)
  };
}

function buildRefinedVariants({
  clamp,
  normalizeSequenceText,
  reverseComplementIupac,
  querySequence,
  queryLength,
  queryStart,
  hostLength,
  hostTopology,
  hostFeatures,
  hostBackboneSequence,
  hostBackboneSegments,
  evaluated,
  uniqueRestrictionHits
}) {
  if (!evaluated?.insertLength) {
    return null;
  }

  const promoter = selectPromoterCandidate(
    hostFeatures,
    evaluated.hostStart,
    hostLength,
    evaluated.insertWindowStart
  );

  const orfHits = detectLinearOrfHits(
    String(evaluated.rotatedQuery || '').replace(/[^ACGT]/g, 'N'),
    DEFAULT_MIN_ORF_LENGTH
  );
  const selectedOrf = selectOrfCandidate(
    orfHits,
    evaluated.insertWindowStart,
    evaluated.insertWindowEnd,
    promoter
  );

  if (!selectedOrf) {
    return null;
  }

  const gibsonSource = promoter ? 'promoter_orf' : 'orf_overlap';
  const gibsonVariant = buildGibsonVariant(
    clamp,
    querySequence,
    queryStart,
    selectedOrf.start,
    selectedOrf.end,
    queryLength,
    gibsonSource,
    {
      startCodon: 'ATG',
      stopCodon: selectedOrf.stopCodon
    }
  );

  const flankingSites = selectFlankingRestrictionSites(
    clamp,
    uniqueRestrictionHits,
    queryStart,
    queryLength,
    selectedOrf.start,
    selectedOrf.end
  );

  const restrictionInsertStart = flankingSites.upstream
    ? flankingSites.upstream.rotatedStart
    : selectedOrf.start;
  const restrictionInsertEnd = flankingSites.downstream
    ? flankingSites.downstream.rotatedEnd
    : selectedOrf.end;

  const restrictionVariant = buildRestrictionVariant({
    clamp,
    querySequence,
    queryStart,
    queryLength,
    insertStart: restrictionInsertStart,
    insertEnd: restrictionInsertEnd,
    hostBackboneSequence,
    hostBackboneSegments,
    hostLength,
    source: gibsonSource,
    extra: {
      startCodon: 'ATG',
      stopCodon: selectedOrf.stopCodon,
      upstreamSite: mapSiteToMetadata(flankingSites.upstream),
      downstreamSite: mapSiteToMetadata(flankingSites.downstream),
      siteExtensionApplied: Boolean(flankingSites.upstream || flankingSites.downstream)
    }
  });

  const promoterSegments = promoter
    ? mapRotatedWindowRangeToSegments(
      clamp,
      queryStart,
      promoter.rotatedStart,
      promoter.rotatedEnd,
      queryLength
    )
    : [];

  return {
    promoter: promoter ? {
      name: promoter.feature?.name || '',
      type: promoter.feature?.type || 'promoter',
      description: promoter.feature?.description || '',
      gapToInsert: promoter.gapToInsert,
      segments: promoterSegments
    } : null,
    variants: {
      gibson: gibsonVariant,
      restriction: restrictionVariant
    }
  };
}

function buildFallbackVariants({
  clamp,
  querySequence,
  queryLength,
  queryStart,
  hostLength,
  hostBackboneSequence,
  hostBackboneSegments,
  insertWindowStart,
  insertWindowEnd
}) {
  const gibsonVariant = buildGibsonVariant(
    clamp,
    querySequence,
    queryStart,
    insertWindowStart,
    insertWindowEnd,
    queryLength,
    'alignment_fallback'
  );

  const restrictionVariant = buildRestrictionVariant({
    clamp,
    querySequence,
    queryStart,
    queryLength,
    insertStart: insertWindowStart,
    insertEnd: insertWindowEnd,
    hostBackboneSequence,
    hostBackboneSegments,
    hostLength,
    source: 'alignment_fallback',
    extra: {
      upstreamSite: null,
      downstreamSite: null,
      siteExtensionApplied: false
    }
  });

  return {
    promoter: null,
    variants: {
      gibson: gibsonVariant,
      restriction: restrictionVariant
    }
  };
}

function analyzeStoredVectorAgainstQuery(deps, entry, hostRecord, querySequence, uniqueRestrictionHitsByTopology) {
  const {
    cleanText,
    normalizeSequenceText,
    normalizeStatus,
    clamp,
    reverseComplementIupac,
    STATUS_SAVED
  } = deps;

  const normalizedHostSequence = normalizeSequenceText(hostRecord?.sequence);
  const normalizedQuerySequence = normalizeSequenceText(querySequence);
  const hostLength = normalizedHostSequence.length;
  const queryLength = normalizedQuerySequence.length;
  if (!hostLength || !queryLength) {
    return null;
  }

  const hostTopology = String(hostRecord?.topology || entry?.topology || 'linear').toLowerCase() === 'circular'
    ? 'circular'
    : 'linear';
  const hostFeatures = Array.isArray(hostRecord?.features) ? hostRecord.features : [];

  const candidatePool = [];
  [
    {
      orientation: 'forward',
      sequence: normalizedHostSequence,
      features: hostFeatures
    },
    {
      orientation: 'reverse',
      sequence: reverseComplementIupac(normalizedHostSequence),
      features: reverseComplementFeatures(hostFeatures, hostLength)
    }
  ].forEach((orientationCandidate) => {
    const rotationPairs = collectCircularRotationPairs(
      normalizeSequenceText,
      orientationCandidate.sequence,
      normalizedQuerySequence
    );

    rotationPairs.forEach((pair) => {
      const evaluated = evaluateCircularInsertionCandidate(
        clamp,
        normalizeSequenceText,
        orientationCandidate.sequence,
        normalizedQuerySequence,
        pair.hostStart,
        pair.queryStart
      );

      const alignmentBackboneSegments = mergeSegments(clamp, [
        ...mapRotatedWindowRangeToSegments(clamp, pair.queryStart, 0, evaluated.prefixLength, queryLength),
        ...mapRotatedWindowRangeToSegments(
          clamp,
          pair.queryStart,
          queryLength - evaluated.suffixLength,
          queryLength,
          queryLength
        )
      ], queryLength);
      const alignmentInsertSegments = mapRotatedWindowRangeToSegments(
        clamp,
        pair.queryStart,
        evaluated.insertWindowStart,
        evaluated.insertWindowEnd,
        queryLength
      );

      const fallbackVariants = buildFallbackVariants({
        clamp,
        querySequence: normalizedQuerySequence,
        queryLength,
        queryStart: pair.queryStart,
        hostLength,
        hostBackboneSequence: orientationCandidate.sequence,
        hostBackboneSegments: alignmentBackboneSegments,
        insertWindowStart: evaluated.insertWindowStart,
        insertWindowEnd: evaluated.insertWindowEnd
      });

      const uniqueRestrictionHits = uniqueRestrictionHitsByTopology.get(hostTopology) || [];
      const refined = orientationCandidate.orientation === 'forward'
        ? buildRefinedVariants({
          clamp,
          normalizeSequenceText,
          reverseComplementIupac,
          querySequence: normalizedQuerySequence,
          queryLength,
          queryStart: pair.queryStart,
          hostLength,
          hostTopology,
          hostFeatures: orientationCandidate.features,
          hostBackboneSequence: orientationCandidate.sequence,
          hostBackboneSegments: alignmentBackboneSegments,
          evaluated,
          uniqueRestrictionHits
        })
        : null;

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
        backboneSegments: alignmentBackboneSegments,
        insertSegments: alignmentInsertSegments,
        promoter: refined?.promoter || fallbackVariants.promoter,
        variants: refined?.variants || fallbackVariants.variants
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
    STATUS_SAVED,
    reverseComplementIupac
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

  const restrictionEnzymes = await loadCommercialRestrictionEnzymes();
  const uniqueRestrictionHitsByTopology = new Map();
  const getUniqueRestrictionHits = (topology) => {
    const normalizedTopology = String(topology || '').toLowerCase() === 'circular' ? 'circular' : 'linear';
    if (!uniqueRestrictionHitsByTopology.has(normalizedTopology)) {
      uniqueRestrictionHitsByTopology.set(
        normalizedTopology,
        collectUniqueRestrictionSiteHits(
          normalizeSequenceText,
          reverseComplementIupac,
          querySequence,
          normalizedTopology,
          restrictionEnzymes
        )
      );
    }
    return uniqueRestrictionHitsByTopology.get(normalizedTopology);
  };

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

      getUniqueRestrictionHits(hostRecord.topology || entry.topology);
      const candidate = analyzeStoredVectorAgainstQuery(
        deps,
        entry,
        hostRecord,
        querySequence,
        uniqueRestrictionHitsByTopology
      );
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
