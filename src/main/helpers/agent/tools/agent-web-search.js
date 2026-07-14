'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../lib/llm/runtime-helpers.js');
const { isAgentRequestAbortError } = require('../../../lib/llm/request-context.js');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  const normalized = Number.isInteger(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
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

function createWebSearchRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestWebSearch
  } = createAgentLlmRuntimeHelpers(deps);
  const searchWebResultsOverride = typeof deps.searchWebResults === 'function'
    ? deps.searchWebResults
    : null;

  function buildWebSearchQuery(input = {}) {
    const source = ensureObject(input);
    return cleanText(
      source.query
      || source.message
      || source.topic,
      1200
    );
  }

  function normalizeSearchResult(raw = {}) {
    const source = ensureObject(raw);
    const url = safeUrl(source.url || source.link);
    return {
      source: 'web',
      title: cleanText(source.title || source.name, 320),
      url,
      summary: cleanText(source.summary || source.snippet || source.description, 1200),
      snippet: cleanText(source.snippet || source.summary || source.description, 1200),
      source_domain: cleanText(source.source_domain, 120).toLowerCase() || extractSourceDomain(url),
      published_at: cleanText(source.published_at || source.publishedAt, 80)
    };
  }

  function normalizeSearchResults(raw = {}, limit = 8) {
    const source = ensureObject(raw);
    const normalizedLimit = Math.max(1, Number(limit) || 8);
    return {
      results: asArray(source.results || source.items || source.search_results)
        .map((item) => normalizeSearchResult(item))
        .filter((item) => item.url || item.title || item.summary)
        .slice(0, normalizedLimit),
      reasoning: cleanText(source.reasoning || source.summary, 600)
    };
  }

  function buildCitation(item = {}, index = 0) {
    return {
      source: 'web_source',
      pointer: cleanText(item.url || item.title, 260) || `web-result:${index + 1}`,
      reason: 'Matched external web search result.'
    };
  }

  async function searchWebResults(input = {}) {
    const source = ensureObject(input);
    const query = buildWebSearchQuery(source);
    const limit = clampInteger(source.limit, 8, 1, 25);
    const allowedDomains = uniqueStrings(asArray(source.allowed_domains || source.allowedDomains), 12);

    if (!query) {
      throw new Error('Web search requires a query or message.');
    }

    if (searchWebResultsOverride) {
      const raw = await searchWebResultsOverride({
        query,
        limit,
        allowedDomains,
        userLocation: source.user_location || source.userLocation || null,
        input: source
      });
      if (Array.isArray(raw)) {
        return {
          query,
          results: raw.map((item) => normalizeSearchResult(item)).filter((item) => item.url || item.title || item.summary).slice(0, limit),
          reasoning: ''
        };
      }
      const normalized = normalizeSearchResults(raw, limit);
      return {
        query,
        results: normalized.results,
        reasoning: normalized.reasoning
      };
    }

    if (!requestWebSearch) {
      throw new Error('Web search requires provider-layer web search support.');
    }

    const response = await requestWebSearch({
      source,
      stage: cleanText(source.stage, 120) || 'agent_web_search',
      query,
      maxResults: limit,
      allowedDomains,
      userLocation: source.user_location || source.userLocation || null,
      externalWebAccess: source.external_web_access !== false,
      traceContext: source.traceContext || null
    });

    if (!response?.ok) {
      throw new Error(cleanText(response?.error, 600) || 'Web search provider is not configured.');
    }

    const normalized = normalizeSearchResults(response, limit);
    return {
      query,
      results: normalized.results,
      reasoning: normalized.reasoning
    };
  }

  async function execute(input = {}) {
    const source = ensureObject(input);
    const limit = clampInteger(source.limit, 8, 1, 25);
    try {
      const searchResult = await searchWebResults({
        ...source,
        limit
      });
      const items = asArray(searchResult.results);
      return {
        ok: true,
        status: 'completed',
        query: cleanText(searchResult.query, 1200),
        items,
        citations: items.map((item, index) => buildCitation(item, index)),
        loaded_context_blocks: [],
        reasoning: cleanText(searchResult.reasoning, 600),
        summary: items.length
          ? `Found ${items.length} web result${items.length === 1 ? '' : 's'}${searchResult.reasoning ? ` (${cleanText(searchResult.reasoning, 220)})` : ''}.`
          : `No web results found for "${cleanText(searchResult.query, 220)}".`
      };
    } catch (error) {
      if (isAgentRequestAbortError(error)) {
        throw error;
      }
      return {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 1200) || 'Web search failed.',
        items: [],
        citations: [],
        loaded_context_blocks: [],
        summary: cleanText(error?.message || error, 320) || 'Web search failed.'
      };
    }
  }

  return {
    buildWebSearchQuery,
    searchWebResults,
    execute
  };
}

module.exports = {
  createWebSearchRuntime
};
