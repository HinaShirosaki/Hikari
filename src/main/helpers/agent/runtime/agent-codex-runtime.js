'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function createCodexAgentRuntime(deps = {}) {
  const {
    asArray,
    cleanText
  } = createAgentLlmRuntimeHelpers(deps);
  const runTool = typeof deps.runAgentTool === 'function' ? deps.runAgentTool : null;
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = typeof deps.getCodexCliWorkingDirectory === 'function'
    ? deps.getCodexCliWorkingDirectory
    : (() => process.cwd());
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const buildInventoryToolArgs = typeof deps.buildInventoryToolArgs === 'function'
    ? deps.buildInventoryToolArgs
    : ((_input) => ({ query: '', limit: 5 }));
  const buildAgentSystemPrompt = typeof deps.buildAgentSystemPrompt === 'function'
    ? deps.buildAgentSystemPrompt
    : (() => '');
  const buildAgentSynthesisPrompt = typeof deps.buildAgentSynthesisPrompt === 'function'
    ? deps.buildAgentSynthesisPrompt
    : (() => '');
  const normalizeAgentOutput = typeof deps.normalizeAgentOutput === 'function'
    ? deps.normalizeAgentOutput
    : ((raw, fallbackText) => ({ answer: fallbackText || String(raw || ''), confidence: 0.55, requiresApproval: false, proposedWriteActions: [], citations: [], decisionRecord: { assumptions: [], open_questions: [], verification_notes: [] } }));
  const toPromptConversationTranscript = typeof deps.toPromptConversationTranscript === 'function'
    ? deps.toPromptConversationTranscript
    : ((conversation = []) => asArray(conversation).map((item, index) => `${index + 1}. ${item?.role || 'user'}: ${cleanText(item?.text, 2400)}`).join('\n'));
  const applyResponseLayerToOutput = typeof deps.applyResponseLayerToOutput === 'function'
    ? deps.applyResponseLayerToOutput
    : ((input = {}) => input.normalized || {});
  const applyValidationGateToOutput = typeof deps.applyValidationGateToOutput === 'function'
    ? deps.applyValidationGateToOutput
    : ((input = {}) => ({ routing: input.routing, normalized: input.normalized, validation: { passed: true, forced_clarification: false, violations: [], failure_reasons: [] }, provenance: { source_evidence: [], unsupported_statement_count: 0 } }));
  const normalizeRoutingPayload = typeof deps.normalizeRoutingPayload === 'function'
    ? deps.normalizeRoutingPayload
    : ((value) => value && typeof value === 'object' ? value : {});
  const containsWriteIntent = typeof deps.containsWriteIntent === 'function'
    ? deps.containsWriteIntent
    : ((text) => /\b(create|update|edit|delete|remove|reserve|consume|commit|save|download|fetch|import|upload|store)\b/i.test(String(text || '')));

  function buildIntermediateState(stage, goal, extras = {}) {
    return {
      state_id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      created_at: new Date().toISOString(),
      stage,
      goal: cleanText(goal, 600),
      assumptions: asArray(extras.assumptions).map((item) => cleanText(item, 280)).filter(Boolean),
      open_questions: asArray(extras.open_questions || extras.openQuestions).map((item) => cleanText(item, 280)).filter(Boolean),
      evidence: asArray(extras.evidence).slice(0, 12).map((item) => ({
        source: cleanText(item?.source, 120),
        pointer: cleanText(item?.pointer, 200),
        reason: cleanText(item?.reason, 220)
      })),
      confidence: Number.isFinite(Number(extras.confidence)) ? Number(extras.confidence) : 0.5
    };
  }

  async function buildCodexAgentContext(message, snapshot, selectedToolNames = null, routing = null) {
    const allowedRetrievalTools = [
      'search_projects',
      'search_protocols',
      'search_notebook_entries',
      'search_workflows',
      'search_assays',
      'search_gel_analyses',
      'search_inventory',
      'search_papers',
      'search_web'
    ];
    const retrievalTools = Array.isArray(selectedToolNames)
      ? asArray(selectedToolNames)
        .map((name) => cleanText(name, 120))
        .filter((name) => allowedRetrievalTools.includes(name))
      : allowedRetrievalTools;
    const contextSlices = [];
    const toolTrace = [];
    const evidence = [];
    if (typeof runTool !== 'function') {
      return { contextSlices, toolTrace, evidence };
    }

    for (const toolName of retrievalTools) {
      const toolArgs = toolName === 'search_inventory'
        ? buildInventoryToolArgs({
          message,
          routing,
          args: { query: message, limit: 5 }
        })
        : { query: message, limit: 5 };
      const result = await runTool(toolName, toolArgs, snapshot, { allowWriteTools: false });
      const items = asArray(result?.items).slice(0, 5);
      if (!items.length) {
        continue;
      }
      contextSlices.push({
        tool: toolName,
        items
      });
      toolTrace.push({
        tool_name: toolName,
        args: result?.input && typeof result.input === 'object' ? result.input : toolArgs,
        summary: cleanText(result?.summary || `Collected ${items.length} records.`, 240)
      });
      asArray(result?.citations).slice(0, 8).forEach((citation) => {
        evidence.push({
          source: cleanText(citation?.source, 120),
          pointer: cleanText(citation?.pointer, 180),
          reason: cleanText(citation?.reason, 220)
        });
      });
    }

    return {
      contextSlices,
      toolTrace,
      evidence
    };
  }

  async function runCodexAgentController({
    provider,
    model,
    message,
    conversation,
    hasLatestUserInConversation,
    snapshot,
    projectName,
    promptConfig,
    allowWriteTools,
    routing,
    traceContext = null
  } = {}) {
    const normalizedRouting = normalizeRoutingPayload(routing);
    const intermediateStates = [];
    const requiresApproval = containsWriteIntent(message) && !allowWriteTools;

    intermediateStates.push(buildIntermediateState('intake', message, {
      assumptions: [
        'Codex CLI provider selected for retrieved-context synthesis.'
      ],
      openQuestions: normalizedRouting.plan?.needs_clarification === true
        ? [cleanText(normalizedRouting.plan?.clarification_question, 320)]
        : [],
      confidence: 0.45
    }));

    const collected = await buildCodexAgentContext(
      message,
      snapshot,
      normalizedRouting.plan?.selected_tool_names,
      normalizedRouting
    );

    intermediateStates.push(buildIntermediateState('context', `Prepared ${collected.contextSlices.length} retrieval context slices for Codex CLI.`, {
      evidence: collected.evidence,
      confidence: collected.contextSlices.length ? 0.64 : 0.5
    }));

    const promptConversation = hasLatestUserInConversation
      ? asArray(conversation)
      : [...asArray(conversation), { role: 'user', text: message }];
    const systemPrompt = buildAgentSystemPrompt(projectName, promptConfig);
    const draftPrompt = [
      systemPrompt,
      'Task: answer the latest user request using only the retrieved Enana context below. If context is missing, explicitly say what is missing.',
      `Conversation transcript:\n${toPromptConversationTranscript(promptConversation)}`,
      `Routing decision JSON:\n${cleanText(JSON.stringify(normalizedRouting, null, 2), 10000)}`,
      `Retrieved context JSON:\n${cleanText(JSON.stringify(collected.contextSlices, null, 2), 70000)}`,
      'Respond as concise assistant text.'
    ].join('\n\n');

    const draftAnswer = await requestCodexCliText({
      prompt: draftPrompt,
      model,
      cwd: getCodexCliWorkingDirectory()
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'agent_round_0',
      provider,
      model,
      summary: 'Generated draft answer from retrieved context via Codex CLI.',
      request_payload: {
        model,
        prompt: draftPrompt
      },
      response_payload: draftAnswer
    });

    let normalized;
    try {
      const synthesisPrompt = [
        buildAgentSynthesisPrompt(requiresApproval, promptConfig),
        'Return valid JSON and include citations only from provided evidence.',
        `User request: ${message}`,
        `Draft answer: ${draftAnswer || '-'}`,
        `Tool trace: ${JSON.stringify(collected.toolTrace.slice(0, 20))}`,
        `Evidence: ${JSON.stringify(collected.evidence.slice(0, 20))}`
      ].join('\n\n');
      const structuredRaw = await requestCodexCliText({
        prompt: synthesisPrompt,
        model,
        cwd: getCodexCliWorkingDirectory()
      });
      await recordAgentLlmTrace(traceContext, {
        stage: 'synthesis',
        provider,
        model,
        summary: 'Structured synthesis round completed via Codex CLI.',
        request_payload: {
          model,
          prompt: synthesisPrompt
        },
        response_payload: structuredRaw
      });
      normalized = normalizeAgentOutput(structuredRaw, draftAnswer);
    } catch {
      normalized = normalizeAgentOutput(null, draftAnswer);
    }

    normalized = applyResponseLayerToOutput({
      normalized: {
        ...normalized,
        requiresApproval: normalized.requiresApproval === true || requiresApproval,
        proposedWriteActions: normalized.requiresApproval === true || requiresApproval
          ? asArray(normalized.proposedWriteActions).length
            ? asArray(normalized.proposedWriteActions)
            : [{
              tool_name: 'write_operation_pending_approval',
              reason: 'User intent appears write-oriented; explicit approval is required before execution.'
            }]
          : asArray(normalized.proposedWriteActions)
      },
      routing: normalizedRouting,
      notebookDraft: null,
      toolTrace: collected.toolTrace
    });

    const validated = applyValidationGateToOutput({
      routing: normalizedRouting,
      normalized: {
        ...normalized,
        citations: asArray(normalized.citations).length ? normalized.citations : collected.evidence
      },
      notebookDraft: null,
      toolTrace: collected.toolTrace
    });

    intermediateStates.push(buildIntermediateState('response', 'Applied response-layer metadata and validation gate.', {
      evidence: collected.evidence,
      confidence: Number(validated?.normalized?.confidence) || 0.55
    }));

    return {
      ok: true,
      provider,
      model: model || 'codex-default',
      answer: cleanText(validated?.normalized?.answer, 12000),
      confidence: Number(validated?.normalized?.confidence) || 0.55,
      requiresApproval: validated?.normalized?.requiresApproval === true,
      proposedWriteActions: asArray(validated?.normalized?.proposedWriteActions),
      citations: asArray(validated?.normalized?.citations),
      decisionRecord: validated?.normalized?.decisionRecord && typeof validated.normalized.decisionRecord === 'object'
        ? validated.normalized.decisionRecord
        : {
          assumptions: [],
          open_questions: [],
          verification_notes: []
        },
      routing: validated?.routing || normalizedRouting,
      response_type: cleanText(validated?.normalized?.response_type, 80),
      confidence_label: cleanText(validated?.normalized?.confidence_label, 20),
      source_summary: validated?.normalized?.source_summary && typeof validated.normalized.source_summary === 'object'
        ? validated.normalized.source_summary
        : { total_sources: 0, groups: [] },
      unresolved_fields: asArray(validated?.normalized?.unresolved_fields),
      validation: validated?.validation || {
        passed: true,
        forced_clarification: false,
        violations: [],
        failure_reasons: []
      },
      provenance: validated?.provenance || {
        source_evidence: [],
        unsupported_statement_count: 0
      },
      intermediateStates,
      toolTrace: collected.toolTrace,
      developer_trace: asArray(traceContext?.rows)
    };
  }

  return {
    buildCodexAgentContext,
    runCodexAgentController
  };
}

module.exports = {
  createCodexAgentRuntime
};
