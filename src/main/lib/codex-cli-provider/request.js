'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { throwIfAgentRequestAborted } = require('../llm/request-context.js');
const { DEFAULT_TIMEOUT_MS } = require('./constants');
const {
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs
} = require('./args');
const {
  buildCodexPromptWithStagedAttachments,
  createCodexOutputFilePath,
  stageCodexOutputSchema,
  stageCodexPromptAttachments
} = require('./attachments');
const { removeFileIfExists } = require('./fs-utils');
const { ensureCodexCliWorkingDirectoryGuidance } = require('./guidance');
const { getCodexLoginStatus } = require('./login');
const { isFilesystemRoot, resolveWorkingDirectory } = require('./paths');
const { createCodexJsonEventHandler } = require('./request-stream');
const { prepareCodexRuntime, resolveCodexRequestSelection } = require('./runtime-gateway');
const { getCodexCliCatalog, requestCodexCliCatalog } = require('./catalog');
const {
  extractCodexSessionIdFromText,
  normalizeCodexSessionId
} = require('./session-id');
const {
  createCodexSessionTranscriptFollower,
  replayCodexSessionProgressFromTranscript
} = require('./transcript');
const { runCodexCommand } = require('./run-command');
const { runCodexAppServerTurn } = require('./app-server-turn.js');
const { getCodexPermissionPreset } = require('./permissions.js');
const { cleanText } = require('./utils');

async function requestCodexCliText({
  prompt,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
  enableImageGeneration = false,
  cwd = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  imageUrl = '',
  attachments = [],
  outputSchema = null,
  envOverrides = {},
  stream = false,
  onStream = null,
  resumeSessionId = '',
  codexPermissions = null,
  returnMetadata = false
}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Codex prompt.');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is required for Codex request.');
  }
  const requestStartedAtMs = Date.now();

  const policy = codexPermissions && getCodexPermissionPreset(codexPermissions.preset);
  if (codexPermissions && !policy) throw new Error('Invalid Codex permission preset.');
  // The selected workspace is part of the grant. Never fall back to a different
  // directory when that workspace disappears or is replaced with a symlink.
  const safeCwd = policy ? await fs.realpath(cwd) : resolveWorkingDirectory(cwd);
  if (policy && (isFilesystemRoot(safeCwd) || !(await fs.stat(safeCwd)).isDirectory()
    || (policy.sandbox === 'workspace-write' && path.relative(cwd, safeCwd) !== ''))) {
    throw new Error('The Codex workspace changed. Select the workspace folder again.');
  }
  if (cleanText(cwd, 2400)) {
    await ensureCodexCliWorkingDirectoryGuidance(safeCwd, { envOverrides });
  }

  const runtime = await prepareCodexRuntime({ cwd: safeCwd, envOverrides });
  const loginStatus = await getCodexLoginStatus({ runtime });
  if (!loginStatus.loggedIn) {
    throw new Error(loginStatus.message || 'Codex ChatGPT OAuth credentials are not configured.');
  }
  let catalog = getCodexCliCatalog(runtime);
  if (!catalog.ok) catalog = await requestCodexCliCatalog({ runtime });
  if (!catalog.ok || !catalog.defaultModel) {
    throw new Error('Codex did not report an available default model for this account. Refresh Codex settings or sign in again.');
  }
  const selection = resolveCodexRequestSelection({ runtime, model, reasoningEffort, catalog });

  const requestState = await prepareCodexRequest({
    cwd: safeCwd,
    cleanPrompt,
    fileName,
    pdfDataUrl,
    imageDataUrl,
    imageUrl,
    attachments,
    outputSchema: policy ? null : outputSchema,
    useExecOutput: !policy,
    runtime
  });
  const streamingEnabled = stream === true && typeof onStream === 'function';
  const cleanResumeSessionId = normalizeCodexSessionId(resumeSessionId);
  const collectJsonEvents = streamingEnabled || returnMetadata === true || Boolean(cleanResumeSessionId);
  const streamHandler = createCodexJsonEventHandler({
    onStream,
    streamingEnabled,
    initialSessionId: cleanResumeSessionId
  });
  const args = policy ? null : buildRequestArgs({
    outputFile: requestState.outputFile,
    outputSchemaFile: requestState.outputSchemaFile,
    cleanResumeSessionId,
    model,
    reasoningEffort,
    enableWebSearch,
    enableImageGeneration,
    fileAccessToken: envOverrides.HIKARI_FILE_ACCESS_TOKEN || '',
    collectJsonEvents,
    selection
  });

  const transcriptFollower = streamingEnabled
    ? createCodexSessionTranscriptFollower({
      cwd: safeCwd,
      env: runtime.env,
      getSessionId: streamHandler.getCodexSessionId,
      onJsonEvent: streamHandler.handleJsonEvent,
      minTimestampMs: requestStartedAtMs - 2000,
      intervalMs: process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS
    })
    : null;
  try {
    let commandResult;
    try {
      commandResult = policy ? await runCodexAppServerTurn({
        policy,
        approve: codexPermissions.approve,
        cwd: safeCwd,
        env: requestState.env,
        invocation: runtime.invocation,
        model: selection.model,
        effort: selection.reasoningEffort,
        prompt: requestState.promptWithAttachments,
        outputSchema,
        resumeSessionId: cleanResumeSessionId,
        enableWebSearch,
        enableImageGeneration,
        fileAccessToken: envOverrides.HIKARI_FILE_ACCESS_TOKEN,
        onEvent: streamHandler.handleJsonEvent,
        timeoutMs
      }) : await runCodexCommand({
        args,
        cwd: safeCwd,
        env: requestState.env,
        invocation: runtime.invocation,
        input: requestState.promptWithAttachments,
        timeoutMs,
        onJsonEvent: collectJsonEvents ? streamHandler.handleJsonEvent : null
      });
    } finally {
      await transcriptFollower?.stop?.();
    }
    return await readCodexRequestResult({
      commandResult,
      outputFile: requestState.outputFile,
      streamingEnabled,
      cleanResumeSessionId,
      returnMetadata,
      safeCwd,
      onStream,
      streamHandler,
      requestStartedAtMs,
      runtime
    });
  } finally {
    await removeFileIfExists(requestState.outputSchemaFile).catch(() => {});
  }
}

async function prepareCodexRequest({
  cwd,
  cleanPrompt,
  fileName,
  pdfDataUrl,
  imageDataUrl,
  imageUrl,
  attachments,
  outputSchema,
  useExecOutput,
  runtime
}) {
  const stagedAttachments = await stageCodexPromptAttachments({
    cwd,
    fileName,
    pdfDataUrl,
    imageDataUrl,
    imageUrl,
    attachments
  });
  const promptWithAttachments = buildCodexPromptWithStagedAttachments(cleanPrompt, stagedAttachments);
  const outputFile = useExecOutput ? await createCodexOutputFilePath(cwd) : '';
  const outputSchemaFile = await stageCodexOutputSchema(cwd, outputSchema);
  return {
    env: runtime.env,
    outputFile,
    outputSchemaFile,
    promptWithAttachments
  };
}

function buildRequestArgs({
  outputFile,
  outputSchemaFile,
  cleanResumeSessionId,
  model,
  reasoningEffort,
  enableWebSearch,
  enableImageGeneration,
  fileAccessToken,
  collectJsonEvents,
  selection
}) {
  return cleanResumeSessionId
    ? buildCodexCliExecResumeArgs({
      outputFile,
      outputSchemaFile,
      sessionId: cleanResumeSessionId,
      model,
      reasoningEffort,
      enableWebSearch,
      enableImageGeneration,
      fileAccessToken,
      streamJson: collectJsonEvents,
      selection
    })
    : buildCodexCliExecArgs({
      outputFile,
      outputSchemaFile,
      model,
      reasoningEffort,
      enableWebSearch,
      enableImageGeneration,
      fileAccessToken,
      streamJson: collectJsonEvents,
      selection
    });
}

async function readCodexRequestResult({
  commandResult,
  outputFile,
  streamingEnabled,
  cleanResumeSessionId,
  returnMetadata,
  safeCwd,
  onStream,
  streamHandler,
  requestStartedAtMs,
  runtime
}) {
  throwIfAgentRequestAborted('Agent request stopped before reading Codex output.');
  let outputText = commandResult.finalText || '';
  if (outputFile) {
    outputText = await fs.readFile(outputFile, 'utf8').catch(() => '');
    await removeFileIfExists(outputFile).catch(() => {});
  }
  let codexSessionId = streamHandler.getCodexSessionId();
  if (!codexSessionId) {
    codexSessionId = extractCodexSessionIdFromText(commandResult.stdout || commandResult.stderr || '');
  }
  if (streamingEnabled && codexSessionId) {
    await replayCodexSessionProgressFromTranscript({
      sessionId: codexSessionId,
      cwd: safeCwd,
      env: runtime.env,
      onStream,
      seenProgressEvents: streamHandler.getSeenProgressEvents(),
      seenDisplayEvents: streamHandler.getSeenDisplayEvents(),
      minTimestampMs: cleanResumeSessionId
        ? Math.max(0, Number(requestStartedAtMs) - 2000)
        : 0
    });
  }
  const resultText = cleanText(outputText || streamHandler.getStreamedText() || commandResult.stdout, 120000);
  if (!resultText) {
    throw new Error('Codex CLI returned an empty response.');
  }
  if (returnMetadata === true) {
    return {
      text: resultText,
      metadata: {
        session_id: normalizeCodexSessionId(codexSessionId),
        resumed_session_id: cleanResumeSessionId,
        command: commandResult.command || (cleanResumeSessionId ? 'exec resume' : 'exec'),
        ...runtime.diagnostics
      }
    };
  }
  return resultText;
}

module.exports = {
  requestCodexCliText
};
