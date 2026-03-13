'use strict';

const {
  classifyPythonTask,
  buildPythonRunRequest,
  buildPythonClarificationQuestion,
  validatePythonResult,
  persistPythonArtifacts
} = require('./agent-python-orchestration');
const { sanitizePythonRunRequest } = require('./agent-python-codegen');
const {
  shouldRunWebFallback,
  buildWebQueries,
  searchWebResults,
  mergeAndRankWebEvidence,
  buildWebFallbackSummary
} = require('./agent-web-fallback');

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

function cleanNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceDomain(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return cleanText(parsed.hostname, 160).toLowerCase();
  } catch {
    return '';
  }
}

function uniqueCitations(citations) {
  const seen = new Set();
  const out = [];
  asArray(citations).forEach((citation) => {
    const source = cleanText(citation?.source, 120);
    const pointer = cleanText(citation?.pointer, 260);
    const reason = cleanText(citation?.reason, 260);
    const key = `${source.toLowerCase()}::${pointer.toLowerCase()}`;
    if (!source || !pointer || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ source, pointer, reason });
  });
  return out;
}

function normalizeWebItem(item, lane = 'web', sourceTool = 'search_web') {
  const title = cleanText(item?.title, 320);
  const url = cleanText(item?.url, 1800);
  const snippet = cleanText(item?.snippet, 1000);
  const sourceDomainValue = cleanText(item?.source_domain, 160).toLowerCase() || sourceDomain(url);
  const publishedAt = cleanText(item?.published_at, 80);
  return {
    title,
    url,
    snippet,
    source_domain: sourceDomainValue,
    published_at: publishedAt,
    source_lane: lane,
    source_tool: cleanText(sourceTool, 120) || (lane === 'literature' ? 'literature' : 'search_web')
  };
}

function normalizeLiteratureItems(toolName, toolResult) {
  const sourceTool = cleanText(toolName, 120) || 'literature';
  return asArray(toolResult?.items).map((item) => {
    const title = cleanText(item?.title, 320);
    let url = cleanText(item?.url, 1800);
    if (!url) {
      url = cleanText(item?.pubmed_url || item?.europe_pmc_url || item?.uniprot_url, 1800);
    }
    if (!url && cleanText(item?.doi, 180)) {
      url = `https://doi.org/${encodeURIComponent(cleanText(item.doi, 180))}`;
    }
    if (!url && cleanText(item?.pmid, 80)) {
      url = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(cleanText(item.pmid, 80))}/`;
    }
    const snippet = cleanText(
      item?.snippet
        || item?.abstract
        || item?.journal
        || item?.author_string
        || item?.summary,
      1000
    );
    const normalized = normalizeWebItem({
      title,
      url,
      snippet,
      source_domain: sourceDomain(url),
      published_at: cleanText(item?.published || item?.pubdate || item?.pub_year, 80)
    }, 'literature', sourceTool);
    return normalized;
  }).filter((item) => item.title || item.url || item.snippet);
}

function mergePythonToolResult({
  toolResult,
  taskType,
  runRequest,
  validation,
  persistence
}) {
  const source = toolResult && typeof toolResult === 'object' ? { ...toolResult } : {};
  const items = asArray(source.items);
  const item = items[0] && typeof items[0] === 'object' ? { ...items[0] } : {};
  const nextItem = {
    ...item,
    python_task_type: cleanText(taskType, 80),
    validation_status: cleanText(validation?.status, 80),
    artifact_paths: asArray(runRequest?.artifact_paths).map((value) => cleanText(value, 220)).filter(Boolean),
    persist_artifacts: runRequest?.persist_artifacts === true,
    artifact_count: cleanNumber(persistence?.artifact_count, 0),
    result_files: asArray(persistence?.result_files).map((value) => cleanText(value, 220)).filter(Boolean),
    result_file_records: asArray(persistence?.result_file_records)
  };
  const nextItems = items.length ? [nextItem, ...items.slice(1)] : [nextItem];
  const mergedCitations = uniqueCitations([
    ...asArray(source.citations),
    ...asArray(persistence?.citations)
  ]);
  const summaryParts = [
    cleanText(source.summary, 280),
    cleanText(validation?.summary, 280),
    cleanText(persistence?.summary, 280)
  ].filter(Boolean);
  const summary = cleanText(summaryParts.join(' '), 320) || 'Python orchestration completed.';
  return {
    ...source,
    items: nextItems,
    citations: mergedCitations,
    summary,
    ok: source.ok === true && validation?.ok === true,
    ...(source.ok === true && validation?.ok === true
      ? {}
      : { error: cleanText(validation?.error || source.error, 600) })
  };
}

async function runPlannedPythonTask({
  message,
  routing,
  snapshot = {},
  selectedProjectId = '',
  selectedProjectName = '',
  runTool,
  storagePath = '',
  generatePythonRunRequest = null
}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object'
    ? normalizedRouting.plan
    : {};
  if (plan.needs_python !== true) {
    return {
      executed: false,
      needs_clarification: false,
      plan_patch: {},
      assumption_rows: [],
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }
  const entities = normalizedRouting.entities && typeof normalizedRouting.entities === 'object'
    ? normalizedRouting.entities
    : {};
  const task = classifyPythonTask({
    message,
    entities,
    routing: normalizedRouting
  });
  const runSpec = buildPythonRunRequest({
    message,
    snapshot,
    projectId: cleanText(selectedProjectId, 80),
    projectName: cleanText(selectedProjectName || entities.project, 180),
    taskType: cleanText(task?.task_type, 80)
  });

  const planPatch = {
    python_task_type: cleanText(runSpec?.task_type || task?.task_type, 80) || 'general_compute',
    python_ready: runSpec?.ready === true,
    python_needs_clarification: runSpec?.needs_clarification === true,
    python_artifact_count: 0,
    python_codegen_status: 'not_requested',
    python_codegen_reason: ''
  };
  const assumptionRows = [
    `Python task classifier selected "${planPatch.python_task_type}" (${cleanText(task?.reason, 120) || 'rule_based'}).`,
    `Python readiness=${planPatch.python_ready} clarification=${planPatch.python_needs_clarification}.`
  ];

  if (runSpec?.needs_clarification === true || !runSpec?.run_request_base) {
    planPatch.python_codegen_status = 'skipped';
    planPatch.python_codegen_reason = cleanText(runSpec?.reason, 180) || 'input_missing';
    return {
      executed: false,
      needs_clarification: true,
      clarification_reason: cleanText(runSpec?.reason, 220) || 'python_input_missing',
      clarification_question: cleanText(runSpec?.clarification_question, 320)
        || 'Please provide the required input data for this Python task.',
      plan_patch: planPatch,
      assumption_rows: assumptionRows,
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }

  if (typeof generatePythonRunRequest !== 'function') {
    planPatch.python_ready = false;
    planPatch.python_needs_clarification = true;
    planPatch.python_codegen_status = 'error';
    planPatch.python_codegen_reason = 'codegen_callback_missing';
    return {
      executed: false,
      needs_clarification: true,
      clarification_reason: 'python_codegen_unavailable',
      clarification_question: buildPythonClarificationQuestion({
        reason: 'python_codegen_invalid',
        taskType: planPatch.python_task_type
      }),
      plan_patch: planPatch,
      assumption_rows: [...assumptionRows, 'Python code generation callback was unavailable.'],
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }

  let rawCodegenRequest = null;
  try {
    rawCodegenRequest = await generatePythonRunRequest({
      message,
      taskType: planPatch.python_task_type,
      taskContext: runSpec?.codegen_context && typeof runSpec.codegen_context === 'object'
        ? runSpec.codegen_context
        : {},
      runRequestBase: runSpec?.run_request_base && typeof runSpec.run_request_base === 'object'
        ? runSpec.run_request_base
        : {}
    });
  } catch (error) {
    planPatch.python_ready = false;
    planPatch.python_needs_clarification = true;
    planPatch.python_codegen_status = 'error';
    planPatch.python_codegen_reason = cleanText(error?.message || error, 180) || 'codegen_request_failed';
    return {
      executed: false,
      needs_clarification: true,
      clarification_reason: 'python_codegen_failed',
      clarification_question: buildPythonClarificationQuestion({
        reason: 'python_codegen_invalid',
        taskType: planPatch.python_task_type
      }),
      plan_patch: planPatch,
      assumption_rows: [...assumptionRows, `Python code generation failed: ${planPatch.python_codegen_reason}.`],
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }

  const sanitizedRunRequest = sanitizePythonRunRequest(rawCodegenRequest, {
    taskType: planPatch.python_task_type,
    defaults: runSpec?.run_request_base && typeof runSpec.run_request_base === 'object'
      ? runSpec.run_request_base
      : {}
  });
  if (!sanitizedRunRequest.ok || !sanitizedRunRequest.run_request) {
    planPatch.python_ready = false;
    planPatch.python_needs_clarification = true;
    planPatch.python_codegen_status = 'error';
    planPatch.python_codegen_reason = cleanText(
      sanitizedRunRequest?.reason || sanitizedRunRequest?.error || 'invalid_codegen_output',
      180
    );
    return {
      executed: false,
      needs_clarification: true,
      clarification_reason: 'python_codegen_invalid',
      clarification_question: buildPythonClarificationQuestion({
        reason: 'python_codegen_invalid',
        taskType: planPatch.python_task_type
      }),
      plan_patch: planPatch,
      assumption_rows: [
        ...assumptionRows,
        `Python code generation output was invalid: ${cleanText(sanitizedRunRequest?.error, 220) || planPatch.python_codegen_reason}.`
      ],
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }
  planPatch.python_codegen_status = 'ok';
  planPatch.python_codegen_reason = cleanText(
    sanitizedRunRequest.reason || (asArray(sanitizedRunRequest.warnings).join('; ') || 'sanitized'),
    180
  );

  if (typeof runTool !== 'function') {
    return {
      executed: false,
      needs_clarification: false,
      plan_patch: planPatch,
      assumption_rows: [...assumptionRows, 'Python execution skipped: runTool callback unavailable.'],
      tool_trace_rows: [],
      citations: [],
      tool_result: null
    };
  }

  const toolResult = await runTool('run_python_sandbox', sanitizedRunRequest.run_request);
  const validation = validatePythonResult({ result: toolResult });
  let persistence = {
    applied: false,
    artifact_count: 0,
    result_files: [],
    result_file_records: [],
    citations: [],
    summary: 'Python artifact persistence skipped.'
  };
  if (validation.ok && sanitizedRunRequest.run_request.persist_artifacts === true) {
    persistence = await persistPythonArtifacts({
      sandboxItem: validation.item,
      storagePath,
      projectName: cleanText(selectedProjectName || entities.project, 180)
    });
  }

  planPatch.python_artifact_count = cleanNumber(persistence?.artifact_count, 0);
  const mergedResult = mergePythonToolResult({
    toolResult,
    taskType: planPatch.python_task_type,
    runRequest: sanitizedRunRequest.run_request,
    validation,
    persistence
  });
  const traceRows = [
    {
      tool: 'run_python_sandbox',
      args: sanitizedRunRequest.run_request,
      summary: cleanText(mergedResult?.summary, 260)
    }
  ];

  return {
    executed: true,
    needs_clarification: false,
    plan_patch: planPatch,
    assumption_rows: [
      ...assumptionRows,
      `Python codegen status=${planPatch.python_codegen_status} reason=${planPatch.python_codegen_reason || 'n/a'}.`,
      `Python validation status=${cleanText(validation.status, 80) || 'unknown'}.`,
      cleanText(persistence?.summary, 260)
    ].filter(Boolean),
    tool_trace_rows: traceRows,
    citations: uniqueCitations([
      ...asArray(mergedResult?.citations),
      ...asArray(persistence?.citations)
    ]),
    tool_result: mergedResult,
    notebook_tool_result: {
      tool: 'run_python_sandbox',
      items: asArray(mergedResult?.items),
      summary: cleanText(mergedResult?.summary, 260)
    }
  };
}

async function postProcessPythonToolResult({
  toolResult,
  storagePath = '',
  projectName = '',
  taskType = ''
}) {
  const source = toolResult && typeof toolResult === 'object' ? toolResult : {};
  const validation = validatePythonResult({ result: source });
  let persistence = {
    applied: false,
    artifact_count: 0,
    result_files: [],
    result_file_records: [],
    citations: [],
    summary: 'Python artifact persistence skipped.'
  };
  if (validation.ok) {
    persistence = await persistPythonArtifacts({
      sandboxItem: validation.item,
      storagePath,
      projectName
    });
  }
  const merged = mergePythonToolResult({
    toolResult: source,
    taskType: cleanText(taskType, 80) || 'general_compute',
    runRequest: {
      artifact_paths: asArray(source?.input?.artifact_paths),
      persist_artifacts: source?.input?.persist_artifacts === true
    },
    validation,
    persistence
  });
  return {
    tool_result: merged,
    plan_patch: {
      python_task_type: cleanText(taskType, 80) || cleanText(merged?.items?.[0]?.python_task_type, 80),
      python_ready: validation.ok === true,
      python_needs_clarification: false,
      python_artifact_count: cleanNumber(persistence?.artifact_count, 0),
      python_codegen_status: 'model_tool_call',
      python_codegen_reason: 'direct_tool_call'
    },
    citations: uniqueCitations([
      ...asArray(merged?.citations),
      ...asArray(persistence?.citations)
    ]),
    assumption_rows: [
      `Python validation status=${cleanText(validation.status, 80) || 'unknown'}.`,
      cleanText(persistence?.summary, 260)
    ].filter(Boolean)
  };
}

async function runHybridWebFallback({
  message,
  routing,
  projectName = '',
  internalEvidence = [],
  runLiteratureTool = null
}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const intent = cleanText(normalizedRouting.intent, 80) || 'general_science_question';
  const entities = normalizedRouting.entities && typeof normalizedRouting.entities === 'object'
    ? normalizedRouting.entities
    : {};
  const fallbackDecision = shouldRunWebFallback({
    routing: normalizedRouting,
    intent,
    message,
    internalEvidence
  });
  const basePatch = {
    web_fallback_triggered: false,
    web_fallback_reason: cleanText(fallbackDecision?.reason, 180) || 'not_required',
    web_queries: [],
    web_sources: []
  };
  if (fallbackDecision?.should_run !== true) {
    return {
      triggered: false,
      reason: basePatch.web_fallback_reason,
      queries: [],
      merged_items: [],
      citations: [],
      tool_trace_rows: [],
      assumption_rows: [],
      plan_patch: basePatch
    };
  }

  const queries = buildWebQueries({
    message,
    entities,
    intent,
    projectName
  });
  const webItems = [];
  const literatureItems = [];
  const toolTraceRows = [];

  for (const query of queries) {
    try {
      const items = await searchWebResults({ query, limit: 5 });
      const normalizedItems = asArray(items).map((item) => normalizeWebItem(item, 'web', 'search_web'));
      webItems.push(...normalizedItems);
      toolTraceRows.push({
        tool: 'search_web',
        args: { query, limit: 5 },
        summary: `Found ${normalizedItems.length} web result(s).`
      });
    } catch (error) {
      toolTraceRows.push({
        tool: 'search_web',
        args: { query, limit: 5 },
        summary: `Web search failed: ${cleanText(error?.message || error, 180)}`
      });
    }
  }

  const literatureTools = ['search_pubmed', 'search_crossref', 'search_europe_pmc'];
  if (typeof runLiteratureTool === 'function') {
    const literatureQueries = queries.slice(0, Math.min(2, queries.length));
    for (const query of literatureQueries) {
      for (const toolName of literatureTools) {
        try {
          const result = await runLiteratureTool(toolName, { query, limit: 4 });
          const normalized = normalizeLiteratureItems(toolName, result);
          literatureItems.push(...normalized);
          toolTraceRows.push({
            tool: toolName,
            args: { query, limit: 4 },
            summary: cleanText(result?.summary || `Found ${normalized.length} literature result(s).`, 260)
          });
        } catch (error) {
          toolTraceRows.push({
            tool: toolName,
            args: { query, limit: 4 },
            summary: `Literature search failed: ${cleanText(error?.message || error, 180)}`
          });
        }
      }
    }
  }

  const mergedItems = mergeAndRankWebEvidence({
    webItems,
    literatureItems,
    query: message
  });
  const summary = buildWebFallbackSummary({
    queries,
    items: mergedItems
  });
  const citations = mergedItems.slice(0, 10).map((item, index) => ({
    source: cleanText(
      item?.source_lane === 'literature'
        ? (item?.source_tool || 'literature')
        : 'web_source',
      120
    ),
    pointer: cleanText(item?.url || item?.title || `web_source_${index + 1}`, 260),
    reason: cleanText(
      `${item?.source_lane === 'literature' ? 'Literature' : 'Web'} evidence; domain=${item?.source_domain || 'unknown'} score=${cleanNumber(item?.score, 0).toFixed(2)}.`,
      260
    )
  }));
  const planPatch = {
    web_fallback_triggered: true,
    web_fallback_reason: cleanText(fallbackDecision?.reason, 180) || 'triggered',
    web_queries: asArray(queries).map((query) => cleanText(query, 260)).filter(Boolean),
    web_sources: mergedItems.slice(0, 8).map((item) => ({
      title: cleanText(item?.title, 320),
      url: cleanText(item?.url, 1800),
      source_domain: cleanText(item?.source_domain, 160),
      source_lane: cleanText(item?.source_lane, 40),
      source_tool: cleanText(item?.source_tool, 120),
      published_at: cleanText(item?.published_at, 80),
      score: cleanNumber(item?.score, 0)
    }))
  };

  return {
    triggered: true,
    reason: planPatch.web_fallback_reason,
    queries: planPatch.web_queries,
    merged_items: mergedItems,
    citations: uniqueCitations(citations),
    tool_trace_rows: [
      ...toolTraceRows,
      {
        tool: 'hybrid_web_fallback',
        args: { queries: planPatch.web_queries },
        summary: cleanText(summary, 260)
      }
    ],
    assumption_rows: [
      cleanText(summary, 260),
      `Web fallback reason=${planPatch.web_fallback_reason}.`,
      mergedItems[0]
        ? `Top web source: ${cleanText(mergedItems[0]?.title || mergedItems[0]?.url, 220)}`
        : 'No web/literature sources were returned.'
    ].filter(Boolean),
    plan_patch: planPatch
  };
}

module.exports = {
  runPlannedPythonTask,
  postProcessPythonToolResult,
  runHybridWebFallback
};
