'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 500) {
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

function normalizeRelativePath(value, fallback = '') {
  const candidate = String(value || fallback || '').replace(/\\/g, '/').trim();
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

function sanitizeFileName(value, fallback = 'artifact.txt') {
  const text = cleanText(value, 180)
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback;
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Artifact target must be inside storage root.');
  }
  return resolvedTarget;
}

function mapContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'text/csv';
  }
  if (lower.endsWith('.tsv')) {
    return 'text/tab-separated-values';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}

async function persistPythonArtifacts({ sandboxItem, storagePath, projectName = '' }) {
  const normalizedStoragePath = cleanText(storagePath, 1200);
  if (!normalizedStoragePath) {
    return {
      applied: false,
      artifact_count: 0,
      result_files: [],
      result_file_records: [],
      citations: [],
      summary: 'Python artifact persistence skipped: storage path was not configured.'
    };
  }

  const source = sandboxItem && typeof sandboxItem === 'object' ? sandboxItem : {};
  const runId = sanitizeFileName(cleanText(source.run_id, 120), 'python_run');
  const readbackFiles = asArray(source.readback_files).map((entry) => ({
    relative_path: normalizeRelativePath(entry?.path),
    content: cleanText(entry?.content, 20000),
    truncated: entry?.truncated === true
  })).filter((entry) => entry.relative_path);

  if (!readbackFiles.length) {
    return {
      applied: false,
      artifact_count: 0,
      result_files: [],
      result_file_records: [],
      citations: [],
      summary: 'Python artifact persistence skipped: no readback files were produced.'
    };
  }

  const projectFolder = sanitizeFileName(projectName, 'unscoped_project');
  const artifactFolder = ensurePathInsideRoot(
    normalizedStoragePath,
    path.join(normalizedStoragePath, 'Agent', 'Python', projectFolder)
  );
  await fs.mkdir(artifactFolder, { recursive: true });

  const resultFiles = [];
  const resultFileRecords = [];
  const citations = [];

  for (let index = 0; index < readbackFiles.length; index += 1) {
    const file = readbackFiles[index];
    const baseName = sanitizeFileName(path.basename(file.relative_path), `artifact_${index + 1}.txt`);
    const uniqueName = sanitizeFileName(`${runId}_${index + 1}_${baseName}`, `artifact_${index + 1}.txt`);
    const absolutePath = ensurePathInsideRoot(artifactFolder, path.join(artifactFolder, uniqueName));
    await fs.writeFile(absolutePath, file.content, 'utf8');

    const relativePath = path.relative(normalizedStoragePath, absolutePath).split(path.sep).join('/');
    const sizeBytes = Buffer.byteLength(file.content, 'utf8');
    const contentType = mapContentType(uniqueName);
    resultFiles.push(uniqueName);
    resultFileRecords.push({
      kind: 'python_artifact',
      name: uniqueName,
      relativePath,
      filePath: absolutePath,
      sizeBytes,
      contentType,
      sourcePath: file.relative_path,
      truncated: file.truncated
    });
    citations.push({
      source: 'python_artifact',
      pointer: relativePath,
      reason: 'Persisted deterministic Python sandbox readback artifact.'
    });
  }

  return {
    applied: true,
    artifact_count: resultFileRecords.length,
    result_files: resultFiles,
    result_file_records: resultFileRecords,
    citations,
    summary: `Persisted ${resultFileRecords.length} Python artifact file(s).`
  };
}

const CODEGEN_DEFAULT_TIMEOUT_MS = 6000;
const CODEGEN_MIN_TIMEOUT_MS = 500;
const CODEGEN_MAX_TIMEOUT_MS = 15000;
const CODEGEN_MAX_CODE_CHARS = 60000;
const CODEGEN_MAX_FILE_COUNT = 10;
const CODEGEN_MAX_FILE_CHARS = 40000;
const CODEGEN_MAX_READBACK_COUNT = 8;
const CODEGEN_MAX_ARTIFACT_COUNT = 8;

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
  const files = asArray(rawFiles).slice(0, CODEGEN_MAX_FILE_COUNT);
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
    if (content.length > CODEGEN_MAX_FILE_CHARS) {
      return {
        ok: false,
        reason: 'file_too_large',
        error: `files[${index}] exceeds ${CODEGEN_MAX_FILE_CHARS} characters.`
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
  if (code.length > CODEGEN_MAX_CODE_CHARS) {
    return {
      ok: false,
      reason: 'code_too_large',
      error: `Python code exceeds ${CODEGEN_MAX_CODE_CHARS} characters.`
    };
  }

  const filesResult = sanitizeFiles(pickWithDefault(parsed.files, defaultValues.files));
  if (!filesResult.ok) {
    return filesResult;
  }
  if (asArray(pickWithDefault(parsed.files, defaultValues.files)).length > CODEGEN_MAX_FILE_COUNT) {
    warnings.push(`files exceeded ${CODEGEN_MAX_FILE_COUNT}; extra entries were ignored.`);
  }

  const readbackResult = sanitizePathList(
    pickWithDefault(parsed.readback_paths, defaultValues.readback_paths),
    CODEGEN_MAX_READBACK_COUNT,
    'readback_paths'
  );
  if (!readbackResult.ok) {
    return readbackResult;
  }
  if (asArray(pickWithDefault(parsed.readback_paths, defaultValues.readback_paths)).length > CODEGEN_MAX_READBACK_COUNT) {
    warnings.push(`readback_paths exceeded ${CODEGEN_MAX_READBACK_COUNT}; extra entries were ignored.`);
  }

  const artifactResult = sanitizePathList(
    pickWithDefault(parsed.artifact_paths, defaultValues.artifact_paths),
    CODEGEN_MAX_ARTIFACT_COUNT,
    'artifact_paths'
  );
  if (!artifactResult.ok) {
    return artifactResult;
  }
  if (asArray(pickWithDefault(parsed.artifact_paths, defaultValues.artifact_paths)).length > CODEGEN_MAX_ARTIFACT_COUNT) {
    warnings.push(`artifact_paths exceeded ${CODEGEN_MAX_ARTIFACT_COUNT}; extra entries were ignored.`);
  }

  const timeoutRaw = Number(pickWithDefault(parsed.timeout_ms, defaultValues.timeout_ms));
  const timeoutMs = clamp(
    Number.isFinite(timeoutRaw) ? timeoutRaw : CODEGEN_DEFAULT_TIMEOUT_MS,
    CODEGEN_MIN_TIMEOUT_MS,
    CODEGEN_MAX_TIMEOUT_MS
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

const ORCH_DEFAULT_TIMEOUT_MS = 6000;
const MAX_MESSAGE_CHARS = 6000;
const MAX_QUERY_CHARS = 260;

function includesAny(text, keywords) {
  const source = String(text || '').toLowerCase();
  return asArray(keywords).some((keyword) => source.includes(String(keyword || '').toLowerCase()));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, columns) {
  const normalizedRows = asArray(rows);
  const normalizedColumns = asArray(columns).map((column) => cleanText(column, 80)).filter(Boolean);
  if (!normalizedRows.length || !normalizedColumns.length) {
    return '';
  }
  const lines = [normalizedColumns.map((column) => csvEscape(column)).join(',')];
  normalizedRows.forEach((row) => {
    const source = row && typeof row === 'object' ? row : {};
    lines.push(normalizedColumns.map((column) => csvEscape(source[column])).join(','));
  });
  return lines.join('\n');
}

function classifyPythonTask({ message, entities, routing }) {
  const text = cleanText(message, MAX_MESSAGE_CHARS).toLowerCase();
  const entityText = [
    cleanText(entities?.activity, 220),
    cleanText(entities?.protein, 140),
    cleanText(entities?.compound, 140),
    cleanText(entities?.workflow_step, 220)
  ].join(' ').toLowerCase();
  const combined = `${text} ${entityText}`.trim();
  const routeIntent = cleanText(routing?.intent, 80);
  const needsPython = routing?.plan?.needs_python === true
    || routeIntent === 'coding_data_analysis'
    || routeIntent === 'data_analysis_or_coding';

  let taskType = 'general_compute';
  let reason = 'fallback_compute';

  if (includesAny(combined, ['csv', 'tsv', 'spreadsheet', 'table', 'parse file', 'descriptive stats', 'mean', 'median'])) {
    taskType = 'csv_tsv_descriptive';
    reason = 'tabular_stats_keywords';
  } else if (includesAny(combined, ['growth curve', 'od600', 'log phase', 'doubling time'])) {
    taskType = 'growth_curve_plot';
    reason = 'growth_curve_keywords';
  } else if (includesAny(combined, ['elisa', 'ic50', 'ec50', 'dose response', '4pl', 'standard curve'])) {
    taskType = 'elisa_curve_analysis';
    reason = 'elisa_curve_keywords';
  } else if (includesAny(combined, ['sequence', 'gc content', 'isoelectric', 'pi', 'molecular weight', 'mw'])) {
    taskType = 'sequence_property_analysis';
    reason = 'sequence_keywords';
  } else if (includesAny(combined, ['json cleanup', 'normalize json', 'transform json', 'format json', 'schema cleanup'])) {
    taskType = 'json_cleanup';
    reason = 'json_cleanup_keywords';
  } else if (needsPython) {
    taskType = 'general_compute';
    reason = 'routing_python';
  }

  return {
    task_type: taskType,
    reason
  };
}

function extractSequenceFromMessage(message) {
  const source = cleanText(message, MAX_MESSAGE_CHARS);
  const dnaMatch = source.match(/\b([ACGTU]{12,})\b/i);
  if (dnaMatch) {
    return {
      sequence: dnaMatch[1].toUpperCase().replace(/U/g, 'T'),
      sequence_type: 'DNA'
    };
  }
  const aaMatch = source.match(/\b([ACDEFGHIKLMNPQRSTVWY]{10,})\b/i);
  if (aaMatch) {
    return {
      sequence: aaMatch[1].toUpperCase(),
      sequence_type: 'PROTEIN'
    };
  }
  return {
    sequence: '',
    sequence_type: ''
  };
}

function pickTabularRows(snapshot, projectId = '') {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const normalizedProjectId = cleanText(projectId, 80);

  const assayRows = asArray(source.assays).filter((assay) => {
    const assayProjectId = cleanText(assay?.project_id || assay?.projectId, 80);
    if (!normalizedProjectId || !assayProjectId) {
      return true;
    }
    return assayProjectId === normalizedProjectId;
  }).slice(0, 40).map((assay, index) => ({
    row_id: `assay_${index + 1}`,
    record_id: cleanText(assay?.id, 80),
    name: cleanText(assay?.name || assay?.assay_number, 180),
    numeric_count: Number(assay?.numeric_count) || 0,
    result_well_count: Number(assay?.result_well_count) || 0
  }));
  if (assayRows.length) {
    return {
      rows: assayRows,
      columns: ['row_id', 'record_id', 'name', 'numeric_count', 'result_well_count'],
      source: 'assays'
    };
  }

  const gelRows = asArray(source.gelAnalyses).filter((analysis) => {
    const analysisProjectId = cleanText(analysis?.project_id || analysis?.projectId, 80);
    if (!normalizedProjectId || !analysisProjectId) {
      return true;
    }
    return analysisProjectId === normalizedProjectId;
  }).slice(0, 40).map((analysis, index) => ({
    row_id: `gel_${index + 1}`,
    record_id: cleanText(analysis?.id, 80),
    name: cleanText(analysis?.name, 180),
    lane_count: Number(analysis?.lane_count) || 0,
    band_count: Number(analysis?.band_count) || 0,
    confidence_score: Number(analysis?.confidence_score) || 0
  }));
  if (gelRows.length) {
    return {
      rows: gelRows,
      columns: ['row_id', 'record_id', 'name', 'lane_count', 'band_count', 'confidence_score'],
      source: 'gel_analyses'
    };
  }

  return {
    rows: [],
    columns: [],
    source: ''
  };
}

function buildPythonClarificationQuestion({ reason, taskType }) {
  const normalizedReason = cleanText(reason, 120);
  const normalizedTask = cleanText(taskType, 80);

  if (normalizedReason === 'missing_tabular_input') {
    return 'I can run Python analysis once tabular input is available. Please provide CSV/TSV data or link the target assay/gel records.';
  }
  if (normalizedReason === 'missing_sequence_input') {
    return 'Please provide the DNA/RNA/protein sequence text so I can run sequence-property analysis in Python.';
  }
  if (normalizedReason === 'missing_json_input') {
    return 'Please provide the JSON payload that should be cleaned/normalized.';
  }
  if (normalizedReason === 'python_codegen_invalid') {
    return 'I could not prepare a valid Python sandbox run request. Please clarify the exact computation and required output files.';
  }
  if (normalizedTask === 'growth_curve_plot') {
    return 'Please provide growth time-series values (time and signal/OD) so I can generate growth-curve artifacts.';
  }
  return 'Please provide the exact input dataset or payload required for this Python analysis task.';
}

function buildRunRequestBase({
  taskType,
  csv = '',
  sequence = '',
  jsonPayload = ''
}) {
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const base = {
    files: [],
    timeout_ms: ORCH_DEFAULT_TIMEOUT_MS,
    readback_paths: [],
    artifact_paths: [],
    persist_artifacts: true,
    task_type: normalizedTaskType
  };

  if (normalizedTaskType === 'csv_tsv_descriptive') {
    return {
      ...base,
      files: csv ? [{ path: 'input.csv', content: csv }] : [],
      readback_paths: ['analysis.json', 'summary.txt'],
      artifact_paths: ['analysis.json', 'summary.txt']
    };
  }

  if (normalizedTaskType === 'growth_curve_plot') {
    return {
      ...base,
      files: csv ? [{ path: 'input.csv', content: csv }] : [],
      readback_paths: ['growth_curve_points.csv', 'growth_curve_summary.json'],
      artifact_paths: ['growth_curve_points.csv', 'growth_curve_summary.json']
    };
  }

  if (normalizedTaskType === 'elisa_curve_analysis') {
    return {
      ...base,
      files: csv ? [{ path: 'input.csv', content: csv }] : [],
      readback_paths: ['elisa_analysis.json', 'elisa_ranked.csv'],
      artifact_paths: ['elisa_analysis.json', 'elisa_ranked.csv']
    };
  }

  if (normalizedTaskType === 'sequence_property_analysis') {
    return {
      ...base,
      files: sequence ? [{ path: 'sequence.txt', content: sequence }] : [],
      readback_paths: ['sequence_analysis.json'],
      artifact_paths: ['sequence_analysis.json']
    };
  }

  if (normalizedTaskType === 'json_cleanup') {
    return {
      ...base,
      files: jsonPayload ? [{ path: 'input.json', content: jsonPayload }] : [],
      readback_paths: ['normalized.json'],
      artifact_paths: ['normalized.json']
    };
  }

  return {
    ...base,
    readback_paths: ['summary.json'],
    artifact_paths: ['summary.json']
  };
}

function buildCodegenContext({
  message,
  projectId,
  projectName,
  taskType,
  taskReason,
  tabular = { rows: [], columns: [], source: '' },
  sequencePayload = { sequence: '', sequence_type: '' },
  jsonPayloadObject = null,
  runRequestBase = null
}) {
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const normalizedReason = cleanText(taskReason, 120) || 'routing_python';
  const base = runRequestBase && typeof runRequestBase === 'object' ? runRequestBase : {};
  const files = asArray(base.files).map((file) => ({
    path: cleanText(file?.path, 160),
    content: String(file?.content || '')
  })).filter((file) => file.path);

  const context = {
    task_type: normalizedTaskType,
    task_reason: normalizedReason,
    user_message: cleanText(message, MAX_MESSAGE_CHARS),
    project: {
      id: cleanText(projectId, 80),
      name: cleanText(projectName, 180)
    },
    input_files: files,
    desired_output: {
      readback_paths: asArray(base.readback_paths).map((item) => cleanText(item, 180)).filter(Boolean),
      artifact_paths: asArray(base.artifact_paths).map((item) => cleanText(item, 180)).filter(Boolean),
      persist_artifacts: base.persist_artifacts === true,
      timeout_ms: Number(base.timeout_ms) || ORCH_DEFAULT_TIMEOUT_MS
    },
    tabular_preview: {
      source: cleanText(tabular?.source, 80),
      columns: asArray(tabular?.columns).map((col) => cleanText(col, 80)).filter(Boolean),
      rows: asArray(tabular?.rows).slice(0, 20)
    },
    sequence_input: sequencePayload?.sequence
      ? {
        sequence_type: cleanText(sequencePayload.sequence_type, 20),
        length: String(sequencePayload.sequence || '').length,
        sequence_text: sequencePayload.sequence
      }
      : null,
    json_input: jsonPayloadObject && typeof jsonPayloadObject === 'object'
      ? jsonPayloadObject
      : null
  };

  return context;
}

function buildRunSpec({
  ready = false,
  taskType,
  reason,
  runRequestBase = null,
  codegenContext = null
}) {
  const isReady = ready === true;
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const normalizedReason = cleanText(reason, 120) || (isReady ? '' : 'python_input_missing');
  return {
    ready: isReady,
    needs_clarification: !isReady,
    reason: normalizedReason,
    task_type: normalizedTaskType,
    clarification_question: isReady
      ? ''
      : buildPythonClarificationQuestion({
        reason: normalizedReason,
        taskType: normalizedTaskType
      }),
    run_request_base: isReady && runRequestBase && typeof runRequestBase === 'object'
      ? runRequestBase
      : null,
    codegen_context: isReady && codegenContext && typeof codegenContext === 'object'
      ? codegenContext
      : null
  };
}

function buildTabularTaskRunSpec({
  message,
  projectId,
  projectName,
  taskType,
  tabular,
  requireRows = false,
  missingWhenExplicit = false
}) {
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const tabularRows = asArray(tabular?.rows);
  if (!tabularRows.length && (requireRows || missingWhenExplicit)) {
    return buildRunSpec({
      ready: false,
      taskType: normalizedTaskType,
      reason: 'missing_tabular_input'
    });
  }

  const csv = rowsToCsv(tabularRows, asArray(tabular?.columns));
  const runReason = tabularRows.length ? `using_${cleanText(tabular?.source, 80)}` : 'using_empty_default';
  const runRequestBase = buildRunRequestBase({
    taskType: normalizedTaskType,
    csv
  });
  return buildRunSpec({
    ready: true,
    taskType: normalizedTaskType,
    reason: runReason,
    runRequestBase,
    codegenContext: buildCodegenContext({
      message,
      projectId,
      projectName,
      taskType: normalizedTaskType,
      taskReason: runReason,
      tabular,
      runRequestBase
    })
  });
}

function buildPythonRunRequest({
  message,
  snapshot,
  projectId = '',
  projectName = '',
  taskType = 'general_compute'
}) {
  const normalizedTaskType = cleanText(taskType, 80) || 'general_compute';
  const normalizedMessage = cleanText(message, MAX_MESSAGE_CHARS);
  const tabular = pickTabularRows(snapshot, projectId);
  const explicitTabularRequest = includesAny(normalizedMessage, ['csv', 'tsv', 'table', 'spreadsheet', 'attached file', '.csv', '.tsv']);

  if (normalizedTaskType === 'csv_tsv_descriptive') {
    return buildTabularTaskRunSpec({
      message,
      projectId,
      projectName,
      taskType: normalizedTaskType,
      tabular,
      requireRows: false,
      missingWhenExplicit: explicitTabularRequest
    });
  }

  if (normalizedTaskType === 'growth_curve_plot') {
    return buildTabularTaskRunSpec({
      message,
      projectId,
      projectName,
      taskType: normalizedTaskType,
      tabular,
      requireRows: true,
      missingWhenExplicit: false
    });
  }

  if (normalizedTaskType === 'elisa_curve_analysis') {
    return buildTabularTaskRunSpec({
      message,
      projectId,
      projectName,
      taskType: normalizedTaskType,
      tabular,
      requireRows: true,
      missingWhenExplicit: false
    });
  }

  if (normalizedTaskType === 'sequence_property_analysis') {
    const sequencePayload = extractSequenceFromMessage(normalizedMessage);
    if (!sequencePayload.sequence) {
      return buildRunSpec({
        ready: false,
        taskType: normalizedTaskType,
        reason: 'missing_sequence_input'
      });
    }

    const runRequestBase = buildRunRequestBase({
      taskType: normalizedTaskType,
      sequence: sequencePayload.sequence
    });
    return buildRunSpec({
      ready: true,
      taskType: normalizedTaskType,
      reason: 'sequence_from_message',
      runRequestBase,
      codegenContext: buildCodegenContext({
        message,
        projectId,
        projectName,
        taskType: normalizedTaskType,
        taskReason: 'sequence_from_message',
        sequencePayload,
        runRequestBase
      })
    });
  }

  if (normalizedTaskType === 'json_cleanup') {
    const normalizedSnapshot = snapshot && typeof snapshot === 'object'
      ? snapshot
      : {};
    const payloadObject = {
      project_id: cleanText(projectId, 80),
      project_name: cleanText(projectName, 180),
      message: cleanText(message, MAX_QUERY_CHARS),
      routing_intent: cleanText(normalizedSnapshot?.routing?.intent, 80)
    };
    const runRequestBase = buildRunRequestBase({
      taskType: normalizedTaskType,
      jsonPayload: JSON.stringify(payloadObject, null, 2)
    });
    return buildRunSpec({
      ready: true,
      taskType: normalizedTaskType,
      reason: 'json_cleanup_context',
      runRequestBase,
      codegenContext: buildCodegenContext({
        message,
        projectId,
        projectName,
        taskType: normalizedTaskType,
        taskReason: 'json_cleanup_context',
        jsonPayloadObject: payloadObject,
        runRequestBase
      })
    });
  }

  const runRequestBase = buildRunRequestBase({ taskType: normalizedTaskType });
  return buildRunSpec({
    ready: true,
    taskType: normalizedTaskType,
    reason: 'general_compute_context',
    runRequestBase,
    codegenContext: buildCodegenContext({
      message,
      projectId,
      projectName,
      taskType: normalizedTaskType,
      taskReason: 'general_compute_context',
      runRequestBase
    })
  });
}

function validatePythonResult({ result }) {
  const source = result && typeof result === 'object' ? result : {};
  const item = asArray(source.items)[0] && typeof asArray(source.items)[0] === 'object'
    ? asArray(source.items)[0]
    : {};
  const status = cleanText(item.status, 40).toLowerCase();
  const ok = source.ok === true && status === 'ok';
  const readbackFiles = asArray(item.readback_files).map((entry) => ({
    path: cleanText(entry?.path, 260),
    content: cleanText(entry?.content, 20000),
    truncated: entry?.truncated === true
  })).filter((entry) => entry.path);
  const warnings = asArray(item.warnings).map((entry) => cleanText(entry, 220)).filter(Boolean);
  const stderr = cleanText(item.stderr, 4000);
  const error = ok ? '' : cleanText(source.error || stderr || 'Python execution failed.', 500);

  return {
    ok,
    status: cleanText(item.status, 40) || (ok ? 'ok' : 'error'),
    error,
    item,
    readback_files: readbackFiles,
    warnings,
    summary: cleanText(source.summary, 320) || (ok ? 'Python run completed.' : 'Python run failed.')
  };
}

const SANDBOX_DEFAULT_TIMEOUT_MS = 8000;
const SANDBOX_MIN_TIMEOUT_MS = 500;
const SANDBOX_MAX_TIMEOUT_MS = 15000;
const SANDBOX_MAX_CODE_CHARS = 60000;
const SANDBOX_MAX_FILE_COUNT = 10;
const SANDBOX_MAX_FILE_CHARS = 40000;
const SANDBOX_MAX_READBACK_COUNT = 8;
const SANDBOX_MAX_READBACK_CHARS = 20000;
const SANDBOX_MAX_OUTPUT_BUFFER_BYTES = 160 * 1024;
const SANDBOX_MAX_STDIO_CHARS = 12000;

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
      timeout_ms: clamp(SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS),
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

  if (code.length > SANDBOX_MAX_CODE_CHARS) {
    return {
      ok: false,
      run_id: '',
      status: 'error',
      error: `Python code exceeds ${SANDBOX_MAX_CODE_CHARS} characters.`,
      timeout_ms: clamp(SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS),
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
    Number(payload.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS,
    SANDBOX_MIN_TIMEOUT_MS,
    SANDBOX_MAX_TIMEOUT_MS
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

    const extraFiles = Array.isArray(payload.files) ? payload.files.slice(0, SANDBOX_MAX_FILE_COUNT) : [];
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
      if (content.length > SANDBOX_MAX_FILE_CHARS) {
        warnings.push(`Skipped ${relativePath}: content exceeds ${SANDBOX_MAX_FILE_CHARS} characters.`);
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
          maxBuffer: SANDBOX_MAX_OUTPUT_BUFFER_BYTES
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

    const stdout = truncateText(rawStdout, SANDBOX_MAX_STDIO_CHARS);
    const stderr = truncateText(rawStderr, SANDBOX_MAX_STDIO_CHARS);
    if (stdout.truncated) {
      warnings.push('Stdout was truncated.');
    }
    if (stderr.truncated) {
      warnings.push('Stderr was truncated.');
    }

    const readbackFiles = [];
    const readbackPaths = Array.isArray(payload.readback_paths)
      ? payload.readback_paths.slice(0, SANDBOX_MAX_READBACK_COUNT)
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
        const limited = truncateText(content, SANDBOX_MAX_READBACK_CHARS);
        if (limited.truncated) {
          warnings.push(`Readback ${relativePath} was truncated to ${SANDBOX_MAX_READBACK_CHARS} chars.`);
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
  asArray,
  cleanText,
  clamp,
  normalizeRelativePath,
  persistPythonArtifacts,
  buildPythonCodegenPrompt,
  sanitizePythonRunRequest,
  classifyPythonTask,
  buildPythonRunRequest,
  validatePythonResult,
  buildPythonClarificationQuestion,
  runPythonSandbox
};
