'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const { createAgentSubAgentRuntime } = require('./agent-sub-agent.js');

const execFileAsync = promisify(execFile);

const SANDBOX_DEFAULT_TIMEOUT_MS = 6000;
const SANDBOX_MIN_TIMEOUT_MS = 500;
const SANDBOX_MAX_TIMEOUT_MS = 15000;
const SANDBOX_MAX_STDIO_CHARS = 120000;
const SANDBOX_MAX_READBACK_CHARS = 60000;
const SANDBOX_MAX_READBACK_FILES = 20;
const SANDBOX_MAX_INPUT_FILES = 32;
const SANDBOX_CAPTURE_MAX_CHARS = 1024 * 1024 * 4;
const SANDBOX_DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function cleanText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function normalizeRelativePath(value) {
  const candidate = String(value || '').replace(/\\/g, '/').trim();
  if (!candidate || candidate.includes('\0')) {
    return '';
  }
  const normalized = candidate
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return '';
  }
  return normalized;
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return {
      text,
      truncated: false
    };
  }
  return {
    text: `${text.slice(0, maxLength)}...`,
    truncated: true
  };
}

function appendChunkText(state, chunk, maxLength) {
  const source = ensureObject(state);
  const chunkText = String(chunk || '');
  if (!chunkText) {
    return {
      text: String(source.text || ''),
      overflow: source.overflow === true
    };
  }
  const current = String(source.text || '');
  if (current.length >= maxLength) {
    return {
      text: current,
      overflow: true
    };
  }
  const available = maxLength - current.length;
  if (chunkText.length <= available) {
    return {
      text: `${current}${chunkText}`,
      overflow: source.overflow === true
    };
  }
  return {
    text: `${current}${chunkText.slice(0, available)}`,
    overflow: true
  };
}

function buildRunId() {
  return `py-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function resolvePythonExecutable(explicit = '', preferred = '') {
  const candidates = [
    cleanText(explicit, 240),
    cleanText(preferred, 240),
    cleanText(process.env.ENANA_AGENT_PYTHON_EXECUTABLE, 240),
    cleanText(process.env.ENANA_AGENT_PYTHON_BIN, 240),
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

  throw new Error('Python executable was not found. Set ENANA_AGENT_PYTHON_EXECUTABLE or install python3.');
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Path must stay inside sandbox root.');
  }
  return resolvedTarget;
}

function isProcessAlive(processId) {
  const pid = Number(processId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM' || error?.code === 'EACCES';
  }
}

async function callLifecycleHook(fn, payload, warnings, label) {
  if (typeof fn !== 'function') {
    return;
  }
  try {
    await fn(payload);
  } catch (error) {
    asArray(warnings).push(`${label} hook failed: ${cleanText(error?.message || error, 240)}.`);
  }
}

function classifyPythonSandboxFailure(result = {}) {
  const stderr = cleanText(result.stderr, 12000);
  const stdout = cleanText(result.stdout, 4000);
  const error = cleanText(result.error, 4000);
  const combined = `${stderr}\n${stdout}\n${error}`;

  const moduleMatch = combined.match(/ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i);
  if (moduleMatch?.[1]) {
    return {
      classification: 'missing_module',
      likely_cause: `The sandbox tried to import "${moduleMatch[1]}", which is not available in the current Python environment.`,
      suggested_fix: 'Use the standard library only, vendor the dependency into the sandbox files, or remove the import.'
    };
  }

  const fileMatch = combined.match(/FileNotFoundError:.*?['"]([^'"]+)['"]/i);
  if (fileMatch?.[1]) {
    return {
      classification: 'missing_file',
      likely_cause: `The code tried to open "${fileMatch[1]}", but that file was not present inside the sandbox.`,
      suggested_fix: 'Stage the file through `files`, write it before reading it, or correct the relative path.'
    };
  }

  if (/SyntaxError:/i.test(combined) || /IndentationError:/i.test(combined)) {
    return {
      classification: 'syntax_error',
      likely_cause: 'The Python source could not be parsed before execution.',
      suggested_fix: 'Check indentation, quotes, commas, and unmatched brackets in the generated code.'
    };
  }

  if (/NameError:/i.test(combined)) {
    return {
      classification: 'name_error',
      likely_cause: 'The code referenced a variable or function name that was never defined.',
      suggested_fix: 'Define the missing symbol before use or fix the variable name.'
    };
  }

  if (/TypeError:/i.test(combined)) {
    return {
      classification: 'type_error',
      likely_cause: 'An operation received a value of the wrong type.',
      suggested_fix: 'Inspect the traceback line and coerce or validate input values before that operation.'
    };
  }

  if (/ValueError:/i.test(combined)) {
    return {
      classification: 'value_error',
      likely_cause: 'The code received a value that was structurally valid but semantically unusable.',
      suggested_fix: 'Validate assumptions about parsed text, numeric conversions, or expected formats before processing.'
    };
  }

  if (/KeyError:/i.test(combined)) {
    return {
      classification: 'key_error',
      likely_cause: 'The code expected a dictionary key that was missing from the input data.',
      suggested_fix: 'Guard dictionary lookups with `.get(...)`, membership checks, or defaults.'
    };
  }

  if (/IndexError:/i.test(combined)) {
    return {
      classification: 'index_error',
      likely_cause: 'The code accessed a list or sequence position that does not exist.',
      suggested_fix: 'Check sequence lengths before indexing and handle empty-input cases.'
    };
  }

  if (result.timed_out === true) {
    return {
      classification: 'timed_out',
      likely_cause: 'The Python process exceeded the sandbox timeout before finishing.',
      suggested_fix: 'Reduce the workload, stream partial results, or request a larger timeout when appropriate.'
    };
  }

  return {
    classification: 'runtime_error',
    likely_cause: cleanText(stderr || error, 280) || 'The Python process exited with an error.',
    suggested_fix: 'Inspect the traceback, fix the failing line, and rerun with tighter input validation.'
  };
}

function defaultManagedPythonSubAgentTurn({ phase, message, metadata }) {
  if (phase === 'create') {
    return {
      assistant_message: 'Python sandbox sub-agent is ready to supervise one sandbox run and report debugging notes if execution fails.',
      summary: 'Created Python sandbox supervisor.'
    };
  }

  const details = classifyPythonSandboxFailure(ensureObject(metadata).debug_payload);
  return {
    assistant_message: [
      `Observed sandbox issue: ${details.likely_cause}`,
      `Suggested next step: ${details.suggested_fix}`,
      cleanText(message, 1200) ? `Debug context: ${cleanText(message, 1200)}` : ''
    ].filter(Boolean).join('\n'),
    summary: `Processed Python sandbox failure (${details.classification}).`,
    metadata: {
      classification: details.classification
    }
  };
}

function buildManagedPythonCreateMessage(source) {
  return [
    'Supervise this Python sandbox execution.',
    cleanText(source.task_type, 120) ? `Task type: ${cleanText(source.task_type, 120)}.` : '',
    `Readback paths: ${asArray(source.readback_paths).map((value) => cleanText(value, 180)).filter(Boolean).join(', ') || 'none'}.`,
    `Code preview:\n${cleanText(source.code, 1200)}`
  ].filter(Boolean).join('\n');
}

function buildManagedPythonDebugMessage(source, sandboxResult) {
  return [
    `Sandbox run ${cleanText(sandboxResult.run_id, 120) || 'unknown'} failed.`,
    cleanText(source.task_type, 120) ? `Task type: ${cleanText(source.task_type, 120)}.` : '',
    `Exit code: ${Number.isFinite(Number(sandboxResult.exit_code)) ? Number(sandboxResult.exit_code) : 'unknown'}.`,
    cleanText(sandboxResult.signal, 40) ? `Signal: ${cleanText(sandboxResult.signal, 40)}.` : '',
    sandboxResult.timed_out === true ? 'The run timed out.' : '',
    cleanText(sandboxResult.stderr, 1600) ? `stderr:\n${cleanText(sandboxResult.stderr, 1600)}` : '',
    cleanText(sandboxResult.stdout, 800) ? `stdout:\n${cleanText(sandboxResult.stdout, 800)}` : '',
    `Code preview:\n${cleanText(source.code, 1600)}`
  ].filter(Boolean).join('\n\n');
}

async function runPythonSandbox(input, options = {}) {
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
    || path.join(os.tmpdir(), 'enana-agent-python-sandbox');
  const sandboxDir = path.join(sandboxRoot, runId);

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
    await fs.writeFile(entryPath, code, 'utf8');

    const pythonExecutable = await resolvePythonExecutable(
      options.pythonExecutable,
      options.preferredPythonBin
    );

    let stdoutState = { text: '', overflow: false };
    let stderrState = { text: '', overflow: false };
    let exitCode = 0;
    let signal = null;
    let timedOut = false;
    let processId = null;

    const startedAtMs = Date.now();
    const child = spawn(pythonExecutable, [entryPath], {
      cwd: sandboxDir,
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

      child.on('error', (error) => {
        finish(reject, error);
      });

      child.on('close', (code, closeSignal) => {
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

    const status = timedOut ? 'timed_out' : exitCode === 0 ? 'ok' : 'error';
    const summary = status === 'ok'
      ? 'Python sandbox execution completed successfully.'
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

function createManagedPythonSandboxRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const runPythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const defaultSandboxRoot = cleanText(deps.sandboxRoot, 1200);
  const defaultPreferredPythonBin = cleanText(deps.preferredPythonBin, 240);
  const buildCreateMessage = typeof deps.buildCreateMessage === 'function'
    ? deps.buildCreateMessage
    : buildManagedPythonCreateMessage;
  const buildDebugMessage = typeof deps.buildDebugMessage === 'function'
    ? deps.buildDebugMessage
    : buildManagedPythonDebugMessage;
  const buildSystemPrompt = typeof deps.buildSystemPrompt === 'function'
    ? deps.buildSystemPrompt
    : (() => 'You are the Python sandbox supervisor sub-agent. Track one sandbox run, keep liveness accurate, and diagnose failures from the actual sandbox output.');
  const subAgentRuntime = createAgentSubAgentRuntime({
    now,
    isProcessAlive: typeof deps.isProcessAlive === 'function' ? deps.isProcessAlive : isProcessAlive,
    runSubAgentTurn: typeof deps.runSubAgentTurn === 'function'
      ? deps.runSubAgentTurn
      : defaultManagedPythonSubAgentTurn
  });

  async function execute(input = {}, options = {}) {
    const source = ensureObject(input);
    const executionOptions = ensureObject(options);
    const created = await subAgentRuntime.createSubAgent({
      name: cleanText(executionOptions.name, 160) || `python-sandbox-${Date.now()}`,
      system_prompt: cleanText(buildSystemPrompt(source, executionOptions), 40000),
      message: cleanText(buildCreateMessage(source, executionOptions), 40000) || 'Supervise the next Python sandbox execution.',
      metadata: {
        task_type: 'python-sandbox',
        parent_request_id: cleanText(executionOptions.parent_request_id || executionOptions.parentRequestId, 160),
        tags: ['python', 'sandbox', cleanText(source.task_type, 80)].filter(Boolean).slice(0, 12)
      }
    });

    const agentId = cleanText(created?.agent?.id, 160);
    const sandboxResult = await runPythonSandboxFn(source, {
      sandboxRoot: cleanText(executionOptions.sandboxRoot, 1200) || defaultSandboxRoot,
      preferredPythonBin: cleanText(executionOptions.preferredPythonBin, 240) || defaultPreferredPythonBin,
      pythonExecutable: cleanText(executionOptions.pythonExecutable, 240),
      heartbeatIntervalMs: Number(executionOptions.heartbeatIntervalMs),
      onTaskStarted: async (event) => {
        if (agentId) {
          subAgentRuntime.startSubAgentTask({
            agent_id: agentId,
            task_type: 'python-sandbox',
            started_at: event.started_at,
            process_id: event.process_id,
            summary: `Running Python sandbox ${cleanText(event.run_id, 120)}.`,
            metadata: {
              run_id: cleanText(event.run_id, 120),
              python_executable: cleanText(event.python_executable, 240),
              timeout_ms: Number(event.timeout_ms) || 0,
              python_task_type: cleanText(source.task_type, 80)
            }
          });
        }
      },
      onHeartbeat: async (event) => {
        if (agentId) {
          subAgentRuntime.recordSubAgentHeartbeat({
            agent_id: agentId,
            timestamp: event.timestamp,
            process_id: event.process_id,
            progress: event.progress === true,
            summary: cleanText(event.summary, 240),
            metadata: {
              elapsed_ms: Number(event.elapsed_ms) || 0,
              stdout_chars: Number(event.stdout_chars) || 0,
              stderr_chars: Number(event.stderr_chars) || 0
            }
          });
        }
      },
      onTaskCompleted: async (event) => {
        if (agentId) {
          subAgentRuntime.completeSubAgentTask({
            agent_id: agentId,
            finished_at: event.finished_at,
            exit_code: event.exit_code,
            signal: event.signal,
            timed_out: event.timed_out === true,
            summary: cleanText(event.summary, 240),
            metadata: {
              run_id: cleanText(event.run_id, 120)
            }
          });
        }
      },
      onTaskFailed: async (event) => {
        if (agentId) {
          subAgentRuntime.failSubAgentTask({
            agent_id: agentId,
            finished_at: event.finished_at,
            exit_code: event.exit_code,
            signal: event.signal,
            timed_out: event.timed_out === true,
            summary: cleanText(event.summary || event.error, 240),
            metadata: {
              run_id: cleanText(event.run_id, 120)
            }
          });
        }
      }
    });

    let debugTurn = null;
    if (agentId && sandboxResult.ok !== true) {
      debugTurn = await subAgentRuntime.sendSubAgentMessage({
        agent_id: agentId,
        message: buildDebugMessage(source, sandboxResult),
        metadata: {
          debug_payload: {
            run_id: cleanText(sandboxResult.run_id, 120),
            status: cleanText(sandboxResult.status, 40),
            error: cleanText(sandboxResult.error, 4000),
            stderr: cleanText(sandboxResult.stderr, 12000),
            stdout: cleanText(sandboxResult.stdout, 4000),
            exit_code: sandboxResult.exit_code,
            signal: cleanText(sandboxResult.signal, 40),
            timed_out: sandboxResult.timed_out === true
          }
        }
      });
    }

    const inspected = agentId ? subAgentRuntime.getSubAgent({ agent_id: agentId }) : null;
    const agent = inspected?.ok === true
      ? inspected.agent
      : (created?.agent || null);
    const debug = sandboxResult.ok === true
      ? null
      : cloneJson(agent?.last_response || debugTurn?.agent?.last_response, null);

    return {
      ok: sandboxResult.ok === true,
      sandbox: sandboxResult,
      sub_agent: agent,
      debug,
      summary: cleanText(sandboxResult.summary, 320)
        || (sandboxResult.ok ? 'Python sandbox execution completed.' : 'Python sandbox execution failed.')
    };
  }

  return {
    execute,
    getSubAgent: (input = {}) => subAgentRuntime.getSubAgent(input),
    listSubAgents: () => subAgentRuntime.listSubAgents(),
    subAgentRuntime
  };
}

module.exports = {
  asArray,
  cleanText,
  clamp,
  normalizeRelativePath,
  runPythonSandbox,
  resolvePythonExecutable,
  isProcessAlive,
  createManagedPythonSandboxRuntime
};
