'use strict';

const { isAgentRequestAbortError } = require('../../lib/llm/request-context.js');
const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { asArray } = require('../../lib/normalize.js');
const {
  cleanText,
  uniqueStrings,
  clampInteger,
  stripHtml,
  extractSourceDomain
} = require('./purchase-recommendation/text-utils.js');
const {
  readFirstImageUrl,
  extractLoosePrice,
  extractProductFromHtml
} = require('./purchase-recommendation/product-extraction.js');
const {
  parseDelimitedTerms,
  normalizeBudgetPreference,
  normalizeRequiredTerms,
  resolveFilters,
  deriveProductQuery,
  evaluateProductRequirementMatch
} = require('./purchase-recommendation/requirements.js');
const {
  buildSearchQuery,
  buildSearchQueries,
  usesCodexAgentPurchasePath,
  buildFastCodexSearchQueries,
  extractCandidateProductLinks,
  deriveAdaptiveSearchQueries,
  createReasoningRound
} = require('./purchase-recommendation/search-queries.js');
const {
  evaluateProductCandidate,
  normalizeSearchResult,
  dedupeAndRankProducts,
  runProductReasoningLoop,
  summarizePurchaseRecommendation
} = require('./purchase-recommendation/candidate-scoring.js');
const {
  PURCHASE_SEARCH_PLAN_SCHEMA,
  PURCHASE_CANDIDATE_JUDGMENT_SCHEMA,
  PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT,
  PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT,
  buildPurchaseSearchPlannerPrompt,
  buildPurchaseCandidateJudgePrompt,
  normalizePurchaseSearchPlan,
  normalizePurchaseCandidateJudgment,
  mergePurchaseReasoning
} = require('./purchase-recommendation/llm-judging.js');

function createPurchaseRecommendationRuntime(deps = {}) {
  const {
    cleanText: runtimeCleanText,
    requestStructuredJsonPayload,
    requestWebSearch
  } = createAgentLlmRuntimeHelpers(deps);
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const searchWebResultsOverride = typeof deps.searchWebResults === 'function' ? deps.searchWebResults : null;

  async function readResponseText(response) {
    if (typeof response?.text === 'function') {
      return String(await response.text());
    }
    if (typeof response?.json === 'function') {
      return JSON.stringify(await response.json());
    }
    return '';
  }

  async function fetchText(url) {
    if (!fetchImpl) {
      throw new Error('Purchase recommendation requires fetch support.');
    }
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 Hikari Purchase Recommendation'
      }
    });
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(runtimeCleanText(body, 300) || `Failed to fetch ${url}.`);
    }
    return readResponseText(response);
  }

  async function searchWebResults(query, limit = 10, input = {}) {
    if (searchWebResultsOverride) {
      const normalized = asArray(await searchWebResultsOverride({ query, limit })).map((item) => normalizeSearchResult(item)).filter((item) => item.url);
      return normalized.slice(0, limit);
    }
    if (requestWebSearch) {
      const providerSearch = await requestWebSearch({
        ...input,
        stage: 'purchase_recommendation_web_search',
        query,
        maxResults: limit,
        traceContext: input.traceContext || null
      });
      if (providerSearch?.ok) {
        return asArray(providerSearch.results).map((item) => normalizeSearchResult(item)).filter((item) => item.url).slice(0, limit);
      }
      throw new Error(cleanText(providerSearch?.error) || 'Provider-layer web search is unavailable.');
    }
    throw new Error('Purchase recommendation requires provider-layer web search support.');
  }

  async function planSearchQueriesWithLlm(input = {}, filters = {}, priorRounds = []) {
    const heuristicQueries = priorRounds.length
      ? deriveAdaptiveSearchQueries({
        query: deriveProductQuery(input),
        filters,
        priorRounds
      })
      : buildSearchQueries(input);
    if (usesCodexAgentPurchasePath(input)) {
      return {
        planner: 'fast_codex_heuristic',
        reasoning: 'Using fast Codex purchase planning to avoid extra CLI round-trips.',
        queries: buildFastCodexSearchQueries(input, filters, priorRounds)
      };
    }
    if (!requestStructuredJsonPayload) {
      return {
        planner: 'heuristic',
        reasoning: 'Using heuristic search planning because no structured LLM helper is available.',
        queries: heuristicQueries
      };
    }
    try {
      const llmResult = await requestStructuredJsonPayload({
        ...input,
        stage: `purchase_recommendation_search_plan_round_${asArray(priorRounds).length + 1}`,
        systemPrompt: PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT,
        userPrompt: buildPurchaseSearchPlannerPrompt({
          query: deriveProductQuery(input),
          filters,
          priorRounds,
          heuristicQueries
        }),
        schema: PURCHASE_SEARCH_PLAN_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Purchase recommendation provider is not configured.'
      });
      if (!llmResult?.ok || !llmResult.payload) {
        return {
          planner: 'heuristic_fallback',
          reasoning: cleanText(llmResult?.error) || 'Falling back to heuristic search planning.',
          queries: heuristicQueries
        };
      }
      const normalized = normalizePurchaseSearchPlan(llmResult.payload, heuristicQueries);
      return {
        planner: 'llm',
        reasoning: normalized.reasoning || 'LLM planned search queries.',
        queries: normalized.search_queries.length ? normalized.search_queries : heuristicQueries
      };
    } catch (error) {
      return {
        planner: 'heuristic_fallback',
        reasoning: runtimeCleanText(error?.message || error, 320) || 'Falling back to heuristic search planning.',
        queries: heuristicQueries
      };
    }
  }

  async function judgeCandidateWithLlm({
    input = {},
    filters = {},
    searchResult = {},
    normalizedProduct = {},
    pageText = '',
    heuristicReasoning = {},
    candidateLinks = []
  } = {}) {
    if (!requestStructuredJsonPayload || usesCodexAgentPurchasePath(input)) {
      return null;
    }
    try {
      const llmResult = await requestStructuredJsonPayload({
        ...input,
        stage: 'purchase_recommendation_candidate_judge',
        systemPrompt: PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT,
        userPrompt: buildPurchaseCandidateJudgePrompt({
          query: deriveProductQuery(input),
          filters,
          searchResult,
          normalizedProduct,
          pageText,
          heuristicReasoning,
          candidateLinks
        }),
        schema: PURCHASE_CANDIDATE_JUDGMENT_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Purchase recommendation provider is not configured.'
      });
      if (!llmResult?.ok || !llmResult.payload) {
        return null;
      }
      return normalizePurchaseCandidateJudgment(llmResult.payload, {
        ...normalizedProduct,
        page_url: cleanText(searchResult.url)
      }, filters);
    } catch {
      return null;
    }
  }

  function aggregateDiagnostics(rounds = [], lastError = '') {
    return {
      search_query_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.search_query_count || 0), 0),
      search_result_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.search_result_count || 0), 0),
      fetched_page_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.fetched_page_count || 0), 0),
      fetch_failure_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.fetch_failure_count || 0), 0),
      incomplete_candidate_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.incomplete_candidate_count || 0), 0),
      non_product_candidate_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.non_product_candidate_count || 0), 0),
      filtered_out_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.filtered_out_count || 0), 0),
      followed_product_link_count: asArray(rounds).reduce((sum, round) => sum + Number(round?.followed_product_link_count || 0), 0),
      last_error: cleanText(lastError),
      reasoning_rounds: asArray(rounds).map((round) => ({
        ...round,
        queries: uniqueStrings(round?.queries, 8),
        missing_requirement_terms: uniqueStrings(round?.missing_requirement_terms, 12)
      }))
    };
  }

  async function execute(input = {}) {
    const query = deriveProductQuery(input);
    const filters = resolveFilters(input);
    const fastCodexPath = usesCodexAgentPurchasePath(input);
    if (!query) {
      return {
        ok: true,
        status: 'needs_more_info',
        query: '',
        source: 'parser_only',
        filters,
        items: [],
        follow_up_questions: ['Please tell me what item you want to buy.'],
        summary: 'I need more detail before I can recommend something to buy.'
      };
    }

    const limit = clampInteger(input.limit, 6, 1, 6);
    const searchLimit = clampInteger(input.search_limit, fastCodexPath ? 6 : 10, 1, 16);
    const maxReasoningRounds = clampInteger(input.max_reasoning_rounds, fastCodexPath ? 1 : (requestStructuredJsonPayload ? 3 : 2), 1, 4);
    const maxLinkedPagesPerResult = clampInteger(input.link_follow_limit, fastCodexPath ? 1 : 3, 0, 4);
    const maxInspectionDepth = clampInteger(input.max_link_depth, 1, 0, 2);
    const inspectionConcurrency = clampInteger(input.inspection_concurrency, fastCodexPath ? 4 : 2, 1, 6);
    const strictCandidates = [];
    const partialCandidates = [];
    const reasoningRounds = [];
    const seenSearchQueryKeys = new Set();
    const seenSearchResultUrls = new Set();
    const seenInspectedUrls = new Set();
    let lastError = '';

    async function inspectCandidateUrl(searchResult = {}, round = {}, searchIndex = 0, depth = 0, inspectionPath = []) {
      const currentUrl = cleanText(searchResult.url);
      const currentKey = currentUrl.toLowerCase();
      if (!currentUrl || seenInspectedUrls.has(currentKey)) {
        return;
      }
      seenInspectedUrls.add(currentKey);
      try {
        const html = await fetchText(currentUrl);
        round.fetched_page_count += 1;
        const pageText = stripHtml(html);
        const product = extractProductFromHtml(html, currentUrl);
        const snippetPrice = extractLoosePrice(searchResult.summary);
        const normalizedProduct = {
          ...product,
          title: cleanText(product.title || searchResult.title),
          image_url: cleanText(product.image_url) || readFirstImageUrl(html, currentUrl),
          price_value: product.price_value ?? snippetPrice.price_value,
          currency: product.currency || snippetPrice.currency,
          price_text: product.price_text || snippetPrice.price_text,
          product_url: cleanText(product.product_url) || currentUrl,
          source_domain: cleanText(product.source_domain) || searchResult.source_domain
        };
        const heuristicReasoning = runProductReasoningLoop({
          item: normalizedProduct,
          html,
          searchResult,
          filters,
          pageText
        });
        const heuristicLinks = extractCandidateProductLinks(html, currentUrl, query, maxLinkedPagesPerResult);
        const llmJudgment = await judgeCandidateWithLlm({
          input,
          filters,
          searchResult,
          normalizedProduct,
          pageText,
          heuristicReasoning,
          candidateLinks: heuristicLinks
        });
        const reasoning = mergePurchaseReasoning({
          heuristicReasoning,
          llmJudgment,
          filters
        });
        const resolvedProduct = llmJudgment
          ? {
            ...normalizedProduct,
            title: cleanText(llmJudgment.title) || normalizedProduct.title,
            vendor: cleanText(llmJudgment.vendor) || normalizedProduct.vendor,
            price_value: llmJudgment.price_value ?? normalizedProduct.price_value,
            currency: llmJudgment.currency || normalizedProduct.currency,
            price_text: llmJudgment.price_text || normalizedProduct.price_text,
            image_url: cleanText(llmJudgment.image_url) || normalizedProduct.image_url,
            product_url: cleanText(llmJudgment.product_url) || normalizedProduct.product_url
          }
          : normalizedProduct;
        const evaluation = reasoning.requirement_gate || evaluateProductRequirementMatch(resolvedProduct, filters, pageText);
        const followUpLinks = uniqueStrings([
          ...asArray(reasoning.suggested_links),
          ...heuristicLinks.map((item) => cleanText(item?.url))
        ], maxLinkedPagesPerResult);

        if (asArray(evaluation.missing_requirements).length) {
          round.missing_requirement_terms.push(...asArray(evaluation.missing_requirements));
        }

        if (!reasoning.product_gate?.is_product) {
          round.non_product_candidate_count += 1;
          if (depth < maxInspectionDepth) {
            for (const followUpUrl of followUpLinks) {
              if (strictCandidates.length >= limit) {
                break;
              }
              round.followed_product_link_count += 1;
              await inspectCandidateUrl({
                title: cleanText(
                  heuristicLinks.find((item) => cleanText(item?.url, 2000) === followUpUrl)?.anchor_text || searchResult.title),
                url: followUpUrl,
                summary: searchResult.summary,
                source_domain: extractSourceDomain(followUpUrl)
              }, round, searchIndex, depth + 1, [...inspectionPath, currentUrl]);
            }
          }
          return;
        }

        const hasCompleteCard = !!(
          cleanText(resolvedProduct.image_url)
          && cleanText(resolvedProduct.vendor)
          && cleanText(resolvedProduct.price_text)
          && cleanText(resolvedProduct.product_url)
        );
        if (!hasCompleteCard) {
          round.incomplete_candidate_count += 1;
          if (depth < maxInspectionDepth) {
            for (const followUpUrl of followUpLinks) {
              if (strictCandidates.length >= limit) {
                break;
              }
              round.followed_product_link_count += 1;
              await inspectCandidateUrl({
                title: cleanText(
                  heuristicLinks.find((item) => cleanText(item?.url, 2000) === followUpUrl)?.anchor_text || searchResult.title),
                url: followUpUrl,
                summary: searchResult.summary,
                source_domain: extractSourceDomain(followUpUrl)
              }, round, searchIndex, depth + 1, [...inspectionPath, currentUrl]);
            }
          }
          return;
        }

        if (asArray(evaluation.excluded_hits).length) {
          round.filtered_out_count += 1;
          return;
        }

        const normalizedCandidate = {
          ...resolvedProduct,
          id: cleanText(resolvedProduct.id) || `product-${searchIndex + 1}`,
          source_domain: cleanText(resolvedProduct.source_domain) || searchResult.source_domain,
          matched_requirements: asArray(evaluation.matched_requirements),
          unverified_requirements: asArray(evaluation.missing_requirements),
          candidate_reasoning: {
            product_gate: reasoning.product_gate,
            requirement_gate: evaluation,
            reasoning_source: cleanText(reasoning.reasoning_source) || 'heuristic',
            inspection_path: uniqueStrings([...inspectionPath, currentUrl], 6),
            product_reason: cleanText(llmJudgment?.product_reason),
            requirement_reason: cleanText(llmJudgment?.requirement_reason)
          },
          _search_index: searchIndex
        };

        if (reasoning.accept_as_strict) {
          strictCandidates.push(normalizedCandidate);
          round.strict_candidate_count += 1;
        } else if (reasoning.accept_as_partial) {
          partialCandidates.push(normalizedCandidate);
          round.partial_candidate_count += 1;
          round.filtered_out_count += 1;
        }
      } catch (error) {
        if (isAgentRequestAbortError(error)) {
          throw error;
        }
        round.fetch_failure_count += 1;
        lastError = runtimeCleanText(error?.message || error, 300);
      }
    }

    async function runReasoningRound(roundIndex = 0) {
      const plan = await planSearchQueriesWithLlm(input, filters, reasoningRounds);
      const plannedQueries = uniqueStrings(plan.queries, 8)
        .filter((queryText) => {
          const key = cleanText(queryText).toLowerCase();
          if (!key || seenSearchQueryKeys.has(key)) {
            return false;
          }
          seenSearchQueryKeys.add(key);
          return true;
        });
      if (!plannedQueries.length) {
        return null;
      }
      const round = createReasoningRound(roundIndex, plan.reasoning || plan.planner, plannedQueries);
      round.planner = cleanText(plan.planner) || 'heuristic';
      const searchResults = [];
      for (const searchQuery of plannedQueries) {
        let batch = [];
        try {
          batch = await searchWebResults(searchQuery, searchLimit, input);
        } catch (error) {
          if (isAgentRequestAbortError(error)) {
            throw error;
          }
          lastError = runtimeCleanText(error?.message || error, 320);
          continue;
        }
        asArray(batch).forEach((rawResult) => {
          if (searchResults.length >= searchLimit) {
            return;
          }
          const normalized = normalizeSearchResult(rawResult);
          const key = cleanText(normalized.url).toLowerCase();
          if (!key || seenSearchResultUrls.has(key)) {
            return;
          }
          seenSearchResultUrls.add(key);
          searchResults.push(normalized);
        });
        if (searchResults.length >= searchLimit) {
          break;
        }
      }
      round.search_result_count = searchResults.length;
      const pendingInspections = [];
      for (let index = 0; index < searchResults.length; index += 1) {
        if (strictCandidates.length >= limit) {
          break;
        }
        pendingInspections.push(inspectCandidateUrl(searchResults[index], round, index, 0, []));
        if (pendingInspections.length >= inspectionConcurrency) {
          await Promise.all(pendingInspections.splice(0, pendingInspections.length));
          if (strictCandidates.length >= limit) {
            break;
          }
        }
      }
      if (pendingInspections.length) {
        await Promise.all(pendingInspections);
      }
      return round;
    }

    for (let roundIndex = 0; roundIndex < maxReasoningRounds; roundIndex += 1) {
      const round = await runReasoningRound(roundIndex);
      if (!round) {
        break;
      }
      reasoningRounds.push(round);
      if (strictCandidates.length >= limit) {
        break;
      }
      if (!round.search_result_count && roundIndex > 0) {
        break;
      }
    }

    let items = dedupeAndRankProducts(strictCandidates, filters, limit);
    let matchMode = items.length ? 'strict' : 'none';
    if (!items.length && partialCandidates.length) {
      items = dedupeAndRankProducts(partialCandidates, filters, limit);
      if (items.length) {
        matchMode = 'partial';
      }
    }
    const result = {
      ok: true,
      status: items.length ? 'matched' : 'no_match',
      query,
      source: 'web',
      match_mode: matchMode,
      filters,
      items,
      follow_up_questions: items.length
        ? (matchMode === 'partial'
          ? ['Some requested attributes could not be verified from the vendor pages.']
          : [])
        : ['Try a more specific product name or relax one of the required attributes.']
    };
    const diagnostics = aggregateDiagnostics(reasoningRounds, lastError);
    if (!items.length) {
      if (!diagnostics.search_result_count && diagnostics.last_error) {
        result.summary = diagnostics.last_error;
      } else if (!diagnostics.search_result_count) {
        result.summary = `No search results were returned${query ? ` for "${query}"` : ''}.`;
      } else if (!diagnostics.fetched_page_count && diagnostics.fetch_failure_count) {
        result.summary = `I could not retrieve vendor product pages${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.non_product_candidate_count && !diagnostics.incomplete_candidate_count && !diagnostics.filtered_out_count) {
        result.summary = `I found search hits, but they did not appear to be direct purchasable product pages${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.incomplete_candidate_count && !diagnostics.filtered_out_count) {
        result.summary = `I found candidate pages but could not extract complete product details${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.filtered_out_count) {
        result.summary = `I found candidate products, but none clearly matched the required attributes${query ? ` for "${query}"` : ''}.`;
      } else if (diagnostics.last_error) {
        result.summary = diagnostics.last_error;
      } else {
        result.summary = summarizePurchaseRecommendation(result);
      }
    } else {
      result.summary = summarizePurchaseRecommendation(result);
    }
    result.diagnostics = diagnostics;
    return result;
  }

  return {
    parseDelimitedTerms,
    normalizeBudgetPreference,
    normalizeRequiredTerms,
    resolveFilters,
    deriveProductQuery,
    buildSearchQuery,
    extractProductFromHtml,
    extractLoosePrice,
    buildSearchQueries,
    deriveAdaptiveSearchQueries,
    buildPurchaseSearchPlannerPrompt,
    buildPurchaseCandidateJudgePrompt,
    normalizePurchaseSearchPlan,
    normalizePurchaseCandidateJudgment,
    mergePurchaseReasoning,
    extractCandidateProductLinks,
    evaluateProductCandidate,
    runProductReasoningLoop,
    evaluateProductRequirementMatch,
    summarizePurchaseRecommendation,
    execute
  };
}

module.exports = {
  createPurchaseRecommendationRuntime,
  parseDelimitedTerms,
  normalizeBudgetPreference,
  normalizeRequiredTerms,
  resolveFilters,
  deriveProductQuery,
  buildSearchQuery,
  buildSearchQueries,
  extractProductFromHtml,
  extractLoosePrice,
  deriveAdaptiveSearchQueries,
  buildPurchaseSearchPlannerPrompt,
  buildPurchaseCandidateJudgePrompt,
  normalizePurchaseSearchPlan,
  normalizePurchaseCandidateJudgment,
  mergePurchaseReasoning,
  extractCandidateProductLinks,
  evaluateProductCandidate,
  runProductReasoningLoop,
  evaluateProductRequirementMatch,
  summarizePurchaseRecommendation
};
