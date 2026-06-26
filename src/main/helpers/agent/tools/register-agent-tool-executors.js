'use strict';

const { toIntegerInRange } = require('../../main/data/value-utils.js');

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

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveContextProject(args = {}, context = {}) {
  const argsProject = ensureObject(args?.project);
  if (Object.keys(argsProject).length) {
    return argsProject;
  }
  return ensureObject(context?.project);
}

function resolveProjectSelector(cleanText, args = {}, context = {}, parserPayload = {}) {
  const project = resolveContextProject(args, context);
  const entities = ensureObject(parserPayload?.entities);
  return {
    project,
    projectId: cleanText(
      args?.project_id
      || args?.projectId
      || project?.id
      || project?.projectId
      || entities?.project_id
      || entities?.projectId,
      160
    ),
    projectName: cleanText(
      args?.project_name
      || args?.projectName
      || project?.name
      || project?.projectName
      || entities?.project_name
      || entities?.projectName,
      220
    )
  };
}

async function hydrateToolSnapshot({
  snapshot = {},
  context = {},
  cleanText,
  hydrateSnapshotFromBundle,
  getDefaultDataFilePath
} = {}) {
  const sourceSnapshot = ensureObject(snapshot);
  if (typeof hydrateSnapshotFromBundle !== 'function') {
    return sourceSnapshot;
  }
  const defaultDataFilePath = typeof getDefaultDataFilePath === 'function'
    ? cleanText(getDefaultDataFilePath(), 2400)
    : '';
  const dataFilePath = cleanText(
    context?.dataFilePath
      || sourceSnapshot.data_file_path
      || sourceSnapshot.dataFilePath
      || defaultDataFilePath,
    2400
  );
  const fallbackDataFilePath = cleanText(
    context?.fallbackDataFilePath
      || defaultDataFilePath,
    2400
  );
  if (!dataFilePath && !fallbackDataFilePath) {
    return sourceSnapshot;
  }
  try {
    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath,
      fallbackDataFilePath,
      snapshot: {
        ...sourceSnapshot,
        ...(dataFilePath ? { data_file_path: dataFilePath } : {})
      }
    });
    return ensureObject(hydrated?.snapshot);
  } catch {
    return sourceSnapshot;
  }
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
  const protocolMatchingRuntime = deps.protocolMatchingRuntime || {};
  const notebookGenerationRuntime = deps.notebookGenerationRuntime || {};
  const subAgentRuntime = deps.subAgentRuntime || {};
  const containerRuntime = deps.containerRuntime || {};
  const memoryRuntime = deps.memoryRuntime || {};
  const paperDownloadRuntime = deps.paperDownloadRuntime || {};
  const paperAnalysisRuntime = deps.paperAnalysisRuntime || {};
  const paperWikiSearchRuntime = deps.paperWikiSearchRuntime || {};
  const protocolGenerationRuntime = deps.protocolGenerationRuntime || {};
  const protocolSaveRuntime = deps.protocolSaveRuntime || {};
  const agentAppApi = deps.agentAppApi && typeof deps.agentAppApi === 'object'
    ? deps.agentAppApi
    : {};
  const getAgentPythonSandboxRoot = typeof deps.getAgentPythonSandboxRoot === 'function'
    ? deps.getAgentPythonSandboxRoot
    : (() => '');
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : null;
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
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

  genericAgentToolRuntime.registerToolExecutor('protocol-matching', async ({ args, context, state }) => {
    const parserPayload = resolveToolParserPayload(args, context, {
      protocol_candidates: Array.isArray(args?.protocol_candidates)
        ? args.protocol_candidates
        : undefined
    });
    const { projectId, projectName } = resolveProjectSelector(cleanText, args, context, parserPayload);
    const protocolCandidates = asArray(args?.protocol_candidates).length
      ? asArray(args.protocol_candidates)
      : asArray(parserPayload?.protocol_candidates);
    const snapshot = await hydrateToolSnapshot({
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      context,
      cleanText,
      hydrateSnapshotFromBundle,
      getDefaultDataFilePath
    });
    const input = {
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      snapshot,
      protocols: asArray(args?.protocols).length
        ? asArray(args.protocols)
        : asArray(snapshot?.protocols),
      protocolCandidates,
      message: cleanText(args?.message || context?.message, 3200),
      conversation: Array.isArray(context?.conversation) ? context.conversation : [],
      parserPayload,
      fallbackProtocol: args?.fallback_protocol && typeof args.fallback_protocol === 'object'
        ? args.fallback_protocol
        : null,
      projectId,
      projectName,
      traceContext: context?.traceContext || null
    };
    const result = agentAppApi?.protocol && typeof agentAppApi.protocol.matchForNotebook === 'function'
      ? await agentAppApi.protocol.matchForNotebook(input)
      : (typeof protocolMatchingRuntime.selectProtocol === 'function'
        ? await protocolMatchingRuntime.selectProtocol(input)
        : {
          ok: false,
          status: 'error',
          error: 'Protocol matching runtime is not configured.'
        });
    const selectedProtocol = result?.selected_protocol && typeof result.selected_protocol === 'object'
      ? result.selected_protocol
      : null;
    if (selectedProtocol && state && typeof state === 'object') {
      state.lastSelectedProtocol = selectedProtocol;
    }
    const rankedMatches = asArray(result?.ranked_matches);
    const items = rankedMatches.length
      ? rankedMatches
      : (selectedProtocol ? [selectedProtocol] : []);

    return {
      ...result,
      ok: result?.ok === false ? false : true,
      status: cleanText(result?.status, 80) || (selectedProtocol ? 'selected' : 'no_match'),
      items,
      citations: buildToolCitations(
        cleanText,
        items,
        'protocol-matching',
        'Ranked local protocol records for notebook generation.'
      ),
      summary: cleanText(result?.summary, 320)
        || (selectedProtocol
          ? `Selected protocol ${cleanText(selectedProtocol?.name || selectedProtocol?.id, 220) || 'record'}.`
          : cleanText(result?.rationale, 320) || 'protocol-matching returned no selected protocol.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('notebook-generation', async ({ args, context, state }) => {
    const selectedProtocol = args?.selected_protocol && typeof args.selected_protocol === 'object'
      ? args.selected_protocol
      : (args?.selectedProtocol && typeof args.selectedProtocol === 'object'
        ? args.selectedProtocol
        : (state?.lastSelectedProtocol && typeof state.lastSelectedProtocol === 'object'
          ? state.lastSelectedProtocol
          : null));
    const project = resolveContextProject(args, context);
    const pendingValues = args?.pending_values && typeof args.pending_values === 'object'
      ? args.pending_values
      : (args?.pendingValues && typeof args.pendingValues === 'object' ? args.pendingValues : {});
    const input = {
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      message: cleanText(args?.message || context?.message, 3200),
      conversation: Array.isArray(context?.conversation) ? context.conversation : [],
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      parserPayload: resolveToolParserPayload(args, context),
      selectedProtocol,
      project,
      pendingValues,
      traceContext: context?.traceContext || null,
      lifecycleRecorder: context?.lifecycleRecorder || null
    };
    const result = agentAppApi?.notebook && typeof agentAppApi.notebook.generateFromProtocol === 'function'
      ? await agentAppApi.notebook.generateFromProtocol(input)
      : (typeof notebookGenerationRuntime.generateNotebook === 'function'
        ? await notebookGenerationRuntime.generateNotebook(input)
        : {
          ok: false,
          status: 'error',
          error: 'Notebook generation runtime is not configured.'
        });
    const notebook = result?.notebook && typeof result.notebook === 'object' ? result.notebook : null;
    if (notebook && state && typeof state === 'object') {
      state.lastGeneratedNotebook = notebook;
    }
    return {
      ...result,
      ok: result?.ok === false ? false : true,
      items: notebook ? [notebook] : [],
      summary: cleanText(result?.summary || result?.fill_summary, 320)
        || (notebook
          ? `Generated notebook draft from ${cleanText(selectedProtocol?.name, 220) || 'selected protocol'}.`
          : cleanText(result?.follow_up_questions?.[0], 320) || 'notebook-generation needs more information.')
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

  genericAgentToolRuntime.registerToolExecutor('sub-agent', async ({ args, context }) => {
    if (!subAgentRuntime || typeof subAgentRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Sub-agent runtime is not configured.',
        summary: 'Sub-agent runtime is not configured.'
      };
    }
    const parentRequestId = cleanText(
      args?.metadata?.parent_request_id || context?.lifecycleRecorder?.requestId || context?.requestId,
      160
    );
    const metadata = {
      ...(args?.metadata && typeof args.metadata === 'object' ? args.metadata : {}),
      ...(parentRequestId ? { parent_request_id: parentRequestId } : {})
    };
    const result = await subAgentRuntime.execute({
      ...args,
      metadata
    });
    const agent = result?.agent && typeof result.agent === 'object' ? result.agent : null;
    return {
      ...result,
      items: Array.isArray(result?.items) ? result.items : (agent ? [agent] : []),
      summary: cleanText(result?.summary, 320)
        || (agent
          ? `sub-agent ${cleanText(agent?.id, 160) || 'session'} ${cleanText(result?.status, 80) || 'updated'}.`
          : `sub-agent ${cleanText(result?.status, 80) || 'completed'}.`)
    };
  });

  genericAgentToolRuntime.registerToolExecutor('memory', async ({ args, context }) => {
    if (!memoryRuntime || typeof memoryRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Memory runtime is not configured.',
        summary: 'Memory runtime is not configured.'
      };
    }
    const project = resolveContextProject(args, context);
    const projectName = cleanText(
      args?.project_name
      || args?.projectName
      || args?.record?.project_name
      || args?.record?.projectName
      || project?.name
      || project?.projectName,
      220
    );
    const record = args?.record && typeof args.record === 'object'
      ? {
        ...args.record,
        ...(projectName && !cleanText(args.record.project_name || args.record.projectName, 220)
          ? { project_name: projectName }
          : {})
      }
      : undefined;
    const result = await memoryRuntime.execute({
      ...args,
      ...(projectName && !cleanText(args?.project_name || args?.projectName, 220) ? { project_name: projectName } : {}),
      ...(record ? { record } : {})
    });
    return {
      ...result,
      citations: buildToolCitations(
        cleanText,
        result?.items,
        'memory',
        'Matched long-term agent memory records.'
      ),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'memory', result?.items, 'memory returned no matches.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('container', async ({ args }) => {
    if (!containerRuntime || typeof containerRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Container runtime is not configured.',
        summary: 'Container runtime is not configured.'
      };
    }
    const result = await containerRuntime.execute(args);
    return {
      ...result,
      items: Array.isArray(result?.items)
        ? result.items
        : (result?.container ? [result.container] : []),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'container', result?.items, 'container returned no items.')
    };
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
      provider: cleanText(args?.provider || context?.provider, 80),
      model: cleanText(args?.model || context?.model, 120),
      reasoning_effort: cleanText(
        args?.reasoning_effort
          || args?.reasoningEffort
          || context?.reasoning_effort
          || context?.reasoningEffort,
        40
      ),
      cwd: cleanText(args?.cwd || context?.cwd, 2400),
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

  genericAgentToolRuntime.registerToolExecutor('paper-analysis', async ({ args, context }) => {
    if (!paperAnalysisRuntime || typeof paperAnalysisRuntime.analyzePaper !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper analysis runtime is not configured.',
        summary: 'Paper analysis runtime is not configured.'
      };
    }
    return paperAnalysisRuntime.analyzePaper({
      ...args,
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      message: cleanText(args?.message || context?.message, 2400),
      traceContext: context?.traceContext || null
    });
  });

  genericAgentToolRuntime.registerToolExecutor('paper-search', async ({ args, context }) => {
    if (!paperWikiSearchRuntime || typeof paperWikiSearchRuntime.searchWikiSections !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper wiki search runtime is not configured.',
        summary: 'Paper wiki search runtime is not configured.'
      };
    }
    const snapshot = context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {};
    const storagePath = cleanText(
      args?.storage_path
      || args?.storagePath
      || context?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    );
    const result = await paperWikiSearchRuntime.searchWikiSections({
      storage_path: storagePath,
      query: cleanText(args?.query, 400),
      limit: toIntegerInRange(args?.limit, 8, 1, 25),
      paper_id: cleanText(args?.paper_id || args?.paperId, 180),
      scope: cleanText(args?.scope, 40),
      container: cleanText(args?.container, 220)
    }).catch((error) => ({
      ok: false,
      status: 'error',
      error: cleanText(error?.message || error, 1200) || 'Paper wiki search failed.'
    }));

    const matches = Array.isArray(result?.matches) ? result.matches : [];
    return {
      ...result,
      items: matches,
      citations: matches.slice(0, 8).map((match, index) => ({
        source: 'paper-wiki',
        pointer: [
          cleanText(match?.title, 200),
          match?.page_citation ? `(${match.page_citation})` : '',
          cleanText(match?.doi, 120)
        ].filter(Boolean).join(' ') || `paper-wiki:${index + 1}`,
        reason: cleanText(match?.section_heading, 120) || 'Matched section from paper wiki.'
      })),
      summary: cleanText(result?.summary, 320)
        || (matches.length
          ? `paper-search matched ${matches.length} section${matches.length === 1 ? '' : 's'}.`
          : 'paper-search returned no matches.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('protocol-generation', async ({ args, context }) => {
    if (!protocolGenerationRuntime || typeof protocolGenerationRuntime.generateProtocol !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Protocol generation runtime is not configured.',
        summary: 'Protocol generation runtime is not configured.'
      };
    }
    const shouldSave = args?.save === true
      || args?.persist === true
      || args?.save_to_protocol_module === true
      || args?.saveToProtocolModule === true;
    if (shouldSave) {
      if (!protocolSaveRuntime || typeof protocolSaveRuntime.saveProtocol !== 'function') {
        return {
          ok: false,
          status: 'error',
          error: 'Protocol save runtime is not configured.',
          summary: 'Protocol save runtime is not configured.'
        };
      }
      return protocolSaveRuntime.saveProtocol(args, context);
    }
    return protocolGenerationRuntime.generateProtocol(args);
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

  genericAgentToolRuntime.registerToolExecutor('notebook-draft', async ({ args, context }) => {
    const snapshot = await hydrateToolSnapshot({
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      context,
      cleanText,
      hydrateSnapshotFromBundle,
      getDefaultDataFilePath
    });
    return notebookDraftRuntime.generateNotebookDraft({
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      message: cleanText(context?.message, 3200),
      conversation: Array.isArray(context?.conversation) ? context.conversation : [],
      snapshot,
      parserPayload: context?.parserPayload && typeof context.parserPayload === 'object' ? context.parserPayload : {},
      project: args?.project && typeof args.project === 'object'
        ? args.project
        : (context?.project && typeof context.project === 'object' ? context.project : {}),
      workflowId: cleanText(args?.workflow_id, 120),
      protocolCandidates: Array.isArray(args?.protocol_candidates) ? args.protocol_candidates : [],
      evidenceContext: Array.isArray(args?.evidence_context) ? args.evidence_context : [],
      traceContext: context?.traceContext || null,
      lifecycleRecorder: context?.lifecycleRecorder || null
    });
  });

  return [
    'inventory-lookup',
    'record-lookup',
    'protocol-matching',
    'notebook-generation',
    'notebook-draft',
    'python-sandbox',
    'command-line',
    'web-search',
    'sub-agent',
    'memory',
    'container',
    'literature-search',
    'purchase-recommendation',
    'paper-download',
    'paper-analysis',
    'paper-search',
    'protocol-generation'
  ];
}

module.exports = {
  registerAgentToolExecutors,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary
};
