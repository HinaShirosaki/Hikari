'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { resolveAgentRuntimeFactory } = require('../shared/agent-runtime-registry.js');
const { createProtocolMatchingRuntime } = require('./agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('./agent-notebook-generation.js');
const { cloneJson } = require('../../lib/normalize.js');
const { createDraftSelectionPrompt } = require('./notebook-draft/selection-prompt.js');
const { createDraftCandidates } = require('./notebook-draft/candidates.js');
const { createDraftProposal } = require('./notebook-draft/proposal.js');

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createNotebookDraftRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload,
    recordAgentLlmTrace
  } = createAgentLlmRuntimeHelpers(deps);
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const createProposalId = typeof deps.createProposalId === 'function'
    ? deps.createProposalId
    : (() => `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const protocolMatchingFactory = resolveAgentRuntimeFactory(deps, 'protocol-matching');
  const notebookGenerationFactory = resolveAgentRuntimeFactory(deps, 'notebook-generation');
  const protocolMatchingRuntime = typeof protocolMatchingFactory === 'function'
    ? protocolMatchingFactory({
      ...deps,
      ensureObject
    })
    : createProtocolMatchingRuntime({
      ...deps,
      ensureObject
    });
  const notebookGenerationRuntime = typeof notebookGenerationFactory === 'function'
    ? notebookGenerationFactory({
      ...deps,
      ensureObject,
      runTool: null
    })
    : createNotebookGenerationRuntime({
      ...deps,
      ensureObject,
      runTool: null
    });
  const agentAppApi = deps.agentAppApi && typeof deps.agentAppApi === 'object'
    ? deps.agentAppApi
    : {};
  const protocolApi = agentAppApi.protocol && typeof agentAppApi.protocol === 'object'
    ? agentAppApi.protocol
    : {};
  const notebookApi = agentAppApi.notebook && typeof agentAppApi.notebook === 'object'
    ? agentAppApi.notebook
    : {};

  function normalizeProtocolRecord(protocol, index = 0) {
    if (typeof protocolApi.normalizeAgentProtocol === 'function') {
      return protocolApi.normalizeAgentProtocol(protocol, index);
    }
    return protocolMatchingRuntime.normalizeProtocolRecord(protocol, index);
  }

  function listAgentProtocols(snapshot = {}, options = {}) {
    if (typeof protocolApi.listAgentProtocols === 'function') {
      return asArray(protocolApi.listAgentProtocols({
        snapshot,
        limit: 500,
        ...options
      })).map((protocol, index) => normalizeProtocolRecord(protocol, index));
    }
    return asArray(snapshot?.protocols).map((protocol, index) => normalizeProtocolRecord(protocol, index));
  }

  function rankAgentProtocols(input = {}) {
    if (typeof protocolApi.rankAgentProtocols === 'function') {
      return protocolApi.rankAgentProtocols(input);
    }
    return protocolMatchingRuntime.rankProtocolMatches(input);
  }

  async function generateNotebookFromProtocol(input = {}) {
    if (typeof notebookApi.generateFromProtocol === 'function') {
      return notebookApi.generateFromProtocol(input);
    }
    return notebookGenerationRuntime.generateNotebook(input);
  }

  const {
    NOTEBOOK_DRAFT_SELECTION_SCHEMA,
    NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
    NOTEBOOK_DRAFT_SELECTION_RULES,
    normalizeEvidenceContext,
    buildNotebookDraftSelectionPrompt
  } = createDraftSelectionPrompt({ asArray, cleanText, ensureObject });

  const {
    extractNotebookRuns,
    normalizeWorkflowRecord,
    resolvePlanningProject,
    collectWorkflowCandidates
  } = createDraftCandidates({
    asArray,
    cleanText,
    ensureObject,
    uniqueStrings,
    listAgentProtocols,
    notebookApi
  });

  const {
    collectProtocolOnlyCandidates,
    requestNotebookDraftSelection,
    buildFallbackProposal,
    renderPlannedResultText,
    decorateNotebookDraft
  } = createDraftProposal({
    asArray,
    cleanText,
    ensureObject,
    uniqueStrings,
    now,
    createProposalId,
    requestStructuredJsonPayload,
    listAgentProtocols,
    rankAgentProtocols,
    normalizeEvidenceContext,
    buildNotebookDraftSelectionPrompt,
    NOTEBOOK_DRAFT_SELECTION_SCHEMA,
    NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT
  });

  // Each edit either replaces an existing step's text by 1-based step_number, or (no
  // valid step_number) appends a new step.
  function applyStepEdits(protocol, stepEdits) {
    const edits = asArray(stepEdits).filter((edit) => edit && typeof edit === 'object');
    if (!edits.length) {
      return protocol;
    }
    const clone = cloneJson(protocol, {}) || {};
    const steps = asArray(clone.steps).slice();
    edits.forEach((edit) => {
      const text = cleanText(edit.text, 6000);
      if (!text) {
        return;
      }
      const num = Number(edit.step_number);
      if (Number.isInteger(num) && num >= 1 && num <= steps.length) {
        const existing = steps[num - 1];
        steps[num - 1] = existing && typeof existing === 'object' ? { ...existing, text } : text;
      } else {
        steps.push({ text });
      }
    });
    clone.steps = steps;
    return clone;
  }

  async function generateNotebookDraft({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    snapshot,
    parserPayload,
    project: selectedProject = {},
    workflowId = '',
    protocolCandidates = [],
    pendingValues = {},
    stepEdits = [],
    evidenceContext = [],
    traceContext = null,
    lifecycleRecorder = null
  } = {}) {
    const resolvedProject = resolvePlanningProject({
      snapshot,
      selectedProject,
      parserPayload
    });
    const protocols = listAgentProtocols(snapshot);
    if (!protocols.length) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['No local protocols are available. Please add or import a protocol first.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'No local protocols are available.'
      };
    }

    if (!resolvedProject.id && !resolvedProject.name) {
      return {
        status: 'needs_more_info',
        project_name: '',
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['Please choose which project should receive the planned notebook draft.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'Project scope is required before planning a notebook draft.'
      };
    }

    const parserProtocolCandidates = uniqueStrings([
      ...asArray(protocolCandidates),
      ...asArray(parserPayload?.protocol_candidates)
    ], 20);
    const workflowCandidates = collectWorkflowCandidates({
      snapshot,
      project: resolvedProject,
      workflowId
    });
    const directProtocolCandidates = await collectProtocolOnlyCandidates({
      snapshot,
      parserPayload,
      message,
      protocolCandidates: parserProtocolCandidates
    });
    const candidates = uniqueStrings(
      [
        ...workflowCandidates.map((candidate) => candidate.id),
        ...directProtocolCandidates.map((candidate) => candidate.id)
      ],
      40
    ).map((candidateId) => (
      workflowCandidates.find((candidate) => candidate.id === candidateId)
      || directProtocolCandidates.find((candidate) => candidate.id === candidateId)
    )).filter(Boolean);

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'notebook_draft_candidates',
      status: candidates.length ? 'ok' : 'pending',
      message: `Notebook draft candidates=${candidates.length}.`,
      meta: {
        workflow_id: cleanText(workflowId, 120),
        project_id: cleanText(resolvedProject.id, 120)
      }
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'notebook_draft_candidates',
      summary: `Collected ${candidates.length} notebook draft candidates.`,
      request_payload: {
        project: resolvedProject,
        workflow_id: cleanText(workflowId, 120),
        parser_protocol_candidates: parserProtocolCandidates
      },
      response_payload: {
        candidates: asArray(candidates).slice(0, 40)
      }
    });

    if (!candidates.length) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: null,
        missing_placeholders: [],
        follow_up_questions: ['I could not infer the next protocol. Please name the workflow or protocol you want drafted.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'No viable next-step protocol candidate was found.'
      };
    }

    const notebookRuns = extractNotebookRuns(snapshot)
      .filter((entry) => cleanText(entry.project_id, 120) === cleanText(resolvedProject.id, 120))
      .slice(0, 60);
    const normalizedEvidenceContext = normalizeEvidenceContext(evidenceContext);
    let selectedCandidate = candidates[0];
    let proposalFields = buildFallbackProposal(
      selectedCandidate,
      protocols.find((protocol) => protocol.id === selectedCandidate.protocol_id),
      normalizedEvidenceContext
    );
    const llmSelection = await requestNotebookDraftSelection({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation,
      parserPayload,
      project: resolvedProject,
      notebookRuns,
      candidates,
      evidenceContext: normalizedEvidenceContext,
      traceContext
    });
    if (llmSelection?.ok && llmSelection?.payload) {
      const selectedCandidateId = cleanText(llmSelection.payload.selected_candidate_id, 220);
      const llmCandidate = selectedCandidateId
        ? candidates.find((candidate) => candidate.id === selectedCandidateId)
        : null;
      if (llmCandidate) {
        selectedCandidate = llmCandidate;
      }
      proposalFields = {
        title: cleanText(llmSelection.payload.title, 220) || proposalFields.title,
        purpose: cleanText(llmSelection.payload.purpose, 700) || proposalFields.purpose,
        rationale: cleanText(llmSelection.payload.rationale, 700) || proposalFields.rationale,
        planned_materials: uniqueStrings(asArray(llmSelection.payload.planned_materials), 120).length
          ? uniqueStrings(asArray(llmSelection.payload.planned_materials), 120)
          : proposalFields.planned_materials,
        checkpoints: uniqueStrings(asArray(llmSelection.payload.checkpoints), 40).length
          ? uniqueStrings(asArray(llmSelection.payload.checkpoints), 40)
          : proposalFields.checkpoints
      };
    }

    const selectedProtocol = protocols.find((protocol) => cleanText(protocol.id, 120) === cleanText(selectedCandidate.protocol_id, 120))
      || protocols.find((protocol) => cleanText(protocol.name, 220).toLowerCase() === cleanText(selectedCandidate.protocol_name, 220).toLowerCase())
      || null;
    if (!selectedProtocol) {
      return {
        status: 'needs_more_info',
        project_name: cleanText(resolvedProject.name, 220),
        selected_protocol: null,
        source_workflow: selectedCandidate?.workflow || null,
        missing_placeholders: [],
        follow_up_questions: ['I could not resolve the protocol record for the proposed draft. Please pick a protocol explicitly.'],
        proposal_summary: '',
        proposal: null,
        notebook: null,
        summary: 'The proposed next-step protocol could not be resolved.'
      };
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'notebook_draft_selected',
      status: 'ok',
      message: `Notebook draft selected protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)}.`,
      meta: {
        project_id: cleanText(resolvedProject.id, 120),
        protocol_id: cleanText(selectedProtocol.id, 120),
        workflow_id: cleanText(selectedCandidate?.workflow?.id, 120)
      }
    });

    const draftProtocol = applyStepEdits(selectedProtocol, stepEdits);
    const generationResult = await generateNotebookFromProtocol({
      provider,
      endpoint,
      apiKey,
      model,
      message: cleanText([
        message,
        proposalFields.title ? `Planned experiment title: ${proposalFields.title}` : '',
        proposalFields.purpose ? `Planned purpose: ${proposalFields.purpose}` : ''
      ].filter(Boolean).join('\n'), 12000),
      conversation,
      snapshot,
      parserPayload,
      selectedProtocol: draftProtocol,
      project: resolvedProject,
      pendingValues: pendingValues && typeof pendingValues === 'object' ? pendingValues : {},
      traceContext,
      lifecycleRecorder
    });
    const notebook = generationResult?.notebook && typeof generationResult.notebook === 'object'
      ? decorateNotebookDraft({
        notebook: generationResult.notebook,
        candidate: selectedCandidate,
        proposal: proposalFields,
        evidenceContext: normalizedEvidenceContext,
        missingPlaceholders: generationResult.missing_placeholders
      })
      : null;
    const proposalSummary = cleanText([
      cleanText(proposalFields.title, 220),
      cleanText(proposalFields.purpose, 260)
    ].filter(Boolean).join(': '), 520);

    return {
      status: notebook ? 'proposal_ready' : 'needs_more_info',
      project_name: cleanText(resolvedProject.name, 220),
      selected_protocol: {
        id: cleanText(selectedProtocol.id, 120),
        name: cleanText(selectedProtocol.name, 220),
        selection_method: cleanText(selectedCandidate?.source_type, 80) || 'workflow',
        rationale: cleanText(proposalFields.rationale, 320) || cleanText(selectedCandidate?.reason, 320)
      },
      source_workflow: selectedCandidate?.workflow || null,
      missing_placeholders: asArray(notebook?.unresolved_placeholders),
      follow_up_questions: uniqueStrings(asArray(generationResult?.follow_up_questions), 10),
      proposal_summary: proposalSummary,
      proposal: notebook?.proposal || null,
      notebook,
      summary: notebook
        ? `Planned notebook draft ready for confirmation using protocol ${cleanText(selectedProtocol.name, 220) || cleanText(selectedProtocol.id, 120)}.`
        : 'Notebook draft proposal could not be prepared.'
    };
  }

  return {
    NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
    NOTEBOOK_DRAFT_SELECTION_RULES,
    normalizeEvidenceContext,
    normalizeWorkflowRecord,
    extractNotebookRuns,
    resolvePlanningProject,
    collectWorkflowCandidates,
    collectProtocolOnlyCandidates,
    buildNotebookDraftSelectionPrompt,
    requestNotebookDraftSelection,
    buildFallbackProposal,
    renderPlannedResultText,
    decorateNotebookDraft,
    generateNotebookDraft
  };
}

module.exports = {
  createNotebookDraftRuntime
};
