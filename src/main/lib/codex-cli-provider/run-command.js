'use strict';

const { spawn } = require('node:child_process');
const {
  createAgentRequestAbortError,
  getAgentRequestAbortSignal,
  isAgentRequestAbortError,
  onAgentRequestAbort,
  throwIfAgentRequestAborted
} = require('../../helpers/agent/shared/agent-request-context.js');
const { DEFAULT_TIMEOUT_MS } = require('./constants');
const { summarizeCodexCommandFailure } = require('./event-failure');
const { looksLikeJsonLine } = require('./event-values');
const { ensureCodexCliWorkingDirectoryGuidance } = require('./guidance');
const { resolveCodexBinary, resolveWorkingDirectory } = require('./paths');
const { cleanText, safeParseJson } = require('./utils');

async function runCodexCommand({
  args,
  cwd,
  env = process.env,
  input = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onJsonEvent = null
}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  await ensureCodexCliWorkingDirectoryGuidance(safeCwd);
  return new Promise((resolve, reject) => {
    throwIfAgentRequestAborted('Agent request stopped before starting Codex CLI.');
    const child = spawn(resolveCodexBinary(), args, {
      cwd: safeCwd,
      env,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    let aborted = false;
    let jsonLineBuffer = '';
    let stderrLineBuffer = '';
    const abortSignal = getAgentRequestAbortSignal();

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    const finishReject = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      unsubscribeAbort();
      reject(error);
    };

    const finishResolve = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      unsubscribeAbort();
      resolve(value);
    };

    const unsubscribeAbort = onAgentRequestAbort((reason) => {
      aborted = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill failures during shutdown.
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore force-kill failures after abort.
        }
      }, 1000);
      if (!child.killed && abortSignal?.aborted) {
        finishReject(reason || createAgentRequestAbortError('Agent request stopped.'));
      }
    });

    function emitPlainCodexOutputLine(line = '', stream = 'stdout') {
      if (typeof onJsonEvent !== 'function') {
        return;
      }
      const text = cleanText(line, 12000);
      if (!text || looksLikeJsonLine(text)) {
        return;
      }
      try {
        onJsonEvent({
          type: 'codex_cli_output',
          stream,
          text
        });
      } catch {
        // Streaming callbacks should not be able to fail the Codex request.
      }
    }

    function handleStreamLines(chunkText = '', stream = 'stdout', force = false) {
      if (typeof onJsonEvent !== 'function') {
        return;
      }
      if (stream === 'stderr') {
        stderrLineBuffer += String(chunkText || '');
      } else {
        jsonLineBuffer += String(chunkText || '');
      }
      const sourceBuffer = stream === 'stderr' ? stderrLineBuffer : jsonLineBuffer;
      const lines = sourceBuffer.split(/\r?\n/u);
      const pendingLine = lines.pop() || '';
      if (stream === 'stderr') {
        stderrLineBuffer = force ? '' : pendingLine;
      } else {
        jsonLineBuffer = force ? '' : pendingLine;
      }
      const parseLines = force ? lines.concat(pendingLine ? [pendingLine] : []) : lines;
      parseLines.forEach((line) => emitJsonOrPlainLine(line, stream, onJsonEvent, emitPlainCodexOutputLine));
    }

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdout += text;
      handleStreamLines(text, 'stdout');
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      stderr += text;
      handleStreamLines(text, 'stderr');
    });

    child.on('error', (error) => {
      finishReject(error);
    });

    child.on('close', (code, signal) => {
      handleStreamLines('', 'stdout', true);
      handleStreamLines('', 'stderr', true);
      if (aborted || abortSignal?.aborted) {
        const abortError = isAgentRequestAbortError(abortSignal?.reason)
          ? abortSignal.reason
          : createAgentRequestAbortError('Agent request stopped.');
        abortError.stdout = stdout;
        abortError.stderr = stderr;
        abortError.signal = signal;
        finishReject(abortError);
        return;
      }
      if (timedOut) {
        const timeoutError = new Error(`Codex CLI timed out after ${Math.round((Number(timeoutMs) || DEFAULT_TIMEOUT_MS) / 1000)}s.`);
        timeoutError.code = 'ETIMEDOUT';
        timeoutError.stdout = stdout;
        timeoutError.stderr = stderr;
        finishReject(timeoutError);
        return;
      }

      if (code === 0) {
        finishResolve({ stdout, stderr, signal });
        return;
      }

      const failureSummary = summarizeCodexCommandFailure({ stdout, stderr });
      const error = new Error(`Codex CLI failed (exit ${code ?? 'unknown'}): ${failureSummary}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      finishReject(error);
    });

    if (input) {
      child.stdin.write(String(input));
    }
    child.stdin.end();
  });
}

function emitJsonOrPlainLine(line, stream, onJsonEvent, emitPlainCodexOutputLine) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }
  const parsed = safeParseJson(trimmed, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    try {
      onJsonEvent(parsed);
    } catch {
      // Streaming callbacks should not be able to fail the Codex request.
    }
    return;
  }
  emitPlainCodexOutputLine(trimmed, stream);
}

module.exports = {
  runCodexCommand
};
