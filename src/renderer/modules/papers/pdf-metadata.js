export const EMPTY_PAPER_PDF_METADATA = Object.freeze({
  title: '',
  author: '',
  year: '',
  journal: '',
  doi: '',
  url: ''
});

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/i;
const SUMMARY_FIELDS = ['title', 'author', 'year', 'journal', 'doi', 'url'];

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  const normalized = cleanText(value);
  return normalized ? [normalized] : [];
}

function firstNonEmpty(values = []) {
  return values.map((value) => cleanText(value)).find(Boolean) || '';
}

function buildValueMap(source) {
  const entries = [];
  if (source && typeof source[Symbol.iterator] === 'function') {
    for (const entry of source) {
      if (Array.isArray(entry) && entry.length >= 2) {
        entries.push(entry);
      }
    }
  } else if (source && typeof source === 'object') {
    entries.push(...Object.entries(source));
  }

  return new Map(entries
    .map(([key, value]) => [cleanText(key).toLowerCase(), value])
    .filter(([key]) => key));
}

function readValue(valueMap, keys = []) {
  for (const key of keys) {
    const normalizedKey = cleanText(key).toLowerCase();
    if (!normalizedKey || !valueMap.has(normalizedKey)) {
      continue;
    }
    const normalizedValue = coerceStringList(valueMap.get(normalizedKey)).join(', ');
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  return '';
}

function stripTrailingPunctuation(value) {
  return cleanText(value).replace(/[),.;]+$/g, '');
}

function extractDoi(value) {
  const normalized = cleanText(value);
  if (!normalized) {
    return '';
  }

  const doiUrlMatch = normalized.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?\s#]+)/i);
  if (doiUrlMatch?.[1]) {
    return stripTrailingPunctuation(decodeURIComponent(doiUrlMatch[1]));
  }

  const direct = normalized.replace(/^doi\s*:\s*/i, '').trim();
  if (DOI_PATTERN.test(direct)) {
    return stripTrailingPunctuation(direct.match(DOI_PATTERN)?.[0] || direct);
  }

  return stripTrailingPunctuation(normalized.match(DOI_PATTERN)?.[0] || '');
}

function extractUrl(value) {
  return stripTrailingPunctuation(cleanText(value).match(URL_PATTERN)?.[0] || '');
}

function extractYear(value) {
  const normalized = cleanText(value);
  if (!normalized) {
    return '';
  }

  const pdfDateMatch = normalized.match(/^D:(\d{4})/i);
  if (pdfDateMatch?.[1]) {
    return pdfDateMatch[1];
  }

  const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
  return yearMatch?.[0] || '';
}

function collectSearchValues({ infoMap, customInfoMap, metadataMap }) {
  const values = [];
  const seen = new Set();

  const pushValue = (value) => {
    coerceStringList(value).forEach((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) {
        return;
      }
      seen.add(key);
      values.push(item);
    });
  };

  infoMap.forEach(pushValue);
  customInfoMap.forEach(pushValue);
  metadataMap.forEach(pushValue);
  return values;
}

export function normalizePaperPdfMetadata(source = {}) {
  const normalized = source && typeof source === 'object' ? source : {};
  return {
    title: cleanText(normalized.title),
    author: coerceStringList(normalized.author).join(', '),
    year: extractYear(normalized.year),
    journal: cleanText(normalized.journal),
    doi: extractDoi(normalized.doi),
    url: extractUrl(normalized.url)
  };
}

// Prefer embedded PDF metadata, filling only missing values from the saved
// library record (which may already carry bibliographic discovery metadata).
export function getPaperDetailsMetadata(paper = {}) {
  const embedded = normalizePaperPdfMetadata(paper?.pdfMetadata);
  const saved = normalizePaperPdfMetadata({
    title: paper?.title || paper?.fileName,
    author: paper?.authors || paper?.author || paper?.paperAuthors,
    year: paper?.year || paper?.publishedAt || paper?.published_at,
    journal: paper?.journal,
    doi: paper?.doi,
    url: paper?.url || paper?.paperUrl || paper?.paper_url
  });
  return Object.fromEntries(SUMMARY_FIELDS.map(key => [key, embedded[key] || saved[key]]));
}

export function hasPaperPdfMetadata(source = {}) {
  const metadata = normalizePaperPdfMetadata(source);
  return SUMMARY_FIELDS.some((field) => Boolean(metadata[field]));
}

export function getPaperDisplayTitle(paper = {}) {
  const metadataTitle = cleanText(paper?.pdfMetadata?.title);
  if (metadataTitle) {
    return metadataTitle;
  }
  return cleanText(paper?.title || paper?.fileName || 'Untitled paper') || 'Untitled paper';
}

export function extractPaperPdfMetadata(payload = {}) {
  const info = payload?.info && typeof payload.info === 'object' ? payload.info : {};
  const metadataMap = buildValueMap(payload?.metadata || null);
  const customInfoMap = buildValueMap(info.Custom || null);
  const infoMap = buildValueMap(Object.entries(info).filter(([key]) => key !== 'Custom'));
  const searchValues = collectSearchValues({
    infoMap,
    customInfoMap,
    metadataMap
  });

  return normalizePaperPdfMetadata({
    title: firstNonEmpty([
      readValue(metadataMap, ['dc:title', 'citation_title', 'prism:title', 'title']),
      readValue(customInfoMap, ['title']),
      info.Title
    ]),
    author: firstNonEmpty([
      readValue(metadataMap, ['dc:creator', 'citation_author', 'author', 'dc:contributor']),
      readValue(customInfoMap, ['author', 'authors']),
      info.Author
    ]),
    year: firstNonEmpty([
      readValue(metadataMap, ['prism:publicationdate', 'prism:coverdate', 'citation_publication_date', 'dc:date']),
      readValue(customInfoMap, ['year', 'publicationdate', 'date']),
      info.CreationDate,
      info.ModDate
    ]),
    journal: firstNonEmpty([
      readValue(metadataMap, ['prism:publicationname', 'citation_journal_title', 'journal', 'prism:publication']),
      readValue(customInfoMap, ['journal', 'publicationname', 'container-title'])
    ]),
    doi: firstNonEmpty([
      extractDoi(readValue(metadataMap, ['prism:doi', 'citation_doi', 'doi', 'dc:identifier', 'dc:source'])),
      extractDoi(readValue(customInfoMap, ['doi', 'dc:identifier', 'identifier'])),
      ...searchValues.map((value) => extractDoi(value))
    ]),
    url: firstNonEmpty([
      extractUrl(readValue(metadataMap, ['prism:url', 'citation_public_url', 'url', 'dc:identifier', 'dc:source'])),
      extractUrl(readValue(customInfoMap, ['url', 'uri', 'website', 'webstatement'])),
      ...searchValues.map((value) => extractUrl(value))
    ])
  });
}
