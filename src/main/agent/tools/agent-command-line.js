'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_OUTPUT_LIMIT = 12000;

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function clampInteger(value, fallback, minimum, maximum) {
  const numeric = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function resolveWorkingDirectory(inputCwd = '', fallbackCwd = process.cwd()) {
  const raw = String(inputCwd || '').trim();
  const fallback = String(fallbackCwd || '').trim() || process.cwd();
  const resolved = raw
    ? (path.isAbsolute(raw) ? raw : path.resolve(fallback, raw))
    : fallback;
  try {
    if (fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {
    return '';
  }
  return '';
}

function appendLimitedText(currentValue = '', chunk = '', limit = DEFAULT_OUTPUT_LIMIT) {
  const combined = `${String(currentValue || '')}${String(chunk || '')}`;
  if (combined.length <= limit) {
    return combined;
  }
  return combined.slice(0, limit);
}

function buildSummary({
  status = '',
  exitCode = null,
  timedOut = false,
  stdout = '',
  stderr = '',
  cwd = ''
} = {}) {
  const preview = defaultCleanText(stdout || stderr);
  if (timedOut) {
    return `Command timed out while running in ${cwd || 'the workspace'}.`;
  }
  if (status === 'completed') {
    return preview
      ? `Command completed successfully. Output preview: ${preview}`
      : `Command completed successfully${cwd ? ` in ${cwd}` : ''}.`;
  }
  if (status === 'blocked') {
    return 'This command looks mutating and write-enabled execution is not allowed for this tool call.';
  }
  return preview
    ? `Command exited with code ${exitCode ?? 'unknown'}. Output preview: ${preview}`
    : `Command exited with code ${exitCode ?? 'unknown'}.`;
}

function looksMutatingCommand(command = '') {
  const text = String(command || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return /(^|[\s;&|])(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|sed\s+-i|perl\s+-i|tee|git\s+(add|commit|push|pull|checkout|switch|reset|merge|rebase)|npm\s+(install|update|uninstall)|pnpm\s+(add|install|update|remove)|yarn\s+(add|install|remove)|pip3?\s+install|uv\s+pip\s+install)([\s;&|]|$)/i.test(text)
    || />{1,2}/.test(text);
}

function createAgentCommandLineRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const outputLimit = clampInteger(deps.outputLimit, DEFAULT_OUTPUT_LIMIT, 2000, 40000);
  const defaultCwd = cleanText(deps.defaultCwd, 1200) || process.cwd();
  const defaultShell = process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : (process.env.SHELL || '/bin/zsh');

  function buildShellArgs(command) {
    return process.platform === 'win32'
      ? ['/d', '/s', '/c', command]
      : ['-lc', command];
  }

  async function execute(input = {}, context = {}) {
    const command = cleanText(input.command || input.cmd, 12000);
    const cwd = resolveWorkingDirectory(
      input.cwd
      || input.working_directory
      || input.workingDirectory,
      cleanText(context?.cwd, 1200) || defaultCwd
    );
    const timeoutMs = clampInteger(
      input.timeout_ms || input.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      500,
      MAX_TIMEOUT_MS
    );

    if (!command) {
      return {
        status: 'needs_more_info',
        command: '',
        cwd: cwd || defaultCwd,
        exit_code: null,
        stdout: '',
        stderr: '',
        timed_out: false,
        duration_ms: 0,
        summary: 'Please provide a shell command to run.',
        follow_up_questions: ['What shell command should I run?']
      };
    }
    if (!cwd) {
      return {
        status: 'error',
        command,
        cwd: '',
        exit_code: null,
        stdout: '',
        stderr: '',
        timed_out: false,
        duration_ms: 0,
        summary: 'The requested working directory does not exist.',
        error: 'The requested working directory does not exist.'
      };
    }
    if (context?.allowWriteTools !== true && looksMutatingCommand(command)) {
      return {
        status: 'blocked',
        command,
        cwd,
        exit_code: null,
        stdout: '',
        stderr: '',
        timed_out: false,
        duration_ms: 0,
        summary: buildSummary({
          status: 'blocked',
          command,
          cwd
        }),
        error: 'Mutating shell commands require allowWriteTools=true.'
      };
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let closed = false;

      const child = spawn(defaultShell, buildShellArgs(command), {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      const finish = ({
        status = 'error',
        exitCode = null,
        signal = '',
        error = ''
      } = {}) => {
        if (closed) {
          return;
        }
        closed = true;
        resolve({
          status,
          command,
          cwd,
          exit_code: Number.isInteger(exitCode) ? exitCode : null,
          signal: cleanText(signal, 40),
          stdout: cleanText(stdout, outputLimit),
          stderr: cleanText(stderr, outputLimit),
          output: cleanText([stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : ''), outputLimit),
          timed_out: timedOut,
          duration_ms: Date.now() - startedAt,
          summary: buildSummary({
            status,
            command,
            exitCode,
            timedOut,
            stdout,
            stderr,
            cwd
          }),
          ...(cleanText(error, 1200) ? { error: cleanText(error, 1200) } : {})
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore shutdown errors and let the close handler resolve.
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore hard-kill errors after the process already exited.
          }
        }, 500);
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdout = appendLimitedText(stdout, chunk, outputLimit);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = appendLimitedText(stderr, chunk, outputLimit);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        finish({
          status: 'error',
          error: cleanText(error?.message || error, 1200) || 'Command execution failed.'
        });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        finish({
          status: timedOut ? 'timeout' : (code === 0 ? 'completed' : 'error'),
          exitCode: code,
          signal
        });
      });
    });
  }

  return {
    execute
  };
}

module.exports = {
  createAgentCommandLineRuntime,
  looksMutatingCommand,
  resolveWorkingDirectory
};
