'use strict';

const PAPER_DOWNLOAD_ACTIONS = Object.freeze({
  DOWNLOAD: 'download',
  START: 'start',
  STATUS: 'status'
});

const BLOCKED_STATUS_CODES = new Set([401, 403, 407, 409, 423, 425, 429, 451, 503]);
const BLOCKED_HTML_PATTERN = /captcha|cloudflare|checking your browser|access denied|verify you are human|automated requests|enable javascript|robot/i;
const PDF_URL_HINT_PATTERN = /(?:\.pdf(?:$|[?#])|\/pdf(?:\/|$)|[?&](?:format|type|download|pdf)=(?:1|true|pdf)?\b|[?&][^=#]*pdf\b)/i;
const DEFAULT_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; HikariPaperDownload/1.0; +https://hikari.local)';

module.exports = {
  BLOCKED_HTML_PATTERN,
  BLOCKED_STATUS_CODES,
  DEFAULT_FETCH_ACCEPT,
  DEFAULT_USER_AGENT,
  PAPER_DOWNLOAD_ACTIONS,
  PDF_URL_HINT_PATTERN
};
