import { createNotebookAgentAppend } from '../notebook/agent-append.js';
import { buildAgentAppendText, normalizeNotebookTargetText } from '../notebook/result-files.js';

// Apply to saved state without replacing any open editor's unsaved draft.
export function createSavedNotebookAppend({ state, persist, onChanged = () => {} }) {
  let queue = Promise.resolve();
  function append(proposal) {
    const id = String(proposal.notebook_entry_id || proposal.notebookEntryId || '').trim();
    const entry = state.notebookEntries?.find(item => item.id === id);
    if (!entry) return { ok: false, error: 'The target notebook page is unavailable. Ask the agent to refresh it.' };
    const proposalId = String(proposal.proposal_id || proposal.proposalId || '').trim();
    if (!proposalId) return { ok: false, error: 'Notebook proposal is missing its identifier.' };
    if (entry.agentAppendProposalIds?.includes(proposalId)) {
      return { ok: true, saved: true, entryId: id, summary: 'This notebook content was already saved.' };
    }
    const controller = createNotebookAgentAppend({
      elements: { notebookProtocolArea: { hidden: false }, notebookResult: { value: entry.result || '' } },
      appliedAgentAppendProposalIds: new Set(),
      getActiveEntry: () => entry,
      resolveViewerProject: () => state.projects?.find(item => item.id === entry.projectId) || entry.projectSnapshot,
      resolveViewerProtocol: () => entry.protocolSnapshot || state.protocols?.find(item => item.id === entry.protocolId),
      normalizeNotebookTargetText, buildAgentAppendText,
      notifyActiveNotebookPageChanged: () => {},
      saveEntry: async ({ resultText, agentAppendProposalId }) => {
        const index = state.notebookEntries.indexOf(entry);
        if (index < 0) return null;
        const saved = { ...entry, result: resultText, updatedAt: new Date().toISOString(),
          agentAppendProposalIds: [...(entry.agentAppendProposalIds || []), agentAppendProposalId] };
        state.notebookEntries[index] = saved;
        try {
          await persist();
        } catch {
          state.notebookEntries[index] = entry;
          return null;
        }
        onChanged();
        return saved;
      }
    });
    return controller.runAgentNotebookAppend(proposal);
  }
  return (proposal = {}) => {
    const result = queue.then(() => append(proposal));
    queue = result.catch(() => {});
    return result;
  };
}
