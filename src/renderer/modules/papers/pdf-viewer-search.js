const PDF_SELECTION_SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'among',
  'and',
  'are',
  'between',
  'from',
  'has',
  'have',
  'into',
  'our',
  'that',
  'the',
  'their',
  'these',
  'this',
  'through',
  'using',
  'was',
  'were',
  'with'
]);

export function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildHighlightCommentPopoverMarkup(comment = {}) {
  const author = String(comment.author || 'Local user').trim() || 'Local user';
  const text = String(comment.text || '').trim();
  return `
      <p><strong>${escapeHtml(author)}</strong></p>
      <p>${escapeHtml(text)}</p>
    `;
}

export function normalizePdfHighlightText(value = '') {
  const normalizedBreaks = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\u00ad/g, '');
  const dehyphenated = normalizedBreaks.replace(/(\p{L})-\s*\n\s*(?=\p{Ll})/gu, '$1');
  return dehyphenated
    .split(/\n\s*\n+/)
    .map((block) => block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n\n');
}

export async function copyPdfHighlightText(value = '', navigatorRef = globalThis.navigator) {
  const text = normalizePdfHighlightText(value);
  const clipboard = navigatorRef?.clipboard;
  if (!text || typeof clipboard?.writeText !== 'function') {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function buildHighlightPopoverMarkup(highlight = {}, comment = null) {
  const text = normalizePdfHighlightText(highlight?.text);
  if (!text) {
    return '';
  }
  const preview = text.length > 1400
    ? `${text.slice(0, 1397).trimEnd()}...`
    : text;
  const paragraphs = preview
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  const commentMarkup = comment
    ? `<div class="papers-highlight-popover-comment">${buildHighlightCommentPopoverMarkup(comment)}</div>`
    : '';
  return `
      <div class="papers-highlight-popover-head">
        <strong>Highlighted text</strong>
        <div class="papers-highlight-popover-copy-wrap">
          <span class="papers-highlight-popover-copy-status" data-paper-highlight-copy-status aria-live="polite"></span>
          <button
            type="button"
            class="papers-highlight-popover-copy-btn"
            data-paper-highlight-copy
            aria-label="Copy highlighted text"
            title="Copy highlighted text"
          >
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
              <rect x="8" y="8" width="11" height="11" rx="1.75"></rect>
              <path d="M5 16V6.75A1.75 1.75 0 0 1 6.75 5H16"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="papers-highlight-popover-text">${paragraphs}</div>
      ${commentMarkup}
    `;
}

export function normalizePdfSelectionSearchText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripSearchTermEdges(value = '') {
  return String(value || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function shouldKeepSearchTerm(term = '') {
  const normalized = normalizePdfSelectionSearchText(term);
  if (!normalized || PDF_SELECTION_SEARCH_STOP_WORDS.has(normalized)) {
    return false;
  }
  return normalized.length >= 3 || /\d/.test(normalized);
}

export function getPdfSelectionSearchTerms(value = '') {
  const normalized = normalizePdfSelectionSearchText(value);
  if (!normalized) {
    return [];
  }
  const terms = [];
  const addTerm = (rawTerm) => {
    const term = stripSearchTermEdges(rawTerm).toLowerCase();
    if (!shouldKeepSearchTerm(term) || terms.includes(term)) {
      return;
    }
    terms.push(term);
  };
  normalized.split(/\s+/).forEach((token) => {
    addTerm(token);
    token.split(/[-‐‑‒–—/]+/u).forEach(addTerm);
  });
  if (!terms.length) {
    normalized.split(/\s+/).forEach((token) => {
      const term = stripSearchTermEdges(token).toLowerCase();
      if (term && !terms.includes(term)) {
        terms.push(term);
      }
    });
  }
  return terms.slice(0, 20);
}

export function countPdfSelectionSearchMatches(sourceText = '', queryText = '') {
  const source = normalizePdfSelectionSearchText(sourceText);
  const query = normalizePdfSelectionSearchText(queryText);
  if (!source || !query) {
    return 0;
  }
  let count = 0;
  let index = source.indexOf(query);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(query, index + query.length);
  }
  return count;
}

export function buildCurrentPdfSelectionSearchResult(pageTexts = [], queryText = '', currentPageNumber = 1) {
  const query = normalizePdfSelectionSearchText(queryText);
  if (!query) {
    return { query, totalMatches: 0, pages: [], targetPageNumber: 0 };
  }
  const pages = (Array.isArray(pageTexts) ? pageTexts : [])
    .map((item) => {
      const pageNumber = Math.max(1, Math.round(Number(item?.pageNumber) || 0));
      const count = countPdfSelectionSearchMatches(item?.text, query);
      return pageNumber && count > 0 ? { pageNumber, count } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const currentPage = Math.max(1, Math.round(Number(currentPageNumber) || 1));
  const target = pages.find((item) => item.pageNumber > currentPage) || pages[0] || null;
  return {
    query,
    totalMatches: pages.reduce((sum, item) => sum + item.count, 0),
    pages,
    targetPageNumber: target?.pageNumber || 0
  };
}

export function buildPdfSelectionSearchResultFromMatches(matches = [], currentPageNumber = 1) {
  const normalizedMatches = (Array.isArray(matches) ? matches : [])
    .filter((match) => match && Math.max(1, Math.round(Number(match.pageNumber) || 0)))
    .slice()
    .sort((left, right) => {
      const pageDelta = (Number(left.pageNumber) || 0) - (Number(right.pageNumber) || 0);
      if (pageDelta) {
        return pageDelta;
      }
      const leftBox = Array.isArray(left.boxes) ? left.boxes[0] : null;
      const rightBox = Array.isArray(right.boxes) ? right.boxes[0] : null;
      const topDelta = (Number(leftBox?.y) || 0) - (Number(rightBox?.y) || 0);
      return Math.abs(topDelta) > 0.002
        ? topDelta
        : (Number(leftBox?.x) || 0) - (Number(rightBox?.x) || 0);
    });
  const pageCounts = new Map();
  normalizedMatches.forEach((match) => {
    const pageNumber = Math.max(1, Math.round(Number(match.pageNumber) || 1));
    pageCounts.set(pageNumber, (pageCounts.get(pageNumber) || 0) + 1);
  });
  const currentPage = Math.max(1, Math.round(Number(currentPageNumber) || 1));
  let targetMatchIndex = normalizedMatches.findIndex((match) => (
    Math.max(1, Math.round(Number(match.pageNumber) || 1)) > currentPage
  ));
  if (targetMatchIndex < 0 && normalizedMatches.length) {
    targetMatchIndex = 0;
  }
  return {
    totalMatches: normalizedMatches.length,
    pages: [...pageCounts.entries()].map(([pageNumber, count]) => ({ pageNumber, count })),
    matches: normalizedMatches,
    targetMatchIndex
  };
}
