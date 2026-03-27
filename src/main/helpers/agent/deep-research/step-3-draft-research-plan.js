'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
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
}

const RESEARCH_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'goal',
    'key_subquestions',
    'search_directions',
    'evidence_types_needed',
    'possible_tools_or_sources',
    'risks_or_uncertainty_areas',
    'synthesis_checkpoints',
    'answer_sections',
    'success_criteria'
  ],
  properties: {
    goal: { type: 'string' },
    key_subquestions: {
      type: 'array',
      items: { type: 'string' }
    },
    search_directions: {
      type: 'array',
      items: { type: 'string' }
    },
    evidence_types_needed: {
      type: 'array',
      items: { type: 'string' }
    },
    possible_tools_or_sources: {
      type: 'array',
      items: { type: 'string' }
    },
    risks_or_uncertainty_areas: {
      type: 'array',
      items: { type: 'string' }
    },
    synthesis_checkpoints: {
      type: 'array',
      items: { type: 'string' }
    },
    answer_sections: {
      type: 'array',
      items: { type: 'string' }
    },
    success_criteria: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

function buildFallbackResearchPlan(input = {}) {
  const intent = cleanText(input.intent, 80);
  const clarifyResult = input.clarifyResult && typeof input.clarifyResult === 'object' ? input.clarifyResult : {};
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const goal = cleanText(clarifyResult.research_goal, 1200) || cleanText(input.message, 1200) || 'Research the user request.';
  const baseSubquestions = [
    `What is the core answer to: ${goal}`,
    'What evidence best supports the answer?',
    'What caveats, contradictions, or open gaps remain?'
  ];
  if (intent === 'project_science_question') {
    baseSubquestions.unshift('What do the internal project records already show?');
  }
  if (intent === 'result_analysis') {
    baseSubquestions.unshift('What does the available result data imply before interpretation?');
  }
  return {
    goal,
    key_subquestions: uniqueStrings(baseSubquestions, 6),
    search_directions: uniqueStrings([
      intent === 'project_science_question' ? 'Start from local project records before expanding outward.' : '',
      intent === 'result_analysis' ? 'Inspect computational or quantitative evidence before external interpretation.' : '',
      'Use targeted literature retrieval for external grounding if local evidence is insufficient.',
      'Preserve evidence pointers and contradictions while collecting findings.'
    ], 6),
    evidence_types_needed: uniqueStrings([
      intent === 'project_science_question' ? 'Internal project records' : '',
      intent === 'result_analysis' ? 'Computation or structured result analysis' : '',
      'Grounded external evidence',
      'Explicit uncertainty notes'
    ], 6),
    possible_tools_or_sources: uniqueStrings([
      ...asArray(policy.tool_scope),
      ...asArray(input.toolScope)
    ], 8),
    risks_or_uncertainty_areas: uniqueStrings([
      'Evidence may be incomplete or conflicting.',
      'Compression may lose source attribution unless evidence is preserved.',
      clarifyResult.time_sensitive === true ? 'Recent evidence may shift quickly.' : ''
    ], 6),
    synthesis_checkpoints: uniqueStrings([
      'Checkpoint 1: at least one grounded finding for each key subquestion.',
      'Checkpoint 2: contradiction and uncertainty pass before drafting.',
      'Checkpoint 3: outline coverage confirmed before final synthesis.'
    ], 6),
    answer_sections: uniqueStrings([
      clarifyResult.request_type === 'decision' ? 'Recommendation' : 'Direct Answer',
      'Key Evidence',
      'Uncertainty and Gaps',
      'Suggested Next Steps'
    ], 6),
    success_criteria: uniqueStrings([
      'The answer is supported by grounded evidence.',
      'Uncertainty and contradictions are preserved rather than flattened.',
      'The final synthesis covers the planned sections.'
    ], 6)
  };
}

function normalizeResearchPlan(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    goal: cleanText(source.goal, 1200) || cleanText(fallback.goal, 1200) || 'Research the user request.',
    key_subquestions: uniqueStrings([
      ...asArray(source.key_subquestions),
      ...asArray(fallback.key_subquestions)
    ], 8),
    search_directions: uniqueStrings([
      ...asArray(source.search_directions),
      ...asArray(fallback.search_directions)
    ], 8),
    evidence_types_needed: uniqueStrings([
      ...asArray(source.evidence_types_needed),
      ...asArray(fallback.evidence_types_needed)
    ], 8),
    possible_tools_or_sources: uniqueStrings([
      ...asArray(source.possible_tools_or_sources),
      ...asArray(fallback.possible_tools_or_sources)
    ], 8),
    risks_or_uncertainty_areas: uniqueStrings([
      ...asArray(source.risks_or_uncertainty_areas),
      ...asArray(fallback.risks_or_uncertainty_areas)
    ], 8),
    synthesis_checkpoints: uniqueStrings([
      ...asArray(source.synthesis_checkpoints),
      ...asArray(fallback.synthesis_checkpoints)
    ], 8),
    answer_sections: uniqueStrings([
      ...asArray(source.answer_sections),
      ...asArray(fallback.answer_sections)
    ], 8),
    success_criteria: uniqueStrings([
      ...asArray(source.success_criteria),
      ...asArray(fallback.success_criteria)
    ], 8)
  };
}

function buildResearchPlanPrompt(input = {}) {
  return [
    'Draft a deep research plan before execution.',
    'Include key subquestions, search directions, evidence types, likely tools/sources, risks, synthesis checkpoints, answer sections, and success criteria.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    `Clarification JSON:\n${JSON.stringify(input.clarifyResult || {}, null, 2)}`,
    `Policy JSON:\n${JSON.stringify(input.policy || {}, null, 2)}`,
    input.project ? `Resolved project JSON:\n${JSON.stringify(input.project, null, 2)}` : '',
    `User message:\n${cleanText(input.message, 3200)}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

async function runStep3DraftResearchPlan(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const fallback = buildFallbackResearchPlan(input);
  if (!requestStructuredJsonPayload) {
    return fallback;
  }
  const result = await requestStructuredJsonPayload({
    provider: cleanText(input.provider, 80),
    endpoint: cleanText(input.endpoint, 2000),
    apiKey: cleanText(input.apiKey, 400),
    model: cleanText(input.model, 120),
    stage: 'deep_research_step_3_plan',
    systemPrompt: 'Return valid JSON only.',
    userPrompt: buildResearchPlanPrompt(input),
    schema: RESEARCH_PLAN_SCHEMA,
    traceContext: input.traceContext || null,
    maxOutputTokens: 1800,
    openAiStrict: true,
    openAiAsDefaultProvider: true,
    defaultError: 'Deep research planning step is not configured.'
  });
  if (!result?.ok || !result.payload) {
    return fallback;
  }
  return normalizeResearchPlan(result.payload, fallback);
}

module.exports = {
  runStep3DraftResearchPlan
};
