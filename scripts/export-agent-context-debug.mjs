#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const {
  createScienceReasoningLoopRuntime
} = require(path.join(
  repoRoot,
  'src',
  'main',
  'helpers',
  'agent',
  'runtime',
  'science-reasoning-loop',
  'index.js'
));
const {
  createAgentContextManagementRuntime
} = require(path.join(
  repoRoot,
  'src',
  'main',
  'helpers',
  'agent',
  'context',
  'agent-context-management.js'
));
const {
  createAgentToolProviderRuntime
} = require(path.join(
  repoRoot,
  'src',
  'main',
  'helpers',
  'agent',
  'tools',
  'agent-tool-provide.js'
));

const LLM_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  CODEX: 'codex'
});

function parseArgs(argv = []) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (!token.startsWith('--')) {
      continue;
    }
    const trimmed = token.slice(2);
    if (!trimmed) {
      continue;
    }
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      out[key] = value;
      continue;
    }
    const next = argv[index + 1];
    if (typeof next === 'string' && !next.startsWith('--')) {
      out[trimmed] = next;
      index += 1;
      continue;
    }
    out[trimmed] = true;
  }
  return out;
}

function cleanText(value, maxLength = 2000) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function rawText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function clampInt(value, fallback, min = 0, max = 8) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => cleanText(item, 120))
    .filter(Boolean);
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

function toSlug(value, fallback = 'scenario') {
  const normalized = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function codeBlock(content, lang = 'text') {
  return `\`\`\`${lang}\n${String(content || '').trim()}\n\`\`\``;
}

function jsonBlock(value) {
  return codeBlock(JSON.stringify(value, null, 2), 'json');
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function pickRandomItem(values = []) {
  const list = asArray(values);
  if (!list.length) {
    return null;
  }
  const index = Math.floor(Math.random() * list.length);
  return list[index] || null;
}

function formatDateIso() {
  return new Date().toISOString();
}

const toolProviderRuntime = createAgentToolProviderRuntime();

function buildDefaultToolPool(intent) {
  const normalizedIntent = cleanText(intent, 80) || 'general_science_question';
  const resolved = toolProviderRuntime.resolveEntryToolNames({
    entryPoint: 'science_reasoning_entry',
    intent: normalizedIntent
  });
  const fallback = normalizedIntent === 'project_science_question'
    ? ['notebook-lookup', 'literature-search', 'web-search']
    : (normalizedIntent === 'result_analysis'
      ? ['python-sandbox', 'notebook-lookup', 'literature-search']
      : ['literature-search', 'web-search', 'notebook-lookup']);
  return uniqueStrings(resolved.length ? resolved : fallback, 40);
}

function buildToolDefinitions(toolNames = []) {
  return uniqueStrings(toolNames, 40).map((toolName) => ({
    name: toolName,
    description: `Debug-only tool definition for ${toolName}.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string'
        }
      }
    }
  }));
}

function buildRouting(intent, needsClarification = false) {
  return {
    intent,
    entities: {
      requested_output: 'debug-context-export'
    },
    plan: {
      needs_clarification: needsClarification,
      clarification_reason: needsClarification ? 'LLM Response' : ''
    }
  };
}

function buildParserPayload({
  intent,
  reasoningEffort,
  needsClarification = false,
  directAnswer = ''
} = {}) {
  return {
    primary_intent: intent,
    reasoning_effort: reasoningEffort,
    needs_clarification: needsClarification === true,
    clarification_reason: needsClarification === true ? 'LLM Response' : '',
    clarification_question: needsClarification === true ? 'LLM Response' : '',
    direct_answer: directAnswer || '',
    reasoning_summary: 'LLM Response',
    entities: {
      requested_output: 'debug-context-export'
    }
  };
}

function buildScenarioList(args = {}) {
  const requestedScenario = cleanText(args.scenario, 80).toLowerCase() || 'demo';
  const baseIntent = cleanText(args.intent, 80) || 'general_science_question';
  const baseMessage = cleanText(
    args.message,
    3200
  ) || 'What does the latest evidence suggest about this science question?';
  const reasoningEffort = clampInt(args['reasoning-effort'], 2, 0, 2);
  const iterations = clampInt(args.iterations, 2, 0, 8);
  const maxRounds = clampInt(args['max-rounds'], Math.max(iterations, 2), 0, 8);
  const requestedTools = parseList(args['tool-sequence']);
  const toolSequence = requestedTools.length
    ? requestedTools
    : buildDefaultToolPool(baseIntent);
  const projectName = cleanText(args['project-name'], 220);
  const projectId = cleanText(args['project-id'], 120);
  const project = projectName || projectId
    ? {
      id: projectId,
      name: projectName,
      resolution_source: 'debug-script'
    }
    : null;
  const loopMaxRounds = Math.max(1, maxRounds);
  const loopIterations = Math.max(0, iterations);

  const createLoopScenario = () => ({
    ...(baseIntent === 'project_science_question' && !project
      ? {
        project: {
          id: 'debug-project',
          name: 'Debug Project',
          resolution_source: 'debug-script'
        }
      }
      : {
        project
      }),
    name: 'Science Loop',
    slug: 'science-loop',
    mode: 'loop',
    intent: baseIntent,
    message: baseMessage,
    reasoningEffort: reasoningEffort === 0 ? 1 : reasoningEffort,
    iterations: loopIterations,
    maxRounds: loopMaxRounds,
    toolSequence,
    projectResolutionQuestion: baseIntent === 'project_science_question'
      ? 'Which project should the debug loop use?'
      : '',
    parserPayload: buildParserPayload({
      intent: baseIntent,
      reasoningEffort: reasoningEffort === 0 ? 1 : reasoningEffort,
      needsClarification: false
    }),
    routing: buildRouting(baseIntent, false)
  });

  const createDirectScenario = () => ({
    ...(baseIntent === 'project_science_question' && !project
      ? {
        project: {
          id: 'debug-project',
          name: 'Debug Project',
          resolution_source: 'debug-script'
        }
      }
      : {
        project
      }),
    name: 'Direct Answer',
    slug: 'direct-answer',
    mode: 'direct-answer',
    intent: baseIntent,
    message: baseMessage,
    reasoningEffort: 0,
    iterations: 0,
    maxRounds: 0,
    toolSequence: [],
    projectResolutionQuestion: baseIntent === 'project_science_question'
      ? 'Which project should the debug loop use?'
      : '',
    parserPayload: buildParserPayload({
      intent: baseIntent,
      reasoningEffort: 0,
      needsClarification: false,
      directAnswer: 'LLM Response'
    }),
    routing: buildRouting(baseIntent, false)
  });

  const createClarificationScenario = () => ({
    name: 'Clarification Needed',
    slug: 'clarification-needed',
    mode: 'clarification',
    intent: baseIntent,
    message: baseMessage,
    reasoningEffort: reasoningEffort === 0 ? 1 : reasoningEffort,
    iterations: 0,
    maxRounds: loopMaxRounds,
    toolSequence,
    project,
    projectResolutionQuestion: baseIntent === 'project_science_question'
      ? 'Which project should the debug loop use?'
      : '',
    parserPayload: buildParserPayload({
      intent: baseIntent,
      reasoningEffort: reasoningEffort === 0 ? 1 : reasoningEffort,
      needsClarification: true
    }),
    routing: buildRouting(baseIntent, true)
  });

  if (requestedScenario === 'loop') {
    return [createLoopScenario()];
  }
  if (requestedScenario === 'direct-answer') {
    return [createDirectScenario()];
  }
  if (requestedScenario === 'clarification') {
    return [createClarificationScenario()];
  }
  return [
    createDirectScenario(),
    createClarificationScenario(),
    createLoopScenario()
  ];
}

function buildStructuredStagePayload(stage, scenario, state) {
  const remainingRounds = Math.max(0, scenario.iterations - state.completedToolCalls);
  if (stage === 'science_input_clarification') {
    return {
      clarified_input: 'LLM Response',
      analysis_goal: 'LLM Response',
      important_constraints: ['LLM Response'],
      missing_information: scenario.mode === 'clarification' ? ['LLM Response'] : [],
      should_ask_follow_up: scenario.mode === 'clarification',
      follow_up_question: scenario.mode === 'clarification' ? 'LLM Response' : '',
      follow_up_reason: 'LLM Response'
    };
  }

  if (stage === 'science_route_planner') {
    return {
      goal: 'LLM Response',
      route_summary: 'LLM Response',
      step_sequence: scenario.toolSequence.slice(0, Math.max(1, Math.min(3, scenario.toolSequence.length))).map((toolName, index) => ({
        step_label: `step-${index + 1}`,
        objective: 'LLM Response',
        suggested_tools: [toolName],
        reason: 'LLM Response'
      })),
      tool_call_suggestions: scenario.toolSequence.slice(0, 4).map((toolName, index) => ({
        tool_name: toolName,
        priority: index + 1,
        when_to_use: 'LLM Response',
        reason: 'LLM Response',
        query_hint: 'LLM Response'
      })),
      decision_points: ['LLM Response'],
      adaptation_notes: ['LLM Response'],
      reference_only: true
    };
  }

  if (stage === 'science_loop_exit_criteria') {
    return {
      objective_summary: 'LLM Response',
      exit_conditions: ['LLM Response'],
      required_evidence: ['LLM Response'],
      continue_when: remainingRounds > 0 ? ['LLM Response'] : [],
      can_exit_with_limitations_when: ['LLM Response'],
      preferred_next_tools: scenario.toolSequence.slice(0, 4),
      reasoning_notes: 'LLM Response'
    };
  }

  if (stage === 'science_loop_exit_judge_sub_agent') {
    const satisfied = state.completedToolCalls >= scenario.iterations;
    const shouldContinue = satisfied === false && state.completedToolCalls < scenario.maxRounds;
    return {
      satisfied,
      reason: 'LLM Response',
      missing_requirements: satisfied ? [] : ['LLM Response'],
      should_continue: shouldContinue,
      next_tool_hint: shouldContinue
        ? {
          tool_name: state.nextPlannedToolName || null,
          query: 'LLM Response',
          reason: 'LLM Response'
        }
        : null,
      can_answer_with_limitations: satisfied || state.completedToolCalls >= scenario.maxRounds
    };
  }

  if (stage === 'science_reasoning_final_synthesis') {
    const partial = state.completedToolCalls < scenario.iterations;
    return {
      answer: 'LLM Response',
      confidence: partial ? 0.48 : 0.68,
      decision_record: {
        assumptions: ['LLM Response'],
        open_questions: partial ? ['LLM Response'] : [],
        verification_notes: ['LLM Response']
      },
      follow_up_questions: partial ? ['LLM Response'] : []
    };
  }

  if (stage === 'science_thinking_trace') {
    return {
      intent_parse_question: 'LLM Response',
      question_clarifier: 'LLM Response',
      criteria_generate: 'LLM Response',
      tool_rounds: Array.from({ length: state.completedToolCalls }, (_item, index) => ({
        round: index + 1,
        tool_selection: 'LLM Response',
        tool_call: 'LLM Response',
        tool_results: 'LLM Response'
      })),
      pre_synthesize_answer: 'LLM Response',
      judge: 'LLM Response',
      final_synthesize: 'LLM Response',
      final_synthesized_question: 'LLM Response'
    };
  }

  return {};
}

function buildToolCall(toolName, scenario, state) {
  const callIndex = state.sessionCallCount + 1;
  return {
    callId: `debug-call-${scenario.slug}-${callIndex}`,
    name: toolName,
    argsText: JSON.stringify({
      query: scenario.message
    })
  };
}

function createDebugState(scenario) {
  return {
    sessionId: `debug-session-${scenario.slug}`,
    llmCalls: [],
    apiCalls: [],
    lifecycleEvents: [],
    contextSnapshots: [],
    roundContexts: [],
    conversation: [
      {
        role: 'user',
        text: scenario.message
      }
    ],
    completedToolCalls: 0,
    sessionCallCount: 0,
    nextPlannedToolName: null
  };
}

function sanitizeLifecycleEvent(event = {}) {
  return {
    timestamp: formatDateIso(),
    stage: cleanText(event.stage, 120),
    status: cleanText(event.status, 40),
    routing_intent: cleanText(event.routing_intent, 80),
    tool_name: cleanText(event.tool_name, 120),
    message: cleanText(event.message, 500),
    meta: event.meta && typeof event.meta === 'object' ? event.meta : {}
  };
}

function createContextSnapshotRecorder(state, contextRuntime, scenario) {
  return (label) => {
    const envelope = contextRuntime.buildContextEnvelope({
      session_id: state.sessionId,
      current_user_request: scenario.message,
      message: scenario.message,
      conversation: state.conversation
    });
    state.contextSnapshots.push({
      label,
      envelope
    });
  };
}

async function runScenario(scenario) {
  const state = createDebugState(scenario);
  const contextRuntime = createAgentContextManagementRuntime();
  const buildEnvelopeSnapshot = (label, extra = {}) => ({
    label,
    envelope: contextRuntime.buildContextEnvelope({
      session_id: state.sessionId,
      current_user_request: cleanText(
        extra.current_user_request !== undefined
          ? extra.current_user_request
          : scenario.message,
        3200
      ),
      message: cleanText(extra.message !== undefined ? extra.message : scenario.message, 3200),
      conversation: extra.conversation !== undefined ? extra.conversation : state.conversation,
      tool_outputs: extra.tool_outputs !== undefined ? extra.tool_outputs : undefined
    })
  });
  const captureContext = (label, extra = {}) => {
    state.contextSnapshots.push(buildEnvelopeSnapshot(label, extra));
  };
  const ensureRoundContext = (roundNumber) => {
    const numericRound = Math.max(1, Number(roundNumber) || 1);
    let entry = state.roundContexts.find((item) => Number(item?.round) === numericRound);
    if (!entry) {
      entry = {
        round: numericRound
      };
      state.roundContexts.push(entry);
      state.roundContexts.sort((left, right) => Number(left.round || 0) - Number(right.round || 0));
    }
    return entry;
  };
  const pickRandomToolCall = (input = {}) => {
    const toolNames = uniqueStrings(
      asArray(input.toolDefinitions)
        .map((tool) => cleanText(tool?.name, 120))
        .filter(Boolean),
      20
    );
    const selectedToolName = pickRandomItem(toolNames);
    if (!selectedToolName) {
      state.nextPlannedToolName = null;
      return null;
    }
    state.nextPlannedToolName = selectedToolName;
    return buildToolCall(selectedToolName, scenario, state);
  };
  const recordRoundSelection = ({
    phase,
    roundNumber,
    sessionInput,
    toolCall,
    feedbackMessage = ''
  } = {}) => {
    if (!toolCall) {
      return;
    }
    const entry = ensureRoundContext(roundNumber);
    entry.phase = cleanText(phase, 80) || 'selection';
    entry.selection_mode = 'random';
    entry.context_before = buildEnvelopeSnapshot(
      `Round ${roundNumber} context before tool selection`,
      {
        message: cleanText(sessionInput?.message, 3200) || scenario.message
      }
    );
    entry.agent_request = {
      system_prompt: cleanText(sessionInput?.systemPrompt, 24000),
      message: cleanText(sessionInput?.message, 4000),
      feedback_message: cleanText(feedbackMessage, 12000),
      conversation: asArray(sessionInput?.conversation),
      tool_definitions: asArray(sessionInput?.toolDefinitions)
    };
    entry.agent_request_raw = {
      system_prompt: rawText(sessionInput?.systemPrompt),
      message: rawText(sessionInput?.message),
      feedback_message: rawText(feedbackMessage),
      conversation: cloneJson(asArray(sessionInput?.conversation), []),
      tool_definitions: cloneJson(asArray(sessionInput?.toolDefinitions), [])
    };
    entry.selected_tool = {
      name: cleanText(toolCall?.name, 120),
      arguments: JSON.parse(toolCall?.argsText || '{}')
    };
    entry.assistant_before_tool = 'LLM Response';
  };
  const recordRoundToolResult = ({
    roundNumber,
    toolName,
    args,
    envelope
  } = {}) => {
    const entry = ensureRoundContext(roundNumber);
    entry.api_call = {
      tool_name: cleanText(toolName, 120),
      arguments: args && typeof args === 'object' ? args : {},
      stub_response: 'API response',
      debug_envelope: envelope && typeof envelope === 'object' ? envelope : {}
    };
    entry.context_after_tool = buildEnvelopeSnapshot(
      `Round ${roundNumber} context after ${cleanText(toolName, 120) || 'tool'}`
    );
  };
  const recordRoundAgentContinuation = ({
    roundNumber,
    toolOutputs = []
  } = {}) => {
    const entry = ensureRoundContext(roundNumber);
    entry.agent_after_tool = {
      tool_outputs: toolOutputs,
      assistant_after_tool: 'LLM Response'
    };
  };

  contextRuntime.startTask({
    session_id: state.sessionId,
    task_type: 'science_reasoning_loop',
    intent: scenario.intent,
    status: 'active',
    message: scenario.message,
    project: scenario.project,
    goals: ['Inspect debug context export output'],
    constraints: [
      'All LLM outputs are replaced with LLM Response.',
      'All internal API outputs are replaced with API response.'
    ]
  });
  captureContext('Initial context');

  const toolDefinitions = buildToolDefinitions(scenario.toolSequence);
  const runtime = createScienceReasoningLoopRuntime({
    LLM_PROVIDERS,
    requestStructuredJsonPayload: async (options = {}) => {
      const payload = buildStructuredStagePayload(
        cleanText(options.stage, 120),
        scenario,
        state
      );
      state.llmCalls.push({
        kind: 'structured-json',
        stage: cleanText(options.stage, 120),
        system_prompt: cleanText(options.systemPrompt, 24000),
        user_prompt: cleanText(options.userPrompt, 48000),
        raw_prompt_payload: {
          system_prompt: rawText(options.systemPrompt),
          user_prompt: rawText(options.userPrompt)
        },
        stub_response: 'LLM Response',
        debug_payload: payload
      });
      return {
        ok: true,
        payload,
        raw: 'LLM Response'
      };
    },
    startAgentSession: async (input = {}) => {
      const toolCall = pickRandomToolCall(input);
      const roundNumber = state.sessionCallCount + 1;
      recordRoundSelection({
        phase: 'start',
        roundNumber,
        sessionInput: input,
        toolCall
      });
      if (toolCall) {
        state.sessionCallCount += 1;
      }
      state.llmCalls.push({
        kind: 'agent-session-start',
        stage: 'science_agent_session_start',
        round: toolCall ? roundNumber : 0,
        system_prompt: cleanText(input.systemPrompt, 24000),
        message: cleanText(input.message, 4000),
        conversation: asArray(input.conversation),
        tool_definitions: asArray(input.toolDefinitions),
        raw_prompt_payload: {
          system_prompt: rawText(input.systemPrompt),
          message: rawText(input.message),
          conversation: cloneJson(asArray(input.conversation), []),
          tool_definitions: cloneJson(asArray(input.toolDefinitions), [])
        },
        stub_response: 'LLM Response',
        selection_mode: toolCall ? 'random' : '',
        tool_call: toolCall
          ? {
            name: toolCall.name,
            arguments: JSON.parse(toolCall.argsText)
          }
          : null
      });
      return {
        provider: cleanText(input.provider, 80),
        model: cleanText(input.model, 120),
        round: 0,
        toolDefinitions: asArray(input.toolDefinitions),
        parsed: {
          assistant_text: 'LLM Response',
          tool_calls: toolCall ? [toolCall] : []
        },
        transcript: asArray(input.conversation)
      };
    },
    extractAgentSessionFunctionCalls: (session) => asArray(session?.parsed?.tool_calls),
    extractAgentSessionText: (session) => cleanText(session?.parsed?.assistant_text, 12000),
    continueAgentSessionWithToolOutputs: async (session, toolOutputs = []) => {
      recordRoundAgentContinuation({
        roundNumber: Math.max(1, state.completedToolCalls),
        toolOutputs
      });
      state.llmCalls.push({
        kind: 'agent-session-tool-output',
        stage: 'science_agent_session_after_tool_output',
        round: Math.max(1, state.completedToolCalls),
        tool_outputs: toolOutputs,
        raw_prompt_payload: {
          tool_outputs: cloneJson(toolOutputs, [])
        },
        stub_response: 'LLM Response'
      });
      return {
        ...session,
        round: Number(session?.round || 0) + 1,
        parsed: {
          assistant_text: 'LLM Response',
          tool_calls: []
        }
      };
    },
    continueAgentSessionWithUserMessage: async (session, userMessage = '') => {
      const toolCall = pickRandomToolCall({
        toolDefinitions: asArray(session?.toolDefinitions)
      });
      const roundNumber = state.sessionCallCount + 1;
      recordRoundSelection({
        phase: 'continue',
        roundNumber,
        sessionInput: {
          systemPrompt: cleanText(session?.systemPrompt, 24000),
          message: scenario.message,
          conversation: state.conversation,
          toolDefinitions: asArray(session?.toolDefinitions)
        },
        toolCall,
        feedbackMessage: userMessage
      });
      if (toolCall) {
        state.sessionCallCount += 1;
      }
      state.llmCalls.push({
        kind: 'agent-session-feedback',
        stage: 'science_agent_session_after_feedback',
        round: toolCall ? roundNumber : Math.max(1, state.completedToolCalls),
        feedback_message: cleanText(userMessage, 12000),
        raw_prompt_payload: {
          feedback_message: rawText(userMessage),
          system_prompt: rawText(session?.systemPrompt),
          message: rawText(scenario.message),
          conversation: cloneJson(state.conversation, []),
          tool_definitions: cloneJson(asArray(session?.toolDefinitions), [])
        },
        stub_response: 'LLM Response',
        selection_mode: toolCall ? 'random' : '',
        tool_call: toolCall
          ? {
            name: toolCall.name,
            arguments: JSON.parse(toolCall.argsText)
          }
          : null
      });
      return {
        ...session,
        round: Number(session?.round || 0) + 1,
        toolDefinitions: asArray(session?.toolDefinitions),
        parsed: {
          assistant_text: 'LLM Response',
          tool_calls: toolCall ? [toolCall] : []
        }
      };
    },
    runTool: async (toolName, args = {}) => {
      const roundNumber = state.completedToolCalls + 1;
      state.completedToolCalls = roundNumber;
      const envelope = {
        ok: true,
        tool_name: toolName,
        summary: 'API response',
        result: {
          summary: 'API response',
          text: 'API response',
          items: [
            {
              id: `api-item-${state.completedToolCalls}`,
              label: 'API response'
            }
          ]
        },
        items: [
          {
            id: `api-item-${state.completedToolCalls}`,
            label: 'API response'
          }
        ],
        citations: [
          {
            source: cleanText(toolName, 120),
            pointer: `debug:${state.completedToolCalls}`,
            reason: 'API response'
          }
        ]
      };
      state.apiCalls.push({
        stage: 'internal-api-call',
        round: roundNumber,
        tool_name: cleanText(toolName, 120),
        arguments: args,
        stub_response: 'API response',
        debug_envelope: envelope
      });
      contextRuntime.recordToolRound({
        session_id: state.sessionId,
        intent: scenario.intent,
        task_type: 'science_reasoning_loop',
        tool_name: toolName,
        ok: true,
        summary: 'API response',
        input: args,
        result: envelope.result
      });
      recordRoundToolResult({
        roundNumber,
        toolName,
        args,
        envelope
      });
      captureContext(`After ${toolName} round ${roundNumber}`);
      return envelope;
    },
    recordLifecycleEvent: (_recorder, event = {}) => {
      state.lifecycleEvents.push(sanitizeLifecycleEvent(event));
    }
  });

  const runtimeInput = {
    provider: LLM_PROVIDERS.OPENAI,
    endpoint: 'https://example.test/v1/responses',
    apiKey: 'debug-key',
    model: 'debug-model',
    message: scenario.message,
    conversation: state.conversation,
    hasLatestUserInConversation: true,
    parserPayload: scenario.parserPayload,
    routing: scenario.routing,
    project: scenario.project,
    projectResolutionQuestion: scenario.projectResolutionQuestion,
    baseSystemPrompt: 'You are a debug-only Hikari agent runtime.',
    traceContext: {
      enabled: false,
      rows: [],
      entries: []
    },
    lifecycleRecorder: {
      requestId: state.sessionId
    },
    maxRounds: scenario.maxRounds,
    toolDefinitions
  };

  let result;
  if (scenario.intent === 'project_science_question') {
    result = await runtime.runProjectScienceQuestion(runtimeInput);
  } else if (scenario.intent === 'result_analysis') {
    result = await runtime.runResultAnalysis(runtimeInput);
  } else {
    result = await runtime.runGeneralScienceQuestion(runtimeInput);
  }

  if (asArray(result?.follow_up_questions).length > 0) {
    contextRuntime.recordFollowUpQuestion({
      session_id: state.sessionId,
      questions: result.follow_up_questions
    });
    state.conversation.push({
      role: 'assistant',
      text: cleanText(result.follow_up_questions[0], 3200) || 'LLM Response'
    });
    captureContext('After follow-up question was recorded');
  } else {
    state.conversation.push({
      role: 'assistant',
      text: cleanText(result?.answer, 3200) || 'LLM Response'
    });
  }

  if (['completed', 'partial'].includes(cleanText(result?.status, 80))) {
    contextRuntime.completeTask({
      session_id: state.sessionId,
      status: cleanText(result?.status, 80) || 'completed',
      completion_summary: cleanText(result?.answer, 320)
        || cleanText(result?.follow_up_questions?.[0], 320)
        || 'LLM Response'
    });
  }
  captureContext('Final context');

  return {
    scenario,
    state,
    result
  };
}

function renderContextSnapshot(snapshot = {}, index = 0) {
  const envelope = snapshot.envelope && typeof snapshot.envelope === 'object'
    ? snapshot.envelope
    : {};
  const promptBlocks = envelope.prompt_blocks && typeof envelope.prompt_blocks === 'object'
    ? envelope.prompt_blocks
    : {};
  const renderedContext = [
    cleanText(promptBlocks.immediate, 24000),
    cleanText(promptBlocks.session_memory, 24000),
    cleanText(promptBlocks.long_term_memory, 24000)
  ].filter(Boolean).join('\n\n');
  return [
    `### ${index + 1}. ${cleanText(snapshot.label, 160) || `Context ${index + 1}`}`,
    '',
    '**Real Context**',
    '',
    renderedContext
      ? codeBlock(renderedContext, 'text')
      : '_No context captured._'
  ].join('\n');
}

function renderEnvelopeDetails(title, snapshot = null) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const envelope = source.envelope && typeof source.envelope === 'object'
    ? source.envelope
    : {};
  const promptBlocks = envelope.prompt_blocks && typeof envelope.prompt_blocks === 'object'
    ? envelope.prompt_blocks
    : {};
  const renderedContext = [
    cleanText(promptBlocks.immediate, 24000),
    cleanText(promptBlocks.session_memory, 24000),
    cleanText(promptBlocks.long_term_memory, 24000)
  ].filter(Boolean).join('\n\n');
  if (!envelope.session_id) {
    return `${title}\n\n_No context captured._`;
  }
  return [
    title,
    '',
    renderedContext
      ? codeBlock(renderedContext, 'text')
      : '_No context captured._'
  ].join('\n');
}

function renderLlmCall(call = {}, index = 0) {
  const sections = [
    `### ${index + 1}. ${cleanText(call.stage, 160) || `LLM call ${index + 1}`}`,
    '',
    `Kind: \`${cleanText(call.kind, 120) || 'llm'}\``,
    '',
    `Stub response: \`${cleanText(call.stub_response, 120) || 'LLM Response'}\``
  ];

  if (call.system_prompt) {
    sections.push('', '**System Prompt**', '', codeBlock(call.system_prompt, 'text'));
  }
  if (call.user_prompt) {
    sections.push('', '**User Prompt / Context**', '', codeBlock(call.user_prompt, 'text'));
  }
  if (call.message) {
    sections.push('', '**Message**', '', codeBlock(call.message, 'text'));
  }
  if (call.feedback_message) {
    sections.push('', '**Feedback Message**', '', codeBlock(call.feedback_message, 'text'));
  }
  if (Array.isArray(call.conversation) && call.conversation.length) {
    sections.push('', '**Conversation**', '', jsonBlock(call.conversation));
  }
  if (Array.isArray(call.tool_definitions) && call.tool_definitions.length) {
    sections.push('', '**Tool Definitions**', '', jsonBlock(call.tool_definitions));
  }
  if (call.tool_outputs) {
    sections.push('', '**Tool Outputs**', '', jsonBlock(call.tool_outputs));
  }
  if (call.tool_call) {
    sections.push('', '**Planned Tool Call**', '', jsonBlock(call.tool_call));
  }
  if (call.debug_payload && Object.keys(call.debug_payload).length) {
    sections.push('', '**Debug Shim Payload**', '', jsonBlock(call.debug_payload));
  }
  return sections.join('\n');
}

function renderExactRawPromptPayload(call = {}, index = 0) {
  const rawPayload = call.raw_prompt_payload && typeof call.raw_prompt_payload === 'object'
    ? call.raw_prompt_payload
    : {};
  const sections = [
    `### ${index + 1}. ${cleanText(call.stage, 160) || `LLM call ${index + 1}`}`,
    '',
    `Kind: \`${cleanText(call.kind, 120) || 'llm'}\``
  ];

  if (rawPayload.system_prompt) {
    sections.push('', '**Raw System Prompt**', '', codeBlock(rawPayload.system_prompt, 'text'));
  }
  if (rawPayload.user_prompt) {
    sections.push('', '**Raw User Prompt**', '', codeBlock(rawPayload.user_prompt, 'text'));
  }
  if (rawPayload.message) {
    sections.push('', '**Raw Message**', '', codeBlock(rawPayload.message, 'text'));
  }
  if (rawPayload.feedback_message) {
    sections.push('', '**Raw Feedback Message**', '', codeBlock(rawPayload.feedback_message, 'text'));
  }
  if (Array.isArray(rawPayload.conversation) && rawPayload.conversation.length) {
    sections.push('', '**Raw Conversation**', '', jsonBlock(rawPayload.conversation));
  }
  if (Array.isArray(rawPayload.tool_definitions) && rawPayload.tool_definitions.length) {
    sections.push('', '**Raw Tool Definitions**', '', jsonBlock(rawPayload.tool_definitions));
  }
  if (rawPayload.tool_outputs && Array.isArray(rawPayload.tool_outputs) && rawPayload.tool_outputs.length) {
    sections.push('', '**Raw Tool Outputs**', '', jsonBlock(rawPayload.tool_outputs));
  }
  if (sections.length === 2) {
    sections.push('', '_No raw prompt payload captured._');
  }
  return sections.join('\n');
}

function renderApiCall(call = {}, index = 0) {
  return [
    `### ${index + 1}. ${cleanText(call.tool_name, 160) || `API call ${index + 1}`}`,
    '',
    `Stub response: \`${cleanText(call.stub_response, 120) || 'API response'}\``,
    '',
    '**Arguments**',
    '',
    jsonBlock(call.arguments || {}),
    '',
    '**Debug Envelope**',
    '',
    jsonBlock(call.debug_envelope || {})
  ].join('\n');
}

function renderLifecycleEvent(event = {}, index = 0) {
  return `${index + 1}. \`${cleanText(event.stage, 120) || 'unknown'}\` [${cleanText(event.status, 40) || 'ok'}] ${cleanText(event.message, 320) || ''}`.trim();
}

function renderRoundContext(roundContext = {}, index = 0) {
  const round = Math.max(1, Number(roundContext?.round) || index + 1);
  const sections = [
    `### Round ${round}`,
    '',
    `Selection mode: \`${cleanText(roundContext?.selection_mode, 80) || 'random'}\``
  ];

  if (roundContext?.selected_tool) {
    sections.push(
      '',
      '**Selected Tool**',
      '',
      jsonBlock(roundContext.selected_tool)
    );
  }
  if (roundContext?.agent_request) {
    sections.push(
      '',
      '**Agent Request**',
      '',
      jsonBlock(roundContext.agent_request)
    );
  }
  if (roundContext?.agent_request_raw) {
    sections.push(
      '',
      '**Agent Request Raw Payload**',
      '',
      jsonBlock(roundContext.agent_request_raw)
    );
  }
  sections.push(
    '',
    renderEnvelopeDetails('**Context Before Round**', roundContext?.context_before)
  );
  if (roundContext?.api_call) {
    sections.push(
      '',
      '**Tool/API Result**',
      '',
      jsonBlock(roundContext.api_call)
    );
  }
  if (roundContext?.agent_after_tool) {
    sections.push(
      '',
      '**Agent Continuation After Tool**',
      '',
      jsonBlock(roundContext.agent_after_tool)
    );
  }
  sections.push(
    '',
    renderEnvelopeDetails('**Context After Round**', roundContext?.context_after_tool)
  );
  return sections.join('\n');
}

function renderScenarioMarkdown(output = {}) {
  const scenario = output.scenario || {};
  const state = output.state || {};
  const result = output.result || {};

  return [
    `## ${cleanText(scenario.name, 160) || 'Scenario'}`,
    '',
    jsonBlock({
      intent: scenario.intent,
      mode: scenario.mode,
      message: scenario.message,
      reasoning_effort: scenario.reasoningEffort,
      iterations: scenario.iterations,
      max_rounds: scenario.maxRounds,
      tool_sequence: scenario.toolSequence,
      project: scenario.project || null
    }),
    '',
    '### Final Result',
    '',
    jsonBlock(result),
    '',
    '### Round Contexts',
    '',
    state.roundContexts.length
      ? state.roundContexts.map(renderRoundContext).join('\n\n')
      : '_No round-by-round context was captured._',
    '',
    '### Context Snapshots',
    '',
    state.contextSnapshots.length
      ? state.contextSnapshots.map(renderContextSnapshot).join('\n\n')
      : '_No context snapshots captured._',
    '',
    '### LLM Calls',
    '',
    state.llmCalls.length
      ? state.llmCalls.map(renderLlmCall).join('\n\n')
      : '_No LLM calls captured._',
    '',
    '### Exact Raw Prompt Payloads',
    '',
    state.llmCalls.length
      ? state.llmCalls.map(renderExactRawPromptPayload).join('\n\n')
      : '_No raw prompt payloads captured._',
    '',
    '### Internal API Calls',
    '',
    state.apiCalls.length
      ? state.apiCalls.map(renderApiCall).join('\n\n')
      : '_No internal API calls captured._',
    '',
    '### Lifecycle',
    '',
    state.lifecycleEvents.length
      ? state.lifecycleEvents.map(renderLifecycleEvent).join('\n')
      : '_No lifecycle events captured._'
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
const scenarios = buildScenarioList(args);
const defaultOutputPath = path.join(repoRoot, 'agent-context-debug.md');
const outputArg = cleanText(args.output, 1600);
const outputPath = outputArg
  ? path.resolve(repoRoot, outputArg)
  : defaultOutputPath;

const scenarioOutputs = [];
for (const scenario of scenarios) {
  // Run scenarios sequentially so the markdown reads in execution order.
  // This also keeps the debug trace stable across repeated runs.
  // eslint-disable-next-line no-await-in-loop
  scenarioOutputs.push(await runScenario(scenario));
}

const markdown = [
  '# Agent Context Debug Export',
  '',
  `Generated at: ${formatDateIso()}`,
  '',
  'This export runs the science agent flow with debug shims only.',
  '',
  '- Every LLM-facing response is replaced with `LLM Response`.',
  '- Every internal tool/API-facing response is replaced with `API response`.',
  '- The runtime logic stays intact; only the external call boundaries are stubbed.',
  '',
  ...scenarioOutputs.map(renderScenarioMarkdown)
].join('\n');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, markdown, 'utf8');

process.stdout.write(`Wrote ${outputPath}\n`);
