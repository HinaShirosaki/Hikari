'use strict';

const { resolveAgentRuntimeFactory } = require('../shared/agent-runtime-registry.js');
const { createProtocolMatchingRuntime } = require('../tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../tools/agent-notebook-generation.js');

const AGENT_SUB_APP_API_CATALOG = Object.freeze({
  assay: Object.freeze({
    description: 'Agent-facing assay records and summaries.',
    methods: Object.freeze(['listAgentRecords', 'listAgentRuns'])
  }),
  gel: Object.freeze({
    description: 'Agent-facing gel analysis records and summaries.',
    methods: Object.freeze(['listAgentRecords', 'listAgentAnalyses'])
  }),
  papers: Object.freeze({
    description: 'Agent-facing paper records and summaries.',
    methods: Object.freeze(['listAgentRecords', 'listAgentPapers'])
  }),
  protocol: Object.freeze({
    description: 'Agent-facing protocol records plus notebook-matching helpers.',
    methods: Object.freeze([
      'listAgentRecords',
      'listAgentProtocols',
      'normalizeAgentProtocol',
      'rankAgentProtocols',
      'matchForNotebook'
    ])
  }),
  notebook: Object.freeze({
    description: 'Agent-facing notebook entries plus protocol-to-notebook generation helpers.',
    methods: Object.freeze(['listAgentRecords', 'listAgentEntries', 'generateFromProtocol'])
  })
});

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createAgentSubAppApi(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const pickTopMatches = typeof deps.pickTopMatches === 'function'
    ? deps.pickTopMatches
    : ((items, buildSearchText, query, limit = 6) => {
      const queryText = cleanText(query, 300).toLowerCase();
      if (!queryText) {
        return asArray(items).slice(0, Math.max(1, Number(limit) || 6));
      }
      const queryTokens = queryText
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 12);
      return asArray(items)
        .map((item) => {
          const haystack = cleanText(buildSearchText(item), 5000).toLowerCase();
          const score = queryTokens.reduce((total, token) => (haystack.includes(token) ? total + 1 : total), 0);
          return {
            item,
            score
          };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Number(limit) || 6))
        .map((entry) => entry.item);
    });
  const buildSearchText = typeof deps.buildSearchText === 'function'
    ? deps.buildSearchText
    : ((values) => asArray(values)
      .map((value) => cleanText(value, 1200))
      .filter(Boolean)
      .join(' ')
      .toLowerCase());
  const getRunTool = typeof deps.getRunTool === 'function'
    ? deps.getRunTool
    : (() => (typeof deps.runTool === 'function' ? deps.runTool : null));

  const protocolMatchingFactory = resolveAgentRuntimeFactory(deps, 'protocol-matching');
  const notebookGenerationFactory = resolveAgentRuntimeFactory(deps, 'notebook-generation');
  let protocolMatchingRuntimeCache = null;
  let notebookGenerationRuntimeCache = null;

  function createDeferredRunTool() {
    return async (...args) => {
      const runTool = getRunTool();
      if (typeof runTool !== 'function') {
        throw new Error('Agent tool runtime is not ready.');
      }
      return runTool(...args);
    };
  }

  function getProtocolMatchingRuntime() {
    if (!protocolMatchingRuntimeCache) {
      protocolMatchingRuntimeCache = typeof protocolMatchingFactory === 'function'
        ? protocolMatchingFactory({
          ...deps,
          ensureObject
        })
        : createProtocolMatchingRuntime({
          ...deps,
          ensureObject
        });
    }
    return protocolMatchingRuntimeCache;
  }

  function getNotebookGenerationRuntime() {
    if (!notebookGenerationRuntimeCache) {
      notebookGenerationRuntimeCache = typeof notebookGenerationFactory === 'function'
        ? notebookGenerationFactory({
          ...deps,
          ensureObject,
          runTool: createDeferredRunTool()
        })
        : createNotebookGenerationRuntime({
          ...deps,
          ensureObject,
          runTool: createDeferredRunTool()
        });
    }
    return notebookGenerationRuntimeCache;
  }

  function resolveProjectRef(payload = {}, fallbackProjectId = '', fallbackProjectName = '') {
    return {
      id: cleanText(
        payload?.project_id
          || payload?.projectId
          || payload?.linkedId
          || fallbackProjectId,
        120
      ),
      name: cleanText(
        payload?.project_name
          || payload?.projectName
          || payload?.linkedName
          || fallbackProjectName,
        220
      )
    };
  }

  function filterRows(rows = [], {
    query = '',
    limit = 80,
    projectId = '',
    projectName = '',
    getSearchValue = (row) => row?.search_text || '',
    getPrimaryValue = (row) => row?.title || row?.name || ''
  } = {}) {
    const requestedProjectId = cleanText(projectId, 120);
    const requestedProjectName = cleanText(projectName, 220).toLowerCase();
    const filteredByProject = asArray(rows).filter((row) => {
      const rowProjectId = cleanText(row?.project_id, 120);
      const rowProjectName = cleanText(row?.project_name, 220).toLowerCase();
      if (requestedProjectId && rowProjectId === requestedProjectId) {
        return true;
      }
      if (requestedProjectId) {
        return false;
      }
      if (requestedProjectName && rowProjectName === requestedProjectName) {
        return true;
      }
      return !requestedProjectName;
    });

    const queryText = cleanText(query, 300);
    if (!queryText) {
      return filteredByProject.slice(0, Math.max(1, Number(limit) || 80));
    }

    return pickTopMatches(
      filteredByProject,
      (row) => [
        cleanText(getPrimaryValue(row), 600),
        cleanText(getSearchValue(row), 5000)
      ].filter(Boolean).join(' '),
      queryText,
      Math.max(1, Number(limit) || 80)
    );
  }

  function mapProtocolStepText(step) {
    if (typeof step === 'string') {
      return cleanText(step, 1000);
    }
    const payload = ensureObject(step);
    return cleanText(payload.text || payload.instruction || payload.action, 1000);
  }

  function listAssayRecords({
    snapshot = {},
    query = '',
    limit = 80,
    projectId = '',
    projectName = ''
  } = {}) {
    const rows = asArray(snapshot?.assays).map((assay) => {
      const payload = ensureObject(assay);
      const project = resolveProjectRef(payload);
      return {
        record_type: 'assay',
        record_id: cleanText(payload.id || payload.assay_number, 120),
        title: cleanText(payload.name || payload.assay_number || payload.id, 220),
        project_id: project.id,
        project_name: project.name,
        summary: cleanText(payload.notes || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.assay_number,
          payload.name,
          payload.notes,
          project.id,
          project.name,
          payload.notebook_entry_protocol_name
        ]),
        assay: payload
      };
    });

    return filterRows(rows, { query, limit, projectId, projectName });
  }

  function listGelRecords({
    snapshot = {},
    query = '',
    limit = 80,
    projectId = '',
    projectName = ''
  } = {}) {
    const rows = asArray(snapshot?.gelAnalyses).map((analysis) => {
      const payload = ensureObject(analysis);
      const project = resolveProjectRef(payload);
      return {
        record_type: 'gel',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: project.id,
        project_name: project.name,
        summary: cleanText(payload.analysis_type || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.analysis_type,
          project.id,
          project.name,
          payload.notebook_entry_protocol_name,
          asArray(payload.warnings).join(' ')
        ]),
        analysis: payload
      };
    });

    return filterRows(rows, { query, limit, projectId, projectName });
  }

  function listPaperRecords({
    snapshot = {},
    query = '',
    limit = 80,
    projectId = '',
    projectName = ''
  } = {}) {
    const rows = asArray(snapshot?.papers).map((paper) => {
      const payload = ensureObject(paper);
      const linkedType = cleanText(payload.linkedType, 80).toLowerCase();
      const project = resolveProjectRef(
        linkedType === 'project'
          ? {
            projectId: payload.linkedId || payload.projectId,
            projectName: payload.linkedName || payload.projectName
          }
          : payload
      );
      return {
        record_type: 'paper',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.title || payload.id, 220),
        project_id: project.id,
        project_name: project.name,
        summary: cleanText(payload.summary || payload.abstract, 500),
        linked_protocol_id: '',
        linked_protocol_name: '',
        updated_at: cleanText(payload.updatedAt || payload.createdAt || payload.importedAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.title,
          payload.summary,
          payload.abstract,
          payload.doi,
          payload.authors,
          project.id,
          project.name,
          asArray(payload.methodsExtract).map((method) => {
            const methodPayload = ensureObject(method);
            return [
              methodPayload.title,
              methodPayload.purpose,
              asArray(methodPayload.steps).map((step) => ensureObject(step).action || step).join(' ')
            ].filter(Boolean).join(' ');
          }).join(' ')
        ]),
        paper: payload
      };
    });

    return filterRows(rows, { query, limit, projectId, projectName });
  }

  function listProtocolRecords({
    snapshot = {},
    query = '',
    limit = 80,
    projectId = '',
    projectName = ''
  } = {}) {
    const protocolMatchingRuntime = getProtocolMatchingRuntime();
    const rows = asArray(snapshot?.protocols).map((protocol, index) => {
      const normalizedProtocol = protocolMatchingRuntime.normalizeProtocolRecord(protocol, index);
      const payload = ensureObject(protocol);
      const project = resolveProjectRef({
        projectId: normalizedProtocol.project_id || payload.projectId,
        projectName: normalizedProtocol.project_name || payload.projectName || payload.linkedProject
      });
      return {
        record_type: 'protocol',
        record_id: cleanText(normalizedProtocol.id, 120),
        title: cleanText(normalizedProtocol.name || payload.name || payload.id, 220),
        project_id: project.id,
        project_name: project.name,
        summary: cleanText(normalizedProtocol.purpose || payload.description || payload.category, 500),
        linked_protocol_id: cleanText(normalizedProtocol.id, 120),
        linked_protocol_name: cleanText(normalizedProtocol.name, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          normalizedProtocol.id,
          normalizedProtocol.name,
          normalizedProtocol.purpose,
          payload.description,
          payload.category,
          project.id,
          project.name,
          asArray(normalizedProtocol.aliases).join(' '),
          asArray(normalizedProtocol.steps).map((step) => mapProtocolStepText(step)).join(' ')
        ]),
        protocol: normalizedProtocol
      };
    });

    return filterRows(rows, { query, limit, projectId, projectName });
  }

  function listNotebookRecords({
    snapshot = {},
    query = '',
    limit = 80,
    projectId = '',
    projectName = ''
  } = {}) {
    const rows = asArray(snapshot?.notebookEntries).map((entry) => {
      const payload = ensureObject(entry);
      const project = resolveProjectRef(payload);
      return {
        record_type: 'notebook',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.protocolName || payload.id, 220),
        project_id: project.id,
        project_name: project.name,
        summary: cleanText(payload.result, 500),
        linked_protocol_id: cleanText(payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.protocolName, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.protocolId,
          payload.protocolName,
          project.id,
          project.name,
          payload.result,
          payload.updatedAt,
          JSON.stringify(payload.values || {})
        ]),
        entry: payload
      };
    });

    return filterRows(rows, { query, limit, projectId, projectName });
  }

  const protocolApi = {
    listAgentRecords: listProtocolRecords,
    listAgentProtocols(options = {}) {
      return listProtocolRecords(options)
        .map((row) => row?.protocol)
        .filter(Boolean);
    },
    normalizeAgentProtocol(protocol, index = 0) {
      return getProtocolMatchingRuntime().normalizeProtocolRecord(protocol, index);
    },
    rankAgentProtocols({
      snapshot = {},
      protocols = [],
      protocolCandidates = [],
      message = '',
      parserPayload = {},
      projectId = '',
      projectName = ''
    } = {}) {
      const runtime = getProtocolMatchingRuntime();
      const localProtocols = asArray(protocols).length
        ? asArray(protocols)
        : protocolApi.listAgentProtocols({
          snapshot,
          projectId,
          projectName,
          limit: 120
        });
      return runtime.rankProtocolMatches({
        protocols: localProtocols,
        protocolCandidates,
        message,
        parserPayload
      });
    },
    async matchForNotebook({
      snapshot = {},
      protocols = [],
      projectId = '',
      projectName = '',
      ...input
    } = {}) {
      const runtime = getProtocolMatchingRuntime();
      const localProtocols = asArray(protocols).length
        ? asArray(protocols)
        : protocolApi.listAgentProtocols({
          snapshot,
          projectId,
          projectName,
          limit: 120
        });
      return runtime.selectProtocol({
        ...input,
        protocols: localProtocols
      });
    }
  };

  const notebookApi = {
    listAgentRecords: listNotebookRecords,
    listAgentEntries(options = {}) {
      return listNotebookRecords(options)
        .map((row) => row?.entry)
        .filter(Boolean);
    },
    async generateFromProtocol(input = {}) {
      return getNotebookGenerationRuntime().generateNotebook(input);
    }
  };

  const api = {
    catalog: AGENT_SUB_APP_API_CATALOG,
    getCatalog() {
      return AGENT_SUB_APP_API_CATALOG;
    },
    assay: {
      listAgentRecords: listAssayRecords,
      listAgentRuns(options = {}) {
        return listAssayRecords(options)
          .map((row) => row?.assay)
          .filter(Boolean);
      }
    },
    gel: {
      listAgentRecords: listGelRecords,
      listAgentAnalyses(options = {}) {
        return listGelRecords(options)
          .map((row) => row?.analysis)
          .filter(Boolean);
      }
    },
    papers: {
      listAgentRecords: listPaperRecords,
      listAgentPapers(options = {}) {
        return listPaperRecords(options)
          .map((row) => row?.paper)
          .filter(Boolean);
      }
    },
    protocol: protocolApi,
    notebook: notebookApi
  };

  return api;
}

module.exports = {
  AGENT_SUB_APP_API_CATALOG,
  createAgentSubAppApi
};
