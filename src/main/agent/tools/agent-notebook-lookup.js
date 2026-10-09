'use strict';
const {
  asArray: defaultAsArray,
  ensureObject: defaultEnsureObject
} = require('../../lib/normalize.js');

function defaultCleanText(value) {
  return String(value || '');
}

function createAgentNotebookLookupRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => [...new Set(asArray(values).map((value) => cleanText(value, 220)).filter(Boolean))].slice(0, max));
  const buildSearchText = typeof deps.buildSearchText === 'function'
    ? deps.buildSearchText
    : ((values) => asArray(values).map((value) => cleanText(value, 600)).filter(Boolean).join(' ').toLowerCase());
  const normalizeQuery = typeof deps.normalizeQuery === 'function'
    ? deps.normalizeQuery
    : ((value) => {
      const query = cleanText(value, 300).toLowerCase();
      return {
        query,
        tokens: query.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter((token) => token.length >= 2).slice(0, 12)
      };
    });
  const buildTerms = typeof deps.buildTerms === 'function'
    ? deps.buildTerms
    : (({ query = '', terms = [], maxTerms = 10 }) => uniqueStrings([...asArray(terms), query], maxTerms));
  const rankRows = typeof deps.rankRows === 'function'
    ? deps.rankRows
    : ((rows, { terms = [], query = '', limit = 6, getSearchText, getPrimaryText } = {}) => {
      const normalizedQuery = cleanText(query, 300).toLowerCase();
      return asArray(rows)
        .map((row) => {
          const searchText = cleanText(getSearchText(row), 12000).toLowerCase();
          const primaryText = cleanText(getPrimaryText(row), 500).toLowerCase();
          let score = asArray(terms).reduce((total, term) => (
            searchText.includes(cleanText(term, 220).toLowerCase()) ? total + 10 : total
          ), 0);
          if (normalizedQuery && primaryText === normalizedQuery) {
            score += 40;
          } else if (normalizedQuery && primaryText.includes(normalizedQuery)) {
            score += 15;
          }
          return { ...row, _score: score };
        })
        .filter((row) => row._score > 0)
        .sort((left, right) => right._score - left._score)
        .slice(0, Math.max(1, Number(limit) || 6));
    });
  const buildLookupContext = typeof deps.buildLookupContext === 'function'
    ? deps.buildLookupContext
    : (async ({ snapshot = {} } = {}) => ({
      hydratedSnapshot: ensureObject(snapshot),
      migration: null,
      warnings: [],
      loadedDataFile: false,
      liveNotebookBridge: { entryCount: 0, complete: false }
    }));
  const agentAppApi = deps.agentAppApi && typeof deps.agentAppApi === 'object' ? deps.agentAppApi : {};

  function compactContentValue(value, depth = 0) {
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return cleanText(value, depth === 0 ? 12000 : 2400);
    }
    if (depth >= 5) {
      return '[content depth limited]';
    }
    if (Array.isArray(value)) {
      return value.slice(0, 40).map((item) => compactContentValue(item, depth + 1));
    }
    if (typeof value !== 'object') {
      return cleanText(value, 1200);
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['storageFolder', 'path', 'absolutePath', 'dataUrl', 'pdfDataUrl'].includes(key))
        .slice(0, 80)
        .map(([key, entry]) => [key, compactContentValue(entry, depth + 1)])
    );
  }

  function normalizeResultFiles(payload = {}) {
    const records = asArray(payload.resultFileRecords)
      .slice(0, 20)
      .map((record) => {
        const source = ensureObject(record);
        return {
          name: cleanText(source.name, 320),
          relative_path: cleanText(source.relativePath || source.relative_path, 2000),
          size: Number(source.size) || 0,
          imported_at: cleanText(source.importedAt || source.imported_at, 80)
        };
      })
      .filter((record) => record.name);
    return records.length
      ? records
      : asArray(payload.resultFiles).slice(0, 20).map((name) => ({ name: cleanText(name, 320) })).filter((record) => record.name);
  }

  function normalizeNotebookItem(rawEntry, { includeContent = false } = {}) {
    const payload = ensureObject(rawEntry);
    const resultTables = asArray(payload.resultTables).length
      ? asArray(payload.resultTables)
      : (payload.resultTable ? [payload.resultTable] : []);
    const resultFiles = normalizeResultFiles(payload);
    const toolCalculations = asArray(payload.toolCalculations);
    const item = {
      id: cleanText(payload.id, 120),
      record_type: 'notebook',
      title: cleanText(payload.experimentName || payload.title || payload.protocolName || payload.id, 220),
      notebook_type: cleanText(payload.notebookType, 80) || 'biology',
      notebook_state: cleanText(payload.notebookState, 80) || 'executed',
      project_id: cleanText(payload.project_id || payload.projectId, 120),
      project_name: cleanText(payload.project_name || payload.projectName, 220),
      linked_protocol_id: cleanText(payload.linked_protocol_id || payload.protocolId, 120),
      linked_protocol_name: cleanText(payload.linked_protocol_name || payload.protocolName, 220),
      protocolName: cleanText(payload.protocolName, 220),
      result: cleanText(payload.result, includeContent ? 12000 : 800),
      summary: cleanText(payload.summary || payload.result, 800),
      created_at: cleanText(payload.createdAt || payload.created_at, 80),
      updated_at: cleanText(payload.updatedAt || payload.updated_at || payload.createdAt, 80),
      executed_at: cleanText(payload.executedAt || payload.executed_at, 80),
      content_available: Boolean(
        payload.result
        || Object.keys(ensureObject(payload.values)).length
        || resultTables.length
        || toolCalculations.length
      ),
      counts: {
        result_tables: resultTables.length,
        tool_calculations: toolCalculations.length,
        result_files: resultFiles.length,
        sample_links: asArray(payload.sampleLinks).length
      },
      ui_target: {
        view: 'biology-notebook',
        entry_id: cleanText(payload.id, 120),
        project_id: cleanText(payload.project_id || payload.projectId, 120)
      }
    };
    if (includeContent) {
      item.content = {
        result: cleanText(payload.result, 12000),
        values: compactContentValue(ensureObject(payload.values)),
        result_tables: compactContentValue(resultTables),
        tool_calculations: compactContentValue(toolCalculations),
        sample_links: compactContentValue(asArray(payload.sampleLinks)),
        result_files: resultFiles,
        protocol_snapshot: compactContentValue(ensureObject(payload.protocolSnapshot)),
        agent_draft_status: cleanText(payload.agentDraftStatus, 80)
      };
    }
    return item;
  }

  function buildNotebookSearchText(payload = {}) {
    return buildSearchText([
      payload.id,
      payload.experimentName,
      payload.protocolId,
      payload.protocolName,
      payload.projectId,
      payload.projectName,
      payload.notebookState,
      payload.result,
      payload.updatedAt,
      JSON.stringify(payload.values || {}),
      JSON.stringify(payload.resultTables || payload.resultTable || []),
      ...asArray(payload.toolCalculations).map((calculation) => {
        const entry = ensureObject(calculation);
        return [entry.title, entry.result, entry.summary, entry.formula].filter(Boolean).join(' ');
      })
    ]);
  }

  function buildNotebookItems(snapshot, { query = '', limit = 6, includeContent = false } = {}) {
    const notebookApi = agentAppApi?.notebook;
    if (typeof notebookApi?.listAgentEntries === 'function') {
      return asArray(notebookApi.listAgentEntries({ snapshot, query, limit }))
        .map((entry) => normalizeNotebookItem(entry, { includeContent }))
        .filter((item) => item.id || item.protocolName);
    }
    const rows = asArray(snapshot?.notebookEntries).map((entry) => ({
      normalized: normalizeNotebookItem(entry, { includeContent }),
      search_text: buildNotebookSearchText(ensureObject(entry))
    }));
    if (!cleanText(query, 300)) {
      return rows
        .sort((left, right) => (
          (Date.parse(right.normalized.updated_at) || 0) - (Date.parse(left.normalized.updated_at) || 0)
        ))
        .slice(0, Math.max(1, Number(limit) || 6))
        .map((row) => row.normalized);
    }
    const normalized = normalizeQuery(query);
    return rankRows(rows, {
      query,
      terms: buildTerms({ query, terms: [query, ...asArray(normalized.tokens)], maxTerms: 10 }),
      limit,
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.normalized?.title
    }).map((row) => row.normalized);
  }

  function matchesText(value = '', expected = '', mode = 'equals') {
    const normalizedValue = cleanText(value, 220).toLowerCase();
    const normalizedExpected = cleanText(expected, 220).toLowerCase();
    if (!normalizedExpected) {
      return true;
    }
    if (!normalizedValue) {
      return false;
    }
    return mode === 'includes' ? normalizedValue.includes(normalizedExpected) : normalizedValue === normalizedExpected;
  }

  function filterNotebookItems(items = [], filters = {}) {
    return asArray(items).filter((item) => (
      matchesText(item?.project_id, filters.projectId)
      && matchesText(item?.project_name, filters.projectName)
      && matchesText(item?.linked_protocol_id, filters.protocolId)
      && matchesText(item?.linked_protocol_name || item?.protocolName || item?.title, filters.protocolName, 'includes')
      && matchesText(item?.notebook_state, filters.notebookState)
    ));
  }

  async function searchNotebookEntries({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 6,
    snapshot = {},
    projectId = '',
    projectName = '',
    protocolId = '',
    protocolName = '',
    notebookState = '',
    detail = 'summary'
  } = {}) {
    const requestedLimit = Math.max(1, Number(limit) || 6);
    const context = await buildLookupContext({ dataFilePath, fallbackDataFilePath, snapshot });
    const items = filterNotebookItems(buildNotebookItems(context.hydratedSnapshot, {
      query,
      limit: Math.max(requestedLimit * 10, 200),
      includeContent: detail === 'full'
    }), { projectId, projectName, protocolId, protocolName, notebookState }).slice(0, requestedLimit);
    const permissionWarnings = asArray(context.warnings)
      .filter((warning) => /permission denied|\bEPERM\b|\bEACCES\b/i.test(String(warning || '')));
    const otherWarnings = asArray(context.warnings).filter((warning) => !permissionWarnings.includes(warning));
    const accessStatus = permissionWarnings.length
      ? (items.length ? 'degraded' : 'permission_denied')
      : (otherWarnings.length ? 'degraded' : 'ready');
    const appliedSources = asArray(context.migration?.applied);
    return {
      items,
      source: appliedSources.includes('notebook_markdown') ? 'markdown' : 'fallback_json',
      sources: uniqueStrings([
        ...(asArray(snapshot?.notebookEntries).length ? ['request_snapshot'] : []),
        ...(Number(context.liveNotebookBridge?.entryCount) > 0 ? ['live_notebook_bridge'] : []),
        ...(context.loadedDataFile ? ['data_file'] : []),
        ...(appliedSources.includes('notebook_sidecar') ? ['notebook_sidecar'] : []),
        ...(appliedSources.includes('project_root_storage') ? ['project_storage'] : []),
        ...(appliedSources.includes('workflow_root_storage') ? ['workflow_storage'] : []),
        ...(appliedSources.includes('notebook_markdown') ? ['notebook_markdown'] : [])
      ], 10),
      candidateCount: asArray(context.hydratedSnapshot?.notebookEntries).length,
      access: {
        status: accessStatus,
        complete: accessStatus === 'ready',
        retryable: permissionWarnings.length > 0,
        warning_codes: [
          ...(permissionWarnings.length ? ['storage_permission_denied'] : []),
          ...(otherWarnings.length ? ['storage_read_warning'] : [])
        ],
        warnings: [
          ...(permissionWarnings.length ? ['Hikari could not read part of the configured notebook storage.'] : []),
          ...(otherWarnings.length ? ['One or more notebook storage sources could not be read.'] : [])
        ],
        user_action: permissionWarnings.length
          ? 'Grant Hikari access to the configured storage folder, or choose that folder again in Hikari Settings, then retry the lookup.'
          : ''
      }
    };
  }

  async function execute({
    query: explicitQuery,
    message = '',
    parserPayload = {},
    snapshot = {},
    dataFilePath = '',
    fallbackDataFilePath = '',
    limit = 8,
    projectId = '',
    projectName = '',
    protocolId = '',
    protocolName = '',
    notebookState = '',
    detail = 'summary'
  } = {}) {
    const entities = ensureObject(ensureObject(parserPayload).entities);
    // An explicit query, including an empty one, stays separate from filters.
    // Note: requested_output ('notebook_lookup') is a routing sentinel, not a search term,
    // so it must never seed the query — otherwise filter-only calls (e.g. notebook_state
    // alone) search for "notebook_lookup" and drop the very entries they should list.
    const query = typeof explicitQuery === 'string' ? cleanText(explicitQuery, 300) : cleanText(
      protocolName
        || entities.protocol_name
        || entities.notebook_name
        || entities.project_name
        || entities.activity_type
        || message,
      300
    );
    const resolvedProjectId = cleanText(projectId || entities.project_id, 120);
    const resolvedProjectName = cleanText(projectName || entities.project_name, 220);
    const resolvedProtocolId = cleanText(protocolId || entities.protocol_id, 120);
    const resolvedProtocolName = cleanText(protocolName || entities.protocol_name, 220);
    const resolvedNotebookState = cleanText(notebookState || entities.notebook_state, 80).toLowerCase();
    const resolvedDetail = cleanText(detail, 40).toLowerCase() === 'full' ? 'full' : 'summary';
    const searchResult = await searchNotebookEntries({
      dataFilePath,
      fallbackDataFilePath,
      query,
      limit,
      snapshot,
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      protocolId: resolvedProtocolId,
      protocolName: resolvedProtocolName,
      notebookState: resolvedNotebookState,
      detail: resolvedDetail
    });
    const items = asArray(searchResult.items).slice(0, Math.max(1, Number(limit) || 8));
    const access = ensureObject(searchResult.access);
    const status = access.status === 'permission_denied'
      ? 'permission_denied'
      : (access.status === 'degraded' ? 'partial' : (items.length ? 'matched' : 'no_match'));
    return {
      status,
      detail: resolvedDetail,
      query,
      source: cleanText(searchResult.source, 80) || 'fallback_json',
      sources: asArray(searchResult.sources),
      backfilled_sql: false,
      scope: {
        project_id: resolvedProjectId,
        project_name: resolvedProjectName,
        protocol_id: resolvedProtocolId,
        protocol_name: resolvedProtocolName,
        notebook_state: resolvedNotebookState
      },
      counts: {
        candidates: Number(searchResult.candidateCount) || 0,
        returned: items.length
      },
      access,
      items
    };
  }

  return {
    normalizeNotebookItem,
    searchNotebookEntries,
    execute
  };
}

module.exports = {
  createAgentNotebookLookupRuntime
};
