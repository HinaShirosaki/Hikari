'use strict';

const { isAgentRequestAbortError } = require('../shared/agent-request-context.js');
const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { buildKeywordStyleLiteratureQuery, extractKeywordPhrases } = require('../shared/agent-literature-query-utils.js');
const {
  prependPreferredValue,
  prioritizePreferredWebSource
} = require('../shared/agent-search-source-preferences.js');

const LITERATURE_SOURCES = Object.freeze({
  AUTO: 'auto',
  WEB: 'web',
  PUBMED: 'pubmed',
  CROSSREF: 'crossref',
  UNIPROT: 'uniprot',
  EUROPE_PMC: 'europe_pmc'
});

const LITERATURE_SOURCE_ORDER = Object.freeze([
  LITERATURE_SOURCES.PUBMED,
  LITERATURE_SOURCES.EUROPE_PMC,
  LITERATURE_SOURCES.CROSSREF,
  LITERATURE_SOURCES.UNIPROT,
  LITERATURE_SOURCES.WEB
]);

// Sources whose native query syntax can honor a journal filter. Others
// (UniProt, web) cannot, so they are excluded from a journal-scoped pass to
// avoid leaking unfiltered hits and to keep the "empty -> relax" retry correct.
const JOURNAL_FILTERABLE_SOURCES = Object.freeze(new Set([
  LITERATURE_SOURCES.PUBMED,
  LITERATURE_SOURCES.EUROPE_PMC,
  LITERATURE_SOURCES.CROSSREF
]));

const SOURCE_LABELS = Object.freeze({
  [LITERATURE_SOURCES.WEB]: 'web',
  [LITERATURE_SOURCES.PUBMED]: 'PubMed',
  [LITERATURE_SOURCES.CROSSREF]: 'Crossref',
  [LITERATURE_SOURCES.UNIPROT]: 'UniProt',
  [LITERATURE_SOURCES.EUROPE_PMC]: 'Europe PMC'
});

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function toFiniteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clampInteger(value, fallback, min, max) {
  const parsed = toFiniteInteger(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

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

function extractSourceDomain(url) {
  const normalized = safeUrl(url);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeSource(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized || normalized === LITERATURE_SOURCES.AUTO) {
    return LITERATURE_SOURCES.AUTO;
  }
  if (normalized === 'europepmc' || normalized === 'europe_pmc' || normalized === 'european_pmc') {
    return LITERATURE_SOURCES.EUROPE_PMC;
  }
  if (normalized === 'cross_ref' || normalized === 'doi') {
    return LITERATURE_SOURCES.CROSSREF;
  }
  if (normalized === 'uni_prot' || normalized === 'protein') {
    return LITERATURE_SOURCES.UNIPROT;
  }
  if (normalized === 'pub_med' || normalized === 'pmid') {
    return LITERATURE_SOURCES.PUBMED;
  }
  if (normalized === 'websearch' || normalized === 'search_web' || normalized === 'generic_web') {
    return LITERATURE_SOURCES.WEB;
  }
  return Object.values(LITERATURE_SOURCES).includes(normalized) ? normalized : '';
}

function buildDateFromParts(rawParts) {
  const parts = Array.isArray(rawParts) ? rawParts : [];
  const year = Number(parts[0]);
  const month = Number(parts[1] || 1);
  const day = Number(parts[2] || 1);
  if (!Number.isFinite(year) || year < 1000) {
    return '';
  }
  const safeMonth = Math.max(1, Math.min(12, month));
  const safeDay = Math.max(1, Math.min(31, day));
  const monthText = String(safeMonth).padStart(2, '0');
  const dayText = String(safeDay).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function parseDateToTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }
  if (/^\d{4}$/.test(text)) {
    return Date.parse(`${text}-01-01`) || 0;
  }
  if (/^\d{4}-\d{2}$/.test(text)) {
    return Date.parse(`${text}-01`) || 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildUniProtUrl(accession) {
  const normalized = String(accession || '').trim();
  return normalized ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(normalized)}` : '';
}

function buildPubMedUrl(pmid) {
  const normalized = String(pmid || '').trim();
  return normalized ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(normalized)}/` : '';
}

function buildEuropePmcUrl({ pmcid, pmid, doi, id } = {}) {
  if (String(pmcid || '').trim()) {
    return `https://europepmc.org/article/PMC/${encodeURIComponent(String(pmcid).trim())}`;
  }
  if (String(pmid || '').trim()) {
    return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(String(pmid).trim())}/`;
  }
  if (String(doi || '').trim()) {
    return `https://doi.org/${encodeURIComponent(String(doi).trim())}`;
  }
  if (String(id || '').trim()) {
    return `https://europepmc.org/article/MED/${encodeURIComponent(String(id).trim())}`;
  }
  return '';
}

function buildCrossrefUrl(doi, fallbackUrl = '') {
  const normalizedDoi = String(doi || '').trim();
  if (normalizedDoi) {
    return `https://doi.org/${encodeURIComponent(normalizedDoi)}`;
  }
  return safeUrl(fallbackUrl);
}

function createLiteratureSearchRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestWebSearch
  } = createAgentLlmRuntimeHelpers(deps);
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const searchWebResultsOverride = typeof deps.searchWebResults === 'function' ? deps.searchWebResults : null;
  const searchPubMedRecordsOverride = typeof deps.searchPubMedRecords === 'function' ? deps.searchPubMedRecords : null;
  const searchCrossrefRecordsOverride = typeof deps.searchCrossrefRecords === 'function' ? deps.searchCrossrefRecords : null;
  const searchUniProtRecordsOverride = typeof deps.searchUniProtRecords === 'function' ? deps.searchUniProtRecords : null;
  const searchEuropePmcRecordsOverride = typeof deps.searchEuropePmcRecords === 'function' ? deps.searchEuropePmcRecords : null;
  const webSearchRuntime = deps.webSearchRuntime && typeof deps.webSearchRuntime === 'object'
    ? deps.webSearchRuntime
    : null;
  const paperContextLoaderRuntime = deps.paperContextLoaderRuntime && typeof deps.paperContextLoaderRuntime === 'object'
    ? deps.paperContextLoaderRuntime
    : null;

  function requireFetch(sourceName) {
    if (!fetchImpl) {
      throw new Error(`${sourceName} search requires fetch support.`);
    }
    return fetchImpl;
  }

  async function readResponseText(response) {
    if (typeof response?.text === 'function') {
      return String(await response.text());
    }
    if (typeof response?.json === 'function') {
      return JSON.stringify(await response.json());
    }
    return '';
  }

  async function fetchJson(url, options = {}) {
    const response = await requireFetch('Literature')(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Literature request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    if (typeof response?.json === 'function') {
      return response.json();
    }
    const text = await readResponseText(response);
    return JSON.parse(String(text || '{}'));
  }

  function normalizeQueryTerms(input = {}) {
    return uniqueStrings(extractKeywordPhrases(buildLiteratureQuery(input), 50), 50);
  }

  /**
   * Resolve an explicit, hard journal filter from the request. Only the
   * `journals` / `journal_filter` fields are treated as a restriction; the
   * settings-level `preferred_journal` stays a soft re-rank handled by the
   * workflow, so this never silently narrows a search the user did not scope.
   * Returns a deduped list of journal names (max 6), quotes stripped so they
   * can be embedded in provider query syntax.
   */
  function resolveJournalFilter(input = {}) {
    const source = ensureObject(input);
    const raw = source.journals
      ?? source.journal_filter
      ?? source.journalFilter;
    let list = [];
    if (Array.isArray(raw)) {
      list = raw;
    } else if (typeof raw === 'string') {
      list = raw.split(/[;,\n]/);
    }
    return uniqueStrings(
      list.map((value) => cleanText(value, 180).replace(/"/g, '').trim()).filter(Boolean),
      6
    );
  }

  function buildJournalScopedTerm(sourceName, query, journals = []) {
    if (!journals.length) {
      return query;
    }
    if (sourceName === LITERATURE_SOURCES.PUBMED) {
      return `${query} AND (${journals.map((journal) => `"${journal}"[Journal]`).join(' OR ')})`;
    }
    if (sourceName === LITERATURE_SOURCES.EUROPE_PMC) {
      return `${query} AND (${journals.map((journal) => `JOURNAL:"${journal}"`).join(' OR ')})`;
    }
    // Crossref scopes via a separate URL parameter; UniProt and web do not
    // support journal scoping, so the query is returned unchanged.
    return query;
  }

  function buildLiteratureQuery(input = {}) {
    return cleanText(buildKeywordStyleLiteratureQuery(input, {
      maxLength: 600
    }), 600);
  }

  function queryLooksProteinFocused(query, input = {}) {
    const text = cleanText(query, 600).toLowerCase();
    const parserPayload = ensureObject(input.parser_payload || input.parserPayload);
    const entities = ensureObject(parserPayload.entities);
    if (cleanText(input.protein_name || input.proteinName || entities.protein_name, 180)) {
      return true;
    }
    return /\b(uniprot|protein|gene|receptor|kinase|enzyme|antibody|nanobody|accession)\b/i.test(text);
  }

  function resolveLiteratureSources(input = {}) {
    const source = ensureObject(input);
    const explicitSources = uniqueStrings(asArray(source.sources).map((item) => normalizeSource(item)).filter(Boolean), 8)
      .filter((item) => item !== LITERATURE_SOURCES.AUTO);
    if (explicitSources.length) {
      return explicitSources;
    }

    const explicitSource = normalizeSource(source.source);
    if (explicitSource && explicitSource !== LITERATURE_SOURCES.AUTO) {
      return [explicitSource];
    }

    const query = buildLiteratureQuery(source);
    const preferredSource = normalizeSource(
      source.preferred_literature_source
      || source.preferredLiteratureSource
    );
    const defaults = [
      LITERATURE_SOURCES.PUBMED,
      LITERATURE_SOURCES.EUROPE_PMC,
      LITERATURE_SOURCES.CROSSREF
    ];
    if (queryLooksProteinFocused(query, source)) {
      defaults.unshift(LITERATURE_SOURCES.UNIPROT);
    }
    return prependPreferredValue(uniqueStrings(defaults, 8), preferredSource)
      .filter((item) => item !== LITERATURE_SOURCES.AUTO)
      .slice(0, 8);
  }

  function normalizeAuthorList(value) {
    return uniqueStrings(
      asArray(value).map((author) => {
        if (typeof author === 'string') {
          return cleanText(author, 160);
        }
        const source = ensureObject(author);
        return cleanText(
          [
            cleanText(source.name, 120),
            cleanText(source.given, 80),
            cleanText(source.family, 80)
          ].filter(Boolean).join(' ').trim(),
          160
        );
      }),
      12
    );
  }

  function normalizeResultItem(sourceName, raw = {}) {
    const item = ensureObject(raw);
    const title = cleanText(item.title, 320)
      || cleanText(item.protein_name, 320)
      || cleanText(item.accession, 120)
      || cleanText(item.id, 120);
    const summary = cleanText(item.summary || item.snippet || item.abstract || item.description, 900);
    const url = safeUrl(item.url);
    return {
      source: sourceName,
      id: cleanText(item.id, 120) || cleanText(item.pmid, 120) || cleanText(item.pmcid, 120) || cleanText(item.doi, 160) || cleanText(item.accession, 120) || url || title,
      title,
      summary,
      snippet: summary,
      url,
      doi: cleanText(item.doi, 160),
      pmid: cleanText(item.pmid, 120),
      pmcid: cleanText(item.pmcid, 120),
      accession: cleanText(item.accession, 120),
      entry_id: cleanText(item.entry_id, 120),
      journal: cleanText(item.journal, 220),
      published_at: cleanText(item.published_at, 80),
      authors: normalizeAuthorList(item.authors),
      source_domain: cleanText(item.source_domain, 120).toLowerCase() || extractSourceDomain(url),
      gene_name: cleanText(item.gene_name, 120),
      organism: cleanText(item.organism, 180),
      protein_name: cleanText(item.protein_name, 220)
    };
  }

  function normalizeResultList(sourceName, rawItems) {
    const list = Array.isArray(rawItems)
      ? rawItems
      : asArray(
        ensureObject(rawItems).results
        || ensureObject(rawItems).items
        || ensureObject(rawItems).search_results
      );
    return list
      .map((item) => normalizeResultItem(sourceName, item))
      .filter((item) => item.title || item.url || item.summary || item.accession);
  }

  function buildResultKey(item = {}) {
    return cleanText(
      item.doi
      || item.pmid
      || item.pmcid
      || item.accession
      || item.url
      || item.title,
      400
    ).toLowerCase();
  }

  function sortAndDedupeResults(items, executedSources = [], limit = 10, preferRecent = true) {
    const sourceOrder = new Map(executedSources.map((source, index) => [source, index]));
    const ranked = asArray(items)
      .map((item, index) => ({ ...item, __index: index }))
      .sort((left, right) => {
        if (preferRecent) {
          const timeLeft = parseDateToTimestamp(left.published_at);
          const timeRight = parseDateToTimestamp(right.published_at);
          if (timeLeft !== timeRight) {
            return timeRight - timeLeft;
          }
        }
        const orderLeft = sourceOrder.has(left.source) ? sourceOrder.get(left.source) : 999;
        const orderRight = sourceOrder.has(right.source) ? sourceOrder.get(right.source) : 999;
        if (orderLeft !== orderRight) {
          return orderLeft - orderRight;
        }
        return left.__index - right.__index;
      });

    const seen = new Set();
    const output = [];
    ranked.forEach((item) => {
      const key = buildResultKey(item);
      if (!key || seen.has(key) || output.length >= limit) {
        return;
      }
      seen.add(key);
      const normalized = { ...item };
      delete normalized.__index;
      output.push(normalized);
    });
    return output;
  }

  function buildCitation(item = {}) {
    const sourceName = cleanText(item.source, 80);
    return {
      source: sourceName === LITERATURE_SOURCES.WEB ? 'web_source' : sourceName,
      pointer: cleanText(item.doi || item.pmid || item.pmcid || item.accession || item.url || item.title, 260),
      reason: `Matched ${SOURCE_LABELS[sourceName] || sourceName || 'literature'} result.`
    };
  }

  async function searchPubMedRecords(query, limit = 5, journals = []) {
    if (searchPubMedRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.PUBMED, await searchPubMedRecordsOverride({ query, limit, journals }));
    }

    const term = buildJournalScopedTerm(LITERATURE_SOURCES.PUBMED, query, journals);
    const idPayload = await fetchJson(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${encodeURIComponent(limit)}&term=${encodeURIComponent(term)}`
    );
    const ids = uniqueStrings(asArray(idPayload?.esearchresult?.idlist), limit);
    if (!ids.length) {
      return [];
    }
    const summaryPayload = await fetchJson(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(ids.join(','))}`
    );
    const resultMap = ensureObject(summaryPayload?.result);
    return ids.map((pmid) => {
      const record = ensureObject(resultMap[pmid]);
      const articleIds = asArray(record.articleids);
      const doi = cleanText(articleIds.find((item) => cleanText(item?.idtype, 40).toLowerCase() === 'doi')?.value, 160);
      const authors = normalizeAuthorList(asArray(record.authors).map((author) => author?.name));
      return normalizeResultItem(LITERATURE_SOURCES.PUBMED, {
        id: cleanText(record.uid, 120) || pmid,
        pmid,
        doi,
        title: cleanText(record.title, 320),
        journal: cleanText(record.fulljournalname || record.source, 220),
        published_at: cleanText(record.pubdate, 80),
        authors,
        url: buildPubMedUrl(pmid),
        summary: [cleanText(record.fulljournalname, 180), cleanText(record.pubdate, 80)].filter(Boolean).join(' | ')
      });
    }).filter((item) => item.title);
  }

  async function searchCrossrefRecords(query, limit = 5, journals = []) {
    if (searchCrossrefRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.CROSSREF, await searchCrossrefRecordsOverride({ query, limit, journals }));
    }

    const journalParam = journals.length
      ? `&query.container-title=${encodeURIComponent(journals.join(' '))}`
      : '';
    const payload = await fetchJson(
      `https://api.crossref.org/works?rows=${encodeURIComponent(limit)}&query.bibliographic=${encodeURIComponent(query)}${journalParam}`
    );
    return asArray(payload?.message?.items).slice(0, limit).map((record) => {
      const source = ensureObject(record);
      const doi = cleanText(source.DOI, 160);
      return normalizeResultItem(LITERATURE_SOURCES.CROSSREF, {
        id: doi || cleanText(source.URL, 260) || cleanText(asArray(source.title)[0], 200),
        doi,
        title: cleanText(asArray(source.title)[0], 320),
        url: buildCrossrefUrl(doi, source.URL),
        journal: cleanText(asArray(source['container-title'])[0], 220),
        published_at: buildDateFromParts(asArray(source.issued?.['date-parts'])[0] || asArray(source.created?.['date-parts'])[0]),
        authors: normalizeAuthorList(asArray(source.author).map((author) => ({
          given: author?.given,
          family: author?.family
        }))),
        summary: stripHtml(source.abstract || '')
      });
    }).filter((item) => item.title || item.url);
  }

  async function searchUniProtRecords(query, limit = 5) {
    if (searchUniProtRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.UNIPROT, await searchUniProtRecordsOverride({ query, limit }));
    }

    const payload = await fetchJson(
      `https://rest.uniprot.org/uniprotkb/search?format=json&size=${encodeURIComponent(limit)}&query=${encodeURIComponent(query)}`
    );
    return asArray(payload?.results).slice(0, limit).map((record) => {
      const source = ensureObject(record);
      const accession = cleanText(source.primaryAccession, 120);
      const proteinName = cleanText(
        source?.proteinDescription?.recommendedName?.fullName?.value
        || source?.proteinDescription?.submissionNames?.[0]?.fullName?.value,
        220
      );
      const geneName = cleanText(source?.genes?.[0]?.geneName?.value, 120);
      const organism = cleanText(source?.organism?.scientificName, 180);
      const length = Number(source?.sequence?.length);
      return normalizeResultItem(LITERATURE_SOURCES.UNIPROT, {
        id: accession || cleanText(source.uniProtkbId, 120),
        accession,
        entry_id: cleanText(source.uniProtkbId, 120),
        title: proteinName || accession,
        protein_name: proteinName,
        gene_name: geneName,
        organism,
        url: buildUniProtUrl(accession),
        summary: [geneName, organism, Number.isFinite(length) && length > 0 ? `${length} aa` : '', cleanText(source.entryType, 120)].filter(Boolean).join(' | ')
      });
    }).filter((item) => item.title || item.accession);
  }

  async function searchEuropePmcRecords(query, limit = 5, journals = []) {
    if (searchEuropePmcRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.EUROPE_PMC, await searchEuropePmcRecordsOverride({ query, limit, journals }));
    }

    const scopedQuery = buildJournalScopedTerm(LITERATURE_SOURCES.EUROPE_PMC, query, journals);
    const payload = await fetchJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${encodeURIComponent(limit)}&query=${encodeURIComponent(scopedQuery)}`
    );
    return asArray(payload?.resultList?.result).slice(0, limit).map((record) => {
      const source = ensureObject(record);
      const doi = cleanText(source.doi, 160);
      const pmid = cleanText(source.pmid, 120);
      const pmcid = cleanText(source.pmcid, 120);
      return normalizeResultItem(LITERATURE_SOURCES.EUROPE_PMC, {
        id: cleanText(source.id, 120) || pmcid || pmid || doi,
        pmid,
        pmcid,
        doi,
        title: cleanText(source.title, 320),
        url: buildEuropePmcUrl({
          pmcid,
          pmid,
          doi,
          id: cleanText(source.id, 120)
        }),
        journal: cleanText(source.journalTitle, 220),
        published_at: cleanText(source.firstPublicationDate || source.pubYear, 80),
        authors: cleanText(source.authorString, 400).split(/\s*,\s*/).map((item) => cleanText(item, 160)).filter(Boolean),
        summary: [cleanText(source.journalTitle, 180), cleanText(source.pubYear, 40)].filter(Boolean).join(' | ')
      });
    }).filter((item) => item.title);
  }

  async function searchWebRecords(query, limit = 5, input = {}) {
    const preferredWebSource = cleanText(
      input?.preferred_web_source || input?.preferredWebSource,
      240
    );

    if (searchWebResultsOverride) {
      return prioritizePreferredWebSource(
        normalizeResultList(LITERATURE_SOURCES.WEB, await searchWebResultsOverride({ query, limit })),
        preferredWebSource,
        (item) => item?.source_domain || item?.url || ''
      );
    }
    if (webSearchRuntime && typeof webSearchRuntime.searchWebResults === 'function') {
      const result = await webSearchRuntime.searchWebResults({
        ...ensureObject(input),
        query,
        limit,
        stage: cleanText(input?.stage, 120) || 'literature_search_web'
      });
      return prioritizePreferredWebSource(
        normalizeResultList(LITERATURE_SOURCES.WEB, result),
        preferredWebSource,
        (item) => item?.source_domain || item?.url || ''
      );
    }
    if (requestWebSearch) {
      const providerSearch = await requestWebSearch({
        stage: 'literature_search_web',
        query,
        maxResults: limit,
        traceContext: input?.traceContext || null
      });
      if (!providerSearch?.ok) {
        throw new Error(cleanText(providerSearch?.error, 600) || 'Web search failed.');
      }
      return prioritizePreferredWebSource(
        normalizeResultList(LITERATURE_SOURCES.WEB, providerSearch),
        preferredWebSource,
        (item) => item?.source_domain || item?.url || ''
      );
    }
    throw new Error('Literature web search requires provider-layer web search support.');
  }

  async function searchSource(sourceName, query, limit, input = {}, journals = []) {
    if (sourceName === LITERATURE_SOURCES.WEB) {
      return searchWebRecords(query, limit, input);
    }
    if (sourceName === LITERATURE_SOURCES.PUBMED) {
      return searchPubMedRecords(query, limit, journals);
    }
    if (sourceName === LITERATURE_SOURCES.CROSSREF) {
      return searchCrossrefRecords(query, limit, journals);
    }
    if (sourceName === LITERATURE_SOURCES.UNIPROT) {
      return searchUniProtRecords(query, limit);
    }
    if (sourceName === LITERATURE_SOURCES.EUROPE_PMC) {
      return searchEuropePmcRecords(query, limit, journals);
    }
    return [];
  }

  async function searchLiteratureCandidates(input = {}) {
    const source = ensureObject(input);
    const query = buildLiteratureQuery(source);
    if (!query) {
      return {
        ok: false,
        status: 'error',
        error: 'Literature search requires query, topic, message, or parser payload.'
      };
    }

    const requestedSource = normalizeSource(source.source);
    const resolvedSources = resolveLiteratureSources({ ...source, query });
    const limit = clampInteger(source.limit, 8, 1, 25);
    const perSourceLimit = clampInteger(source.max_per_source, Math.min(limit, 5), 1, 25);
    const preferRecent = source.prefer_recent !== false;
    const journalFilter = resolveJournalFilter(source);
    const allowUnfilteredFallback = source.allow_unfiltered_fallback !== false
      && source.allowUnfilteredFallback !== false;
    let journalFilterRelaxed = false;
    let executedSources = [];
    let sourceCounts = {};
    let sourceErrors = {};
    let results = [];

    async function runResolvedSources(journals) {
      const execed = [];
      const counts = {};
      const errors = {};
      const collected = [];
      // When a hard journal filter is active, only query sources that can honor
      // it; UniProt/web would otherwise return journal-blind hits that both leak
      // into the "filtered" result and suppress the unfiltered retry.
      const sourcesToRun = journals.length
        ? resolvedSources.filter((sourceName) => JOURNAL_FILTERABLE_SOURCES.has(sourceName))
        : resolvedSources;
      for (const sourceName of sourcesToRun) {
        execed.push(sourceName);
        try {
          const items = await searchSource(sourceName, query, Math.min(perSourceLimit, limit), source, journals);
          counts[sourceName] = items.length;
          collected.push(...items);
        } catch (error) {
          if (isAgentRequestAbortError(error)) {
            throw error;
          }
          counts[sourceName] = 0;
          errors[sourceName] = cleanText(error?.message, 600) || `${SOURCE_LABELS[sourceName] || sourceName} search failed.`;
        }
      }
      return { execed, counts, errors, collected };
    }

    let run = await runResolvedSources(journalFilter);
    executedSources = run.execed;
    sourceCounts = run.counts;
    sourceErrors = run.errors;
    results = run.collected;

    // A strict journal filter that matched nothing degrades to an unfiltered
    // search (then the workflow's soft journal re-rank still applies), unless
    // the caller forbids it. This avoids handing back zero results purely
    // because the scoped-journal syntax was too narrow for a provider.
    if (journalFilter.length && results.length === 0 && allowUnfilteredFallback) {
      journalFilterRelaxed = true;
      run = await runResolvedSources([]);
      executedSources = run.execed;
      sourceCounts = run.counts;
      sourceErrors = run.errors;
      results = run.collected;
    }

    const shouldTryWebFallback = requestedSource !== LITERATURE_SOURCES.WEB
      && !resolvedSources.includes(LITERATURE_SOURCES.WEB)
      && source.allow_web_fallback !== false
      && results.length === 0;

    if (shouldTryWebFallback) {
      executedSources.push(LITERATURE_SOURCES.WEB);
      try {
        const webItems = await searchWebRecords(query, limit, source);
        sourceCounts[LITERATURE_SOURCES.WEB] = webItems.length;
        results.push(...webItems);
      } catch (error) {
        if (isAgentRequestAbortError(error)) {
          throw error;
        }
        sourceCounts[LITERATURE_SOURCES.WEB] = 0;
        sourceErrors[LITERATURE_SOURCES.WEB] = cleanText(error?.message, 600) || 'Web search failed.';
      }
    }

    const items = sortAndDedupeResults(results, executedSources, limit, preferRecent);
    const citations = items.map((item) => buildCitation(item)).filter((item) => item.pointer);
    const sourceSummary = executedSources.map((sourceName) => {
      const count = toFiniteInteger(sourceCounts[sourceName], 0);
      return `${SOURCE_LABELS[sourceName] || sourceName}: ${count}`;
    }).join(', ');

    return {
      ok: true,
      status: 'completed',
      query,
      sources: executedSources,
      items,
      citations,
      loaded_context_blocks: [],
      papers_read_count: 0,
      source_counts: cloneJson(sourceCounts, {}),
      source_errors: cloneJson(sourceErrors, {}),
      journal_filter: journalFilter,
      journal_filter_relaxed: journalFilterRelaxed,
      summary: [
        items.length
          ? `Found ${items.length} literature result${items.length === 1 ? '' : 's'} (${sourceSummary}).`
          : `No literature results found (${sourceSummary || 'no sources executed'}).`,
        journalFilter.length
          ? (journalFilterRelaxed
            ? `Journal filter [${journalFilter.join(', ')}] matched nothing; relaxed to an unfiltered search.`
            : `Restricted to journal(s): ${journalFilter.join(', ')}.`)
          : ''
      ].filter(Boolean).join(' ')
    };
  }

  async function searchLiterature(input = {}) {
    const candidateResult = await searchLiteratureCandidates(input);
    if (!candidateResult?.ok) {
      return candidateResult;
    }

    const source = ensureObject(input);
    const query = cleanText(candidateResult.query || buildLiteratureQuery(source), 600);
    let loadedContextBlocks = [];
    let paperContextSummary = '';
    let papersReadCount = 0;
    const items = asArray(candidateResult.items);

    if (paperContextLoaderRuntime && typeof paperContextLoaderRuntime.loadPaperContexts === 'function' && items.length) {
      try {
        const paperContextResult = await paperContextLoaderRuntime.loadPaperContexts({
          provider: cleanText(source.provider, 80),
          endpoint: cleanText(source.endpoint, 2000),
          apiKey: cleanText(source.apiKey, 400),
          model: cleanText(source.model, 120),
          traceContext: source.traceContext || null,
          message: cleanText(source.message, 1600),
          topic: cleanText(source.topic, 240),
          query,
          max_papers: clampInteger(source.max_papers, 8, 1, 8),
          figure_policy: cleanText(source.figure_policy, 40) || 'when_needed',
          items
        });
        loadedContextBlocks = asArray(paperContextResult?.loaded_context_blocks)
          .map((block) => ({
            paper_id: cleanText(block?.paper_id, 120),
            paper_title: cleanText(block?.paper_title, 320),
            section_label: cleanText(block?.section_label, 160),
            excerpt: cleanText(block?.excerpt, 1800),
            relevance_reason: cleanText(block?.relevance_reason, 260),
            source: cleanText(block?.source, 80),
            evidence_kind: cleanText(block?.evidence_kind, 40)
          }))
          .filter((block) => block.paper_id && block.excerpt);
        papersReadCount = toFiniteInteger(paperContextResult?.papers_read_count, 0);
        paperContextSummary = cleanText(paperContextResult?.summary, 320);
      } catch (error) {
        paperContextSummary = cleanText(error?.message, 320) || 'Paper context loading failed.';
      }
    }

    return {
      ...candidateResult,
      loaded_context_blocks: loadedContextBlocks,
      papers_read_count: papersReadCount,
      summary: cleanText(candidateResult.summary, 500)
        ? `${cleanText(candidateResult.summary, 500)}${paperContextSummary ? ` ${paperContextSummary}` : ''}`
        : (paperContextSummary || 'No literature results found.')
    };
  }

  return {
    LITERATURE_SOURCES,
    LITERATURE_SOURCE_ORDER,
    buildLiteratureQuery,
    resolveLiteratureSources,
    searchPubMedRecords,
    searchCrossrefRecords,
    searchUniProtRecords,
    searchEuropePmcRecords,
    searchWebRecords,
    searchLiteratureCandidates,
    searchLiterature,
    execute: searchLiterature
  };
}

module.exports = {
  LITERATURE_SOURCES,
  LITERATURE_SOURCE_ORDER,
  createLiteratureSearchRuntime
};
