import { resolveEntryExperimentName } from '../entry/entry-helpers.js';

// Applying an agent's proposed Results append to the open notebook page, after
// checking the proposal still targets that exact page and was not applied before.
function createNotebookAgentAppend({
  elements,
  appliedAgentAppendProposalIds,
  getActiveEntry,
  resolveViewerProject,
  resolveViewerProtocol,
  normalizeNotebookTargetText,
  buildAgentAppendText,
  notifyActiveNotebookPageChanged,
  saveEntry
} = {}) {
  async function runAgentNotebookAppend(proposal = {}) {
    if (!elements.notebookProtocolArea || elements.notebookProtocolArea.hidden || !elements.notebookResult) {
      return { ok: false, error: 'Open the target Notebook page before approving this append.' };
    }
    const activeEntry = getActiveEntry();
    const project = resolveViewerProject(activeEntry);
    const protocol = resolveViewerProtocol(activeEntry);
    if (!project || !protocol) {
      return { ok: false, error: 'The active notebook page no longer has a project and protocol binding.' };
    }

    const proposedEntryId = String(proposal.notebook_entry_id || proposal.notebookEntryId || '').trim();
    const targetsUnsavedDraft = normalizeNotebookTargetText(proposedEntryId) === 'unsaved draft';
    if (proposedEntryId && !targetsUnsavedDraft && proposedEntryId !== String(activeEntry?.id || '').trim()) {
      return { ok: false, error: 'The active notebook page changed after the proposal was prepared. Reopen the target page and ask the agent to enrich it again.' };
    }
    if (targetsUnsavedDraft && activeEntry) {
      return { ok: false, error: 'The proposal targeted an unsaved draft, but a different saved page is now active.' };
    }

    const expectedTitle = normalizeNotebookTargetText(proposal.page_title || proposal.pageTitle);
    const activeTitle = normalizeNotebookTargetText(
      elements.notebookExperimentName?.value || resolveEntryExperimentName(activeEntry, protocol) || protocol.name
    );
    const expectedProject = normalizeNotebookTargetText(proposal.project_name || proposal.projectName);
    const expectedProtocol = normalizeNotebookTargetText(proposal.protocol_name || proposal.protocolName);
    if (
      (expectedTitle && expectedTitle !== activeTitle)
      || (expectedProject && expectedProject !== normalizeNotebookTargetText(project.name))
      || (expectedProtocol && expectedProtocol !== normalizeNotebookTargetText(protocol.name))
    ) {
      return { ok: false, error: 'The active notebook page identity no longer matches this proposal. Ask the agent to re-read the current page.' };
    }

    const expectedUpdatedAt = String(proposal.expected_updated_at || proposal.expectedUpdatedAt || '').trim();
    if (activeEntry && expectedUpdatedAt && expectedUpdatedAt !== String(activeEntry.updatedAt || '').trim()) {
      return { ok: false, error: 'This notebook page was saved again after the proposal was prepared. Ask the agent to refresh and re-propose the append.' };
    }

    const appendText = buildAgentAppendText(proposal);
    if (!appendText) {
      return { ok: false, error: 'The proposal does not contain any notebook content to append.' };
    }
    const proposalId = String(proposal.proposal_id || proposal.proposalId || '').trim();
    const appliedIds = Array.isArray(activeEntry?.agentAppendProposalIds)
      ? activeEntry.agentAppendProposalIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    // An unsaved draft has no entry to record the id on, and a proposal can
    // arrive without one, so keep a local key as well.
    const appendKey = proposalId || appendText;
    if ((proposalId && appliedIds.includes(proposalId)) || appliedAgentAppendProposalIds.has(appendKey)) {
      return { ok: true, summary: 'This notebook enrichment was already appended.' };
    }

    const currentResult = String(elements.notebookResult.value || '').trim();
    const combinedResult = currentResult ? `${currentResult}\n\n${appendText}` : appendText;
    elements.notebookResult.value = combinedResult;

    if (!activeEntry) {
      appliedAgentAppendProposalIds.add(appendKey);
      notifyActiveNotebookPageChanged();
      return {
        ok: true,
        saved: false,
        summary: 'Content appended to the current notebook draft. Save the page to persist it.'
      };
    }

    const savedEntry = await saveEntry({
      resultText: combinedResult,
      agentAppendProposalId: proposalId
    });
    if (!savedEntry) {
      elements.notebookResult.value = currentResult;
      return { ok: false, error: 'Hikari could not save the notebook append.' };
    }
    appliedAgentAppendProposalIds.add(appendKey);
    return {
      ok: true,
      saved: true,
      entryId: savedEntry.id,
      summary: 'Content appended and saved to the notebook page.'
    };
  }

  return { runAgentNotebookAppend };
}

export { createNotebookAgentAppend };
