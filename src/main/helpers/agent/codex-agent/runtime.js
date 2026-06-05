'use strict';

const { throwIfAgentRequestAborted } = require('../shared/agent-request-context.js');
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
  resolveProtocolGenerationArtifact
} = require('./protocol-fallback.js');

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
    const prompt = buildCodexAgentPrompt(input, { cleanText });
    const traceContext = input.traceContext || null;
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const emitAgentProgress = typeof input.emitAgentProgress === 'function'
      ? input.emitAgentProgress
      : null;
    const model = cleanText(input.model, 120);
    const reasoningEffort = cleanText(input.reasoningEffort, 40);
    const resumeSessionId = cleanText(input.codexSessionId || input.codex_session_id, 240);
    const streamProgress = createCodexStreamProgressHandler({
      cleanText,
      emitAgentProgress,
      lifecycleRecorder,
      recordLifecycleEvent
    });

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_started',
      status: 'started',
      routing_intent: 'codex_agent',
      message: 'Starting Codex-owned agent lifecycle.'
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_runtime',
      provider: 'codex',
      model,
      summary: 'Started Codex-owned agent lifecycle.',
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
    const mcpContextJson = JSON.stringify(buildCodexMcpContext({
      ...input,
      cwd,
      model
    }, { cleanText }));
    const codexTextResult = await requestCodexAgentText({
      prompt,
      model,
      reasoningEffort,
      cwd,
      enableWebSearch: true,
      attachments: asArray(input.attachments),
      stream: true,
      onStream: streamProgress.emitStreamProgress,
      resumeSessionId,
      returnMetadata: true,
      envOverrides: {
        HIKARI_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
        ENANA_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
        HIKARI_CODEX_REQUEST_CONTEXT: mcpContextJson,
        ENANA_CODEX_REQUEST_CONTEXT: mcpContextJson
      }
    });
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
        || resumeSessionId,
      240
    );
    const parsed = parseJsonObjectFromText(rawText);
    let streamState = streamProgress.getStreamState();
    if (streamState.lastStreamText) {
      streamProgress.emitStreamProgress({ accumulated_text: streamState.lastStreamText }, { force: true });
      streamState = streamProgress.getStreamState();
    }
    const codexAgent = normalizeCodexAgentPayload(parsed || {}, rawText, { cleanText });
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
      codexMetadata.resumed_session_id || codexMetadata.resumedSessionId || resumeSessionId,
      240
    );

    const protocolGenerationArtifact = await resolveProtocolGenerationArtifact({
      codexAgent,
      input,
      cwd,
      model,
      rawText,
      cleanText,
      lifecycleRecorder,
      recordLifecycleEvent,
      runTool,
      streamedProtocolGenerationPayloads: streamState.streamedProtocolGenerationPayloads,
      traceContext
    });

    const parser = buildCodexAgentParserPayload(codexAgent, {
      projectId: input.projectId,
      projectName: input.projectName,
      reasoningEffort,
      cleanText
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_completed',
      provider: 'codex',
      model,
      summary: 'Codex-owned agent lifecycle completed.',
      response_payload: parsed || rawText,
      metadata: {
        codex_session_id: codexSessionId,
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
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
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240)
      }
    });

    return {
      ok: true,
      provider: 'codex',
      model,
      codex_session_id: codexSessionId,
      resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
      parser,
      codex_agent: codexAgent,
      ...(streamState.streamedNotebookDraftPayload
        ? {
          notebook_draft: streamState.streamedNotebookDraftPayload,
          notebookDraft: streamState.streamedNotebookDraftPayload.notebook
        }
        : {}),
      ...(protocolGenerationArtifact ? { protocol_generation: protocolGenerationArtifact } : {}),
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
