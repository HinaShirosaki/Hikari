import { buildNotebookEntryFromDraft, normalizeNotebookDraft } from '../agent/notebook-drafts.js';
import { showTransientNotice } from '../../../lib/notify.js';
import { isAgentAvailable } from '../../../lib/agent-availability.js';

export function createExperimentSuggestions({
  state, persist, createId, host, acceptButton, api,
  getActiveEntry, saveEntry, editEntry, onEntriesChanged = () => {}
} = {}) {
  const runs = new Map();
  const pauses = () => state.settings?.notebookSuggestionPauses || {};
  const pauseMessage = 'No further suggestions until you add a new experiment manually and finish it.';

  function render() {
    host?.querySelectorAll('[data-suggest-experiment]').forEach((button) => {
      const run = runs.get(button.dataset.suggestExperiment);
      button.disabled = Boolean(run?.busy || pauses()[button.dataset.suggestExperiment]);
      button.textContent = run?.busy ? 'Suggesting…' : 'Suggest next experiment';
      const status = host.querySelector('[data-experiment-suggestion-status]');
      if (status) status.textContent = run?.error || (pauses()[button.dataset.suggestExperiment] ? pauseMessage : '');
    });
  }

  async function suggest(projectId, { automatic = false, completedEntry = null } = {}) {
    const project = state.projects?.find((item) => item.id === projectId);
    // Also stops the automatic run after an executed entry while Codex is offline.
    if (!project || runs.get(projectId)?.busy || !isAgentAvailable(host?.ownerDocument)) return null;
    const paused = pauses()[projectId];
    const resumes = paused && completedEntry?.projectId === projectId
      && completedEntry.notebookState === 'executed' && !completedEntry.agentDraftMeta?.source
      && !(paused.entryIds || []).includes(completedEntry.id)
      && state.notebookEntries?.includes(completedEntry);
    if (paused && !resumes) { render(); return null; }
    const existing = state.notebookEntries?.find((entry) => entry.projectId === projectId && entry.notebookState === 'suggested');
    if (existing) {
      if (!automatic) editEntry(existing.id);
      return existing;
    }
    const run = { busy: true, error: '' };
    runs.set(projectId, run);
    const storagePath = state.settings?.storagePath;
    render();
    try {
      if (typeof api?.suggestNextExperiment !== 'function') throw new Error('Experiment suggestions require the Hikari desktop app.');
      const response = await api.suggestNextExperiment({
        projectId,
        snapshot: JSON.parse(JSON.stringify({
          data_file_path: state.data_file_path || state.dataFilePath || '',
          settings: state.settings, projects: state.projects, protocols: state.protocols,
          notebookEntries: state.notebookEntries, workflows: state.workflows,
          samples: state.samples, inventory: state.inventory, labInventory: state.labInventory
        }))
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not suggest the next experiment.');
      if (state.settings?.storagePath !== storagePath || !state.projects?.includes(project)) return null;
      const notebooks = Array.isArray(response.notebooks) ? response.notebooks : (response.notebook ? [response.notebook] : null);
      if (!notebooks || notebooks.length > 5) throw new Error('The agent returned an invalid suggestion batch.');
      const drafts = notebooks.map(normalizeNotebookDraft);
      if (drafts.some(draft => draft?.save?.mode !== 'suggestion_only' || draft?.entry_template?.projectId !== projectId
          || draft?.entry_template?.notebookState !== 'suggested' || !draft?.entry_template?.protocolSnapshot?.steps?.length)) {
        throw new Error('The agent returned an incomplete experiment suggestion. Try again.');
      }
      const duplicate = state.notebookEntries?.find((entry) => entry.projectId === projectId && entry.notebookState === 'suggested');
      if (duplicate) return duplicate;
      const entries = drafts.map(draft => {
        const entry = buildNotebookEntryFromDraft(draft, '', { createId });
        const unresolved = draft.unresolved_placeholders.map((item) => item.display || item.placeholder_key);
        if (unresolved.length) entry.result += `\n\nValues to review: ${unresolved.join(', ')}`;
        return entry;
      });
      const previousPause = pauses()[projectId];
      state.settings ||= {};
      state.settings.notebookSuggestionPauses ||= {};
      if (!entries.length) {
        state.settings.notebookSuggestionPauses[projectId] = {
          entryIds: state.notebookEntries.filter(entry => entry.projectId === projectId).map(entry => entry.id)
        };
      } else {
        delete state.settings.notebookSuggestionPauses[projectId];
      }
      state.notebookEntries.push(...entries);
      try { await persist(); } catch (error) {
        state.notebookEntries = state.notebookEntries.filter(item => !entries.includes(item));
        if (previousPause) state.settings.notebookSuggestionPauses[projectId] = previousPause;
        else delete state.settings.notebookSuggestionPauses[projectId];
        throw error;
      }
      onEntriesChanged();
      return entries[0] || null;
    } catch (error) {
      run.error = error?.message || 'Could not suggest the next experiment.';
      showTransientNotice(run.error, { type: 'error' });
      return null;
    } finally {
      run.busy = false;
      render();
    }
  }

  async function takeIntoPlan() {
    const active = getActiveEntry();
    if (active?.notebookState !== 'suggested' || acceptButton?.disabled) return null;
    if (acceptButton) acceptButton.disabled = true;
    try {
      const saved = await saveEntry();
      if (!saved || saved.id !== active.id) return null;
      const index = state.notebookEntries.findIndex((entry) => entry.id === saved.id);
      const previous = state.notebookEntries[index];
      if (!previous || previous.notebookState !== 'suggested') return null;
      const planned = {
        ...previous, notebookState: 'planned', executedAt: '', updatedAt: new Date().toISOString(),
        agentDraftMeta: { ...previous.agentDraftMeta, acceptedAt: new Date().toISOString() }
      };
      state.notebookEntries[index] = planned;
      try { await persist(); } catch (error) {
        const currentIndex = state.notebookEntries.indexOf(planned);
        if (currentIndex >= 0) state.notebookEntries[currentIndex] = previous;
        throw error;
      }
      onEntriesChanged();
      if (getActiveEntry()?.id === planned.id) editEntry(planned.id);
      return planned;
    } catch (error) {
      showTransientNotice(error?.message || 'Could not take this experiment into plan.', { type: 'error' });
      return null;
    } finally {
      if (acceptButton) acceptButton.disabled = false;
    }
  }

  host?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-suggest-experiment]');
    if (button) void suggest(button.dataset.suggestExperiment);
  });
  acceptButton?.addEventListener('click', () => { void takeIntoPlan(); });

  return { suggest, render, takeIntoPlan };
}
