'use strict';

const { buildKeywordStyleLiteratureQuery } = require('../agent-literature-query-utils.js');
const { normalizePaperDoi } = require('../literature-candidates.js');
const { prependPreferredValue } = require('../agent-search-source-preferences.js');
const { ensureObject } = require('../../../lib/normalize.js');
const { LITERATURE_SOURCES, SOURCE_LABELS } = require('./constants.js');
const {
  buildCrossrefUrl,
  extractSourceDomain,
  normalizeSource,
  parseDateToTimestamp,
  safeUrl
} = require('./source-urls.js');

// Query shaping and result normalization share the runtime's text helpers, so
// they are built per runtime rather than imported as free functions.
function createQueryAndResultHelpers({ asArray, cleanText, uniqueStrings } = {}) {
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
    const preferredSource = normalizeSource(
      source.preferred_literature_source
      || source.preferredLiteratureSource
    );
    const explicitSources = uniqueStrings(asArray(source.sources).map((item) => normalizeSource(item)).filter(Boolean), 8)
      .filter((item) => item !== LITERATURE_SOURCES.AUTO);
    if (explicitSources.length) {
      return preferredSource && explicitSources.includes(preferredSource)
        ? prependPreferredValue(explicitSources, preferredSource)
        : explicitSources;
    }

    const explicitSource = normalizeSource(source.source);
    if (explicitSource && explicitSource !== LITERATURE_SOURCES.AUTO) {
      return [explicitSource];
    }

    const query = buildLiteratureQuery(source);
    const defaults = [
      LITERATURE_SOURCES.PUBMED,
      LITERATURE_SOURCES.EUROPE_PMC,
      LITERATURE_SOURCES.CROSSREF
    ];
    if (queryLooksProteinFocused(query, source)) {
      defaults.unshift(LITERATURE_SOURCES.UNIPROT);
    }
    return prependPreferredValue(uniqueStrings([...defaults, LITERATURE_SOURCES.WEB], 8), preferredSource)
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
    const doi = normalizePaperDoi(cleanText(item.doi, 160));
    const title = cleanText(item.title, 320)
      || cleanText(item.protein_name, 320)
      || cleanText(item.accession, 120)
      || cleanText(item.id, 120);
    const summary = cleanText(item.summary || item.snippet || item.abstract || item.description, 900);
    const rawUrl = safeUrl(item.url);
    const url = doi && /^https?:\/\/(?:dx\.)?doi\.org\//i.test(rawUrl)
      ? buildCrossrefUrl(doi)
      : rawUrl;
    return {
      source: sourceName,
      id: cleanText(item.id, 120) || cleanText(item.pmid, 120) || cleanText(item.pmcid, 120) || cleanText(item.doi, 160) || cleanText(item.accession, 120) || url || title,
      title,
      summary,
      snippet: summary,
      url,
      doi,
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
      normalizePaperDoi(item.doi)
      || item.pmid
      || item.pmcid
      || item.accession
      || item.url
      || item.title,
      400
    ).toLowerCase();
  }

  function sortAndDedupeResults(items, executedSources = [], limit = 0, preferRecent = true) {
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
      if (!key || seen.has(key) || (limit > 0 && output.length >= limit)) {
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

  return {
    resolveJournalFilter,
    buildJournalScopedTerm,
    buildLiteratureQuery,
    queryLooksProteinFocused,
    resolveLiteratureSources,
    normalizeAuthorList,
    normalizeResultItem,
    normalizeResultList,
    buildResultKey,
    sortAndDedupeResults,
    buildCitation
  };
}

module.exports = { createQueryAndResultHelpers };
