'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const {
  createAgentRequestAbortError,
  getAgentRequestAbortSignal,
  throwIfAgentRequestAborted
} = require('../../../../lib/llm/request-context.js');
const {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MIN_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_MAX_STDIO_CHARS,
  SANDBOX_MAX_READBACK_CHARS,
  SANDBOX_MAX_READBACK_FILES,
  SANDBOX_MAX_INPUT_FILES,
  SANDBOX_CAPTURE_MAX_CHARS,
  SANDBOX_DEFAULT_HEARTBEAT_INTERVAL_MS,
  SANDBOX_HELPER_MODULE_NAME,
  SANDBOX_RENDER_OUTPUT_FILE_NAME
} = require('./constants.js');
const {
  asArray,
  ensureObject,
  cleanText,
  clamp,
  normalizeRelativePath,
  truncateText,
  appendChunkText,
  buildRunId,
  ensurePathInsideRoot,
  isProcessAlive,
  callLifecycleHook
} = require('./utils.js');
const {
  buildPythonSandboxHelperModule,
  readPythonSandboxRenderOutputs
} = require('./helper-module.js');

const execFileAsync = promisify(execFile);

async function resolvePythonExecutable(explicit = '', preferred = '') {
  const candidates = [
    cleanText(explicit, 240),
    cleanText(preferred, 240),
    cleanText(process.env.HIKARI_AGENT_PYTHON_EXECUTABLE, 240),
    cleanText(process.env.HIKARI_AGENT_PYTHON_BIN, 240),
    'python3',
    'python'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], {
        timeout: 2000,
        maxBuffer: 1024 * 64
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error('Python executable was not found. Set HIKARI_AGENT_PYTHON_EXECUTABLE or install python3.');
}

async function runPythonSandbox(input, options = {}) {
  throwIfAgentRequestAborted('Agent request stopped before starting Python sandbox.');
  const source = ensureObject(input);
  const runId = buildRunId();
  const timeoutMs = clamp(Number(source.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
  const heartbeatIntervalMs = clamp(
    Number(options.heartbeatIntervalMs) || SANDBOX_DEFAULT_HEARTBEAT_INTERVAL_MS,
    100,
    Math.max(100, timeoutMs)
  );
  const warnings = [];
  const filesWritten = [];
  const readbackFiles = [];
  const startedAt = new Date().toISOString();
  const onTaskStarted = typeof options.onTaskStarted === 'function' ? options.onTaskStarted : null;
  const onHeartbeat = typeof options.onHeartbeat === 'function' ? options.onHeartbeat : null;
  const onTaskCompleted = typeof options.onTaskCompleted === 'function' ? options.onTaskCompleted : null;
  const onTaskFailed = typeof options.onTaskFailed === 'function' ? options.onTaskFailed : null;
  const abortSignal = options.signal || getAgentRequestAbortSignal();

  const code = typeof source.code === 'string' ? source.code : '';
  if (!code.trim()) {
    const result = {
      ok: false,
      run_id: runId,
      status: 'error',
      error: 'run_python_sandbox requires non-empty code.',
      timeout_ms: timeoutMs,
      python_executable: '',
      exit_code: null,
      signal: null,
      timed_out: false,
      stdout: '',
      stderr: '',
      files_written: [],
      readback_files: [],
      warnings,
      summary: 'Python sandbox execution failed before launch.'
    };
    await callLifecycleHook(onTaskFailed, {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      process_id: null,
      error: result.error,
      summary: result.summary,
      timed_out: false
    }, warnings, 'onTaskFailed');
    return result;
  }

  const sandboxRoot = cleanText(options.sandboxRoot, 1200)
    || path.join(os.tmpdir(), 'hikari-agent-python-sandbox');
  const sandboxDir = path.join(sandboxRoot, runId);
  const renderOutputPath = path.join(sandboxDir, SANDBOX_RENDER_OUTPUT_FILE_NAME);

  try {
    await fs.mkdir(sandboxDir, { recursive: true });

    const inputFiles = asArray(source.files).slice(0, SANDBOX_MAX_INPUT_FILES);
    for (let index = 0; index < inputFiles.length; index += 1) {
      const file = ensureObject(inputFiles[index]);
      const relativePath = normalizeRelativePath(file.path);
      if (!relativePath) {
        warnings.push(`Skipped files[${index}] due to invalid path.`);
        continue;
      }
      const absolutePath = ensurePathInsideRoot(sandboxDir, path.join(sandboxDir, relativePath));
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, String(file.content || ''), 'utf8');
      filesWritten.push(relativePath);
    }

    const entryPath = path.join(sandboxDir, 'main.py');
    const helperModulePath = path.join(sandboxDir, SANDBOX_HELPER_MODULE_NAME);
    await fs.writeFile(entryPath, code, 'utf8');
    await fs.writeFile(helperModulePath, buildPythonSandboxHelperModule(), 'utf8');

    const pythonExecutable = await resolvePythonExecutable(
      options.pythonExecutable,
      options.preferredPythonBin
    );
    throwIfAgentRequestAborted('Agent request stopped before launching Python sandbox.');

    let stdoutState = { text: '', overflow: false };
    let stderrState = { text: '', overflow: false };
    let exitCode = 0;
    let signal = null;
    let timedOut = false;
    let processId = null;
    let aborted = false;
    let abortReason = null;

    const startedAtMs = Date.now();
    const child = spawn(pythonExecutable, [entryPath], {
      cwd: sandboxDir,
      env: {
        ...process.env,
        HIKARI_SANDBOX_ROOT: sandboxDir,
        HIKARI_SANDBOX_OUTPUT_PATH: renderOutputPath
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    processId = Number.isFinite(Number(child.pid)) && Number(child.pid) > 0 ? Number(child.pid) : null;
    await callLifecycleHook(onTaskStarted, {
      run_id: runId,
      started_at: startedAt,
      process_id: processId,
      python_executable: pythonExecutable,
      timeout_ms: timeoutMs
    }, warnings, 'onTaskStarted');

    const emitHeartbeat = (progress = false, summary = '') => callLifecycleHook(onHeartbeat, {
      run_id: runId,
      started_at: startedAt,
      timestamp: new Date().toISOString(),
      process_id: processId,
      elapsed_ms: Date.now() - startedAtMs,
      stdout_chars: stdoutState.text.length,
      stderr_chars: stderrState.text.length,
      progress,
      summary: cleanText(summary, 240)
    }, warnings, 'onHeartbeat');

    child.stdout.on('data', (chunk) => {
      stdoutState = appendChunkText(stdoutState, chunk, SANDBOX_CAPTURE_MAX_CHARS);
      void emitHeartbeat(true, 'stdout activity');
    });

    child.stderr.on('data', (chunk) => {
      stderrState = appendChunkText(stderrState, chunk, SANDBOX_CAPTURE_MAX_CHARS);
      void emitHeartbeat(true, 'stderr activity');
    });

    const closeResult = await new Promise((resolve, reject) => {
      let settled = false;
      let timeoutHandle = null;
      let killHandle = null;
      let heartbeatHandle = null;
      let abortKillHandle = null;

      const finish = (callback, payload) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (killHandle) {
          clearTimeout(killHandle);
        }
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
        }
        if (abortKillHandle) {
          clearTimeout(abortKillHandle);
        }
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }
        callback(payload);
      };

      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore kill errors
        }
        killHandle = setTimeout(() => {
          if (isProcessAlive(processId)) {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore force-kill errors
            }
          }
        }, 1000);
      }, timeoutMs);

      heartbeatHandle = setInterval(() => {
        void emitHeartbeat(false, 'process alive');
      }, heartbeatIntervalMs);

      const onAbort = () => {
        aborted = true;
        abortReason = createAgentRequestAbortError(abortSignal?.reason || 'Agent request stopped.');
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore abort kill failures during shutdown.
        }
        abortKillHandle = setTimeout(() => {
          if (isProcessAlive(processId)) {
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore force-kill failures after abort.
            }
          }
        }, 1000);
      };

      if (abortSignal?.aborted) {
        onAbort();
      } else if (abortSignal) {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (error) => {
        finish(reject, error);
      });

      child.on('close', (code, closeSignal) => {
        if (aborted || abortSignal?.aborted) {
          finish(reject, abortReason || createAgentRequestAbortError('Agent request stopped.'));
          return;
        }
        finish(resolve, {
          code,
          signal: closeSignal
        });
      });
    });

    exitCode = Number.isFinite(Number(closeResult.code)) ? Number(closeResult.code) : (timedOut ? 124 : 1);
    signal = closeResult.signal || null;

    if (stdoutState.overflow) {
      warnings.push(`stdout capture capped at ${SANDBOX_CAPTURE_MAX_CHARS} chars.`);
    }
    if (stderrState.overflow) {
      warnings.push(`stderr capture capped at ${SANDBOX_CAPTURE_MAX_CHARS} chars.`);
    }

    const stdoutLimited = truncateText(stdoutState.text, SANDBOX_MAX_STDIO_CHARS);
    const stderrLimited = truncateText(stderrState.text, SANDBOX_MAX_STDIO_CHARS);
    if (stdoutLimited.truncated) {
      warnings.push(`stdout truncated to ${SANDBOX_MAX_STDIO_CHARS} chars.`);
    }
    if (stderrLimited.truncated) {
      warnings.push(`stderr truncated to ${SANDBOX_MAX_STDIO_CHARS} chars.`);
    }

    const readbackPaths = asArray(source.readback_paths).slice(0, SANDBOX_MAX_READBACK_FILES);
    for (let index = 0; index < readbackPaths.length; index += 1) {
      const relativePath = normalizeRelativePath(readbackPaths[index]);
      if (!relativePath) {
        warnings.push(`Skipped readback_paths[${index}] due to invalid path.`);
        continue;
      }
      try {
        const absolutePath = ensurePathInsideRoot(sandboxDir, path.join(sandboxDir, relativePath));
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          warnings.push(`Skipped readback ${relativePath}: not a file.`);
          continue;
        }
        const content = await fs.readFile(absolutePath, 'utf8');
        const limited = truncateText(content, SANDBOX_MAX_READBACK_CHARS);
        if (limited.truncated) {
          warnings.push(`Readback ${relativePath} truncated to ${SANDBOX_MAX_READBACK_CHARS} chars.`);
        }
        readbackFiles.push({
          path: relativePath,
          content: limited.text,
          truncated: limited.truncated
        });
      } catch (error) {
        warnings.push(`Failed readback for ${relativePath}: ${String(error?.message || error)}.`);
      }
    }
    const renderOutputs = await readPythonSandboxRenderOutputs(renderOutputPath, warnings);

    const status = timedOut ? 'timed_out' : exitCode === 0 ? 'ok' : 'error';
    const summary = status === 'ok'
      ? (renderOutputs.length
        ? `Python sandbox execution completed successfully and emitted ${renderOutputs.length} render output${renderOutputs.length === 1 ? '' : 's'}.`
        : 'Python sandbox execution completed successfully.')
      : status === 'timed_out'
        ? 'Python sandbox execution timed out.'
        : 'Python sandbox execution failed.';

    const result = {
      ok: status === 'ok',
      run_id: runId,
      status,
      error: status === 'ok' ? '' : cleanText(stderrLimited.text || summary, 4000),
      timeout_ms: timeoutMs,
      python_executable: pythonExecutable,
      process_id: processId,
      exit_code: exitCode,
      signal,
      timed_out: timedOut,
      stdout: stdoutLimited.text,
      stderr: stderrLimited.text,
      files_written: filesWritten,
      readback_files: readbackFiles,
      render_outputs: renderOutputs,
      warnings,
      summary
    };

    if (result.ok) {
      await callLifecycleHook(onTaskCompleted, {
        run_id: runId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        process_id: processId,
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        summary
      }, warnings, 'onTaskCompleted');
    } else {
      await callLifecycleHook(onTaskFailed, {
        run_id: runId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        process_id: processId,
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        error: result.error,
        summary
      }, warnings, 'onTaskFailed');
    }

    return result;
  } catch (error) {
    const result = {
      ok: false,
      run_id: runId,
      status: 'error',
      error: cleanText(error?.message || error, 4000) || 'Python sandbox execution failed before launch.',
      timeout_ms: timeoutMs,
      python_executable: '',
      process_id: null,
      exit_code: null,
      signal: null,
      timed_out: false,
      stdout: '',
      stderr: '',
      files_written: filesWritten,
      readback_files: [],
      render_outputs: [],
      warnings,
      summary: 'Python sandbox execution failed before launch.'
    };
    await callLifecycleHook(onTaskFailed, {
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      process_id: null,
      error: result.error,
      summary: result.summary,
      timed_out: false
    }, warnings, 'onTaskFailed');
    return result;
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  resolvePythonExecutable,
  runPythonSandbox
};
