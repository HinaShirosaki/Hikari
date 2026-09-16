'use strict';

const { annotateCircularPlasmidSequenceSync } = require('../circular-plasmid-annotation.js');
const { MIN_QUERY_LENGTH } = require('./constants');
const {
  extractRecordFromGbkText,
  loadCommonPromoters,
  loadSequenceViewerAnalysisModules
} = require('./assets');
const {
  analyzeHostVectorAgainstQuery,
  isAlignmentAcceptable
} = require('./host-alignment');
const { buildPromoterCandidateSelections } = require('./promoter-candidates');
const {
  buildPromoterAlignedRecognitionMatch,
  buildRecognitionMatch,
  compareRecognitionMatches
} = require('./recognition-match');

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
    return { queryLength: querySequence.length, match: null };
  }

  const promoterCandidates = await buildPromoterCandidates({
    normalizeSequenceText,
    reverseComplementIupac,
    querySequence
  });
  const entries = await listCandidateEntries({
    cleanText,
    normalizeEntryRow,
    openDatabase,
    paths,
    payload,
    querySequence,
    readRows,
    statusSaved: STATUS_SAVED
  });
  const bestMatch = await findBestLibraryMatch({
    entries,
    fs,
    normalizeSequenceText,
    paths,
    promoterCandidates,
    querySequence,
    reverseComplementIupac,
    statusSaved: STATUS_SAVED,
    ensurePathWithinRoot
  });

  return {
    queryLength: querySequence.length,
    match: bestMatch || buildPromoterAlignedRecognitionMatch(promoterCandidates)
  };
}

async function buildPromoterCandidates({ normalizeSequenceText, reverseComplementIupac, querySequence }) {
  const {
    buildOrfFeatures,
    buildCommercialRestrictionFeatures
  } = await loadSequenceViewerAnalysisModules();
  const commonPromoters = await loadCommonPromoters(normalizeSequenceText);
  const promoterAnnotation = commonPromoters.length
    ? annotateCircularPlasmidSequenceSync(querySequence, commonPromoters, {
      maxWorkers: 1,
      maxHitsPerRecord: 16,
      minRecordLength: MIN_QUERY_LENGTH
    })
    : { matches: [] };

  return buildPromoterCandidateSelections({
    reverseComplementIupac,
    querySequence,
    promoterAnnotationHits: promoterAnnotation?.matches || [],
    buildOrfFeatures,
    buildCommercialRestrictionFeatures
  });
}

async function listCandidateEntries({
  cleanText,
  normalizeEntryRow,
  openDatabase,
  paths,
  payload,
  querySequence,
  readRows,
  statusSaved
}) {
  const safeExcludeEntryId = cleanText(payload.excludeEntryId, 200);
  const db = await openDatabase(paths.sqlitePath);
  try {
    return readRows(
      db,
      `SELECT * FROM sequence_entries
       ORDER BY
         CASE WHEN status = '${statusSaved}' THEN 0 ELSE 1 END,
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
}

async function findBestLibraryMatch({
  entries,
  fs,
  normalizeSequenceText,
  paths,
  promoterCandidates,
  querySequence,
  reverseComplementIupac,
  statusSaved,
  ensurePathWithinRoot
}) {
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
      if (compareRecognitionMatches(candidate, bestMatch, statusSaved) < 0) {
        bestMatch = candidate;
      }
    } catch {
      // Ignore malformed entries and keep checking the rest of the library.
    }
  }
  return bestMatch;
}

module.exports = {
  recognizeSequenceBackboneInLibrary
};
