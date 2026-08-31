'use strict';

const { throwIfAgentRequestAborted } = require('../../lib/llm/request-context.js');
const {
  asArray,
  defaultCleanText,
  ensureObject,
  isFilesystemRoot,
  parseJsonObjectFromText
} = require('./runtime-utils.js');
const {
  normalizeCodexAgentPayload
} = require('./payloads.js');
const {
  buildCodexAgentParserPayload,
  buildCodexAgentPrompt,
  buildCodexMcpContext
} = require('./prompts.js');
const {
  createCodexStreamProgressHandler
} = require('./stream-events.js');
const {
  isCodexResumeUnavailableError,
  normalizeRecoveryConversation
} = require('./session-recovery.js');
const { callProtocolGeneration } = require('../mcp-contract/direct-tools/protocol-generation.js');
const {
  resolveProtocolGenerationArtifact
} = require('../runtime/artifact-recovery/protocol-generation.js');

function createCodexAgentRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestCodexAgentText = typeof deps.requestCodexAgentText === 'function'
    ? deps.requestCodexAgentText
    : null;
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const getWorkingDirectory = typeof deps.getWorkingDirectory === 'function'
    ? deps.getWorkingDirectory
    : (() => process.cwd());
  const prepareProjectWorkspace = typeof deps.prepareProjectWorkspace === 'function'
    ? deps.prepareProjectWorkspace
    : null;
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  async function run(input = {}) {
    if (!requestCodexAgentText) {
      return {
        ok: false,
        provider: 'codex',
        model: cleanText(input.model, 120),
        error: 'Codex agent runtime is not configured.'
      };
    }
    const inputCwd = cleanText(input.cwd, 2400);
    const fallbackCwd = cleanText(getWorkingDirectory(), 2400);
    let cwd = inputCwd && !isFilesystemRoot(inputCwd)
      ? inputCwd
      : (fallbackCwd || inputCwd || process.cwd());
    if (!inputCwd && prepareProjectWorkspace) {
      try {
        const projectWorkspace = cleanText(await prepareProjectWorkspace(input), 2400);
        if (projectWorkspace && !isFilesystemRoot(projectWorkspace)) {
          cwd = projectWorkspace;
        }
      } catch {
        // Falling back to the normal Codex workspace still keeps the turn usable.
      }
    }
    let prompt = buildCodexAgentPrompt(input, { cleanText });
    const traceContext = input.traceContext || null;
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const emitAgentProgress = typeof input.emitAgentProgress === 'function'
      ? input.emitAgentProgress
      : null;
    const model = cleanText(input.model, 120);
    const reasoningEffort = cleanText(input.reasoningEffort, 40);
    const requestedTimeoutMs = Number(input.timeoutMs ?? input.timeout_ms);
    const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 1000
      ? requestedTimeoutMs
      : null;
    const resumeSessionId = cleanText(input.codexSessionId || input.codex_session_id, 240);
    const createStreamProgress = () => createCodexStreamProgressHandler({
      cleanText,
      emitAgentProgress,
      lifecycleRecorder,
      recordLifecycleEvent
    });
    let streamProgress = createStreamProgress();

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_started',
      status: 'started',
      routing_intent: 'codex_agent',
      message: 'Thinking'
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_runtime',
      provider: 'codex',
      model,
      summary: 'Thinking',
      request_payload: {
        model,
        reasoning_effort: reasoningEffort,
        prompt,
        attachments: asArray(input.attachments).map((attachment) => ({
          name: cleanText(attachment?.name, 240),
          kind: cleanText(attachment?.kind, 40),
          data: '[omitted]'
        }))
      }
    });

    throwIfAgentRequestAborted('Agent request stopped before starting Codex agent.');
    const buildCodexRequest = ({
      requestPrompt,
      requestInput,
      requestResumeSessionId
    }) => {
      const mcpContextJson = JSON.stringify(buildCodexMcpContext({
        ...requestInput,
        cwd,
        model
      }, { cleanText }));
      return {
        prompt: requestPrompt,
        model,
        reasoningEffort,
        cwd,
        enableWebSearch: input.enableWebSearch !== false && input.enable_web_search !== false,
        attachments: asArray(input.attachments),
        timeoutMs,
        stream: true,
        onStream: streamProgress.emitStreamProgress,
        resumeSessionId: requestResumeSessionId,
        returnMetadata: true,
        envOverrides: {
          HIKARI_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
          HIKARI_CODEX_REQUEST_CONTEXT: mcpContextJson
        }
      };
    };
    let activeResumeSessionId = resumeSessionId;
    let recoveredFromCodexSessionId = '';
    let effectiveInput = input;
    let codexTextResult;
    try {
      codexTextResult = await requestCodexAgentText(buildCodexRequest({
        requestPrompt: prompt,
        requestInput: effectiveInput,
        requestResumeSessionId: activeResumeSessionId
      }));
    } catch (error) {
      if (!activeResumeSessionId || !isCodexResumeUnavailableError(error)) {
        throw error;
      }
      throwIfAgentRequestAborted('Agent request stopped before recovering the Codex session.');
      recoveredFromCodexSessionId = activeResumeSessionId;
      activeResumeSessionId = '';
      const recoveryConversation = asArray(input.recoveryConversation);
      effectiveInput = {
        ...input,
        codexSessionId: '',
        codex_session_id: '',
        sessionRecovery: {
          previousSessionId: recoveredFromCodexSessionId,
          conversation: recoveryConversation
        }
      };
      prompt = buildCodexAgentPrompt(effectiveInput, { cleanText });
      // The failed attempt may have streamed artifacts before dying; a fresh
      // handler keeps them from merging into the recovered turn's result.
      streamProgress = createStreamProgress();
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'codex_agent_session_recovery',
        status: 'started',
        routing_intent: 'codex_agent',
        message: 'The saved Codex session was unavailable. Reopening this chat from Hikari history.',
        meta: {
          unavailable_codex_session_id: recoveredFromCodexSessionId,
          recovery_turn_count: normalizeRecoveryConversation(recoveryConversation).length
        }
      });
      await recordAgentLlmTrace(traceContext, {
        stage: 'codex_agent_session_recovery',
        provider: 'codex',
        model,
        summary: 'Starting a new Codex session with bounded Hikari chat history.',
        request_payload: {
          unavailable_codex_session_id: recoveredFromCodexSessionId,
          prompt
        }
      });
      codexTextResult = await requestCodexAgentText(buildCodexRequest({
        requestPrompt: prompt,
        requestInput: effectiveInput,
        requestResumeSessionId: activeResumeSessionId
      }));
    }
    throwIfAgentRequestAborted('Agent request stopped after Codex agent completed.');

    const rawText = typeof codexTextResult === 'string'
      ? codexTextResult
      : cleanText(codexTextResult?.text, 120000);
    const codexMetadata = codexTextResult && typeof codexTextResult === 'object' && !Array.isArray(codexTextResult)
      ? ensureObject(codexTextResult.metadata)
      : {};
    const codexSessionId = cleanText(
      codexMetadata.session_id
        || codexMetadata.sessionId
        || codexMetadata.resumed_session_id
        || codexMetadata.resumedSessionId
        || activeResumeSessionId,
      240
    );
    const parsed = parseJsonObjectFromText(rawText);
    let streamState = streamProgress.getStreamState();
    if (streamState.lastStreamText) {
      streamProgress.emitStreamProgress({ accumulated_text: streamState.lastStreamText }, { force: true });
      streamState = streamProgress.getStreamState();
    }
    const streamedFinalAnswerText = cleanText(streamState.streamedFinalAnswerText, 120000);
    const codexAgent = normalizeCodexAgentPayload(parsed || {}, rawText, { cleanText });
    if (streamedFinalAnswerText && codexAgent.status !== 'needs_more_info') {
      codexAgent.answer = streamedFinalAnswerText;
      if (!codexAgent.reasoning_summary || cleanText(codexAgent.reasoning_summary, 4000) === cleanText(codexAgent.answer, 4000)) {
        codexAgent.reasoning_summary = 'Codex synthesized the final answer from streamed tool and reasoning events.';
      }
    }
    if (
      streamState.streamedAskUserPayload?.user_question?.question
      && codexAgent.status !== 'needs_more_info'
    ) {
      const askUserPayload = streamState.streamedAskUserPayload;
      codexAgent.status = 'needs_more_info';
      codexAgent.answer = cleanText(askUserPayload.answer || askUserPayload.user_question.question, 120000);
      codexAgent.follow_up_questions = asArray(askUserPayload.follow_up_questions).length
        ? askUserPayload.follow_up_questions
        : [askUserPayload.user_question.question];
      codexAgent.user_question = askUserPayload.user_question;
      codexAgent.reasoning_summary = cleanText(
        askUserPayload.reasoning_summary,
        4000
      ) || 'Waiting for the user to answer this blocking clarification.';
      codexAgent.citations = asArray(askUserPayload.citations);
    }
    codexAgent.codex_session_id = codexSessionId;
    codexAgent.resumed_codex_session_id = cleanText(
      codexMetadata.resumed_session_id || codexMetadata.resumedSessionId || activeResumeSessionId,
      240
    );
    codexAgent.recovered_from_codex_session_id = recoveredFromCodexSessionId;

    const protocolGenerationArtifact = await resolveProtocolGenerationArtifact({
      agentResult: codexAgent,
      userMessage: input.message,
      rawText,
      cleanText,
      lifecycleRecorder,
      recordLifecycleEvent,
      executeProtocolGeneration: runTool
        ? (args, context) => callProtocolGeneration(args, context, { runTool })
        : null,
      streamedProtocolGenerationPayloads: streamState.streamedProtocolGenerationPayloads,
      toolContext: {
        ...buildCodexMcpContext({ ...effectiveInput, cwd, model }, { cleanText }),
        snapshot: ensureObject(input.snapshot),
        traceContext,
        lifecycleRecorder
      },
      lifecycleStage: 'codex_agent_direct_tool_fallback',
      routingIntent: 'codex_agent',
      agentLabel: 'Codex'
    });

    const parser = buildCodexAgentParserPayload(codexAgent, {
      projectId: input.projectId,
      projectName: input.projectName,
      reasoningEffort,
      cleanText
    });
    const completedResponsePayload = streamedFinalAnswerText
      ? {
        status: codexAgent.status,
        assistant_text: streamedFinalAnswerText,
        ...(parsed ? { raw_response_payload: parsed } : { raw_response_text: rawText })
      }
      : (parsed || rawText);
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_completed',
      provider: 'codex',
      model,
      summary: 'Codex-owned agent lifecycle completed.',
      response_payload: completedResponsePayload,
      metadata: {
        codex_session_id: codexSessionId,
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
        recovered_from_codex_session_id: recoveredFromCodexSessionId,
        command: cleanText(codexMetadata.command, 80)
      }
    });
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_completed',
      status: 'ok',
      routing_intent: 'codex_agent',
      message: cleanText(codexAgent.reasoning_summary || codexAgent.answer, 320)
        || 'Codex-owned agent lifecycle completed.',
      meta: {
        status: codexAgent.status,
        citation_count: asArray(codexAgent.citations).length,
        codex_session_id: codexSessionId,
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
        recovered_from_codex_session_id: recoveredFromCodexSessionId
      }
    });

    return {
      ok: true,
      provider: 'codex',
      model,
      codex_session_id: codexSessionId,
      resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
      recovered_from_codex_session_id: recoveredFromCodexSessionId,
      parser,
      codex_agent: codexAgent,
      ...(streamState.streamedNotebookDraftPayload
        ? {
          notebook_draft: streamState.streamedNotebookDraftPayload,
          notebookDraft: streamState.streamedNotebookDraftPayload.notebook
        }
        : {}),
      ...(streamState.streamedNotebookAppendPayload
        ? { notebook_append: streamState.streamedNotebookAppendPayload }
        : {}),
      ...(protocolGenerationArtifact ? { protocol_generation: protocolGenerationArtifact } : {}),
      ...(streamState.streamedSequenceEditProposals?.length
        ? { sequence_edit: { proposals: streamState.streamedSequenceEditProposals } }
        : {}),
      thinking_trace: {
        intent_parse_question: 'Codex owned this request without Hikari parser dispatch.',
        final_synthesize: cleanText(codexAgent.reasoning_summary, 1000)
          || 'Codex synthesized the final response from the evidence it gathered.'
      }
    };
  }

  return {
    run,
    buildPrompt: (input = {}) => buildCodexAgentPrompt(input, { cleanText }),
    parseJsonObjectFromText: (raw = '') => parseJsonObjectFromText(raw),
    normalizePayload: (payload = {}, rawText = '') => normalizeCodexAgentPayload(payload, rawText, { cleanText })
  };
}

module.exports = {
  buildCodexAgentPrompt,
  buildCodexAgentParserPayload,
  buildCodexMcpContext,
  createCodexAgentRuntime,
  normalizeCodexAgentPayload,
  parseJsonObjectFromText
};
