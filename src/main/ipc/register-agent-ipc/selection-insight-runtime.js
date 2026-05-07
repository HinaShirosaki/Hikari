'use strict';

const ACTION_WHAT_IS_IT = 'what_is_it';
const ACTION_WHERE_TO_BUY = 'where_to_buy';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function createSelectionInsightRuntime({
  cleanText,
  requestText,
  requestWebSearch,
  observability
} = {}) {
  const safeCleanText = typeof cleanText === 'function'
    ? cleanText
    : ((value, _maxLength = 2000) => {
      const text = String(value || '').trim();
      return text || '';
    });
  const recordLifecycleEvent = observability && typeof observability.recordLifecycleEvent === 'function'
    ? observability.recordLifecycleEvent
    : (() => {});

  function buildEmptyInventorySearch() {
    return {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    };
  }

  function normalizeSelectionInsightPayload(payload = {}) {
    const source = payload?.agent?.selectionInsight && typeof payload.agent.selectionInsight === 'object'
      ? payload.agent.selectionInsight
      : (payload?.selectionInsight && typeof payload.selectionInsight === 'object'
        ? payload.selectionInsight
        : null);
    if (!source) {
      return null;
    }
    const actionType = safeCleanText(source.actionType, 80).toLowerCase();
    const selectedText = safeCleanText(source.selectedText, 600);
    if (![ACTION_WHAT_IS_IT, ACTION_WHERE_TO_BUY].includes(actionType) || !selectedText) {
      return null;
    }
    return {
      actionType,
      selectedText,
      segmentLabel: safeCleanText(source.segmentLabel, 160),
      contextText: safeCleanText(source.contextText, 6000),
      recordName: safeCleanText(source.recordName, 220),
      projectName: safeCleanText(source.projectName, 220)
    };
  }

  function buildSelectionInsightParserPayload(insight, {
    projectId = '',
    projectName = '',
    directAnswer = null
  } = {}) {
    const normalizedProjectName = safeCleanText(projectName || insight?.projectName, 220);
    const base = {
      reasoning_effort: 0,
      direct_answer: safeCleanText(directAnswer, 12000) || null,
      needs_clarification: false,
      clarification_reason: null,
      inventory_search: buildEmptyInventorySearch(),
      protocol_candidates: [],
      reasoning_summary: insight?.actionType === ACTION_WHERE_TO_BUY
        ? 'Handled as a direct selection insight purchase recommendation without the intent parser.'
        : 'Handled as a direct selection insight explanation without the intent parser.'
    };
    if (insight?.actionType === ACTION_WHERE_TO_BUY) {
      return {
        ...base,
        primary_intent: 'purchase_recommendation',
        entities: {
          product_query: safeCleanText(insight?.selectedText, 600)
        }
      };
    }
    return {
      ...base,
      primary_intent: projectId || normalizedProjectName
        ? 'project_science_question'
        : 'general_science_question',
      entities: projectId || normalizedProjectName
        ? {
          project_id: safeCleanText(projectId, 120),
          project_name: normalizedProjectName
        }
        : {}
    };
  }

  function buildWhatIsItPrompt(insight) {
    return [
      insight?.recordName ? `Record: ${safeCleanText(insight.recordName, 220)}` : '',
      insight?.projectName ? `Project: ${safeCleanText(insight.projectName, 220)}` : '',
      insight?.segmentLabel ? `Section: ${safeCleanText(insight.segmentLabel, 160)}` : '',
      `Selected text: "${safeCleanText(insight?.selectedText, 600)}"`,
      insight?.contextText ? `Local context:\n${safeCleanText(insight.contextText, 6000)}` : '',
      'Answer only what this selected term or phrase refers to in this context.',
      'Be concise, practical, and plain text only. Prefer 2 to 4 sentences.',
      'If the context is ambiguous, say what is most likely and note the uncertainty briefly.'
    ].filter(Boolean).join('\n\n');
  }

  function buildSelectionInsightScienceResult(answerText) {
    return {
      status: 'completed',
      answer: safeCleanText(answerText, 12000),
      follow_up_questions: [],
      citations: [],
      rounds_executed: 0,
      trace_sentence: 'I answered the selected-text question directly from the provided local context.'
    };
  }

  function buildPurchaseFallback(query, errorMessage) {
    return {
      status: 'no_match',
      query: safeCleanText(query, 320),
      source: 'web',
      filters: {
        required_terms: [],
        excluded_terms: [],
        budget_preference: ''
      },
      items: [],
      follow_up_questions: [
        safeCleanText(errorMessage, 280) || 'The purchase recommendation search could not be completed.'
      ],
      summary: safeCleanText(errorMessage, 320) || 'The purchase recommendation search could not be completed.'
    };
  }

  function formatVendorLabel(domain) {
    return safeCleanText(domain, 160)
      .replace(/^www\./i, '')
      .replace(/\.$/, '');
  }

  function buildPurchaseSearchQuery(insight) {
    return [
      safeCleanText(insight?.selectedText, 320),
      safeCleanText(insight?.recordName, 220),
      'buy lab reagent product supplier'
    ].filter(Boolean).join(' ');
  }

  function buildSearchSummaryPrompt(insight, items) {
    const rows = asArray(items).slice(0, 6).map((item, index) => (
      `${index + 1}. ${safeCleanText(item.title, 240)} | ${formatVendorLabel(item.vendor || item.source_domain)} | ${safeCleanText(item.summary, 360)}`
    )).filter(Boolean);
    return [
      `Selected text: "${safeCleanText(insight?.selectedText, 320)}"`,
      insight?.recordName ? `Record: ${safeCleanText(insight.recordName, 220)}` : '',
      insight?.segmentLabel ? `Section: ${safeCleanText(insight.segmentLabel, 160)}` : '',
      insight?.contextText ? `Local context: "${safeCleanText(insight.contextText, 2000)}"` : '',
      rows.length ? `Candidate vendor results:\n${rows.join('\n')}` : 'No candidate vendor results were found.',
      'Write a short plain-text buying recommendation.',
      'Mention the most likely vendors or result types and tell the user to verify the exact specification if needed.',
      'Keep it to 2 sentences max.'
    ].filter(Boolean).join('\n\n');
  }

  function normalizePurchaseItems(searchResults = []) {
    return asArray(searchResults)
      .map((item) => {
        const source = item && typeof item === 'object' ? item : {};
        const title = safeCleanText(source.title, 320);
        const productUrl = safeCleanText(source.url, 2000);
        const vendor = formatVendorLabel(source.vendor || source.source_domain);
        if (!title || !productUrl || !vendor) {
          return null;
        }
        return {
          title,
          vendor,
          price_text: '',
          image_url: '',
          product_url: productUrl,
          summary: safeCleanText(source.summary || source.snippet, 1200),
          source_domain: safeCleanText(source.source_domain, 120)
        };
      })
      .filter(Boolean)
      .slice(0, 6);
  }

  async function runSelectionInsight(payload = {}, context = {}) {
    const insight = normalizeSelectionInsightPayload(payload);
    if (!insight) {
      return null;
    }
    const projectId = safeCleanText(payload?.projectId, 120);
    const projectName = safeCleanText(payload?.projectName || insight.projectName, 220);
    const llmSource = {
      provider: safeCleanText(context?.provider, 80),
      endpoint: safeCleanText(context?.endpoint, 2000),
      apiKey: safeCleanText(context?.apiKey, 400),
      model: safeCleanText(context?.model, 120)
    };
    const traceContext = context?.traceContext || null;
    const lifecycleRecorder = context?.lifecycleRecorder || null;

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'selection_insight_started',
      status: 'started',
      routing_intent: insight.actionType === ACTION_WHERE_TO_BUY
        ? 'purchase_recommendation'
        : (projectId || projectName ? 'project_science_question' : 'general_science_question'),
      message: insight.actionType === ACTION_WHERE_TO_BUY
        ? 'Running direct selection insight purchase recommendation.'
        : 'Running direct selection insight explanation.',
      meta: {
        action_type: safeCleanText(insight.actionType, 80),
        selected_text: safeCleanText(insight.selectedText, 220)
      }
    });

    if (insight.actionType === ACTION_WHAT_IS_IT) {
      if (typeof requestText !== 'function') {
        return {
          ok: false,
          error: 'Selection insight text generation is not configured.'
        };
      }
      const llmResult = await requestText({
        source: llmSource,
        stage: 'selection_insight_what_is_it',
        systemPrompt: [
          'You answer short in-context lab protocol questions.',
          'Explain what the selected text refers to using only the supplied local context and general background knowledge.',
          'Respond as plain assistant text only.',
          'Do not mention routing, tools, records, or intent parsing.'
        ].join(' '),
        userPrompt: buildWhatIsItPrompt(insight),
        traceContext,
        defaultError: 'Selection insight generation is not configured.'
      });
      if (!llmResult?.ok || !safeCleanText(llmResult.text, 12000)) {
        return {
          ok: false,
          error: safeCleanText(llmResult?.error, 320) || 'The selection insight answer could not be generated.'
        };
      }
      const answerText = safeCleanText(llmResult.text, 12000);
      const parser = buildSelectionInsightParserPayload(insight, {
        projectId,
        projectName,
        directAnswer: answerText
      });
      const result = {
        ok: true,
        parser
      };
      if (parser.primary_intent === 'project_science_question') {
        result.project_science_question = buildSelectionInsightScienceResult(answerText);
      } else {
        result.general_science_question = buildSelectionInsightScienceResult(answerText);
      }
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'selection_insight_completed',
        status: 'ok',
        routing_intent: parser.primary_intent,
        message: 'Direct selection insight explanation completed.'
      });
      return result;
    }

    if (typeof requestWebSearch !== 'function') {
      return {
        ok: false,
        error: 'Selection insight purchase recommendations are not configured.'
      };
    }
    const webSearchResult = await requestWebSearch({
      source: llmSource,
      stage: 'selection_insight_where_to_buy',
      query: buildPurchaseSearchQuery(insight),
      maxResults: 6,
      traceContext,
      externalWebAccess: true,
      defaultError: 'Selection insight web search is not configured.'
    });
    if (!webSearchResult?.ok) {
      return {
        ok: true,
        parser: buildSelectionInsightParserPayload(insight, {
          projectId,
          projectName
        }),
        purchase_recommendation: buildPurchaseFallback(insight.selectedText, webSearchResult?.error)
      };
    }
    const purchaseItems = normalizePurchaseItems(webSearchResult?.results);
    let summary = purchaseItems.length
      ? `These are likely places to buy "${safeCleanText(insight.selectedText, 220)}". Verify the exact product specification before ordering.`
      : `No likely vendor pages were found for "${safeCleanText(insight.selectedText, 220)}".`;
    if (purchaseItems.length && typeof requestText === 'function') {
      const summaryResult = await requestText({
        source: llmSource,
        stage: 'selection_insight_where_to_buy_summary',
        systemPrompt: [
          'You summarize vendor search results for lab purchasing.',
          'Respond as plain assistant text only.',
          'Do not mention tools, web search, or intent parsing.'
        ].join(' '),
        userPrompt: buildSearchSummaryPrompt(insight, purchaseItems),
        traceContext,
        defaultError: 'Selection insight purchase summary is not configured.'
      });
      if (summaryResult?.ok && safeCleanText(summaryResult.text, 1200)) {
        summary = safeCleanText(summaryResult.text, 1200);
      }
    }
    const purchaseResult = purchaseItems.length
      ? {
        status: 'matched',
        query: safeCleanText(insight.selectedText, 320),
        source: 'web',
        filters: {
          required_terms: [],
          excluded_terms: [],
          budget_preference: ''
        },
        items: purchaseItems,
        follow_up_questions: [],
        match_mode: 'partial',
        summary
      }
      : buildPurchaseFallback(insight.selectedText, summary);
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'selection_insight_completed',
      status: safeCleanText(purchaseResult?.status, 40) === 'matched' ? 'ok' : 'pending',
      routing_intent: 'purchase_recommendation',
      message: `Direct selection insight purchase recommendation status=${safeCleanText(purchaseResult?.status, 40) || 'unknown'}.`,
      meta: {
        item_count: asArray(purchaseResult?.items).length
      }
    });
    return {
      ok: true,
      parser: buildSelectionInsightParserPayload(insight, {
        projectId,
        projectName
      }),
      purchase_recommendation: purchaseResult
    };
  }

  return {
    normalizeSelectionInsightPayload,
    runSelectionInsight
  };
}

module.exports = {
  ACTION_WHAT_IS_IT,
  ACTION_WHERE_TO_BUY,
  createSelectionInsightRuntime
};
