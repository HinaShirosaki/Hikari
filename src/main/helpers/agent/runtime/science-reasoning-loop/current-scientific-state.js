'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');
const { createScienceLoopPreSynthesizedQuestionRuntime } = require('./pre-synthesized-question.js');

const SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'supported_now',
    'contradicted',
    'remains_unknown',
    'uncertainty_decision_relevant',
    'uncertainty_decision_reason'
  ],
  properties: {
    supported_now: {
      type: 'array',
      items: { type: 'string' }
    },
    contradicted: {
      type: 'array',
      items: { type: 'string' }
    },
    remains_unknown: {
      type: 'array',
      items: { type: 'string' }
    },
    uncertainty_decision_relevant: { type: 'boolean' },
    uncertainty_decision_reason: { type: 'string' }
  }
};

function createScienceLoopCurrentScientificStateRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const preSynthesizedQuestionRuntime = createScienceLoopPreSynthesizedQuestionRuntime(deps);
  const {
    buildFallbackPreSynthesizedQuestion,
    normalizePreSynthesizedQuestion,
    buildPreSynthesizedQuestion
  } = preSynthesizedQuestionRuntime;

  function messageRequestsRecentSources(message) {
    return /\b(latest|recent|current|today|newest|papers|references|citations|study|studies|findings)\b/i
      .test(String(message || ''));
  }

  function messageRequestsComputation(message) {
    return /\b(fit|curve|transform|quantif|outlier|calculate|compute|regression|normalize|analy[sz]e data)\b/i
      .test(String(message || ''));
  }

  function hasExternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['pubmed', 'crossref', 'europe_pmc', 'uniprot', 'web_source', 'literature-search'].includes(source);
    });
  }

  function hasInternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['project', 'protocol', 'notebook_entry', 'workflow', 'assay', 'gel_analysis', 'paper', 'python_sandbox', 'python-sandbox', 'record-lookup'].includes(source);
    });
  }

  function hasComputeEvidence(toolTrace) {
    return asArray(toolTrace).some((row) => cleanText(row?.tool_name, 120) === 'python-sandbox' && row?.ok === true);
  }

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

  function collectBlockingRequirementTexts(exitCriteria = {}) {
    return uniqueStrings([
      ...asArray(exitCriteria.required_evidence),
      ...asArray(exitCriteria.continue_when)
    ], 16);
  }

  function matchesBlockingRequirement(exitCriteria = {}, patterns = []) {
    const rows = collectBlockingRequirementTexts(exitCriteria);
    return rows.some((row) => patterns.some((pattern) => pattern.test(String(row || ''))));
  }

  function requiresExternalCitation(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\bexternal citation\b/i,
      /\bcitation-backed source\b/i,
      /\bexternal source\b/i,
      /\bexternal literature\b/i
    ]);
  }

  function requiresProjectLinkedEvidence(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\binternal project\b/i,
      /\bproject-linked\b/i,
      /\bproject citation\b/i,
      /\binternal evidence\b/i,
      /\bproject record\b/i
    ]);
  }

  function requiresDeterministicComputation(exitCriteria = {}) {
    return matchesBlockingRequirement(exitCriteria, [
      /\bdeterministic computation\b/i,
      /\bpython sandbox\b/i,
      /\bpython-sandbox\b/i,
      /\bcomputation step\b/i,
      /\bquantitative step\b/i
    ]);
  }

  function buildFallbackCurrentScientificState(input = {}) {
    const intent = cleanText(input.intent, 80);
    const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
    const citations = asArray(input.citations);
    const toolTrace = asArray(input.toolTrace);
    const clarifiedInput = cleanText(input.message || input.clarifiedInput || input.originalMessage, 3200);
    const exitCriteria = input.exitCriteria && typeof input.exitCriteria === 'object' ? input.exitCriteria : {};
    const preSynthesizedQuestion = normalizePreSynthesizedQuestion(
      input.preSynthesizedQuestion,
      buildFallbackPreSynthesizedQuestion(input)
    );
    const contradicted = collectContradictions(input);
    const supportedNow = [];
    const remainsUnknown = [];

    if (citations.length > 0) {
      supportedNow.push(`Collected ${citations.length} citation-backed evidence item(s).`);
    }
    if (hasExternalCitation(citations)) {
      supportedNow.push('External evidence is available.');
    }
    if (hasInternalCitation(citations)) {
      supportedNow.push('Internal project-linked evidence is available.');
    }
    if (hasComputeEvidence(toolTrace)) {
      supportedNow.push('A deterministic Python computation has been executed.');
    }
    if (toolTrace.some((row) => row?.ok === true)) {
      supportedNow.push('At least one evidence-gathering tool step completed successfully.');
    }
    supportedNow.push(...asArray(preSynthesizedQuestion?.supporting_basis));

    const hasGroundedEvidence = citations.length > 0 || toolTrace.some((row) => row?.ok === true);
    const explicitExternalCitationGap = requiresExternalCitation(exitCriteria) && !hasExternalCitation(citations);
    const explicitProjectEvidenceGap = requiresProjectLinkedEvidence(exitCriteria) && !hasInternalCitation(citations);
    const explicitComputationGap = requiresDeterministicComputation(exitCriteria) && !hasComputeEvidence(toolTrace);

    if (!hasGroundedEvidence) {
      remainsUnknown.push('Whether more evidence gathering is needed before the loop can exit.');
    }
    if (explicitExternalCitationGap) {
      remainsUnknown.push('Whether external citation-backed support is still needed before the loop can exit.');
    } else if (intent === 'general_science_question' && messageRequestsRecentSources(clarifiedInput) && !hasExternalCitation(citations)) {
      remainsUnknown.push('Whether the user still needs explicit external citation support beyond the current evidence.');
    }
    if (explicitProjectEvidenceGap) {
      remainsUnknown.push('Whether additional project-linked evidence is still needed before the loop can exit.');
    } else if (intent === 'project_science_question' && !hasInternalCitation(citations) && !hasGroundedEvidence) {
      remainsUnknown.push('Whether more project-specific grounding is needed beyond the current context.');
    }
    if (explicitComputationGap) {
      remainsUnknown.push('Whether additional deterministic computation is still needed before the loop can exit.');
    } else if (intent === 'result_analysis'
      && policy.require_compute_for_numeric_queries === true
      && messageRequestsComputation(clarifiedInput)
      && !hasComputeEvidence(toolTrace)) {
      remainsUnknown.push('Whether additional deterministic computation is needed beyond the current numeric evidence or trusted tool output.');
    }
    if (!supportedNow.length) {
      remainsUnknown.push('No grounded supporting evidence has been collected yet.');
    }
    if (!citations.length && asArray(exitCriteria.required_evidence).length) {
      remainsUnknown.push('The required evidence for exit has not been fully established yet.');
    }
    remainsUnknown.push(...asArray(preSynthesizedQuestion?.unresolved_issues));

    const normalizedUnknowns = uniqueStrings(remainsUnknown, 8);
    const uncertaintyDecisionRelevant = contradicted.length > 0
      || !hasGroundedEvidence
      || explicitExternalCitationGap
      || explicitProjectEvidenceGap
      || explicitComputationGap;

    return {
      supported_now: uniqueStrings(supportedNow, 8),
      contradicted,
      remains_unknown: normalizedUnknowns,
      uncertainty_decision_relevant: uncertaintyDecisionRelevant,
      uncertainty_decision_reason: uncertaintyDecisionRelevant
        ? (
          contradicted.length > 0
            ? 'Contradictory evidence still affects whether the loop should exit.'
            : (normalizedUnknowns[0] || 'The remaining gaps still affect whether the loop can exit.')
        )
        : 'The remaining uncertainty does not block a limitation-qualified answer.'
    };
  }

  function normalizeCurrentScientificState(rawPayload, fallback = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    return {
      supported_now: uniqueStrings([
        ...asArray(source.supported_now),
        ...asArray(fallback.supported_now)
      ], 8),
      contradicted: uniqueStrings([
        ...asArray(source.contradicted),
        ...asArray(fallback.contradicted)
      ], 8),
      remains_unknown: uniqueStrings([
        ...asArray(source.remains_unknown),
        ...asArray(fallback.remains_unknown)
      ], 8),
      uncertainty_decision_relevant: source.uncertainty_decision_relevant === true
        || (source.uncertainty_decision_relevant !== false && fallback.uncertainty_decision_relevant === true),
      uncertainty_decision_reason: cleanText(source.uncertainty_decision_reason, 320)
        || cleanText(fallback.uncertainty_decision_reason, 320)
        || 'The remaining uncertainty has not been assessed yet.'
    };
  }

  function buildCurrentScientificStatePrompt(input = {}) {
    return [
      'Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.',
      'Keep it compact and grounded only in the provided evidence.',
      'List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.',
      'Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.',
      `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
      `Exit criteria JSON:\n${JSON.stringify(input.exitCriteria || {}, null, 2)}`,
      input.preSynthesizedQuestion
        ? `Pre-synthesized question JSON:\n${JSON.stringify(buildPreSynthesizedQuestion(input), null, 2)}`
        : '',
      input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
      input.clarification ? `Clarification JSON:\n${JSON.stringify(input.clarification, null, 2)}` : '',
      `Original user message:\n${cleanText(input.originalMessage, 3200)}`,
      `Clarified request:\n${cleanText(input.message || input.clarifiedInput, 3200)}`,
      `Latest assistant text:\n${cleanText(input.latestAssistantText, 4000) || '-'}`,
      `Latest tool result JSON:\n${JSON.stringify(input.latestToolResult || null, null, 2)}`,
      `Tool trace JSON:\n${JSON.stringify(asArray(input.toolTrace).slice(-8), null, 2)}`,
      `Citations JSON:\n${JSON.stringify(asArray(input.citations).slice(0, 16), null, 2)}`,
      `Rounds executed: ${Number(input.roundsExecuted) || 0}/${Number(input.maxRounds) || 0}`,
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function buildCurrentScientificState(input = {}) {
    const fallback = buildFallbackCurrentScientificState(input);
    if (!requestStructuredJsonPayload) {
      return fallback;
    }

    const result = await requestStructuredJsonPayload({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      stage: 'science_loop_current_scientific_state',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildCurrentScientificStatePrompt(input),
      schema: SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
      traceContext: input.traceContext || null,
      maxOutputTokens: 1200,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Science loop current scientific state generation is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return fallback;
    }
    return normalizeCurrentScientificState(result.payload, fallback);
  }

  return {
    SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
    buildFallbackPreSynthesizedQuestion,
    normalizePreSynthesizedQuestion,
    buildFallbackCurrentScientificState,
    normalizeCurrentScientificState,
    buildCurrentScientificStatePrompt,
    buildCurrentScientificState
  };
}

module.exports = {
  SCIENCE_LOOP_CURRENT_SCIENTIFIC_STATE_SCHEMA,
  createScienceLoopCurrentScientificStateRuntime
};
