'use strict';

const fs = require('node:fs/promises');
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
const { resolveWorkingDirectory } = require('./paths');
const { createCodexJsonEventHandler } = require('./request-stream');
const { buildCodexCommandEnv } = require('./runtime-home');
const {
  extractCodexSessionIdFromText,
  normalizeCodexSessionId
} = require('./session-id');
const {
  createCodexSessionTranscriptFollower,
  replayCodexSessionProgressFromTranscript
} = require('./transcript');
const { runCodexCommand } = require('./run-command');
const { cleanText } = require('./utils');

async function requestCodexCliText({
  prompt,
  model = '',
  reasoningEffort = '',
  enableWebSearch = false,
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
  returnMetadata = false
}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Codex prompt.');
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('Prompt is required for Codex request.');
  }
  const requestStartedAtMs = Date.now();

  const safeCwd = resolveWorkingDirectory(cwd);
  if (cleanText(cwd, 2400)) {
    await ensureCodexCliWorkingDirectoryGuidance(safeCwd, { envOverrides });
  }

  const loginStatus = await getCodexLoginStatus({ cwd: safeCwd });
  if (!loginStatus.loggedIn) {
    throw new Error(loginStatus.message || 'Codex ChatGPT OAuth credentials are not configured.');
  }

  const requestState = await prepareCodexRequest({
    cwd: safeCwd,
    cleanPrompt,
    fileName,
    pdfDataUrl,
    imageDataUrl,
    imageUrl,
    attachments,
    outputSchema,
    envOverrides
  });
  const streamingEnabled = stream === true && typeof onStream === 'function';
  const cleanResumeSessionId = normalizeCodexSessionId(resumeSessionId);
  const collectJsonEvents = streamingEnabled || returnMetadata === true || Boolean(cleanResumeSessionId);
  const streamHandler = createCodexJsonEventHandler({
    onStream,
    streamingEnabled,
    initialSessionId: cleanResumeSessionId
  });
  const args = buildRequestArgs({
    outputFile: requestState.outputFile,
    outputSchemaFile: requestState.outputSchemaFile,
    cleanResumeSessionId,
    model,
    reasoningEffort,
    enableWebSearch,
    fileAccessToken: envOverrides.HIKARI_FILE_ACCESS_TOKEN || '',
    collectJsonEvents
  });

  const transcriptFollower = streamingEnabled
    ? createCodexSessionTranscriptFollower({
      cwd: safeCwd,
      getSessionId: streamHandler.getCodexSessionId,
      onJsonEvent: streamHandler.handleJsonEvent,
      minTimestampMs: requestStartedAtMs - 2000,
      intervalMs: process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS
    })
    : null;
  try {
    let commandResult;
    try {
      commandResult = await runCodexCommand({
        args,
        cwd: safeCwd,
        env: requestState.env,
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
      requestStartedAtMs
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
  envOverrides
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
  const outputFile = await createCodexOutputFilePath(cwd);
  const outputSchemaFile = await stageCodexOutputSchema(cwd, outputSchema);
  const baseEnv = await buildCodexCommandEnv(cwd, {
    envOverrides
  });
  return {
    env: {
      ...baseEnv,
      ...(envOverrides && typeof envOverrides === 'object' ? envOverrides : {})
    },
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
  fileAccessToken,
  collectJsonEvents
}) {
  return cleanResumeSessionId
    ? buildCodexCliExecResumeArgs({
      outputFile,
      outputSchemaFile,
      sessionId: cleanResumeSessionId,
      model,
      reasoningEffort,
      enableWebSearch,
      fileAccessToken,
      streamJson: collectJsonEvents
    })
    : buildCodexCliExecArgs({
      outputFile,
      outputSchemaFile,
      model,
      reasoningEffort,
      enableWebSearch,
      fileAccessToken,
      streamJson: collectJsonEvents
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
  requestStartedAtMs
}) {
  throwIfAgentRequestAborted('Agent request stopped before reading Codex output.');
  let outputText = '';
  try {
    outputText = await fs.readFile(outputFile, 'utf8');
  } catch {
    outputText = '';
  }
  await removeFileIfExists(outputFile).catch(() => {});
  let codexSessionId = streamHandler.getCodexSessionId();
  if (!codexSessionId) {
    codexSessionId = extractCodexSessionIdFromText(commandResult.stdout || commandResult.stderr || '');
  }
  if (streamingEnabled && codexSessionId) {
    await replayCodexSessionProgressFromTranscript({
      sessionId: codexSessionId,
      cwd: safeCwd,
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
        command: cleanResumeSessionId ? 'exec resume' : 'exec'
      }
    };
  }
  return resultText;
}

module.exports = {
  requestCodexCliText
};
