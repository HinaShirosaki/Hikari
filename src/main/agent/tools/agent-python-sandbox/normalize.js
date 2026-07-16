'use strict';

const {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MIN_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_MAX_READBACK_FILES,
  SANDBOX_MAX_INPUT_FILES,
  SANDBOX_MAX_RENDER_OUTPUTS,
  SANDBOX_MAX_RENDER_TEXT_CHARS,
  SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS,
  SANDBOX_ALLOWED_IMAGE_MIME_TYPES
} = require('./constants.js');
const {
  asArray,
  ensureObject,
  cloneJson,
  cleanText,
  clamp,
  normalizeRelativePath,
  truncateText,
  inferImageMimeType
} = require('./utils.js');

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
    .map((entry) => {
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

module.exports = {
  normalizeRenderOutputTextContent,
  normalizePythonSandboxRenderOutputs,
  normalizePythonSandboxFiles,
  normalizePythonSandboxReadbackPaths,
  normalizePythonSandboxInput,
  buildStoredPythonSandboxInput,
  summarizeRenderOutputForPrompt,
  buildStoredPythonSandboxResult,
  mergePythonSandboxInput,
  pythonSandboxInputsEqual
};
