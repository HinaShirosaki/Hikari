'use strict';

const { toIntegerInRange } = require('../../../lib/value-utils.js');
const { asArray, ensureObject } = require('../../../lib/normalize.js');
const {
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary,
  resolveContextProject,
  resolveProjectSelector,
  hydrateToolSnapshot
} = require('./shared.js');

function registerLabToolExecutors(genericAgentToolRuntime, context = {}) {
  const {
    cleanText,
    inventoryLookupRuntime,
    notebookLookupRuntime,
    protocolMatchingRuntime,
    notebookGenerationRuntime,
    notebookDraftRuntime,
    assayTableRuntime,
    plotlyGraphRuntime,
    protocolGenerationRuntime,
    protocolSaveRuntime,
    agentAppApi,
    hydrateSnapshotFromBundle,
    getDefaultDataFilePath
  } = context;

  genericAgentToolRuntime.registerToolExecutor('inventory-lookup', async ({ args, context }) => {
    const parserPayload = resolveToolParserPayload(args, context, {
      inventory_search: args?.inventory_search && typeof args.inventory_search === 'object'
        ? args.inventory_search
        : undefined
    });
    const result = await inventoryLookupRuntime.executeInventoryLookup({
      message: cleanText(args?.query || context?.message, 3200),
      parserPayload,
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      dataFilePath: cleanText(context?.dataFilePath, 2000),
      fallbackDataFilePath: cleanText(context?.fallbackDataFilePath, 2000),
      limit: toIntegerInRange(args?.limit, 8),
      kinds: Array.isArray(args?.kinds) ? args.kinds : []
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

  genericAgentToolRuntime.registerToolExecutor('notebook-lookup', async ({ args, context }) => {
    const parserPayload = resolveToolParserPayload(args, context);
    const entities = ensureObject(parserPayload?.entities);
    const result = await notebookLookupRuntime.execute({
      query: typeof args?.query === 'string' ? args.query : undefined,
      message: cleanText(args?.query || context?.message, 3200),
      parserPayload,
      snapshot: context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {},
      dataFilePath: cleanText(context?.dataFilePath, 2000),
      fallbackDataFilePath: cleanText(context?.fallbackDataFilePath, 2000),
      limit: toIntegerInRange(args?.limit, 8),
      projectId: cleanText(args?.project_id || args?.projectId || entities.project_id, 120),
      projectName: cleanText(args?.project_name || args?.projectName || entities.project_name, 220),
      protocolId: cleanText(args?.protocol_id || args?.protocolId || entities.protocol_id, 120),
      protocolName: cleanText(args?.protocol_name || args?.protocolName || entities.protocol_name, 220),
      notebookState: cleanText(args?.notebook_state || args?.notebookState || entities.notebook_state, 80),
      detail: cleanText(args?.detail, 40)
    });

    return {
      ...result,
      citations: buildToolCitations(
        cleanText,
        result?.items,
        'notebook-lookup',
        'Matched notebook entries from local data.'
      ),
      summary: buildExecutorSummary(
        cleanText,
        'notebook-lookup',
        result?.items,
        'notebook-lookup returned no matches.'
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

  genericAgentToolRuntime.registerToolExecutor('assay-table', async ({ args }) => {
    if (!assayTableRuntime || typeof assayTableRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Assay table runtime is not configured.',
        summary: 'Assay table runtime is not configured.'
      };
    }
    const result = await assayTableRuntime.execute(args);
    return {
      ...result,
      items: Array.isArray(result?.items)
        ? result.items
        : (result?.table ? [result.table] : []),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'assay-table', result?.items, 'assay-table returned no items.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('plotly-graph', async ({ args }) => {
    if (!plotlyGraphRuntime || typeof plotlyGraphRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Plotly graph runtime is not configured.',
        summary: 'Plotly graph runtime is not configured.'
      };
    }
    const result = await plotlyGraphRuntime.execute(args);
    return {
      ...result,
      items: Array.isArray(result?.items)
        ? result.items
        : (result?.graph ? [result.graph] : []),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'plotly-graph', result?.items, 'plotly-graph returned no items.')
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
    const shouldSave = args?.save === true;
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
      message: cleanText(context?.message, 12000),
      conversation: Array.isArray(context?.conversation) ? context.conversation : [],
      snapshot,
      parserPayload: context?.parserPayload && typeof context.parserPayload === 'object' ? context.parserPayload : {},
      project: args?.project && typeof args.project === 'object'
        ? args.project
        : (context?.project && typeof context.project === 'object' ? context.project : {}),
      workflowId: cleanText(args?.workflow_id, 120),
      protocolCandidates: Array.isArray(args?.protocol_candidates) ? args.protocol_candidates : [],
      pendingValues: args?.pending_values && typeof args.pending_values === 'object' ? args.pending_values : {},
      stepEdits: Array.isArray(args?.step_edits) ? args.step_edits : [],
      evidenceContext: Array.isArray(args?.evidence_context) ? args.evidence_context : [],
      traceContext: context?.traceContext || null,
      lifecycleRecorder: context?.lifecycleRecorder || null
    });
  });
}

module.exports = { registerLabToolExecutors };
