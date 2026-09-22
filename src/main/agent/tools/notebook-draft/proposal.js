'use strict';

const { cloneJson } = require('../../../lib/normalize.js');

// Picks one candidate (LLM, with a deterministic fallback) and turns it into
// the proposal payload the renderer shows.
function createDraftProposal({
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
} = {}) {
  async function collectProtocolOnlyCandidates({
    snapshot = {},
    parserPayload = {},
    message = '',
    protocolCandidates = []
  } = {}) {
    const protocols = listAgentProtocols(snapshot);
    const ranked = rankAgentProtocols({
      snapshot,
      protocols,
      protocolCandidates,
      message,
      parserPayload
    });
    return asArray(ranked).slice(0, 20).map((match) => ({
      id: uniqueStrings(['protocol-only', cleanText(match?.id, 120), cleanText(match?.name, 220)], 5).join('::'),
      source_type: 'protocol_match',
      priority: 40,
      reason: 'Protocol matched directly from the planning request.',
      trail: [],
      protocol_id: cleanText(match?.id, 120),
      protocol_name: cleanText(match?.name, 220),
      workflow: null
    }));
  }

  async function requestNotebookDraftSelection({
    message,
    conversation,
    parserPayload,
    project,
    notebookRuns,
    candidates,
    evidenceContext = [],
    traceContext = null
  } = {}) {
    return requestStructuredJsonPayload({
      stage: 'notebook_draft_selection',
      systemPrompt: NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
      userPrompt: buildNotebookDraftSelectionPrompt({
        message,
        conversation,
        parserPayload,
        project,
        notebookRuns,
        candidates,
        evidenceContext
      }),
      schema: NOTEBOOK_DRAFT_SELECTION_SCHEMA,
      traceContext,
      defaultError: 'Notebook draft proposal provider is not configured.'
    });
  }

  function buildFallbackProposal(candidate = {}, selectedProtocol = {}, evidenceContext = []) {
    const workflowName = cleanText(candidate?.workflow?.name, 220);
    const protocolName = cleanText(selectedProtocol?.name || candidate?.protocol_name, 220) || 'Next Experiment';
    const trail = asArray(candidate?.trail).map((item) => cleanText(item, 220)).filter(Boolean);
    const evidenceSummaries = normalizeEvidenceContext(evidenceContext)
      .map((item) => cleanText(item.summary, 240))
      .filter(Boolean)
      .slice(0, 3);
    return {
      title: workflowName
        ? `${protocolName} (${workflowName})`
        : protocolName,
      purpose: workflowName
        ? `Advance the next planned step in ${workflowName}.`
        : `Prepare the next likely experiment using ${protocolName}.`,
      rationale: cleanText([
        cleanText(candidate?.reason, 320) || 'This protocol is the strongest next-step candidate from local workflow and notebook context.',
        evidenceSummaries.length ? `Evidence considered: ${evidenceSummaries.join(' ')}` : ''
      ].filter(Boolean).join(' '), 700),
      planned_materials: uniqueStrings([
        ...asArray(selectedProtocol?.materials).slice(0, 120),
        protocolName
      ], 120),
      checkpoints: uniqueStrings([
        ...trail,
        cleanText(candidate?.reason, 220),
        ...evidenceSummaries
      ], 6)
    };
  }

  function renderPlannedResultText({
    title = '',
    purpose = '',
    rationale = '',
    plannedMaterials = [],
    checkpoints = []
  } = {}) {
    const lines = [];
    const cleanTitle = cleanText(title, 220);
    const cleanPurpose = cleanText(purpose, 700);
    const cleanRationale = cleanText(rationale, 700);
    if (cleanTitle) {
      lines.push(`Planned Experiment: ${cleanTitle}`);
    }
    if (cleanPurpose) {
      lines.push(`Purpose: ${cleanPurpose}`);
    }
    if (cleanRationale) {
      lines.push(`Why this next: ${cleanRationale}`);
    }
    if (asArray(plannedMaterials).length) {
      lines.push('Planned Materials:');
      asArray(plannedMaterials).forEach((item) => {
        const cleanItem = cleanText(item, 180);
        if (cleanItem) {
          lines.push(`- ${cleanItem}`);
        }
      });
    }
    if (asArray(checkpoints).length) {
      lines.push('Checkpoints:');
      asArray(checkpoints).forEach((item) => {
        const cleanItem = cleanText(item, 220);
        if (cleanItem) {
          lines.push(`- ${cleanItem}`);
        }
      });
    }
    return cleanText(lines.join('\n'), 40000);
  }

  function decorateNotebookDraft({
    notebook,
    candidate,
    proposal,
    evidenceContext = [],
    missingPlaceholders = []
  }) {
    const generatedAt = now();
    const clonedNotebook = cloneJson(notebook, {});
    const proposalId = createProposalId();
    const proposalPayload = {
      proposal_id: proposalId,
      title: cleanText(proposal?.title, 220) || cleanText(candidate?.protocol_name, 220) || 'Planned Experiment',
      purpose: cleanText(proposal?.purpose, 700),
      rationale: cleanText(proposal?.rationale, 700) || cleanText(candidate?.reason, 320),
      planned_materials: uniqueStrings(asArray(proposal?.planned_materials), 120),
      checkpoints: uniqueStrings(asArray(proposal?.checkpoints), 40),
      evidence_context: normalizeEvidenceContext(evidenceContext).slice(0, 20),
      workflow: candidate?.workflow && typeof candidate.workflow === 'object'
        ? {
          id: cleanText(candidate.workflow.id, 120),
          name: cleanText(candidate.workflow.name, 220),
          block_id: cleanText(candidate.workflow.block_id, 120),
          block_title: cleanText(candidate.workflow.block_title, 220)
        }
        : null
    };
    const plannedResult = renderPlannedResultText({
      title: proposalPayload.title,
      purpose: proposalPayload.purpose,
      rationale: proposalPayload.rationale,
      plannedMaterials: proposalPayload.planned_materials,
      checkpoints: proposalPayload.checkpoints
    });

    clonedNotebook.proposal = proposalPayload;
    clonedNotebook.save = {
      mode: 'confirm_before_save',
      applied: false,
      status: 'awaiting_user_confirmation',
      reason: 'Planned notebook draft is ready to create after confirmation.'
    };
    clonedNotebook.entry_template = ensureObject(clonedNotebook.entry_template);
    clonedNotebook.entry_template.result = plannedResult || cleanText(clonedNotebook.entry_template.result, 900);
    clonedNotebook.entry_template.updatedAt = generatedAt;
    clonedNotebook.entry_template.notebookState = 'planned';
    clonedNotebook.entry_template.executedAt = '';
    clonedNotebook.entry_template.agentDraftStatus = cleanText(
      clonedNotebook.entry_template.agentDraftStatus,
      80
    ) || (asArray(missingPlaceholders).length ? 'needs_review' : 'draft_ready');
    clonedNotebook.entry_template.agentDraftMeta = {
      ...ensureObject(clonedNotebook.entry_template.agentDraftMeta),
      source: 'agent_notebook_draft_v1',
      proposalId,
      workflowId: cleanText(candidate?.workflow?.id, 120),
      evidenceToolNames: uniqueStrings(
        normalizeEvidenceContext(evidenceContext).map((item) => item.tool_name),
        8
      ),
      suggestedAt: generatedAt
    };

    return clonedNotebook;
  }

  return {
    collectProtocolOnlyCandidates,
    requestNotebookDraftSelection,
    buildFallbackProposal,
    renderPlannedResultText,
    decorateNotebookDraft
  };
}

module.exports = { createDraftProposal };
