'use strict';

const REVIEW_JOURNAL_KEYWORD = 'review';

// A bare "review" substring drops primary-research venues: Physical Review Letters,
// Physical Review B/D/E, The American Economic Review. Plural "Reviews" and the
// "Annual Review of ..." prefix are what actually name a review journal (Nature
// Reviews X, Chemical Reviews, Physiological Reviews, Cancer Treatment Reviews).
// ponytail: title heuristic, swap for a curated journal list if false negatives show up.
const REVIEW_JOURNAL_PATTERNS = Object.freeze([
  { keyword: 'reviews', pattern: /\breviews\b/ },
  { keyword: 'annual review of', pattern: /\bannual review of\b/ }
]);

function cleanJournalName(value) {
  return String(value == null ? '' : value).trim().slice(0, 320);
}

function findReviewJournalKeyword(value) {
  const journal = cleanJournalName(value);
  if (!journal) {
    return null;
  }
  const lower = journal.toLowerCase();
  const match = REVIEW_JOURNAL_PATTERNS.find((entry) => entry.pattern.test(lower));
  if (!match) {
    return null;
  }
  return Object.freeze({
    journal,
    keyword: match.keyword
  });
}

function createReviewJournalSkipResult(value) {
  const match = findReviewJournalKeyword(value);
  if (!match) {
    return null;
  }
  const paperIntake = Object.freeze({
    ok: true,
    status: 'skipped_review_journal',
    skipped: true,
    reason: 'review_journal',
    journal: match.journal,
    matched_keyword: match.keyword
  });
  return {
    ok: true,
    status: 'skipped',
    skipped: true,
    reason: paperIntake.reason,
    journal: match.journal,
    matched_keyword: match.keyword,
    paper_intake: paperIntake,
    paper_intake_status: paperIntake.status,
    paper_intake_error: '',
    summary: `Skipped automatic paper intake because journal "${match.journal}" contains "${match.keyword}".`
  };
}

module.exports = {
  REVIEW_JOURNAL_KEYWORD,
  createReviewJournalSkipResult,
  findReviewJournalKeyword
};
