'use strict';

const PDF_TEXT_EXTRACTION_ACTIONS = Object.freeze({
  EXTRACT: 'extract'
});

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_CHARS_PER_PAGE = 20000;
const DEFAULT_MAX_TOTAL_CHARS = 400000;
const DEFAULT_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; HikariPdfTextExtraction/1.0; +https://hikari.local)';

module.exports = {
  DEFAULT_FETCH_ACCEPT,
  DEFAULT_MAX_CHARS_PER_PAGE,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_TOTAL_CHARS,
  DEFAULT_USER_AGENT,
  PDF_TEXT_EXTRACTION_ACTIONS
};
