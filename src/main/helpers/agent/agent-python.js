'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const SANDBOX_DEFAULT_TIMEOUT_MS = 6000;
const SANDBOX_MIN_TIMEOUT_MS = 500;
const SANDBOX_MAX_TIMEOUT_MS = 15000;
const SANDBOX_MAX_STDIO_CHARS = 120000;
const SANDBOX_MAX_READBACK_CHARS = 60000;
const SANDBOX_MAX_READBACK_FILES = 20;
const SANDBOX_MAX_INPUT_FILES = 32;

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function buildRunId() {
  return `py-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function resolvePythonExecutable(explicit = '') {
  const candidates = [
    cleanText(explicit, 240),
    cleanText(process.env.ENANA_AGENT_PYTHON_EXECUTABLE, 240),
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

async function runPythonSandbox(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const runId = buildRunId();
  const timeoutMs = clamp(Number(source.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS);
  const warnings = [];
  const filesWritten = [];
  const readbackFiles = [];

  const code = typeof source.code === 'string' ? source.code : '';
  if (!code.trim()) {
    return {
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
      warnings: [],
      summary: 'Python sandbox execution failed before launch.'
    };
  }

  const sandboxRoot = cleanText(options.sandboxRoot, 1200)
    || path.join(os.tmpdir(), 'enana-agent-python-sandbox');
  const sandboxDir = path.join(sandboxRoot, runId);

  try {
    await fs.mkdir(sandboxDir, { recursive: true });

    const inputFiles = asArray(source.files).slice(0, SANDBOX_MAX_INPUT_FILES);
    for (let index = 0; index < inputFiles.length; index += 1) {
      const file = inputFiles[index] && typeof inputFiles[index] === 'object' ? inputFiles[index] : {};
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

    const pythonExecutable = await resolvePythonExecutable(options.pythonExecutable);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let signal = null;
    let timedOut = false;

    try {
      const execResult = await execFileAsync(pythonExecutable, [entryPath], {
        cwd: sandboxDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true
      });
      stdout = String(execResult.stdout || '');
      stderr = String(execResult.stderr || '');
      exitCode = 0;
    } catch (error) {
      stdout = String(error?.stdout || '');
      stderr = String(error?.stderr || error?.message || '');
      exitCode = Number.isFinite(Number(error?.code)) ? Number(error.code) : 1;
      signal = error?.signal || null;
      timedOut = error?.killed === true && String(error?.signal || '').toUpperCase() === 'SIGTERM';
    }

    const stdoutLimited = truncateText(stdout, SANDBOX_MAX_STDIO_CHARS);
    const stderrLimited = truncateText(stderr, SANDBOX_MAX_STDIO_CHARS);
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

    return {
      ok: status === 'ok',
      run_id: runId,
      status,
      error: status === 'ok' ? '' : cleanText(stderrLimited.text || summary, 4000),
      timeout_ms: timeoutMs,
      python_executable: pythonExecutable,
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
  } catch (error) {
    return {
      ok: false,
      run_id: runId,
      status: 'error',
      error: cleanText(error?.message || error, 4000) || 'Python sandbox execution failed before launch.',
      timeout_ms: timeoutMs,
      python_executable: '',
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
  } finally {
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  asArray,
  cleanText,
  clamp,
  normalizeRelativePath,
  runPythonSandbox
};
