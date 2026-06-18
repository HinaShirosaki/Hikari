'use strict';

const fs = require('node:fs/promises');
const { throwIfAgentRequestAborted } = require('../../helpers/agent/shared/agent-request-context.js');
const { DEFAULT_TIMEOUT_MS } = require('./constants');
const {
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs
} = require('./args');
const {
  buildCodexPromptWithStagedAttachments,
  createCodexOutputFilePath,
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

  const safeCwd = resolveWorkingDirectory(cwd);
  if (cleanText(cwd, 2400)) {
    await ensureCodexCliWorkingDirectoryGuidance(safeCwd);
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
    cleanResumeSessionId,
    model,
    reasoningEffort,
    enableWebSearch,
    collectJsonEvents
  });

  const transcriptFollower = streamingEnabled
    ? createCodexSessionTranscriptFollower({
      cwd: safeCwd,
      getSessionId: streamHandler.getCodexSessionId,
      onJsonEvent: streamHandler.handleJsonEvent,
      minTimestampMs: Date.now() - 2000,
      intervalMs: process.env.HIKARI_CODEX_TRANSCRIPT_FOLLOW_INTERVAL_MS
    })
    : null;
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

  return readCodexRequestResult({
    commandResult,
    outputFile: requestState.outputFile,
    streamingEnabled,
    cleanResumeSessionId,
    returnMetadata,
    safeCwd,
    onStream,
    streamHandler
  });
}

async function prepareCodexRequest({
  cwd,
  cleanPrompt,
  fileName,
  pdfDataUrl,
  imageDataUrl,
  imageUrl,
  attachments,
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
  const baseEnv = await buildCodexCommandEnv(cwd, {
    envOverrides
  });
  return {
    env: {
      ...baseEnv,
      ...(envOverrides && typeof envOverrides === 'object' ? envOverrides : {})
    },
    outputFile,
    promptWithAttachments
  };
}

function buildRequestArgs({
  outputFile,
  cleanResumeSessionId,
  model,
  reasoningEffort,
  enableWebSearch,
  collectJsonEvents
}) {
  return cleanResumeSessionId
    ? buildCodexCliExecResumeArgs({
      outputFile,
      sessionId: cleanResumeSessionId,
      model,
      reasoningEffort,
      enableWebSearch,
      streamJson: collectJsonEvents
    })
    : buildCodexCliExecArgs({
      outputFile,
      model,
      reasoningEffort,
      enableWebSearch,
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
  streamHandler
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
      seenDisplayEvents: streamHandler.getSeenDisplayEvents()
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
