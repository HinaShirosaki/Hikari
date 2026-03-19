'use strict';

const EXTERNAL_BIO_API_TIMEOUT_MS = 15000;
const EXTERNAL_BIO_API_USER_AGENT = 'Enana-Agent/1.0';

function defaultCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function defaultClamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function createExternalBioSearchHelpers(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const clamp = typeof deps.clamp === 'function' ? deps.clamp : defaultClamp;

  function buildUrlWithParams(baseUrl, params = {}) {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      const text = String(value).trim();
      if (!text) {
        return;
      }
      url.searchParams.set(key, text);
    });
    return url.toString();
  }

  async function fetchExternalJson(url, options = {}) {
    const timeoutMs = clamp(Number(options.timeoutMs) || EXTERNAL_BIO_API_TIMEOUT_MS, 1000, 30000);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      'User-Agent': EXTERNAL_BIO_API_USER_AGENT,
      Accept: 'application/json',
      ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
    };
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      const reason = error?.name === 'AbortError'
        ? `Request timed out after ${timeoutMs}ms`
        : String(error?.message || error);
      throw new Error(reason);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function formatDateParts(parts) {
    if (!Array.isArray(parts) || parts.length < 3) {
      return '';
    }
    const [year, month, day] = parts.map((value) => Number(value));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return '';
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  function parseUniProtProteinName(entry) {
    const description = entry?.proteinDescription;
    if (!description || typeof description !== 'object') {
      return '';
    }
    const recName = description?.recommendedName?.fullName?.value;
    if (recName) {
      return cleanText(recName, 240);
    }
    const altName = Array.isArray(description?.alternativeNames)
      ? description.alternativeNames[0]?.fullName?.value
      : '';
    return cleanText(altName, 240);
  }

  function parsePubMedDoi(summary) {
    const ids = Array.isArray(summary?.articleids) ? summary.articleids : [];
    const doiEntry = ids.find((item) => String(item?.idtype || '').toLowerCase() === 'doi');
    return cleanText(doiEntry?.value, 220);
  }

  function parseCrossrefPublishedDate(item) {
    const parts = item?.issued?.['date-parts'];
    if (!Array.isArray(parts) || !parts.length) {
      return '';
    }
    return formatDateParts(parts[0]);
  }

  async function searchUniProtRecords(query, limit) {
    const capped = clamp(Number(limit) || 6, 1, 25);
    const url = buildUrlWithParams('https://rest.uniprot.org/uniprotkb/search', {
      query,
      format: 'json',
      fields: 'accession,id,protein_name,gene_names,organism_name,length,annotation_score',
      size: capped
    });
    const payload = await fetchExternalJson(url);
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    return rows.slice(0, capped).map((entry) => ({
      accession: cleanText(entry?.primaryAccession, 80),
      entry_id: cleanText(entry?.uniProtkbId, 120),
      protein_name: parseUniProtProteinName(entry),
      gene_names: cleanText(
        Array.isArray(entry?.genes)
          ? entry.genes
            .map((gene) => gene?.geneName?.value)
            .filter(Boolean)
            .join(', ')
          : '',
        220
      ),
      organism: cleanText(entry?.organism?.scientificName, 160),
      length: Number(entry?.sequence?.length) || null,
      annotation_score: Number.isFinite(Number(entry?.annotationScore))
        ? Number(entry.annotationScore)
        : null
    }));
  }

  async function searchPubMedRecords(query, limit) {
    const capped = clamp(Number(limit) || 6, 1, 25);
    const searchUrl = buildUrlWithParams('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      db: 'pubmed',
      retmode: 'json',
      retmax: capped,
      term: query
    });
    const searchPayload = await fetchExternalJson(searchUrl);
    const pmids = Array.isArray(searchPayload?.esearchresult?.idlist)
      ? searchPayload.esearchresult.idlist.slice(0, capped)
      : [];
    if (!pmids.length) {
      return [];
    }
    const summaryUrl = buildUrlWithParams('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
      db: 'pubmed',
      retmode: 'json',
      id: pmids.join(',')
    });
    const summaryPayload = await fetchExternalJson(summaryUrl);
    const resultMap = summaryPayload?.result && typeof summaryPayload.result === 'object'
      ? summaryPayload.result
      : {};
    return pmids.map((pmid) => {
      const summary = resultMap[pmid] || {};
      return {
        pmid: cleanText(pmid, 40),
        title: cleanText(summary?.title, 320),
        journal: cleanText(summary?.fulljournalname || summary?.source, 180),
        pubdate: cleanText(summary?.pubdate, 80),
        doi: parsePubMedDoi(summary),
        authors: Array.isArray(summary?.authors)
          ? summary.authors.map((author) => cleanText(author?.name, 120)).filter(Boolean).slice(0, 12)
          : []
      };
    }).filter((item) => item.pmid || item.title);
  }

  async function searchCrossrefRecords(query, limit) {
    const capped = clamp(Number(limit) || 6, 1, 25);
    const url = buildUrlWithParams('https://api.crossref.org/works', {
      query,
      rows: capped,
      select: 'DOI,title,URL,publisher,issued,author,container-title'
    });
    const payload = await fetchExternalJson(url, {
      headers: {
        Accept: 'application/json'
      }
    });
    const rows = Array.isArray(payload?.message?.items) ? payload.message.items : [];
    return rows.slice(0, capped).map((item) => ({
      doi: cleanText(item?.DOI, 220),
      title: cleanText(Array.isArray(item?.title) ? item.title[0] : '', 320),
      journal: cleanText(Array.isArray(item?.['container-title']) ? item['container-title'][0] : '', 180),
      publisher: cleanText(item?.publisher, 180),
      published_at: parseCrossrefPublishedDate(item),
      url: cleanText(item?.URL, 1800),
      authors: Array.isArray(item?.author)
        ? item.author
          .map((author) => cleanText([author?.given, author?.family].filter(Boolean).join(' '), 120))
          .filter(Boolean)
          .slice(0, 12)
        : []
    })).filter((row) => row.doi || row.title || row.url);
  }

  async function searchEuropePmcRecords(query, limit) {
    const capped = clamp(Number(limit) || 6, 1, 25);
    const url = buildUrlWithParams('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
      query,
      format: 'json',
      pageSize: capped,
      sort: 'relevance'
    });
    const payload = await fetchExternalJson(url);
    const rows = Array.isArray(payload?.resultList?.result) ? payload.resultList.result : [];
    return rows.slice(0, capped).map((item) => ({
      id: cleanText(item?.id, 60),
      pmid: cleanText(item?.pmid, 40),
      pmcid: cleanText(item?.pmcid, 60),
      doi: cleanText(item?.doi, 220),
      title: cleanText(item?.title, 320),
      journal: cleanText(item?.journalTitle, 180),
      published_at: cleanText(item?.firstPublicationDate || item?.pubYear, 80),
      authors: cleanText(item?.authorString, 320),
      source: cleanText(item?.source, 60),
      url: cleanText(item?.fullTextUrlList?.fullTextUrl?.[0]?.url, 1800)
    })).filter((row) => row.id || row.pmid || row.title);
  }

  return {
    searchUniProtRecords,
    searchPubMedRecords,
    searchCrossrefRecords,
    searchEuropePmcRecords
  };
}

module.exports = {
  createExternalBioSearchHelpers
};
