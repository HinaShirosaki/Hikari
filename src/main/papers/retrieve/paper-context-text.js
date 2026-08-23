'use strict';

const { ensureObject } = require('../../lib/normalize.js');

/**
 * Text + parsing helpers for the paper context loader.
 *
 * Two layers:
 *  - Pure module-level helpers (HTML/XML entity decoding, URL checks, Markdown
 *    section splitting) with no external dependencies.
 *  - `createPaperContextText({ cleanText, asArray, uniqueStrings })` — a factory
 *    that closes over the SAME runtime helpers the loader already uses, so the
 *    tokenizer, chunker, scorer, and PubMed/Europe PMC parsers behave exactly as
 *    before. Split out of agent-paper-context-loader.js to shrink that file and
 *    make the parsing layer independently testable.
 */

const DEFAULT_CHUNK_SIZE = 1500;
const DEFAULT_CHUNK_OVERLAP = 200;

const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'if',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there',
  'these', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'why', 'with'
]);

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    });
}

function stripHtml(value) {
  return decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return '';
  }
}

function looksLikePdfUrl(value) {
  return /(?:\.pdf(?:$|[?#])|\/pdf(?:\/|$)|[?&](?:format|type|download|pdf)=(?:1|true|pdf)?\b|[?&][^=#]*pdf\b)/i
    .test(String(value || '').trim());
}

/**
 * Split a paper.md rewrite into `{ label, text }` sections keyed by Markdown
 * headings. Content before the first heading is kept under "Full text", and
 * inline figure links (`![...](figures/...)`) are preserved verbatim so the
 * agent can still locate the referenced figure files.
 */
function splitMarkdownIntoSections(markdown, maxSectionChars = 12000) {
  const text = String(markdown || '');
  if (!text.trim()) {
    return [];
  }
  const sections = [];
  let label = 'Full text';
  let buffer = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) {
      sections.push({ label, text: body.length > maxSectionChars ? body.slice(0, maxSectionChars) : body });
    }
    buffer = [];
  };
  text.split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      label = heading[1].trim().slice(0, 160) || 'Section';
    } else {
      buffer.push(line);
    }
  });
  flush();
  return sections;
}

/**
 * Build the cleanText/asArray/uniqueStrings-bound text helpers. The same
 * functions the loader used inline — just relocated so they have one home.
 */
function createPaperContextText({ cleanText, asArray, uniqueStrings } = {}) {
  function tokenizeQuery(value) {
    return cleanText(value, 1200)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !QUERY_STOP_WORDS.has(token));
  }

  function scoreTextAgainstQuery(query, text, sectionLabel = '') {
    const queryTokens = tokenizeQuery(query);
    if (!queryTokens.length) {
      return 0;
    }
    const haystack = `${cleanText(sectionLabel, 160)}\n${cleanText(text, 8000)}`.toLowerCase();
    let score = 0;
    queryTokens.forEach((token) => {
      if (haystack.includes(token)) {
        score += 2;
      }
      if (cleanText(sectionLabel, 160).toLowerCase().includes(token)) {
        score += 1;
      }
    });
    const normalizedQuery = cleanText(query, 600).toLowerCase();
    if (normalizedQuery && haystack.includes(normalizedQuery)) {
      score += 5;
    }
    if (/\b(result|finding|mechanism|conclusion|discussion)\b/i.test(sectionLabel)) {
      score += 1.5;
    }
    if (/\b(method|materials)\b/i.test(sectionLabel)) {
      score += 0.5;
    }
    return score;
  }

  function chunkSectionText(text, maxChars = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const normalized = cleanText(text, 40000);
    if (!normalized) {
      return [];
    }
    if (normalized.length <= maxChars) {
      return [normalized];
    }
    const chunks = [];
    let start = 0;
    while (start < normalized.length && chunks.length < 16) {
      let end = Math.min(normalized.length, start + maxChars);
      if (end < normalized.length) {
        const breakIndex = normalized.lastIndexOf(' ', end);
        if (breakIndex > start + 600) {
          end = breakIndex;
        }
      }
      const chunk = normalized.slice(start, end).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      if (end >= normalized.length) {
        break;
      }
      start = Math.max(end - overlap, start + 1);
      while (normalized[start] === ' ') {
        start += 1;
      }
    }
    return chunks;
  }

  function linesToSections(lines, defaultLabel = 'Full text') {
    const sections = [];
    let currentLabel = defaultLabel;
    let currentLines = [];
    const flush = () => {
      const text = cleanText(currentLines.join(' '), 20000);
      if (text) {
        sections.push({
          label: cleanText(currentLabel, 160) || defaultLabel,
          text
        });
      }
      currentLines = [];
    };
    lines.forEach((line) => {
      const normalized = cleanText(line, 1600);
      if (!normalized) {
        return;
      }
      if (normalized.startsWith('## ')) {
        flush();
        currentLabel = cleanText(normalized.slice(3), 160) || defaultLabel;
        return;
      }
      currentLines.push(normalized);
    });
    flush();
    return sections.filter((section) => section.text);
  }

  function xmlFragmentToLines(fragment) {
    const expanded = String(fragment || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(?:\/)?(?:italic|bold|sup|sub|xref|ext-link|inline-formula|disp-formula|named-content|sc)\b[^>]*>/gi, ' ')
      .replace(/<title\b[^>]*>/gi, '\n## ')
      .replace(/<\/title>/gi, '\n')
      .replace(/<label\b[^>]*>/gi, '\n## ')
      .replace(/<\/label>/gi, '\n')
      .replace(/<(?:p|sec|abstract|body|caption|fig|table-wrap|list-item|item)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|sec|abstract|body|caption|fig|table-wrap|list-item|item)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return decodeXmlEntities(expanded)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function parseEuropePmcFullTextSections(xml) {
    const source = String(xml || '');
    if (!source.trim()) {
      return [];
    }
    const abstractBlocks = [];
    const abstractPattern = /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/gi;
    let abstractMatch = abstractPattern.exec(source);
    while (abstractMatch) {
      abstractBlocks.push(...linesToSections(xmlFragmentToLines(abstractMatch[1]), 'Abstract'));
      abstractMatch = abstractPattern.exec(source);
    }
    const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodySections = linesToSections(
      xmlFragmentToLines(bodyMatch?.[1] || source),
      'Full text'
    );
    return [...abstractBlocks, ...bodySections]
      .filter((section) => cleanText(section.text, 20000))
      .slice(0, 40);
  }

  function parsePubMedAbstractSections(xml) {
    const sections = [];
    const pattern = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
    let match = pattern.exec(String(xml || ''));
    while (match) {
      const attrs = String(match[1] || '');
      const label = cleanText(
        attrs.match(/\bLabel="([^"]+)"/i)?.[1] || attrs.match(/\bNlmCategory="([^"]+)"/i)?.[1],
        160
      ) || 'Abstract';
      const text = stripHtml(match[2]);
      if (text) {
        sections.push({ label, text: cleanText(text, 12000) });
      }
      match = pattern.exec(String(xml || ''));
    }
    if (!sections.length) {
      const abstractMatch = String(xml || '').match(/<Abstract\b[^>]*>([\s\S]*?)<\/Abstract>/i);
      const fallback = stripHtml(abstractMatch?.[1] || '');
      if (fallback) {
        sections.push({ label: 'Abstract', text: cleanText(fallback, 12000) });
      }
    }
    return sections.slice(0, 12);
  }

  function buildPaperPdfUrls(record = {}) {
    const source = ensureObject(record);
    const pmcid = cleanText(source.pmcid, 120);
    const directUrl = safeUrl(source.url);
    return uniqueStrings([
      ...asArray(source.pdf_urls).map((entry) => safeUrl(entry)).filter(Boolean),
      looksLikePdfUrl(directUrl) ? directUrl : '',
      pmcid ? `https://europepmc.org/articles/${encodeURIComponent(pmcid)}?pdf=render` : '',
      pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(pmcid)}/pdf` : ''
    ].filter(Boolean), 8);
  }

  function parseEuropePmcMetadata(payload = {}) {
    const source = ensureObject(payload);
    const pmid = cleanText(source.pmid, 120);
    const pmcid = cleanText(source.pmcid, 120);
    const doi = cleanText(source.doi, 180);
    const abstractText = cleanText(stripHtml(source.abstractText || source.abstract || ''), 12000);
    const fullTextEntries = asArray(source.fullTextUrlList?.fullTextUrl || source.fullTextUrls || source.fullTextUrl);
    const pdfUrls = uniqueStrings([
      safeUrl(source.pdfUrl || source.pdf_url),
      ...fullTextEntries.map((entry) => {
        const item = ensureObject(entry);
        const url = safeUrl(item.url || item.href);
        const style = cleanText(item.documentStyle || item.availability || item.format, 80).toLowerCase();
        return style.includes('pdf') || looksLikePdfUrl(url) ? url : '';
      })
    ].filter(Boolean), 8);
    return {
      pmid,
      pmcid,
      doi,
      abstract_sections: abstractText
        ? [{ label: 'Abstract', text: abstractText }]
        : [],
      pdf_urls: buildPaperPdfUrls({
        ...source,
        pmid,
        pmcid,
        doi,
        pdf_urls: pdfUrls
      })
    };
  }

  return {
    tokenizeQuery,
    scoreTextAgainstQuery,
    chunkSectionText,
    linesToSections,
    xmlFragmentToLines,
    parseEuropePmcFullTextSections,
    parsePubMedAbstractSections,
    parseEuropePmcMetadata,
    buildPaperPdfUrls
  };
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  QUERY_STOP_WORDS,
  ensureObject,
  decodeXmlEntities,
  stripHtml,
  safeUrl,
  looksLikePdfUrl,
  splitMarkdownIntoSections,
  createPaperContextText
};
