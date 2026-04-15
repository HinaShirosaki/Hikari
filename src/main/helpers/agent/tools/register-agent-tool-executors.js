'use strict';

const { toIntegerInRange } = require('../../main/value-utils.js');

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '');
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

function resolvePaperDownloadContext(args = {}, context = {}) {
  const snapshot = context?.snapshot && typeof context.snapshot === 'object'
    ? context.snapshot
    : {};
  const project = context?.project && typeof context.project === 'object'
    ? context.project
    : {};
  const message = cleanTextValue(args?.message || context?.message, 12000);
  return {
    storage_path: cleanTextValue(
      args?.storage_path
      || args?.storagePath
      || context?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    ),
    linked_type: cleanTextValue(args?.linked_type || args?.linkedType, 80)
      || (cleanTextValue(project?.id || project?.name, 120) ? 'project' : 'literature-search'),
    linked_name: cleanTextValue(
      args?.linked_name
      || args?.linkedName
      || project?.name
      || project?.id
      || context?.topic
      || message,
      220
    ),
    message
  };
}

function cleanTextValue(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function registerAgentToolExecutors(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const genericAgentToolRuntime = deps.genericAgentToolRuntime;
  const agentLookupRuntime = deps.agentLookupRuntime || {};
  const webSearchRuntime = deps.webSearchRuntime || {};
  const literatureSearchRuntime = deps.literatureSearchRuntime || {};
  const purchaseRecommendationRuntime = deps.purchaseRecommendationRuntime || {};
  const pythonSandboxToolRuntime = deps.pythonSandboxToolRuntime || {};
  const commandLineRuntime = deps.commandLineRuntime || {};
  const notebookDraftRuntime = deps.notebookDraftRuntime || {};
  const paperDownloadRuntime = deps.paperDownloadRuntime || {};
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

  genericAgentToolRuntime.registerToolExecutor('web-search', async ({ args, context }) => {
    if (!webSearchRuntime || typeof webSearchRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Web search runtime is not configured.'
      };
    }
    return webSearchRuntime.execute({
      ...args,
      traceContext: context?.traceContext || null,
      query: cleanText(args?.query, 1200),
      message: cleanText(args?.message || context?.message, 1200),
      parser_payload: resolveToolParserPayload(args, context),
      limit: toIntegerInRange(args?.limit, 8, 1, 25),
      allowed_domains: Array.isArray(args?.allowed_domains) ? args.allowed_domains : [],
      user_location: args?.user_location && typeof args.user_location === 'object'
        ? args.user_location
        : null,
      external_web_access: args?.external_web_access !== false
    });
  });

  genericAgentToolRuntime.registerToolExecutor('literature-search', async ({ args, context }) => {
    if (!literatureSearchRuntime || typeof literatureSearchRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Literature search runtime is not configured.'
      };
    }
    const snapshot = context?.snapshot && typeof context.snapshot === 'object'
      ? context.snapshot
      : {};
    const project = args?.project && typeof args.project === 'object'
      ? args.project
      : (context?.project && typeof context.project === 'object' ? context.project : {});
    const storagePath = cleanText(
      args?.storage_path
      || args?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    );
    return literatureSearchRuntime.execute({
      ...args,
      traceContext: context?.traceContext || null,
      query: cleanText(args?.query, 600),
      message: cleanText(args?.message || context?.message, 1200),
      snapshot,
      project,
      storage_path: storagePath,
      storagePath,
      parser_payload: resolveToolParserPayload(args, context),
      limit: toIntegerInRange(args?.limit, 8),
      max_per_source: toIntegerInRange(args?.max_per_source, 5, 1, 10)
    });
  });

  genericAgentToolRuntime.registerToolExecutor('paper-download', async ({ args, context }) => {
    if (!paperDownloadRuntime || typeof paperDownloadRuntime.downloadPaper !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper download runtime is not configured.'
      };
    }
    const resolved = resolvePaperDownloadContext(args, context);
    const result = await paperDownloadRuntime.downloadPaper({
      ...args,
      page_url: cleanText(args?.page_url || args?.pageUrl || context?.pageUrl, 2000),
      message: cleanText(args?.message || context?.message, 12000),
      paper_title: cleanText(args?.paper_title || args?.paperTitle, 240),
      linked_type: resolved.linked_type,
      linked_name: resolved.linked_name,
      storage_path: resolved.storage_path
    }).catch((error) => ({
      ok: false,
      status: 'error',
      error: cleanText(error?.message || error, 1200) || 'Paper download failed.'
    }));

    return {
      ...result,
      summary: cleanText(result?.summary, 320)
        || (result?.ok === true
          ? `Downloaded ${cleanText(result?.file_name, 240) || 'paper.pdf'}.`
          : 'Paper download failed.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('purchase-recommendation', async ({ args, context }) => {
    const result = await purchaseRecommendationRuntime.execute({
      ...args,
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      traceContext: context?.traceContext || null,
      message: cleanText(args?.message || context?.message, 1200),
      parser_payload: resolveToolParserPayload(args, context),
      limit: toIntegerInRange(args?.limit, 6, 1, 6),
      search_limit: toIntegerInRange(args?.search_limit, 10, 1, 16)
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    return {
      ...result,
      citations: items.slice(0, 8).map((item, index) => ({
        source: 'web_source',
        pointer: cleanText(item?.product_url || item?.title, 260) || `purchase-result:${index + 1}`,
        reason: 'Matched purchasable product metadata from a vendor page.'
      })),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(
          cleanText,
          'purchase-recommendation',
          items,
          'purchase-recommendation returned no matches.'
        )
    };
  });

  genericAgentToolRuntime.registerToolExecutor('python-sandbox', async ({ args, context }) => {
    const result = await pythonSandboxToolRuntime.execute(args, {
      parent_request_id: cleanText(context?.lifecycleRecorder?.requestId || context?.requestId, 160),
      sandboxRoot: getAgentPythonSandboxRoot(),
      preferredPythonBin: cleanText(context?.preferredPythonBin, 240),
      pythonExecutable: cleanText(context?.pythonExecutable, 240),
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      traceContext: context?.traceContext || null,
      message: cleanText(context?.message, 12000)
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

  genericAgentToolRuntime.registerToolExecutor('command-line', async ({ args, context }) => {
    if (!commandLineRuntime || typeof commandLineRuntime.execute !== 'function') {
      return {
        status: 'error',
        error: 'Command-line runtime is not configured.',
        summary: 'Command-line runtime is not configured.'
      };
    }
    return commandLineRuntime.execute(args, {
      cwd: cleanText(context?.cwd, 1200),
      allowWriteTools: context?.allowWriteTools === true
    });
  });

  genericAgentToolRuntime.registerToolExecutor('notebook-draft', async ({ args, context }) => notebookDraftRuntime.generateNotebookDraft({
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
    'web-search',
    'literature-search',
    'paper-download',
    'purchase-recommendation',
    'python-sandbox',
    'command-line',
    'notebook-draft'
  ];
}

module.exports = {
  registerAgentToolExecutors,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary
};
