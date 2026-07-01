'use strict';

/**
 * Stable paper-identity helpers shared by the literature search, download, and
 * knowledge-database layers. These normalize the identifiers used to decide
 * whether two paper references describe the same work (DOI, PMID, PMCID, title)
 * so deduplication is consistent everywhere instead of re-derived per call site.
 */

function normalizeDoi(value) {
  return String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizePmid(value) {
  // The pmid field is explicit, so keep the digits and drop wrappers like
  // "PMID:" or "pmid". PMIDs are 1-8 digits today; cap at 9 as a sanity bound.
  // ponytail: 9-digit ceiling, widen if NLM ever exceeds it.
  const digits = String(value || '').replace(/\D/g, '');
  return digits && digits.length <= 9 ? digits : '';
}

function normalizePmcid(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/PMC?\s*0*(\d{3,9})/) || text.match(/\b0*(\d{3,9})\b/);
  return match ? `PMC${match[1]}` : '';
}

/**
 * Collapse a title into a comparison key: lowercase, strip punctuation, collapse
 * whitespace. Two titles with the same key are treated as the same paper when no
 * stronger identifier is available.
 */
function titleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a normalized identity from a loose search-result / metadata object,
 * tolerating the many field-name variants used across the codebase.
 */
function buildPaperIdentity(item = {}) {
  const source = item && typeof item === 'object' ? item : {};
  const title = String(source.title || source.paper_title || source.paperTitle || '').trim();
  return {
    doi: normalizeDoi(source.doi || source.paper_doi || source.paperDoi),
    pmid: normalizePmid(source.pmid || source.paper_pmid || source.paperPmid),
    pmcid: normalizePmcid(source.pmcid || source.paper_pmcid || source.paperPmcid),
    title,
    title_key: titleKey(title)
  };
}

/**
 * True when two identities point at the same paper. Strong identifiers (DOI,
 * PMID, PMCID) win; title is only used as a last resort when neither side has a
 * strong id, to avoid collapsing distinct papers that merely share a title.
 */
function identitiesMatch(left = {}, right = {}) {
  const a = left || {};
  const b = right || {};
  if (a.doi && b.doi) {
    return a.doi === b.doi;
  }
  if (a.pmid && b.pmid) {
    return a.pmid === b.pmid;
  }
  if (a.pmcid && b.pmcid) {
    return a.pmcid === b.pmcid;
  }
  const aStrong = Boolean(a.doi || a.pmid || a.pmcid);
  const bStrong = Boolean(b.doi || b.pmid || b.pmcid);
  if (aStrong || bStrong) {
    return false;
  }
  return Boolean(a.title_key && a.title_key === b.title_key);
}

module.exports = {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  titleKey,
  buildPaperIdentity,
  identitiesMatch
};
