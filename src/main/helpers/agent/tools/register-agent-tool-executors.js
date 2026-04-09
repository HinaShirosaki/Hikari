'use strict';

const { toIntegerInRange } = require('../../main/value-utils.js');

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function resolveToolParserPayload(args = {}, context = {}, extra = {}) {
  const contextParser = context?.parserPayload && typeof context.parserPayload === 'object'
    ? context.parserPayload
    : {};
  const argsParser = args?.parser_payload && typeof args.parser_payload === 'object'
    ? args.parser_payload
    : {};

  return {
    ...contextParser,
    ...argsParser,
    ...(extra && typeof extra === 'object' ? extra : {})
  };
}

function buildToolCitations(cleanText, items = [], source = '', reasonText = '') {
  return (Array.isArray(items) ? items : [])
    .slice(0, 8)
    .map((item, index) => {
      const pointer = [
        cleanText(item?.id || item?.record_id || item?.run_id, 120),
        cleanText(item?.title || item?.name || item?.protocolName, 220)
      ].filter(Boolean).join(' | ');

      return {
        source: cleanText(source, 120),
        pointer: pointer || `${cleanText(source, 40) || 'tool'}:${index + 1}`,
        reason: cleanText(reasonText, 220)
      };
    })
    .filter((citation) => citation.source && citation.pointer);
}

function buildExecutorSummary(cleanText, toolName, items = [], emptyText) {
  const count = Array.isArray(items) ? items.length : 0;
  if (!count) {
    return cleanText(emptyText, 320) || `${cleanText(toolName, 120) || 'Tool'} returned no matches.`;
  }
  if (cleanText(toolName, 120) === 'inventory-lookup') {
    const preview = items
      .slice(0, 2)
      .map((item) => {
        const label = cleanText(item?.name || item?.id, 120);
        const location = cleanText(item?.location, 120);
        return label
          ? (location ? `${label} @ ${location}` : label)
          : '';
      })
      .filter(Boolean)
      .join('; ');
    return cleanText(
      `${cleanText(toolName, 120)} matched ${count} item${count === 1 ? '' : 's'}${preview ? `: ${preview}.` : '.'}`,
      320
    );
  }
  if (cleanText(toolName, 120) === 'record-lookup') {
    const preview = items
      .slice(0, 2)
      .map((item) => {
        const label = cleanText(item?.title || item?.id, 120);
        const recordType = cleanText(item?.record_type, 40);
        return label
          ? `${recordType ? `${recordType}: ` : ''}${label}`
          : '';
      })
      .filter(Boolean)
      .join('; ');
    return cleanText(
      `${cleanText(toolName, 120)} matched ${count} item${count === 1 ? '' : 's'}${preview ? `: ${preview}.` : '.'}`,
      320
    );
  }
  return `${cleanText(toolName, 120) || 'Tool'} matched ${count} item${count === 1 ? '' : 's'}.`;
}

function registerAgentToolExecutors(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const genericAgentToolRuntime = deps.genericAgentToolRuntime;
  const agentLookupRuntime = deps.agentLookupRuntime || {};
  const literatureSearchRuntime = deps.literatureSearchRuntime || {};
  const pythonSandboxToolRuntime = deps.pythonSandboxToolRuntime || {};
  const notebookDraftRuntime = deps.notebookDraftRuntime || {};
  const getAgentPythonSandboxRoot = typeof deps.getAgentPythonSandboxRoot === 'function'
    ? deps.getAgentPythonSandboxRoot
    : (() => '');

  if (!genericAgentToolRuntime || typeof genericAgentToolRuntime.registerToolExecutor !== 'function') {
    return [];
  }

  genericAgentToolRuntime.registerToolExecutor('inventory-lookup', async ({ args, context }) => {
    const parserPayload = resolveToolParserPayload(args, context, {
      inventory_search: args?.inventory_search && typeof args.inventory_search === 'object'
        ? args.inventory_search
        : undefined
    });
    const result = await agentLookupRuntime.executeInventoryLookup({
      message: cleanText(args?.query || context?.message, 3200),
      parserPayload,
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      dataFilePath: cleanText(context?.dataFilePath, 2000),
      fallbackDataFilePath: cleanText(context?.fallbackDataFilePath, 2000),
      limit: toIntegerInRange(args?.limit, 8)
    });

    return {
      ...result,
      citations: buildToolCitations(
        cleanText,
        result?.items,
        'inventory-lookup',
        'Matched inventory records from local data.'
      ),
      summary: buildExecutorSummary(
        cleanText,
        'inventory-lookup',
        result?.items,
        'inventory-lookup returned no matches.'
      )
    };
  });

  genericAgentToolRuntime.registerToolExecutor('record-lookup', async ({ args, context }) => {
    const result = await agentLookupRuntime.executeRecordLookup({
      message: cleanText(args?.query || context?.message, 3200),
      parserPayload: resolveToolParserPayload(args, context),
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      dataFilePath: cleanText(context?.dataFilePath, 2000),
      fallbackDataFilePath: cleanText(context?.fallbackDataFilePath, 2000),
      limit: toIntegerInRange(args?.limit, 8)
    });

    return {
      ...result,
      citations: buildToolCitations(
        cleanText,
        result?.items,
        'record-lookup',
        'Matched internal lab records from project data.'
      ),
      summary: buildExecutorSummary(
        cleanText,
        'record-lookup',
        result?.items,
        'record-lookup returned no matches.'
      )
    };
  });

  genericAgentToolRuntime.registerToolExecutor('literature-search', async ({ args, context }) => literatureSearchRuntime.execute({
    ...args,
    provider: cleanText(context?.provider, 80),
    endpoint: cleanText(context?.endpoint, 2000),
    apiKey: cleanText(context?.apiKey, 400),
    model: cleanText(context?.model, 120),
    traceContext: context?.traceContext || null,
    query: cleanText(args?.query, 600),
    message: cleanText(args?.message || context?.message, 1200),
    parser_payload: resolveToolParserPayload(args, context),
    limit: toIntegerInRange(args?.limit, 8),
    max_per_source: toIntegerInRange(args?.max_per_source, 5, 1, 10)
  }));

  genericAgentToolRuntime.registerToolExecutor('python-sandbox', async ({ args, context }) => {
    const result = await pythonSandboxToolRuntime.execute(args, {
      parent_request_id: cleanText(context?.lifecycleRecorder?.requestId || context?.requestId, 160),
      sandboxRoot: getAgentPythonSandboxRoot(),
      preferredPythonBin: cleanText(context?.preferredPythonBin, 240),
      pythonExecutable: cleanText(context?.pythonExecutable, 240)
    });
    const sandbox = result?.sandbox && typeof result.sandbox === 'object' ? result.sandbox : {};
    const runId = cleanText(sandbox?.run_id, 120);

    return {
      ...result,
      status: cleanText(sandbox?.status, 40),
      run_id: runId,
      error: cleanText(sandbox?.error || result?.debug?.assistant_message, 4000),
      stdout: cleanText(sandbox?.stdout, 4000),
      stderr: cleanText(sandbox?.stderr, 12000),
      readback_files: Array.isArray(sandbox?.readback_files) ? sandbox.readback_files : [],
      render_outputs: Array.isArray(sandbox?.render_outputs) ? sandbox.render_outputs : [],
      items: runId
        ? [{
          run_id: runId,
          status: cleanText(sandbox?.status, 40),
          ok: result?.ok === true
        }]
        : [],
      citations: result?.ok === true && runId
        ? [{
          source: 'python-sandbox',
          pointer: runId,
          reason: cleanText(result?.summary, 220) || 'Python sandbox execution completed.'
        }]
        : []
    };
  });

  genericAgentToolRuntime.registerToolExecutor('notebook-draft', async ({ args, context }) => notebookDraftRuntime.generateNotebookDraft({
    provider: cleanText(context?.provider, 80),
    endpoint: cleanText(context?.endpoint, 1600),
    apiKey: cleanText(context?.apiKey, 400),
    model: cleanText(context?.model, 120),
    message: cleanText(context?.message, 3200),
    conversation: Array.isArray(context?.conversation) ? context.conversation : [],
    snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
    parserPayload: context?.parserPayload && typeof context.parserPayload === 'object' ? context.parserPayload : {},
    project: args?.project && typeof args.project === 'object'
      ? args.project
      : (context?.project && typeof context.project === 'object' ? context.project : {}),
    workflowId: cleanText(args?.workflow_id, 120),
    protocolCandidates: Array.isArray(args?.protocol_candidates) ? args.protocol_candidates : [],
    traceContext: context?.traceContext || null,
    lifecycleRecorder: context?.lifecycleRecorder || null
  }));

  return [
    'inventory-lookup',
    'record-lookup',
    'literature-search',
    'python-sandbox',
    'notebook-draft'
  ];
}

module.exports = {
  registerAgentToolExecutors,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary
};
