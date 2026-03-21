'use strict';

function createProtocolNotebookRuntime(deps = {}) {
  const LLM_PROVIDERS = deps.LLM_PROVIDERS && typeof deps.LLM_PROVIDERS === 'object'
    ? deps.LLM_PROVIDERS
    : {};
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 50) => {
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
  const pickTopMatches = typeof deps.pickTopMatches === 'function'
    ? deps.pickTopMatches
    : ((items) => asArray(items).slice(0, 1));
  const safeParseJson = typeof deps.safeParseJson === 'function'
    ? deps.safeParseJson
    : ((text, fallback = null) => {
      try {
        const parsed = JSON.parse(String(text || ''));
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        // Fallback below.
      }
      return fallback;
    });
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const requestClaudeMessagesWithBackoff = deps.requestClaudeMessagesWithBackoff;
  const requestGeminiGenerateContentWithBackoff = deps.requestGeminiGenerateContentWithBackoff;
  const requestOpenAiResponsesWithBackoff = deps.requestOpenAiResponsesWithBackoff;
  const extractClaudeResponseText = typeof deps.extractClaudeResponseText === 'function'
    ? deps.extractClaudeResponseText
    : (() => '');
  const extractGeminiResponseText = typeof deps.extractGeminiResponseText === 'function'
    ? deps.extractGeminiResponseText
    : (() => '');
  const extractResponseText = typeof deps.extractResponseText === 'function'
    ? deps.extractResponseText
    : (() => '');
  const toInputText = typeof deps.toInputText === 'function'
    ? deps.toInputText
    : ((role, text) => ({
      role,
      content: [{ type: 'input_text', text: String(text || '') }]
    }));
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  const PROTOCOL_PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const PROTOCOL_INLINE_PLACEHOLDER_REGEX = /\[([^[\]]{1,80})\]/g;
  const PROTOCOL_NOTEBOOK_SESSION_TTL_MS = 30 * 60 * 1000;
  const protocolNotebookPendingSessions = new Map();
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

  const PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['filled_values', 'missing_placeholders', 'follow_up_questions', 'result_summary'],
  properties: {
    filled_values: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['placeholder_key', 'value', 'source'],
        properties: {
          placeholder_key: { type: 'string' },
          value: { type: 'string' },
          source: { type: 'string' }
        }
      }
    },
    missing_placeholders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['placeholder_key', 'reason'],
        properties: {
          placeholder_key: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    follow_up_questions: {
      type: 'array',
      items: { type: 'string' }
    },
    result_summary: { anyOf: [{ type: 'string' }, { type: 'null' }] }
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

  const PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT = [
    'You generate a protocol-based notebook draft.',
    'Use the selected protocol, user context, and optional tool evidence.',
    'Fill placeholders only when supported by evidence.',
    'Return JSON only.'
  ].join(' ');

  const PROTOCOL_TO_NOTEBOOK_FILL_RULES = [
    'Fill placeholders using evidence priority: user message, recent conversation, parser entities, project context, optional tool context.',
    'Extract exact value spans from the latest user text when they semantically match unresolved placeholders.',
    'Prefer exact copy of entity strings from user text, including punctuation and hyphenated identifiers.',
    'When unresolved placeholders already exist and the latest user message is a direct answer, map it to the best matching unresolved placeholder.',
    'filled_values.placeholder_key must exactly match one of the provided placeholder_key values.',
    'If optional tool context is provided, use it only when directly relevant.',
    'Do not fabricate values.',
    'Ask follow_up_questions only when ambiguity remains after using user text, conversation, parser data, and optional tool context.',
    'For unresolved placeholders, return missing_placeholders and concise follow_up_questions.'
  ];

  const PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES = [
    [
      'Example single-turn:',
      'User message: "I did pET28a-SUMO1 transformation today."',
      'Given one unresolved placeholder for a named construct/plasmid, fill it immediately by copying "pET28a-SUMO1" exactly into filled_values.'
    ].join(' '),
    [
      'Example follow-up:',
      'If a previous turn left one unresolved placeholder and user now says "It was pET28a-SUMO1",',
      'treat this as a direct answer and return that exact value for the unresolved placeholder_key.'
    ].join(' ')
  ];

function buildProtocolNotebookSessionKey({
  projectId = '',
  projectName = ''
} = {}) {
  const keyProjectId = cleanText(projectId, 80).toLowerCase();
  const keyProjectName = cleanText(projectName, 180).toLowerCase();
  return [keyProjectId || '-', keyProjectName || '-'].join('::');
}

function getPendingProtocolNotebookSession(sessionKey) {
  const key = cleanText(sessionKey, 320);
  if (!key) {
    return null;
  }
  const existing = protocolNotebookPendingSessions.get(key);
  if (!existing || typeof existing !== 'object') {
    return null;
  }
  const createdAt = Date.parse(existing.updated_at || existing.created_at || '');
  if (!Number.isFinite(createdAt)) {
    protocolNotebookPendingSessions.delete(key);
    return null;
  }
  if ((Date.now() - createdAt) > PROTOCOL_NOTEBOOK_SESSION_TTL_MS) {
    protocolNotebookPendingSessions.delete(key);
    return null;
  }
  return existing;
}

function setPendingProtocolNotebookSession(sessionKey, session) {
  const key = cleanText(sessionKey, 320);
  if (!key || !session || typeof session !== 'object') {
    return;
  }
  protocolNotebookPendingSessions.set(key, {
    ...session,
    updated_at: new Date().toISOString()
  });
}

function clearPendingProtocolNotebookSession(sessionKey) {
  const key = cleanText(sessionKey, 320);
  if (!key) {
    return;
  }
  protocolNotebookPendingSessions.delete(key);
}

function hasPendingProtocolNotebookSession(sessionKey) {
  return Boolean(getPendingProtocolNotebookSession(sessionKey));
}

function normalizeProtocolStepForAgent(step, index = 0) {
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

function normalizeProtocolRecordForAgent(protocol, index = 0) {
  const source = protocol && typeof protocol === 'object' ? protocol : {};
  const id = cleanText(source.id, 120) || `protocol-${index + 1}`;
  const name = cleanText(source.name, 220);
  const purpose = cleanText(source.purpose || source.description, 700);
  const materials = asArray(source.materials).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 30);
  const troubleshooting = cleanText(source.troubleshooting, 700);
  const steps = asArray(source.steps).map((step, stepIndex) => normalizeProtocolStepForAgent(step, stepIndex)).slice(0, 120);
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

  const ranked = asArray(protocols).map((protocolRecord) => {
    const protocol = normalizeProtocolRecordForAgent(protocolRecord);
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

function parseJsonObjectFromText(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const parsed = safeParseJson(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

async function requestStructuredJsonPayload({
  provider,
  endpoint,
  apiKey,
  model,
  stage,
  systemPrompt,
  userPrompt,
  schema,
  traceContext = null
}) {
  const system = cleanText(systemPrompt, 12000);
  const user = cleanText(userPrompt, 48000);
  const normalizedStage = cleanText(stage, 120) || 'agent_stage';
  try {
    if (provider === LLM_PROVIDERS.CODEX) {
      const prompt = [
        system,
        user,
        'Return JSON only.'
      ].filter(Boolean).join('\n\n');
      const raw = await requestCodexCliText({
        prompt,
        model,
        cwd: getCodexCliWorkingDirectory()
      });
      await recordAgentLlmTrace(traceContext, {
        stage: normalizedStage,
        provider,
        model,
        summary: `${normalizedStage} completed via Codex CLI.`,
        request_payload: {
          model,
          prompt
        },
        response_payload: raw
      });
      const parsed = parseJsonObjectFromText(raw);
      if (!parsed) {
        return {
          ok: false,
          error: `${normalizedStage} response was not valid JSON.`,
          raw
        };
      }
      return {
        ok: true,
        payload: parsed,
        raw
      };
    }

    if (provider === LLM_PROVIDERS.CLAUDE) {
      const body = {
        model,
        system: system || 'Return valid JSON only.',
        max_tokens: 1300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${user}\n\nReturn JSON only.`
              }
            ]
          }
        ]
      };
      const response = await requestClaudeMessagesWithBackoff({
        endpoint,
        apiKey,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: normalizedStage,
        provider,
        model,
        summary: `${normalizedStage} completed via Claude.`,
        request_payload: body,
        response_payload: response
      });
      const parsed = parseJsonObjectFromText(extractClaudeResponseText(response));
      if (!parsed) {
        return {
          ok: false,
          error: `${normalizedStage} response was not valid JSON.`,
          raw: response
        };
      }
      return {
        ok: true,
        payload: parsed,
        raw: response
      };
    }

    if (provider === LLM_PROVIDERS.GEMINI) {
      const body = {
        systemInstruction: {
          parts: [{ text: system || 'Return valid JSON only.' }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: `${user}\n\nReturn JSON only.` }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1300
        }
      };
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint,
        apiKey,
        model,
        body
      });
      await recordAgentLlmTrace(traceContext, {
        stage: normalizedStage,
        provider,
        model,
        summary: `${normalizedStage} completed via Gemini.`,
        request_payload: body,
        response_payload: response
      });
      const parsed = parseJsonObjectFromText(extractGeminiResponseText(response));
      if (!parsed) {
        return {
          ok: false,
          error: `${normalizedStage} response was not valid JSON.`,
          raw: response
        };
      }
      return {
        ok: true,
        payload: parsed,
        raw: response
      };
    }

    const body = {
      model,
      input: [
        toInputText('system', system || 'Return valid JSON only.'),
        toInputText('user', user)
      ],
      text: {
        format: {
          type: 'json_schema',
          name: normalizedStage.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'stage_result',
          strict: true,
          schema
        }
      },
      max_output_tokens: 1300
    };
    const response = await requestOpenAiResponsesWithBackoff({
      endpoint,
      apiKey,
      body
    });
    await recordAgentLlmTrace(traceContext, {
      stage: normalizedStage,
      provider: LLM_PROVIDERS.OPENAI,
      model,
      summary: `${normalizedStage} completed via OpenAI Responses.`,
      request_payload: body,
      response_payload: response
    });
    const parsed = parseJsonObjectFromText(extractResponseText(response));
    if (!parsed) {
      return {
        ok: false,
        error: `${normalizedStage} response was not valid JSON.`,
        raw: response
      };
    }
    return {
      ok: true,
      payload: parsed,
      raw: response
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanText(error?.message || error, 320) || `${normalizedStage} request failed.`
    };
  }
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

  const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
    const role = row?.role === 'assistant' ? 'assistant' : 'user';
    const text = cleanText(row?.text, 1200);
    return text ? `${index + 1}. ${role}: ${text}` : '';
  }).filter(Boolean).join('\n');
  const rankedPreview = ranked.slice(0, 3).map((item) => ({
    id: item.id,
    name: item.name,
    purpose: item.purpose,
    steps: asArray(item.steps).slice(0, 8).map((step) => ({
      id: step.id,
      text: step.text
    }))
  }));
  const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
    ? parserPayload.entities
    : {};
  const llmResult = await requestStructuredJsonPayload({
    provider,
    endpoint,
    apiKey,
    model,
    stage: 'protocol_tiebreak_llm',
    systemPrompt: PROTOCOL_TO_NOTEBOOK_SELECTION_SYSTEM_PROMPT,
    userPrompt: [
      ...PROTOCOL_TO_NOTEBOOK_SELECTION_RULES,
      `User message: ${cleanText(message, 3000)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser entities JSON:\n${JSON.stringify(parserEntities, null, 2)}`,
      `Detailed protocol candidates JSON:\n${JSON.stringify(rankedPreview, null, 2)}`
    ].filter(Boolean).join('\n\n'),
    schema: PROTOCOL_TIEBREAK_RESPONSE_SCHEMA,
    traceContext
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

function findProjectByName(projects, projectName) {
  const query = cleanText(projectName, 220);
  if (!query) {
    return null;
  }
  const matches = pickTopMatches(
    asArray(projects),
    (project) => `${cleanText(project?.name, 220)} ${cleanText(project?.summary, 400)}`,
    query,
    1
  );
  return matches.length ? matches[0] : null;
}

function resolveNotebookProject({
  snapshot,
  payloadProjectId = '',
  payloadProjectName = '',
  parserPayload = {},
  selectedProtocol = null,
  pendingSession = null
}) {
  const projects = asArray(snapshot?.projects);
  const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
    ? parserPayload.entities
    : {};
  const byId = cleanText(payloadProjectId, 120)
    ? projects.find((project) => cleanText(project?.id, 120) === cleanText(payloadProjectId, 120))
    : null;
  if (byId) {
    return {
      id: cleanText(byId?.id, 120),
      name: cleanText(byId?.name, 220),
      resolution_source: 'payload_project_id'
    };
  }

  const fromPayloadName = findProjectByName(projects, payloadProjectName);
  if (fromPayloadName) {
    return {
      id: cleanText(fromPayloadName?.id, 120),
      name: cleanText(fromPayloadName?.name, 220),
      resolution_source: 'payload_project_name'
    };
  }

  const fromParserEntity = findProjectByName(projects, parserEntities.project_name);
  if (fromParserEntity) {
    return {
      id: cleanText(fromParserEntity?.id, 120),
      name: cleanText(fromParserEntity?.name, 220),
      resolution_source: 'parser_entity'
    };
  }

  const pendingProject = pendingSession?.project && typeof pendingSession.project === 'object'
    ? pendingSession.project
    : null;
  if (pendingProject && (cleanText(pendingProject.id, 120) || cleanText(pendingProject.name, 220))) {
    return {
      id: cleanText(pendingProject.id, 120),
      name: cleanText(pendingProject.name, 220),
      resolution_source: 'pending_session'
    };
  }

  const fromProtocolProjectName = findProjectByName(projects, selectedProtocol?.project_name);
  if (fromProtocolProjectName) {
    return {
      id: cleanText(fromProtocolProjectName?.id, 120),
      name: cleanText(fromProtocolProjectName?.name, 220),
      resolution_source: 'protocol_project_hint'
    };
  }

  if (projects.length === 1) {
    return {
      id: cleanText(projects[0]?.id, 120),
      name: cleanText(projects[0]?.name, 220),
      resolution_source: 'single_project_fallback'
    };
  }

  return {
    id: '',
    name: '',
    resolution_source: 'unresolved'
  };
}

function buildProtocolPlaceholderRows(protocolRecord = {}) {
  const rows = [];
  asArray(protocolRecord.steps).forEach((step) => {
    const stepId = cleanText(step?.id, 120);
    const stepText = cleanText(step?.text, 800);
    const placeholders = asArray(step?.placeholders).map((placeholder) => ({
      id: cleanText(placeholder?.id, 120),
      name: cleanText(placeholder?.name, 120) || 'value'
    })).filter((placeholder) => placeholder.id);

    const matches = [...stepText.matchAll(PROTOCOL_PLACEHOLDER_TOKEN_REGEX)];
    matches.forEach((match) => {
      const matchedId = cleanText(match?.[1], 120);
      if (!matchedId) {
        return;
      }
      if (!placeholders.some((placeholder) => placeholder.id === matchedId)) {
        placeholders.push({
          id: matchedId,
          name: 'value'
        });
      }
    });

    const inlineMatches = [...stepText.matchAll(PROTOCOL_INLINE_PLACEHOLDER_REGEX)];
    inlineMatches.forEach((match, index) => {
      const inlineName = cleanText(match?.[1], 120) || 'value';
      const syntheticId = `inline-${stepId || 'step'}-${index + 1}`;
      if (!placeholders.some((placeholder) => placeholder.id === syntheticId)) {
        placeholders.push({
          id: syntheticId,
          name: inlineName
        });
      }
    });

    placeholders.forEach((placeholder) => {
      const placeholderKey = `${stepId}:${placeholder.id}`;
      rows.push({
        step_id: stepId,
        placeholder_id: placeholder.id,
        placeholder_key: placeholderKey,
        display: placeholder.name || 'value',
        step_text: stepText
      });
    });
  });
  return rows.filter((row) => row.step_id && row.placeholder_id && row.placeholder_key);
}

function inferDeterministicPlaceholderValue({
  placeholder,
  parserPayload,
  project,
  protocol,
  message
}) {
  const display = cleanText(placeholder?.display, 120).toLowerCase();
  const entities = parserPayload?.entities && typeof parserPayload.entities === 'object'
    ? parserPayload.entities
    : {};
  if (!display) {
    return '';
  }
  if (display.includes('date')) {
    return new Date().toISOString().slice(0, 10);
  }
  if (display.includes('project') && cleanText(project?.name, 220)) {
    return cleanText(project.name, 220);
  }
  if (display.includes('protocol') && cleanText(protocol?.name, 220)) {
    return cleanText(protocol.name, 220);
  }
  if ((display.includes('cell') || display.includes('cell line')) && cleanText(entities.cell_line, 120)) {
    return cleanText(entities.cell_line, 120);
  }
  if ((display.includes('workflow') || display.includes('step')) && cleanText(entities.workflow_step, 180)) {
    return cleanText(entities.workflow_step, 180);
  }
  if ((display.includes('activity') || display.includes('task')) && cleanText(entities.activity_type, 180)) {
    return cleanText(entities.activity_type, 180);
  }
  if (display.includes('sample')) {
    const sampleMatch = String(message || '').match(/\b(sample|tube|clone)\s+([A-Za-z0-9._-]{2,40})/i);
    if (sampleMatch) {
      return cleanText(sampleMatch[2], 120);
    }
  }
  return '';
}

function resolveCanonicalPlaceholderKey(row = {}, knownPlaceholderMap = new Map()) {
  const normalizedMap = new Map();
  const byDisplay = new Map();
  Array.from(knownPlaceholderMap.entries()).forEach(([key, value]) => {
    const canonicalKey = cleanText(key, 160);
    if (!canonicalKey) {
      return;
    }
    const lowerKey = canonicalKey.toLowerCase();
    normalizedMap.set(lowerKey, canonicalKey);
    const display = cleanText(value?.display, 120).toLowerCase();
    if (display) {
      if (!byDisplay.has(display)) {
        byDisplay.set(display, []);
      }
      byDisplay.get(display).push(canonicalKey);
    }
  });

  const directCandidates = [
    cleanText(row?.placeholder_key, 160),
    cleanText(row?.placeholder_id, 120),
    cleanText(row?.key, 160)
  ].filter(Boolean);
  for (const candidate of directCandidates) {
    const direct = normalizedMap.get(candidate.toLowerCase());
    if (direct) {
      return direct;
    }
    if (!candidate.includes(':')) {
      const suffixMatches = Array.from(normalizedMap.keys())
        .filter((key) => key.endsWith(`:${candidate.toLowerCase()}`))
        .map((key) => normalizedMap.get(key))
        .filter(Boolean);
      if (suffixMatches.length === 1) {
        return suffixMatches[0];
      }
    }
  }

  const displayCandidates = [
    cleanText(row?.display, 120),
    cleanText(row?.name, 120),
    cleanText(row?.placeholder_name, 120)
  ].filter(Boolean).map((value) => value.toLowerCase());
  for (const display of displayCandidates) {
    const matches = byDisplay.get(display) || [];
    if (matches.length === 1) {
      return matches[0];
    }
  }
  return '';
}

function normalizeNotebookFillPayload(rawPayload, knownPlaceholderMap = new Map()) {
  const parsed = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const filledValues = [];
  const seenFilled = new Set();
  asArray(parsed.filled_values).forEach((row) => {
    const placeholderKey = resolveCanonicalPlaceholderKey(row, knownPlaceholderMap);
    const value = cleanText(row?.value, 260);
    if (!placeholderKey || !value) {
      return;
    }
    const dedupeKey = placeholderKey.toLowerCase();
    if (seenFilled.has(dedupeKey)) {
      return;
    }
    seenFilled.add(dedupeKey);
    filledValues.push({
      placeholder_key: placeholderKey,
      value,
      source: cleanText(row?.source, 120) || 'llm'
    });
  });

  const missingPlaceholders = [];
  const seenMissing = new Set();
  asArray(parsed.missing_placeholders).forEach((row) => {
    const placeholderKey = resolveCanonicalPlaceholderKey(row, knownPlaceholderMap);
    if (!placeholderKey) {
      return;
    }
    const dedupeKey = placeholderKey.toLowerCase();
    if (seenMissing.has(dedupeKey)) {
      return;
    }
    seenMissing.add(dedupeKey);
    missingPlaceholders.push({
      placeholder_key: placeholderKey,
      reason: cleanText(row?.reason, 220) || 'Missing information from user request.'
    });
  });

  return {
    filled_values: filledValues,
    missing_placeholders: missingPlaceholders,
    follow_up_questions: uniqueStrings(asArray(parsed.follow_up_questions), 8).map((item) => cleanText(item, 260)).filter(Boolean),
    result_summary: cleanText(parsed.result_summary, 900)
  };
}

function buildProtocolPlaceholderToolQuery({
  parserPayload = {},
  unresolvedPlaceholders = [],
  message = ''
} = {}) {
  const entities = parserPayload?.entities && typeof parserPayload.entities === 'object'
    ? parserPayload.entities
    : {};
  const inventorySearch = parserPayload?.inventory_search && typeof parserPayload.inventory_search === 'object'
    ? parserPayload.inventory_search
    : {};

  const unresolvedTerms = asArray(unresolvedPlaceholders)
    .map((row) => cleanText(row?.display || row?.placeholder_key, 120))
    .filter(Boolean)
    .filter((value) => /\b(buffer|reagent|compound|chemical|inventory|stock|protein)\b/i.test(value))
    .slice(0, 3);

  const candidateQueries = uniqueStrings([
    cleanText(inventorySearch.normalized_query, 220),
    ...asArray(inventorySearch.candidate_terms).slice(0, 4),
    cleanText(entities.inventory_item, 220),
    cleanText(entities.compound_name, 220),
    cleanText(entities.protein_name, 220),
    ...unresolvedTerms,
    cleanText(message, 220)
  ], 10);

  return cleanText(candidateQueries[0], 220);
}

async function maybeLookupProtocolPlaceholderToolContext({
  snapshot,
  parserPayload,
  unresolvedPlaceholders,
  message,
  traceContext = null,
  lifecycleRecorder = null
}) {
  if (typeof runTool !== 'function') {
    return null;
  }
  const query = buildProtocolPlaceholderToolQuery({
    parserPayload,
    unresolvedPlaceholders,
    message
  });
  if (!query) {
    return null;
  }

  const args = {
    query,
    limit: 5,
    normalized_query: query,
    search_terms: [query],
    search_mode: 'exact_then_alias_then_fuzzy'
  };
  try {
    const toolResult = await runTool('search_inventory', args, snapshot, {
      allowWriteTools: false
    });
    const items = asArray(toolResult?.items).slice(0, 5).map((item) => ({
      kind: cleanText(item?.kind, 40),
      id: cleanText(item?.id, 120),
      name: cleanText(item?.name, 220),
      quantity: cleanText(item?.quantity, 80),
      amount: cleanText(item?.amount, 80),
      location: cleanText(item?.location, 180),
      supplier: cleanText(item?.supplier, 180),
      matched_term: cleanText(item?.matched_term, 120)
    }));
    const summary = cleanText(toolResult?.summary, 320);
    await recordAgentLlmTrace(traceContext, {
      stage: 'protocol_placeholder_tool_lookup',
      summary: summary || `Placeholder tool lookup completed with ${items.length} inventory records.`,
      request_payload: {
        tool: 'search_inventory',
        args
      },
      response_payload: {
        item_count: items.length,
        items
      }
    });
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'protocol_placeholder_tool_lookup',
      status: 'ok',
      message: summary || `Resolved ${items.length} inventory records for placeholder context.`,
      meta: {
        tool_name: 'search_inventory',
        query,
        item_count: items.length
      }
    });
    return {
      tool_name: 'search_inventory',
      query,
      summary,
      items
    };
  } catch (error) {
    const errorMessage = cleanText(error?.message || error, 320) || 'Placeholder tool lookup failed.';
    await recordAgentLlmTrace(traceContext, {
      stage: 'protocol_placeholder_tool_lookup',
      summary: errorMessage,
      request_payload: {
        tool: 'search_inventory',
        args
      },
      response_payload: {
        error: errorMessage
      }
    });
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'protocol_placeholder_tool_lookup',
      status: 'failed',
      message: errorMessage,
      meta: {
        tool_name: 'search_inventory',
        query
      }
    });
    return null;
  }
}

async function requestNotebookPlaceholderFill({
  provider,
  endpoint,
  apiKey,
  model,
  message,
  conversation,
  parserPayload,
  selectedProtocol,
  project,
  placeholders,
  unresolvedPlaceholders,
  toolContext = null,
  traceContext = null
}) {
  const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
    const role = row?.role === 'assistant' ? 'assistant' : 'user';
    const text = cleanText(row?.text, 1200);
    return text ? `${index + 1}. ${role}: ${text}` : '';
  }).filter(Boolean).join('\n');
  const llmResult = await requestStructuredJsonPayload({
    provider,
    endpoint,
    apiKey,
    model,
    stage: 'notebook_fill',
    systemPrompt: PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
    userPrompt: [
      ...PROTOCOL_TO_NOTEBOOK_FILL_RULES,
      ...PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES,
      `User message: ${cleanText(message, 3200)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Selected protocol JSON:\n${JSON.stringify({
        id: selectedProtocol?.id,
        name: selectedProtocol?.name,
        purpose: selectedProtocol?.purpose,
        steps: asArray(selectedProtocol?.steps).slice(0, 40)
      }, null, 2)}`,
      `Resolved project JSON:\n${JSON.stringify(project || {}, null, 2)}`,
      toolContext ? `Optional tool context JSON:\n${JSON.stringify(toolContext, null, 2)}` : '',
      `All placeholders JSON:\n${JSON.stringify(placeholders, null, 2)}`,
      `Unresolved placeholders JSON:\n${JSON.stringify(unresolvedPlaceholders, null, 2)}`
    ].filter(Boolean).join('\n\n'),
    schema: PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA,
    traceContext
  });
  return llmResult;
}

function renderProtocolStepText(step, values) {
  const source = cleanText(step?.text, 1600);
  const placeholders = asArray(step?.placeholders).map((placeholder) => ({
    id: cleanText(placeholder?.id, 120),
    name: cleanText(placeholder?.name, 120) || 'value'
  })).filter((placeholder) => placeholder.id);
  const matches = [...source.matchAll(PROTOCOL_PLACEHOLDER_TOKEN_REGEX)];

  if (!matches.length) {
    if (!placeholders.length) {
      return source;
    }
    const trailingValues = placeholders.map((placeholder) => {
      const key = `${cleanText(step?.id, 120)}:${placeholder.id}`;
      const value = cleanText(values?.[key], 260);
      return value || `[${placeholder.name}]`;
    }).join(' ');
    return `${source} ${trailingValues}`.trim();
  }

  let cursor = 0;
  let text = '';
  matches.forEach((match) => {
    const index = Number(match?.index || 0);
    const placeholderId = cleanText(match?.[1], 120);
    const key = `${cleanText(step?.id, 120)}:${placeholderId}`;
    const placeholder = placeholders.find((item) => item.id === placeholderId);
    const value = cleanText(values?.[key], 260);
    text += source.slice(cursor, index);
    text += value || `[${cleanText(placeholder?.name, 120) || 'value'}]`;
    cursor = index + String(match?.[0] || '').length;
  });
  text += source.slice(cursor);
  return text;
}

function buildProtocolNotebookPayload({
  selectedProtocol,
  project,
  placeholders,
  placeholderValuesMap,
  missingPlaceholders,
  message,
  fillSummary = ''
}) {
  const values = {};
  const placeholderValues = [];
  asArray(placeholders).forEach((placeholder) => {
    const key = cleanText(placeholder?.placeholder_key, 160);
    const value = cleanText(placeholderValuesMap?.[key], 260);
    if (!key || !value) {
      return;
    }
    values[key] = value;
    placeholderValues.push({
      step_id: cleanText(placeholder?.step_id, 120),
      placeholder_id: cleanText(placeholder?.placeholder_id, 120),
      placeholder_key: key,
      display: cleanText(placeholder?.display, 120) || 'value',
      value,
      source: 'resolved',
      source_type: 'agent_protocol_v2'
    });
  });
  const unresolvedRows = asArray(missingPlaceholders).map((row) => ({
    step_id: cleanText(row?.step_id, 120),
    placeholder_id: cleanText(row?.placeholder_id, 120),
    placeholder_key: cleanText(row?.placeholder_key, 160),
    display: cleanText(row?.display, 120) || 'value',
    reason: cleanText(row?.reason, 220) || 'Missing information from user request.'
  })).filter((row) => row.step_id && row.placeholder_id && row.placeholder_key);

  const renderedSteps = asArray(selectedProtocol?.steps).map((step) => renderProtocolStepText(step, values)).filter(Boolean);
  const updatedAt = new Date().toISOString();
  const notebookResult = cleanText(fillSummary, 900)
    || `Notebook draft generated from request: ${cleanText(message, 260)}`;

  return {
    protocol: {
      id: cleanText(selectedProtocol?.id, 120),
      name: cleanText(selectedProtocol?.name, 220)
    },
    project: {
      id: cleanText(project?.id, 120),
      name: cleanText(project?.name, 220),
      resolution_source: cleanText(project?.resolution_source, 80)
    },
    notebook_type: 'biology',
    rendered_steps: renderedSteps,
    placeholder_values: placeholderValues,
    unresolved_placeholders: unresolvedRows,
    save: {
      mode: 'auto_save_draft',
      applied: false,
      status: unresolvedRows.length ? 'needs_more_info' : 'ready_for_save',
      reason: unresolvedRows.length
        ? 'Additional placeholder values are required before finalizing draft.'
        : 'Draft is ready for notebook auto-save.'
    },
    entry_template: {
      notebookType: 'biology',
      projectId: cleanText(project?.id, 120),
      projectName: cleanText(project?.name, 220),
      protocolId: cleanText(selectedProtocol?.id, 120),
      protocolName: cleanText(selectedProtocol?.name, 220),
      values,
      result: notebookResult,
      updatedAt,
      resultFiles: [],
      resultFileRecords: [],
      agentDraftStatus: unresolvedRows.length ? 'needs_review' : 'draft_ready',
      agentDraftMeta: {
        source: 'agent_protocol_v2',
        unresolvedCount: unresolvedRows.length,
        generatedAt: updatedAt
      }
    }
  };
}

function mapCandidateMatchesForOutput(matches) {
  return asArray(matches).slice(0, 5).map((item) => ({
    id: cleanText(item?.id, 120),
    name: cleanText(item?.name, 220),
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0
  })).filter((item) => item.id || item.name);
}

function buildMissingPlaceholderQuestion(missingRow = {}) {
  const display = cleanText(missingRow?.display, 120) || cleanText(missingRow?.placeholder_key, 120) || 'value';
  return `Please provide ${display}.`;
}

async function runProtocolToNotebookFlow({
  provider,
  endpoint,
  apiKey,
  model,
  message,
  conversation,
  snapshot,
  parserPayload,
  projectId = '',
  projectName = '',
  traceContext = null,
  lifecycleRecorder = null
}) {
  const protocols = asArray(snapshot?.protocols).map((item, index) => normalizeProtocolRecordForAgent(item, index));
  const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
    ? parserPayload.entities
    : {};
  const sessionKey = buildProtocolNotebookSessionKey({
    projectId,
    projectName,
    parserPayload
  });
  const pendingSession = getPendingProtocolNotebookSession(sessionKey);
  const parserCandidates = uniqueStrings([
    ...asArray(parserPayload?.protocol_candidates),
    cleanText(parserEntities.protocol_name, 220)
  ], 3);
  const protocolCandidates = parserCandidates.length
    ? parserCandidates
    : uniqueStrings([cleanText(pendingSession?.selected_protocol?.name, 220)], 3);

  await recordAgentLlmTrace(traceContext, {
    stage: 'protocol_match_lookup',
    summary: `Protocol lookup candidates=${protocolCandidates.length} local_protocols=${protocols.length}.`,
    request_payload: {
      candidates: protocolCandidates,
      local_protocol_count: protocols.length
    },
    response_payload: {
      has_pending_session: Boolean(pendingSession)
    }
  });

  if (!protocols.length) {
    return {
      status: 'needs_more_info',
      candidate_matches: [],
      selected_protocol: null,
      missing_placeholders: [],
      follow_up_questions: ['No local protocols are available to match. Please add or import a protocol first.'],
      project_name: '',
      notebook: null
    };
  }

  let rankedMatches = rankProtocolMatches({
    protocols,
    protocolCandidates,
    message,
    parserPayload
  });
  if (!rankedMatches.length && pendingSession?.selected_protocol) {
    const carryOver = findProtocolBySelection(
      protocols,
      pendingSession.selected_protocol.id,
      pendingSession.selected_protocol.name
    );
    if (carryOver) {
      rankedMatches = [{ ...carryOver, score: 1 }];
    }
  }

  await recordAgentLlmTrace(traceContext, {
    stage: 'protocol_ranker',
    summary: rankedMatches.length
      ? `Ranked ${rankedMatches.length} protocol matches.`
      : 'No protocol matches were found.',
    request_payload: {
      candidates: protocolCandidates,
      message: cleanText(message, 800)
    },
    response_payload: {
      matches: mapCandidateMatchesForOutput(rankedMatches)
    }
  });

  if (!rankedMatches.length) {
    const clarificationQuestion = protocolCandidates.length
      ? 'I could not find a matching protocol from those candidates. Please provide the protocol name used.'
      : 'Please provide the protocol name so I can generate the notebook draft.';
    return {
      status: 'needs_more_info',
      candidate_matches: [],
      selected_protocol: null,
      missing_placeholders: [],
      follow_up_questions: [clarificationQuestion],
      project_name: '',
      notebook: null
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
  const selectedProtocol = winner.selected
    ? normalizeProtocolRecordForAgent(winner.selected)
    : null;
  if (!selectedProtocol) {
    return {
      status: 'needs_more_info',
      candidate_matches: mapCandidateMatchesForOutput(rankedMatches),
      selected_protocol: null,
      missing_placeholders: [],
      follow_up_questions: ['Please clarify which protocol should be used for this notebook draft.'],
      project_name: '',
      notebook: null
    };
  }

  recordLifecycleEvent(lifecycleRecorder, {
    stage: 'protocol_selected',
    status: 'ok',
    message: `Selected protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)} using ${winner.selection_method}.`,
    meta: {
      selection_method: cleanText(winner.selection_method, 80),
      selected_protocol_id: cleanText(selectedProtocol.id, 120)
    }
  });

  const project = resolveNotebookProject({
    snapshot,
    payloadProjectId: projectId,
    payloadProjectName: projectName,
    parserPayload,
    selectedProtocol,
    pendingSession
  });
  const placeholders = buildProtocolPlaceholderRows(selectedProtocol);
  const placeholderMap = new Map(placeholders.map((row) => [cleanText(row.placeholder_key, 160), row]));
  const knownValues = {};
  Object.entries(pendingSession?.known_values && typeof pendingSession.known_values === 'object'
    ? pendingSession.known_values
    : {}).forEach(([key, value]) => {
    const normalizedKey = cleanText(key, 160);
    const normalizedValue = cleanText(value, 260);
    if (normalizedKey && normalizedValue && placeholderMap.has(normalizedKey)) {
      knownValues[normalizedKey] = normalizedValue;
    }
  });

  placeholders.forEach((placeholder) => {
    const key = cleanText(placeholder.placeholder_key, 160);
    if (!key || cleanText(knownValues[key], 260)) {
      return;
    }
    const inferred = inferDeterministicPlaceholderValue({
      placeholder,
      parserPayload,
      project,
      protocol: selectedProtocol,
      message
    });
    if (inferred) {
      knownValues[key] = cleanText(inferred, 260);
    }
  });

  let unresolved = placeholders.filter((placeholder) => !cleanText(knownValues[placeholder.placeholder_key], 260));
  let fillSummary = '';
  let llmFollowUpQuestions = [];
  if (unresolved.length) {
    const toolContext = await maybeLookupProtocolPlaceholderToolContext({
      snapshot,
      parserPayload,
      unresolvedPlaceholders: unresolved,
      message,
      traceContext,
      lifecycleRecorder
    });
    const fillResult = await requestNotebookPlaceholderFill({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation,
      parserPayload,
      selectedProtocol,
      project,
      placeholders,
      unresolvedPlaceholders: unresolved,
      toolContext,
      traceContext
    });
    if (fillResult.ok && fillResult.payload) {
      const normalizedFill = normalizeNotebookFillPayload(fillResult.payload, placeholderMap);
      normalizedFill.filled_values.forEach((item) => {
        const key = cleanText(item?.placeholder_key, 160);
        const value = cleanText(item?.value, 260);
        if (key && value) {
          knownValues[key] = value;
        }
      });
      fillSummary = cleanText(normalizedFill.result_summary, 900);
      llmFollowUpQuestions = normalizedFill.follow_up_questions;
      unresolved = placeholders
        .filter((placeholder) => !cleanText(knownValues[placeholder.placeholder_key], 260))
        .map((placeholder) => {
          const fromLlm = normalizedFill.missing_placeholders.find((item) => item.placeholder_key === placeholder.placeholder_key);
          return {
            ...placeholder,
            reason: cleanText(fromLlm?.reason, 220) || 'Missing information from user request.'
          };
        });
    } else {
      await recordAgentLlmTrace(traceContext, {
        stage: 'notebook_fill',
        summary: cleanText(fillResult.error, 260) || 'Notebook fill failed; returning clarification path.',
        request_payload: {
          unresolved_count: unresolved.length
        },
        response_payload: {
          error: cleanText(fillResult.error, 320)
        }
      });
    }
  } else {
    await recordAgentLlmTrace(traceContext, {
      stage: 'notebook_fill',
      summary: 'Notebook placeholders resolved deterministically.',
      request_payload: {
        unresolved_count: 0
      },
      response_payload: {
        resolved_count: Object.keys(knownValues).length
      }
    });
  }

  if (!cleanText(project?.name, 220)) {
    unresolved.push({
      step_id: 'project',
      placeholder_id: 'project_name',
      placeholder_key: 'project_name',
      display: 'project name',
      reason: 'Project could not be resolved from the request.'
    });
  }

  const notebook = buildProtocolNotebookPayload({
    selectedProtocol,
    project,
    placeholders,
    placeholderValuesMap: knownValues,
    missingPlaceholders: unresolved,
    message,
    fillSummary
  });
  const missingPlaceholders = asArray(notebook.unresolved_placeholders);
  const followUpQuestions = uniqueStrings([
    ...llmFollowUpQuestions,
    ...missingPlaceholders.map((row) => buildMissingPlaceholderQuestion(row))
  ], 10);
  const status = missingPlaceholders.length ? 'needs_more_info' : 'completed';

  if (status === 'completed') {
    clearPendingProtocolNotebookSession(sessionKey);
  } else {
    setPendingProtocolNotebookSession(sessionKey, {
      created_at: pendingSession?.created_at || new Date().toISOString(),
      selected_protocol: {
        id: cleanText(selectedProtocol.id, 120),
        name: cleanText(selectedProtocol.name, 220)
      },
      project: {
        id: cleanText(project.id, 120),
        name: cleanText(project.name, 220),
        resolution_source: cleanText(project.resolution_source, 80)
      },
      candidate_matches: mapCandidateMatchesForOutput(rankedMatches),
      known_values: knownValues,
      missing_placeholders: missingPlaceholders,
      follow_up_questions: followUpQuestions
    });
  }

  return {
    status,
    candidate_matches: mapCandidateMatchesForOutput(rankedMatches),
    selected_protocol: {
      id: cleanText(selectedProtocol.id, 120),
      name: cleanText(selectedProtocol.name, 220),
      selection_method: cleanText(winner.selection_method, 80) || 'deterministic',
      rationale: cleanText(winner.rationale, 260)
    },
    missing_placeholders: missingPlaceholders,
    follow_up_questions: followUpQuestions,
    project_name: cleanText(project?.name, 220),
    notebook: status === 'completed' ? notebook : null
  };
}

  return {
    buildSessionKey: buildProtocolNotebookSessionKey,
    hasPendingSession: hasPendingProtocolNotebookSession,
    setPendingSession: setPendingProtocolNotebookSession,
    clearPendingSession: clearPendingProtocolNotebookSession,
    runFlow: runProtocolToNotebookFlow
  };
}

module.exports = {
  createProtocolNotebookRuntime
};
