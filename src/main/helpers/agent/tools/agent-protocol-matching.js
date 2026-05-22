'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function createProtocolMatchingRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  const PROTOCOL_TIEBREAK_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['selected_protocol_id', 'selected_protocol_name', 'rationale'],
    properties: {
      selected_protocol_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      selected_protocol_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      rationale: { type: 'string' }
    }
  };

  const PROTOCOL_TO_NOTEBOOK_SELECTION_SYSTEM_PROMPT = [
    'You are the protocol selector for notebook generation.',
    'Use the detailed candidate protocol records provided by the app.',
    'Choose exactly one best protocol and return JSON only.'
  ].join(' ');

  const PROTOCOL_TO_NOTEBOOK_SELECTION_RULES = [
    'Select one protocol that best matches the user request for notebook generation.',
    'Prioritize: exact name/alias match, activity-to-step overlap, entity consistency, project consistency.',
    'If one candidate is clearly best from the provided evidence, select it directly and do not be over-cautious.',
    'Use only candidate protocols provided in input.',
    'Do not invent protocol IDs or names.',
    'Return a concise rationale.'
  ];
  const MIN_PROTOCOL_MATCH_SCORE = 24;

  function buildProtocolTieBreakPrompt({
    message = '',
    conversation = [],
    parserPayload = {},
    rankedMatches = []
  } = {}) {
    const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(row?.text, 1200);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    const rankedPreview = asArray(rankedMatches).slice(0, 3).map((item) => ({
      id: item?.id,
      name: item?.name,
      purpose: item?.purpose,
      steps: asArray(item?.steps).slice(0, 8).map((step) => ({
        id: step?.id,
        text: step?.text
      }))
    }));
    const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    return [
      ...PROTOCOL_TO_NOTEBOOK_SELECTION_RULES,
      `User message: ${cleanText(message, 3000)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser entities JSON:\n${JSON.stringify(parserEntities, null, 2)}`,
      `Detailed protocol candidates JSON:\n${JSON.stringify(rankedPreview, null, 2)}`
    ].filter(Boolean).join('\n\n');
  }

  function normalizeProtocolStep(step, index = 0) {
    const source = step && typeof step === 'object' ? step : {};
    const stepId = cleanText(source.id, 120) || `step-${index + 1}`;
    const text = cleanText(source.text || source.instruction || source.action, 1600);
    const placeholders = asArray(source.placeholders).map((placeholder, placeholderIndex) => ({
      id: cleanText(placeholder?.id, 120) || `${stepId}-ph-${placeholderIndex + 1}`,
      name: cleanText(placeholder?.name, 120) || 'value'
    })).filter((item) => item.id);
    return {
      id: stepId,
      text,
      placeholders
    };
  }

  function normalizeProtocolRecord(protocol, index = 0) {
    const source = protocol && typeof protocol === 'object' ? protocol : {};
    const id = cleanText(source.id, 120) || `protocol-${index + 1}`;
    const name = cleanText(source.name, 220);
    const purpose = cleanText(source.purpose || source.description, 700);
    const materials = asArray(source.materials).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 30);
    const troubleshooting = cleanText(source.troubleshooting, 700);
    const steps = asArray(source.steps).map((step, stepIndex) => normalizeProtocolStep(step, stepIndex)).slice(0, 120);
    const aliases = uniqueStrings(source.aliases, 8);
    return {
      id,
      name,
      purpose,
      materials,
      troubleshooting,
      steps,
      aliases,
      project_id: cleanText(source.projectId || source.project_id, 120),
      project_name: cleanText(source.projectName || source.project_name, 220)
    };
  }

  function tokenizeTextForMatch(value, maxTokens = 20) {
    const text = cleanText(value, 2000).toLowerCase();
    if (!text) {
      return [];
    }
    return uniqueStrings(
      text.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter((token) => token.length >= 2),
      maxTokens
    );
  }

  function countTokenOverlap(leftTokens, rightTokens) {
    const rightSet = new Set(asArray(rightTokens).map((token) => cleanText(token, 40).toLowerCase()).filter(Boolean));
    return asArray(leftTokens).reduce((count, token) => {
      const normalized = cleanText(token, 40).toLowerCase();
      if (!normalized) {
        return count;
      }
      return rightSet.has(normalized) ? count + 1 : count;
    }, 0);
  }

  function scoreProtocolCandidate(candidateName, protocolRecord) {
    const candidate = cleanText(candidateName, 220);
    if (!candidate) {
      return 0;
    }
    const candidateLower = candidate.toLowerCase();
    const protocolName = cleanText(protocolRecord?.name, 220);
    const protocolNameLower = protocolName.toLowerCase();
    const protocolAliases = asArray(protocolRecord?.aliases).map((alias) => cleanText(alias, 220).toLowerCase()).filter(Boolean);
    const protocolTokens = tokenizeTextForMatch([
      protocolName,
      ...protocolAliases,
      cleanText(protocolRecord?.purpose, 300)
    ].join(' '), 40);
    const candidateTokens = tokenizeTextForMatch(candidate, 20);

    let score = 0;
    if (candidateLower && protocolNameLower && candidateLower === protocolNameLower) {
      score += 120;
    } else if (candidateLower && protocolNameLower && protocolNameLower.includes(candidateLower)) {
      score += 80;
    }
    if (protocolAliases.includes(candidateLower)) {
      score += 70;
    }
    if (candidateLower && protocolAliases.some((alias) => alias.includes(candidateLower))) {
      score += 35;
    }
    const overlap = countTokenOverlap(candidateTokens, protocolTokens);
    score += Math.min(45, overlap * 12);
    return score;
  }

  function rankProtocolMatches({
    protocols = [],
    protocolCandidates = [],
    message = '',
    parserPayload = {}
  } = {}) {
    const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    const activityHint = cleanText(parserEntities.activity_type, 180);
    const workflowHint = cleanText(parserEntities.workflow_step, 180);
    const protocolHint = cleanText(parserEntities.protocol_name, 220);
    const messageTokens = tokenizeTextForMatch([message, activityHint, workflowHint].join(' '), 40);
    const candidateNames = uniqueStrings([
      ...asArray(protocolCandidates),
      protocolHint
    ], 3);

    const ranked = asArray(protocols).map((protocolRecord, index) => {
      const protocol = normalizeProtocolRecord(protocolRecord, index);
      const nameTokens = tokenizeTextForMatch(protocol.name, 30);
      const purposeTokens = tokenizeTextForMatch(protocol.purpose, 30);
      const stepTokens = tokenizeTextForMatch(
        asArray(protocol.steps).slice(0, 8).map((step) => step.text).join(' '),
        40
      );
      let score = 0;
      candidateNames.forEach((candidate) => {
        score += scoreProtocolCandidate(candidate, protocol);
      });
      score += Math.min(24, countTokenOverlap(messageTokens, nameTokens) * 6);
      score += Math.min(16, countTokenOverlap(messageTokens, purposeTokens) * 4);
      score += Math.min(12, countTokenOverlap(messageTokens, stepTokens) * 3);
      if (protocolHint && protocol.name.toLowerCase() === protocolHint.toLowerCase()) {
        score += 40;
      }
      return {
        ...protocol,
        score
      };
    });

    return ranked
      .filter((item) => item.score > 0 && (item.name || item.id))
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
  }

  function hasDeterministicProtocolWinner(matches = []) {
    if (matches.length <= 1) {
      return matches.length === 1;
    }
    const top = Number(matches[0]?.score) || 0;
    const second = Number(matches[1]?.score) || 0;
    return top >= 95 || ((top - second) >= 12 && top >= 58);
  }

  function findProtocolBySelection(protocols, selectedId, selectedName) {
    const id = cleanText(selectedId, 120);
    const name = cleanText(selectedName, 220).toLowerCase();
    if (id) {
      const exactById = asArray(protocols).find((item) => cleanText(item?.id, 120) === id);
      if (exactById) {
        return exactById;
      }
    }
    if (name) {
      const exactByName = asArray(protocols).find((item) => cleanText(item?.name, 220).toLowerCase() === name);
      if (exactByName) {
        return exactByName;
      }
      const partialByName = asArray(protocols).find((item) => cleanText(item?.name, 220).toLowerCase().includes(name));
      if (partialByName) {
        return partialByName;
      }
    }
    return null;
  }

  function mapCandidateMatchesForOutput(matches) {
    return asArray(matches).slice(0, 5).map((item) => ({
      id: cleanText(item?.id, 120),
      name: cleanText(item?.name, 220),
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0
    })).filter((item) => item.id || item.name);
  }

  async function resolveProtocolWinner({
    provider,
    endpoint,
    apiKey,
    model,
    matches,
    message,
    conversation,
    parserPayload,
    traceContext = null
  }) {
    const ranked = asArray(matches).slice(0, 5);
    if (!ranked.length) {
      return {
        selected: null,
        selection_method: 'none',
        rationale: 'No protocol candidates matched local records.'
      };
    }
    if (hasDeterministicProtocolWinner(ranked)) {
      return {
        selected: ranked[0],
        selection_method: 'deterministic',
        rationale: 'Deterministic score margin selected the protocol.'
      };
    }

    const llmResult = await requestStructuredJsonPayload({
      stage: 'protocol_tiebreak_llm',
      systemPrompt: PROTOCOL_TO_NOTEBOOK_SELECTION_SYSTEM_PROMPT,
      userPrompt: buildProtocolTieBreakPrompt({
        message,
        conversation,
        parserPayload,
        rankedMatches: ranked
      }),
      schema: PROTOCOL_TIEBREAK_RESPONSE_SCHEMA,
      traceContext,
      defaultError: 'Protocol selection model is not configured.'
    });

    if (!llmResult.ok || !llmResult.payload) {
      return {
        selected: ranked[0],
        selection_method: 'deterministic_fallback',
        rationale: cleanText(llmResult.error, 260) || 'LLM tie-break failed; selected highest deterministic rank.'
      };
    }

    const selected = findProtocolBySelection(
      ranked,
      llmResult.payload.selected_protocol_id,
      llmResult.payload.selected_protocol_name
    );
    if (!selected) {
      return {
        selected: ranked[0],
        selection_method: 'deterministic_fallback',
        rationale: 'LLM tie-break did not map to a known candidate; selected highest deterministic rank.'
      };
    }
    return {
      selected,
      selection_method: 'llm_tiebreak',
      rationale: cleanText(llmResult.payload.rationale, 260) || 'LLM tie-break selected best protocol.'
    };
  }

  async function selectProtocol({
    provider,
    endpoint,
    apiKey,
    model,
    protocols = [],
    protocolCandidates = [],
    message = '',
    conversation = [],
    parserPayload = {},
    fallbackProtocol = null,
    traceContext = null
  } = {}) {
    const normalizedProtocols = asArray(protocols).map((item, index) => normalizeProtocolRecord(item, index));
    let rankedMatches = rankProtocolMatches({
      protocols: normalizedProtocols,
      protocolCandidates,
      message,
      parserPayload
    }).filter((item) => (Number(item?.score) || 0) >= MIN_PROTOCOL_MATCH_SCORE);

    if (!rankedMatches.length && fallbackProtocol && typeof fallbackProtocol === 'object') {
      const carryOver = findProtocolBySelection(
        normalizedProtocols,
        fallbackProtocol.id,
        fallbackProtocol.name
      );
      if (carryOver) {
        return {
          ranked_matches: [{ ...carryOver, score: 1 }],
          selected_protocol: normalizeProtocolRecord(carryOver),
          selection_method: 'pending_session',
          rationale: 'Used the pending protocol selection from the previous notebook session.'
        };
      }
    }

    if (!rankedMatches.length) {
      return {
        ranked_matches: [],
        selected_protocol: null,
        selection_method: 'none',
        rationale: 'No protocol candidates matched local records.'
      };
    }

    const winner = await resolveProtocolWinner({
      provider,
      endpoint,
      apiKey,
      model,
      matches: rankedMatches,
      message,
      conversation,
      parserPayload,
      traceContext
    });

    return {
      ranked_matches: rankedMatches,
      selected_protocol: winner.selected ? normalizeProtocolRecord(winner.selected) : null,
      selection_method: cleanText(winner.selection_method, 80) || 'deterministic',
      rationale: cleanText(winner.rationale, 260) || 'Protocol match selected.'
    };
  }

  return {
    PROTOCOL_TO_NOTEBOOK_SELECTION_SYSTEM_PROMPT,
    PROTOCOL_TO_NOTEBOOK_SELECTION_RULES,
    normalizeProtocolStep,
    normalizeProtocolRecord,
    rankProtocolMatches,
    hasDeterministicProtocolWinner,
    findProtocolBySelection,
    mapCandidateMatchesForOutput,
    buildProtocolTieBreakPrompt,
    resolveProtocolWinner,
    selectProtocol
  };
}

module.exports = {
  createProtocolMatchingRuntime
};
