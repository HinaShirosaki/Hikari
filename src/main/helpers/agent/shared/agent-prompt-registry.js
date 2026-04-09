'use strict';

const {
  DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE,
  createAgentRuntimeSupport
} = require('../runtime/agent-runtime-support.js');
const { createAgentSessionRuntime } = require('../runtime/agent-session-runtime.js');
const { createScienceLoopSupport } = require('../runtime/science-reasoning-loop/support.js');
const { createScienceInputClarificationRuntime } = require('../runtime/science-reasoning-loop/input-clarification.js');
const { createAgentRoutePlannerRuntime } = require('../runtime/science-reasoning-loop/agent-route-planner.js');
const { createScienceLoopExitCriteriaRuntime } = require('../runtime/science-reasoning-loop/loop-exit-criteria.js');
const { createScienceLoopCurrentScientificStateRuntime } = require('../runtime/science-reasoning-loop/current-scientific-state.js');
const { createScienceLoopExitJudgeRuntime } = require('../runtime/science-reasoning-loop/loop-exit-judge.js');
const { createScienceThinkingTraceRuntime } = require('../runtime/science-reasoning-loop/thinking-trace.js');
const { createScienceFinalSynthesisRuntime } = require('../runtime/science-reasoning-loop/final-synthesis.js');
const agentIntentParser = require('../intent/agent-intent-parser.js');
const agentToolLoading = require('../tools/agent-tool-loading.js');
const { createProtocolMatchingRuntime } = require('../tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../tools/agent-notebook-generation.js');
const { createNotebookDraftRuntime } = require('../tools/agent-notebook-draft.js');
const { createProtocolGenerationRuntime } = require('../tools/agent-protocol-generation.js');
const { createPaperAnalysisRuntime } = require('../tools/agent-paper-analysis.js');
const { buildClarifyPrompt } = require('../deep-research/step-1-clarify-question.js');
const { buildFollowUpPrompt } = require('../deep-research/step-2-ask-targeted-follow-up.js');
const { buildResearchPlanPrompt } = require('../deep-research/step-3-draft-research-plan.js');
const { buildExecutionActionPrompt } = require('../deep-research/step-4-execute-plan.js');
const { buildOutlinePrompt, buildSectionPrompt } = require('../deep-research/step-5-assemble-final-answer.js');
const {
  buildSubAgentInstruction,
  buildCompletionCheckPrompt
} = require('../deep-research/sub-agent-usage.js');

const STRUCTURED_JSON_ONLY_SYSTEM_PROMPT = 'Return valid JSON only.';

const STRUCTURED_JSON_ONLY_SOURCES = Object.freeze([
  'src/main/helpers/agent/deep-research/step-1-clarify-question.js',
  'src/main/helpers/agent/deep-research/step-2-ask-targeted-follow-up.js',
  'src/main/helpers/agent/deep-research/step-3-draft-research-plan.js',
  'src/main/helpers/agent/deep-research/step-4-execute-plan.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/input-clarification.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/agent-route-planner.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/loop-exit-criteria.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/current-scientific-state.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/thinking-trace.js',
  'src/main/helpers/agent/runtime/science-reasoning-loop/final-synthesis.js',
  'src/main/helpers/agent/deep-research/sub-agent-usage.js'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  return asArray(values).filter((value) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) {
      return false;
    }
    seen.add(text);
    return true;
  });
}

function normalizePromptText(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || '(empty prompt)';
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePromptText(item)).join('\n');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? '').trim() || '(empty prompt)';
}

function renderPromptBlock(entry) {
  try {
    const value = typeof entry.render === 'function' ? entry.render() : entry.content;
    return normalizePromptText(value);
  } catch (error) {
    return `Prompt render failed: ${String(error?.message || error).trim() || 'unknown error'}`;
  }
}

function buildSampleState() {
  const runtimeSupport = createAgentRuntimeSupport();
  const sessionRuntime = createAgentSessionRuntime();
  const scienceSupportRuntime = createScienceLoopSupport();
  const inputClarificationRuntime = createScienceInputClarificationRuntime();
  const routePlannerRuntime = createAgentRoutePlannerRuntime();
  const exitCriteriaRuntime = createScienceLoopExitCriteriaRuntime();
  const currentScientificStateRuntime = createScienceLoopCurrentScientificStateRuntime();
  const exitJudgeRuntime = createScienceLoopExitJudgeRuntime();
  const thinkingTraceRuntime = createScienceThinkingTraceRuntime();
  const finalSynthesisRuntime = createScienceFinalSynthesisRuntime();
  const protocolMatchingRuntime = createProtocolMatchingRuntime();
  const notebookGenerationRuntime = createNotebookGenerationRuntime();
  const notebookDraftRuntime = createNotebookDraftRuntime();
  const protocolGenerationRuntime = createProtocolGenerationRuntime();
  const paperAnalysisRuntime = createPaperAnalysisRuntime();

  const sampleConversation = [
    {
      role: 'user',
      text: 'Can you figure out why the Atlas HEK293 SUMO1 pilot had weak conjugation and compare it with recent literature?'
    },
    {
      role: 'assistant',
      text: 'I can check the Atlas records first, then compare them with recent sources if needed.'
    }
  ];
  const sampleProject = {
    id: 'atlas-sumo1',
    name: 'Atlas SUMO1',
    resolution_source: 'parser'
  };
  const sampleParserPayload = {
    primary_intent: 'project_science_question',
    reasoning_effort: 2,
    needs_clarification: false,
    clarification_reason: null,
    entities: {
      project_name: 'Atlas SUMO1',
      protocol_name: 'SUMO1 Purification',
      activity_type: 'mechanism review',
      cell_line: 'HEK293'
    },
    inventory_search: {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    },
    protocol_candidates: ['SUMO1 Purification'],
    reasoning_summary: 'Needs project evidence plus recent literature.'
  };
  const sampleRouting = {
    intent: 'project_science_question',
    reasoning_effort: 2,
    response_mode: 'science_loop',
    entities: {
      project: 'Atlas SUMO1',
      protocol: 'SUMO1 Purification',
      activity: 'mechanism review'
    }
  };
  const samplePolicy = {
    intent: 'project_science_question',
    require_project_resolution: true,
    require_internal_citation: true,
    require_retrieval_attempt: true
  };
  const sampleClarification = {
    clarified_input: 'Explain the most likely cause of weak SUMO1 conjugation in the Atlas HEK293 pilot and compare that explanation with recent literature.',
    analysis_goal: 'Find the most grounded cause of weak conjugation.',
    important_constraints: ['Use internal project evidence before recent external literature.'],
    missing_information: [],
    should_ask_follow_up: false,
    follow_up_question: '',
    follow_up_reason: 'The request is specific enough to continue.'
  };
  const sampleExitCriteria = {
    required_evidence: [
      'At least one internal project record supports the answer.',
      'At least one recent external citation addresses the likely limiting factor.'
    ],
    exit_conditions: [
      'A grounded explanation links the weak conjugation phenotype to a specific limiting factor.'
    ],
    continue_when: [
      'Internal evidence and external evidence conflict materially.'
    ],
    can_exit_with_limitations_when: [
      'Remaining uncertainty is disclosed explicitly.'
    ],
    preferred_next_tools: ['record-lookup', 'literature-search'],
    reasoning_notes: 'Prefer one internal and one external source before synthesis.'
  };
  const sampleCitations = [
    {
      source: 'project',
      pointer: 'Notebook AT-14',
      reason: 'The Atlas pilot recorded weak conjugation after transfection.'
    },
    {
      source: 'pubmed',
      pointer: 'PMID:12345678',
      reason: 'A recent SUMOylation study links low UBC9 availability to reduced conjugation efficiency.'
    }
  ];
  const sampleToolTrace = [
    {
      tool_name: 'record-lookup',
      ok: true,
      summary: 'Found Atlas notebook AT-14 with low UBC9 signal after transfection.',
      assistant_after_tool: 'Internal evidence suggests enzyme availability may be limiting.'
    },
    {
      tool_name: 'literature-search',
      ok: true,
      summary: 'Found a recent paper connecting UBC9 levels to SUMOylation efficiency in HEK293.',
      assistant_after_tool: 'External evidence points in the same direction.'
    }
  ];
  const sampleLatestToolResult = {
    ok: true,
    summary: 'Notebook AT-14 shows low UBC9 expression after transfection.',
    citations: [sampleCitations[0]]
  };
  const samplePreSynthesizedQuestion = {
    tentative_answer: {
      current_best_answer: 'Low UBC9 expression is the most likely driver of weak SUMO1 conjugation in the Atlas HEK293 pilot.'
    },
    supporting_basis: [
      'Notebook AT-14 recorded low UBC9 signal.',
      'Recent literature ties UBC9 availability to conjugation efficiency.'
    ],
    unresolved_issues: [
      'The pilot did not directly quantify SAE1/SAE2.'
    ]
  };
  const sampleCurrentScientificState = {
    supported_now: [
      'Atlas notebook AT-14 supports low UBC9 after transfection.',
      'Recent literature supports UBC9 availability as a limiting factor.'
    ],
    contradicted: [],
    remains_unknown: [
      'The pilot did not directly quantify SAE1/SAE2.'
    ],
    uncertainty_decision_relevant: false,
    uncertainty_decision_reason: 'The remaining uncertainty does not block a limitation-qualified answer.'
  };
  const sampleEvaluation = {
    satisfied: false,
    reason: 'The answer still needs one recent external citation that speaks directly to SUMO1 conjugation efficiency.',
    missing_requirements: ['One recent external citation about SUMO1 conjugation efficiency.'],
    should_continue: true,
    next_tool_hint: {
      tool_name: 'literature-search',
      query: 'SUMO1 conjugation UBC9 HEK293 2024 2025',
      reason: 'Gather one recent citation that directly addresses the likely limiting factor.'
    },
    can_answer_with_limitations: false
  };
  const sampleResearchObjective = {
    research_goal: 'Explain the weak SUMO1 conjugation seen in the Atlas HEK293 pilot and compare that explanation with recent literature.',
    scope_boundaries: ['Use Atlas project evidence first.', 'Prefer recent external evidence.']
  };
  const sampleResearchPlan = {
    key_subquestions: [
      'What internal project evidence explains the weak conjugation phenotype?',
      'What do recent external sources say about UBC9 availability and SUMOylation efficiency?'
    ],
    possible_tools_or_sources: ['record-lookup', 'literature-search', 'sub-agent']
  };
  const sampleContextSnapshot = {
    sections: [
      {
        id: 'internal-evidence',
        summary: 'Atlas notebook evidence points to low UBC9 after transfection.'
      }
    ]
  };
  const sampleAccuracySnapshot = {
    claims: [
      {
        text: 'Low UBC9 is the leading explanation.',
        support_count: 2
      }
    ],
    contradictions: []
  };
  const sampleRoutePlan = {
    goal: 'Resolve the most likely cause of weak conjugation.',
    route_summary: 'Start with internal Atlas records, then validate with recent external evidence.',
    step_sequence: [
      {
        step_label: 'Check internal Atlas notebooks',
        goal: 'Find the strongest project evidence about weak conjugation.'
      },
      {
        step_label: 'Validate with recent literature',
        goal: 'Compare the leading internal explanation against recent findings.'
      }
    ],
    tool_call_suggestions: [
      {
        tool_name: 'record-lookup',
        rationale: 'Internal project evidence should come first.',
        priority: 1
      },
      {
        tool_name: 'literature-search',
        rationale: 'Use a recent external citation to validate the internal explanation.',
        priority: 2
      }
    ]
  };

  const sampleProtocol = {
    id: 'protocol-sumo1-purification',
    name: 'SUMO1 Purification',
    purpose: 'Purify SUMO1-conjugated proteins from HEK293 lysate.',
    materials: ['HEK293 cells', 'lysis buffer', 'Ni-NTA resin'],
    steps: [
      {
        id: 'step-1',
        text: 'Lyse {{ph:ph-cell-line}} cells and incubate at {{ph:ph-temp}}.',
        placeholders: [
          { id: 'ph-cell-line', name: 'cell line' },
          { id: 'ph-temp', name: 'temperature' }
        ]
      },
      {
        id: 'step-2',
        text: 'Bind the lysate to Ni-NTA resin for [time].',
        placeholders: []
      }
    ],
    troubleshooting: 'If binding is weak, verify the lysate pH.',
    aliases: ['SUMO purification'],
    project_id: sampleProject.id,
    project_name: sampleProject.name
  };
  const sampleProtocolMatches = protocolMatchingRuntime.rankProtocolMatches({
    protocols: [
      sampleProtocol,
      {
        id: 'protocol-transfection',
        name: 'HEK293 Transfection',
        purpose: 'Transiently transfect HEK293 cells.',
        materials: ['HEK293 cells', 'DNA', 'transfection reagent'],
        steps: [{ id: 'step-a', text: 'Transfect the cells.' }],
        aliases: ['Atlas transfection']
      }
    ],
    protocolCandidates: ['SUMO1 Purification'],
    message: 'Prepare the next SUMO1 purification run for Atlas.',
    parserPayload: sampleParserPayload
  });
  const samplePlaceholders = notebookGenerationRuntime.buildProtocolPlaceholderRows(sampleProtocol);
  const sampleNotebookRuns = [
    {
      id: 'nb-atlas-14',
      project_id: sampleProject.id,
      protocol_id: 'protocol-transfection',
      protocol_name: 'HEK293 Transfection',
      workflow_id: 'workflow-atlas-expression',
      notebook_state: 'executed',
      executed_at: '2026-04-03T14:00:00.000Z',
      result: 'Weak conjugation observed in HEK293 pilot.'
    }
  ];
  const sampleCandidates = [
    {
      id: 'candidate-1',
      source_type: 'workflow',
      priority: 80,
      reason: 'Downstream from the last executed expression workflow step.',
      trail: ['HEK293 Transfection', 'Expression QC'],
      protocol_id: sampleProtocol.id,
      protocol_name: sampleProtocol.name,
      workflow: {
        id: 'workflow-atlas-expression',
        name: 'Atlas Expression Workflow'
      }
    }
  ];
  const samplePaperContext = {
    title: 'UBC9 Availability Limits SUMOylation Efficiency in HEK293 Cells',
    summary: 'The paper reports that reduced UBC9 expression lowers SUMOylation efficiency in transient HEK293 assays.',
    abstract: 'Transient HEK293 experiments link reduced UBC9 abundance to weaker SUMO conjugation.',
    methods: 'HEK293 cells were transfected, lysed, and assayed for SUMO-conjugated material.',
    key_findings: '- Low UBC9 reduced conjugation efficiency',
    content: 'Cells with reduced UBC9 showed weaker SUMO1 conjugation bands after transfection.',
    message: 'Summarize the paper and extract a reusable procedure candidate.',
    extract_protocol: true,
    generate_protocol: false
  };

  const preferredToolNames = uniqueStrings([
    'record-lookup',
    'literature-search',
    ...asArray(agentToolLoading.AGENT_TOOL_CATALOG).slice(0, 4).map((tool) => tool?.name)
  ]).filter((name) => asArray(agentToolLoading.AGENT_TOOL_CATALOG).some((tool) => tool?.name === name));
  const selectedToolNames = preferredToolNames.slice(0, 2);
  const sampleToolDefinitions = selectedToolNames.map((toolName) => {
    const tool = asArray(agentToolLoading.AGENT_TOOL_CATALOG).find((entry) => entry?.name === toolName) || {};
    const schemaEntry = agentToolLoading.AGENT_TOOL_CALL_CATALOG?.[toolName] || {};
    return {
      name: toolName,
      description: tool.description || schemaEntry.description || '',
      parameters: schemaEntry.input_schema || { type: 'object', additionalProperties: true }
    };
  });

  return {
    runtimeSupport,
    sessionRuntime,
    scienceSupportRuntime,
    inputClarificationRuntime,
    routePlannerRuntime,
    exitCriteriaRuntime,
    currentScientificStateRuntime,
    exitJudgeRuntime,
    thinkingTraceRuntime,
    finalSynthesisRuntime,
    protocolMatchingRuntime,
    notebookGenerationRuntime,
    notebookDraftRuntime,
    protocolGenerationRuntime,
    paperAnalysisRuntime,
    sampleConversation,
    sampleProject,
    sampleParserPayload,
    sampleRouting,
    samplePolicy,
    sampleClarification,
    sampleExitCriteria,
    sampleCitations,
    sampleToolTrace,
    sampleLatestToolResult,
    samplePreSynthesizedQuestion,
    sampleCurrentScientificState,
    sampleEvaluation,
    sampleResearchObjective,
    sampleResearchPlan,
    sampleContextSnapshot,
    sampleAccuracySnapshot,
    sampleRoutePlan,
    sampleProtocol,
    sampleProtocolMatches,
    samplePlaceholders,
    sampleNotebookRuns,
    sampleCandidates,
    samplePaperContext,
    selectedToolNames,
    sampleToolDefinitions
  };
}

function getAgentPromptRegistry() {
  const state = buildSampleState();
  const baseSystemPrompt = state.runtimeSupport.buildAgentSystemPrompt(state.sampleProject.name, {});

  return [
    {
      id: 'shared.structured_json_only_system_prompt',
      title: 'Structured JSON Only System Prompt',
      group: 'Shared',
      kind: 'system',
      source: STRUCTURED_JSON_ONLY_SOURCES,
      content: STRUCTURED_JSON_ONLY_SYSTEM_PROMPT,
      notes: 'Shared across structured-output deep-research and science-loop steps.'
    },
    {
      id: 'core.agent_system_template',
      title: 'Default Agent System Prompt Template',
      group: 'Core Agent',
      kind: 'template',
      source: 'src/main/helpers/agent/runtime/agent-runtime-support.js',
      content: DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE
    },
    {
      id: 'core.agent_synthesis_template',
      title: 'Default Agent Synthesis Prompt Template',
      group: 'Core Agent',
      kind: 'template',
      source: 'src/main/helpers/agent/runtime/agent-runtime-support.js',
      content: DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE
    },
    {
      id: 'core.agent_system_prompt_rendered',
      title: 'Rendered Agent System Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/agent-runtime-support.js',
      render: () => state.runtimeSupport.buildAgentSystemPrompt(state.sampleProject.name, {})
    },
    {
      id: 'core.agent_synthesis_prompt_rendered',
      title: 'Rendered Agent Synthesis Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/agent-runtime-support.js',
      render: () => state.runtimeSupport.buildAgentSynthesisPrompt(false, {})
    },
    {
      id: 'core.intent_parser_catalog_prompt',
      title: 'Intent Parser Catalog Prompt',
      group: 'Core Agent',
      kind: 'static_prompt',
      source: 'src/main/helpers/agent/intent/agent-intent-parser.js',
      content: agentIntentParser.INTENT_PARSER_PROMPT
    },
    {
      id: 'core.intent_parser_runtime_prompt',
      title: 'Intent Parser Runtime Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/intent/agent-intent-parser.js',
      render: () => agentIntentParser.buildIntentParserPrompt({
        message: state.sampleConversation[0].text,
        conversation: state.sampleConversation,
        projectName: state.sampleProject.name
      })
    },
    {
      id: 'core.tool_selection_prompt',
      title: 'Tool Selection Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-tool-loading.js',
      render: () => agentToolLoading.buildToolSelectionPrompt({
        message: state.sampleConversation[0].text,
        conversation: state.sampleConversation,
        parserPayload: state.sampleParserPayload,
        projectName: state.sampleProject.name
      })
    },
    {
      id: 'core.tool_arguments_prompt',
      title: 'Tool Arguments Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-tool-loading.js',
      render: () => agentToolLoading.buildToolArgumentsPrompt({
        message: state.sampleConversation[0].text,
        conversation: state.sampleConversation,
        parserPayload: state.sampleParserPayload,
        selectedToolNames: state.selectedToolNames
      })
    },
    {
      id: 'core.codex_tool_loop_prompt',
      title: 'Codex Tool Loop Prompt',
      group: 'Core Agent',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/agent-session-runtime.js',
      render: () => state.sessionRuntime.buildCodexToolLoopPrompt({
        systemPrompt: baseSystemPrompt,
        transcript: state.sampleConversation,
        toolDefinitions: state.sampleToolDefinitions
      })
    },
    {
      id: 'protocol.protocol_selection_system',
      title: 'Protocol Selection System Prompt',
      group: 'Notebook And Protocol',
      kind: 'system',
      source: 'src/main/helpers/agent/tools/agent-protocol-matching.js',
      render: () => state.protocolMatchingRuntime.PROTOCOL_TO_NOTEBOOK_SELECTION_SYSTEM_PROMPT
    },
    {
      id: 'protocol.protocol_selection_rules',
      title: 'Protocol Selection Rules',
      group: 'Notebook And Protocol',
      kind: 'rules',
      source: 'src/main/helpers/agent/tools/agent-protocol-matching.js',
      render: () => state.protocolMatchingRuntime.PROTOCOL_TO_NOTEBOOK_SELECTION_RULES
    },
    {
      id: 'protocol.protocol_selection_prompt',
      title: 'Protocol Selection Tie-Break Prompt',
      group: 'Notebook And Protocol',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-protocol-matching.js',
      render: () => state.protocolMatchingRuntime.buildProtocolTieBreakPrompt({
        message: 'Prepare the next SUMO1 purification run for Atlas.',
        conversation: state.sampleConversation,
        parserPayload: state.sampleParserPayload,
        rankedMatches: state.sampleProtocolMatches
      })
    },
    {
      id: 'protocol.notebook_fill_system',
      title: 'Notebook Fill System Prompt',
      group: 'Notebook And Protocol',
      kind: 'system',
      source: 'src/main/helpers/agent/tools/agent-notebook-generation.js',
      render: () => state.notebookGenerationRuntime.PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT
    },
    {
      id: 'protocol.notebook_fill_rules',
      title: 'Notebook Fill Rules',
      group: 'Notebook And Protocol',
      kind: 'rules',
      source: 'src/main/helpers/agent/tools/agent-notebook-generation.js',
      render: () => state.notebookGenerationRuntime.PROTOCOL_TO_NOTEBOOK_FILL_RULES
    },
    {
      id: 'protocol.notebook_fill_examples',
      title: 'Notebook Fill Examples',
      group: 'Notebook And Protocol',
      kind: 'examples',
      source: 'src/main/helpers/agent/tools/agent-notebook-generation.js',
      render: () => state.notebookGenerationRuntime.PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES
    },
    {
      id: 'protocol.notebook_fill_prompt',
      title: 'Notebook Fill Prompt',
      group: 'Notebook And Protocol',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-notebook-generation.js',
      render: () => state.notebookGenerationRuntime.buildNotebookPlaceholderFillPrompt({
        message: 'Use HEK293 cells and incubate at 4 C for 30 minutes.',
        conversation: state.sampleConversation,
        parserPayload: state.sampleParserPayload,
        selectedProtocol: state.sampleProtocol,
        project: state.sampleProject,
        placeholders: state.samplePlaceholders,
        unresolvedPlaceholders: state.samplePlaceholders,
        toolContext: {
          tool_name: 'search_inventory',
          summary: 'Inventory contains HEK293 lysate tubes and standard lysis buffer.'
        }
      })
    },
    {
      id: 'protocol.notebook_draft_system',
      title: 'Notebook Draft Selection System Prompt',
      group: 'Notebook And Protocol',
      kind: 'system',
      source: 'src/main/helpers/agent/tools/agent-notebook-draft.js',
      render: () => state.notebookDraftRuntime.NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT
    },
    {
      id: 'protocol.notebook_draft_rules',
      title: 'Notebook Draft Selection Rules',
      group: 'Notebook And Protocol',
      kind: 'rules',
      source: 'src/main/helpers/agent/tools/agent-notebook-draft.js',
      render: () => state.notebookDraftRuntime.NOTEBOOK_DRAFT_SELECTION_RULES
    },
    {
      id: 'protocol.notebook_draft_prompt',
      title: 'Notebook Draft Selection Prompt',
      group: 'Notebook And Protocol',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-notebook-draft.js',
      render: () => state.notebookDraftRuntime.buildNotebookDraftSelectionPrompt({
        message: 'Plan the next Atlas purification notebook draft.',
        conversation: state.sampleConversation,
        parserPayload: state.sampleParserPayload,
        project: state.sampleProject,
        notebookRuns: state.sampleNotebookRuns,
        candidates: state.sampleCandidates
      })
    },
    {
      id: 'protocol.protocol_generation_system',
      title: 'Protocol Generation System Prompt',
      group: 'Notebook And Protocol',
      kind: 'system',
      source: 'src/main/helpers/agent/tools/agent-protocol-generation.js',
      render: () => state.protocolGenerationRuntime.PROTOCOL_GENERATION_SYSTEM_PROMPT
    },
    {
      id: 'protocol.protocol_generation_rules',
      title: 'Protocol Generation Rules',
      group: 'Notebook And Protocol',
      kind: 'rules',
      source: 'src/main/helpers/agent/tools/agent-protocol-generation.js',
      render: () => state.protocolGenerationRuntime.PROTOCOL_GENERATION_RULES
    },
    {
      id: 'protocol.protocol_generation_prompt',
      title: 'Protocol Generation Prompt',
      group: 'Notebook And Protocol',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-protocol-generation.js',
      render: () => state.protocolGenerationRuntime.buildPrompt({
        title: 'SUMO1 Purification',
        purpose: 'Purify SUMO1-conjugated proteins from HEK293 lysate.',
        source_paper_title: state.samplePaperContext.title,
        source_summary: state.samplePaperContext.summary,
        method_text: 'Lyse HEK293 cells, incubate on ice, bind lysate to Ni-NTA resin, wash, and elute SUMO-conjugated material.',
        materials: ['HEK293 cells', 'lysis buffer', 'Ni-NTA resin'],
        steps: ['Lyse the cells on ice.', 'Bind the lysate to Ni-NTA resin.', 'Wash and elute.'],
        message: 'Convert the paper methods into a concise reusable protocol.'
      })
    },
    {
      id: 'protocol.paper_analysis_system',
      title: 'Paper Analysis System Prompt',
      group: 'Notebook And Protocol',
      kind: 'system',
      source: 'src/main/helpers/agent/tools/agent-paper-analysis.js',
      render: () => state.paperAnalysisRuntime.PAPER_ANALYSIS_SYSTEM_PROMPT
    },
    {
      id: 'protocol.paper_analysis_rules',
      title: 'Paper Analysis Rules',
      group: 'Notebook And Protocol',
      kind: 'rules',
      source: 'src/main/helpers/agent/tools/agent-paper-analysis.js',
      render: () => state.paperAnalysisRuntime.PAPER_ANALYSIS_RULES
    },
    {
      id: 'protocol.paper_analysis_prompt',
      title: 'Paper Analysis Prompt',
      group: 'Notebook And Protocol',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/tools/agent-paper-analysis.js',
      render: () => state.paperAnalysisRuntime.buildPrompt(state.samplePaperContext)
    },
    {
      id: 'science.session_system_prompt',
      title: 'Science Session System Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/support.js',
      render: () => state.scienceSupportRuntime.buildScienceSessionSystemPrompt({
        baseSystemPrompt,
        intent: state.sampleRouting.intent,
        policy: state.samplePolicy,
        routing: state.sampleRouting,
        project: state.sampleProject,
        originalMessage: state.sampleConversation[0].text,
        clarification: state.sampleClarification,
        routePlan: state.sampleRoutePlan,
        exitCriteria: state.sampleExitCriteria,
        message: state.sampleClarification.clarified_input,
        reasoningEffort: state.sampleRouting.reasoning_effort,
        directAnswerOnly: false
      })
    },
    {
      id: 'science.evaluator_feedback_prompt',
      title: 'Science Evaluator Feedback Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/support.js',
      render: () => state.scienceSupportRuntime.buildEvaluatorFeedback(
        state.sampleEvaluation,
        state.sampleRouting.intent
      )
    },
    {
      id: 'science.input_clarification_prompt',
      title: 'Science Input Clarification Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/input-clarification.js',
      render: () => state.inputClarificationRuntime.buildClarificationPrompt({
        intent: state.sampleRouting.intent,
        project: state.sampleProject,
        parserPayload: state.sampleParserPayload,
        routing: state.sampleRouting,
        conversation: state.sampleConversation,
        message: state.sampleConversation[0].text
      })
    },
    {
      id: 'science.route_plan_prompt',
      title: 'Science Route Plan Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/agent-route-planner.js',
      render: () => state.routePlannerRuntime.buildRoutePlanPrompt({
        intent: state.sampleRouting.intent,
        reasoningEffort: state.sampleRouting.reasoning_effort,
        policy: state.samplePolicy,
        project: state.sampleProject,
        clarification: state.sampleClarification,
        parserPayload: state.sampleParserPayload,
        routing: state.sampleRouting,
        originalMessage: state.sampleConversation[0].text,
        clarifiedInput: state.sampleClarification.clarified_input
      })
    },
    {
      id: 'science.exit_criteria_prompt',
      title: 'Science Exit Criteria Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/loop-exit-criteria.js',
      render: () => state.exitCriteriaRuntime.buildExitCriteriaPrompt({
        intent: state.sampleRouting.intent,
        policy: state.samplePolicy,
        project: state.sampleProject,
        clarification: state.sampleClarification,
        parserPayload: state.sampleParserPayload,
        routing: state.sampleRouting,
        originalMessage: state.sampleConversation[0].text,
        clarifiedInput: state.sampleClarification.clarified_input
      })
    },
    {
      id: 'science.current_state_prompt',
      title: 'Science Current State Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/current-scientific-state.js',
      render: () => state.currentScientificStateRuntime.buildCurrentScientificStatePrompt({
        intent: state.sampleRouting.intent,
        exitCriteria: state.sampleExitCriteria,
        preSynthesizedQuestion: state.samplePreSynthesizedQuestion,
        project: state.sampleProject,
        clarification: state.sampleClarification,
        originalMessage: state.sampleConversation[0].text,
        message: state.sampleClarification.clarified_input,
        latestAssistantText: 'Internal evidence points to low UBC9 availability.',
        latestToolResult: state.sampleLatestToolResult,
        toolTrace: state.sampleToolTrace,
        citations: state.sampleCitations,
        roundsExecuted: 2,
        maxRounds: 4
      })
    },
    {
      id: 'science.exit_judge_system_prompt',
      title: 'Science Exit Judge System Prompt',
      group: 'Science Reasoning',
      kind: 'system',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/loop-exit-judge.js',
      render: () => state.exitJudgeRuntime.buildJudgeSystemPrompt()
    },
    {
      id: 'science.exit_judge_message_prompt',
      title: 'Science Exit Judge Message Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/loop-exit-judge.js',
      render: () => state.exitJudgeRuntime.buildJudgeMessage({
        intent: state.sampleRouting.intent,
        exitCriteria: state.sampleExitCriteria,
        preSynthesizedQuestion: state.samplePreSynthesizedQuestion,
        currentScientificState: state.sampleCurrentScientificState,
        project: state.sampleProject,
        clarification: state.sampleClarification,
        originalMessage: state.sampleConversation[0].text,
        message: state.sampleClarification.clarified_input,
        latestAssistantText: 'Low UBC9 remains the leading explanation.',
        latestToolResult: state.sampleLatestToolResult,
        toolTrace: state.sampleToolTrace,
        citations: state.sampleCitations,
        roundsExecuted: 2,
        maxRounds: 4
      })
    },
    {
      id: 'science.thinking_trace_prompt',
      title: 'Science Thinking Trace Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/thinking-trace.js',
      render: () => state.thinkingTraceRuntime.buildThinkingTracePrompt({
        intent: state.sampleRouting.intent,
        originalMessage: state.sampleConversation[0].text,
        clarifiedInput: state.sampleClarification.clarified_input,
        parserPayload: state.sampleParserPayload,
        clarification: state.sampleClarification,
        routePlan: state.sampleRoutePlan,
        exitCriteria: state.sampleExitCriteria,
        toolRounds: state.sampleToolTrace.map((row, index) => ({
          round: index + 1,
          assistant_before_tool: index === 0
            ? 'I should inspect Atlas records first.'
            : 'I now need recent external evidence.',
          tool_name: row.tool_name,
          tool_arguments: { query: 'sample query' },
          tool_summary: row.summary,
          assistant_after_tool: row.assistant_after_tool
        })),
        preSynthesizedQuestion: state.samplePreSynthesizedQuestion,
        evaluation: state.sampleEvaluation,
        status: 'completed',
        finalAnswer: 'Low UBC9 expression is the best-supported explanation.'
      })
    },
    {
      id: 'science.final_synthesis_prompt',
      title: 'Science Final Synthesis Prompt',
      group: 'Science Reasoning',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/runtime/science-reasoning-loop/final-synthesis.js',
      render: () => state.finalSynthesisRuntime.buildSynthesisPrompt({
        intent: state.sampleRouting.intent,
        policy: state.samplePolicy,
        originalMessage: state.sampleConversation[0].text,
        message: state.sampleClarification.clarified_input,
        clarification: state.sampleClarification,
        parserPayload: state.sampleParserPayload,
        project: state.sampleProject,
        roundsExecuted: 2,
        maxRounds: 4,
        evaluator: state.sampleEvaluation,
        accumulatedCitations: state.sampleCitations,
        toolTrace: state.sampleToolTrace,
        partial: false
      })
    },
    {
      id: 'deep_research.step1_clarify_prompt',
      title: 'Deep Research Step 1 Clarify Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-1-clarify-question.js',
      render: () => buildClarifyPrompt({
        intent: state.sampleRouting.intent,
        policy: state.samplePolicy,
        parserPayload: state.sampleParserPayload,
        routing: state.sampleRouting,
        project: state.sampleProject,
        message: state.sampleConversation[0].text
      })
    },
    {
      id: 'deep_research.step2_follow_up_prompt',
      title: 'Deep Research Step 2 Follow-Up Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-2-ask-targeted-follow-up.js',
      render: () => buildFollowUpPrompt({
        intent: state.sampleRouting.intent,
        clarifyResult: state.sampleClarification,
        parserPayload: state.sampleParserPayload,
        project: state.sampleProject,
        message: state.sampleConversation[0].text
      })
    },
    {
      id: 'deep_research.step3_plan_prompt',
      title: 'Deep Research Step 3 Research Plan Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-3-draft-research-plan.js',
      render: () => buildResearchPlanPrompt({
        intent: state.sampleRouting.intent,
        clarifyResult: state.sampleClarification,
        policy: state.samplePolicy,
        project: state.sampleProject,
        message: state.sampleConversation[0].text
      })
    },
    {
      id: 'deep_research.step4_execution_prompt',
      title: 'Deep Research Step 4 Execution Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-4-execute-plan.js',
      render: () => buildExecutionActionPrompt({
        intent: state.sampleRouting.intent,
        researchObjective: state.sampleResearchObjective,
        researchPlan: state.sampleResearchPlan,
        contextSnapshot: state.sampleContextSnapshot,
        accuracySnapshot: state.sampleAccuracySnapshot,
        completionCheck: state.sampleEvaluation,
        toolTrace: state.sampleToolTrace,
        toolDefinitions: state.sampleToolDefinitions,
        roundsExecuted: 2,
        maxRounds: 4
      })
    },
    {
      id: 'deep_research.step5_outline_prompt',
      title: 'Deep Research Step 5 Outline Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-5-assemble-final-answer.js',
      render: () => buildOutlinePrompt({
        intent: state.sampleRouting.intent,
        researchObjective: state.sampleResearchObjective,
        researchPlan: state.sampleResearchPlan,
        completionCheck: state.sampleEvaluation
      })
    },
    {
      id: 'deep_research.step5_section_prompt',
      title: 'Deep Research Step 5 Section Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/step-5-assemble-final-answer.js',
      render: () => buildSectionPrompt({
        section: {
          title: 'Direct Answer',
          objective: 'State the best-supported cause of weak SUMO1 conjugation.'
        },
        researchObjective: state.sampleResearchObjective,
        sectionEvidence: {
          evidence: state.sampleCitations,
          notes: ['Internal Atlas evidence and recent literature point in the same direction.']
        },
        contextSnapshot: state.sampleContextSnapshot,
        accuracySnapshot: state.sampleAccuracySnapshot
      })
    },
    {
      id: 'deep_research.sub_agent_instruction_prompt',
      title: 'Deep Research Sub-Agent Instruction Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/sub-agent-usage.js',
      render: () => buildSubAgentInstruction({
        researchObjective: state.sampleResearchObjective.research_goal,
        subquestion: state.sampleResearchPlan.key_subquestions[1],
        contextSnapshot: state.sampleContextSnapshot
      })
    },
    {
      id: 'deep_research.completion_check_prompt',
      title: 'Deep Research Completion Check Prompt',
      group: 'Deep Research',
      kind: 'dynamic_sample',
      source: 'src/main/helpers/agent/deep-research/sub-agent-usage.js',
      render: () => buildCompletionCheckPrompt({
        intent: state.sampleRouting.intent,
        researchObjective: state.sampleResearchObjective,
        researchPlan: state.sampleResearchPlan,
        contextSnapshot: state.sampleContextSnapshot,
        accuracySnapshot: state.sampleAccuracySnapshot,
        toolTrace: state.sampleToolTrace,
        citations: state.sampleCitations,
        roundsExecuted: 2,
        maxRounds: 4
      })
    }
  ];
}

function renderAgentPromptRegistryMarkdown(options = {}) {
  const generatedAt = String(options.generatedAt || new Date().toISOString());
  const registry = getAgentPromptRegistry();
  const groups = uniqueStrings(registry.map((entry) => entry.group));
  const lines = [
    '# Agent Prompt Registry',
    '',
    `Generated at: ${generatedAt}`,
    `Prompt entries: ${registry.length}`,
    '',
    'This file is generated from the prompt registry and sample renderers in `src/main/helpers/agent/shared/agent-prompt-registry.js`.',
    ''
  ];

  groups.forEach((group) => {
    const groupEntries = registry.filter((entry) => entry.group === group);
    lines.push(`## ${group}`);
    lines.push('');
    groupEntries.forEach((entry) => {
      const sourceList = asArray(entry.source).length ? asArray(entry.source) : [entry.source];
      const promptText = renderPromptBlock(entry);
      lines.push(`### ${entry.title}`);
      lines.push('');
      lines.push(`ID: \`${entry.id}\``);
      lines.push(`Kind: \`${entry.kind}\``);
      lines.push(`Source: ${sourceList.map((item) => `\`${String(item).trim()}\``).join(', ')}`);
      if (entry.notes) {
        lines.push(`Notes: ${String(entry.notes).trim()}`);
      }
      lines.push('');
      lines.push('```text');
      lines.push(promptText);
      lines.push('```');
      lines.push('');
    });
  });

  return `${lines.join('\n').trim()}\n`;
}

module.exports = {
  STRUCTURED_JSON_ONLY_SYSTEM_PROMPT,
  getAgentPromptRegistry,
  renderAgentPromptRegistryMarkdown
};
