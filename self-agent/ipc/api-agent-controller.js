'use strict';

const { createAgentIntentDispatcher } = require('./agent-intent-dispatcher');
const { createAgentOpenContextRuntime } = require('./agent-open-context-runtime');
const { createSelectionInsightRuntime } = require('./selection-insight-runtime');
const { throwIfAgentRequestAborted } = require('../../src/main/lib/llm/request-context.js');

function createApiAgentController({
  deps,
  cleanText,
  controllerUtils,
  observability,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  scienceMainUtils,
  agentToolRuntime,
  executeInventoryLookup,
  executeNotebookLookup,
  agentChatLogRuntime,
  getDefaultDataFilePath,
  lifecycleService
} = {}) {
  const { asArray } = lifecycleService;
  const openContextRuntime = createAgentOpenContextRuntime({
    cleanText,
    observability,
    protocolNotebookRuntime,
    executeInventoryLookup,
    executeNotebookLookup,
    getDefaultDataFilePath,
    agentChatLogRuntime
  });
  const intentDispatcher = createAgentIntentDispatcher({
    deps,
    cleanText,
    observability,
    protocolNotebookRuntime,
    scienceReasoningLoopRuntime,
    scienceMainUtils,
    agentToolRuntime,
    executeInventoryLookup,
    executeNotebookLookup,
    getDefaultDataFilePath,
    lifecycleService
  });
  const selectionInsightRuntime = createSelectionInsightRuntime({
    cleanText,
    requestText: typeof controllerUtils.requestText === 'function'
      ? controllerUtils.requestText
      : null,
    requestWebSearch: typeof controllerUtils.requestWebSearch === 'function'
      ? controllerUtils.requestWebSearch
      : null,
    observability
  });

  function clarificationNeedsProjectScope(parserPayload = {}) {
    const clarificationText = cleanText(
      parserPayload?.clarification_reason || parserPayload?.clarification_question,
      320
    ).toLowerCase();
    return /\bproject\b|\bworkspace\b/.test(clarificationText);
  }

  function contextualizeParserPayload(parserPayload = {}, {
    projectId = '',
    projectName = ''
  } = {}) {
    const selectedProjectId = cleanText(projectId, 120);
    const selectedProjectName = cleanText(projectName, 220);
    if (!selectedProjectId && !selectedProjectName) {
      return parserPayload && typeof parserPayload === 'object' ? parserPayload : {};
    }

    const source = parserPayload && typeof parserPayload === 'object' ? parserPayload : {};
    const entities = source.entities && typeof source.entities === 'object' && !Array.isArray(source.entities)
      ? { ...source.entities }
      : {};
    const next = {
      ...source,
      entities
    };
    const originalIntent = cleanText(source.primary_intent, 80);
    const projectScopedIntents = new Set([
      'project_science_question',
      'protocol_to_notebook',
      'notebook_draft'
    ]);
    const upgradeToProjectScience = originalIntent === 'general_science_question';
    if (upgradeToProjectScience) {
      next.primary_intent = 'project_science_question';
    }
    const effectiveIntent = cleanText(next.primary_intent, 80);
    if (projectScopedIntents.has(effectiveIntent)) {
      if (!cleanText(entities.project_id, 120) && selectedProjectId) {
        entities.project_id = selectedProjectId;
      }
      if (!cleanText(entities.project_name, 220) && !cleanText(entities.project, 220) && selectedProjectName) {
        entities.project_name = selectedProjectName;
      }
      if (next.needs_clarification === true && clarificationNeedsProjectScope(next)) {
        next.needs_clarification = false;
        next.clarification_reason = null;
        if (Object.prototype.hasOwnProperty.call(next, 'clarification_question')) {
          next.clarification_question = '';
        }
      }
    }
    const contextualNotes = [];
    if (upgradeToProjectScience) {
      contextualNotes.push(
        `Selected project scope ${selectedProjectName || selectedProjectId} upgraded this request to project_science_question.`
      );
    }
    if (source.needs_clarification === true && next.needs_clarification === false) {
      contextualNotes.push('Selected project scope satisfied the missing project requirement.');
    }
    if (contextualNotes.length) {
      next.reasoning_summary = [
        cleanText(source.reasoning_summary, 1200),
        ...contextualNotes
      ].filter(Boolean).join(' ');
    }
    return next;
  }

  function cloneJson(value, fallback = null) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function extractStructuredThinkingTrace(result = {}) {
    const source = result && typeof result === 'object' ? result : {};
    const candidates = [
      source.thinking_trace,
      source.general_science_question?.thinking_trace,
      source.project_science_question?.thinking_trace,
      source.result_analysis?.thinking_trace
    ];
    const match = candidates.find((candidate) => (
      candidate
      && typeof candidate === 'object'
      && !Array.isArray(candidate)
    ));
    return match ? cloneJson(match, null) : null;
  }

  async function run({
    payload,
    runtime,
    provider,
    endpoint,
    apiKey,
    model,
    effectiveMessage,
    promptConversation,
    attachments,
    snapshot,
    executionFlags,
    traceContext,
    projectId,
    projectName,
    skillPromptPayload,
    lifecycleRecorder
  } = {}) {
    if (!apiKey) {
      throw new Error(
        'Missing LLM API key. Set it in Settings > LLM Model & Access, or use LLM_API_KEY / HIKARI_LLM_API_KEY.'
      );
    }

    const selectionInsightResult = await selectionInsightRuntime.runSelectionInsight(payload, {
      provider,
      endpoint,
      apiKey,
      model,
      snapshot,
      traceContext,
      lifecycleRecorder
    });
    if (selectionInsightResult) {
      if (executionFlags.developerMode === true) {
        selectionInsightResult.developer_trace = asArray(traceContext?.rows);
      }
      return selectionInsightResult;
    }

    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only',
      status: 'ok',
      message: 'Running parser-first API agent pipeline.'
    });

    const parserBypass = await openContextRuntime.resolveParserBypass({
      projectId,
      projectName,
      chatSessionId: cleanText(runtime?.chatSessionId, 120),
      chatSessionStoragePath: cleanText(runtime?.chatSessionStoragePath, 2400)
    });
    const parserWasSkipped = Boolean(parserBypass?.ok === true && parserBypass?.payload);
    const rawParserResult = parserWasSkipped
      ? {
        ok: true,
        payload: parserBypass.payload
      }
      : await controllerUtils.requestIntentParserPayload({
        message: effectiveMessage,
        conversation: promptConversation,
        projectName,
        traceContext
      });
    throwIfAgentRequestAborted('Agent request stopped after intent parsing.');
    if (!rawParserResult?.ok || !rawParserResult?.payload) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'parser_completed',
        status: 'failed',
        message: cleanText(rawParserResult?.error || 'Malformed parser output.', 320),
        failure_reasons: ['intent_parser_failed']
      });
      return {
        ok: false,
        provider,
        model,
        error: cleanText(`Intent parser failed: ${rawParserResult?.error || 'Malformed parser output.'}`, 360)
      };
    }
    const parserResult = {
      ...rawParserResult,
      payload: contextualizeParserPayload(rawParserResult.payload, {
        projectId,
        projectName
      })
    };
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'parser_completed',
      status: 'ok',
      routing_intent: cleanText(parserResult.payload.primary_intent, 80) || 'unclear',
      message: parserWasSkipped
        ? cleanText(parserBypass?.message, 320) || 'Skipped intent parser because the context is still open.'
        : `Intent parser returned primary_intent=${cleanText(parserResult.payload.primary_intent, 80) || 'unknown'}.`,
      meta: {
        needs_clarification: parserResult.payload.needs_clarification === true,
        skipped: parserWasSkipped === true,
        resumed_from_pending: parserBypass?.meta?.resumed_from_pending === true
      }
    });

    const result = {
      ok: true,
      parser: parserResult.payload
    };
    await intentDispatcher.dispatchIntent({
      payload,
      context: {
        provider,
        endpoint,
        apiKey,
        model,
        message: effectiveMessage,
        promptConversation,
        attachments,
        snapshot,
        executionFlags,
        traceContext,
        projectId,
        projectName,
        skillPromptPayload,
        parserPayload: parserResult.payload,
        lifecycleRecorder
      },
      result
    });
    throwIfAgentRequestAborted('Agent request stopped before finalizing agent response.');

    result.thinking_trace = extractStructuredThinkingTrace(result);
    if (executionFlags.developerMode === true) {
      result.developer_trace = asArray(traceContext?.rows);
    }
    return result;
  }

  return {
    run
  };
}

module.exports = {
  createApiAgentController
};
