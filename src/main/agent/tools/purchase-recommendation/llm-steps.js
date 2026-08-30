'use strict';

const { asArray } = require('../../../lib/normalize.js');
const { cleanText } = require('./text-utils.js');
const { deriveProductQuery } = require('./requirements.js');
const {
  buildFastCodexSearchQueries,
  buildSearchQueries,
  deriveAdaptiveSearchQueries,
  usesCodexAgentPurchasePath
} = require('./search-queries.js');
const {
  PURCHASE_CANDIDATE_JUDGE_SYSTEM_PROMPT,
  PURCHASE_CANDIDATE_JUDGMENT_SCHEMA,
  PURCHASE_SEARCH_PLANNER_SYSTEM_PROMPT,
  PURCHASE_SEARCH_PLAN_SCHEMA,
  buildPurchaseCandidateJudgePrompt,
  buildPurchaseSearchPlannerPrompt,
  normalizePurchaseCandidateJudgment,
  normalizePurchaseSearchPlan
} = require('./llm-judging.js');

// The two LLM turns in a purchase run: plan the search queries, then judge one
// fetched page as a purchasable candidate.
function createPurchaseLlmSteps({ requestStructuredJsonPayload, runtimeCleanText } = {}) {
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

  return { planSearchQueriesWithLlm, judgeCandidateWithLlm };
}

module.exports = { createPurchaseLlmSteps };
