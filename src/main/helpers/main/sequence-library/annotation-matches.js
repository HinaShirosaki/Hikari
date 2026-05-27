'use strict';

const { MAX_ANNOTATION_FEATURES_PER_RUN, MIN_PROTEIN_ANNOTATION_AA_LENGTH } = require('./constants');
const { normalizeProteinSequence } = require('./protein-utils');
const {
  normalizeSequenceText,
  reverseComplementIupac
} = require('./utils');
const {
  buildDnaAnnotationCandidates,
  buildProteinAnnotationGroups
} = require('./annotation-candidates');
const {
  buildSegmentsFromStartAndLength,
  findPatternMatchStarts
} = require('./sequence-geometry');
const { buildProteinAnnotationOrfs } = require('./orf-scanner');

function buildDnaAnnotationMatches(db, querySequence, topology = 'linear', excludeEntryId = '') {
  const normalizedQuery = normalizeSequenceText(querySequence);
  if (!normalizedQuery.length) {
    return [];
  }

  const candidates = buildDnaAnnotationCandidates(db, normalizedQuery.length, excludeEntryId);
  const sequenceMatchCache = new Map();
  const matches = [];
  for (const candidate of candidates) {
    if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
      break;
    }
    appendDnaCandidateMatches(matches, sequenceMatchCache, candidate, normalizedQuery, topology);
  }
  return sortAnnotationMatches(matches.filter((match) => Array.isArray(match.segments) && match.segments.length));
}

function appendDnaCandidateMatches(matches, cache, candidate, normalizedQuery, topology) {
  const candidateSequence = normalizeSequenceText(candidate.matchedSequence);
  if (!candidateSequence.length) {
    return;
  }

  let cached = cache.get(candidateSequence);
  if (!cached) {
    const reverseSequence = reverseComplementIupac(candidateSequence);
    cached = {
      forwardStarts: findPatternMatchStarts(normalizedQuery, candidateSequence, topology),
      reverseStarts: reverseSequence !== candidateSequence
        ? findPatternMatchStarts(normalizedQuery, reverseSequence, topology)
        : []
    };
    cache.set(candidateSequence, cached);
  }
  cached.forwardStarts.forEach((start) => pushDnaMatch(matches, candidate, candidateSequence, start, 1, normalizedQuery, topology));
  cached.reverseStarts.forEach((start) => pushDnaMatch(matches, candidate, candidateSequence, start, -1, normalizedQuery, topology));
}

function pushDnaMatch(matches, candidate, candidateSequence, start, strand, normalizedQuery, topology) {
  if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
    return;
  }
  matches.push({
    featureId: candidate.featureId,
    name: candidate.name,
    type: candidate.type,
    strand,
    matchedSequence: candidateSequence,
    sequenceLength: candidate.sequenceLength,
    hosts: candidate.hosts,
    segments: buildSegmentsFromStartAndLength(start, candidateSequence.length, normalizedQuery.length, topology)
  });
}

function buildProteinAnnotationMatches(db, querySequence, topology = 'linear', excludeEntryId = '') {
  const normalizedQuery = normalizeSequenceText(querySequence);
  if (!normalizedQuery.length) {
    return [];
  }

  const groupsByProtein = buildProteinAnnotationGroups(db, normalizedQuery, excludeEntryId);
  const proteinLengths = [...groupsByProtein.keys()].map((proteinSequence) => proteinSequence.length).filter(Boolean);
  if (!proteinLengths.length) {
    return [];
  }

  const orfs = buildProteinAnnotationOrfs(
    normalizedQuery,
    topology,
    Math.max(MIN_PROTEIN_ANNOTATION_AA_LENGTH, Math.min(...proteinLengths))
  );
  const matches = [];
  for (const orf of orfs) {
    if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
      break;
    }
    const groupedCandidates = groupsByProtein.get(normalizeProteinSequence(orf.proteinSequence));
    appendProteinGroups(matches, groupedCandidates, orf);
  }
  return sortAnnotationMatches(matches);
}

function appendProteinGroups(matches, groupedCandidates, orf) {
  if (!groupedCandidates || !groupedCandidates.size) {
    return;
  }
  groupedCandidates.forEach((group) => {
    if (matches.length >= MAX_ANNOTATION_FEATURES_PER_RUN) {
      return;
    }
    matches.push({
      name: group.name,
      type: group.type,
      strand: orf.strand,
      segments: orf.segments,
      translation: orf.translation,
      matchedSequence: orf.dnaSequence,
      proteinSequence: orf.proteinSequence,
      hosts: [...group.hosts.values()],
      orfFrame: orf.orfFrame,
      orfLengthNt: orf.orfLengthNt,
      orfLengthAa: orf.orfLengthAa,
      startCodon: orf.startCodon,
      stopCodon: orf.stopCodon
    });
  });
}

function sortAnnotationMatches(matches) {
  return matches.sort((left, right) => {
    const leftStart = left.segments?.[0]?.start ?? 0;
    const rightStart = right.segments?.[0]?.start ?? 0;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return Math.max(0, Number(right.sequenceLength || right.orfLengthNt) || 0)
      - Math.max(0, Number(left.sequenceLength || left.orfLengthNt) || 0);
  });
}

module.exports = {
  buildDnaAnnotationMatches,
  buildProteinAnnotationMatches
};
