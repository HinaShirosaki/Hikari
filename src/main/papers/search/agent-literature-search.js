'use strict';

const { isAgentRequestAbortError } = require('../../lib/llm/request-context.js');
const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const {
  LITERATURE_SOURCES,
  LITERATURE_SOURCE_ORDER,
  JOURNAL_FILTERABLE_SOURCES,
  SOURCE_LABELS
} = require('./literature-search/constants.js');
const {
  clampInteger,
  firstPositiveInteger,
  normalizeSource,
  toFiniteInteger
} = require('./literature-search/source-urls.js');
const { createQueryAndResultHelpers } = require('./literature-search/query-and-results.js');
const { createSourceClients } = require('./literature-search/source-clients.js');

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

  const {
    resolveJournalFilter,
    buildJournalScopedTerm,
    buildLiteratureQuery,
    resolveLiteratureSources,
    normalizeAuthorList,
    normalizeResultItem,
    normalizeResultList,
    sortAndDedupeResults,
    buildCitation
  } = createQueryAndResultHelpers({ asArray, cleanText, uniqueStrings });

  const {
    searchPubMedRecords,
    searchCrossrefRecords,
    searchUniProtRecords,
    searchEuropePmcRecords,
    searchWebRecords,
    searchSource,
    shouldDeferWebSearchToCodex
  } = createSourceClients({
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
  });

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
    const limit = firstPositiveInteger([
      source.limit,
      source._internal_limit,
      source.internal_limit,
      source.internalLimit
    ], 0);
    const perSourceLimit = firstPositiveInteger([
      source.max_per_source,
      source.maxPerSource,
      source._internal_max_per_source,
      source.internal_max_per_source,
      source.internalMaxPerSource
    ], limit);
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
        if (sourceName === LITERATURE_SOURCES.WEB && shouldDeferWebSearchToCodex(source)) {
          counts[sourceName] = 0;
          errors[sourceName] = 'Web discovery was deferred to the active Codex agent to avoid starting a nested Codex CLI request inside literature_search.';
          continue;
        }
        try {
          const items = await searchSource(sourceName, query, perSourceLimit, source, journals);
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
          max_papers: clampInteger(firstPositiveInteger([
            source.max_papers,
            source.maxPapers,
            source._internal_max_papers,
            source.internal_max_papers,
            source.internalMaxPapers
          ], 8), 8, 1, 8),
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
