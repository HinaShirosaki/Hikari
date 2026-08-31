'use strict';

const { Buffer } = require('node:buffer');
const fsPromises = require('node:fs/promises');

const {
  ensureObject,
  stripHtml,
  safeUrl,
  splitMarkdownIntoSections
} = require('../paper-context-text.js');

// Every remote paper source (Europe PMC, PubMed, Crossref) plus the local
// markdown reader. fetch is injected so the runtime owns transport policy.
function createPaperContextSourceFetchers({
  fetchImpl,
  cleanText,
  asArray,
  uniqueStrings,
  parseEuropePmcFullTextSections,
  parsePubMedAbstractSections,
  parseEuropePmcMetadata
} = {}) {
  function requireFetch() {
    if (!fetchImpl) {
      throw new Error('Paper context loading requires fetch support.');
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
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper context request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    if (typeof response?.json === 'function') {
      return response.json();
    }
    const raw = await readResponseText(response);
    return JSON.parse(String(raw || '{}'));
  }

  async function fetchText(url, options = {}) {
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper context request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    return readResponseText(response);
  }

  async function fetchBuffer(url, options = {}) {
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper PDF request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    if (typeof response?.arrayBuffer === 'function') {
      return Buffer.from(await response.arrayBuffer());
    }
    const raw = await readResponseText(response);
    return Buffer.from(String(raw || ''), 'utf8');
  }


  function normalizePaperItem(item = {}) {
    const source = ensureObject(item);
    const paperId = cleanText(
      source.paper_id || source.id || source.pmid || source.pmcid || source.doi || source.url || source.title,
      220
    );
    return {
      paper_id: paperId,
      paper_title: cleanText(source.title || source.paper_title, 320) || paperId || 'Untitled paper',
      summary: cleanText(source.summary || source.snippet, 12000),
      url: safeUrl(source.url),
      doi: cleanText(source.doi, 180),
      pmid: cleanText(source.pmid, 120),
      pmcid: cleanText(source.pmcid, 120),
      source: cleanText(source.source, 80),
      markdown_path: cleanText(
        source.markdown_path
        || source.knowledge_markdown_path
        || source.knowledge_markdown_file_path,
        4000
      ),
      pdf_urls: uniqueStrings(asArray(source.pdf_urls).map((entry) => safeUrl(entry)).filter(Boolean), 8)
    };
  }

  /**
   * Read a previously-ingested paper.md from disk and split it into sections.
   * This is the canonical reuse path: a paper already in the knowledge database
   * loads its saved full-paper markdown instead of falling back to an abstract.
   * Returns [] when no path is given or the file cannot be read.
   */
  async function readLocalMarkdownSections(markdownPath) {
    const normalizedPath = cleanText(markdownPath, 4000);
    if (!normalizedPath) {
      return [];
    }
    try {
      const markdown = await fsPromises.readFile(normalizedPath, 'utf8');
      return splitMarkdownIntoSections(markdown)
        .map((section) => ({ label: cleanText(section.label, 160), text: cleanText(section.text, 12000) }))
        .filter((section) => section.text);
    } catch {
      return [];
    }
  }

  async function fetchEuropePmcArticle(sourceName, identifier) {
    const source = cleanText(sourceName, 20).toUpperCase();
    const id = cleanText(identifier, 240);
    if (!source || !id) {
      return {};
    }
    return fetchJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}?format=json`
    );
  }

  async function fetchEuropePmcMetadataForItem(item = {}) {
    const normalized = normalizePaperItem(item);
    try {
      if (normalized.pmcid) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('PMC', normalized.pmcid));
      }
      if (normalized.pmid) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('MED', normalized.pmid));
      }
      if (normalized.doi) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('DOI', normalized.doi));
      }
    } catch {
      return {};
    }
    return {};
  }

  async function fetchEuropePmcFullTextByPmcid(pmcid) {
    const normalized = cleanText(pmcid, 120);
    if (!normalized) {
      return [];
    }
    try {
      const xml = await fetchText(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(normalized)}/fullTextXML`
      );
      return parseEuropePmcFullTextSections(xml);
    } catch {
      return [];
    }
  }

  async function fetchPubMedAbstractByPmid(pmid) {
    const normalized = cleanText(pmid, 120);
    if (!normalized) {
      return [];
    }
    try {
      const xml = await fetchText(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${encodeURIComponent(normalized)}`
      );
      return parsePubMedAbstractSections(xml);
    } catch {
      return [];
    }
  }

  async function fetchCrossrefAbstractByDoi(doi) {
    const normalized = cleanText(doi, 180);
    if (!normalized) {
      return [];
    }
    try {
      const payload = await fetchJson(
        `https://api.crossref.org/works/${encodeURIComponent(normalized)}`
      );
      const abstractText = cleanText(stripHtml(payload?.message?.abstract || ''), 12000);
      return abstractText
        ? [{ label: 'Abstract', text: abstractText }]
        : [];
    } catch {
      return [];
    }
  }

  return {
    requireFetch,
    readResponseText,
    fetchJson,
    fetchText,
    fetchBuffer,
    normalizePaperItem,
    readLocalMarkdownSections,
    fetchEuropePmcArticle,
    fetchEuropePmcMetadataForItem,
    fetchEuropePmcFullTextByPmcid,
    fetchPubMedAbstractByPmid,
    fetchCrossrefAbstractByDoi
  };
}

module.exports = { createPaperContextSourceFetchers };
