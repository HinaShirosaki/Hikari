'use strict';

// This function is serialized into the sandboxed publisher page. It has no
// filesystem or host API access. Inspection and activation are separate so the
// host remembers an attempt even if clicking immediately destroys the document.
function paperAutoDownloadPage({ attempted = [], activateKey = '' } = {}) {
  if (!document.body || !/^(https?:|blob:)$/.test(location.protocol)) return null;
  const candidates = [];
  // Whole words only: 'Designing' is not 'sign in', and 'dietary supplementation'
  // or 'excitation' in a title or URL slug is not a supplement or a citation.
  const nonArticleTerms = 'supplement(?:s|al|ary)?|supporting ?(?:information|materials?|data)|appendix|appendices|citations?|bibtex|endnote';
  const excluded = new RegExp(`\\b(?:${nonArticleTerms}|ris|purchase|buy|subscribe|sign ?in|log ?in|register|accept|cookies?)\\b|参考文献|补充|補足`, 'i');
  const excludedUrl = new RegExp(`\\b(?:${nonArticleTerms})\\b|\\.ris(?:$|[?#])`, 'i');
  // Ids, classes and URLs join words with case or punctuation.
  const words = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  const pdfPath = /\.pdf(?:$|[?#])|\/(?:pdf|epdf|pdffull|article-pdf)(?:[/?#]|$)|[?&](?:format|type)=pdf(?:&|$)/i;
  const viewerPage = /\/(?:pdf|epdf|pdffull|reader|viewer)(?:[/.?#]|$)/i.test(location.href);
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const safeUrl = (value) => {
    if (!value || /^\s*(?:#|javascript:)/i.test(value)) return '';
    try {
      const url = new URL(value, document.baseURI);
      if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.username || url.password) return '';
      url.hash = '';
      return url.href === location.href.split('#')[0] ? '' : url.href;
    } catch { return ''; }
  };
  const visible = (element) => {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true'
      || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && style.opacity !== '0' && element.getClientRects().length > 0;
  };
  const irrelevantSection = (element) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const section = `${parent.id} ${parent.getAttribute('class') || ''} ${parent.getAttribute('role') || ''}`;
      if (/references|bibliograph|related[\s_-]*(?:article|content)|recommend|supplement|supporting[\s_-]|citing|cited[\s_-]*by|same[\s_-]*issue|most[\s_-]*(?:read|cited|viewed)|similar[\s_-]*(?:article|content|paper)|more[\s_-]*(?:article|from)|table[\s_-]*of[\s_-]*contents/i.test(section)) return true;
    }
    return false;
  };
  function add(element, url, score, label) {
    const key = url ? `url:${url}` : `button:${location.href.split('#')[0]}:${element.id}:${label}`;
    if (attempted.includes(key) || excluded.test(words(label)) || excludedUrl.test(words(url))) return;
    candidates.push({ element, url, score, key });
  }

  // Scholarly metadata identifies the article PDF more precisely than a generic
  // download control, especially on pages containing references and supplements.
  const metadataUrls = new Set();
  for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
    if (!/^(?:citation_pdf_url|wkhealth_pdf_url|eprints\.document_url)$/i.test(meta.getAttribute('name') || meta.getAttribute('property') || '')) continue;
    const url = safeUrl(meta.getAttribute('content'));
    if (url) { metadataUrls.add(url); add(null, url, 150, ''); }
  }

  const roots = [document];
  for (let index = 0; index < roots.length && index < 30; index += 1) {
    const root = roots[index];
    for (const element of Array.from(root.querySelectorAll('*')).slice(0, 6000)) {
      if (element.shadowRoot && roots.length < 30) roots.push(element.shadowRoot);
    }
    for (const element of root.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"], iframe[src], embed[src], object[data]')) {
      if (!visible(element) || irrelevantSection(element)) continue;
      const label = normalize([...new Set([
        element.getAttribute('aria-label'), element.getAttribute('title'),
        element.innerText || element.textContent, element.getAttribute('value'),
        ...Array.from(element.querySelectorAll('img[alt]')).map((img) => img.alt)
      ].filter(Boolean).map(normalize))].join(' '));
      const identity = `${element.id} ${element.getAttribute('class') || ''} ${element.getAttribute('data-test') || ''}`;
      if (excluded.test(words(label)) || excluded.test(words(identity))) continue;
      const rawUrl = element.getAttribute('href') || element.getAttribute('data-href')
        || element.getAttribute('data-url') || element.getAttribute('src') || element.getAttribute('data');
      if (rawUrl && /^[a-z][a-z\d+.-]*:/i.test(rawUrl) && !/^(?:https?:|blob:|javascript:)/i.test(rawUrl)) continue;
      const url = safeUrl(rawUrl);
      const isEmbedded = /^(?:IFRAME|EMBED|OBJECT)$/.test(element.tagName);
      const pdfLabel = /\bpdf\b/i.test(label);
      const pdfType = /application\/pdf/i.test(element.getAttribute('type') || '');
      if (isEmbedded) {
        if (url && (pdfPath.test(url) || pdfType)) add(null, url, 130, label);
        continue;
      }
      if (url && (pdfPath.test(url) || pdfType || metadataUrls.has(url))) {
        add(element, url, metadataUrls.has(url) ? 160 : 120, label);
      } else if (pdfLabel || (/pdf/i.test(identity) && /download|view|full[ -]?text|下载|下載|ダウンロード/i.test(label))) {
        add(element, url, 100, label);
      } else if (viewerPage && /^(?:download|download (?:this )?(?:article|paper)|下载|下載|ダウンロード)$/i.test(label)) {
        add(element, url, 80, label);
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const candidate = activateKey ? candidates.find((entry) => entry.key === activateKey) : candidates[0];
  if (!candidate) return null;
  const result = { key: candidate.key, action: candidate.element ? 'click' : 'navigate' };
  if (activateKey) {
    if (candidate.element) candidate.element.click();
    else location.assign(candidate.url);
  }
  return result;
}

function buildPaperAutoDownloadScript(options = {}) {
  return `(${paperAutoDownloadPage.toString()})(${JSON.stringify(options)})`;
}

module.exports = { buildPaperAutoDownloadScript };
