const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { clamp, normalizeRelativePath } = require('./agent-python-common');

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;
const MAX_CODE_CHARS = 60000;
const MAX_FILE_COUNT = 10;
const MAX_FILE_CHARS = 40000;
const MAX_READBACK_COUNT = 8;
const MAX_READBACK_CHARS = 20000;
const MAX_OUTPUT_BUFFER_BYTES = 160 * 1024;
const MAX_STDIO_CHARS = 12000;

let cachedPythonExecutable = null;

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxLength)}...`, truncated: true };
}

function isInsideDirectory(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function buildPythonExecArgs(pythonExecutable, entryFile) {
  const bin = path.basename(pythonExecutable || '').toLowerCase();
  if (bin === 'py' || bin === 'py.exe') {
    return ['-3', '-I', entryFile];
  }
  return ['-I', entryFile];
}

function buildPythonSandboxEnv(sandboxDir) {
  const env = {
    PATH: String(process.env.PATH || ''),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    HOME: sandboxDir,
    USERPROFILE: sandboxDir,
    TMPDIR: sandboxDir,
    TEMP: sandboxDir,
    TMP: sandboxDir
  };
  if (process.platform === 'win32') {
    env.SystemRoot = String(process.env.SystemRoot || process.env.WINDIR || '');
    env.WINDIR = String(process.env.WINDIR || process.env.SystemRoot || '');
    env.ComSpec = String(process.env.ComSpec || '');
    env.PATHEXT = String(process.env.PATHEXT || '');
  }
  return env;
}

function buildRunId(prefix = 'py') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function resolvePythonExecutable(preferredExecutable = '') {
  const preferred = String(preferredExecutable || '').trim();
  if (cachedPythonExecutable && cachedPythonExecutable !== preferred) {
    return cachedPythonExecutable;
  }

  const candidates = [preferred, 'python3', 'python']
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], {
        timeout: 1500,
        windowsHide: true,
        maxBuffer: 32 * 1024
      });
      cachedPythonExecutable = candidate;
      return cachedPythonExecutable;
    } catch {
      // Try next candidate.
    }
  }

  cachedPythonExecutable = '';
  return cachedPythonExecutable;
}

async function runPythonSandbox(input, options = {}) {
  const payload = input && typeof input === 'object' ? input : {};
  const code = typeof payload.code === 'string' ? payload.code : '';
  const warnings = [];

  if (!code.trim()) {
    return {
      ok: false,
      run_id: '',
      status: 'error',
      error: 'Missing Python code.',
      timeout_ms: clamp(DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      python_executable: '',
      exit_code: null,
      signal: null,
      timed_out: false,
      stdout: '',
      stderr: '',
      files_written: [],
      readback_files: [],
      warnings,
      summary: 'Python sandbox rejected request: missing code.'
    };
  }

  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      run_id: '',
      status: 'error',
      error: `Python code exceeds ${MAX_CODE_CHARS} characters.`,
      timeout_ms: clamp(DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      python_executable: '',
      exit_code: null,
      signal: null,
      timed_out: false,
      stdout: '',
      stderr: '',
      files_written: [],
      readback_files: [],
      warnings,
      summary: 'Python sandbox rejected request: code payload too large.'
    };
  }

  const timeoutMs = clamp(
    Number(payload.timeout_ms) || DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  const preferredPythonBin = String(options.preferredPythonBin || '').trim();
  const pythonExecutable = await resolvePythonExecutable(preferredPythonBin);
  if (!pythonExecutable) {
    return {
      ok: false,
      run_id: '',
      status: 'error',
      error: 'Python executable was not found. Set ENANA_AGENT_PYTHON_BIN, or install python3/python.',
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
      summary: 'Python sandbox unavailable: missing python executable.'
    };
  }

  const sandboxRootRaw = String(options.sandboxRoot || '').trim();
  const sandboxRoot = sandboxRootRaw
    ? path.resolve(sandboxRootRaw)
    : path.resolve(path.join(process.cwd(), 'tmp', 'agent-python-sandbox'));
  const runId = buildRunId('py');
  const sandboxDir = path.join(sandboxRoot, runId);
  const filesWritten = [];

  try {
    await fs.mkdir(sandboxDir, { recursive: true });

    const extraFiles = Array.isArray(payload.files) ? payload.files.slice(0, MAX_FILE_COUNT) : [];
    for (let index = 0; index < extraFiles.length; index += 1) {
      const spec = extraFiles[index];
      const relativePath = normalizeRelativePath(spec?.path, `file-${index + 1}.txt`);
      if (!relativePath) {
        warnings.push(`Skipped invalid file path at files[${index}].`);
        continue;
      }
      if (relativePath.toLowerCase() === 'main.py') {
        warnings.push('Skipped files[].path "main.py"; use the top-level code field for entrypoint code.');
        continue;
      }

      const content = typeof spec?.content === 'string' ? spec.content : '';
      if (content.length > MAX_FILE_CHARS) {
        warnings.push(`Skipped ${relativePath}: content exceeds ${MAX_FILE_CHARS} characters.`);
        continue;
      }

      const absolutePath = path.resolve(path.join(sandboxDir, relativePath));
      if (!isInsideDirectory(sandboxDir, absolutePath)) {
        warnings.push(`Skipped ${relativePath}: path escapes sandbox root.`);
        continue;
      }

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
      filesWritten.push(relativePath);
    }

    const entryFile = 'main.py';
    await fs.writeFile(path.join(sandboxDir, entryFile), code, 'utf8');
    filesWritten.unshift(entryFile);

    let exitCode = 0;
    let signal = null;
    let timedOut = false;
    let rawStdout = '';
    let rawStderr = '';

    try {
      const result = await execFileAsync(
        pythonExecutable,
        buildPythonExecArgs(pythonExecutable, entryFile),
        {
          cwd: sandboxDir,
          env: buildPythonSandboxEnv(sandboxDir),
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT_BUFFER_BYTES
        }
      );
      rawStdout = String(result?.stdout || '');
      rawStderr = String(result?.stderr || '');
    } catch (error) {
      const err = error || {};
      const message = String(err.message || '');
      exitCode = Number.isInteger(err.code) ? err.code : null;
      signal = err.signal ? String(err.signal) : null;
      timedOut = /timed out/i.test(message);
      rawStdout = String(err.stdout || '');
      rawStderr = String(err.stderr || message || 'Python sandbox execution failed.');
      if (/maxBuffer length exceeded/i.test(message)) {
        warnings.push('Output was truncated after exceeding maxBuffer.');
      }
    }

    const stdout = truncateText(rawStdout, MAX_STDIO_CHARS);
    const stderr = truncateText(rawStderr, MAX_STDIO_CHARS);
    if (stdout.truncated) {
      warnings.push('Stdout was truncated.');
    }
    if (stderr.truncated) {
      warnings.push('Stderr was truncated.');
    }

    const readbackFiles = [];
    const readbackPaths = Array.isArray(payload.readback_paths)
      ? payload.readback_paths.slice(0, MAX_READBACK_COUNT)
      : [];
    for (let index = 0; index < readbackPaths.length; index += 1) {
      const relativePath = normalizeRelativePath(readbackPaths[index], '');
      if (!relativePath) {
        warnings.push(`Skipped invalid readback path at readback_paths[${index}].`);
        continue;
      }

      const absolutePath = path.resolve(path.join(sandboxDir, relativePath));
      if (!isInsideDirectory(sandboxDir, absolutePath)) {
        warnings.push(`Skipped readback ${relativePath}: path escapes sandbox root.`);
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          warnings.push(`Skipped readback ${relativePath}: not a file.`);
          continue;
        }
        const content = await fs.readFile(absolutePath, 'utf8');
        const limited = truncateText(content, MAX_READBACK_CHARS);
        if (limited.truncated) {
          warnings.push(`Readback ${relativePath} was truncated to ${MAX_READBACK_CHARS} chars.`);
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
    const error = status === 'ok' ? '' : (stderr.text || summary);

    return {
      ok: status === 'ok',
      run_id: runId,
      status,
      error,
      timeout_ms: timeoutMs,
      python_executable: pythonExecutable,
      exit_code: exitCode,
      signal,
      timed_out: timedOut,
      stdout: stdout.text,
      stderr: stderr.text,
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
      error: String(error?.message || error || 'Python sandbox execution failed before launch.'),
      timeout_ms: timeoutMs,
      python_executable: pythonExecutable,
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
  runPythonSandbox
};
