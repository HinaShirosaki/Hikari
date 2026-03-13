'use strict';

const {
  asArray,
  cleanText,
  clamp,
  normalizeRelativePath
} = require('./agent-python-common');

const DEFAULT_TIMEOUT_MS = 6000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;
const MAX_CODE_CHARS = 60000;
const MAX_FILE_COUNT = 10;
const MAX_FILE_CHARS = 40000;
const MAX_READBACK_COUNT = 8;
const MAX_ARTIFACT_COUNT = 8;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyForPrompt(value, maxLength = 20000) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}...`;
  } catch {
    return '{}';
  }
}

function buildPythonCodegenPrompt({
  message,
  taskType = 'general_compute',
  taskContext = {}
}) {
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const userMessage = cleanText(message, 6000);
  const contextBlock = stringifyForPrompt(taskContext, 22000);
  return [
    'You are generating a JSON request for the run_python_sandbox tool.',
    'Write all Python code from scratch based on the task context. Do not use templates or placeholders.',
    'Return JSON only.',
    '',
    'Required output schema:',
    '{',
    '  "code": "string (required, runnable Python)",',
    '  "files": [{"path":"string","content":"string"}],',
    '  "timeout_ms": 6000,',
    '  "readback_paths": ["string"],',
    '  "artifact_paths": ["string"],',
    '  "persist_artifacts": true,',
    '  "task_type": "string"',
    '}',
    '',
    'Rules:',
    '- Use relative file paths only; no absolute paths and no path traversal.',
    '- Keep code concise, deterministic, and robust to missing/empty input files.',
    '- Ensure readback_paths/artifact_paths refer to files actually written by your code when possible.',
    '- Prefer standard library modules unless clearly necessary.',
    '- Never include markdown fences or extra commentary.',
    '',
    `Task type: ${normalizedTaskType}`,
    `User message: ${userMessage || '-'}`,
    `Task context JSON:\n${contextBlock}`,
    '',
    'Return JSON only.'
  ].join('\n');
}

function parseJsonObject(rawValue) {
  if (isObject(rawValue)) {
    return {
      ok: true,
      value: rawValue
    };
  }
  if (typeof rawValue !== 'string') {
    return {
      ok: false,
      reason: 'malformed_json',
      error: 'Python codegen output must be JSON text.'
    };
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!isObject(parsed)) {
      return {
        ok: false,
        reason: 'malformed_json',
        error: 'Python codegen output must be a JSON object.'
      };
    }
    return {
      ok: true,
      value: parsed
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'malformed_json',
      error: cleanText(error?.message || error, 240) || 'Malformed JSON from Python codegen.'
    };
  }
}

function pickWithDefault(primary, fallback) {
  return primary === undefined ? fallback : primary;
}

function sanitizePathList(rawList, maxCount, fieldLabel) {
  const output = [];
  const values = asArray(rawList).slice(0, maxCount);
  for (let index = 0; index < values.length; index += 1) {
    const normalized = normalizeRelativePath(values[index]);
    if (!normalized) {
      return {
        ok: false,
        reason: 'unsafe_path',
        error: `${fieldLabel}[${index}] contains an invalid or unsafe path.`
      };
    }
    output.push(normalized);
  }
  return {
    ok: true,
    value: output
  };
}

function sanitizeFiles(rawFiles) {
  const output = [];
  const files = asArray(rawFiles).slice(0, MAX_FILE_COUNT);
  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    if (!isObject(entry)) {
      return {
        ok: false,
        reason: 'malformed_json',
        error: `files[${index}] must be an object with path/content.`
      };
    }
    const filePath = normalizeRelativePath(entry.path);
    if (!filePath) {
      return {
        ok: false,
        reason: 'unsafe_path',
        error: `files[${index}].path is invalid or unsafe.`
      };
    }
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (content.length > MAX_FILE_CHARS) {
      return {
        ok: false,
        reason: 'file_too_large',
        error: `files[${index}] exceeds ${MAX_FILE_CHARS} characters.`
      };
    }
    output.push({
      path: filePath,
      content
    });
  }
  return {
    ok: true,
    value: output
  };
}

function sanitizePythonRunRequest(rawValue, {
  taskType = 'general_compute',
  defaults = {}
} = {}) {
  const parsedResult = parseJsonObject(rawValue);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  const parsed = parsedResult.value;
  const defaultValues = isObject(defaults) ? defaults : {};
  const warnings = [];

  const codeSource = pickWithDefault(parsed.code, defaultValues.code);
  const code = typeof codeSource === 'string' ? codeSource.trim() : '';
  if (!code) {
    return {
      ok: false,
      reason: 'missing_code',
      error: 'Python codegen output is missing required "code".'
    };
  }
  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      reason: 'code_too_large',
      error: `Python code exceeds ${MAX_CODE_CHARS} characters.`
    };
  }

  const filesResult = sanitizeFiles(pickWithDefault(parsed.files, defaultValues.files));
  if (!filesResult.ok) {
    return filesResult;
  }
  if (asArray(pickWithDefault(parsed.files, defaultValues.files)).length > MAX_FILE_COUNT) {
    warnings.push(`files exceeded ${MAX_FILE_COUNT}; extra entries were ignored.`);
  }

  const readbackResult = sanitizePathList(
    pickWithDefault(parsed.readback_paths, defaultValues.readback_paths),
    MAX_READBACK_COUNT,
    'readback_paths'
  );
  if (!readbackResult.ok) {
    return readbackResult;
  }
  if (asArray(pickWithDefault(parsed.readback_paths, defaultValues.readback_paths)).length > MAX_READBACK_COUNT) {
    warnings.push(`readback_paths exceeded ${MAX_READBACK_COUNT}; extra entries were ignored.`);
  }

  const artifactResult = sanitizePathList(
    pickWithDefault(parsed.artifact_paths, defaultValues.artifact_paths),
    MAX_ARTIFACT_COUNT,
    'artifact_paths'
  );
  if (!artifactResult.ok) {
    return artifactResult;
  }
  if (asArray(pickWithDefault(parsed.artifact_paths, defaultValues.artifact_paths)).length > MAX_ARTIFACT_COUNT) {
    warnings.push(`artifact_paths exceeded ${MAX_ARTIFACT_COUNT}; extra entries were ignored.`);
  }

  const timeoutRaw = Number(pickWithDefault(parsed.timeout_ms, defaultValues.timeout_ms));
  const timeoutMs = clamp(
    Number.isFinite(timeoutRaw) ? timeoutRaw : DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  if (Number.isFinite(timeoutRaw) && timeoutRaw !== timeoutMs) {
    warnings.push(`timeout_ms was clamped to ${timeoutMs}.`);
  }

  const persistArtifacts = pickWithDefault(parsed.persist_artifacts, defaultValues.persist_artifacts) === true;
  const normalizedTaskType = cleanText(pickWithDefault(parsed.task_type, defaultValues.task_type), 80)
    || cleanText(taskType, 80)
    || 'general_compute';

  return {
    ok: true,
    reason: 'sanitized',
    warnings,
    run_request: {
      code,
      files: filesResult.value,
      timeout_ms: timeoutMs,
      readback_paths: readbackResult.value,
      artifact_paths: artifactResult.value,
      persist_artifacts: persistArtifacts,
      task_type: normalizedTaskType
    }
  };
}

module.exports = {
  buildPythonCodegenPrompt,
  sanitizePythonRunRequest
};
