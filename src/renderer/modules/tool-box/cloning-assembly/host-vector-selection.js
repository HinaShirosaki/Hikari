import {
  asArray,
  circularSlice,
  commonPrefixLength,
  commonSuffixLength,
  normalizeSequence
} from './sequence-utils.js';
import { normalizeHostVector } from './fragments.js';

export function commonCircularCoverage(hostSequence, querySequence, hostStart, queryStart) {
  const hostLength = hostSequence.length;
  const queryLength = querySequence.length;
  const rotatedHost = circularSlice(hostSequence, hostStart, hostLength);
  const rotatedQuery = circularSlice(querySequence, queryStart, queryLength);
  const prefixLength = commonPrefixLength(rotatedHost, rotatedQuery, hostLength);
  const suffixLength = Math.min(
    commonSuffixLength(rotatedHost, rotatedQuery, hostLength),
    Math.max(0, hostLength - prefixLength)
  );

  return {
    prefixLength,
    suffixLength,
    backboneCoverage: prefixLength + suffixLength
  };
}

export function scoreHostVectorAgainstResult(hostSequence, resultSequence) {
  const host = normalizeSequence(hostSequence);
  const result = normalizeSequence(resultSequence);
  if (!host.length || !result.length) {
    return {
      backboneCoverage: 0,
      hostStart: 0,
      queryStart: 0,
      prefixLength: 0,
      suffixLength: 0
    };
  }

  const hostStep = Math.max(1, Math.floor(host.length / 24));
  const queryStep = Math.max(1, Math.floor(result.length / 24));
  let best = {
    backboneCoverage: 0,
    hostStart: 0,
    queryStart: 0,
    prefixLength: 0,
    suffixLength: 0
  };

  for (let hostStart = 0; hostStart < host.length; hostStart += hostStep) {
    for (let queryStart = 0; queryStart < result.length; queryStart += queryStep) {
      const score = commonCircularCoverage(host, result, hostStart, queryStart);
      if (score.backboneCoverage > best.backboneCoverage) {
        best = {
          ...score,
          hostStart,
          queryStart
        };
      }
    }
  }

  return best;
}

export function findSelectedHostVector(hostVectors, resultSequence, hostVectorId = '') {
  const normalizedHosts = asArray(hostVectors)
    .map((host, index) => normalizeHostVector(host, index))
    .filter((host) => host.sequence.length);

  if (!normalizedHosts.length) {
    return null;
  }

  const requestedId = String(hostVectorId || '').trim();
  if (requestedId) {
    return normalizedHosts.find((host) => host.id === requestedId) || null;
  }

  if (normalizedHosts.length === 1) {
    return normalizedHosts[0];
  }

  const normalizedResult = normalizeSequence(resultSequence);
  if (!normalizedResult.length) {
    return normalizedHosts[0];
  }

  return [...normalizedHosts]
    .map((host) => ({
      host,
      score: scoreHostVectorAgainstResult(host.sequence, normalizedResult)
    }))
    .sort((left, right) => {
      if (right.score.backboneCoverage !== left.score.backboneCoverage) {
        return right.score.backboneCoverage - left.score.backboneCoverage;
      }
      return String(left.host.name || '').localeCompare(String(right.host.name || ''));
    })[0]?.host || normalizedHosts[0];
}
