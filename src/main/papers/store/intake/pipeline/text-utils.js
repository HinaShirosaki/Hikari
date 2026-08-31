'use strict';

const DEFAULT_MARKDOWN_CHAR_LIMIT = 24000;
const DEFAULT_FALLBACK_PAGE_CHARS = 12000;

function cleanText(value, maxLength = 2000) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function limitText(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

function firstSentence(value, maxLength = 800) {
  const text = cleanText(value, maxLength);
  if (!text) {
    return '';
  }
  // Collapse the summary to a single sentence: keep up to the first terminal
  // punctuation that is followed by whitespace or end-of-string.
  const match = text.match(/^.*?[.!?](?=\s|$)/u);
  return cleanText(match ? match[0] : text, maxLength);
}

function buildReviewSkipResult({
  paperId,
  status,
  reason,
  confidence,
  journal,
  matchedKeyword,
  classified = false
} = {}) {
  return {
    ok: true,
    status,
    skipped: true,
    reason,
    paper_id: paperId,
    ...(classified ? { doc_type: 'review', confidence } : {}),
    ...(journal ? { journal } : {}),
    ...(matchedKeyword ? { matched_keyword: matchedKeyword } : {}),
    is_research_paper: false,
    ran_summary_pipeline: false,
    experiment_count: 0,
    pages_read: 0,
    rejected_experiment_count: 0,
    one_sentence_summary: ''
  };
}

module.exports = {
  DEFAULT_FALLBACK_PAGE_CHARS,
  DEFAULT_MARKDOWN_CHAR_LIMIT,
  buildReviewSkipResult,
  cleanText,
  firstSentence,
  limitText
};
