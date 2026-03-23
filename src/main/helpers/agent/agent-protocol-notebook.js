'use strict';

const { createProtocolMatchingRuntime } = require('./agent-protocol-matching');
const { createNotebookGenerationRuntime } = require('./agent-notebook-generation');

function createProtocolNotebookRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 50) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const pickTopMatches = typeof deps.pickTopMatches === 'function'
    ? deps.pickTopMatches
    : ((items) => asArray(items).slice(0, 1));
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});

  const PROTOCOL_NOTEBOOK_SESSION_TTL_MS = 30 * 60 * 1000;
  const protocolNotebookPendingSessions = new Map();

  const runtimeDeps = {
    ...deps,
    asArray,
    cleanText,
    uniqueStrings,
    pickTopMatches,
    recordAgentLlmTrace,
    recordLifecycleEvent
  };
  const protocolMatchingRuntime = createProtocolMatchingRuntime(runtimeDeps);
  const notebookGenerationRuntime = createNotebookGenerationRuntime(runtimeDeps);

  function buildProtocolNotebookSessionKey({
    projectId = '',
    projectName = ''
  } = {}) {
    const keyProjectId = cleanText(projectId, 80).toLowerCase();
    const keyProjectName = cleanText(projectName, 180).toLowerCase();
    return [keyProjectId || '-', keyProjectName || '-'].join('::');
  }

  function getPendingProtocolNotebookSession(sessionKey) {
    const key = cleanText(sessionKey, 320);
    if (!key) {
      return null;
    }
    const existing = protocolNotebookPendingSessions.get(key);
    if (!existing || typeof existing !== 'object') {
      return null;
    }
    const createdAt = Date.parse(existing.updated_at || existing.created_at || '');
    if (!Number.isFinite(createdAt)) {
      protocolNotebookPendingSessions.delete(key);
      return null;
    }
    if ((Date.now() - createdAt) > PROTOCOL_NOTEBOOK_SESSION_TTL_MS) {
      protocolNotebookPendingSessions.delete(key);
      return null;
    }
    return existing;
  }

  function setPendingProtocolNotebookSession(sessionKey, session) {
    const key = cleanText(sessionKey, 320);
    if (!key || !session || typeof session !== 'object') {
      return;
    }
    protocolNotebookPendingSessions.set(key, {
      ...session,
      updated_at: new Date().toISOString()
    });
  }

  function clearPendingProtocolNotebookSession(sessionKey) {
    const key = cleanText(sessionKey, 320);
    if (!key) {
      return;
    }
    protocolNotebookPendingSessions.delete(key);
  }

  function hasPendingProtocolNotebookSession(sessionKey) {
    return Boolean(getPendingProtocolNotebookSession(sessionKey));
  }

  function findProjectByName(projects, projectName) {
    const query = cleanText(projectName, 220);
    if (!query) {
      return null;
    }
    const matches = pickTopMatches(
      asArray(projects),
      (project) => `${cleanText(project?.name, 220)} ${cleanText(project?.summary, 400)}`,
      query,
      1
    );
    return matches.length ? matches[0] : null;
  }

  function resolveNotebookProject({
    snapshot,
    payloadProjectId = '',
    payloadProjectName = '',
    parserPayload = {},
    selectedProtocol = null,
    pendingSession = null
  }) {
    const projects = asArray(snapshot?.projects);
    const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    const byId = cleanText(payloadProjectId, 120)
      ? projects.find((project) => cleanText(project?.id, 120) === cleanText(payloadProjectId, 120))
      : null;
    if (byId) {
      return {
        id: cleanText(byId?.id, 120),
        name: cleanText(byId?.name, 220),
        resolution_source: 'payload_project_id'
      };
    }

    const fromPayloadName = findProjectByName(projects, payloadProjectName);
    if (fromPayloadName) {
      return {
        id: cleanText(fromPayloadName?.id, 120),
        name: cleanText(fromPayloadName?.name, 220),
        resolution_source: 'payload_project_name'
      };
    }

    const fromParserEntity = findProjectByName(projects, parserEntities.project_name);
    if (fromParserEntity) {
      return {
        id: cleanText(fromParserEntity?.id, 120),
        name: cleanText(fromParserEntity?.name, 220),
        resolution_source: 'parser_entity'
      };
    }

    const pendingProject = pendingSession?.project && typeof pendingSession.project === 'object'
      ? pendingSession.project
      : null;
    if (pendingProject && (cleanText(pendingProject.id, 120) || cleanText(pendingProject.name, 220))) {
      return {
        id: cleanText(pendingProject.id, 120),
        name: cleanText(pendingProject.name, 220),
        resolution_source: 'pending_session'
      };
    }

    const fromProtocolProjectName = findProjectByName(projects, selectedProtocol?.project_name);
    if (fromProtocolProjectName) {
      return {
        id: cleanText(fromProtocolProjectName?.id, 120),
        name: cleanText(fromProtocolProjectName?.name, 220),
        resolution_source: 'protocol_project_hint'
      };
    }

    if (projects.length === 1) {
      return {
        id: cleanText(projects[0]?.id, 120),
        name: cleanText(projects[0]?.name, 220),
        resolution_source: 'single_project_fallback'
      };
    }

    return {
      id: '',
      name: '',
      resolution_source: 'unresolved'
    };
  }

  async function runProtocolToNotebookFlow({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    snapshot,
    parserPayload,
    projectId = '',
    projectName = '',
    traceContext = null,
    lifecycleRecorder = null
  }) {
    const protocols = asArray(snapshot?.protocols).map((item, index) => protocolMatchingRuntime.normalizeProtocolRecord(item, index));
    const parserEntities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    const sessionKey = buildProtocolNotebookSessionKey({
      projectId,
      projectName,
      parserPayload
    });
    const pendingSession = getPendingProtocolNotebookSession(sessionKey);
    const parserCandidates = uniqueStrings([
      ...asArray(parserPayload?.protocol_candidates),
      cleanText(parserEntities.protocol_name, 220)
    ], 3);
    const protocolCandidates = parserCandidates.length
      ? parserCandidates
      : uniqueStrings([cleanText(pendingSession?.selected_protocol?.name, 220)], 3);

    await recordAgentLlmTrace(traceContext, {
      stage: 'protocol_match_lookup',
      summary: `Protocol lookup candidates=${protocolCandidates.length} local_protocols=${protocols.length}.`,
      request_payload: {
        candidates: protocolCandidates,
        local_protocol_count: protocols.length
      },
      response_payload: {
        has_pending_session: Boolean(pendingSession)
      }
    });

    if (!protocols.length) {
      return {
        status: 'needs_more_info',
        candidate_matches: [],
        selected_protocol: null,
        missing_placeholders: [],
        follow_up_questions: ['No local protocols are available to match. Please add or import a protocol first.'],
        project_name: '',
        notebook: null
      };
    }

    const selection = await protocolMatchingRuntime.selectProtocol({
      provider,
      endpoint,
      apiKey,
      model,
      protocols,
      protocolCandidates,
      message,
      conversation,
      parserPayload,
      fallbackProtocol: pendingSession?.selected_protocol,
      traceContext
    });
    const rankedMatches = asArray(selection?.ranked_matches);

    await recordAgentLlmTrace(traceContext, {
      stage: 'protocol_ranker',
      summary: rankedMatches.length
        ? `Ranked ${rankedMatches.length} protocol matches.`
        : 'No protocol matches were found.',
      request_payload: {
        candidates: protocolCandidates,
        message: cleanText(message, 800)
      },
      response_payload: {
        matches: protocolMatchingRuntime.mapCandidateMatchesForOutput(rankedMatches)
      }
    });

    if (!rankedMatches.length) {
      const clarificationQuestion = protocolCandidates.length
        ? 'I could not find a matching protocol from those candidates. Please provide the protocol name used.'
        : 'Please provide the protocol name so I can generate the notebook draft.';
      return {
        status: 'needs_more_info',
        candidate_matches: [],
        selected_protocol: null,
        missing_placeholders: [],
        follow_up_questions: [clarificationQuestion],
        project_name: '',
        notebook: null
      };
    }

    const selectedProtocol = selection?.selected_protocol
      ? protocolMatchingRuntime.normalizeProtocolRecord(selection.selected_protocol)
      : null;
    if (!selectedProtocol) {
      return {
        status: 'needs_more_info',
        candidate_matches: protocolMatchingRuntime.mapCandidateMatchesForOutput(rankedMatches),
        selected_protocol: null,
        missing_placeholders: [],
        follow_up_questions: ['Please clarify which protocol should be used for this notebook draft.'],
        project_name: '',
        notebook: null
      };
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'protocol_selected',
      status: 'ok',
      message: `Selected protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)} using ${cleanText(selection?.selection_method, 80) || 'deterministic'}.`,
      meta: {
        selection_method: cleanText(selection?.selection_method, 80),
        selected_protocol_id: cleanText(selectedProtocol.id, 120)
      }
    });

    const project = resolveNotebookProject({
      snapshot,
      payloadProjectId: projectId,
      payloadProjectName: projectName,
      parserPayload,
      selectedProtocol,
      pendingSession
    });

    const generationResult = await notebookGenerationRuntime.generateNotebook({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation,
      snapshot,
      parserPayload,
      selectedProtocol,
      project,
      pendingValues: pendingSession?.known_values,
      traceContext,
      lifecycleRecorder
    });
    const status = cleanText(generationResult?.status, 40) || 'needs_more_info';
    const missingPlaceholders = asArray(generationResult?.missing_placeholders);
    const followUpQuestions = asArray(generationResult?.follow_up_questions);

    if (status === 'completed') {
      clearPendingProtocolNotebookSession(sessionKey);
    } else {
      setPendingProtocolNotebookSession(sessionKey, {
        created_at: pendingSession?.created_at || new Date().toISOString(),
        selected_protocol: {
          id: cleanText(selectedProtocol.id, 120),
          name: cleanText(selectedProtocol.name, 220)
        },
        project: {
          id: cleanText(project.id, 120),
          name: cleanText(project.name, 220),
          resolution_source: cleanText(project.resolution_source, 80)
        },
        candidate_matches: protocolMatchingRuntime.mapCandidateMatchesForOutput(rankedMatches),
        known_values: generationResult?.known_values && typeof generationResult.known_values === 'object'
          ? generationResult.known_values
          : {},
        missing_placeholders: missingPlaceholders,
        follow_up_questions: followUpQuestions
      });
    }

    return {
      status,
      candidate_matches: protocolMatchingRuntime.mapCandidateMatchesForOutput(rankedMatches),
      selected_protocol: {
        id: cleanText(selectedProtocol.id, 120),
        name: cleanText(selectedProtocol.name, 220),
        selection_method: cleanText(selection?.selection_method, 80) || 'deterministic',
        rationale: cleanText(selection?.rationale, 260)
      },
      missing_placeholders: missingPlaceholders,
      follow_up_questions: followUpQuestions,
      project_name: cleanText(project?.name, 220),
      notebook: status === 'completed' ? generationResult?.notebook || null : null
    };
  }

  return {
    buildSessionKey: buildProtocolNotebookSessionKey,
    hasPendingSession: hasPendingProtocolNotebookSession,
    setPendingSession: setPendingProtocolNotebookSession,
    clearPendingSession: clearPendingProtocolNotebookSession,
    runFlow: runProtocolToNotebookFlow
  };
}

module.exports = {
  createProtocolNotebookRuntime
};
