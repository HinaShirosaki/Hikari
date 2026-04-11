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
} = require('../shared/agent-request-context.js');

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
const SANDBOX_HELPER_MODULE_NAME = 'enana_sandbox.py';
const SANDBOX_RENDER_OUTPUT_FILE_NAME = '.enana_sandbox_render_outputs.json';
const SANDBOX_MAX_RENDER_OUTPUTS = 12;
const SANDBOX_MAX_RENDER_TEXT_CHARS = 24000;
const SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS = 1024 * 1024;
const SANDBOX_DEFAULT_REPAIR_ATTEMPTS = 2;
const SANDBOX_MAX_REPAIR_ATTEMPTS = 6;
const SANDBOX_ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

const PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action', 'assistant_message'],
  properties: {
    action: {
      type: 'string',
      enum: ['rerun', 'return_result', 'give_up']
    },
    assistant_message: {
      type: 'string',
      maxLength: 4000
    },
    summary: {
      type: 'string',
      maxLength: 500
    },
    code: {
      type: 'string',
      maxLength: 40000
    },
    timeout_ms: {
      type: 'integer',
      minimum: SANDBOX_MIN_TIMEOUT_MS,
      maximum: SANDBOX_MAX_TIMEOUT_MS
    },
    files: {
      type: 'array',
      maxItems: SANDBOX_MAX_INPUT_FILES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            maxLength: 240
          },
          content: {
            type: 'string'
          }
        }
      }
    },
    readback_paths: {
      type: 'array',
      maxItems: SANDBOX_MAX_READBACK_FILES,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 240
      }
    }
  }
});

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

function cleanText(value, _maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
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

function inferImageMimeType(filePath = '') {
  const extension = path.extname(cleanText(filePath, 260)).toLowerCase();
  if (extension === '.png') {
    return 'image/png';
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  return '';
}

function normalizeRenderOutputTextContent(value, warnings, label = 'text output') {
  const limited = truncateText(String(value || ''), SANDBOX_MAX_RENDER_TEXT_CHARS);
  if (limited.truncated) {
    asArray(warnings).push(`${label} truncated to ${SANDBOX_MAX_RENDER_TEXT_CHARS} chars.`);
  }
  return limited.text;
}

function normalizePythonSandboxRenderOutputs(rawOutputs, warnings = []) {
  const outputs = [];
  asArray(rawOutputs).slice(0, SANDBOX_MAX_RENDER_OUTPUTS).forEach((entry, index) => {
    const source = ensureObject(entry);
    const type = cleanText(source.type, 40).toLowerCase();
    if (type === 'text') {
      const content = normalizeRenderOutputTextContent(
        source.content !== undefined ? source.content : source.text,
        warnings,
        `render_outputs[${index}]`
      );
      if (!content) {
        return;
      }
      const format = cleanText(source.format || source.mime_type, 80).toLowerCase() || 'text/plain';
      outputs.push({
        type: 'text',
        title: cleanText(source.title, 160),
        format,
        content
      });
      return;
    }

    if (type === 'image') {
      const mimeType = cleanText(source.mime_type, 120).toLowerCase()
        || inferImageMimeType(source.path)
        || 'image/png';
      if (!SANDBOX_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        warnings.push(`Skipped render_outputs[${index}] due to unsupported mime_type ${mimeType || 'unknown'}.`);
        return;
      }
      const dataBase64 = String(source.data_base64 || source.dataBase64 || '').replace(/\s+/g, '');
      if (!dataBase64) {
        warnings.push(`Skipped render_outputs[${index}] because image data was empty.`);
        return;
      }
      if (dataBase64.length > SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS) {
        warnings.push(`Skipped render_outputs[${index}] because image data exceeded ${SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS} chars.`);
        return;
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(dataBase64)) {
        warnings.push(`Skipped render_outputs[${index}] because image data was not valid base64.`);
        return;
      }
      outputs.push({
        type: 'image',
        title: cleanText(source.title, 160),
        alt: cleanText(source.alt, 200) || cleanText(source.title, 160) || 'Python sandbox image output',
        mime_type: mimeType,
        data_base64: dataBase64,
        path: normalizeRelativePath(source.path)
      });
      return;
    }

    warnings.push(`Skipped render_outputs[${index}] due to unsupported type.`);
  });
  if (asArray(rawOutputs).length > SANDBOX_MAX_RENDER_OUTPUTS) {
    warnings.push(`render_outputs capped at ${SANDBOX_MAX_RENDER_OUTPUTS} entries.`);
  }
  return outputs;
}

function normalizePythonSandboxFiles(rawFiles = []) {
  return asArray(rawFiles)
    .slice(0, SANDBOX_MAX_INPUT_FILES)
    .map((entry, index) => {
      const source = ensureObject(entry);
      const relativePath = normalizeRelativePath(source.path);
      if (!relativePath) {
        return null;
      }
      return {
        path: relativePath,
        content: String(source.content || '')
      };
    })
    .filter(Boolean);
}

function normalizePythonSandboxReadbackPaths(rawPaths = []) {
  return asArray(rawPaths)
    .slice(0, SANDBOX_MAX_READBACK_FILES)
    .map((entry) => normalizeRelativePath(entry))
    .filter(Boolean);
}

function normalizePythonSandboxInput(value = {}) {
  const source = ensureObject(value);
  const timeoutCandidate = Number(source.timeout_ms);
  return {
    code: typeof source.code === 'string' ? source.code : '',
    timeout_ms: Number.isFinite(timeoutCandidate)
      ? clamp(timeoutCandidate, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
      : SANDBOX_DEFAULT_TIMEOUT_MS,
    files: normalizePythonSandboxFiles(source.files),
    readback_paths: normalizePythonSandboxReadbackPaths(source.readback_paths),
    task_type: cleanText(source.task_type, 120)
  };
}

function buildStoredPythonSandboxInput(input = {}) {
  const normalized = normalizePythonSandboxInput(input);
  return {
    code: normalized.code,
    timeout_ms: normalized.timeout_ms,
    files: cloneJson(normalized.files, []),
    readback_paths: cloneJson(normalized.readback_paths, []),
    task_type: normalized.task_type
  };
}

function summarizeRenderOutputForPrompt(entry = {}) {
  const source = ensureObject(entry);
  const type = cleanText(source.type, 40).toLowerCase();
  if (type === 'text') {
    return {
      type: 'text',
      title: cleanText(source.title, 160),
      format: cleanText(source.format, 80).toLowerCase() || 'text/plain',
      content: cleanText(source.content, 2000)
    };
  }
  if (type === 'image') {
    return {
      type: 'image',
      title: cleanText(source.title, 160),
      alt: cleanText(source.alt, 200),
      mime_type: cleanText(source.mime_type, 120),
      path: normalizeRelativePath(source.path)
    };
  }
  return {
    type: cleanText(source.type, 40) || 'unknown'
  };
}

function buildStoredPythonSandboxResult(result = {}) {
  const source = ensureObject(result);
  return {
    ok: source.ok === true,
    run_id: cleanText(source.run_id, 120),
    status: cleanText(source.status, 40),
    error: cleanText(source.error, 4000),
    timeout_ms: Number.isFinite(Number(source.timeout_ms)) ? Number(source.timeout_ms) : null,
    python_executable: cleanText(source.python_executable, 240),
    process_id: Number.isFinite(Number(source.process_id)) ? Number(source.process_id) : null,
    exit_code: Number.isFinite(Number(source.exit_code)) ? Number(source.exit_code) : null,
    signal: cleanText(source.signal, 40),
    timed_out: source.timed_out === true,
    stdout: cleanText(source.stdout, 4000),
    stderr: cleanText(source.stderr, 12000),
    readback_files: asArray(source.readback_files).slice(0, SANDBOX_MAX_READBACK_FILES).map((entry) => ({
      path: normalizeRelativePath(entry?.path),
      content: cleanText(entry?.content, 4000),
      truncated: entry?.truncated === true
    })),
    render_outputs: asArray(source.render_outputs).slice(0, 6).map((entry) => summarizeRenderOutputForPrompt(entry)),
    warnings: asArray(source.warnings).slice(0, 12).map((entry) => cleanText(entry, 240)).filter(Boolean),
    summary: cleanText(source.summary, 320)
  };
}

function mergePythonSandboxInput(baseInput = {}, overrideInput = {}) {
  const base = normalizePythonSandboxInput(baseInput);
  const override = ensureObject(overrideInput);
  const merged = {
    code: Object.prototype.hasOwnProperty.call(override, 'code')
      ? String(override.code || '')
      : base.code,
    timeout_ms: Object.prototype.hasOwnProperty.call(override, 'timeout_ms')
      ? clamp(Number(override.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
      : base.timeout_ms,
    files: Object.prototype.hasOwnProperty.call(override, 'files')
      ? normalizePythonSandboxFiles(override.files)
      : cloneJson(base.files, []),
    readback_paths: Object.prototype.hasOwnProperty.call(override, 'readback_paths')
      ? normalizePythonSandboxReadbackPaths(override.readback_paths)
      : cloneJson(base.readback_paths, []),
    task_type: Object.prototype.hasOwnProperty.call(override, 'task_type')
      ? cleanText(override.task_type, 120)
      : base.task_type
  };
  return merged;
}

function pythonSandboxInputsEqual(leftInput = {}, rightInput = {}) {
  const left = buildStoredPythonSandboxInput(leftInput);
  const right = buildStoredPythonSandboxInput(rightInput);
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildPythonSandboxHelperModule() {
  return [
    'import atexit',
    'import base64',
    'import json',
    'import os',
    '',
    '_ROOT = os.path.abspath(os.environ.get("ENANA_SANDBOX_ROOT") or os.getcwd())',
    '_OUTPUT_PATH = os.path.abspath(os.environ.get("ENANA_SANDBOX_OUTPUT_PATH") or os.path.join(_ROOT, ".enana_sandbox_render_outputs.json"))',
    '_RENDER_OUTPUTS = []',
    '',
    'def _resolve_path(relative_path):',
    '    text = str(relative_path or "").replace("\\\\", "/").strip()',
    '    if not text:',
    '        raise ValueError("Path is required.")',
    '    target = os.path.abspath(os.path.join(_ROOT, text))',
    '    root_prefix = _ROOT if _ROOT.endswith(os.sep) else _ROOT + os.sep',
    '    if target != _ROOT and not target.startswith(root_prefix):',
    '        raise ValueError("Path must stay inside sandbox root.")',
    '    return target',
    '',
    'def read_text(relative_path, encoding="utf-8"):',
    '    with open(_resolve_path(relative_path), "r", encoding=encoding) as handle:',
    '        return handle.read()',
    '',
    'def read_bytes(relative_path):',
    '    with open(_resolve_path(relative_path), "rb") as handle:',
    '        return handle.read()',
    '',
    'def read_json(relative_path, encoding="utf-8"):',
    '    return json.loads(read_text(relative_path, encoding=encoding))',
    '',
    'def emit_text(content, title=None, format="text/plain"):',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "text",',
    '        "title": str(title or ""),',
    '        "format": str(format or "text/plain"),',
    '        "content": str(content or "")',
    '    })',
    '',
    'def emit_markdown(content, title=None):',
    '    emit_text(content, title=title, format="text/markdown")',
    '',
    'def emit_json(value, title=None):',
    '    emit_text(json.dumps(value, indent=2, ensure_ascii=False), title=title, format="application/json")',
    '',
    'def emit_image(relative_path, title=None, mime_type=None, alt=None):',
    '    image_path = _resolve_path(relative_path)',
    '    with open(image_path, "rb") as handle:',
    '        encoded = base64.b64encode(handle.read()).decode("ascii")',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "image",',
    '        "title": str(title or ""),',
    '        "mime_type": str(mime_type or ""),',
    '        "alt": str(alt or title or ""),',
    '        "path": str(relative_path or ""),',
    '        "data_base64": encoded',
    '    })',
    '',
    'def emit_image_bytes(data, mime_type="image/png", title=None, alt=None):',
    '    encoded = base64.b64encode(bytes(data or b"")).decode("ascii")',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "image",',
    '        "title": str(title or ""),',
    '        "mime_type": str(mime_type or "image/png"),',
    '        "alt": str(alt or title or ""),',
    '        "data_base64": encoded',
    '    })',
    '',
    'def list_outputs():',
    '    return list(_RENDER_OUTPUTS)',
    '',
    'def clear_outputs():',
    '    _RENDER_OUTPUTS.clear()',
    '',
    'def _persist_outputs():',
    '    payload = {',
    '        "version": 1,',
    '        "outputs": _RENDER_OUTPUTS',
    '    }',
    '    parent = os.path.dirname(_OUTPUT_PATH)',
    '    if parent:',
    '        os.makedirs(parent, exist_ok=True)',
    '    temp_path = _OUTPUT_PATH + ".tmp"',
    '    with open(temp_path, "w", encoding="utf-8") as handle:',
    '        json.dump(payload, handle)',
    '    os.replace(temp_path, _OUTPUT_PATH)',
    '',
    'atexit.register(_persist_outputs)'
  ].join('\n');
}

async function readPythonSandboxRenderOutputs(renderOutputPath, warnings = []) {
  try {
    const raw = await fs.readFile(renderOutputPath, 'utf8');
    const payload = JSON.parse(raw);
    const source = ensureObject(payload);
    return normalizePythonSandboxRenderOutputs(source.outputs, warnings);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    warnings.push(`Failed to load sandbox render outputs: ${String(error?.message || error)}.`);
    return [];
  }
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

function buildPythonSandboxSubAgentSystemPrompt() {
  return [
    'You are the Python sandbox worker sub-agent.',
    'Own the sandbox task end to end: if a run fails, repair it yourself instead of asking the main agent to debug for you.',
    'When the main agent says the latest result is not sufficient, continue the work yourself and prepare the next sandbox run.',
    'Only return JSON that matches the requested schema.',
    'When you return action "rerun", provide a complete updated sandbox plan or only the fields that must change; omitted fields keep their prior values.',
    'Use action "return_result" only when the latest sandbox output is already good enough to hand back to the main agent without another run.',
    'Use action "give_up" only when you cannot make further progress from the available code, files, and feedback.'
  ].join('\n');
}

function buildPythonSandboxPlanFallback(requestType, metadata = {}) {
  const latestResult = buildStoredPythonSandboxResult(ensureObject(metadata.latest_sandbox_result));
  const feedback = cleanText(metadata.feedback, 2000);
  if (requestType === 'continue_plan' && latestResult.ok === true && !feedback) {
    return {
      action: 'return_result',
      assistant_message: 'The latest sandbox result is ready to return to the main agent.',
      summary: 'Returned the latest sandbox result without another run.'
    };
  }

  const details = classifyPythonSandboxFailure(ensureObject(metadata.latest_sandbox_result));
  if (requestType === 'repair_plan') {
    return {
      action: 'give_up',
      assistant_message: [
        `Observed sandbox issue: ${details.likely_cause}`,
        `Suggested next step: ${details.suggested_fix}`
      ].filter(Boolean).join('\n'),
      summary: `Unable to self-repair sandbox failure (${details.classification}) without model guidance.`
    };
  }

  return {
    action: 'give_up',
    assistant_message: feedback
      ? `The main agent asked for more work, but the sandbox helper needs model guidance to continue automatically. Feedback: ${feedback}`
      : 'The sandbox helper needs more guidance before it can continue automatically.',
    summary: 'Unable to continue the sandbox task automatically.'
  };
}

function normalizePythonSandboxPlan(rawPayload, fallback = {}) {
  const source = ensureObject(rawPayload);
  const normalizedAction = cleanText(source.action, 40).toLowerCase();
  const action = ['rerun', 'return_result', 'give_up'].includes(normalizedAction)
    ? normalizedAction
    : cleanText(fallback.action, 40).toLowerCase() || 'give_up';
  return {
    action,
    assistant_message: cleanText(source.assistant_message, 4000)
      || cleanText(fallback.assistant_message, 4000)
      || 'Python sandbox helper reviewed the latest run.',
    summary: cleanText(source.summary, 500)
      || cleanText(fallback.summary, 500)
      || 'Python sandbox helper returned a follow-up decision.',
    code: Object.prototype.hasOwnProperty.call(source, 'code')
      ? String(source.code || '')
      : (Object.prototype.hasOwnProperty.call(fallback, 'code') ? String(fallback.code || '') : ''),
    timeout_ms: Object.prototype.hasOwnProperty.call(source, 'timeout_ms')
      ? clamp(Number(source.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
      : (Number.isFinite(Number(fallback.timeout_ms))
        ? clamp(Number(fallback.timeout_ms), SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
        : null),
    files: Object.prototype.hasOwnProperty.call(source, 'files')
      ? normalizePythonSandboxFiles(source.files)
      : (Object.prototype.hasOwnProperty.call(fallback, 'files')
        ? normalizePythonSandboxFiles(fallback.files)
        : null),
    readback_paths: Object.prototype.hasOwnProperty.call(source, 'readback_paths')
      ? normalizePythonSandboxReadbackPaths(source.readback_paths)
      : (Object.prototype.hasOwnProperty.call(fallback, 'readback_paths')
        ? normalizePythonSandboxReadbackPaths(fallback.readback_paths)
        : null)
  };
}

function buildPythonSandboxPlanMessage({
  requestType,
  originalRequest,
  currentInput,
  latestResult,
  feedback = '',
  attemptNumber = 0,
  maxRepairAttempts = 0
} = {}) {
  const phaseLabel = requestType === 'continue_plan'
    ? 'The main agent was not satisfied with the last sandbox result and wants you to continue.'
    : 'The latest sandbox run failed. Repair the sandbox task yourself.';
  return [
    phaseLabel,
    originalRequest ? `Original main-agent request:\n${cleanText(originalRequest, 6000)}` : '',
    `Current sandbox input JSON:\n${JSON.stringify(buildStoredPythonSandboxInput(currentInput), null, 2)}`,
    `Latest sandbox result JSON:\n${JSON.stringify(buildStoredPythonSandboxResult(latestResult), null, 2)}`,
    feedback ? `Main-agent feedback:\n${cleanText(feedback, 6000)}` : '',
    requestType === 'repair_plan'
      ? `Repair attempts used: ${Math.max(0, Number(attemptNumber) || 0)} / ${Math.max(0, Number(maxRepairAttempts) || 0)}`
      : '',
    'Return JSON only.',
    'If you need another sandbox run, choose action "rerun".',
    'If the latest result is already sufficient, choose action "return_result".',
    'If you cannot make further progress, choose action "give_up".'
  ].filter(Boolean).join('\n\n');
}

function createManagedPythonSubAgentTurnRuntime(deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const defaultSystemPrompt = typeof deps.buildSystemPrompt === 'function'
    ? deps.buildSystemPrompt
    : buildPythonSandboxSubAgentSystemPrompt;

  return async function managedPythonSubAgentTurn({ phase, message, metadata, system_prompt }) {
    const requestType = cleanText(ensureObject(metadata).request_type, 80).toLowerCase();
    if (phase === 'create') {
      return {
        assistant_message: 'Python sandbox sub-agent is ready to execute, repair, and continue sandbox work as needed.',
        summary: 'Created Python sandbox worker.'
      };
    }

    if (!['repair_plan', 'continue_plan'].includes(requestType)) {
      return defaultManagedPythonSubAgentTurn({ phase, message, metadata });
    }

    const fallback = buildPythonSandboxPlanFallback(requestType, metadata);
    if (!requestStructuredJsonPayload) {
      const normalizedFallback = normalizePythonSandboxPlan(fallback, fallback);
      return {
        assistant_message: normalizedFallback.assistant_message,
        summary: normalizedFallback.summary,
        output: normalizedFallback,
        metadata: {
          mode: 'fallback',
          request_type: requestType,
          action: normalizedFallback.action
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      provider: cleanText(metadata?.provider, 80),
      endpoint: cleanText(metadata?.endpoint, 2000),
      apiKey: cleanText(metadata?.apiKey, 400),
      model: cleanText(metadata?.model, 120),
      stage: requestType === 'continue_plan'
        ? 'python_sandbox_sub_agent_continue'
        : 'python_sandbox_sub_agent_repair',
      systemPrompt: cleanText(system_prompt, 12000) || defaultSystemPrompt(),
      userPrompt: cleanText(message, 48000),
      schema: PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA,
      traceContext: metadata?.traceContext || null,
      maxOutputTokens: 2200,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Python sandbox sub-agent planning is not configured.'
    });

    const normalized = normalizePythonSandboxPlan(result?.payload, fallback);
    return {
      assistant_message: normalized.assistant_message,
      summary: normalized.summary,
      output: normalized,
      metadata: {
        mode: result?.ok && result.payload ? 'llm' : 'fallback',
        request_type: requestType,
        action: normalized.action
      }
    };
  };
}

function buildManagedPythonExecutionSummary(baseSummary, state = {}) {
  const summary = cleanText(baseSummary, 320);
  const repairRounds = Math.max(0, Number(state.repair_rounds) || 0);
  const continued = state.continued_from_sub_agent === true;
  const suffixes = [];
  if (continued) {
    suffixes.push(`Continued from Python sandbox sub-agent ${cleanText(state.sub_agent_id, 120) || 'session'}.`);
  }
  if (repairRounds > 0) {
    suffixes.push(`Self-repaired after ${repairRounds} round${repairRounds === 1 ? '' : 's'}.`);
  }
  return [summary, ...suffixes].filter(Boolean).join(' ');
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
    || path.join(os.tmpdir(), 'enana-agent-python-sandbox');
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
        ENANA_SANDBOX_ROOT: sandboxDir,
        ENANA_SANDBOX_OUTPUT_PATH: renderOutputPath
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

function createManagedPythonSandboxRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const runPythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const defaultSandboxRoot = cleanText(deps.sandboxRoot, 1200);
  const defaultPreferredPythonBin = cleanText(deps.preferredPythonBin, 240);
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const buildCreateMessage = typeof deps.buildCreateMessage === 'function'
    ? deps.buildCreateMessage
    : buildManagedPythonCreateMessage;
  const buildDebugMessage = typeof deps.buildDebugMessage === 'function'
    ? deps.buildDebugMessage
    : buildManagedPythonDebugMessage;
  const buildSystemPrompt = typeof deps.buildSystemPrompt === 'function'
    ? deps.buildSystemPrompt
    : buildPythonSandboxSubAgentSystemPrompt;
  const subAgentRuntime = deps.subAgentRuntime && typeof deps.subAgentRuntime.createSubAgent === 'function'
    ? deps.subAgentRuntime
    : createAgentSubAgentRuntime({
      now,
      isProcessAlive: typeof deps.isProcessAlive === 'function' ? deps.isProcessAlive : isProcessAlive,
      getDefaultSystemPrompt: () => buildSystemPrompt(),
      runSubAgentTurn: typeof deps.runSubAgentTurn === 'function'
        ? deps.runSubAgentTurn
        : createManagedPythonSubAgentTurnRuntime({
          requestStructuredJsonPayload,
          buildSystemPrompt
        })
    });

  async function execute(input = {}, options = {}) {
    const source = ensureObject(input);
    const executionOptions = ensureObject(options);
    const requestedAgentId = cleanText(source.sub_agent_id || source.subAgentId, 160);
    const feedback = cleanText(source.feedback || executionOptions.feedback, 40000);
    const originalRequest = cleanText(
      executionOptions.message
      || executionOptions.originalMessage
      || source.message
      || source.request
      || '',
      6000
    );
    const rawMaxRepairAttempts = Object.prototype.hasOwnProperty.call(source, 'max_repair_attempts')
      ? source.max_repair_attempts
      : executionOptions.maxRepairAttempts;
    const maxRepairAttempts = Number.isFinite(Number(rawMaxRepairAttempts))
      ? clamp(Number(rawMaxRepairAttempts), 0, SANDBOX_MAX_REPAIR_ATTEMPTS)
      : SANDBOX_DEFAULT_REPAIR_ATTEMPTS;

    let created = null;
    let inspected = requestedAgentId
      ? subAgentRuntime.getSubAgent({ agent_id: requestedAgentId })
      : null;
    if (requestedAgentId && inspected?.ok !== true) {
      return {
        ok: false,
        sandbox: {
          ok: false,
          status: 'error',
          error: `Python sandbox sub-agent "${requestedAgentId}" was not found.`,
          summary: 'Python sandbox continuation failed before launch.'
        },
        sub_agent: null,
        debug: null,
        sub_agent_id: requestedAgentId,
        repair_rounds: 0,
        continued_from_sub_agent: true,
        summary: 'Python sandbox continuation failed before launch.'
      };
    }

    const storedTaskMetadata = ensureObject(inspected?.agent?.task?.metadata);
    const storedInput = buildStoredPythonSandboxInput(storedTaskMetadata.latest_input);
    const storedResult = buildStoredPythonSandboxResult(storedTaskMetadata.latest_sandbox_result);
    const baseInput = requestedAgentId
      ? mergePythonSandboxInput(storedInput, source)
      : mergePythonSandboxInput({}, source);

    if (!baseInput.code.trim()) {
      return {
        ok: false,
        sandbox: {
          ok: false,
          status: 'error',
          error: 'python-sandbox requires code for a new run or a resumable sub_agent_id with stored code.',
          summary: 'Python sandbox execution failed before launch.'
        },
        sub_agent: inspected?.agent || null,
        debug: null,
        sub_agent_id: requestedAgentId,
        repair_rounds: 0,
        continued_from_sub_agent: Boolean(requestedAgentId),
        summary: 'Python sandbox execution failed before launch.'
      };
    }

    if (!requestedAgentId) {
      created = await subAgentRuntime.createSubAgent({
        name: cleanText(executionOptions.name, 160) || `python-sandbox-${Date.now()}`,
        message: cleanText(buildCreateMessage(baseInput, executionOptions), 40000) || 'Supervise the next Python sandbox execution.',
        metadata: {
          task_type: 'python-sandbox',
          parent_request_id: cleanText(executionOptions.parent_request_id || executionOptions.parentRequestId, 160),
          main_agent_message: originalRequest,
          tags: ['python', 'sandbox', cleanText(baseInput.task_type, 80)].filter(Boolean).slice(0, 12)
        }
      });
      inspected = created?.agent?.id
        ? subAgentRuntime.getSubAgent({ agent_id: created.agent.id })
        : null;
    }

    const agentId = cleanText(requestedAgentId || created?.agent?.id, 160);
    const continuationOriginalRequest = originalRequest
      || cleanText(inspected?.agent?.metadata?.main_agent_message, 6000);
    const continuationInputChanged = requestedAgentId
      ? !pythonSandboxInputsEqual(storedInput, baseInput)
      : false;
    let workingInput = baseInput;
    let latestSandboxResult = storedResult?.run_id
      ? storedResult
      : null;
    let repairRounds = 0;
    let cumulativeRepairRounds = Math.max(0, Number(storedTaskMetadata.total_repair_attempts) || 0);
    let latestTurn = null;
    let returnedStoredResultDirectly = false;
    let shouldRunSandbox = true;
    let syntheticFailureResult = null;

    function buildManagedSandboxFailureResult(errorText, summaryText) {
      return {
        ok: false,
        run_id: '',
        status: 'error',
        error: cleanText(errorText, 4000) || 'Python sandbox continuation failed before another run.',
        timeout_ms: Number(workingInput.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS,
        python_executable: '',
        process_id: null,
        exit_code: null,
        signal: null,
        timed_out: false,
        stdout: '',
        stderr: '',
        files_written: [],
        readback_files: [],
        render_outputs: [],
        warnings: [],
        summary: cleanText(summaryText, 320) || 'Python sandbox continuation failed before another run.'
      };
    }

    async function requestSubAgentPlan(requestType, currentInput, currentResult, attemptNumber = 0) {
      if (!agentId) {
        return null;
      }
      const turn = await subAgentRuntime.sendSubAgentMessage({
        agent_id: agentId,
        message: buildPythonSandboxPlanMessage({
          requestType,
          originalRequest: continuationOriginalRequest,
          currentInput,
          latestResult: currentResult,
          feedback,
          attemptNumber,
          maxRepairAttempts
        }),
        metadata: {
          request_type: requestType,
          provider: cleanText(executionOptions.provider, 80),
          endpoint: cleanText(executionOptions.endpoint, 2000),
          apiKey: cleanText(executionOptions.apiKey, 400),
          model: cleanText(executionOptions.model, 120),
          traceContext: executionOptions.traceContext || null,
          feedback,
          latest_input: buildStoredPythonSandboxInput(currentInput),
          latest_sandbox_result: buildStoredPythonSandboxResult(currentResult),
          attempt_number: attemptNumber,
          max_repair_attempts: maxRepairAttempts,
          total_repair_attempts: cumulativeRepairRounds
        }
      });
      latestTurn = turn;
      return normalizePythonSandboxPlan(turn?.agent?.last_response?.output, {
        action: 'give_up',
        assistant_message: cleanText(turn?.agent?.last_response?.assistant_message, 4000),
        summary: cleanText(turn?.summary, 500)
      });
    }

    async function runManagedAttempt(currentInput) {
      const storedAttemptInput = buildStoredPythonSandboxInput(currentInput);
      return runPythonSandboxFn(currentInput, {
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
                python_task_type: cleanText(currentInput.task_type, 80),
                latest_input: storedAttemptInput,
                latest_feedback: feedback,
                total_repair_attempts: cumulativeRepairRounds,
                main_agent_message: continuationOriginalRequest
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
                stderr_chars: Number(event.stderr_chars) || 0,
                latest_input: storedAttemptInput,
                total_repair_attempts: cumulativeRepairRounds,
                latest_feedback: feedback
              }
            });
          }
        }
      });
    }

    function persistFinalTaskState(currentInput, currentResult) {
      if (!agentId || !currentResult) {
        return;
      }
      const taskUpdater = currentResult.ok === true
        ? subAgentRuntime.completeSubAgentTask
        : subAgentRuntime.failSubAgentTask;
      taskUpdater({
        agent_id: agentId,
        finished_at: now(),
        exit_code: currentResult.exit_code,
        signal: currentResult.signal,
        timed_out: currentResult.timed_out === true,
        summary: cleanText(currentResult.summary || currentResult.error, 240),
        metadata: {
          latest_input: buildStoredPythonSandboxInput(currentInput),
          latest_sandbox_result: buildStoredPythonSandboxResult(currentResult),
          total_repair_attempts: cumulativeRepairRounds,
          latest_feedback: feedback,
          main_agent_message: continuationOriginalRequest
        }
      });
    }

    if (requestedAgentId && feedback) {
      const continuationPlan = await requestSubAgentPlan('continue_plan', workingInput, latestSandboxResult, repairRounds);
      if (continuationPlan?.action === 'return_result' && latestSandboxResult?.run_id) {
        returnedStoredResultDirectly = true;
        shouldRunSandbox = false;
      } else if (continuationPlan?.action === 'rerun') {
        const nextInput = mergePythonSandboxInput(workingInput, continuationPlan);
        if (!pythonSandboxInputsEqual(workingInput, nextInput)) {
          workingInput = nextInput;
        } else {
          shouldRunSandbox = false;
          syntheticFailureResult = buildManagedSandboxFailureResult(
            continuationPlan?.assistant_message,
            continuationPlan?.summary || 'Python sandbox continuation stalled before another run.'
          );
        }
      } else {
        shouldRunSandbox = false;
        syntheticFailureResult = buildManagedSandboxFailureResult(
          continuationPlan?.assistant_message,
          continuationPlan?.summary || 'Python sandbox continuation could not progress.'
        );
      }
    } else if (requestedAgentId && !feedback && !continuationInputChanged && latestSandboxResult?.run_id) {
      returnedStoredResultDirectly = true;
      shouldRunSandbox = false;
    }

    let sandboxResult = latestSandboxResult;
    if (shouldRunSandbox && !returnedStoredResultDirectly) {
      while (true) {
        sandboxResult = await runManagedAttempt(workingInput);
        latestSandboxResult = buildStoredPythonSandboxResult(sandboxResult);
        persistFinalTaskState(workingInput, sandboxResult);

        if (sandboxResult.ok === true) {
          break;
        }

        if (repairRounds >= maxRepairAttempts) {
          if (agentId) {
            latestTurn = await subAgentRuntime.sendSubAgentMessage({
              agent_id: agentId,
              message: buildDebugMessage(workingInput, sandboxResult),
              metadata: {
                debug_payload: buildStoredPythonSandboxResult(sandboxResult)
              }
            });
          }
          break;
        }

        const repairPlan = await requestSubAgentPlan('repair_plan', workingInput, sandboxResult, repairRounds + 1);
        if (!repairPlan || repairPlan.action !== 'rerun') {
          break;
        }

        const nextInput = mergePythonSandboxInput(workingInput, repairPlan);
        if (pythonSandboxInputsEqual(workingInput, nextInput)) {
          break;
        }

        workingInput = nextInput;
        repairRounds += 1;
        cumulativeRepairRounds += 1;
      }
    } else if (returnedStoredResultDirectly && latestSandboxResult) {
      sandboxResult = latestSandboxResult;
      persistFinalTaskState(workingInput, sandboxResult);
    } else {
      sandboxResult = syntheticFailureResult
        || latestSandboxResult
        || buildManagedSandboxFailureResult(
          cleanText(latestTurn?.agent?.last_response?.assistant_message, 4000),
          cleanText(latestTurn?.summary, 320) || 'Python sandbox continuation failed before another run.'
        );
      latestSandboxResult = buildStoredPythonSandboxResult(sandboxResult);
      persistFinalTaskState(workingInput, sandboxResult);
    }

    const finalInspection = agentId ? subAgentRuntime.getSubAgent({ agent_id: agentId }) : null;
    const agent = finalInspection?.ok === true
      ? finalInspection.agent
      : (created?.agent || inspected?.agent || null);
    const debug = latestTurn?.agent?.last_response
      ? cloneJson(latestTurn.agent.last_response, null)
      : (sandboxResult?.ok === true && !returnedStoredResultDirectly
        ? null
        : cloneJson(agent?.last_response, null));
    const summary = buildManagedPythonExecutionSummary(
      cleanText(sandboxResult?.summary, 320)
        || (sandboxResult?.ok ? 'Python sandbox execution completed.' : 'Python sandbox execution failed.'),
      {
        repair_rounds: repairRounds,
        continued_from_sub_agent: Boolean(requestedAgentId),
        sub_agent_id: agentId
      }
    );

    return {
      ok: sandboxResult?.ok === true,
      sandbox: sandboxResult,
      sub_agent: agent,
      debug,
      sub_agent_id: agentId,
      repair_rounds: repairRounds,
      continued_from_sub_agent: Boolean(requestedAgentId),
      summary
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
