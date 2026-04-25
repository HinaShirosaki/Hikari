'use strict';

const {
  SCIENCE_LOOP_LOGICAL_VERIFICATION_SCHEMA,
  normalizeScienceLogicalVerification
} = require('./logical-verification.js');

const SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tentative_answer', 'supporting_basis', 'unresolved_issues'],
  properties: {
    tentative_answer: {
      type: 'object',
      additionalProperties: false,
      required: ['current_best_answer'],
      properties: {
        current_best_answer: { type: 'string' }
      }
    },
    supporting_basis: {
      type: 'array',
      items: { type: 'string' }
    },
    unresolved_issues: {
      type: 'array',
      items: { type: 'string' }
    },
    logical_verification: SCIENCE_LOOP_LOGICAL_VERIFICATION_SCHEMA
  }
};

function createScienceLoopPreSynthesizedAnswerRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
    });
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });

  function collectContradictions(input = {}) {
    const latestToolResult = input.latestToolResult && typeof input.latestToolResult === 'object'
      ? input.latestToolResult
      : {};
    const toolTrace = asArray(input.toolTrace);
    return uniqueStrings([
      ...asArray(latestToolResult?.contradictions),
      ...asArray(latestToolResult?.result?.contradictions),
      ...toolTrace.flatMap((row) => [
        ...asArray(row?.contradictions),
        ...asArray(row?.result?.contradictions)
      ])
    ], 8);
  }

  function buildCitationBasis(citations) {
    return asArray(citations).slice(0, 4).map((citation) => {
      const source = cleanText(citation?.source, 120);
      const pointer = cleanText(citation?.pointer, 220);
      const reason = cleanText(citation?.reason, 220);
      const label = [source, pointer].filter(Boolean).join(': ');
      if (label && reason) {
        return `${label} - ${reason}`;
      }
      return label || reason;
    }).filter(Boolean);
  }

  function buildLoadedContextBasis(blocks) {
    return asArray(blocks).slice(0, 4).map((block) => {
      const paperTitle = cleanText(block?.paper_title, 160);
      const sectionLabel = cleanText(block?.section_label, 80);
      const excerpt = cleanText(block?.excerpt, 180);
      const reason = cleanText(block?.relevance_reason, 180);
      const header = [paperTitle, sectionLabel].filter(Boolean).join(' | ');
      return [header, excerpt, reason].filter(Boolean).join(' - ');
    }).filter(Boolean);
  }

  function buildFallbackPreSynthesizedAnswer(input = {}) {
    const latestToolResult = input.latestToolResult && typeof input.latestToolResult === 'object'
      ? input.latestToolResult
      : {};
    const latestTraceRow = asArray(input.toolTrace).slice(-1)[0] || null;
    const latestAssistantText = cleanText(input.latestAssistantText, 1200);
    const latestToolSummary = cleanText(
      latestToolResult?.summary || latestToolResult?.result?.summary || latestTraceRow?.summary,
      320
    );
    const latestToolNames = uniqueStrings([
      ...asArray(latestToolResult?.tool_names),
      cleanText(latestToolResult?.tool_name || latestTraceRow?.tool_name, 120)
    ], 4);
    const latestError = cleanText(latestToolResult?.error || latestTraceRow?.error, 320);
    const latestItems = Math.max(
      asArray(latestToolResult?.items).length,
      asArray(latestToolResult?.result?.items).length
    );
    const hasSuccessfulToolStep = asArray(input.toolTrace).some((row) => row?.ok === true);
    const loadedContextBasis = buildLoadedContextBasis([
      ...asArray(latestToolResult?.loaded_context_blocks),
      ...asArray(latestToolResult?.result?.loaded_context_blocks),
      ...asArray(input.toolTrace).flatMap((row) => asArray(row?.loaded_context_blocks))
    ]);
    const citationBasis = buildCitationBasis([
      ...asArray(latestToolResult?.citations),
      ...asArray(latestToolResult?.result?.citations),
      ...asArray(input.citations)
    ]);
    const supportingBasis = uniqueStrings([
      latestToolSummary,
      latestToolNames.length && latestItems > 0
        ? `${latestToolNames.join(' + ')} returned ${latestItems} item(s).`
        : '',
      ...loadedContextBasis,
      ...citationBasis,
      ...asArray(input.toolTrace).slice(-3).map((row) => {
        const toolName = cleanText(row?.tool_name, 120);
        const summary = cleanText(row?.summary, 220);
        if (!toolName && !summary) {
          return '';
        }
        return toolName && summary ? `${toolName}: ${summary}` : (toolName || summary);
      })
    ], 6);
    const unresolvedIssues = uniqueStrings([
      ...collectContradictions(input),
      latestToolResult && latestToolResult.ok === false && latestError
        ? `Latest tool issue: ${latestError}`
        : '',
      !citationBasis.length
        ? 'No citation-backed evidence has been collected yet.'
        : '',
      !hasSuccessfulToolStep
        ? 'No successful evidence-gathering tool step has completed yet.'
        : '',
      !latestAssistantText && !latestToolSummary
        ? 'The current best answer is still too incomplete to summarize confidently.'
        : ''
    ], 6);

    return {
      tentative_answer: {
        current_best_answer: latestAssistantText
          || latestToolSummary
          || 'No grounded tentative answer is available yet.'
      },
      supporting_basis: supportingBasis.length
        ? supportingBasis
        : ['No compact supporting basis is available yet.'],
      unresolved_issues: unresolvedIssues
    };
  }

  function normalizePreSynthesizedAnswer(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const sourceTentative = source.tentative_answer && typeof source.tentative_answer === 'object'
      ? source.tentative_answer
      : {};
    const fallbackTentative = fallbackSource.tentative_answer && typeof fallbackSource.tentative_answer === 'object'
      ? fallbackSource.tentative_answer
      : {};

    return {
      tentative_answer: {
        current_best_answer: cleanText(sourceTentative.current_best_answer, 1200)
          || cleanText(source.current_best_answer, 1200)
          || cleanText(fallbackTentative.current_best_answer, 1200)
          || cleanText(fallbackSource.current_best_answer, 1200)
          || 'No grounded tentative answer is available yet.'
      },
      supporting_basis: uniqueStrings([
        ...asArray(source.supporting_basis),
        ...asArray(fallbackSource.supporting_basis)
      ], 6),
      unresolved_issues: uniqueStrings([
        ...asArray(source.unresolved_issues),
        ...asArray(fallbackSource.unresolved_issues)
      ], 6),
      logical_verification: normalizeScienceLogicalVerification(
        source.logical_verification,
        fallbackSource.logical_verification,
        { asArray, cleanText, uniqueStrings }
      )
    };
  }

  function buildPreSynthesizedAnswer(input = {}) {
    return normalizePreSynthesizedAnswer(
      input.preSynthesizedAnswer,
      buildFallbackPreSynthesizedAnswer(input)
    );
  }

  return {
    SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA,
    buildFallbackPreSynthesizedAnswer,
    normalizePreSynthesizedAnswer,
    buildPreSynthesizedAnswer
  };
}

module.exports = {
  SCIENCE_LOOP_PRE_SYNTHESIZED_ANSWER_SCHEMA,
  createScienceLoopPreSynthesizedAnswerRuntime
};
