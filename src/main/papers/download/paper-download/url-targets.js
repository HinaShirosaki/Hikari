'use strict';

const { ensureObject } = require('../../../lib/normalize.js');
const { PAPER_DOWNLOAD_ACTIONS, PDF_URL_HINT_PATTERN } = require('./constants.js');
const { defaultAsArray, defaultCleanText } = require('./storage-paths.js');

function normalizeAction(value) {
  const normalized = defaultCleanText(value).toLowerCase();
  if (!normalized) {
    return PAPER_DOWNLOAD_ACTIONS.DOWNLOAD;
  }
  return Object.values(PAPER_DOWNLOAD_ACTIONS).includes(normalized) ? normalized : '';
}

function resolveAbsoluteUrl(rawUrl, baseUrl = '') {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) {
    return '';
  }
  try {
    return new URL(candidate, baseUrl || undefined).toString();
  } catch {
    return '';
  }
}

function resolveDoiUrl(rawDoi) {
  const doi = String(rawDoi || '').trim();
  if (!doi) {
    return '';
  }
  return `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`;
}

function extractUrlsFromText(rawText, baseUrl = '') {
  const text = String(rawText || '');
  const urls = [];
  const pattern = /https?:\/\/[^\s<>"')\]]+/gi;
  let match = pattern.exec(text);
  while (match) {
    const cleaned = String(match[0] || '').replace(/[),.;]+$/g, '');
    const resolved = resolveAbsoluteUrl(cleaned, baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
    match = pattern.exec(text);
  }
  return urls;
}

function extractUrlsFromHtml(rawHtml, baseUrl = '') {
  const html = String(rawHtml || '');
  const urls = [];
  const attrPattern = /\b(?:href|src|content|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
  let match = attrPattern.exec(html);
  while (match) {
    const resolved = resolveAbsoluteUrl(match[1], baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
    match = attrPattern.exec(html);
  }
  return urls;
}

function looksLikePdfUrl(url) {
  return PDF_URL_HINT_PATTERN.test(String(url || '').trim());
}

function scoreCandidateUrl(candidate = {}) {
  const url = String(candidate.url || '');
  const source = String(candidate.source || '');
  let score = 0;
  if (source === 'paper_pdf_url' || source === 'pdf_url') {
    score += 200;
  } else if (source === 'candidate_urls' || source === 'pdf_urls') {
    score += 140;
  } else if (source === 'doi') {
    score += 60;
  } else if (source === 'page_html') {
    score += 100;
  } else if (source === 'message') {
    score += 80;
  } else if (source === 'page_url' || source === 'paper_url' || source === 'url') {
    score += 40;
  }
  if (/\.pdf(?:$|[?#])/i.test(url)) {
    score += 100;
  } else if (/\/pdf(?:\/|$)/i.test(url)) {
    score += 80;
  } else if (/[?&](?:format|type)=pdf\b/i.test(url)) {
    score += 70;
  } else if (/[?&]download=(?:1|true)?\b/i.test(url) || /download/i.test(url)) {
    score += 40;
  } else if (looksLikePdfUrl(url)) {
    score += 20;
  }
  return score;
}

function dedupeCandidateUrls(entries = []) {
  const seen = new Set();
  return defaultAsArray(entries)
    .map((entry) => ({
      url: defaultCleanText(entry?.url),
      source: defaultCleanText(entry?.source)
    }))
    .filter((entry) => entry.url)
    .filter((entry) => {
      const key = entry.url.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function extractPaperDownloadTargets(input = {}) {
  const source = ensureObject(input);
  const doiUrl = resolveDoiUrl(source.doi || source.paper_doi || source.paperDoi || '');
  const pageUrl = resolveAbsoluteUrl(source.page_url || source.pageUrl || source.paper_url || source.paperUrl || '')
    || doiUrl;
  const pageHtml = defaultCleanText(source.page_html || source.pageHtml);
  const message = defaultCleanText(source.message);

  const candidates = dedupeCandidateUrls([
    { url: resolveAbsoluteUrl(source.paper_pdf_url || source.paperPdfUrl || '', pageUrl), source: 'paper_pdf_url' },
    { url: resolveAbsoluteUrl(source.pdf_url || source.pdfUrl || '', pageUrl), source: 'pdf_url' },
    { url: resolveAbsoluteUrl(source.url || '', pageUrl), source: 'url' },
    { url: doiUrl, source: 'doi' },
    { url: pageUrl, source: 'page_url' },
    ...defaultAsArray(source.candidate_urls).map((url) => ({ url: resolveAbsoluteUrl(url, pageUrl), source: 'candidate_urls' })),
    ...defaultAsArray(source.pdf_urls).map((url) => ({ url: resolveAbsoluteUrl(url, pageUrl), source: 'pdf_urls' })),
    ...extractUrlsFromText(message, pageUrl).map((url) => ({ url, source: 'message' })),
    ...extractUrlsFromHtml(pageHtml, pageUrl).map((url) => ({ url, source: 'page_html' }))
  ]);

  const pdfCandidates = candidates
    .filter((entry) => entry.source === 'paper_pdf_url' || entry.source === 'pdf_url' || looksLikePdfUrl(entry.url))
    .map((entry) => ({
      ...entry,
      score: scoreCandidateUrl(entry)
    }))
    .sort((left, right) => right.score - left.score);

  const selectedPdfUrl = pdfCandidates[0]?.url || '';
  const browserEntryUrl = pageUrl || selectedPdfUrl || candidates[0]?.url || '';
  return {
    ok: true,
    selected_pdf_url: selectedPdfUrl,
    browser_entry_url: browserEntryUrl,
    candidate_pdf_urls: pdfCandidates.map((entry) => entry.url),
    candidate_urls: candidates.map((entry) => entry.url),
    requires_browser_session: !selectedPdfUrl && Boolean(browserEntryUrl),
    summary: selectedPdfUrl
      ? `Resolved ${pdfCandidates.length} PDF candidate URL${pdfCandidates.length === 1 ? '' : 's'}.`
      : (browserEntryUrl
        ? 'No direct PDF URL was found; a browser-assisted download may be required.'
        : 'No paper download URL was found.')
  };
}

module.exports = {
  extractPaperDownloadTargets,
  normalizeAction
};
