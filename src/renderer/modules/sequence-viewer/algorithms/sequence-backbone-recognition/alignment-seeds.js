'use strict';

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
        seedPairs.push({ hostStart, queryStart, rarity: queryStarts.length });
      });
    }

    seedPairs.sort((left, right) => (left.rarity - right.rarity) || (left.hostStart - right.hostStart) || (left.queryStart - right.queryStart));
    pairs.push(...seedPairs.slice(0, Math.max(0, maxPairs - pairs.length)));
    if (pairs.length >= maxPairs || pairs.length >= 32) {
      break;
    }
  }

  if (pairs.length) {
    return pairs;
  }
  return collectSampledPairs(hostLength, queryLength, maxPairs);
}

function collectSampledPairs(hostLength, queryLength, maxPairs) {
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

module.exports = { collectRotationPairs };
