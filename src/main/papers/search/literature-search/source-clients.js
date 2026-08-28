'use strict';

const { normalizePaperDoi } = require('../literature-candidates.js');
const { prioritizePreferredWebSource } = require('../agent-search-source-preferences.js');
const { ensureObject } = require('../../../lib/normalize.js');
const { LITERATURE_SOURCES } = require('./constants.js');
const {
  buildCrossrefUrl,
  buildDateFromParts,
  buildEuropePmcUrl,
  buildPubMedUrl,
  buildUniProtUrl,
  stripHtml
} = require('./source-urls.js');

// One client per literature provider. Every network call and test override is
// injected so the runtime stays the only place that knows about fetch.
function createSourceClients({
  asArray,
  cleanText,
  requestWebSearch,
  fetchJson,
  webSearchRuntime,
  searchWebResultsOverride,
  searchPubMedRecordsOverride,
  searchCrossrefRecordsOverride,
  searchUniProtRecordsOverride,
  searchEuropePmcRecordsOverride,
  buildJournalScopedTerm,
  normalizeAuthorList,
  normalizeResultItem,
  normalizeResultList
} = {}) {
  async function searchPubMedRecords(query, limit = 0, journals = []) {
    if (searchPubMedRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.PUBMED, await searchPubMedRecordsOverride({ query, limit, journals }));
    }

    const term = buildJournalScopedTerm(LITERATURE_SOURCES.PUBMED, query, journals);
    const retmaxParam = limit > 0 ? `&retmax=${encodeURIComponent(limit)}` : '';
    const idPayload = await fetchJson(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json${retmaxParam}&term=${encodeURIComponent(term)}`
    );
    const ids = [...new Set(
      asArray(idPayload?.esearchresult?.idlist)
        .map((id) => cleanText(id, 120))
        .filter(Boolean)
    )];
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
      const doi = normalizePaperDoi(
        cleanText(articleIds.find((item) => cleanText(item?.idtype, 40).toLowerCase() === 'doi')?.value, 160)
      );
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

  async function searchCrossrefRecords(query, limit = 0, journals = []) {
    if (searchCrossrefRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.CROSSREF, await searchCrossrefRecordsOverride({ query, limit, journals }));
    }

    const journalParam = journals.length
      ? `&query.container-title=${encodeURIComponent(journals.join(' '))}`
      : '';
    const rowsParam = limit > 0 ? `rows=${encodeURIComponent(limit)}&` : '';
    const payload = await fetchJson(
      `https://api.crossref.org/works?${rowsParam}query.bibliographic=${encodeURIComponent(query)}${journalParam}`
    );
    const records = asArray(payload?.message?.items);
    return (limit > 0 ? records.slice(0, limit) : records).map((record) => {
      const source = ensureObject(record);
      const doi = normalizePaperDoi(cleanText(source.DOI, 160));
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

  async function searchEuropePmcRecords(query, limit = 0, journals = []) {
    if (searchEuropePmcRecordsOverride) {
      return normalizeResultList(LITERATURE_SOURCES.EUROPE_PMC, await searchEuropePmcRecordsOverride({ query, limit, journals }));
    }

    const scopedQuery = buildJournalScopedTerm(LITERATURE_SOURCES.EUROPE_PMC, query, journals);
    const pageSizeParam = limit > 0 ? `&pageSize=${encodeURIComponent(limit)}` : '';
    const payload = await fetchJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json${pageSizeParam}&query=${encodeURIComponent(scopedQuery)}`
    );
    const records = asArray(payload?.resultList?.result);
    return (limit > 0 ? records.slice(0, limit) : records).map((record) => {
      const source = ensureObject(record);
      const doi = normalizePaperDoi(cleanText(source.doi, 160));
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

  async function searchWebRecords(query, limit = 0, input = {}) {
    const preferredWebSource = cleanText(
      input?.preferred_web_source || input?.preferredWebSource,
      240
    );

    if (searchWebResultsOverride) {
      return prioritizePreferredWebSource(
        normalizeResultList(LITERATURE_SOURCES.WEB, await searchWebResultsOverride({ query, ...(limit > 0 ? { limit } : {}) })),
        preferredWebSource,
        (item) => item?.source_domain || item?.url || ''
      );
    }
    if (webSearchRuntime && typeof webSearchRuntime.searchWebResults === 'function') {
      const result = await webSearchRuntime.searchWebResults({
        ...ensureObject(input),
        query,
        ...(limit > 0 ? { limit } : {}),
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
        ...(limit > 0 ? { maxResults: limit } : {}),
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

  function shouldDeferWebSearchToCodex(input = {}) {
    const source = ensureObject(input);
    return source.defer_web_search_to_codex === true
      || source.deferWebSearchToCodex === true;
  }

  return {
    searchPubMedRecords,
    searchCrossrefRecords,
    searchUniProtRecords,
    searchEuropePmcRecords,
    searchWebRecords,
    searchSource,
    shouldDeferWebSearchToCodex
  };
}

module.exports = { createSourceClients };
