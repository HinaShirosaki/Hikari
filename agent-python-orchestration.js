'use strict';

const { persistPythonArtifacts } = require('./agent-python-artifacts');
const { asArray, cleanText } = require('./agent-python-common');

const DEFAULT_TIMEOUT_MS = 6000;
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
    timeout_ms: DEFAULT_TIMEOUT_MS,
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
      timeout_ms: Number(base.timeout_ms) || DEFAULT_TIMEOUT_MS
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

module.exports = {
  classifyPythonTask,
  buildPythonRunRequest,
  validatePythonResult,
  persistPythonArtifacts,
  buildPythonClarificationQuestion
};
